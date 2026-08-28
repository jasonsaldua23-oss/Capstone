import json
from unittest.mock import Mock, patch

from django.test import RequestFactory, TestCase, override_settings

from .models import Customer, PushSubscription, RoleType, User
from .push_notifications import queue_web_push
from .views_api import push_subscriptions_collection


PUSH_SETTINGS = {
    "WEB_PUSH_VAPID_PRIVATE_KEY": "test-private-key",
    "WEB_PUSH_VAPID_PUBLIC_KEY": "test-public-key",
    "WEB_PUSH_VAPID_SUBJECT": "mailto:test@example.com",
}


@override_settings(**PUSH_SETTINGS)
class PushNotificationTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.user = User.objects.create(
            email="driver-push@example.com",
            password="hashed",
            name="Push Driver",
            role=RoleType.DRIVER,
        )
        self.customer = Customer.objects.create(
            email="customer-push@example.com",
            password="hashed",
            name="Push Customer",
        )

    def _register(self, payload, subscription):
        request = self.factory.post(
            "/api/push-subscriptions",
            data=json.dumps(subscription),
            content_type="application/json",
            HTTP_USER_AGENT="Test Browser",
        )
        with patch("core.views_api._require_auth", return_value=payload):
            return push_subscriptions_collection(request)

    def test_same_browser_endpoint_can_be_registered_for_separate_accounts(self):
        subscription = {
            "endpoint": "https://push.example.test/device-1",
            "keys": {"p256dh": "public-key", "auth": "auth-secret"},
        }

        staff_response = self._register(
            {"type": "staff", "userId": self.user.id},
            subscription,
        )
        customer_response = self._register(
            {"type": "customer", "userId": self.customer.id},
            subscription,
        )

        self.assertEqual(staff_response.status_code, 201)
        self.assertEqual(customer_response.status_code, 201)
        self.assertEqual(PushSubscription.objects.filter(endpoint=subscription["endpoint"]).count(), 2)

    @patch("core.push_notifications.webpush")
    def test_push_is_sent_after_commit_to_the_target_account(self, mocked_webpush):
        PushSubscription.objects.create(
            user=self.user,
            endpoint="https://push.example.test/device-2",
            p256dh="public-key",
            auth="auth-secret",
        )

        with self.captureOnCommitCallbacks(execute=True):
            queue_web_push(
                user_ids=[self.user.id],
                title="New trip assigned",
                message="You were assigned to trip TRP-2026-0001.",
                notification_type="TRIP",
                reference_type="trip",
                reference_id="trip-1",
            )

        mocked_webpush.assert_called_once()
        sent_payload = json.loads(mocked_webpush.call_args.kwargs["data"])
        self.assertEqual(sent_payload["title"], "New trip assigned")
        self.assertEqual(sent_payload["data"]["referenceId"], "trip-1")

    @patch("core.push_notifications.webpush")
    def test_expired_endpoint_is_removed(self, mocked_webpush):
        response = Mock(status_code=410)
        from pywebpush import WebPushException

        mocked_webpush.side_effect = WebPushException("Expired", response=response)
        subscription = PushSubscription.objects.create(
            customer=self.customer,
            endpoint="https://push.example.test/expired",
            p256dh="public-key",
            auth="auth-secret",
        )

        with self.captureOnCommitCallbacks(execute=True):
            queue_web_push(
                customer_ids=[self.customer.id],
                title="Order approved",
                message="Your order was approved.",
                notification_type="ORDER",
            )

        self.assertFalse(PushSubscription.objects.filter(id=subscription.id).exists())
