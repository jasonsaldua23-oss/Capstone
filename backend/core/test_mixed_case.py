import json
import threading
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.db import close_old_connections, connection, transaction
from django.db.models import Sum
from django.test import RequestFactory, TestCase, TransactionTestCase, skipUnlessDBFeature
from django.utils import timezone

from .mixed_case import (
    consume_order_reservations,
    normalize_checkout_items,
    receive_component_return,
    release_order_reservations,
    reserve_order_item,
)
from .models import (
    Customer,
    Inventory,
    InventoryReservation,
    MixedCaseComponent,
    Order,
    OrderItem,
    OrderItemType,
    OrderStatus,
    PackagingProfile,
    Product,
    Replacement,
    ReplacementLine,
    StockBatch,
    Warehouse,
)
from .views_api import orders_collection


class MixedCaseFixtureMixin:
    def build_fixture(self, *, case_stock=10):
        self.warehouse = Warehouse.objects.create(
            name="Main Warehouse",
            code="WH-0001",
            address="1 Warehouse Road",
            city="Silay",
            province="Negros Occidental",
            zip_code="6116",
        )
        self.customer = Customer.objects.create(
            email="mixed@example.com",
            password="hashed",
            name="Mixed Customer",
        )
        self.profile = PackagingProfile.objects.create(
            code="BOTTLE-12OZ-24",
            name="12 oz glass bottle",
            container_type="Glass bottle",
            container_size="12 oz",
            standard_units_per_case=24,
            allowed_mixed_case_capacities=[12, 24],
            compatibility_key="glass|12oz|24",
            base_unit_label="bottle",
        )
        self.products = []
        for index, name in enumerate(["Pepsi", "Mountain Dew", "Orange"]):
            product = Product.objects.create(
                sku=f"SKU-{index}",
                name=name,
                unit="case",
                price=175 + index * 25,
                category="Carbonated(Glass)",
                sizes=["12oz"],
                quantity_per_unit=24,
                packaging_profile=self.profile,
            )
            inventory = Inventory.objects.create(
                warehouse=self.warehouse,
                product=product,
                quantity=case_stock,
                threshold=1,
            )
            StockBatch.objects.create(
                batch_number=f"BATCH-{index}",
                inventory=inventory,
                quantity=case_stock,
                receipt_date="2026-01-01T00:00:00Z",
                expiry_date="2027-01-01T00:00:00Z",
            )
            self.products.append(product)

    def create_order(self, number="ORD-MIXED-1"):
        return Order.objects.create(
            order_number=number,
            customer=self.customer,
            subtotal=0,
            total_amount=0,
            warehouse_id=self.warehouse.id,
        )

    def create_mixed_item(self, *, case_count=1, quantities=(12, 12), number="ORD-MIXED-1"):
        normalized, _ = normalize_checkout_items(
            [
                {
                    "itemType": "MIXED_CASE",
                    "caseCapacity": sum(quantities),
                    "quantity": case_count,
                    "components": [
                        {"productId": self.products[index].id, "quantity": quantity}
                        for index, quantity in enumerate(quantities)
                    ],
                }
            ]
        )
        payload = normalized[0]
        order = self.create_order(number)
        item = OrderItem.objects.create(
            order=order,
            item_type=OrderItemType.MIXED_CASE,
            product_name="Mixed Case",
            product_unit="mixed_case",
            case_capacity=payload["caseCapacity"],
            quantity=case_count,
            unit_price=float(payload["unitPrice"]),
            total_price=float(payload["totalPrice"]),
        )
        for component in payload["components"]:
            product = component["product"]
            MixedCaseComponent.objects.create(
                order_item=item,
                product=product,
                product_name=product.name,
                product_sku=product.sku,
                base_unit_label=component["baseUnitLabel"],
                quantity_per_case=component["quantityPerCase"],
                case_count=case_count,
                total_base_units=component["totalBaseUnits"],
                unit_price=component["unitPrice"],
                component_subtotal=component["componentSubtotal"],
            )
        return order, item


