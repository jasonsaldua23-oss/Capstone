from decimal import Decimal
import json

from django.test import Client, SimpleTestCase, TestCase
from django.utils import timezone

from .auth import create_token
from .models import (
    ContainerType,
    BottleReturn,
    DepositTransaction,
    Inventory,
    InventoryTransaction,
    Order,
    PackagingProfile,
    Product,
    ProductPackaging,
    RoleType,
    StockBatch,
    User,
    Warehouse,
)
from .retail_pos import calculate_deposit_amount, calculate_payment_summary


class RetailPosMoneyTests(SimpleTestCase):
    """Acceptance coverage for the approved POS money and empty-return rules."""

    def test_loose_deposit_only_charges_uncovered_bottles(self):
        self.assertEqual(
            calculate_deposit_amount(
                mode="LOOSE",
                eligible_units=12,
                empty_units=8,
                unit_deposit=Decimal("2.00"),
            ),
            Decimal("8.00"),
        )

    def test_full_empty_coverage_reaches_zero(self):
        self.assertEqual(
            calculate_deposit_amount(
                mode="LOOSE",
                eligible_units=12,
                empty_units=12,
                unit_deposit=Decimal("2.00"),
            ),
            Decimal("0.00"),
        )

    def test_case_deposit_uses_registered_case_rate_and_prorates_partial_coverage(self):
        self.assertEqual(
            calculate_deposit_amount(
                mode="CASE",
                eligible_units=12,
                empty_units=0,
                unit_deposit=Decimal("2.00"),
                case_deposit=Decimal("90.00"),
                case_count=1,
                case_capacity=12,
            ),
            Decimal("90.00"),
        )
        self.assertEqual(
            calculate_deposit_amount(
                mode="CASE",
                eligible_units=12,
                empty_units=8,
                unit_deposit=Decimal("2.00"),
                case_deposit=Decimal("90.00"),
                case_count=1,
                case_capacity=12,
            ),
            Decimal("30.00"),
        )

    def test_empty_quantity_cannot_exceed_eligible_bottles(self):
        with self.assertRaisesMessage(ValueError, "cannot exceed"):
            calculate_deposit_amount(
                mode="LOOSE",
                eligible_units=12,
                empty_units=13,
                unit_deposit=Decimal("2.00"),
            )

    def test_payment_status_and_balance_are_server_derived(self):
        unpaid = calculate_payment_summary(Decimal("600"), Decimal("24"), Decimal("0"))
        partial = calculate_payment_summary(Decimal("600"), Decimal("24"), Decimal("100"))
        paid = calculate_payment_summary(Decimal("600"), Decimal("24"), Decimal("624"))

        self.assertEqual(unpaid["paymentStatus"], "UNPAID")
        self.assertEqual(partial["paymentStatus"], "PARTIALLY_PAID")
        self.assertEqual(partial["remainingBalance"], Decimal("524.00"))
        self.assertEqual(paid["paymentStatus"], "PAID")
        self.assertEqual(paid["remainingBalance"], Decimal("0.00"))

    def test_payment_rejects_negative_and_overpayment(self):
        with self.assertRaisesMessage(ValueError, "cannot be negative"):
            calculate_payment_summary(Decimal("100"), Decimal("0"), Decimal("-1"))
        with self.assertRaisesMessage(ValueError, "cannot exceed"):
            calculate_payment_summary(Decimal("100"), Decimal("0"), Decimal("101"))


