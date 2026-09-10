from datetime import timedelta
import json
from unittest.mock import patch
from django.test import TestCase, RequestFactory
from django.utils import timezone
from .models import Inventory, InventoryReservation, InventoryTransaction, Order, OrderItem, Product, StockBatch, Warehouse
from .views_api import resolve_expired_stock, _allocate_inventory_for_order_item, _reserve_inventory_for_order_item, inventory_collection
from .mixed_case import available_base_units


class ExpiredStockTests(TestCase):
    def setUp(self):
        self.warehouse = Warehouse.objects.create(name="Expiry Warehouse", code="EXPIRY", address="Test", city="Test", province="Test", zip_code="1000")
        self.product = Product.objects.create(sku="EXPIRY", name="Expiry Product", quantity_per_unit=24)
        self.inventory = Inventory.objects.create(warehouse=self.warehouse, product=self.product, quantity=10, loose_bottles=3)
        self.batch = StockBatch.objects.create(inventory=self.inventory, batch_number="EXPIRED", quantity=4, loose_units=3, receipt_date=timezone.now()-timedelta(days=30), expiry_date=timezone.now()-timedelta(seconds=1))
        self.fresh = StockBatch.objects.create(inventory=self.inventory, batch_number="FRESH", quantity=6, receipt_date=timezone.now(), expiry_date=timezone.now()+timedelta(days=30))
        self.order = Order.objects.create(order_number="EXPIRY-ORDER", warehouse_id=self.warehouse.id, subtotal=0, total_amount=0)
        self.item = OrderItem.objects.create(order=self.order, product=self.product, quantity=2, unit_price=0, total_price=0)

    def submit(self, **changes):
        body = dict(batchId=self.batch.id, quantity=2, action="DISPOSAL", unit="CASE", reason="Confirmed physical disposal", requestId="expiry-request")
        body.update(changes)
        request = RequestFactory().post("/api/stock-batches/expired-stock", data=json.dumps(body), content_type="application/json")
        with patch("core.views_api._require_warehouse_operator", return_value=({"userId":"staff", "name":"Staff"}, None)), patch("core.views_api._get_allowed_warehouse_ids_for_staff", return_value=[self.warehouse.id]):
            return resolve_expired_stock(request)

    def test_partial_disposal_is_idempotent_and_audited(self):
        self.assertEqual(self.submit().status_code, 201)
        self.assertEqual(self.submit().status_code, 200)
        self.batch.refresh_from_db(); self.inventory.refresh_from_db()
        self.assertEqual((self.batch.quantity, self.inventory.quantity), (2, 8))
        movement = InventoryTransaction.objects.get(reference_type="expired_stock")
        self.assertEqual((movement.previous_stock, movement.updated_stock, movement.performed_by), (10, 8, "Staff"))
        self.assertIn(self.batch.id, movement.notes)
        self.assertEqual(self.submit(quantity=1).status_code, 409)

    def test_supplier_return_and_loose_disposal_preserve_batch(self):
        self.assertEqual(self.submit(action="SUPPLIER_RETURN", quantity=4).status_code, 201)
        self.assertEqual(self.submit(unit="BASE_UNIT", quantity=3, requestId="loose").status_code, 201)
        self.batch.refresh_from_db(); self.inventory.refresh_from_db()
        self.assertEqual((self.batch.quantity, self.batch.loose_units, self.batch.status), (0, 0, "DEPLETED"))
        self.assertEqual((self.inventory.quantity, self.inventory.loose_bottles), (6, 0))
        self.assertEqual(available_base_units(self.inventory), 144)

    def test_invalid_and_nonexpired_removals_leave_stock_unchanged(self):
        for changes in [dict(quantity=5), dict(quantity=0), dict(quantity=-1), dict(quantity=1.5), dict(reason=""), dict(batchId=self.fresh.id)]:
            self.assertEqual(self.submit(**changes).status_code, 400)
        self.inventory.refresh_from_db()
        self.assertEqual(self.inventory.quantity, 10)
        self.assertFalse(InventoryTransaction.objects.exists())

    def test_reserved_expired_stock_cannot_be_removed(self):
        InventoryReservation.objects.create(inventory=self.inventory, order_item=self.item, product=self.product, stock_batch=self.batch, quantity_base_units=24)
        self.assertEqual(self.submit().status_code, 400)
        self.assertFalse(InventoryTransaction.objects.exists())

    def test_unassigned_warehouse_cannot_remove_stock(self):
        other = Warehouse.objects.create(name="Other", code="OTHER", address="Test", city="Test", province="Test", zip_code="1000")
        self.inventory.warehouse = other; self.inventory.save()
        self.assertEqual(self.submit().status_code, 403)

    def test_legacy_delivery_uses_only_fresh_stock(self):
        rows = _allocate_inventory_for_order_item(product=self.product, requested_qty=2, order=self.order, order_item=self.item, warehouse_id=self.warehouse.id, allocation_policy="FEFO", performed_by="staff")
        self.assertEqual(rows[0]["batchNumber"], "FRESH")
        self.batch.refresh_from_db()
        self.assertEqual(self.batch.quantity, 4)

    def test_legacy_reservation_cannot_use_expired_cases(self):
        with self.assertRaises(ValueError):
            _reserve_inventory_for_order_item(product=self.product, requested_qty=7, order=self.order, order_item=self.item, warehouse_id=self.warehouse.id, allocation_policy="FEFO", performed_by="staff")
        self.inventory.refresh_from_db()
        self.assertEqual(self.inventory.reserved_quantity, 0)

    def test_inventory_exposes_sellable_separately_from_physical(self):
        request = RequestFactory().get("/api/inventory")
        with patch("core.views_api._require_staff", return_value=({"role":"ADMIN", "userId":"staff"}, None)):
            response = inventory_collection(request)
        row = json.loads(response.content)["inventory"][0]
        self.assertEqual((row["quantity"], row["sellableCases"], row["sellableBaseUnits"]), (10, 6, 144))

    def test_catalog_availability_excludes_expired_stock(self):
        from .views_api import products_collection
        request = RequestFactory().get("/api/products")
        with patch("core.views_api._require_auth", return_value={"type":"customer", "userId":"customer"}):
            response = products_collection(request)
        row = json.loads(response.content)["products"][0]
        self.assertEqual((row["availableQuantity"], row["availableBaseUnits"]), (6, 144))

    def test_legacy_delivery_insufficient_fresh_stock_rolls_back(self):
        with self.assertRaises(ValueError):
            _allocate_inventory_for_order_item(product=self.product, requested_qty=7, order=self.order, order_item=self.item, warehouse_id=self.warehouse.id, allocation_policy="FEFO", performed_by="staff")
        self.fresh.refresh_from_db(); self.batch.refresh_from_db(); self.inventory.refresh_from_db()
        self.assertEqual((self.fresh.quantity, self.batch.quantity, self.inventory.quantity), (6, 4, 10))
        self.assertFalse(InventoryTransaction.objects.exists())
