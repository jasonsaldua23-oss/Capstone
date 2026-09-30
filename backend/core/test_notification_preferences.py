"""Account choices must control new records and queued push, independently per category."""
import json
from unittest.mock import patch

from django.test import TestCase

from .auth import create_token
from .models import Customer, Notification, PushSubscription, User
from .notification_services import _create_customer_notification, _create_user_notification
from .push_notifications import queue_web_push


class NotificationPreferenceTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(email="prefs-customer@example.com", password="hashed", name="Customer")
        self.driver = User.objects.create(email="prefs-driver@example.com", password="hashed", name="Driver", role="DRIVER")
        self.other = Customer.objects.create(email="prefs-other@example.com", password="hashed", name="Other")
        self.url = "/api/notifications/preferences"

    def headers(self, account):
        token = create_token({"userId": account.id, "type": "customer" if isinstance(account, Customer) else "staff", "role": getattr(account, "role", "CUSTOMER")})
        return {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    def save(self, account, changes):
        return self.client.patch(self.url, json.dumps(changes), content_type="application/json", **self.headers(account))

    def emit(self, account, kind):
        arguments = {"title": "Preference test", "message": "Test message", "notification_type": kind}
        if isinstance(account, Customer):
            _create_customer_notification(customer=account, **arguments)
        else:
            _create_user_notification(user=account, **arguments)

    @patch("core.notification_services.queue_web_push")
    def test_each_customer_and_driver_switch_off_and_on_controls_records_and_push(self, push):
        for account, setting, kind, other_kind in [
            (self.customer, "orderUpdates", "ORDER", "DELIVERY"),
            (self.customer, "deliveryUpdates", "DELIVERY", "ORDER"),
            (self.driver, "tripNotifications", "TRIP", "DELIVERY"),
            (self.driver, "deliveryUpdates", "DELIVERY", "TRIP"),
        ]:
            with self.subTest(setting=setting, account=account.id):
                self.assertEqual(self.save(account, {setting: False}).status_code, 200)
                # Reusing the old account instance must not bypass a newly saved preference.
                before = Notification.objects.count()
                push.reset_mock()
                self.emit(account, kind)
                self.assertEqual(Notification.objects.count(), before)
                push.assert_not_called()
                self.emit(account, other_kind)
                self.assertEqual(Notification.objects.count(), before + 1)
                self.assertEqual(self.client.get(self.url, **self.headers(account)).json()["preferences"][setting], False)
                self.assertEqual(self.save(account, {setting: True}).status_code, 200)
                push.reset_mock()
                self.emit(account, kind)
                self.assertEqual(Notification.objects.count(), before + 2)
                push.assert_called_once()

    def test_defaults_partial_updates_and_account_isolation(self):
        self.assertEqual(self.client.get(self.url, **self.headers(self.customer)).json()["preferences"], {"orderUpdates": True, "deliveryUpdates": True})
        self.save(self.customer, {"orderUpdates": False})
        self.save(self.customer, {"deliveryUpdates": False})
        self.assertEqual(self.client.get(self.url, **self.headers(self.customer)).json()["preferences"], {"orderUpdates": False, "deliveryUpdates": False})
        self.assertEqual(self.client.get(self.url, **self.headers(self.other)).json()["preferences"], {"orderUpdates": True, "deliveryUpdates": True})
        self.assertEqual(self.client.get(self.url, **self.headers(self.driver)).json()["preferences"], {"tripNotifications": True, "deliveryUpdates": True})

    def test_unauthenticated_and_invalid_changes_are_rejected(self):
        self.assertEqual(self.client.get(self.url).status_code, 401)
        for changes in [{"orderUpdates": "false"}, {"tripNotifications": False}, {"systemAlerts": False}, {"customerId": self.other.id}, {}, []]:
            self.assertEqual(self.save(self.customer, changes).status_code, 400)
        self.assertEqual(self.save(self.driver, {"orderUpdates": False}).status_code, 400)

    @patch("core.notification_services.queue_web_push")
    def test_turning_off_preserves_history_and_other_accounts(self, push):
        self.emit(self.customer, "ORDER")
        self.save(self.customer, {"orderUpdates": False})
        self.emit(self.other, "ORDER")
        self.emit(self.customer, "REPLACEMENT")
        self.assertEqual(Notification.objects.filter(customer=self.customer).count(), 1)
        self.assertEqual(Notification.objects.filter(customer=self.other).count(), 1)
        self.assertEqual(self.client.get("/api/notifications", **self.headers(self.customer)).json()["unreadCount"], 1)

    @patch("core.push_notifications.web_push_is_configured", return_value=True)
    @patch("core.push_notifications._send_to_subscriptions")
    @patch("core.push_notifications._start_web_push_delivery", side_effect=lambda deliver: deliver())
    def test_queued_browser_and_native_push_recheck_latest_preferences(self, start, send, configured):
        for endpoint in ["https://push.example.test/device", "fcm:test-device"]:
            PushSubscription.objects.create(customer=self.customer, endpoint=endpoint, p256dh="test", auth="test")
        with self.captureOnCommitCallbacks(execute=True):
            queue_web_push(customer_ids=[self.customer.id], title="Test", message="Test", notification_type="ORDER")
            self.save(self.customer, {"orderUpdates": False})
        self.assertEqual(list(send.call_args.args[0]), [])
        self.save(self.customer, {"orderUpdates": True})
        with self.captureOnCommitCallbacks(execute=True):
            queue_web_push(customer_ids=[self.customer.id], title="Test", message="Test", notification_type="ORDER")
        self.assertEqual(len(send.call_args.args[0]), 2)
