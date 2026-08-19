from types import SimpleNamespace

from django.test import SimpleTestCase

from .models import OrderItemType, Product
from .views_api import _build_discount_breakdown_for_customer, _count_discount_eligible_cases


class OrderDiscountThresholdTests(SimpleTestCase):
    def setUp(self) -> None:
        self.customer = SimpleNamespace(
            discount_option="DISCOUNT_10",
            discount_status="ACTIVE",
            discount_percent=10,
            discount_applied_by_name="Admin",
        )

    def test_forty_nine_cases_does_not_receive_discount(self) -> None:
        breakdown = _build_discount_breakdown_for_customer(
            customer=self.customer,
            subtotal=4900,
            total_cases=49,
        )

        self.assertEqual(breakdown["totalDiscount"], 0)
        self.assertEqual(breakdown["type"], "NO_DISCOUNT")
        self.assertEqual(breakdown["casesAffected"], 0)

    def test_exactly_fifty_cases_receives_discount(self) -> None:
        breakdown = _build_discount_breakdown_for_customer(
            customer=self.customer,
            subtotal=5000,
            total_cases=50,
        )

        self.assertEqual(breakdown["totalDiscount"], 500)
        self.assertEqual(breakdown["percent"], 10)
        self.assertEqual(breakdown["casesAffected"], 50)

    def test_bottles_do_not_count_as_cases(self) -> None:
        total_cases = _count_discount_eligible_cases([
            {
                "itemType": OrderItemType.STANDARD_CASE,
                "product": Product(unit="case"),
                "quantity": 50,
            },
            {
                "itemType": OrderItemType.STANDARD_CASE,
                "product": Product(unit="bottle"),
                "quantity": 100,
            },
            {
                "itemType": OrderItemType.STANDARD_CASE,
                "product": Product(unit="pack(bundle)"),
                "quantity": 10,
            },
            {
                "itemType": OrderItemType.MIXED_CASE,
                "quantity": 1,
            },
        ])

        # The 10 packs count, while the 100 individual bottles do not.
        self.assertEqual(total_cases, 61)