class MixedCaseValidationTests(MixedCaseFixtureMixin, TestCase):
    def setUp(self):
        self.build_fixture()

    def test_half_and_half_quote_uses_component_units_not_two_case_prices(self):
        items, subtotal = normalize_checkout_items(
            [{
                "itemType": "MIXED_CASE",
                "caseCapacity": 24,
                "quantity": 1,
                "components": [
                    {"productId": self.products[0].id, "quantity": 12},
                    {"productId": self.products[1].id, "quantity": 12},
                ],
                "unitPrice": 1,
                "totalPrice": 1,
            }]
        )
        self.assertEqual(items[0]["itemType"], OrderItemType.MIXED_CASE)
        self.assertEqual(items[0]["components"][0]["totalBaseUnits"], 12)
        self.assertEqual(subtotal, Decimal("187.50"))

    def test_unequal_three_product_mix_is_valid(self):
        items, _ = normalize_checkout_items(
            [{
                "itemType": "MIXED_CASE",
                "caseCapacity": 24,
                "quantity": 1,
                "components": [
                    {"productId": self.products[0].id, "quantity": 5},
                    {"productId": self.products[1].id, "quantity": 7},
                    {"productId": self.products[2].id, "quantity": 12},
                ],
            }]
        )
        self.assertEqual(len(items[0]["components"]), 3)

    def test_incomplete_duplicate_and_incompatible_mixes_are_rejected(self):
        with self.assertRaisesMessage(ValueError, "must total exactly 24"):
            normalize_checkout_items([{
                "itemType": "MIXED_CASE",
                "caseCapacity": 24,
                "quantity": 1,
                "components": [
                    {"productId": self.products[0].id, "quantity": 10},
                    {"productId": self.products[1].id, "quantity": 10},
                ],
            }])
        with self.assertRaisesMessage(ValueError, "cannot appear more than once"):
            normalize_checkout_items([{
                "itemType": "MIXED_CASE",
                "caseCapacity": 24,
                "quantity": 1,
                "components": [
                    {"productId": self.products[0].id, "quantity": 12},
                    {"productId": self.products[0].id, "quantity": 12},
                ],
            }])
        other_profile = PackagingProfile.objects.create(
            code="CAN-12OZ-24",
            name="12 oz can",
            container_type="Can",
            container_size="12 oz",
            standard_units_per_case=24,
            allowed_mixed_case_capacities=[24],
            compatibility_key="can|12oz|24",
        )
        self.products[1].packaging_profile = other_profile
        self.products[1].save(update_fields=["packaging_profile"])
        with self.assertRaisesMessage(ValueError, "same packaging compatibility"):
            normalize_checkout_items([{
                "itemType": "MIXED_CASE",
                "caseCapacity": 24,
                "quantity": 1,
                "components": [
                    {"productId": self.products[0].id, "quantity": 12},
                    {"productId": self.products[1].id, "quantity": 12},
                ],
            }])

    def test_fractional_or_malformed_quantities_are_rejected(self):
        for payload, message in [
            (
                {
                    "itemType": "MIXED_CASE",
                    "caseCapacity": 24.5,
                    "quantity": 1,
                    "components": [
                        {"productId": self.products[0].id, "quantity": 12},
                        {"productId": self.products[1].id, "quantity": 12},
                    ],
                },
                "Mixed Case capacity must be a positive whole number",
            ),
            (
                {
                    "itemType": "MIXED_CASE",
                    "caseCapacity": 24,
                    "quantity": 1.5,
                    "components": [
                        {"productId": self.products[0].id, "quantity": 12},
                        {"productId": self.products[1].id, "quantity": 12},
                    ],
                },
                "Mixed Case quantity must be a positive whole number",
            ),
            (
                {
                    "itemType": "MIXED_CASE",
                    "caseCapacity": 24,
                    "quantity": 1,
                    "components": [
                        {"productId": self.products[0].id, "quantity": 12.5},
                        {"productId": self.products[1].id, "quantity": 11.5},
                    ],
                },
                "Component quantity",
            ),
        ]:
            with self.subTest(message=message), self.assertRaisesMessage(ValueError, message):
                normalize_checkout_items([payload])

        with self.assertRaisesMessage(ValueError, "component must be an object"):
            normalize_checkout_items(
                [
                    {
                        "itemType": "MIXED_CASE",
                        "caseCapacity": 24,
                        "quantity": 1,
                        "components": ["invalid", {"productId": self.products[1].id, "quantity": 12}],
                    }
                ]
            )


