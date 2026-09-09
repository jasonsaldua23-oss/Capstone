from datetime import timedelta
import json
from unittest.mock import patch

from django.test import TestCase, RequestFactory
from django.utils import timezone

from .models import Inventory, InventoryTransaction, Order, OrderItem, Product, StockBatch, Warehouse
from .views_api import (
    _allocate_inventory_for_order_item,
    _serialize_inventory_transactions_with_stock_changes,
    _mark_order_delivered,
    inventory_transactions_list,
)
from .mixed_case import reserve_order_item, repack_batch_loose_stock, allocatable_standard_cases


class InventoryTransactionStockChangeTests(TestCase):
    def test_loose_conversion_uses_product_capacity_and_preserves_remainder(self):
        inventory, _ = self.make_delivery()
        batch = StockBatch.objects.get(inventory=inventory)
        for capacity, loose, cases, remainder in [(12, 11, 0, 11), (12, 12, 1, 0), (12, 26, 2, 2), (24, 26, 1, 2)]:
            with self.subTest(capacity=capacity, loose=loose):
                self.product.quantity_per_unit = capacity
                inventory.product = self.product
                inventory.quantity = batch.quantity = 3
                inventory.loose_bottles = batch.loose_units = loose
                self.assertEqual(repack_batch_loose_stock(inventory, batch), cases)
                self.assertEqual((inventory.quantity, inventory.loose_bottles), (3 + cases, remainder))
                self.assertEqual((batch.quantity, batch.loose_units), (3 + cases, remainder))
                self.assertEqual(inventory.quantity * capacity + inventory.loose_bottles, 3 * capacity + loose)
                self.assertEqual(repack_batch_loose_stock(inventory, batch), 0)

    def test_existing_loose_batch_can_be_sold_as_a_case(self):
        inventory, order = self.make_delivery()
        batch = StockBatch.objects.get(inventory=inventory)
        inventory.quantity = batch.quantity = 0
        inventory.loose_bottles = batch.loose_units = 26
        inventory.save(update_fields=["quantity", "loose_bottles"])
        batch.save(update_fields=["quantity", "loose_units"])
        item = order.items.get()
        item.quantity = 1
        item.save(update_fields=["quantity"])
        self.assertEqual(allocatable_standard_cases(inventory), 1)
        reserve_order_item(item, "FEFO", "staff")
        with patch("core.views_api._email_order_delivered_to_customer"):
            _mark_order_delivered(order, "staff")
        inventory.refresh_from_db()
        batch.refresh_from_db()
        self.assertEqual((inventory.quantity, inventory.loose_bottles), (0, 2))
        self.assertEqual((batch.quantity, batch.loose_units), (0, 2))

    def make_delivery(self):
        inventory = Inventory.objects.create(warehouse=self.warehouse, product=self.product, quantity=20, threshold=0)
        StockBatch.objects.create(batch_number="RETRY-BATCH", inventory=inventory, quantity=20, receipt_date=timezone.now(), expiry_date=timezone.now() + timedelta(days=30))
        order = Order.objects.create(order_number="RETRY-ORDER", warehouse_id=self.warehouse.id, subtotal=0, total_amount=0)
        OrderItem.objects.create(order=order, product=self.product, quantity=12, unit_price=0, total_price=0)
        return inventory, order

    def test_stale_delivery_retry_deducts_stock_once(self):
        # A delayed request or refreshed page can hold the pre-delivery status.
        inventory, order = self.make_delivery()
        stale_order = Order.objects.get(pk=order.pk)
        with patch("core.views_api._email_order_delivered_to_customer"):
            _mark_order_delivered(order, "staff")
            _mark_order_delivered(stale_order, "staff")
        inventory.refresh_from_db()
        self.assertEqual(inventory.quantity, 8)
        self.assertEqual(StockBatch.objects.get(inventory=inventory).quantity, 8)
        self.assertEqual(InventoryTransaction.objects.filter(type="OUT").count(), 1)

    def test_failed_delivery_rolls_back_before_retry(self):
        inventory, order = self.make_delivery()
        with patch("core.deposit_lifecycle.finalize_order_deposits_on_delivery", side_effect=ValueError("simulated failure")):
            with self.assertRaises(ValueError):
                _mark_order_delivered(order, "staff")
        inventory.refresh_from_db()
        self.assertEqual(inventory.quantity, 20)
        self.assertFalse(InventoryTransaction.objects.filter(type="OUT").exists())
        with patch("core.views_api._email_order_delivered_to_customer"):
            _mark_order_delivered(order, "staff")
        inventory.refresh_from_db()
        self.assertEqual(inventory.quantity, 8)
        self.assertEqual(InventoryTransaction.objects.filter(type="OUT").count(), 1)

    def test_multiple_batches_create_one_item_stock_out(self):
        inventory, order = self.make_delivery()
        first_batch = StockBatch.objects.get(inventory=inventory)
        first_batch.quantity = 5
        first_batch.save(update_fields=["quantity"])
        StockBatch.objects.create(batch_number="RETRY-BATCH-2", inventory=inventory, quantity=15, receipt_date=timezone.now(), expiry_date=timezone.now() + timedelta(days=60))
        with patch("core.views_api._email_order_delivered_to_customer"):
            _mark_order_delivered(order, "staff")
        movement = InventoryTransaction.objects.get(type="OUT")
        self.assertEqual((movement.quantity, movement.previous_stock, movement.updated_stock), (12, 20, 8))
        inventory.refresh_from_db()
        self.assertEqual(inventory.quantity, 8)

    def test_reserved_batches_create_one_item_movement_and_retry_is_safe(self):
        inventory, order = self.make_delivery()
        first_batch = StockBatch.objects.get(inventory=inventory)
        first_batch.quantity = 5
        first_batch.save(update_fields=["quantity"])
        StockBatch.objects.create(batch_number="RESERVED-BATCH-2", inventory=inventory, quantity=15, receipt_date=timezone.now(), expiry_date=timezone.now() + timedelta(days=60))
        reserve_order_item(order.items.get(), "FEFO", "staff")
        stale_order = Order.objects.get(pk=order.pk)
        with patch("core.views_api._email_order_delivered_to_customer"):
            _mark_order_delivered(order, "staff")
            _mark_order_delivered(stale_order, "staff")
        movement = InventoryTransaction.objects.get(type="OUT")
        self.assertEqual((movement.quantity, movement.previous_stock, movement.updated_stock), (12, 20, 8))
        inventory.refresh_from_db()
        self.assertEqual(inventory.quantity, 8)
        self.assertEqual(inventory.reserved_quantity, 0)

    def test_reservation_consumption_is_not_a_second_stock_out(self):
        for movement in ["OUT", "RESERVE_CONSUMED"]:
            InventoryTransaction.objects.create(warehouse=self.warehouse, product=self.product, type=movement, quantity=12)
        request = RequestFactory().get("/api/inventory-transactions")
        with patch("core.views_api._require_staff", return_value=({"role": "ADMIN", "userId": "staff"}, None)):
            response = inventory_transactions_list(request)
        payload = json.loads(response.content)
        self.assertEqual(payload["total"], 1)
        self.assertEqual(payload["transactions"][0]["type"], "OUT")

    def setUp(self) -> None:
        self.warehouse = Warehouse.objects.create(
            name="Transaction Warehouse",
            code="TX-STOCK-CHANGE",
            address="Test Address",
            city="Manila",
            province="Metro Manila",
            zip_code="1000",
        )
        self.product = Product.objects.create(
            sku="TX-PRODUCT",
            name="Transaction Product",
            category="Sport Drinks",
            quantity_per_unit=24,
        )

    def test_fefo_stock_out_records_before_and_after_stock(self) -> None:
        inventory = Inventory.objects.create(
            warehouse=self.warehouse,
            product=self.product,
            quantity=20,
            threshold=0,
        )
        StockBatch.objects.create(
            batch_number="TX-FEFO-BATCH",
            inventory=inventory,
            quantity=20,
            receipt_date=timezone.now(),
            expiry_date=timezone.now() + timedelta(days=30),
        )
        order = Order.objects.create(
            order_number="TX-FEFO-ORDER",
            warehouse_id=self.warehouse.id,
            subtotal=0,
            total_amount=0,
        )
        order_item = OrderItem.objects.create(
            order=order,
            product=self.product,
            quantity=12,
            unit_price=0,
            total_price=0,
        )

        _allocate_inventory_for_order_item(
            product=self.product,
            requested_qty=12,
            order=order,
            order_item=order_item,
            warehouse_id=self.warehouse.id,
            allocation_policy="FEFO",
            performed_by="Warehouse Staff",
        )

        stock_out = InventoryTransaction.objects.get(type="OUT", reference_id=order_item.id)
        self.assertEqual(stock_out.previous_stock, 20)
        self.assertEqual(stock_out.updated_stock, 8)
        self.assertEqual(stock_out.stock_unit_label, "Case")

    def test_legacy_transactions_receive_reconstructed_stock_changes(self) -> None:
        Inventory.objects.create(
            warehouse=self.warehouse,
            product=self.product,
            quantity=8,
            threshold=0,
        )
        stock_in = InventoryTransaction.objects.create(
            warehouse=self.warehouse,
            product=self.product,
            type="IN",
            quantity=20,
            reference_type="stock_batch",
        )
        stock_out = InventoryTransaction.objects.create(
            warehouse=self.warehouse,
            product=self.product,
            type="OUT",
            quantity=12,
            reference_type="order_item",
        )

        # Fix: old rows without stored snapshots still show a useful historical change.
        payload = _serialize_inventory_transactions_with_stock_changes([stock_out, stock_in])
        by_id = {row["id"]: row for row in payload}

        self.assertEqual(by_id[stock_out.id]["previousStock"], 20)
        self.assertEqual(by_id[stock_out.id]["updatedStock"], 8)
        self.assertEqual(by_id[stock_in.id]["previousStock"], 0)
        self.assertEqual(by_id[stock_in.id]["updatedStock"], 20)
