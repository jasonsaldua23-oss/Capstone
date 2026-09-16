"""Warehouse stock-in and staff inventory scoping contracts."""

import json
from datetime import datetime, timedelta

from django.test import Client, TestCase
from django.utils import timezone

from .auth import create_token
from .models import (
    ContainerType,
    Customer,
    Inventory,
    InventoryTransaction,
    Order,
    OrderItem,
    OrderStatus,
    Product,
    ProductPackaging,
    Replacement,
    StockBatch,
    Trip,
    TripStatus,
    User,
    Vehicle,
    VehicleType,
    Warehouse,
)
from .test_support import Role, Driver



class BulkStockInExistingProductContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        warehouse_role = Role.objects.create(name="WAREHOUSE_STAFF", description="Warehouse Staff")
        self.warehouse_user = User.objects.create(
            email="bulk.stock.existing@example.com",
            password="hashed",
            name="Bulk Stock User",
            role=warehouse_role,
            is_active=True,
        )
        self.warehouse = Warehouse.objects.create(
            name="Bulk Stock Warehouse",
            code="WH-BULK-STOCK",
            address="Bulk Stock Address",
            city="Talisay",
            province="Negros Occidental",
            zip_code="6115",
            manager_id=self.warehouse_user.id,
            is_active=True,
        )
        self.product = Product.objects.create(sku="SKU-BULK-STOCK", name="Bulk Stock Product", price=10)
        self.inventory = Inventory.objects.create(
            warehouse=self.warehouse,
            product=self.product,
            quantity=10,
            threshold=1,
        )
        self.token = create_token(
            {
                "userId": self.warehouse_user.id,
                "email": self.warehouse_user.email,
                "name": self.warehouse_user.name,
                "role": "WAREHOUSE_STAFF",
                "type": "staff",
            }
        )

    def test_retry_does_not_duplicate_quantity_or_product(self) -> None:
        product_count_before = Product.objects.count()
        inventory_count_before = Inventory.objects.count()
        request_body = {
            "warehouseId": self.warehouse.id,
            "batches": [
                {
                    "productId": self.product.id,
                    "quantity": 4,
                    "manufacturedDate": timezone.now().isoformat(),
                    "expiryDate": (timezone.now() + timedelta(days=365)).isoformat(),
                    "batchNumber": "STOCKIN-IDEMPOTENT-001-0",
                }
            ],
        }

        first_response = self.client.post(
            "/api/stock-batches/bulk",
            data=json.dumps(request_body),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        retry_response = self.client.post(
            "/api/stock-batches/bulk",
            data=json.dumps(request_body),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(first_response.status_code, 201, first_response.content)
        self.assertEqual(retry_response.status_code, 201, retry_response.content)
        self.inventory.refresh_from_db()
        self.assertEqual(self.inventory.quantity, 14)
        self.assertEqual(Product.objects.count(), product_count_before)
        self.assertEqual(Inventory.objects.count(), inventory_count_before)
        batch = StockBatch.objects.get(batch_number="STOCKIN-IDEMPOTENT-001-0")
        self.assertEqual(batch.quantity, 4)
        self.assertEqual(
            InventoryTransaction.objects.filter(reference_type="stock_batch", reference_id=batch.id).count(),
            1,
        )

    def test_bulk_stock_in_rejects_past_expiry_date(self) -> None:
        past_date = timezone.localdate() - timedelta(days=1)
        response = self.client.post(
            "/api/stock-batches/bulk",
            data={
                "warehouseId": self.warehouse.id,
                "batches": [
                    {
                        "productId": self.product.id,
                        "quantity": 4,
                        "expiryDate": past_date.isoformat(),
                        "batchNumber": "STOCKIN-PAST-EXPIRY-001",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("Expiry date cannot be in the past", response.json()["error"])
        self.assertFalse(StockBatch.objects.filter(batch_number="STOCKIN-PAST-EXPIRY-001").exists())

    def test_bulk_stock_in_accepts_current_expiry_date(self) -> None:
        response = self.client.post(
            "/api/stock-batches/bulk",
            data={
                "warehouseId": self.warehouse.id,
                "batches": [
                    {
                        "productId": self.product.id,
                        "quantity": 1,
                        "expiryDate": timezone.localdate().isoformat(),
                        "batchNumber": "STOCKIN-CURRENT-EXPIRY-001",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 201, response.content)
        batch = StockBatch.objects.get(batch_number="STOCKIN-CURRENT-EXPIRY-001")
        # The current date is valid and remains usable through the end of the local day.
        self.assertEqual(timezone.localtime(batch.expiry_date).date(), timezone.localdate())
        self.assertGreater(batch.expiry_date, timezone.now())

    def test_single_stock_in_rejects_past_expiry_date(self) -> None:
        response = self.client.post(
            "/api/stock-batches",
            data={
                "inventoryId": self.inventory.id,
                "quantity": 1,
                "expiryDate": (timezone.localdate() - timedelta(days=1)).isoformat(),
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()["error"],
            "Expiry date cannot be in the past. Enter today or a future date.",
        )

    def test_stock_batch_edit_rejects_past_expiry_date(self) -> None:
        batch = StockBatch.objects.create(
            batch_number="STOCKIN-EDIT-EXPIRY-001",
            inventory=self.inventory,
            quantity=1,
            receipt_date=timezone.now(),
            expiry_date=timezone.now() + timedelta(days=30),
            status="ACTIVE",
        )
        response = self.client.put(
            "/api/stock-batches",
            data={
                "batchId": batch.id,
                "quantity": 1,
                "expiryDate": (timezone.localdate() - timedelta(days=1)).isoformat(),
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 400)
        batch.refresh_from_db()
        self.assertGreaterEqual(timezone.localtime(batch.expiry_date).date(), timezone.localdate())

    def test_returnable_product_stock_in_consumes_available_empties_without_requiring_full_amount(self) -> None:
        self.product.packaging_type = "RETURNABLE"
        self.product.save(update_fields=["packaging_type", "updated_at"])
        container = ContainerType.objects.create(
            code="BULK-STOCK-RETURNABLE-BOTTLE",
            name="Bulk Stock Returnable Bottle",
            category=ContainerType.Category.BOTTLE,
            material=ContainerType.Material.GLASS,
            is_returnable=True,
        )
        ProductPackaging.objects.create(
            product=self.product,
            container_type=container,
            containers_per_case=12,
            is_primary=True,
            is_returnable=True,
        )
        returned_order = Order.objects.create(
            order_number="DELIVERED-BULK-STOCK-EMPTIES",
            status=OrderStatus.DELIVERED,
            warehouse_id=self.warehouse.id,
            subtotal=0,
            total_amount=0,
        )
        OrderItem.objects.create(
            order=returned_order,
            product=self.product,
            quantity=1,
            unit_price=0,
            total_price=0,
            empty_returned_quantity=24,
        )

        response = self.client.post(
            "/api/stock-batches/bulk",
            data=json.dumps(
                {
                    "warehouseId": self.warehouse.id,
                    "batches": [
                        {
                            "productId": self.product.id,
                            "quantity": 4,
                            "expiryDate": (timezone.now() + timedelta(days=365)).isoformat(),
                            "batchNumber": "STOCKIN-RETURNABLE-NO-EMPTIES-001",
                        }
                    ],
                }
            ),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        # Fix: two available cases are consumed, while all four cases are restocked.
        self.assertEqual(response.status_code, 201, response.content)
        self.inventory.refresh_from_db()
        self.assertEqual(self.inventory.quantity, 14)
        consumption = InventoryTransaction.objects.get(
            type="CONSUME_EMPTY",
            reference_type="stock_batch_empty_consumed",
        )
        self.assertEqual(consumption.quantity, 2)

    def test_rejects_product_missing_from_warehouse_inventory(self) -> None:
        unregistered_product = Product.objects.create(
            sku="SKU-BULK-UNREGISTERED",
            name="Unregistered Bulk Product",
            price=30,
        )
        inventory_count_before = Inventory.objects.count()

        response = self.client.post(
            "/api/stock-batches/bulk",
            data=json.dumps(
                {
                    "warehouseId": self.warehouse.id,
                    "batches": [
                        {
                            "productId": unregistered_product.id,
                            "quantity": 4,
                            "expiryDate": (timezone.now() + timedelta(days=365)).isoformat(),
                            "batchNumber": "STOCKIN-UNREGISTERED-001-0",
                        }
                    ],
                }
            ),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(Inventory.objects.count(), inventory_count_before)
        self.assertFalse(StockBatch.objects.filter(batch_number="STOCKIN-UNREGISTERED-001-0").exists())

    def test_inventory_endpoint_excludes_inactive_product_rows(self) -> None:
        self.product.is_active = False
        self.product.save(update_fields=["is_active", "updated_at"])

        response = self.client.get(
            "/api/inventory",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["inventory"], [])


class WarehouseStaffInventoryScopeContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.warehouse_role = Role.objects.create(name="WAREHOUSE_STAFF", description="Warehouse Staff")
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")

        self.warehouse_user = User.objects.create(
            email="warehouse.scope@example.com",
            password="hashed",
            name="Warehouse Scope User",
            role=self.warehouse_role,
            is_active=True,
        )
        self.other_warehouse_user = User.objects.create(
            email="warehouse.scope.other@example.com",
            password="hashed",
            name="Warehouse Scope Other User",
            role=self.warehouse_role,
            is_active=True,
        )
        self.admin_user = User.objects.create(
            email="warehouse.scope.admin@example.com",
            password="hashed",
            name="Warehouse Scope Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.driver_user = User.objects.create(
            email="warehouse.scope.driver@example.com",
            password="hashed",
            name="Warehouse Scope Driver",
            role=self.driver_role,
            is_active=True,
        )

        self.primary_warehouse = Warehouse.objects.create(
            name="Scope Warehouse A",
            code="WH-SCOPE-A",
            address="Address A",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            manager_id=self.warehouse_user.id,
            is_active=True,
        )
        self.other_warehouse = Warehouse.objects.create(
            name="Scope Warehouse B",
            code="WH-SCOPE-B",
            address="Address B",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            manager_id=self.other_warehouse_user.id,
            is_active=True,
        )

        self.customer = Customer.objects.create(
            email="warehouse.scope.customer@example.com",
            password="hashed",
            name="Warehouse Scope Customer",
            is_active=True,
        )
        self.vehicle = Vehicle.objects.create(
            license_plate="SCOPE-PLATE-001",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
        )

        self.product_a = Product.objects.create(sku="SKU-SCOPE-A", name="Scope Product A", price=10)
        self.product_b = Product.objects.create(sku="SKU-SCOPE-B", name="Scope Product B", price=20)
        self.primary_inventory = Inventory.objects.create(
            warehouse=self.primary_warehouse,
            product=self.product_a,
            quantity=10,
            reserved_quantity=1,
            threshold=1,
        )
        self.other_inventory = Inventory.objects.create(
            warehouse=self.other_warehouse,
            product=self.product_b,
            quantity=20,
            reserved_quantity=2,
            threshold=1,
        )

        self.warehouse_token = create_token(
            {
                "userId": self.warehouse_user.id,
                "email": self.warehouse_user.email,
                "name": self.warehouse_user.name,
                "role": "WAREHOUSE_STAFF",
                "type": "staff",
            }
        )
        self.admin_token = create_token(
            {
                "userId": self.admin_user.id,
                "email": self.admin_user.email,
                "name": self.admin_user.name,
                "role": "ADMIN",
                "type": "staff",
            }
        )

    def test_warehouses_endpoint_for_warehouse_staff_returns_only_assigned_warehouse(self) -> None:
        response = self.client.get(
            "/api/warehouses",
            HTTP_AUTHORIZATION=f"Bearer {self.warehouse_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["total"], 1)
        self.assertEqual(len(payload["warehouses"]), 1)
        self.assertEqual(payload["warehouses"][0]["id"], self.primary_warehouse.id)

    def test_inventory_endpoint_for_warehouse_staff_returns_only_assigned_warehouse_products(self) -> None:
        response = self.client.get(
            "/api/inventory",
            HTTP_AUTHORIZATION=f"Bearer {self.warehouse_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["total"], 1)
        self.assertEqual(len(payload["inventory"]), 1)
        self.assertEqual(payload["inventory"][0]["warehouse"]["id"], self.primary_warehouse.id)
        self.assertEqual(payload["inventory"][0]["product"]["id"], self.product_a.id)

    def test_inventory_endpoint_for_warehouse_staff_rejects_other_warehouse_filter(self) -> None:
        response = self.client.get(
            f"/api/inventory?warehouseId={self.other_warehouse.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.warehouse_token}",
        )
        self.assertEqual(response.status_code, 403)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Forbidden")

    def test_inventory_endpoint_for_admin_can_see_all_warehouses(self) -> None:
        response = self.client.get(
            "/api/inventory",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["total"], 2)

    def test_stock_batches_endpoint_for_warehouse_staff_returns_only_assigned_warehouse_batches(self) -> None:
        StockBatch.objects.create(
            batch_number="BATCH-SCOPE-001",
            inventory=self.primary_inventory,
            quantity=5,
            receipt_date=timezone.now(),
            status="ACTIVE",
        )
        StockBatch.objects.create(
            batch_number="BATCH-SCOPE-002",
            inventory=self.other_inventory,
            quantity=5,
            receipt_date=timezone.now(),
            status="ACTIVE",
        )
        response = self.client.get(
            "/api/stock-batches",
            HTTP_AUTHORIZATION=f"Bearer {self.warehouse_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["total"], 1)
        self.assertEqual(payload["stockBatches"][0]["inventory"]["warehouse"]["id"], self.primary_warehouse.id)

    def test_inventory_transactions_endpoint_for_warehouse_staff_returns_only_assigned_warehouse_transactions(self) -> None:
        InventoryTransaction.objects.create(
            warehouse=self.primary_warehouse,
            product=self.product_a,
            type="IN",
            quantity=5,
        )
        InventoryTransaction.objects.create(
            warehouse=self.other_warehouse,
            product=self.product_b,
            type="IN",
            quantity=5,
        )
        response = self.client.get(
            "/api/inventory-transactions",
            HTTP_AUTHORIZATION=f"Bearer {self.warehouse_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["total"], 1)
        self.assertEqual(payload["transactions"][0]["warehouse"]["id"], self.primary_warehouse.id)

    def test_inventory_detail_put_appends_manual_quantity_adjustment_transaction(self) -> None:
        response = self.client.put(
            f"/api/inventory/{self.primary_inventory.id}",
            data=json.dumps({"quantity": 14}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.warehouse_token}",
        )
        self.assertEqual(response.status_code, 200)
        self.primary_inventory.refresh_from_db()
        self.assertEqual(self.primary_inventory.quantity, 14)

        tx = InventoryTransaction.objects.filter(
            reference_type="inventory_manual_edit",
            reference_id=self.primary_inventory.id,
        ).latest("created_at")
        self.assertEqual(tx.type, "IN")
        self.assertEqual(tx.quantity, 4)
        self.assertEqual(tx.previous_stock, 10)
        self.assertEqual(tx.updated_stock, 14)
        self.assertEqual(tx.performed_by, self.warehouse_user.id)

    def test_stock_batch_quantity_edit_preserves_stock_in_and_records_adjustments(self) -> None:
        self.primary_inventory.quantity = 10
        self.primary_inventory.save(update_fields=["quantity", "updated_at"])
        batch = StockBatch.objects.create(
            batch_number="BATCH-ADJUST-001",
            inventory=self.primary_inventory,
            quantity=10,
            receipt_date=timezone.now(),
            status="ACTIVE",
        )
        original_tx = InventoryTransaction.objects.create(
            warehouse=self.primary_warehouse,
            product=self.product_a,
            type="IN",
            quantity=10,
            previous_stock=0,
            updated_stock=10,
            reference_type="stock_batch",
            reference_id=batch.id,
        )

        response = self.client.put(
            "/api/stock-batches",
            data=json.dumps({"batchId": batch.id, "quantity": 6}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.warehouse_token}",
        )
        self.assertEqual(response.status_code, 200)

        original_tx.refresh_from_db()
        # Keep the original receipt intact and append the reduction to the ledger.
        self.assertEqual(original_tx.quantity, 10)
        reduction = InventoryTransaction.objects.get(
            reference_type="stock_batch_adjustment",
            reference_id=batch.id,
            updated_stock=6,
        )
        self.assertEqual(reduction.type, "OUT")
        self.assertEqual(reduction.quantity, 4)
        self.assertEqual(reduction.previous_stock, 10)

        self.primary_inventory.refresh_from_db()
        self.assertEqual(self.primary_inventory.quantity, 6)

        depleted_response = self.client.put(
            "/api/stock-batches",
            data=json.dumps({"batchId": batch.id, "quantity": 0}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.warehouse_token}",
        )
        self.assertEqual(depleted_response.status_code, 200)
        self.assertFalse(StockBatch.objects.filter(id=batch.id).exists())
        original_tx.refresh_from_db()
        depletion = InventoryTransaction.objects.get(
            reference_type="stock_batch_adjustment",
            reference_id=batch.id,
            updated_stock=0,
        )
        self.assertEqual(depletion.type, "OUT")
        self.assertEqual(depletion.quantity, 6)
        self.assertEqual(depletion.previous_stock, 6)

        self.primary_inventory.refresh_from_db()
        self.assertEqual(self.primary_inventory.quantity, 0)

    def test_orders_endpoint_for_warehouse_staff_returns_only_assigned_warehouse_orders(self) -> None:
        Order.objects.create(
            order_number="ORD-SCOPE-001",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            subtotal=100,
            total_amount=110,
            warehouse_id=self.primary_warehouse.id,
        )
        Order.objects.create(
            order_number="ORD-SCOPE-002",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            subtotal=100,
            total_amount=110,
            warehouse_id=self.other_warehouse.id,
        )
        response = self.client.get(
            "/api/orders",
            HTTP_AUTHORIZATION=f"Bearer {self.warehouse_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["total"], 1)
        self.assertEqual(payload["orders"][0]["warehouseId"], self.primary_warehouse.id)

    def test_trips_endpoint_for_warehouse_staff_returns_only_assigned_warehouse_trips(self) -> None:
        Trip.objects.create(
            trip_number="TRP-SCOPE-001",
            driver=self.driver_user,
            vehicle=self.vehicle,
            status=TripStatus.PLANNED,
            warehouse_id=self.primary_warehouse.id,
        )
        Trip.objects.create(
            trip_number="TRP-SCOPE-002",
            driver=self.driver_user,
            vehicle=self.vehicle,
            status=TripStatus.PLANNED,
            warehouse_id=self.other_warehouse.id,
        )
        response = self.client.get(
            "/api/trips",
            HTTP_AUTHORIZATION=f"Bearer {self.warehouse_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["total"], 1)
        self.assertEqual(payload["trips"][0]["warehouseId"], self.primary_warehouse.id)

    def test_replacements_endpoint_for_warehouse_staff_returns_only_assigned_warehouse_replacements(self) -> None:
        primary_order = Order.objects.create(
            order_number="ORD-REPL-SCOPE-001",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            subtotal=100,
            total_amount=110,
            warehouse_id=self.primary_warehouse.id,
        )
        other_order = Order.objects.create(
            order_number="ORD-REPL-SCOPE-002",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            subtotal=100,
            total_amount=110,
            warehouse_id=self.other_warehouse.id,
        )
        # The replacements collection only ever exposes customer-submitted
        # requests, so the scope assertion below has to build the same kind of
        # record the endpoint serves.
        Replacement.objects.create(
            replacement_number="RET-SCOPE-001",
            order=primary_order,
            customer_id=self.customer.id,
            reason="Damaged item",
            pickup_address="123 Return Street",
            pickup_city="Return City",
            pickup_province="Return Province",
            pickup_zip_code="5000",
            replacement_mode="CUSTOMER_SUBMITTED",
        )
        Replacement.objects.create(
            replacement_number="RET-SCOPE-002",
            order=other_order,
            customer_id=self.customer.id,
            reason="Damaged item",
            pickup_address="123 Return Street",
            pickup_city="Return City",
            pickup_province="Return Province",
            pickup_zip_code="5000",
            replacement_mode="CUSTOMER_SUBMITTED",
        )
        response = self.client.get(
            "/api/replacements",
            HTTP_AUTHORIZATION=f"Bearer {self.warehouse_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["total"], 1)
        self.assertEqual(payload["replacements"][0]["warehouseId"], self.primary_warehouse.id)

    def test_replacements_endpoint_for_warehouse_staff_rejects_other_warehouse_filter(self) -> None:
        response = self.client.get(
            f"/api/replacements?warehouseId={self.other_warehouse.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.warehouse_token}",
        )
        self.assertEqual(response.status_code, 403)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Forbidden")