class MixedCaseInventoryTests(MixedCaseFixtureMixin, TestCase):
    def setUp(self):
        self.build_fixture(case_stock=2)

    def test_delivery_deducts_exact_component_units_and_keeps_batch_remainders(self):
        order, item = self.create_mixed_item()
        reserve_order_item(item, "FEFO", "tester")
        consume_order_reservations(order, "tester")

        for product in self.products[:2]:
            inventory = Inventory.objects.get(product=product, warehouse=self.warehouse)
            batch = StockBatch.objects.get(inventory=inventory)
            self.assertEqual(inventory.quantity, 1)
            self.assertEqual(inventory.loose_bottles, 12)
            self.assertEqual(batch.quantity, 1)
            self.assertEqual(batch.loose_units, 12)
            self.assertEqual(inventory.reserved_base_units, 0)

    def test_delivery_rejects_a_batch_that_expired_after_reservation(self):
        order, item = self.create_mixed_item(number="ORD-EXPIRED-AFTER-RESERVE")
        reserve_order_item(item, "FEFO", "tester")
        first_reservation = InventoryReservation.objects.filter(order_item=item).order_by("id").first()
        StockBatch.objects.filter(id=first_reservation.stock_batch_id).update(
            expiry_date=timezone.now() - timedelta(seconds=1)
        )

        with self.assertRaisesMessage(ValueError, "has expired"):
            consume_order_reservations(order, "tester")

        self.assertEqual(
            set(InventoryReservation.objects.filter(order_item=item).values_list("status", flat=True)),
            {"RESERVED"},
        )
        for inventory in Inventory.objects.filter(warehouse=self.warehouse):
            self.assertEqual(inventory.quantity, 2)
            self.assertEqual(inventory.loose_bottles, 0)

    def test_insufficient_component_stock_rolls_back_the_entire_reservation(self):
        unavailable_inventory = Inventory.objects.get(
            product=self.products[1],
            warehouse=self.warehouse,
        )
        unavailable_inventory.quantity = 0
        unavailable_inventory.save(update_fields=["quantity", "updated_at"])
        unavailable_inventory.batches.update(quantity=0)
        order, item = self.create_mixed_item(number="ORD-INSUFFICIENT")

        with self.assertRaisesMessage(ValueError, "Insufficient stock"):
            reserve_order_item(item, "FEFO", "tester")

        self.assertFalse(InventoryReservation.objects.filter(order_item=item).exists())
        for inventory in Inventory.objects.filter(warehouse=self.warehouse):
            inventory.refresh_from_db()
            self.assertEqual(inventory.reserved_base_units, 0)

    def test_multiple_mixed_cases_multiply_component_quantities(self):
        order, item = self.create_mixed_item(case_count=2)
        reserve_order_item(item, "FEFO", "tester")
        self.assertEqual(
            InventoryReservation.objects.filter(order_item=item).aggregate(total=Sum("quantity_base_units"))["total"],
            48,
        )
        consume_order_reservations(order, "tester")
        for product in self.products[:2]:
            inventory = Inventory.objects.get(product=product, warehouse=self.warehouse)
            self.assertEqual(inventory.quantity, 1)
            self.assertEqual(inventory.loose_bottles, 0)

    def test_cancellation_releases_without_deducting(self):
        order, item = self.create_mixed_item()
        reserve_order_item(item, "FEFO", "tester")
        release_order_reservations(order, "tester")
        for product in self.products[:2]:
            inventory = Inventory.objects.get(product=product, warehouse=self.warehouse)
            self.assertEqual(inventory.quantity, 2)
            self.assertEqual(inventory.loose_bottles, 0)
            self.assertEqual(inventory.reserved_base_units, 0)

    def test_reserving_the_same_order_item_twice_is_rejected(self):
        _, item = self.create_mixed_item(number="ORD-REPEAT-RESERVE")
        reserve_order_item(item, "FEFO", "tester")

        with self.assertRaisesMessage(ValueError, "already has inventory reservations"):
            reserve_order_item(item, "FEFO", "tester")

        self.assertEqual(InventoryReservation.objects.filter(order_item=item).count(), 2)

    def test_fefo_and_fifo_choose_the_expected_source_batch(self):
        product = self.products[0]
        inventory = Inventory.objects.get(product=product, warehouse=self.warehouse)
        original = StockBatch.objects.get(inventory=inventory)
        original.quantity = 1
        original.receipt_date = "2026-01-01T00:00:00Z"
        original.expiry_date = "2027-12-01T00:00:00Z"
        original.save(update_fields=["quantity", "receipt_date", "expiry_date"])
        expiring_first = StockBatch.objects.create(
            batch_number="BATCH-EARLY-EXPIRY",
            inventory=inventory,
            quantity=1,
            receipt_date="2026-02-01T00:00:00Z",
            expiry_date="2027-06-01T00:00:00Z",
        )

        fefo_order, fefo_item = self.create_mixed_item(number="ORD-FEFO")
        reserve_order_item(fefo_item, "FEFO", "tester")
        fefo_component = fefo_item.mixed_case_components.get(product=product)
        fefo_reservation = InventoryReservation.objects.get(mixed_case_component=fefo_component)
        self.assertEqual(fefo_reservation.stock_batch_id, expiring_first.id)
        release_order_reservations(fefo_order, "tester")

        _, fifo_item = self.create_mixed_item(number="ORD-FIFO")
        reserve_order_item(fifo_item, "FIFO", "tester")
        fifo_component = fifo_item.mixed_case_components.get(product=product)
        fifo_reservation = InventoryReservation.objects.get(mixed_case_component=fifo_component)
        self.assertEqual(fifo_reservation.stock_batch_id, original.id)

    def test_expired_and_inactive_batches_are_never_reserved(self):
        product = self.products[0]
        inventory = Inventory.objects.get(product=product, warehouse=self.warehouse)
        valid_batch = StockBatch.objects.get(inventory=inventory)
        valid_batch.receipt_date = timezone.now() - timedelta(days=10)
        valid_batch.expiry_date = timezone.now() + timedelta(days=30)
        valid_batch.save(update_fields=["receipt_date", "expiry_date", "updated_at"])
        StockBatch.objects.create(
            batch_number="BATCH-EXPIRED",
            inventory=inventory,
            quantity=1,
            receipt_date=timezone.now() - timedelta(days=60),
            expiry_date=timezone.now() - timedelta(days=1),
            status="ACTIVE",
        )
        StockBatch.objects.create(
            batch_number="BATCH-HELD",
            inventory=inventory,
            quantity=1,
            receipt_date=timezone.now() - timedelta(days=30),
            expiry_date=timezone.now() + timedelta(days=10),
            status="QUARANTINED",
        )

        for policy in ("FEFO", "FIFO"):
            order, item = self.create_mixed_item(number=f"ORD-{policy}-ELIGIBLE")
            reserve_order_item(item, policy, "tester")
            component = item.mixed_case_components.get(product=product)
            self.assertEqual(
                InventoryReservation.objects.get(mixed_case_component=component).stock_batch_id,
                valid_batch.id,
            )
            release_order_reservations(order, "tester")

    def test_ineligible_batch_loose_units_are_not_treated_as_unbatched_stock(self):
        product = self.products[0]
        inventory = Inventory.objects.get(product=product, warehouse=self.warehouse)
        inventory.quantity = 0
        inventory.loose_bottles = 12
        inventory.save(update_fields=["quantity", "loose_bottles", "updated_at"])
        inventory.batches.update(quantity=0, loose_units=0)
        StockBatch.objects.create(
            batch_number="BATCH-EXPIRED-LOOSE",
            inventory=inventory,
            quantity=0,
            loose_units=12,
            receipt_date=timezone.now() - timedelta(days=60),
            expiry_date=timezone.now() - timedelta(days=1),
            status="ACTIVE",
        )
        _, item = self.create_mixed_item(number="ORD-EXPIRED-LOOSE")

        with self.assertRaisesMessage(ValueError, "Insufficient allocatable stock"):
            reserve_order_item(item, "FEFO", "tester")

        self.assertFalse(InventoryReservation.objects.filter(order_item=item).exists())

    def test_partial_component_returns_restore_only_received_units_once(self):
        order, item = self.create_mixed_item()
        reserve_order_item(item, "FEFO", "tester")
        consume_order_reservations(order, "tester")
        component = item.mixed_case_components.select_related("product").order_by("id").first()
        replacement = Replacement.objects.create(
            replacement_number="RPL-RETURN-1",
            order=order,
            customer_id=self.customer.id,
            reason="Damaged",
            pickup_address="1 Warehouse Road",
            pickup_city="Silay",
            pickup_province="Negros Occidental",
            pickup_zip_code="6116",
        )
        line = ReplacementLine.objects.create(
            replacement=replacement,
            original_order_item=item,
            mixed_case_component=component,
            product=component.product,
            product_name=component.product_name,
            product_sku=component.product_sku,
            base_unit_label="bottle",
            requested_base_units=12,
            reason="Damaged",
        )
        first = receive_component_return(
            replacement=replacement,
            request_id="return-1",
            returned_lines=[{"replacementLineId": line.id, "quantityBaseUnits": 5}],
            performed_by="tester",
        )
        duplicate = receive_component_return(
            replacement=replacement,
            request_id="return-1",
            returned_lines=[{"replacementLineId": line.id, "quantityBaseUnits": 5}],
            performed_by="tester",
        )
        self.assertEqual(first.id, duplicate.id)
        inventory = Inventory.objects.get(product=component.product, warehouse=self.warehouse)
        self.assertEqual(inventory.loose_bottles, 17)
        receive_component_return(
            replacement=replacement,
            request_id="return-2",
            returned_lines=[{"replacementLineId": line.id, "quantityBaseUnits": 7}],
            performed_by="tester",
        )
        inventory.refresh_from_db()
        line.refresh_from_db()
        self.assertEqual(inventory.loose_bottles, 24)
        self.assertEqual(line.returned_base_units, 12)

    def test_depleted_source_batch_is_preserved_and_reactivated_by_return(self):
        for inventory in Inventory.objects.filter(warehouse=self.warehouse):
            inventory.quantity = 1
            inventory.save(update_fields=["quantity", "updated_at"])
            inventory.batches.update(quantity=1, loose_units=0, status="ACTIVE")

        order, item = self.create_mixed_item(case_count=2, number="ORD-DEPLETED-RETURN")
        reserve_order_item(item, "FEFO", "tester")
        consume_order_reservations(order, "tester")

        component = item.mixed_case_components.select_related("product").order_by("id").first()
        reservation = InventoryReservation.objects.get(mixed_case_component=component)
        source_batch_id = reservation.stock_batch_id
        source_batch = StockBatch.objects.get(id=source_batch_id)
        self.assertEqual(source_batch.quantity, 0)
        self.assertEqual(source_batch.loose_units, 0)
        self.assertEqual(source_batch.status, "DEPLETED")

        replacement = Replacement.objects.create(
            replacement_number="RPL-DEPLETED-RETURN",
            order=order,
            customer_id=self.customer.id,
            reason="Damaged",
            pickup_address="1 Warehouse Road",
            pickup_city="Silay",
            pickup_province="Negros Occidental",
            pickup_zip_code="6116",
        )
        line = ReplacementLine.objects.create(
            replacement=replacement,
            original_order_item=item,
            mixed_case_component=component,
            product=component.product,
            product_name=component.product_name,
            product_sku=component.product_sku,
            base_unit_label="bottle",
            requested_base_units=24,
            reason="Damaged",
        )
        receive_component_return(
            replacement=replacement,
            request_id="depleted-return-1",
            returned_lines=[{"replacementLineId": line.id, "quantityBaseUnits": 24}],
            performed_by="tester",
        )

        source_batch.refresh_from_db()
        inventory = Inventory.objects.get(product=component.product, warehouse=self.warehouse)
        self.assertEqual(source_batch.loose_units, 24)
        self.assertEqual(source_batch.status, "ACTIVE")
        self.assertEqual(inventory.quantity, 0)
        self.assertEqual(inventory.loose_bottles, 24)


