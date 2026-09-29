"""Overstock is judged by how long sellable stock lasts at recent sales, not by delivery size."""

import json
from datetime import timedelta

from django.test import Client, TestCase
from django.utils import timezone

from .auth import create_token, hash_password
from .inventory_overstock import (
    REASON_EXPIRY,
    REASON_NO_SALES,
    REASON_SLOW_SALES,
    _inventory_overstock_status,
)
from .models import Inventory, InventoryTransaction, Product, RoleType, StockBatch, User, Warehouse


class InventoryOverstockTests(TestCase):
    def setUp(self):
        self.now = timezone.now()
        self.staff = User.objects.create(
            email="overstock.staff@example.com",
            password=hash_password("Password1!"),
            name="Overstock Staff",
            role=RoleType.WAREHOUSE_STAFF,
            is_active=True,
        )
        self.warehouse = Warehouse.objects.create(
            name="Overstock Warehouse", code="WH-OVERSTOCK", address="Talisay City",
            city="Talisay", province="Negros Occidental", zip_code="6115",
            capacity=10000, manager_id=self.staff.id, is_active=True,
        )
        self.product = Product.objects.create(
            sku="OVERSTOCK-SKU", name="Overstock Cola", unit="case", price=100, quantity_per_unit=24,
        )
        # Selling here for months, so a full 30-day sales window applies.
        self.inventory = Inventory.objects.create(
            warehouse=self.warehouse, product=self.product, quantity=0, threshold=4,
            created_at=self.now - timedelta(days=90),
        )
        self.batch_count = 0

    def stock(self, cases, *, expires_in_days=365, received_days_ago=0):
        self.batch_count += 1
        batch = StockBatch.objects.create(
            batch_number=f"OVERSTOCK-{self.batch_count}", inventory=self.inventory, quantity=cases,
            receipt_date=self.now - timedelta(days=received_days_ago),
            expiry_date=self.now + timedelta(days=expires_in_days),
            created_at=self.now - timedelta(days=received_days_ago),
        )
        Inventory.objects.filter(id=self.inventory.id).update(quantity=self.inventory.quantity + cases)
        self.inventory.refresh_from_db()
        return batch

    def movement(self, quantity, *, reference_type="order_item", type="OUT", unit="CASE", days_ago=1):
        InventoryTransaction.objects.create(
            warehouse=self.warehouse, product=self.product, type=type, quantity=quantity,
            quantity_unit=unit, reference_type=reference_type,
            created_at=self.now - timedelta(days=days_ago),
        )

    def status(self):
        inventory = Inventory.objects.select_related("product").get(id=self.inventory.id)
        return _inventory_overstock_status(inventory, now=self.now)

    def test_big_delivery_that_sells_within_the_limit_is_not_overstocked(self):
        # The old rule flagged this: 300 cases is far above 10x a threshold of 4.
        self.stock(300)
        self.movement(360)  # 12 cases a day
        self.assertEqual(self.status(), {"overstocked": False, "reason": None, "coverDays": 25})

    def test_stock_lasting_past_the_limit_is_overstocked(self):
        self.stock(100)
        self.movement(30)  # 1 case a day
        self.assertEqual(self.status(), {"overstocked": True, "reason": REASON_SLOW_SALES, "coverDays": 100})

    def test_stock_lasting_exactly_the_limit_is_not_overstocked(self):
        self.stock(60)
        self.movement(30)
        self.assertEqual(self.status(), {"overstocked": False, "reason": None, "coverDays": 60})

    def test_reserved_stock_is_not_counted_as_sellable(self):
        self.stock(100)
        self.movement(30)
        Inventory.objects.filter(id=self.inventory.id).update(reserved_quantity=100, reserved_base_units=2400)
        self.assertFalse(self.status()["overstocked"])

    def test_only_customer_sales_set_the_rate(self):
        self.stock(100)
        # 30 cases net: orders, a mixed case by the bottle, and a retail sale that was reversed.
        self.movement(15)
        self.movement(360, reference_type="mixed_case_component", unit="BASE_UNIT")
        self.movement(10, reference_type="retail_sale")
        self.movement(10, reference_type="retail_sale_reversal", type="IN")
        # Disposals, batch corrections and sales before the window are not demand.
        self.movement(500, reference_type="expired_stock")
        self.movement(500, reference_type="stock_batch_adjustment")
        self.movement(500, days_ago=45)
        self.assertEqual(self.status(), {"overstocked": True, "reason": REASON_SLOW_SALES, "coverDays": 100})

    def test_stock_that_expires_before_it_sells_is_overstocked(self):
        # 2 cases a day: the 10 early cases clear in 5 days, but the next 40 need until day 25.
        self.stock(10, expires_in_days=10)
        later = self.stock(40, expires_in_days=20)
        self.movement(60)
        self.assertEqual(self.status(), {"overstocked": True, "reason": REASON_EXPIRY, "coverDays": 25})
        StockBatch.objects.filter(id=later.id).update(expiry_date=self.now + timedelta(days=40))
        self.assertEqual(self.status(), {"overstocked": False, "reason": None, "coverDays": 25})

    def test_new_stock_with_little_sales_history_is_not_judged(self):
        Inventory.objects.filter(id=self.inventory.id).update(created_at=self.now - timedelta(days=3))
        self.stock(100)
        self.movement(1)
        self.assertEqual(self.status(), {"overstocked": False, "reason": None, "coverDays": None})

    def test_unsold_stock_is_overstocked_once_it_sat_through_the_window(self):
        batch = self.stock(50, received_days_ago=2)
        self.assertFalse(self.status()["overstocked"])
        StockBatch.objects.filter(id=batch.id).update(created_at=self.now - timedelta(days=40))
        self.assertEqual(self.status(), {"overstocked": True, "reason": REASON_NO_SALES, "coverDays": None})

    def test_overstocked_product_can_still_be_stocked_in(self):
        self.stock(100)
        self.movement(30)
        self.assertTrue(self.status()["overstocked"])
        token = create_token({
            "userId": self.staff.id, "email": self.staff.email, "name": self.staff.name,
            "role": RoleType.WAREHOUSE_STAFF, "type": "staff",
        })
        response = Client().post(
            "/api/stock-batches/bulk",
            data=json.dumps({"warehouseId": self.warehouse.id, "batches": [{
                "productId": self.product.id, "quantity": 20,
                "expiryDate": (self.now + timedelta(days=365)).date().isoformat(),
                "batchNumber": "OVERSTOCK-DELIVERY-0",
            }]}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.inventory.refresh_from_db()
        self.assertEqual(self.inventory.quantity, 120)
        # The low-stock line follows every delivery, big or small.
        self.assertEqual(self.inventory.threshold, 18)
