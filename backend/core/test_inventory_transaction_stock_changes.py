from datetime import timedelta
import json
from unittest.mock import patch

from django.test import TestCase, RequestFactory
from django.utils import timezone

from .models import Customer, Inventory, InventoryTransaction, Order, OrderItem, Product, StockBatch, Warehouse
from .views_api import (
    _allocate_inventory_for_order_item,
    _serialize_inventory_transactions_with_stock_changes,
    _mark_order_delivered,
    inventory_transactions_list,
    customer_order_cancel,
    _release_order_reservations,
    _serialize_order,
)
from .mixed_case import reserve_order_item, repack_batch_loose_stock, allocatable_standard_cases


class InventoryTransactionStockChangeTests(TestCase):
    def test_customer_po_cancellation_releases_stock_once_and_keeps_identity(self):
        inventory, order = self.make_delivery()
        customer = Customer.objects.create(email='cancellation@example.test', name='Cancellation Customer')
        order.customer = customer
        order.status = 'CONFIRMED'
        order.request_status = 'APPROVED'
        order.purchase_request_number = 'PR-CANCEL-TEST'
        order.purchase_order_number = 'PO-CANCEL-TEST'
        order.save()
        reserve_order_item(order.items.get(), 'FEFO', 'staff')
        request = RequestFactory().patch('/api/customer/orders/cancel',
            data=json.dumps({'reason': 'Customer cancellation'}), content_type='application/json')
        # Exercise the endpoint twice, as a retry after a lost network response would.
        with patch('core.views_api._require_auth', return_value={'type': 'customer', 'userId': customer.id}), patch('core.views_api._email_order_cancelled_to_customer'):
            self.assertEqual(customer_order_cancel(request, order.id).status_code, 200)
            self.assertEqual(customer_order_cancel(request, order.id).status_code, 200)
        inventory.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual((inventory.quantity, inventory.reserved_quantity, inventory.reserved_base_units), (20, 0, 0))
        self.assertEqual((order.status, order.request_status), ('CANCELLED', 'APPROVED'))
        self.assertEqual(order.purchase_order_number, 'PO-CANCEL-TEST')
        self.assertEqual(order.purchase_request_number, 'PR-CANCEL-TEST')
        self.assertEqual(InventoryTransaction.objects.filter(type='UNRESERVE').count(), 1)
        # Previously cancelled records also keep their persisted PO identity.
        order.request_status = 'CANCELLED'
        self.assertEqual(_serialize_order(order, include_items=False)['purchaseOrderNumber'], 'PO-CANCEL-TEST')

    def test_released_reservation_does_not_release_other_orders_stock(self):
        inventory, order = self.make_delivery()
        reserve_order_item(order.items.get(), 'FEFO', 'staff')
        _release_order_reservations(order, 'staff')
        inventory.refresh_from_db()
        # Another order's reservation must survive repeated release of this order.
        inventory.reserved_quantity = 3
        inventory.reserved_base_units = 72
        inventory.save(update_fields=['reserved_quantity', 'reserved_base_units'])
        _release_order_reservations(order, 'staff')
        inventory.refresh_from_db()
        self.assertEqual((inventory.reserved_quantity, inventory.reserved_base_units), (3, 72))

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

    def test_delivery_preserves_depleted_batch_with_reservation_history(self):
        from .models import InventoryReservation

        inventory, order = self.make_delivery()
        batch = StockBatch.objects.get(inventory=inventory)
        item = order.items.get()
        item.quantity = 20
        item.save(update_fields=["quantity"])
        # Released reservations still protect the batch when legacy delivery consumes it.
        reservation = InventoryReservation.objects.create(
            inventory=inventory, order_item=item, product=self.product,
            stock_batch=batch, quantity_base_units=1, status="RELEASED",
        )
        with patch("core.views_api._email_order_delivered_to_customer"):
            _mark_order_delivered(order, "staff")
        batch.refresh_from_db()
        inventory.refresh_from_db()
        reservation.refresh_from_db()
        self.assertEqual((batch.quantity, batch.status), (0, "DEPLETED"))
        self.assertEqual(inventory.quantity, 0)
        self.assertEqual(reservation.stock_batch_id, batch.id)
        self.assertEqual(InventoryTransaction.objects.get(type="OUT").quantity, 20)

    def test_zero_case_batch_keeps_remaining_loose_stock(self):
        from .views_api import _persist_stock_batch_quantity

        inventory, _ = self.make_delivery()
        batch = StockBatch.objects.get(inventory=inventory)
        batch.quantity = 0
        batch.loose_units = 3
        batch.save(update_fields=["quantity", "loose_units"])
        _persist_stock_batch_quantity(batch)
        batch.refresh_from_db()
        self.assertEqual((batch.quantity, batch.loose_units, batch.status), (0, 3, "ACTIVE"))

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
