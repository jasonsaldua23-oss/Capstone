from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from .models import Inventory, InventoryTransaction, Order, OrderItem, Product, StockBatch, Warehouse
from .views_api import (
    _allocate_inventory_for_order_item,
    _serialize_inventory_transactions_with_stock_changes,
)


class InventoryTransactionStockChangeTests(TestCase):
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
