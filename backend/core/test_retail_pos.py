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
    Product,
    ProductPackaging,
    RoleType,
    StockBatch,
    User,
    Warehouse,
)
from .retail_pos import _quote_mixed_line, calculate_deposit_amount, calculate_sale_totals


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
            Decimal("114.00"),
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
            Decimal("38.00"),
        )

    def test_empty_quantity_cannot_exceed_eligible_bottles(self):
        with self.assertRaisesMessage(ValueError, "cannot exceed"):
            calculate_deposit_amount(
                mode="LOOSE",
                eligible_units=12,
                empty_units=13,
                unit_deposit=Decimal("2.00"),
            )

    def test_sale_totals_do_not_include_ui_cash_or_balances(self):
        totals = calculate_sale_totals(Decimal("600"), Decimal("24"))
        self.assertEqual(totals, {
            "productTotal": Decimal("600.00"),
            "deposit": Decimal("24.00"),
            "grandTotal": Decimal("624.00"),
        })

    def test_mixed_case_rejects_more_than_two_products(self):
        with self.assertRaisesMessage(ValueError, "only two different products"):
            _quote_mixed_line(
                {
                    "quantity": 1,
                    "caseCapacity": 12,
                    "components": [
                        {"productId": "product-1", "quantityBaseUnits": 4},
                        {"productId": "product-2", "quantityBaseUnits": 4},
                        {"productId": "product-3", "quantityBaseUnits": 4},
                    ],
                },
                {},
            )


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
        self.product = Product.objects.create(
            sku="POS-COLA-12",
            name="POS Cola",
            unit="case",
            price=300,
            retail_unit_price=Decimal("30.00"),
            case_price=Decimal("300.00"),
            category="Carbonated (Glass)",
            sizes=["330ml"],
            quantity_per_unit=12,
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

    def test_catalog_exposes_registered_selling_unit(self):
        # Packs and bottles use their registered label even when sold through the CASE mode.
        for unit in ["case", "pack", "bottle"]:
            with self.subTest(unit=unit):
                self.product.unit = unit
                self.product.save(update_fields=["unit"])
                response = self.client.get("/api/retail/products", **self.auth)
                self.assertEqual(response.status_code, 200)
                product = response.json()["products"][0]
                self.assertEqual(product["unit"], unit)
                self.assertEqual(product["caseQuantity"], 12)
                self.assertEqual(product["casePrice"], "300.00")

    def test_mixed_case_requires_equal_whole_bottle_split(self):
        # A 24-bottle case made from two products must be 12 + 12, never 13 + 11.
        self.product.quantity_per_unit = 24
        self.product.save(update_fields=["quantity_per_unit"])
        self.product.packaging_options.update(containers_per_case=24)
        second = Product.objects.create(
            sku="POS-LEMON-24",
            name="POS Lemon",
            unit="case",
            price=300,
            retail_unit_price=Decimal("30.00"),
            case_price=Decimal("600.00"),
            category="Carbonated (Glass)",
            sizes=["330ml"],
            quantity_per_unit=24,
            packaging_type="RETURNABLE",
        )
        ProductPackaging.objects.create(
            product=second,
            container_type=self.container,
            containers_per_case=24,
            is_primary=True,
            is_returnable=True,
            deposit_amount=Decimal("2.00"),
            case_deposit_amount=Decimal("24.00"),
        )
        products = {self.product.id: self.product, second.id: second}

        valid = _quote_mixed_line(
            {
                "quantity": 1,
                "caseCapacity": 24,
                "components": [
                    {"productId": self.product.id, "quantityBaseUnits": 12},
                    {"productId": second.id, "quantityBaseUnits": 12},
                ],
            },
            products,
        )
        self.assertEqual([row["quantityPerCase"] for row in valid["components"]], [12, 12])

        with self.assertRaisesMessage(ValueError, "exactly 12 bottles per case"):
            _quote_mixed_line(
                {
                    "quantity": 1,
                    "caseCapacity": 24,
                    "components": [
                        {"productId": self.product.id, "quantityBaseUnits": 13},
                        {"productId": second.id, "quantityBaseUnits": 11},
                    ],
                },
                products,
            )

    def test_immediate_sale_is_idempotent_and_hidden_from_regular_orders(self):
        payload = {
            "warehouseId": self.warehouse.id,
            "customerType": "WALK_IN",
            "walkIn": {"name": "Juan Dela Cruz", "contactNumber": "09171234567"},
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
        self.assertRegex(created.json()["sale"]["transactionNumber"], r"^RCP-\d{4}-\d{4}$")
        self.assertEqual(created.json()["sale"]["items"][0]["sizes"], ["330ml"])
        self.assertEqual(Order.objects.filter(sales_channel="RETAIL_POS").count(), 1)
        # Regression: verify the physical deduction and the Inventory panel's API,
        # not merely that a sale/ledger row exists. A retry must not deduct again.
        inventory = Inventory.objects.get(warehouse=self.warehouse, product=self.product)
        self.assertEqual((inventory.quantity, inventory.loose_bottles), (1, 10))
        batch = StockBatch.objects.get(inventory=inventory)
        self.assertEqual((batch.quantity, batch.loose_units), (1, 10))
        stock_response = self.client.get("/api/inventory", **self.auth)
        self.assertEqual(stock_response.status_code, 200, stock_response.content)
        stock_row = next(row for row in stock_response.json()["inventory"] if row["id"] == inventory.id)
        self.assertEqual((stock_row["quantity"], stock_row["looseBottles"]), (1, 10))
        stock_out = InventoryTransaction.objects.get(reference_type="retail_sale", type="OUT")
        # The receipt links each purchased line to its real inventory transaction.
        self.assertEqual(created.json()["sale"]["items"][0]["inventoryTransactionIds"], [stock_out.id])
        regular_orders = self.client.get("/api/orders", **self.auth)
        self.assertEqual(regular_orders.status_code, 200)
        self.assertEqual(regular_orders.json()["orders"], [])

    def test_walk_in_sale_rejects_invalid_philippine_phone(self):
        payload = {
            "warehouseId": self.warehouse.id,
            "customerType": "WALK_IN",
            "walkIn": {"name": "Juan Dela Cruz", "contactNumber": "12345"},
            "fulfillmentType": "IMMEDIATE",
            "items": [{"mode": "LOOSE", "productId": self.product.id, "quantity": 1, "emptyBottlesProvided": 0}],
            "amountPaid": "32.00",
        }
        quoted = self._post_json("/api/retail/quote", payload)
        self.assertEqual(quoted.status_code, 200, quoted.content)
        payload.update({"quoteToken": quoted.json()["quoteToken"], "idempotencyKey": "invalid-phone-001"})

        created = self._post_json("/api/retail/sales", payload)

        self.assertEqual(created.status_code, 400, created.content)
        self.assertEqual(created.json()["error"], "Please enter a valid Philippine mobile number")
        self.assertFalse(Order.objects.filter(retail_sale__retail_request_id="invalid-phone-001").exists())

    def test_walk_in_sale_rejects_numbers_in_customer_name(self):
        payload = {
            "warehouseId": self.warehouse.id,
            "customerType": "WALK_IN",
            "walkIn": {"name": "Juan 123 Dela Cruz", "contactNumber": "09171234567"},
            "fulfillmentType": "IMMEDIATE",
            "items": [{"mode": "LOOSE", "productId": self.product.id, "quantity": 1, "emptyBottlesProvided": 0}],
            "amountPaid": "32.00",
        }
        quoted = self._post_json("/api/retail/quote", payload)
        self.assertEqual(quoted.status_code, 200, quoted.content)
        payload.update({"quoteToken": quoted.json()["quoteToken"], "idempotencyKey": "invalid-name-001"})

        created = self._post_json("/api/retail/sales", payload)

        self.assertEqual(created.status_code, 400, created.content)
        self.assertEqual(created.json()["error"], "Names cannot contain numbers.")
        self.assertFalse(Order.objects.filter(retail_sale__retail_request_id="invalid-name-001").exists())

    def test_retail_checkout_consumes_stock_once_without_pickup_or_payment_fields(self):
        # Stale UI-only cash fields must never be saved or returned as accounting data.
        payload = {
            "warehouseId": self.warehouse.id,
            "customerType": "WALK_IN",
            "walkIn": {"name": "Juan Dela Cruz", "contactNumber": "09171234567"},
            "items": [{"mode": "CASE", "productId": self.product.id, "quantity": 1, "emptyBottlesProvided": 0}],
            "amountPaid": "324.00",
        }
        quoted = self._post_json("/api/retail/quote", payload).json()
        payload.update({"quoteToken": quoted["quoteToken"], "idempotencyKey": "pos-immediate-001"})
        created = self._post_json("/api/retail/sales", payload)
        self.assertEqual(created.status_code, 201, created.content)
        repeated = self._post_json("/api/retail/sales", payload)
        self.assertEqual(repeated.json()["sale"]["id"], created.json()["sale"]["id"])
        for field in ["amountPaid", "remainingBalance", "fulfillmentType", "pickupStatus", "change"]:
            self.assertNotIn(field, created.json()["sale"])
        inventory = Inventory.objects.get(warehouse=self.warehouse, product=self.product)
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
            packaging_type="RETURNABLE",
        )
        ProductPackaging.objects.create(
            product=alcohol,
            container_type=self.container,
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
            "walkIn": {"name": "Juan Dela Cruz", "contactNumber": "09171234567"},
            "fulfillmentType": "IMMEDIATE",
            "items": [{"mode": "CASE", "productId": alcohol.id, "quantity": 1, "emptyBottlesProvided": 0}],
            "amountPaid": "600.00",
        })
        self.assertEqual(response.status_code, 200, response.content)
        quoted_item = response.json()["quote"]["items"][0]
        self.assertTrue(quoted_item["depositExempt"])
        self.assertEqual(quoted_item["deposit"], "0.00")

    def test_sale_lines_report_the_selling_unit(self):
        # Reports labelled every counter line "cases"; a pack product's line is a pack.
        self.product.unit = "Pack (Bundle)"
        self.product.save(update_fields=["unit"])
        payload = {
            "warehouseId": self.warehouse.id,
            "customerType": "WALK_IN",
            "walkIn": {"name": "Juan Dela Cruz", "contactNumber": "09171234567"},
            "fulfillmentType": "IMMEDIATE",
            "items": [{"mode": "LOOSE", "productId": self.product.id, "quantity": 2, "emptyBottlesProvided": 1}],
            "amountPaid": "62.00",
        }
        payload.update({"quoteToken": self._post_json("/api/retail/quote", payload).json()["quoteToken"], "idempotencyKey": "pos-unit-001"})
        created = self._post_json("/api/retail/sales", payload)
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.json()["sale"]["items"][0]["unit"], "pack")

    def test_sales_list_summary_covers_every_sale_and_skips_cancelled(self):
        # Each sale: two loose bottles at 30.00, one empty returned, so 60.00 of goods
        # and 2.00 of deposit on the uncovered bottle.
        sale_ids = []
        for key in ("pos-summary-001", "pos-summary-002"):
            payload = {
                "warehouseId": self.warehouse.id,
                "customerType": "WALK_IN",
                "walkIn": {"name": "Juan Dela Cruz", "contactNumber": "09171234567"},
                "fulfillmentType": "IMMEDIATE",
                "items": [{"mode": "LOOSE", "productId": self.product.id, "quantity": 2, "emptyBottlesProvided": 1}],
                "amountPaid": "62.00",
            }
            payload.update({"quoteToken": self._post_json("/api/retail/quote", payload).json()["quoteToken"], "idempotencyKey": key})
            created = self._post_json("/api/retail/sales", payload)
            self.assertEqual(created.status_code, 201, created.content)
            sale_ids.append(created.json()["sale"]["id"])
        cancelled = self._post_json(
            f"/api/retail/sales/{sale_ids[0]}/cancel",
            {"warehouseId": self.warehouse.id, "reason": "Test cancellation", "emptiesRestoredToCustomer": True},
        )
        self.assertEqual(cancelled.status_code, 200, cancelled.content)

        # One row per page: the totals must still cover both sales.
        listed = self.client.get(f"/api/retail/sales?warehouseId={self.warehouse.id}&pageSize=1", **self.auth)
        self.assertEqual(listed.status_code, 200, listed.content)
        self.assertEqual(len(listed.json()["sales"]), 1)
        self.assertEqual(
            listed.json()["summary"],
            {"completedCount": 1, "cancelledCount": 1, "salesTotal": 60.0, "depositTotal": 2.0},
        )

    def test_completed_sale_cancellation_adds_compensating_audits(self):
        payload = {
            "warehouseId": self.warehouse.id,
            "customerType": "WALK_IN",
            "walkIn": {"name": "Juan Dela Cruz", "contactNumber": "09171234567"},
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
        # A two-bottle cancellation completes the remaining ten bottles into a case.
        inventory = Inventory.objects.get(warehouse=self.warehouse, product=self.product)
        batch = StockBatch.objects.get(inventory=inventory)
        self.assertEqual((inventory.quantity, inventory.loose_bottles), (2, 0))
        self.assertEqual((batch.quantity, batch.loose_units), (2, 0))
        original_return.refresh_from_db()
        self.assertEqual(original_return.status, BottleReturn.ReturnStatus.ACCEPTED)
        self.assertTrue(BottleReturn.objects.filter(order_id=sale_id, status=BottleReturn.ReturnStatus.REJECTED).exists())
        self.assertTrue(InventoryTransaction.objects.filter(reference_type="retail_sale_reversal", type="IN").exists())
        self.assertTrue(DepositTransaction.objects.filter(reference_type="retail_sale_cancellation").exists())
