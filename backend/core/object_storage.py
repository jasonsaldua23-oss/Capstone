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


def _private_bucket() -> str:
    """Keep evidence out of the public catalog bucket."""
    return str(getattr(settings, "SUPABASE_PRIVATE_UPLOADS_BUCKET", "") or "uploads-private").strip().strip("/")


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


def _upload_bytes(
    object_path: str,
    data: bytes,
    content_type: str | None = None,
    *,
    bucket: str,
) -> None:
    """Store bytes in the requested bucket without changing an existing object."""
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
            # Fix: a colliding object key must fail instead of replacing existing evidence.
            "x-upsert": "false",
        }
    )
    try:
        response = requests.post(
            f"{_base_url()}/storage/v1/object/{bucket}/{clean_path}",
            data=data,
            headers=headers,
            timeout=UPLOAD_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        logger.warning("Supabase upload connection failed path=%s error=%s", clean_path, exc)
        raise ObjectStorageError("Could not connect to object storage") from exc
    if not response.ok:
        detail = str(response.text or "")[:300]
        logger.error("Supabase upload failed path=%s status=%s body=%s", clean_path, response.status_code, detail)
        raise ObjectStorageError(f"Upload rejected by storage ({response.status_code})")


def upload_bytes(object_path: str, data: bytes, content_type: str | None = None) -> str:
    """Store public catalog bytes and return their public URL.

    `object_path` is the path within the bucket, e.g. "products/product-123.png".
    """
    clean_path = object_path.lstrip("/")
    try:
        _upload_bytes(clean_path, data, content_type, bucket=_bucket())
    except ObjectStorageError:
        key = str(settings.SUPABASE_SERVICE_ROLE_KEY).strip()
        if not key.startswith("sb_secret_"):
            raise
        # Supabase's newer opaque server keys cannot be used as Bearer JWTs by
        # some Storage deployments. This public-catalog-only fallback preserves
        # existing product uploads; private evidence never falls back publicly.
        logger.warning("Falling back to persistent disk for catalog path=%s", clean_path)
        return _store_on_persistent_disk(clean_path, data)
    return public_url(clean_path)


def upload_private_bytes(object_path: str, data: bytes, content_type: str | None = None) -> None:
    """Store evidence in the private bucket; callers expose it only through the API."""
    try:
        _upload_bytes(object_path, data, content_type, bucket=_private_bucket())
    except ObjectStorageError:
        key = str(settings.SUPABASE_SERVICE_ROLE_KEY).strip()
        if not key.startswith("sb_secret_"):
            raise
        # Fix: some Storage deployments still require a bearer JWT and reject
        # opaque server keys. Keep evidence behind /api/media on persistent disk.
        logger.warning("Falling back to protected persistent disk path=%s", object_path)
        _store_on_persistent_disk(object_path.lstrip("/"), data)


def download_private_bytes(object_path: str) -> tuple[bytes, str]:
    """Read a private object with the service credential for an authorized API response."""
    if not is_configured():
        raise ObjectStorageError("Object storage is not configured")
    clean_path = object_path.lstrip("/")
    key = str(settings.SUPABASE_SERVICE_ROLE_KEY).strip()
    try:
        response = requests.get(
            f"{_base_url()}/storage/v1/object/{_private_bucket()}/{clean_path}",
            headers=_api_key_headers(key),
            timeout=UPLOAD_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        logger.warning("Private media download failed path=%s error=%s", clean_path, exc)
        raise ObjectStorageError("Could not retrieve private media") from exc
    if not response.ok:
        raise ObjectStorageError(f"Private media download rejected ({response.status_code})")
    return response.content, str(response.headers.get("Content-Type") or "application/octet-stream")


def download_public_bytes(object_path: str) -> tuple[bytes, str]:
    """Read a legacy public-bucket object during the explicit private-media migration."""
    if not is_configured():
        raise ObjectStorageError("Object storage is not configured")
    clean_path = object_path.lstrip("/")
    key = str(settings.SUPABASE_SERVICE_ROLE_KEY).strip()
    try:
        response = requests.get(
            f"{_base_url()}/storage/v1/object/{_bucket()}/{clean_path}",
            headers=_api_key_headers(key),
            timeout=UPLOAD_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise ObjectStorageError("Could not retrieve legacy public media") from exc
    if not response.ok:
        raise ObjectStorageError(f"Legacy public media download rejected ({response.status_code})")
    return response.content, str(response.headers.get("Content-Type") or "application/octet-stream")


def delete_public_object(object_path: str) -> None:
    """Remove a copied legacy object so its former public URL no longer works."""
    if not is_configured():
        raise ObjectStorageError("Object storage is not configured")
    key = str(settings.SUPABASE_SERVICE_ROLE_KEY).strip()
    try:
        response = requests.delete(
            f"{_base_url()}/storage/v1/object/{_bucket()}/{object_path.lstrip('/')}",
            headers=_api_key_headers(key),
            timeout=UPLOAD_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise ObjectStorageError("Could not remove legacy public media") from exc
    if not response.ok:
        raise ObjectStorageError(f"Legacy public media deletion rejected ({response.status_code})")


def ensure_bucket() -> dict[str, Any]:
    """Create the public catalog and private evidence buckets when absent."""
    if not is_configured():
        raise ObjectStorageError("Object storage is not configured")
    key = str(settings.SUPABASE_SERVICE_ROLE_KEY).strip()
    headers = _api_key_headers(key)
    headers["Content-Type"] = "application/json"
    created: list[str] = []
    for bucket, is_public in ((_bucket(), True), (_private_bucket(), False)):
        response = requests.post(
            f"{_base_url()}/storage/v1/bucket",
            json={"name": bucket, "id": bucket, "public": is_public},
            headers=headers,
            timeout=UPLOAD_TIMEOUT_SECONDS,
        )
        if response.status_code == 409:
            continue
        if not response.ok:
            raise ObjectStorageError(f"Could not create bucket ({response.status_code}): {str(response.text or '')[:200]}")
        created.append(bucket)
    return {"created": bool(created), "buckets": created or [_bucket(), _private_bucket()]}
