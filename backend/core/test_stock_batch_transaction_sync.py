import json

from django.test import Client, TestCase
from django.utils import timezone

from .auth import create_token, hash_password
from .models import Inventory, InventoryTransaction, Product, RoleType, StockBatch, User, Warehouse
from .views_api import _is_inventory_overstocked_flagged_by_stockin


class StockBatchTransactionSyncTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.staff = User.objects.create(
            email="batch.sync@example.com",
            password=hash_password("Password1!"),
            name="Batch Sync Staff",
            role=RoleType.WAREHOUSE_STAFF,
            is_active=True,
        )
        self.warehouse = Warehouse.objects.create(
            name="Batch Sync Warehouse",
            code="WH-BATCH-SYNC",
            address="Talisay City",
            city="Talisay",
            province="Negros Occidental",
            zip_code="6115",
            capacity=100,
            manager_id=self.staff.id,
            is_active=True,
        )
        self.product = Product.objects.create(
            sku="BATCH-SYNC-SKU",
            name="Batch Sync Product",
            unit="case",
            price=100,
        )
        self.inventory = Inventory.objects.create(
            warehouse=self.warehouse,
            product=self.product,
            quantity=10,
            threshold=1,
        )
        self.batch = StockBatch.objects.create(
            batch_number="BATCH-SYNC-001",
            inventory=self.inventory,
            quantity=10,
            receipt_date=timezone.now(),
        )
        self.transaction = InventoryTransaction.objects.create(
            warehouse=self.warehouse,
            product=self.product,
            type="IN",
            quantity=10,
            reference_type="stock_batch",
            reference_id=self.batch.id,
        )
        self.token = create_token(
            {
                "userId": self.staff.id,
                "email": self.staff.email,
                "name": self.staff.name,
                "role": RoleType.WAREHOUSE_STAFF,
                "type": "staff",
            }
        )

    def update_batch(self, quantity: int):
        return self.client.put(
            "/api/stock-batches",
            data=json.dumps({"batchId": self.batch.id, "quantity": quantity}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

    def test_edit_preserves_stock_in_transaction_and_appends_adjustments(self):
        self.inventory.threshold = 4
        self.inventory.save(update_fields=["threshold", "updated_at"])

        reduced_response = self.update_batch(6)
        self.assertEqual(reduced_response.status_code, 200, reduced_response.content)

        self.transaction.refresh_from_db()
        self.inventory.refresh_from_db()
        # Stock-in is immutable; a later physical correction has its own ledger row.
        self.assertEqual(self.transaction.quantity, 10)
        reduction = InventoryTransaction.objects.get(
            reference_type="stock_batch_adjustment",
            reference_id=self.batch.id,
            updated_stock=6,
        )
        self.assertEqual(reduction.type, "OUT")
        self.assertEqual(reduction.quantity, 4)
        self.assertEqual(reduction.previous_stock, 10)
        self.assertEqual(self.inventory.quantity, 6)
        # A deduction changes stock, but the restock threshold remains fixed.
        self.assertEqual(self.inventory.threshold, 4)

        depleted_response = self.update_batch(0)
        self.assertEqual(depleted_response.status_code, 200, depleted_response.content)
        self.assertFalse(StockBatch.objects.filter(id=self.batch.id).exists())
        self.transaction.refresh_from_db()
        depletion = InventoryTransaction.objects.get(
            reference_type="stock_batch_adjustment",
            reference_id=self.batch.id,
            updated_stock=0,
        )
        self.assertEqual(depletion.type, "OUT")
        self.assertEqual(depletion.quantity, 6)
        self.assertEqual(depletion.previous_stock, 6)

        self.inventory.refresh_from_db()
        self.assertEqual(self.inventory.quantity, 0)
        self.assertEqual(self.inventory.threshold, 4)

    def test_fully_reserved_inventory_is_not_overstocked(self):
        self.assertTrue(_is_inventory_overstocked_flagged_by_stockin(self.inventory))

        self.inventory.reserved_quantity = 10
        self.inventory.save(update_fields=["reserved_quantity", "updated_at"])

        self.assertFalse(_is_inventory_overstocked_flagged_by_stockin(self.inventory))

    def test_batch_increase_cannot_exceed_warehouse_capacity(self):
        self.inventory.threshold = 20
        self.inventory.save(update_fields=["threshold", "updated_at"])

        at_capacity = self.update_batch(100)
        self.assertEqual(at_capacity.status_code, 200, at_capacity.content)
        self.inventory.refresh_from_db()
        self.assertEqual(self.inventory.quantity, 100)
        self.assertEqual(self.inventory.threshold, 15)

        rejected = self.update_batch(101)
        self.assertEqual(rejected.status_code, 400, rejected.content)
        self.assertIn("Warehouse capacity exceeded", rejected.json()["error"])
        self.inventory.refresh_from_db()
        self.batch.refresh_from_db()
        self.assertEqual(self.inventory.quantity, 100)
        self.assertEqual(self.batch.quantity, 100)

    def test_inventory_transaction_list_hides_replacement_bottle_remainders(self):
        InventoryTransaction.objects.create(
            warehouse=self.warehouse,
            product=self.product,
            type="IN",
            quantity=4,
            reference_type="replacement_bottle_remainder",
        )

        response = self.client.get(
            "/api/inventory-transactions",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        self.assertEqual(payload["total"], 1)
        self.assertEqual(payload["transactions"][0]["id"], self.transaction.id)
