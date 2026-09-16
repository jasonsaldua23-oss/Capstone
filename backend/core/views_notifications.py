"""In-app, web, and native push notification endpoints."""

from typing import Any

from django.db import transaction
from django.http import HttpRequest, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from . import views_api as legacy
from .api_utils import error as _err, json_body as _json_body, ok as _ok, to_int as _int
from .models import Notification, PushSubscription


# Authentication and model serialization retain the existing API-wide contracts.
def _require_auth(request: HttpRequest) -> dict[str, Any] | None:
    return legacy._require_auth(request)


def _serialize_model(instance):
    return legacy._serialize_model(instance)


def get_web_push_public_key() -> str:
    return legacy.get_web_push_public_key()


def native_push_is_configured() -> bool:
    return legacy.native_push_is_configured()


def web_push_is_configured() -> bool:
    return legacy.web_push_is_configured()


@csrf_exempt
@require_http_methods(["GET", "PATCH", "DELETE"])
def notifications_collection(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    scoped_qs = Notification.objects.all()
    if p.get("type") == "staff":
        scoped_qs = scoped_qs.filter(user_id=p.get("userId"))
    else:
        scoped_qs = scoped_qs.filter(customer_id=p.get("userId"))

    if request.method == "GET":
        qs = scoped_qs.order_by("-created_at")
        limit = max(1, min(_int(request.GET.get("limit", "100"), 100), 500))
        rows = list(qs[:limit])
        unread_count = scoped_qs.filter(is_read=False).count()
        return _ok({"success": True, "notifications": [_serialize_model(x) for x in rows], "unreadCount": unread_count})
    if request.method == "DELETE":
        deleted_count, _ = scoped_qs.delete()
        return _ok({"success": True, "deleted": deleted_count, "unreadCount": 0})
    body = _json_body(request)

    if body.get("markAll") is True:
        qs = scoped_qs.filter(is_read=False)
        updated_count = qs.count()
        qs.update(is_read=True, read_at=timezone.now())
        return _ok({"success": True, "updated": updated_count, "unreadCount": 0})

    ids = body.get("ids") or []
    if not isinstance(ids, list) or not ids:
        return _err("ids is required")
    qs = scoped_qs.filter(id__in=ids)
    qs.update(is_read=True, read_at=timezone.now())
    unread_count = scoped_qs.filter(is_read=False).count()
    return _ok({"success": True, "updated": qs.count(), "unreadCount": unread_count})


@csrf_exempt
@require_http_methods(["GET", "POST", "DELETE"])
def push_subscriptions_collection(request: HttpRequest) -> JsonResponse:
    """Register or remove the current account's browser Web Push endpoint."""
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)

    if request.method == "GET":
        return _ok({
            "success": True,
            "enabled": web_push_is_configured(),
            "publicKey": get_web_push_public_key() if web_push_is_configured() else "",
            "nativeEnabled": native_push_is_configured(),
        })

    body = _json_body(request)
    # The Capacitor apps register an FCM token instead of a Web Push endpoint; it is
    # stored in the same table so one account reaches every device it owns.
    native_platform = str(body.get("platform") or "").strip().lower()
    native_token = str(body.get("token") or "").strip()
    is_native_device = native_platform in {"android", "ios"} and bool(native_token)
    endpoint = f"fcm:{native_token}" if is_native_device else str(body.get("endpoint") or "").strip()
    if not endpoint:
        return _err("endpoint is required")

    owner_filter = (
        {"user_id": p.get("userId"), "customer_id": None}
        if p.get("type") == "staff"
        else {"customer_id": p.get("userId"), "user_id": None}
    )
    if request.method == "DELETE":
        deleted, _ = PushSubscription.objects.filter(endpoint=endpoint, **owner_filter).delete()
        return _ok({"success": True, "deleted": deleted})

    if is_native_device:
        if not native_push_is_configured():
            return _err("Native push is not configured", 503)
        # Fix: an endpoint identifies one physical browser/app installation. Move it
        # to the currently authenticated account so notifications cannot leak to a
        # previous account that used the same device.
        with transaction.atomic():
            PushSubscription.objects.filter(endpoint=endpoint).exclude(**owner_filter).delete()
            # A device token carries no encryption keys: FCM handles that itself.
            subscription, created = PushSubscription.objects.update_or_create(
                endpoint=endpoint,
                **owner_filter,
                defaults={
                    "p256dh": "",
                    "auth": "",
                    "user_agent": f"{native_platform} app"[:1000],
                    "is_active": True,
                },
            )
        return _ok(
            {"success": True, "created": created, "subscriptionId": subscription.id, "transport": "fcm"},
            201 if created else 200,
        )

    if not web_push_is_configured():
        return _err("Web Push is not configured", 503)
    keys = body.get("keys") if isinstance(body.get("keys"), dict) else {}
    p256dh = str(keys.get("p256dh") or "").strip()
    auth_key = str(keys.get("auth") or "").strip()
    if not p256dh or not auth_key:
        return _err("subscription keys are required")

    # Fix: a Web Push subscription is unique to this browser profile, not to the
    # signed-in account. Transfer it when another account registers on the device.
    with transaction.atomic():
        PushSubscription.objects.filter(endpoint=endpoint).exclude(**owner_filter).delete()
        subscription, created = PushSubscription.objects.update_or_create(
            endpoint=endpoint,
            **owner_filter,
            defaults={
                "p256dh": p256dh,
                "auth": auth_key,
                "user_agent": str(request.headers.get("User-Agent") or "")[:1000] or None,
                "is_active": True,
            },
        )
    return _ok({"success": True, "created": created, "subscriptionId": subscription.id}, 201 if created else 200)