class MixedCaseApiTests(MixedCaseFixtureMixin, TestCase):
    def setUp(self):
        self.build_fixture(case_stock=2)
        self.factory = RequestFactory()

    def test_checkout_is_server_priced_and_idempotent(self):
        payload = {
            "requestId": "checkout-idempotent-1",
            "shippingName": "Mixed Customer",
            "shippingPhone": "09123456789",
            "shippingAddress": "1 Test Road",
            "shippingCity": "Silay",
            "shippingProvince": "Negros Occidental",
            "shippingZipCode": "6100",
            "shippingLatitude": 10.6765,
            "shippingLongitude": 122.9509,
            "items": [
                {
                    "itemType": "MIXED_CASE",
                    "caseCapacity": 24,
                    "quantity": 1,
                    "unitPrice": 0.01,
                    "components": [
                        {"productId": self.products[0].id, "quantity": 12, "unitPrice": 0.01},
                        {"productId": self.products[1].id, "quantity": 12, "unitPrice": 0.01},
                    ],
                }
            ],
        }
        auth = {"type": "customer", "userId": self.customer.id, "name": self.customer.name}

        def submit():
            request = self.factory.post("/api/orders", data=json.dumps(payload), content_type="application/json")
            with patch("core.views_api._require_auth", return_value=auth), patch(
                "core.views_api._email_new_order_to_warehouse_staff"
            ):
                response = orders_collection(request)
            return response, json.loads(response.content)

        first_response, first = submit()
        second_response, second = submit()
        self.assertEqual(first_response.status_code, 201, first)
        self.assertEqual(second_response.status_code, 200, second)
        self.assertFalse(first.get("duplicate", False))
        self.assertTrue(second.get("duplicate"))
        self.assertEqual(Order.objects.filter(request_id=payload["requestId"]).count(), 1)
        self.assertEqual(Decimal(str(first["order"]["totalAmount"])), Decimal("187.5"))
        self.assertEqual(first["order"]["items"][0]["itemType"], "MIXED_CASE")
        self.assertEqual(len(first["order"]["items"][0]["components"]), 2)
        created_order = Order.objects.get(request_id=payload["requestId"])
        self.assertEqual(created_order.status, OrderStatus.PENDING)
        # Checkout records a pending request only; stock is reserved later from
        # the latest inventory state when warehouse staff approve the request.
        self.assertFalse(
            InventoryReservation.objects.filter(order_item__order=created_order).exists()
        )


