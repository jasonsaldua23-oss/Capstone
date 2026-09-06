import base64
import hmac
import json
import logging
import threading
from collections.abc import Iterable
from pathlib import Path

import requests

from cryptography.hazmat.primitives import serialization
from django.conf import settings
from django.db import close_old_connections, transaction
from py_vapid import Vapid02
from pywebpush import WebPushException, webpush

from .models import PushSubscription


logger = logging.getLogger(__name__)


def _start_web_push_delivery(deliver) -> None:
    """Run best-effort Web Push I/O without delaying the originating API response."""

    # Fix: push endpoints can take several seconds to time out, so delivery must not
    # keep an already-successful order or replacement request waiting for a response.
    def run_with_fresh_connection() -> None:
        # Fix: Gunicorn request threads must not leak their database connection into
        # this background thread; Django opens a thread-local connection on demand.
        close_old_connections()
        try:
            deliver()
        finally:
            close_old_connections()

    threading.Thread(
        target=run_with_fresh_connection,
        name="web-push-delivery",
        daemon=True,
    ).start()


def get_web_push_public_key() -> str:
    if settings.WEB_PUSH_VAPID_PUBLIC_KEY:
        return settings.WEB_PUSH_VAPID_PUBLIC_KEY
    private_key_path = Path(settings.WEB_PUSH_VAPID_PRIVATE_KEY)
    if not private_key_path.is_file():
        return ""

    vapid = Vapid02.from_file(str(private_key_path))
    public_key = vapid.public_key.public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    return base64.urlsafe_b64encode(public_key).rstrip(b"=").decode("ascii")


def web_push_is_configured() -> bool:
    private_key = str(settings.WEB_PUSH_VAPID_PRIVATE_KEY or "").strip()
    public_key = str(get_web_push_public_key() or "").strip().rstrip("=")
    subject = str(settings.WEB_PUSH_VAPID_SUBJECT or "").strip()
    if not private_key or not public_key or not subject:
        return False

    try:
        path = Path(private_key)
        vapid = Vapid02.from_file(str(path)) if path.is_file() else Vapid02.from_string(private_key)
        derived_public_key = base64.urlsafe_b64encode(
            vapid.public_key.public_bytes(
                serialization.Encoding.X962,
                serialization.PublicFormat.UncompressedPoint,
            )
        ).rstrip(b"=").decode("ascii")
    except Exception:
        logger.warning("The configured Web Push VAPID private key is invalid")
        return False

    # Fix: a mismatched public/private pair lets browsers subscribe but makes every
    # later delivery fail. Treat the transport as disabled before that can happen.
    return hmac.compare_digest(public_key, derived_public_key)


# Devices registered from the Capacitor apps are stored in the same table with an
# "fcm:" endpoint, because they belong to the same account and the same events.
NATIVE_ENDPOINT_PREFIX = "fcm:"
_FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
_fcm_warning_logged = False


def _fcm_service_account_info() -> dict | None:
    """Read the Firebase service account from a JSON blob or a file path."""
    raw = str(getattr(settings, "FCM_SERVICE_ACCOUNT_JSON", "") or "").strip()
    if raw:
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            logger.warning("FCM_SERVICE_ACCOUNT_JSON is not valid JSON; native push is disabled")
            return None

    path = str(getattr(settings, "FCM_SERVICE_ACCOUNT_FILE", "") or "").strip()
    if path and Path(path).is_file():
        try:
            parsed = json.loads(Path(path).read_text(encoding="utf-8"))
            return parsed if isinstance(parsed, dict) else None
        except (json.JSONDecodeError, OSError):
            logger.warning("FCM service account file could not be read; native push is disabled")
    return None


def native_push_is_configured() -> bool:
    info = _fcm_service_account_info() or {}
    if not all(str(info.get(field) or "").strip() for field in ("project_id", "client_email", "private_key")):
        return False
    try:
        _fcm_credentials(info)
    except Exception:
        # Fix: field presence alone is insufficient; an invalid PEM or incomplete
        # service-account document otherwise passes deploy checks and fails at send time.
        logger.warning("The configured FCM service account is invalid")
        return False
    return True


def _fcm_error_codes(response: requests.Response) -> set[str]:
    """Return structured FCM error codes without treating every 403/404 as stale."""
    try:
        error = response.json().get("error") or {}
    except (ValueError, AttributeError):
        return set()
    if not isinstance(error, dict):
        return set()

    codes = {str(error.get("status") or "").strip().upper()}
    for detail in error.get("details") or []:
        if isinstance(detail, dict):
            codes.add(str(detail.get("errorCode") or "").strip().upper())
    return {code for code in codes if code}


def _fcm_credentials(info: dict):
    from google.oauth2 import service_account

    return service_account.Credentials.from_service_account_info(info, scopes=[_FCM_SCOPE])


def _fcm_access_token(info: dict) -> str:
    from google.auth.transport.requests import Request as GoogleAuthRequest

    credentials = _fcm_credentials(info)
    credentials.refresh(GoogleAuthRequest())
    return str(credentials.token or "")