class RetailPosApiTests(TestCase):
    """Exercise authorization, quoting, checkout, and sales-channel isolation."""

    def setUp(self):
        self.client = Client()
        self.staff = User.objects.create(
            email="pos@example.com",
            password="unused",
            name="POS Staff",
            role=RoleType.WAREHOUSE_STAFF,
            is_active=True,
        )
        self.warehouse = Warehouse.objects.create(
            name="Main Warehouse",
            code="MAIN-POS",
            address="Test Address",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            manager_id=self.staff.id,
        )
        self.profile = PackagingProfile.objects.create(
            code="GLASS-12-POS",
            name="Glass 12",
            container_type="Glass Bottle",
            container_size="330ml",
            standard_units_per_case=12,
            allowed_mixed_case_capacities=[12],
            compatibility_key="GLASS_BOTTLE",
            base_unit_label="Glass Bottle",
            is_returnable=True,
        )
        self.product = Product.objects.create(
            sku="POS-COLA-12",
            name="POS Cola",
            unit="case",
            price=300,
            retail_unit_price=Decimal("30.00"),
            case_price=Decimal("300.00"),
            category="Carbonated (Glass)",
            quantity_per_unit=12,
            packaging_profile=self.profile,
            packaging_type="RETURNABLE",
        )
        self.container = ContainerType.objects.create(
            code="POS-GLASS-330",
            name="330ml Glass Bottle",
            material=ContainerType.Material.GLASS,
            deposit_amount=Decimal("2.00"),
            is_returnable=True,
        )
        ProductPackaging.objects.create(
            product=self.product,
            container_type=self.container,
            packaging_profile=self.profile,
            containers_per_case=12,
            is_primary=True,
            is_returnable=True,
            deposit_amount=Decimal("2.00"),
            case_deposit_amount=Decimal("24.00"),
        )
        inventory = Inventory.objects.create(warehouse=self.warehouse, product=self.product, quantity=2)
        StockBatch.objects.create(
            batch_number="POS-BATCH-001",
            inventory=inventory,
            quantity=2,
            receipt_date=timezone.now(),
        )
        token = create_token({"type": "staff", "userId": self.staff.id, "role": RoleType.WAREHOUSE_STAFF})
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    def _post_json(self, path: str, payload: dict):
        return self.client.post(path, data=json.dumps(payload), content_type="application/json", **self.auth)

    def test_retail_products_require_authorized_assigned_warehouse_staff(self):
        self.assertEqual(self.client.get("/api/retail/products").status_code, 401)
        response = self.client.get("/api/retail/products", **self.auth)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["products"][0]["availableBaseUnits"], 24)

    def test_immediate_sale_is_idempotent_and_hidden_from_regular_orders(self):
        payload = {
            "warehouseId": self.warehouse.id,
            "customerType": "WALK_IN",
            "fulfillmentType": "IMMEDIATE",
            "items": [{"mode": "LOOSE", "productId": self.product.id, "quantity": 2, "emptyBottlesProvided": 1}],
            "amountPaid": "62.00",
        }
        quoted = self._post_json("/api/retail/quote", payload)
        self.assertEqual(quoted.status_code, 200, quoted.content)
        payload.update({"quoteToken": quoted.json()["quoteToken"], "idempotencyKey": "pos-request-001"})

        created = self._post_json("/api/retail/sales", payload)
        repeated = self._post_json("/api/retail/sales", payload)

        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(repeated.status_code, 200, repeated.content)
        self.assertEqual(created.json()["sale"]["id"], repeated.json()["sale"]["id"])
        self.assertEqual(Order.objects.filter(sales_channel="RETAIL_POS").count(), 1)
        self.assertEqual(
            InventoryTransaction.objects.filter(reference_type="retail_sale", type="OUT").count(),
            1,
        )
        regular_orders = self.client.get("/api/orders", **self.auth)
        self.assertEqual(regular_orders.status_code, 200)
        self.assertEqual(regular_orders.json()["orders"], [])

    def test_pickup_reserves_then_consumes_stock_once(self):
        payload = {
            "warehouseId": self.warehouse.id,
            "customerType": "WALK_IN",
            "fulfillmentType": "CUSTOMER_PICKUP",
            "items": [{"mode": "CASE", "productId": self.product.id, "quantity": 1, "emptyBottlesProvided": 0}],
            "amountPaid": "324.00",
        }
        quoted = self._post_json("/api/retail/quote", payload).json()
        payload.update({"quoteToken": quoted["quoteToken"], "idempotencyKey": "pos-pickup-001"})
        created = self._post_json("/api/retail/sales", payload)
        self.assertEqual(created.status_code, 201, created.content)
        sale_id = created.json()["sale"]["id"]
        inventory = Inventory.objects.get(warehouse=self.warehouse, product=self.product)
        self.assertEqual((inventory.quantity, inventory.reserved_quantity), (2, 1))

        ready = self.client.patch(
            f"/api/retail/sales/{sale_id}/pickup-status",
            data=json.dumps({"warehouseId": self.warehouse.id, "pickupStatus": "READY_FOR_PICKUP"}),
            content_type="application/json",
            **self.auth,
        )
        completed = self.client.patch(
            f"/api/retail/sales/{sale_id}/pickup-status",
            data=json.dumps({"warehouseId": self.warehouse.id, "pickupStatus": "PICKED_UP_COMPLETED"}),
            content_type="application/json",
            **self.auth,
        )
        repeated = self.client.patch(
            f"/api/retail/sales/{sale_id}/pickup-status",
            data=json.dumps({"warehouseId": self.warehouse.id, "pickupStatus": "PICKED_UP_COMPLETED"}),
            content_type="application/json",
            **self.auth,
        )
        self.assertEqual(ready.status_code, 200, ready.content)
        self.assertEqual(completed.status_code, 200, completed.content)
        self.assertEqual(repeated.status_code, 200, repeated.content)
        inventory.refresh_from_db()
        self.assertEqual((inventory.quantity, inventory.reserved_quantity), (1, 0))
        self.assertEqual(InventoryTransaction.objects.filter(reference_type="retail_sale", type="OUT").count(), 1)

    def test_alcohol_is_deposit_exempt_even_with_glass_packaging(self):
        alcohol = Product.objects.create(
            sku="POS-ALCOHOL-12",
            name="POS Alcohol",
            unit="case",
            price=600,
            retail_unit_price=Decimal("55.00"),
            case_price=Decimal("600.00"),
            category="Alcohol",
            quantity_per_unit=12,
            packaging_profile=self.profile,
            packaging_type="RETURNABLE",
        )
        ProductPackaging.objects.create(
            product=alcohol,
            container_type=self.container,
            packaging_profile=self.profile,
            containers_per_case=12,
            is_primary=True,
            is_returnable=True,
            deposit_amount=Decimal("2.00"),
            case_deposit_amount=Decimal("24.00"),
        )
        alcohol_inventory = Inventory.objects.create(warehouse=self.warehouse, product=alcohol, quantity=1)
        StockBatch.objects.create(
            batch_number="POS-ALCOHOL-BATCH",
            inventory=alcohol_inventory,
            quantity=1,
            receipt_date=timezone.now(),
        )
        response = self._post_json("/api/retail/quote", {
            "warehouseId": self.warehouse.id,
            "customerType": "WALK_IN",
            "fulfillmentType": "IMMEDIATE",
            "items": [{"mode": "CASE", "productId": alcohol.id, "quantity": 1, "emptyBottlesProvided": 0}],
            "amountPaid": "600.00",
        })
        self.assertEqual(response.status_code, 200, response.content)
        quoted_item = response.json()["quote"]["items"][0]
        self.assertTrue(quoted_item["depositExempt"])
        self.assertEqual(quoted_item["deposit"], "0.00")

    def test_completed_sale_cancellation_adds_compensating_audits(self):
        payload = {
            "warehouseId": self.warehouse.id,
            "customerType": "WALK_IN",
            "fulfillmentType": "IMMEDIATE",
            "items": [{"mode": "LOOSE", "productId": self.product.id, "quantity": 2, "emptyBottlesProvided": 1}],
            "amountPaid": "62.00",
        }
        quoted = self._post_json("/api/retail/quote", payload).json()
        payload.update({"quoteToken": quoted["quoteToken"], "idempotencyKey": "pos-cancel-001"})
        created = self._post_json("/api/retail/sales", payload)
        sale_id = created.json()["sale"]["id"]
        original_return = BottleReturn.objects.get(order_id=sale_id, status=BottleReturn.ReturnStatus.ACCEPTED)

        cancelled = self._post_json(
            f"/api/retail/sales/{sale_id}/cancel",
            {
                "warehouseId": self.warehouse.id,
                "reason": "Test cancellation",
                "emptiesRestoredToCustomer": True,
            },
        )
        self.assertEqual(cancelled.status_code, 200, cancelled.content)
        original_return.refresh_from_db()
        self.assertEqual(original_return.status, BottleReturn.ReturnStatus.ACCEPTED)
        self.assertTrue(BottleReturn.objects.filter(order_id=sale_id, status=BottleReturn.ReturnStatus.REJECTED).exists())
        self.assertTrue(InventoryTransaction.objects.filter(reference_type="retail_sale_reversal", type="IN").exists())
        self.assertTrue(DepositTransaction.objects.filter(reference_type="retail_sale_cancellation").exists())
