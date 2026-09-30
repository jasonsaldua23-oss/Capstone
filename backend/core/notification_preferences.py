"""Shared account preferences for new in-app notifications and push deliveries."""
from .models import Customer


def preference_defaults(account):
    if isinstance(account, Customer):
        return {"orderUpdates": True, "deliveryUpdates": True}
    if account.role == "DRIVER":
        return {"tripNotifications": True, "deliveryUpdates": True}
    return {}


def preferences_for(account):
    saved = account.notification_preferences or {}
    return {key: saved.get(key) is not False for key in preference_defaults(account)}


def notification_allowed(account, notification_type):
    if account is None:
        return False
    # Read current preferences even when an event retained an older account instance.
    current = type(account).objects.filter(pk=account.pk).first()
    if current is None:
        return False
    key = {"ORDER": "orderUpdates", "REPLACEMENT": "orderUpdates",
           "TRIP": "tripNotifications", "DELIVERY": "deliveryUpdates"}.get(str(notification_type).upper())
    return preferences_for(current).get(key, True)
