import base64
import json
import logging
from collections.abc import Iterable
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from django.conf import settings
from django.db import transaction
from py_vapid import Vapid02
from pywebpush import WebPushException, webpush

from .models import PushSubscription


logger = logging.getLogger(__name__)


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
    return bool(
        settings.WEB_PUSH_VAPID_PRIVATE_KEY
        and get_web_push_public_key()
        and settings.WEB_PUSH_VAPID_SUBJECT
    )


def _send_to_subscriptions(subscriptions: Iterable[PushSubscription], payload: dict) -> None:
    if not web_push_is_configured():
        return

    encoded_payload = json.dumps(payload)
    for subscription in subscriptions:
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
    if not web_push_is_configured() or (not normalized_user_ids and not normalized_customer_ids):
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

    transaction.on_commit(deliver)
