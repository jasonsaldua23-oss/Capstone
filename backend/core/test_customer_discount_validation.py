"""Customer discount validation contracts."""

from django.test import Client, TestCase

from .auth import create_token
from .models import Customer, Notification, User


class CustomerDiscountValidationTests(TestCase):
    def setUp(self) -> None:
        self.admin = User.objects.create(
            name="Discount Admin",
            email="discount.admin@example.com",
            role="ADMIN",
            is_active=True,
        )
        self.customer = Customer.objects.create(
            name="Discount Customer",
            email="discount.customer@example.com",
        )
        token = create_token({
            "type": "staff",
            "userId": self.admin.id,
            "name": self.admin.name,
            "role": "ADMIN",
        })
        self.client = Client(HTTP_AUTHORIZATION=f"Bearer {token}")

    def _set_custom_discount(self, percent):
        return self.client.put(
            f"/api/customers/{self.customer.id}",
            {
                "discountOption": "OTHER",
                "discountStatus": "ACTIVE",
                "discountPercent": percent,
            },
            content_type="application/json",
        )

    def test_custom_discount_accepts_seventy_percent(self) -> None:
        response = self._set_custom_discount(70)

        self.assertEqual(response.status_code, 200, response.content.decode())
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.discount_percent, 70)

    def test_custom_discount_rejects_more_than_seventy_percent(self) -> None:
        response = self._set_custom_discount(70.01)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "Custom discount cannot exceed 70%")
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.discount_percent, 0)

    def test_custom_discount_rejects_non_numeric_percent(self) -> None:
        response = self._set_custom_discount("not-a-number")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "Custom discount percent must be a number")

    def _discount_notifications(self):
        return list(Notification.objects.filter(customer=self.customer, type="DISCOUNT").order_by("created_at", "id"))

    def _set_preset(self, option, status="ACTIVE"):
        return self.client.put(
            f"/api/customers/{self.customer.id}",
            {"discountOption": option, "discountStatus": status},
            content_type="application/json",
        )

    def test_customer_is_told_the_discount_and_how_to_qualify(self) -> None:
        self.assertEqual(self._set_preset("DISCOUNT_10").status_code, 200)
        [granted] = self._discount_notifications()
        self.assertEqual(granted.title, "You received a 10% discount")
        self.assertIn("at least 50 cases or packs", granted.message)
        self.assertIn("single bottles do not", granted.message)
        self.assertEqual((granted.reference_type, granted.reference_id), ("discount", self.customer.id))

        # Saving the same discount again (e.g. editing another field) is not news.
        self._set_preset("DISCOUNT_10")
        self.assertEqual(len(self._discount_notifications()), 1)

        self._set_custom_discount(12.5)
        self.assertEqual(self._discount_notifications()[-1].title, "Your discount is now 12.5%")

    def test_removed_or_cancelled_discounts_send_nothing(self) -> None:
        self._set_preset("DISCOUNT_15", status="CANCELLED")
        self._set_preset("NO_DISCOUNT", status="REMOVED")
        self.assertEqual(self._discount_notifications(), [])

    def test_customers_cannot_grant_themselves_a_discount_notification(self) -> None:
        token = create_token({"type": "customer", "userId": self.customer.id, "role": "CUSTOMER"})
        Client(HTTP_AUTHORIZATION=f"Bearer {token}").put(
            f"/api/customers/{self.customer.id}",
            {"discountOption": "DISCOUNT_25", "discountStatus": "ACTIVE"},
            content_type="application/json",
        )
        self.assertEqual(self._discount_notifications(), [])
