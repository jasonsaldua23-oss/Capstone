"""In-app notification fan-out for staff, customers and individual users."""

from collections.abc import Iterable

from . import views_api as legacy
from .models import Customer, Notification, RoleType, User


# Resolved through views_api so tests and runtime overrides that rebind
# these names on views_api keep applying here.


def queue_web_push(*, user_ids: Iterable[str]=(), customer_ids: Iterable[str]=(), title: str, message: str, notification_type: str, reference_type: str | None=None, reference_id: str | None=None) -> None:
    return legacy.queue_web_push(user_ids=user_ids, customer_ids=customer_ids, title=title, message=message, notification_type=notification_type, reference_type=reference_type, reference_id=reference_id)


def _create_staff_notifications(
    *,
    title: str,
    message: str,
    notification_type: str = "INVENTORY",
    reference_type: str | None = None,
    reference_id: str | None = None,
) -> None:
    _notify_staff_roles(
        roles=[RoleType.ADMIN, RoleType.WAREHOUSE_STAFF],
        title=title,
        message=message,
        notification_type=notification_type,
        reference_type=reference_type,
        reference_id=reference_id,
    )


def _create_admin_notifications(
    *,
    title: str,
    message: str,
    notification_type: str,
    reference_type: str | None = None,
    reference_id: str | None = None,
) -> None:
    """Notify administrators only, for events only an administrator can act on."""
    # Added: client registration review is ADMIN-only, so warehouse
    # staff would get an alert they have no way to resolve.
    _notify_staff_roles(
        roles=[RoleType.ADMIN],
        title=title,
        message=message,
        notification_type=notification_type,
        reference_type=reference_type,
        reference_id=reference_id,
    )


def _notify_staff_roles(
    *,
    roles: list[str],
    title: str,
    message: str,
    notification_type: str,
    reference_type: str | None,
    reference_id: str | None,
) -> None:
    recipients = list(User.objects.filter(role__in=roles, is_active=True).only("id"))
    if not recipients:
        return

    Notification.objects.bulk_create(
        [
            Notification(
                user=user,
                title=title,
                message=message,
                type=notification_type,
                reference_type=reference_type,
                reference_id=reference_id,
                is_read=False,
            )
            for user in recipients
        ]
    )
    # Added: mirror the existing in-app event to registered staff devices.
    queue_web_push(
        user_ids=[user.id for user in recipients],
        title=title,
        message=message,
        notification_type=notification_type,
        reference_type=reference_type,
        reference_id=reference_id,
    )


def _create_customer_notification(
    *,
    customer: Customer | None,
    title: str,
    message: str,
    notification_type: str = "REPLACEMENT",
    reference_type: str | None = None,
    reference_id: str | None = None,
) -> None:
    if not customer:
        return
    Notification.objects.create(
        customer=customer,
        title=title,
        message=message,
        type=notification_type,
        reference_type=reference_type,
        reference_id=reference_id,
        is_read=False,
    )
    # Added: customer status events now reach the device while the portal is closed.
    queue_web_push(
        customer_ids=[customer.id],
        title=title,
        message=message,
        notification_type=notification_type,
        reference_type=reference_type,
        reference_id=reference_id,
    )


def _create_user_notification(
    *,
    user: User | None,
    title: str,
    message: str,
    notification_type: str,
    reference_type: str | None = None,
    reference_id: str | None = None,
) -> None:
    """Create a notification for one staff user, such as an assigned driver."""
    if not user:
        return
    Notification.objects.create(
        user=user,
        title=title,
        message=message,
        type=notification_type,
        reference_type=reference_type,
        reference_id=reference_id,
        is_read=False,
    )
    # Added: direct staff events include driver trip assignments.
    queue_web_push(
        user_ids=[user.id],
        title=title,
        message=message,
        notification_type=notification_type,
        reference_type=reference_type,
        reference_id=reference_id,
    )
