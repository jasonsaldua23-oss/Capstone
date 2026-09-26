"""Protected upload and media-serving endpoints."""

import logging
import mimetypes
import re
import uuid
from pathlib import Path
from typing import Any

from django.conf import settings
from django.db.models import Q
from django.http import FileResponse, HttpRequest, HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from . import object_storage
from . import views_api as legacy
from .image_compression import optimize_image_upload
from .models import Customer, Order, Replacement, RoleType, Trip, TripDropPoint, User
from .pod_overlay import build_driver_full_name, burn_pod_overlay, parse_pod_overlay_metadata

logger = logging.getLogger(__name__)


# Delegating through the legacy module keeps existing authorization patches and
# compatibility imports working while media owns its independent HTTP handlers.
def _err(message: str, status: int = 400) -> JsonResponse:
    return legacy._err(message, status)


def _ok(data: dict[str, Any], status: int = 200) -> JsonResponse:
    return legacy._ok(data, status)


def _require_auth(request: HttpRequest) -> dict[str, Any] | None:
    return legacy._require_auth(request)


def _require_staff(request: HttpRequest):
    return legacy._require_staff(request)


def _get_allowed_warehouse_ids_for_staff(user_id: str) -> set[str]:
    return legacy._get_allowed_warehouse_ids_for_staff(user_id)


PUBLIC_UPLOAD_FOLDER = "products"


def _normalized_upload_path(path: Any) -> str | None:
    """Accept only storage-relative paths so media requests cannot escape their root."""
    clean_path = str(path or "").replace("\\", "/").strip().lstrip("/")
    if not clean_path or clean_path.startswith("/") or ".." in clean_path.split("/"):
        return None
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", clean_path):
        return None
    return clean_path


def _private_media_url(path: str) -> str:
    return f"/api/media/{path}"


def _store_upload_bytes(data: bytes, folder: str, prefix: str, ext: str, content_type: str | None = None) -> str:
    """Persist catalog assets publicly and evidence behind the authorized media route."""
    # Fix: timestamp-only names collide under concurrent uploads.
    name = f"{prefix}-{uuid.uuid4().hex}{ext}"
    object_path = f"{folder}/{name}"
    if object_storage.is_configured():
        if folder == PUBLIC_UPLOAD_FOLDER:
            return object_storage.upload_bytes(object_path, data, content_type=content_type)
        # Private buckets never expose a direct Storage URL. The API authorizes each read.
        object_storage.upload_private_bytes(object_path, data, content_type=content_type)
        return _private_media_url(object_path)
    # Local development uses the same disk layout, but non-catalog files still use
    # the authenticated API route rather than the public static upload route.
    media_root = Path(settings.MEDIA_ROOT) / "uploads" / folder
    media_root.mkdir(parents=True, exist_ok=True)
    (media_root / name).write_bytes(data)
    return f"/uploads/{object_path}" if folder == PUBLIC_UPLOAD_FOLDER else _private_media_url(object_path)


def _store_upload(file_obj, folder: str, prefix: str, default_ext: str) -> str:
    """Persist an uploaded file and return the URL to record in the database.

    Prefers the object storage bucket, because a file written to the API server's own
    disk is lost the next time the service is redeployed â€” which is what made product
    photos, PODs and evidence images vanish. Falls back to the local media directory
    so a checkout without storage credentials still works for development.
    """
    ext = (Path(file_obj.name).suffix or default_ext).lower()
    content_type = str(file_obj.content_type or "") or None
    limit = 10 * 1024 * 1024 if str(content_type or "").startswith("image/") else 50 * 1024 * 1024
    if file_obj.size > limit:
        raise ValueError("The uploaded file exceeds the size limit")
    data = file_obj.read(limit + 1)
    if len(data) > limit:
        raise ValueError("The uploaded file exceeds the size limit")
    # Added: every image upload is optimized server-side, including clients that skip compression.
    if str(content_type or "").lower().startswith("image/"):
        data, ext, content_type = optimize_image_upload(
            data,
            folder=folder,
            original_extension=ext,
            original_content_type=content_type,
        )
    return _store_upload_bytes(
        data,
        folder,
        prefix,
        ext,
        content_type=content_type,
    )


def _handle_image_upload(request: HttpRequest, folder: str, prefix: str) -> JsonResponse:
    file_obj = request.FILES.get("file")
    if not file_obj:
        return _err("Image file is required")
    if not str(file_obj.content_type or "").lower().startswith("image/"):
        return _err("Only image files are allowed")
    try:
        url = _store_upload(file_obj, folder, prefix, ".png")
    except ValueError as exc:
        return _err(str(exc), 400)
    except object_storage.ObjectStorageError:
        logger.exception("Image upload to object storage failed folder=%s", folder)
        return _err("Could not store the image right now. Please try again.", 502)
    return _ok({"success": True, "imageUrl": url})


