"""In-app notification and feedback rating API contracts."""

import json
from unittest.mock import patch

from django.test import Client, TestCase
from django.utils import timezone

from .auth import create_token
from .models import (
    Customer,
    Feedback,
    Notification,
    Order,
    OrderStatus,
    User,
)
from .test_support import Role, Driver



class NotificationsApiContractTests(TestCase):
    def test_all_panels_keep_unread_status_until_explicit_read(self):
        # Fix regression coverage: loading a limited feed must preserve the exact
        # unread total and read state for Client, Driver, Admin and Staff alike.
        customer = Customer.objects.create(email="notification.client@example.com", password="hashed", name="Client")
        for role in ["ADMIN", "WAREHOUSE_STAFF", "DRIVER", "CUSTOMER"]:
            with self.subTest(role=role):
                is_customer = role == "CUSTOMER"
                owner = {"customer": customer} if is_customer else {"user": self.primary_user}
                notifications = [Notification.objects.create(**owner, title=f"{role} alert", message="Unread alert", type="ORDER") for _ in range(12)]
                token = create_token({"type": "customer" if is_customer else "staff", "userId": customer.id if is_customer else self.primary_user.id, "role": role})
                headers = {"HTTP_AUTHORIZATION": f"Bearer {token}"}
                for _ in range(2):
                    response = self.client.get("/api/notifications?limit=1", **headers)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json()["unreadCount"], 12)
                    self.assertFalse(response.json()["notifications"][0]["isRead"])
                response = self.client.patch("/api/notifications", data=json.dumps({"ids": [notifications[0].id]}), content_type="application/json", **headers)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["unreadCount"], 11)
                Notification.objects.filter(pk__in=[item.id for item in notifications]).delete()

    def setUp(self) -> None:
        self.client = Client()
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")
        self.primary_user = User.objects.create(
            email="primary.admin@example.com",
            password="hashed",
            name="Primary Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.other_user = User.objects.create(
            email="other.admin@example.com",
            password="hashed",
            name="Other Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.primary_token = create_token(
            {
                "userId": self.primary_user.id,
                "email": self.primary_user.email,
                "name": self.primary_user.name,
                "role": self.admin_role.name,
                "type": "staff",
            }
        )

    def test_get_notifications_includes_unread_count_and_scopes_to_authenticated_user(self) -> None:
        Notification.objects.create(
            user=self.primary_user,
            title="Unread 1",
            message="Primary unread 1",
            type="order_update",
            is_read=False,
        )
        Notification.objects.create(
            user=self.primary_user,
            title="Unread 2",
            message="Primary unread 2",
            type="order_update",
            is_read=False,
        )
        Notification.objects.create(
            user=self.primary_user,
            title="Read 1",
            message="Primary read 1",
            type="order_update",
            is_read=True,
            read_at=timezone.now(),
        )
        Notification.objects.create(
            user=self.other_user,
            title="Other unread",
            message="Other unread",
            type="order_update",
            is_read=False,
        )

        response = self.client.get(
            "/api/notifications",
            HTTP_AUTHORIZATION=f"Bearer {self.primary_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["unreadCount"], 2)
        self.assertEqual(len(payload["notifications"]), 3)
        for item in payload["notifications"]:
            self.assertEqual(item["user"], self.primary_user.id)

    def test_patch_notifications_mark_all_marks_only_current_user_and_returns_unread_count(self) -> None:
        primary_unread_1 = Notification.objects.create(
            user=self.primary_user,
            title="Unread 1",
            message="Primary unread 1",
            type="order_update",
            is_read=False,
        )
        primary_unread_2 = Notification.objects.create(
            user=self.primary_user,
            title="Unread 2",
            message="Primary unread 2",
            type="order_update",
            is_read=False,
        )
        other_unread = Notification.objects.create(
            user=self.other_user,
            title="Other unread",
            message="Other unread",
            type="order_update",
            is_read=False,
        )

        response = self.client.patch(
            "/api/notifications",
            data='{"markAll": true}',
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.primary_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["updated"], 2)
        self.assertEqual(payload["unreadCount"], 0)

        primary_unread_1.refresh_from_db()
        primary_unread_2.refresh_from_db()
        other_unread.refresh_from_db()

        self.assertTrue(primary_unread_1.is_read)
        self.assertTrue(primary_unread_2.is_read)
        self.assertIsNotNone(primary_unread_1.read_at)
        self.assertIsNotNone(primary_unread_2.read_at)
        self.assertFalse(other_unread.is_read)

    def test_patch_notifications_by_ids_marks_selected_owned_records_only(self) -> None:
        target_1 = Notification.objects.create(
            user=self.primary_user,
            title="Target 1",
            message="Target 1",
            type="order_update",
            is_read=False,
        )
        target_2 = Notification.objects.create(
            user=self.primary_user,
            title="Target 2",
            message="Target 2",
            type="order_update",
            is_read=False,
        )
        untouched_same_user = Notification.objects.create(
            user=self.primary_user,
            title="Untouched",
            message="Untouched",
            type="order_update",
            is_read=False,
        )
        other_user_notification = Notification.objects.create(
            user=self.other_user,
            title="Other user",
            message="Other user",
            type="order_update",
            is_read=False,
        )

        response = self.client.patch(
            "/api/notifications",
            data=f'{{"ids": ["{target_1.id}", "{other_user_notification.id}", "{target_2.id}"]}}',
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.primary_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["updated"], 2)
        self.assertEqual(payload["unreadCount"], 1)

        target_1.refresh_from_db()
        target_2.refresh_from_db()
        untouched_same_user.refresh_from_db()
        other_user_notification.refresh_from_db()

        self.assertTrue(target_1.is_read)
        self.assertTrue(target_2.is_read)
        self.assertFalse(untouched_same_user.is_read)
        self.assertFalse(other_user_notification.is_read)

    def test_notifications_requires_authentication(self) -> None:
        response = self.client.get("/api/notifications")
        self.assertEqual(response.status_code, 401)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Unauthorized")

    def test_patch_notifications_requires_ids_when_mark_all_is_not_used(self) -> None:
        response = self.client.patch(
            "/api/notifications",
            data="{}",
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.primary_token}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "ids is required")

    def test_patch_notifications_mark_all_takes_precedence_over_ids(self) -> None:
        n1 = Notification.objects.create(
            user=self.primary_user,
            title="N1",
            message="N1",
            type="order_update",
            is_read=False,
        )
        n2 = Notification.objects.create(
            user=self.primary_user,
            title="N2",
            message="N2",
            type="order_update",
            is_read=False,
        )

        response = self.client.patch(
            "/api/notifications",
            data=f'{{"markAll": true, "ids": ["{n1.id}"]}}',
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.primary_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["updated"], 2)
        self.assertEqual(payload["unreadCount"], 0)

        n1.refresh_from_db()
        n2.refresh_from_db()
        self.assertTrue(n1.is_read)
        self.assertTrue(n2.is_read)


class FeedbackRatingContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.customer = Customer.objects.create(
            email="required.feedback.customer@example.com",
            password="hashed",
            name="Required Feedback Customer",
            is_active=True,
        )
        self.order = Order.objects.create(
            order_number="ORD-REQUIRED-FEEDBACK-001",
            customer=self.customer,
            status=OrderStatus.DELIVERED,
            subtotal=100,
            total_amount=100,
        )
        self.token = create_token(
            {
                "userId": self.customer.id,
                "email": self.customer.email,
                "name": self.customer.name,
                "role": "CUSTOMER",
                "type": "customer",
            }
        )

    def test_rating_requires_non_empty_feedback_message(self) -> None:
        response = self.client.post(
            "/api/feedback",
            data={
                "orderId": self.order.id,
                "rating": 5,
                "type": "COMPLIMENT",
                "subject": f"Order Review - {self.order.order_number}",
                "message": "   ",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "Feedback is required when submitting a rating")
        self.assertFalse(Feedback.objects.filter(order=self.order, customer=self.customer).exists())

class FeedbackDescribedReasonTests(TestCase):
    """A review described in the client's own words still satisfies the API contract."""

    def setUp(self) -> None:
        self.client = Client()
        self.customer = Customer.objects.create(
            email="described.feedback.customer@example.com",
            password="hashed",
            name="Described Feedback Customer",
            is_active=True,
        )
        self.order = Order.objects.create(
            order_number="ORD-DESCRIBED-FEEDBACK-001",
            customer=self.customer,
            status=OrderStatus.DELIVERED,
            subtotal=100,
            total_amount=100,
        )
        self.token = create_token(
            {
                "userId": self.customer.id,
                "email": self.customer.email,
                "name": self.customer.name,
                "role": "CUSTOMER",
                "type": "customer",
            }
        )

    def _submit(self, message):
        return self.client.post(
            "/api/feedback",
            data={
                "orderId": self.order.id,
                "rating": 1,
                "type": "COMPLAINT",
                "subject": f"Order Review - {self.order.order_number}",
                "message": message,
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

    def test_other_reason_is_stored_verbatim(self) -> None:
        # The "Other: " marker is what tells the admin analytics to classify the words
        # by keyword instead of looking them up in the checkbox catalog.
        response = self._submit("- Other: The driver shouted at my staff")

        self.assertEqual(response.status_code, 201, response.content.decode())
        saved = Feedback.objects.get(order=self.order, customer=self.customer)
        self.assertEqual(saved.message, "- Other: The driver shouted at my staff")

    def test_other_with_nothing_typed_is_rejected(self) -> None:
        # Both clients block this, but the composed message is empty either way.
        response = self._submit("   ")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "Feedback is required when submitting a rating")
        self.assertFalse(Feedback.objects.filter(order=self.order, customer=self.customer).exists())
