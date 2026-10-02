"""Revenue and spend count goods sold, never container deposits or replacements."""

import json
from unittest.mock import patch

from django.test import RequestFactory, TestCase

from .models import Customer, Order, OrderStatus
from .views_dashboard import dashboard_stats
from .views_users import customers_collection


class SalesAmountRuleTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(name="Deposit Client", email="deposit-client@example.com")
        self.factory = RequestFactory()
        # 1,000 of goods less a 100 discount; the other 240 of the total is container deposit.
        Order.objects.create(
            order_number="SALE-DEPOSIT", customer=self.customer, status=OrderStatus.DELIVERED,
            subtotal=1000, discount=100, total_amount=1140,
        )
        # A replacement delivery carries the replaced goods' value but repays an earlier sale.
        Order.objects.create(
            order_number="RPL-2026-0001", customer=self.customer, status=OrderStatus.DELIVERED,
            subtotal=300, total_amount=300,
        )
        Order.objects.create(
            order_number="SALE-PENDING", customer=self.customer, status=OrderStatus.PENDING,
            subtotal=5000, total_amount=5000,
        )

    def get(self, view, path):
        staff = {"type": "staff", "role": "ADMIN"}
        with patch("core.views_users._require_auth", return_value=staff), \
                patch("core.views_dashboard._require_staff", return_value=(staff, None)):
            response = view(self.factory.get(path))
        self.assertEqual(response.status_code, 200, response.content)
        return json.loads(response.content)

    def test_client_spend_is_goods_after_discount(self):
        row = self.get(customers_collection, "/api/customers")["customers"][0]
        # Replacement deliveries still count as deliveries; they just are not spend.
        self.assertEqual(row["successfulDeliveries"], 2)
        self.assertEqual(row["successfulDeliverySpend"], 900)

    def test_dashboard_revenue_matches_the_report_rule(self):
        stats = self.get(dashboard_stats, "/api/dashboard/stats")["stats"]
        self.assertEqual(stats["totalRevenue"], 900)
        self.assertEqual(stats["revenueTotal"], 900)