def _handle_evidence_upload(request: HttpRequest, folder: str, prefix: str) -> JsonResponse:
    file_obj = request.FILES.get("file")
    if not file_obj:
        return _err("Evidence file is required")
    content_type = str(file_obj.content_type or "").lower()
    if not (content_type.startswith("image/") or content_type.startswith("video/")):
        return _err("Only image or video files are allowed")
    try:
        url = _store_upload(file_obj, folder, prefix, ".bin")
    except ValueError as exc:
        return _err(str(exc), 400)
    except object_storage.ObjectStorageError:
        logger.exception("Evidence upload to object storage failed folder=%s", folder)
        return _err("Could not store the file right now. Please try again.", 502)
    return _ok({"success": True, "fileUrl": url})


@csrf_exempt
@require_http_methods(["POST"])
def upload_product_image(request: HttpRequest) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    return _handle_image_upload(request, "products", "product")


@csrf_exempt
@require_http_methods(["POST"])
def upload_pod_image(request: HttpRequest) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    if p.get("role") != "DRIVER":
        return _err("Forbidden", 403)
    try:
        overlay = parse_pod_overlay_metadata(request.POST)
    except ValueError as exc:
        return _err(str(exc))
    if overlay is not None:
        file_obj = request.FILES.get("file")
        if not file_obj:
            return _err("Image file is required")
        if not str(file_obj.content_type or "").lower().startswith("image/"):
            return _err("Only image files are allowed")
        driver = User.objects.filter(id=str(p.get("userId") or "")).first()
        if not driver:
            return _err("Driver account not found", 404)
        try:
            # Added: native captures are stamped server-side with the authenticated driver's name.
            if file_obj.size > 10 * 1024 * 1024:
                return _err("Images must be 10 MB or smaller", 400)
            stamped, extension = burn_pod_overlay(file_obj.read(), overlay, build_driver_full_name(driver))
            # Keep the stamped proof within the POD profile without removing its readable overlay.
            stamped, extension, stamped_content_type = optimize_image_upload(
                stamped,
                folder="pods",
                original_extension=extension,
                original_content_type="image/jpeg",
            )
        except ValueError as exc:
            return _err(str(exc))
        try:
            url = _store_upload_bytes(
                stamped,
                "pods",
                "pod",
                extension,
                content_type=stamped_content_type,
            )
        except object_storage.ObjectStorageError:
            logger.exception("Stamped POD upload to object storage failed")
            return _err("Could not store the proof of delivery right now. Please try again.", 502)
        return _ok({"success": True, "imageUrl": url})
    return _handle_image_upload(request, "pods", "pod")


@csrf_exempt
@require_http_methods(["POST"])
def upload_damage_image(request: HttpRequest) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    if p.get("role") != "DRIVER":
        return _err("Forbidden", 403)
    return _handle_image_upload(request, "damages", "damage")




