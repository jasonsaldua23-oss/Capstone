"""Customer discount validation contracts."""

from django.test import Client, TestCase

from .auth import create_token
from .models import Customer, User


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
