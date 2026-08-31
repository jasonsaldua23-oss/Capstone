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
    response = requests.post(
        f"{_base_url()}/storage/v1/object/{_bucket()}/{clean_path}",
        data=data,
        headers={
            "Authorization": f"Bearer {key}",
            "apikey": key,
            "Content-Type": resolved_type,
            # Uploads are uniquely named, so a collision means a retry of the same file.
            "x-upsert": "true",
        },
        timeout=UPLOAD_TIMEOUT_SECONDS,
    )
    if not response.ok:
        detail = str(response.text or "")[:300]
        logger.error("Supabase upload failed path=%s status=%s body=%s", clean_path, response.status_code, detail)
        raise ObjectStorageError(f"Upload rejected by storage ({response.status_code})")
    return public_url(clean_path)


def ensure_bucket() -> dict[str, Any]:
    """Create the public bucket if it does not exist. Safe to call repeatedly."""
    if not is_configured():
        raise ObjectStorageError("Object storage is not configured")
    key = str(settings.SUPABASE_SERVICE_ROLE_KEY).strip()
    headers = {"Authorization": f"Bearer {key}", "apikey": key, "Content-Type": "application/json"}
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
