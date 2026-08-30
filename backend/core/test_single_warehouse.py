import json
from datetime import timedelta
from unittest.mock import patch

from django.db import IntegrityError, transaction
from django.test import Client, TestCase
from django.utils import timezone

from .auth import create_token, hash_password, verify_password
from .models import (
    Customer,
    Inventory,
    InventoryTransaction,
    Order,
    Product,
    RoleType,
    StockBatch,
    User,
    Warehouse,
)


class SingleWarehouseApiContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin = User.objects.create(
            email="single.warehouse.admin@example.com",
            password="hashed",
            name="Single Warehouse Admin",
            role=RoleType.SUPER_ADMIN,
            is_active=True,
        )
        self.staff = User.objects.create(
            email="single.warehouse.staff@example.com",
            password="hashed",
            name="Single Warehouse Staff",
            role=RoleType.WAREHOUSE_STAFF,
            is_active=True,
        )
        self.admin_token = create_token(
            {
                "userId": self.admin.id,
                "email": self.admin.email,
                "name": self.admin.name,
                "role": RoleType.SUPER_ADMIN,
                "type": "staff",
            }
        )
        self.staff_token = create_token(
            {
                "userId": self.staff.id,
                "email": self.staff.email,
                "name": self.staff.name,
                "role": RoleType.WAREHOUSE_STAFF,
                "type": "staff",
            }
        )

    @staticmethod
    def warehouse_payload(**overrides):
        payload = {
            "name": "Main Warehouse",
            "code": "WH-0001",
            "address": "Main Street, Talisay",
            "city": "Talisay",
            "province": "Negros Occidental",
            "zipCode": "6115",
            "capacity": 1000,
        }
        payload.update(overrides)
        return payload

    def auth(self, token: str) -> dict[str, str]:
        return {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    def create_warehouse(self) -> Warehouse:
        response = self.client.post(
            "/api/warehouses",
            data=json.dumps(self.warehouse_payload()),
            content_type="application/json",
            **self.auth(self.admin_token),
        )
        self.assertEqual(response.status_code, 201, response.content)
        return Warehouse.objects.get()

    def test_duplicate_email_is_rejected_across_account_types(self) -> None:
        Customer.objects.create(
            email="already.registered@example.com",
            password="hashed",
            name="Existing Customer",
        )

        response = self.client.post(
            "/api/auth/email-verification/request",
            data=json.dumps(
                {
                    "email": "already.registered@example.com",
                    "accountType": "staff",
                    "roleId": RoleType.DRIVER,
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["error"], "This email address is already registered.")

        different_role_response = self.client.post(
            "/api/auth/email-verification/request",
            data=json.dumps(
                {
                    "email": self.admin.email,
                    "accountType": "staff",
                    "roleId": RoleType.DRIVER,
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(different_role_response.status_code, 409, different_role_response.content)
        self.assertEqual(different_role_response.json()["error"], "This email address is already registered.")

        edit_target = User.objects.create(
            email="edit.target@example.com",
            password="hashed",
            name="Edit Target",
            role=RoleType.DRIVER,
            is_active=True,
        )
        edit_response = self.client.put(
            f"/api/users/{edit_target.id}",
            data=json.dumps({"email": self.admin.email}),
            content_type="application/json",
            **self.auth(self.admin_token),
        )
        self.assertEqual(edit_response.status_code, 409, edit_response.content)
        self.assertEqual(edit_response.json()["error"], "This email address is already registered.")

        # A legacy cross-account duplicate must not block a profile update when email is unchanged.
        Customer.objects.create(
            email=self.admin.email,
            password="hashed",
            name="Legacy Duplicate Customer",
        )
        unchanged_email_response = self.client.put(
            f"/api/users/{self.admin.id}",
            data=json.dumps({"name": "Updated Admin Name", "email": self.admin.email}),
            content_type="application/json",
            **self.auth(self.admin_token),
        )
        self.assertEqual(unchanged_email_response.status_code, 200, unchanged_email_response.content)

    def test_admin_can_reset_selected_user_password_without_user_otp(self) -> None:
        target = User.objects.create(
            email="password.reset.target@example.com",
            password=hash_password("OldPassword1!"),
            name="Password Reset Target",
            role=RoleType.DRIVER,
            is_active=True,
        )

        response = self.client.put(
            f"/api/users/{target.id}",
            data=json.dumps({"password": "NewPassword2!", "adminResetPassword": True}),
            content_type="application/json",
            **self.auth(self.admin_token),
        )
        self.assertEqual(response.status_code, 200, response.content)

        target.refresh_from_db()
        self.assertTrue(verify_password("NewPassword2!", target.password))

    def test_warehouse_staff_can_edit_stock_batch_dates_without_changing_quantity(self) -> None:
        warehouse = self.create_warehouse()
        warehouse.manager_id = self.staff.id
        warehouse.save(update_fields=["manager_id", "updated_at"])
        product = Product.objects.create(
            sku="SKU-DATE-EDIT",
            name="Batch Date Edit Product",
            unit="case",
            price=25,
        )
        inventory = Inventory.objects.create(
            warehouse=warehouse,
            product=product,
            quantity=10,
            reserved_quantity=0,
            threshold=1,
        )
        batch = StockBatch.objects.create(
            batch_number="BATCH-DATE-EDIT-001",
            inventory=inventory,
            quantity=10,
            receipt_date=timezone.now(),
            status="ACTIVE",
        )
        manufactured_date = timezone.now() - timedelta(days=10)
        expiry_date = timezone.now() + timedelta(days=90)

        response = self.client.put(
            "/api/stock-batches",
            data=json.dumps(
                {
                    "batchId": batch.id,
                    "quantity": batch.quantity,
                    "manufacturedDate": manufactured_date.isoformat(),
                    "expiryDate": expiry_date.isoformat(),
                }
            ),
            content_type="application/json",
            **self.auth(self.staff_token),
        )
        self.assertEqual(response.status_code, 200, response.content)

        batch.refresh_from_db()
        self.assertEqual(batch.quantity, 10)
        self.assertEqual(batch.receipt_date, manufactured_date)
        self.assertEqual(batch.expiry_date, expiry_date)

    def test_admin_can_register_once_and_edit_profile(self) -> None:
        warehouse = self.create_warehouse()
        self.assertEqual(warehouse.capacity, 1000)

        update = self.client.put(
            f"/api/warehouses/{warehouse.id}",
            data=json.dumps(
                {
                    "name": "Updated Main Warehouse",
                    "capacity": 2000,
                }
            ),
            content_type="application/json",
            **self.auth(self.admin_token),
        )
        self.assertEqual(update.status_code, 200, update.content)
        warehouse.refresh_from_db()
        self.assertEqual(warehouse.name, "Updated Main Warehouse")
        self.assertEqual(warehouse.capacity, 2000)

    def test_capacity_cannot_be_lowered_below_current_stock(self) -> None:
        warehouse = self.create_warehouse()
        product = Product.objects.create(sku="SKU-CAPACITY-FLOOR", name="Capacity Floor Product")
        Inventory.objects.create(
            warehouse=warehouse,
            product=product,
            quantity=12,
            reserved_quantity=0,
            threshold=2,
        )

        rejected = self.client.put(
            f"/api/warehouses/{warehouse.id}",
            data=json.dumps({"capacity": 11}),
            content_type="application/json",
            **self.auth(self.admin_token),
        )

        self.assertEqual(rejected.status_code, 400, rejected.content)
        self.assertIn("Warehouse capacity exceeded", rejected.json()["error"])
        warehouse.refresh_from_db()
        self.assertEqual(warehouse.capacity, 1000)

        # Exact current usage remains a valid hard-cap configuration.
        accepted = self.client.put(
            f"/api/warehouses/{warehouse.id}",
            data=json.dumps({"capacity": 12}),
            content_type="application/json",
            **self.auth(self.admin_token),
        )
        self.assertEqual(accepted.status_code, 200, accepted.content)
        warehouse.refresh_from_db()
        self.assertEqual(warehouse.capacity, 12)

    def test_second_registration_is_rejected_by_api_and_database(self) -> None:
        self.create_warehouse()
        response = self.client.post(
            "/api/warehouses",
            data=json.dumps(self.warehouse_payload(code="WH-0002")),
            content_type="application/json",
            **self.auth(self.admin_token),
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(Warehouse.objects.count(), 1)

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Warehouse.objects.create(
                    name="Forbidden Warehouse",
                    code="WH-0003",
                    address="Other Street",
                    city="Talisay",
                    province="Negros Occidental",
                    zip_code="6115",
                )

    def test_warehouse_staff_can_view_but_cannot_modify_profile(self) -> None:
        warehouse = self.create_warehouse()
        listing = self.client.get("/api/warehouses", **self.auth(self.staff_token))
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.json()["warehouses"][0]["id"], warehouse.id)

        update = self.client.put(
            f"/api/warehouses/{warehouse.id}",
            data=json.dumps({"name": "Forbidden Update"}),
            content_type="application/json",
            **self.auth(self.staff_token),
        )
        self.assertEqual(update.status_code, 403)

        delete = self.client.delete(
            f"/api/warehouses/{warehouse.id}",
            **self.auth(self.admin_token),
        )
        self.assertEqual(delete.status_code, 405)
        self.assertTrue(Warehouse.objects.filter(id=warehouse.id).exists())

    def test_product_is_assigned_server_side_and_mismatched_id_is_rejected(self) -> None:
        warehouse = self.create_warehouse()
        rejected = self.client.post(
            "/api/products",
            data=json.dumps(
                {
                    "sku": "SKU-WRONG-WH",
                    "name": "Wrong Warehouse Product",
                    "warehouseId": "not-the-registered-warehouse",
                }
            ),
            content_type="application/json",
            **self.auth(self.admin_token),
        )
        self.assertEqual(rejected.status_code, 400)
        self.assertFalse(Product.objects.filter(sku="SKU-WRONG-WH").exists())

        created = self.client.post(
            "/api/products",
            data=json.dumps(
                {
                    "sku": "SKU-SINGLE-WH",
                    "name": "Single Warehouse Product",
                    "availableQuantity": 12,
                }
            ),
            content_type="application/json",
            **self.auth(self.admin_token),
        )
        self.assertEqual(created.status_code, 201, created.content)
        product_id = created.json()["product"]["id"]
        self.assertTrue(
            Inventory.objects.filter(
                warehouse=warehouse,
                product_id=product_id,
                quantity=12,
            ).exists()
        )

        rejected_update = self.client.put(
            f"/api/products/{product_id}",
            data=json.dumps(
                {
                    "name": "Forged Warehouse Update",
                    "warehouseId": "not-the-registered-warehouse",
                }
            ),
            content_type="application/json",
            **self.auth(self.admin_token),
        )
        self.assertEqual(rejected_update.status_code, 400)
        self.assertEqual(Product.objects.get(id=product_id).name, "Single Warehouse Product")

    def test_inventory_and_trip_requests_reject_another_warehouse_id(self) -> None:
        warehouse = self.create_warehouse()
        product = Product.objects.create(sku="SKU-API-GUARD", name="API Guard Product")

        inventory_response = self.client.post(
            "/api/inventory",
            data=json.dumps(
                {
                    "warehouseId": "forged-warehouse-id",
                    "productId": product.id,
                    "quantity": 3,
                }
            ),
            content_type="application/json",
            **self.auth(self.staff_token),
        )
        self.assertEqual(inventory_response.status_code, 400)
        self.assertFalse(Inventory.objects.filter(product=product).exists())

        negative_inventory_response = self.client.post(
            "/api/inventory",
            data=json.dumps(
                {
                    "productId": product.id,
                    "quantity": -1,
                }
            ),
            content_type="application/json",
            **self.auth(self.staff_token),
        )
        self.assertEqual(negative_inventory_response.status_code, 400)
        self.assertFalse(Inventory.objects.filter(product=product).exists())

        inventory = Inventory.objects.create(
            warehouse=warehouse,
            product=product,
            quantity=3,
            reserved_quantity=0,
            threshold=1,
        )
        forged_inventory_update = self.client.put(
            f"/api/inventory/{inventory.id}",
            data=json.dumps(
                {
                    "warehouseId": "forged-warehouse-id",
                    "quantity": 9,
                }
            ),
            content_type="application/json",
            **self.auth(self.staff_token),
        )
        self.assertEqual(forged_inventory_update.status_code, 400)
        inventory.refresh_from_db()
        self.assertEqual(inventory.quantity, 3)

        trip_response = self.client.post(
            "/api/trips",
            data=json.dumps({"warehouseId": "forged-warehouse-id"}),
            content_type="application/json",
            **self.auth(self.staff_token),
        )
        self.assertEqual(trip_response.status_code, 400)

    @patch("core.views_api._send_transactional_email")
    def test_operational_writes_and_dashboard_use_the_registered_warehouse(
        self,
        _mock_send_transactional_email,
    ) -> None:
        warehouse = self.create_warehouse()
        product = Product.objects.create(
            sku="SKU-SINGLE-OPS",
            name="Single Warehouse Operations Product",
            unit="case",
            price=25,
        )
        inventory = Inventory.objects.create(
            warehouse=warehouse,
            product=product,
            quantity=10,
            reserved_quantity=0,
            threshold=1,
        )
        initial_batch = StockBatch.objects.create(
            batch_number="BATCH-SINGLE-OPS",
            inventory=inventory,
            quantity=10,
            receipt_date=timezone.now(),
            status="ACTIVE",
        )

        stock_in = self.client.post(
            "/api/stock-batches",
            data=json.dumps(
                {
                    "inventoryId": inventory.id,
                    "batchNumber": "BATCH-SINGLE-OPS-IN",
                    "quantity": 3,
                    "manufacturedDate": timezone.now().isoformat(),
                    "expiryDate": (timezone.now() + timedelta(days=30)).isoformat(),
                }
            ),
            content_type="application/json",
            **self.auth(self.staff_token),
        )
        self.assertEqual(stock_in.status_code, 201, stock_in.content)
        inventory.refresh_from_db()
        self.assertEqual(inventory.quantity, 13)
        stock_in_transaction = InventoryTransaction.objects.get(
            reference_type="stock_batch",
            reference_id=stock_in.json()["stockBatch"]["id"],
        )
        self.assertEqual(stock_in_transaction.previous_stock, 10)
        self.assertEqual(stock_in_transaction.updated_stock, 13)

        customer = Customer.objects.create(
            email="single.warehouse.customer@example.com",
            password="hashed",
            name="Single Warehouse Customer",
            city="Talisay",
            province="Negros Occidental",
        )
        customer_token = create_token(
            {
                "userId": customer.id,
                "email": customer.email,
                "name": customer.name,
                "type": "customer",
            }
        )

        order_response = self.client.post(
            "/api/customer/orders",
            data=json.dumps(
                {
                    "requestId": "single-warehouse-operational-order",
                    "shippingLatitude": 10.67,
                    "shippingLongitude": 122.95,
                    "shippingCity": "Talisay",
                    "shippingProvince": "Negros Occidental",
                    "items": [{"productId": product.id, "quantity": 2}],
                }
            ),
            content_type="application/json",
            **self.auth(customer_token),
        )
        self.assertEqual(order_response.status_code, 201, order_response.content)
        order = Order.objects.get(id=order_response.json()["order"]["id"])
        self.assertEqual(order.warehouse_id, warehouse.id)

        update_product = self.client.put(
            f"/api/products/{product.id}",
            data=json.dumps({"name": "Updated Operations Product"}),
            content_type="application/json",
            **self.auth(self.admin_token),
        )
        self.assertEqual(update_product.status_code, 200, update_product.content)

        update_inventory = self.client.put(
            "/api/stock-batches",
            data=json.dumps({"batchId": initial_batch.id, "quantity": 8}),
            content_type="application/json",
            **self.auth(self.staff_token),
        )
        self.assertEqual(update_inventory.status_code, 200, update_inventory.content)
        adjustment = InventoryTransaction.objects.get(
            reference_type="stock_batch_adjustment",
            reference_id=initial_batch.id,
        )
        self.assertEqual(adjustment.warehouse_id, warehouse.id)
        self.assertEqual(adjustment.type, "OUT")
        self.assertEqual(adjustment.previous_stock, 13)
        self.assertEqual(adjustment.updated_stock, 11)

        history = self.client.get(
            "/api/inventory-transactions",
            **self.auth(self.staff_token),
        )
        self.assertEqual(history.status_code, 200, history.content)
        self.assertTrue(history.json()["transactions"])
        self.assertTrue(
            all(row["warehouse"]["id"] == warehouse.id for row in history.json()["transactions"])
        )

        dashboard = self.client.get("/api/dashboard/stats", **self.auth(self.admin_token))
        self.assertEqual(dashboard.status_code, 200, dashboard.content)
        self.assertEqual(dashboard.json()["stats"]["totalOrders"], 1)

    def test_operations_fail_clearly_before_initial_setup(self) -> None:
        response = self.client.get("/api/inventory", **self.auth(self.admin_token))
        self.assertEqual(response.status_code, 409)
        self.assertIn("Warehouse setup is required", response.json()["error"])