class MixedCaseConcurrencyTests(MixedCaseFixtureMixin, TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        self.build_fixture(case_stock=1)

    @skipUnlessDBFeature("has_select_for_update")
    def test_simultaneous_standard_orders_cannot_oversell(self):
        product = self.products[0]
        item_ids = []
        for index in range(2):
            order = self.create_order(f"ORD-CONCURRENT-{index}")
            item = OrderItem.objects.create(
                order=order,
                product=product,
                product_name=product.name,
                product_sku=product.sku,
                product_unit="case",
                quantity=1,
                unit_price=product.price,
                total_price=product.price,
            )
            item_ids.append(item.id)

        barrier = threading.Barrier(2)
        results: list[str] = []
        lock = threading.Lock()

        def worker(item_id):
            close_old_connections()
            try:
                item = OrderItem.objects.select_related("order", "product__packaging_profile").get(id=item_id)
                barrier.wait(timeout=10)
                with transaction.atomic():
                    reserve_order_item(item, "FEFO", "tester")
                result = "reserved"
            except Exception:
                result = "rejected"
            finally:
                close_old_connections()
            with lock:
                results.append(result)

        threads = [threading.Thread(target=worker, args=(item_id,)) for item_id in item_ids]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=15)

        self.assertEqual(sorted(results), ["rejected", "reserved"])
        inventory = Inventory.objects.get(product=product, warehouse=self.warehouse)
        self.assertEqual(inventory.reserved_quantity, 1)
        self.assertEqual(inventory.reserved_base_units, 24)
