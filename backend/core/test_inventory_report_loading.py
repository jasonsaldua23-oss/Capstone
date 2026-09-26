"""Inventory report reads must stay accurate without one stock-in query per row."""

import json
from datetime import timedelta
from unittest.mock import patch

from django.db import connection
from django.test import RequestFactory, TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from .models import Inventory, InventoryTransaction, Product, StockBatch, Warehouse
from .views_inventory import inventory_collection
from .views_stock import stock_batches_collection


class InventoryReportLoadingTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.warehouse = Warehouse.objects.create(
            name="Report Warehouse", code="WH-REPORT", address="Main Street",
            city="Talisay", province="Negros Occidental", zip_code="6115", capacity=10000,
        )

    def make_inventory(self, index, *, quantity=100, reserved=0, threshold=5, stockin=100):
        product = Product.objects.create(
            name=f"Report Beverage {index}", sku=f"REPORT-{index}", price=10, quantity_per_unit=24,
        )
        inventory = Inventory.objects.create(
            warehouse=self.warehouse, product=product, quantity=quantity,
            reserved_quantity=reserved, threshold=threshold,
        )
        StockBatch.objects.create(
            inventory=inventory, batch_number=f"REPORT-BATCH-{index}", quantity=quantity,
            receipt_date=timezone.now(), expiry_date=timezone.now() + timedelta(days=30),
        )
        if stockin is not None:
            InventoryTransaction.objects.create(
                warehouse=self.warehouse, product=product, type="IN", quantity=stockin,
                reference_type="stock_batch",
            )
        return inventory

    def read_inventory(self, page_size):
        request = self.factory.get("/api/inventory", {"pageSize": page_size})
        with patch("core.views_inventory._require_staff", return_value=({"role": "ADMIN"}, None)):
            with CaptureQueriesContext(connection) as captured:
                response = inventory_collection(request)
        self.assertEqual(response.status_code, 200)
        return json.loads(response.content), len(captured)

    def test_more_report_rows_do_not_add_stock_in_database_round_trips(self):
        for index in range(8):
            self.make_inventory(index)
        one_row, one_count = self.read_inventory(1)
        all_rows, all_count = self.read_inventory(8)
        self.assertEqual(one_row["total"], 8)
        self.assertEqual(len(all_rows["inventory"]), 8)
        self.assertTrue(all(row["overstockedFlag"] for row in all_rows["inventory"]))
        self.assertEqual(all_count, one_count, "Loading more inventory rows must not add individual stock-in queries")

    def test_batched_stock_in_lookup_preserves_latest_movement_and_available_stock(self):
        overstocked = self.make_inventory("overstocked")
        reserved = self.make_inventory("reserved", reserved=60)
        latest_small = self.make_inventory("latest-small")
        no_stockin = self.make_inventory("no-stockin", stockin=None)
        no_threshold = self.make_inventory("no-threshold", threshold=0)
        InventoryTransaction.objects.create(
            warehouse=self.warehouse, product=latest_small.product, type="IN", quantity=1,
            reference_type="stock_batch",
        )
        # Unrelated returns and stock-outs do not replace the latest batch stock-in.
        InventoryTransaction.objects.create(
            warehouse=self.warehouse, product=overstocked.product, type="OUT", quantity=1,
            reference_type="stock_batch",
        )
        payload, _ = self.read_inventory(100)
        rows = {row["id"]: row for row in payload["inventory"]}
        self.assertTrue(rows[overstocked.id]["overstockedFlag"])
        for inventory in (reserved, latest_small, no_stockin, no_threshold):
            self.assertFalse(rows[inventory.id]["overstockedFlag"])
        self.assertEqual(rows[overstocked.id]["sellableCases"], 100)
        self.assertEqual(rows[overstocked.id]["sellableBaseUnits"], 2400)
        self.assertEqual(rows[reserved.id]["sellableCases"], 40)

    def test_warehouse_batch_filter_applies_before_pagination_and_keeps_staff_scope(self):
        inventory = self.make_inventory("scoped")
        other = Warehouse.objects.create(name="Other", code="WH-OTHER", address="Other Street",
                                         city="Talisay", province="Negros Occidental", zip_code="6115")
        other_inventory = Inventory.objects.create(warehouse=other, product=inventory.product, quantity=1)
        StockBatch.objects.create(inventory=other_inventory, batch_number="OTHER-BATCH", quantity=1,
                                  receipt_date=timezone.now(), expiry_date=timezone.now() + timedelta(days=30))
        request = self.factory.get("/api/stock-batches", {"warehouseId": self.warehouse.id, "pageSize": 1})
        with patch("core.views_stock._require_staff", return_value=({"role": "ADMIN"}, None)):
            response = stock_batches_collection(request)
        payload = json.loads(response.content)
        self.assertEqual(payload["total"], 1)
        self.assertEqual(payload["stockBatches"][0]["inventory"]["warehouse"]["id"], self.warehouse.id)
        with patch("core.views_stock._require_staff", return_value=({"role": "WAREHOUSE_STAFF", "userId": "staff"}, None)), \
             patch("core.views_stock._get_allowed_warehouse_ids_for_staff", return_value={other.id}):
            self.assertEqual(stock_batches_collection(request).status_code, 403)
