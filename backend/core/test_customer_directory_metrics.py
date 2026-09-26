"""Client directory aggregates must stay accurate without full order downloads."""

import json
from datetime import timedelta
from unittest.mock import patch

from django.db import connection
from django.test import RequestFactory, TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from .models import Customer, Feedback, Order, OrderStatus, SalesChannel
from .views_users import customers_collection


class CustomerDirectoryMetricsTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(name="Client Metrics", email="metrics@example.com")
        self.factory = RequestFactory()

    def directory(self, **params):
        request = self.factory.get("/api/customers", params)
        with patch("core.views_users._require_auth", return_value={"type": "staff", "role": "ADMIN"}):
            response = customers_collection(request)
        self.assertEqual(response.status_code, 200)
        return json.loads(response.content)

    def order(self, number, status, amount, **kwargs):
        return Order.objects.create(
            order_number=number, customer=self.customer, status=status,
            subtotal=amount, total_amount=amount, **kwargs,
        )

    def test_delivery_totals_and_ratings_exclude_unfulfilled_and_retail_orders(self):
        delivered = self.order("DIR-DELIVERED", OrderStatus.DELIVERED, 120)
        self.order("DIR-DELIVERED-OTHER", OrderStatus.DELIVERED, 80)
        pending = self.order("DIR-PENDING", OrderStatus.PENDING, 900)
        retail = self.order("DIR-RETAIL", OrderStatus.DELIVERED, 500, sales_channel=SalesChannel.RETAIL_POS)
        for order, rating in [(delivered, 5), (delivered, 3), (None, 4), (pending, 1), (retail, 1), (None, None), (None, 0)]:
            Feedback.objects.create(customer=self.customer, order=order, rating=rating)

        row = self.directory()["customers"][0]
        self.assertEqual(row["successfulDeliveries"], 2)
        self.assertEqual(row["successfulDeliverySpend"], 200)
        self.assertEqual(row["ratingCount"], 3)
        self.assertEqual(row["rating"], 4)

    def test_latest_order_and_unrated_client_are_preserved_across_pages(self):
        self.order("DIR-OLDER", OrderStatus.DELIVERED, 100, created_at=timezone.now() - timedelta(days=1))
        latest = self.order("DIR-LATEST", OrderStatus.PENDING, 150)
        other = Customer.objects.create(name="No Orders", email="no-orders@example.com")

        first = self.directory(page=1, pageSize=1)
        self.assertEqual(first["total"], 2)
        self.assertEqual(first["totalPages"], 2)
        self.assertEqual(first["customers"][0]["id"], other.id)
        self.assertEqual(first["customers"][0]["successfulDeliveries"], 0)
        self.assertEqual(first["customers"][0]["successfulDeliverySpend"], 0)
        self.assertEqual(first["customers"][0]["ratingCount"], 0)
        self.assertIsNone(first["customers"][0]["rating"])
        second = self.directory(page=2, pageSize=1)["customers"][0]
        self.assertEqual(second["lastOrderNumber"], latest.order_number)
        self.assertIsNotNone(second["lastOrderDate"])

    def test_rating_aggregates_include_feedback_beyond_old_page_limit(self):
        # The old client fetched only 1,000 feedback rows, silently truncating ratings.
        Feedback.objects.bulk_create([
            Feedback(customer=self.customer, rating=5) for _ in range(1000)
        ] + [Feedback(customer=self.customer, rating=1)])
        row = self.directory()["customers"][0]
        self.assertEqual(row["ratingCount"], 1001)
        self.assertAlmostEqual(row["rating"], 5001 / 1001)

    def test_directory_query_count_does_not_grow_per_client_or_feedback(self):
        with CaptureQueriesContext(connection) as initial_queries:
            self.directory(pageSize=500)
        for number in range(8):
            customer = Customer.objects.create(name=f"Metrics {number}", email=f"metrics-{number}@example.com")
            order = Order.objects.create(order_number=f"DIR-BATCH-{number}", customer=customer,
                                         status=OrderStatus.DELIVERED, subtotal=10, total_amount=10)
            Feedback.objects.create(customer=customer, order=order, rating=5)
        with CaptureQueriesContext(connection) as populated_queries:
            payload = self.directory(pageSize=500)
        self.assertEqual(len(payload["customers"]), 9)
        self.assertEqual(len(populated_queries), len(initial_queries))
        self.assertEqual(len(populated_queries), 5)