@csrf_exempt
@require_http_methods(["POST"])
def upload_customer_avatar(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    return _handle_image_upload(request, "customers", "customer")


@csrf_exempt
@require_http_methods(["POST"])
def upload_replacement_evidence(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p or p.get("type") != "customer":
        return _err("Unauthorized", 401)
    return _handle_evidence_upload(request, "replacement-evidence", "replacement-evidence")


def _media_url_candidates(path: str) -> set[str]:
    """Match both new protected URLs and legacy locally/publicly stored values."""
    candidates = {
        _private_media_url(path),
        f"/uploads/{path}",
    }
    if object_storage.is_configured():
        candidates.add(object_storage.public_url(path))
    return candidates


def _matching_replacements(media_urls: set[str]):
    """Return replacements that directly reference one of the requested evidence files."""
    query = Q(damage_photo_url__in=media_urls)
    # Legacy multi-file evidence is JSON text, so exact individual URL matching
    # is unavailable at the database layer. The route still requires a matching
    # replacement before any private file can be served.
    for media_url in media_urls:
        query |= Q(damage_photo_urls__contains=media_url)
    return Replacement.objects.filter(query)


def _private_media_access_allowed(payload: dict[str, Any], media_urls: set[str]) -> bool:
    """Authorize media through the record that owns it, never by an opaque URL alone."""
    account_id = str(payload.get("userId") or "").strip()
    if not account_id:
        return False

    user_avatar = User.objects.filter(
        id=account_id,
        avatar__in=media_urls,
    ).exists()
    if user_avatar:
        return True

    account_type = str(payload.get("type") or "").strip().lower()
    if account_type == "customer":
        if Customer.objects.filter(id=account_id, avatar__in=media_urls).exists():
            return True
        if Order.objects.filter(customer_id=account_id, pod_photo_url__in=media_urls).exists():
            return True
        if TripDropPoint.objects.filter(
            order__customer_id=account_id,
            delivery_photo__in=media_urls,
        ).exists():
            return True
        return _matching_replacements(media_urls).filter(customer_id=account_id).exists()

    if account_type != "staff":
        return False

    role = str(payload.get("role") or "").strip().upper()
    if role == RoleType.ADMIN:
        return (
            Order.objects.filter(pod_photo_url__in=media_urls).exists()
            or TripDropPoint.objects.filter(delivery_photo__in=media_urls).exists()
            or _matching_replacements(media_urls).exists()
            or Customer.objects.filter(avatar__in=media_urls).exists()
            or User.objects.filter(avatar__in=media_urls).exists()
        )

    if role == RoleType.DRIVER:
        assigned_trip_ids = Trip.objects.filter(driver_id=account_id).values("id")
        if TripDropPoint.objects.filter(
            trip_id__in=assigned_trip_ids,
            delivery_photo__in=media_urls,
        ).exists():
            return True
        if Order.objects.filter(
            pod_photo_url__in=media_urls,
            drop_points__trip_id__in=assigned_trip_ids,
        ).exists():
            return True
        return _matching_replacements(media_urls).filter(trip_id__in=assigned_trip_ids).exists()

    if role == RoleType.WAREHOUSE_STAFF:
        allowed_warehouse_ids = _get_allowed_warehouse_ids_for_staff(account_id)
        if not allowed_warehouse_ids:
            return False
        if Order.objects.filter(
            warehouse_id__in=allowed_warehouse_ids,
            pod_photo_url__in=media_urls,
        ).exists():
            return True
        if TripDropPoint.objects.filter(
            trip__warehouse_id__in=allowed_warehouse_ids,
            delivery_photo__in=media_urls,
        ).exists():
            return True
        return _matching_replacements(media_urls).filter(
            Q(order__warehouse_id__in=allowed_warehouse_ids)
            | Q(trip_id__in=Trip.objects.filter(warehouse_id__in=allowed_warehouse_ids).values("id"))
        ).exists()

    return False


def _local_upload_file(path: str) -> Path | None:
    """Resolve an existing upload under either supported local storage root."""
    for local_root in (
        Path(settings.MEDIA_ROOT) / "uploads",
        Path(settings.BASE_DIR).parent / "public" / "uploads",
    ):
        local_root = local_root.resolve()
        candidate = (local_root / path).resolve()
        try:
            candidate.relative_to(local_root)
        except ValueError:
            return None
        if candidate.is_file():
            return candidate
    return None


def resolve_available_avatar(value: Any) -> str | None:
    """Do not advertise a known-missing local file as a usable client avatar."""
    raw = str(value or "").strip()
    if not raw:
        return None
    prefix = next((part for part in ("/uploads/", "/api/media/") if raw.startswith(part)), None)
    # Remote avatars and cloud-backed uploads cannot be judged from the local disk.
    # Keep them intact without adding a network request for every client in the list.
    if not prefix or object_storage.is_configured():
        return raw
    path = _normalized_upload_path(raw[len(prefix):])
    # Fix: a stale local URL uses the existing initials fallback; the stored reference
    # is untouched so restoring the original file makes the avatar available again.
    return raw if path and _local_upload_file(path) else None


def _private_media_response(path: str) -> JsonResponse | FileResponse | HttpResponse:
    """Read a protected asset only after its caller has passed record-level access checks."""
    if not _normalized_upload_path(path):
        return _err("Private media not found", 404)
    # Legacy avatars under public/uploads use the same authorized reader.
    target = _local_upload_file(path)

    if target is not None:
        response: JsonResponse | FileResponse | HttpResponse = FileResponse(
            target.open("rb"),
            content_type=mimetypes.guess_type(str(target))[0] or "application/octet-stream",
        )
    elif object_storage.is_configured():
        try:
            data, content_type = object_storage.download_private_bytes(path)
        except object_storage.ObjectStorageError:
            logger.warning("Private media was unavailable path=%s", path)
            return _err("Private media not found", 404)
        response = HttpResponse(data, content_type=content_type)
    else:
        return _err("Private media not found", 404)

    # Evidence must not be cached or interpreted as active same-origin content.
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "default-src 'none'; sandbox"
    return response


@require_GET
def private_media(request: HttpRequest, path: str) -> JsonResponse | FileResponse | HttpResponse:
    """Serve a private upload after verifying the caller can view its owning record."""
    normalized_path = _normalized_upload_path(path)
    if not normalized_path or normalized_path.startswith(f"{PUBLIC_UPLOAD_FOLDER}/"):
        return _err("Private media not found", 404)
    payload = _require_auth(request)
    if not payload:
        return _err("Unauthorized", 401)
    if not _private_media_access_allowed(payload, _media_url_candidates(normalized_path)):
        return _err("Forbidden", 403)
    return _private_media_response(normalized_path)
