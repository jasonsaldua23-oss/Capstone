"""Uploads go to Supabase Storage, not the API server's own filesystem.

Every uploaded image used to be written under backend/media/uploads/ and recorded in
the database as a relative path such as "/uploads/products/product-123.png". That file
lives only on the machine that happened to receive the upload, so a redeploy onto a
fresh container — or any host with an ephemeral filesystem — takes every product
photo, POD, avatar and evidence file with it, and the portals silently fall back to
the placeholder logo. Storing the object in a bucket and recording its absolute URL
makes the image outlive the server that received it.

When the bucket is not configured (a local checkout without Supabase credentials),
the callers fall back to writing the file locally, which keeps development working.
"""
from __future__ import annotations

import logging
import mimetypes
from pathlib import Path
from typing import Any

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

UPLOAD_TIMEOUT_SECONDS = 30


class ObjectStorageError(RuntimeError):
    """Raised when the bucket is configured but rejected the upload."""


def is_configured() -> bool:
    return bool(
        str(getattr(settings, "SUPABASE_URL", "") or "").strip()
        and str(getattr(settings, "SUPABASE_SERVICE_ROLE_KEY", "") or "").strip()
    )


def _base_url() -> str:
    return str(settings.SUPABASE_URL).strip().rstrip("/")


def _bucket() -> str:
    return str(getattr(settings, "SUPABASE_UPLOADS_BUCKET", "") or "uploads").strip().strip("/")


def public_url(object_path: str) -> str:
    """The public URL for an object already stored in the bucket."""
    return f"{_base_url()}/storage/v1/object/public/{_bucket()}/{object_path.lstrip('/')}"


def _api_key_headers(key: str) -> dict[str, str]:
    """Build headers that support both current and legacy Supabase API keys."""
    headers = {"apikey": key}
    # Fix: sb_secret keys are opaque API keys, not JWTs. Sending one as a Bearer
    # token makes Storage reject it with "Invalid Compact JWS".
    if not key.startswith(("sb_secret_", "sb_publishable_")):
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _store_on_persistent_disk(object_path: str, data: bytes) -> str:
    """Use the API server's persistent upload directory as a compatibility fallback."""
    target = Path(settings.MEDIA_ROOT) / "uploads" / object_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return f"/uploads/{object_path}"


def upload_bytes(object_path: str, data: bytes, content_type: str | None = None) -> str:
    """Store bytes at `object_path` in the bucket and return the public URL.

    `object_path` is the path within the bucket, e.g. "products/product-123.png".
    """
    if not is_configured():
        raise ObjectStorageError("Object storage is not configured")

    clean_path = object_path.lstrip("/")
    resolved_type = (
        str(content_type or "").strip()
        or mimetypes.guess_type(clean_path)[0]
        or "application/octet-stream"
    )
    key = str(settings.SUPABASE_SERVICE_ROLE_KEY).strip()
    headers = _api_key_headers(key)
    headers.update(
        {
            "Content-Type": resolved_type,
            # Uploads are uniquely named, so a collision means a retry of the same file.
            "x-upsert": "true",
        }
    )
    response = requests.post(
        f"{_base_url()}/storage/v1/object/{_bucket()}/{clean_path}",
        data=data,
        headers=headers,
        timeout=UPLOAD_TIMEOUT_SECONDS,
    )
    if not response.ok:
        detail = str(response.text or "")[:300]
        logger.error("Supabase upload failed path=%s status=%s body=%s", clean_path, response.status_code, detail)
        # Fix: Supabase's raw Storage endpoint still requires an Authorization JWT,
        # while new sb_secret keys are explicitly not JWTs. Keep production uploads
        # available on Lightsail's persistent disk until Storage accepts these keys.
        incompatible_secret_key = key.startswith("sb_secret_") and (
            "required property 'authorization'" in detail or "Invalid Compact JWS" in detail
        )
        if incompatible_secret_key:
            logger.warning("Falling back to persistent disk for upload path=%s", clean_path)
            return _store_on_persistent_disk(clean_path, data)
        raise ObjectStorageError(f"Upload rejected by storage ({response.status_code})")
    return public_url(clean_path)


def ensure_bucket() -> dict[str, Any]:
    """Create the public bucket if it does not exist. Safe to call repeatedly."""
    if not is_configured():
        raise ObjectStorageError("Object storage is not configured")
    key = str(settings.SUPABASE_SERVICE_ROLE_KEY).strip()
    headers = _api_key_headers(key)
    headers["Content-Type"] = "application/json"
    response = requests.post(
        f"{_base_url()}/storage/v1/bucket",
        json={"name": _bucket(), "id": _bucket(), "public": True},
        headers=headers,
        timeout=UPLOAD_TIMEOUT_SECONDS,
    )
    if response.status_code == 409:
        return {"created": False, "bucket": _bucket()}
    if not response.ok:
        raise ObjectStorageError(f"Could not create bucket ({response.status_code}): {str(response.text or '')[:200]}")
    return {"created": True, "bucket": _bucket()}