def _send_to_native_devices(subscriptions: list[PushSubscription], payload: dict) -> None:
    """Deliver to the Android and iOS apps through FCM HTTP v1."""
    global _fcm_warning_logged
    if not subscriptions:
        return

    info = _fcm_service_account_info()
    if not info:
        if not _fcm_warning_logged:
            _fcm_warning_logged = True
            logger.warning(
                "%s app device(s) are registered for push but FCM is not configured; "
                "set FCM_SERVICE_ACCOUNT_JSON or FCM_SERVICE_ACCOUNT_FILE to deliver to them",
                len(subscriptions),
            )
        return

    project_id = str(getattr(settings, "FCM_PROJECT_ID", "") or info.get("project_id") or "").strip()
    if not project_id:
        logger.warning("FCM project id is missing; native push is disabled")
        return

    try:
        token = _fcm_access_token(info)
    except Exception:
        logger.exception("Could not obtain an FCM access token")
        return

    data = payload.get("data") or {}
    url = f"https://fcm.googleapis.com/v1/projects/{project_id}/messages:send"
    for subscription in subscriptions:
        device_token = subscription.endpoint[len(NATIVE_ENDPOINT_PREFIX):]
        if not device_token:
            continue
        try:
            response = requests.post(
                url,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={
                    "message": {
                        "token": device_token,
                        "notification": {
                            "title": payload.get("title") or "",
                            "body": payload.get("body") or "",
                        },
                        # Every value in an FCM data block has to be a string.
                        "data": {key: str(value) for key, value in data.items() if value is not None},
                    }
                },
                timeout=10,
            )
            error_codes = _fcm_error_codes(response)
            if "UNREGISTERED" in error_codes or "SENDER_ID_MISMATCH" in error_codes:
                # These token-specific errors are permanent. Generic 403/404 errors
                # can instead mean a project or IAM outage and must not erase devices.
                subscription.delete()
            elif response.status_code >= 400:
                logger.warning(
                    "FCM delivery failed for subscription %s: %s %s",
                    subscription.id,
                    response.status_code,
                    response.text[:200],
                )
        except Exception:
            logger.exception("Unexpected FCM delivery failure for subscription %s", subscription.id)


def _send_to_subscriptions(subscriptions: Iterable[PushSubscription], payload: dict) -> None:
    # One account can hold both kinds of device, and each takes a different transport.
    browser_subscriptions: list[PushSubscription] = []
    native_subscriptions: list[PushSubscription] = []
    for subscription in subscriptions:
        if str(subscription.endpoint or "").startswith(NATIVE_ENDPOINT_PREFIX):
            native_subscriptions.append(subscription)
        else:
            browser_subscriptions.append(subscription)

    _send_to_native_devices(native_subscriptions, payload)

    if not web_push_is_configured():
        return

    encoded_payload = json.dumps(payload)
    for subscription in browser_subscriptions:
        try:
            webpush(
                subscription_info={
                    "endpoint": subscription.endpoint,
                    "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
                },
                data=encoded_payload,
                vapid_private_key=settings.WEB_PUSH_VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.WEB_PUSH_VAPID_SUBJECT},
                timeout=5,
                ttl=60 * 60,
            )
        except WebPushException as exc:
            status_code = getattr(getattr(exc, "response", None), "status_code", None)
            if status_code in {404, 410}:
                # Fix: remove expired browser endpoints so later events do not retry them.
                subscription.delete()
            else:
                logger.warning("Web Push delivery failed for subscription %s: %s", subscription.id, exc)
        except Exception:
            # Push is best-effort and must never roll back the order or trip action.
            logger.exception("Unexpected Web Push delivery failure for subscription %s", subscription.id)


def queue_web_push(
    *,
    user_ids: Iterable[str] = (),
    customer_ids: Iterable[str] = (),
    title: str,
    message: str,
    notification_type: str,
    reference_type: str | None = None,
    reference_id: str | None = None,
) -> None:
    """Send after commit so a push never advertises rolled-back database state."""

    normalized_user_ids = {str(value).strip() for value in user_ids if str(value).strip()}
    normalized_customer_ids = {str(value).strip() for value in customer_ids if str(value).strip()}
    if not normalized_user_ids and not normalized_customer_ids:
        return
    # An account may be reachable through the apps even when Web Push is unconfigured.
    if not web_push_is_configured() and not native_push_is_configured():
        return

    payload = {
        "title": title,
        "body": message,
        "icon": "/ann-anns-logo.png",
        "badge": "/ann-anns-logo.png",
        "data": {
            "url": "/",
            "type": notification_type,
            "referenceType": reference_type,
            "referenceId": reference_id,
        },
    }

    def deliver() -> None:
        subscriptions = PushSubscription.objects.filter(is_active=True)
        if normalized_user_ids and normalized_customer_ids:
            from django.db.models import Q

            subscriptions = subscriptions.filter(
                Q(user_id__in=normalized_user_ids) | Q(customer_id__in=normalized_customer_ids)
            )
        elif normalized_user_ids:
            subscriptions = subscriptions.filter(user_id__in=normalized_user_ids)
        else:
            subscriptions = subscriptions.filter(customer_id__in=normalized_customer_ids)
        _send_to_subscriptions(subscriptions, payload)

    transaction.on_commit(lambda: _start_web_push_delivery(deliver))
