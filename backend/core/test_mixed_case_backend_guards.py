import json
import threading
from datetime import timedelta
from unittest.mock import patch

from django.db import close_old_connections, connection
from django.test import RequestFactory, TestCase, TransactionTestCase, skipUnlessDBFeature
from django.utils import timezone
from django.test.utils import CaptureQueriesContext

from .mixed_case import available_base_units, consume_order_reservations, reserve_order_item
from .models import (
    Customer,
    Inventory,
    InventoryReservation,
    InventoryTransaction,
    Order,
    OrderItem,
    OrderStatus,
    OrderTimeline,
    Replacement,
    ReplacementLine,
    RoleType,
    StockBatch,
    User,
)
from .test_mixed_case import MixedCaseFixtureMixin
from .views_api import (
    _create_scheduled_replacement_order,
    _mark_order_delivered,
    customer_order_cancel,
    inventory_detail,
    customer_replacements,
    inventory_transactions_list,
    orders_collection,
    product_detail,
    products_collection,
    stock_batches_collection,
)


class MixedCaseBackendGuardTests(MixedCaseFixtureMixin, TestCase):
    def setUp(self):
        self.build_fixture(case_stock=2)
        self.factory = RequestFactory()
        self.customer_auth = {
            "type": "customer",
            "userId": self.customer.id,
            "name": self.customer.name,
        }
        self.admin_auth = {
            "type": "staff",
            "userId": "admin-guard",
            "name": "Admin Guard",
            "role": RoleType.ADMIN,
        }
        self.warehouse_operator = User.objects.create(
            email="mixed-guard-warehouse@example.test",
            password="hashed",
            name="Mixed Guard Warehouse",
            role=RoleType.WAREHOUSE_STAFF,
        )
        self.warehouse.manager_id = self.warehouse_operator.id
        self.warehouse.save(update_fields=["manager_id", "updated_at"])
        self.warehouse_auth = {
            "type": "staff",
            "userId": self.warehouse_operator.id,
            "name": self.warehouse_operator.name,
            "role": RoleType.WAREHOUSE_STAFF,
        }

    def _checkout_payload(self, request_id="checkout-guard-1"):
        payload = {
            "shippingName": self.customer.name,
            "shippingPhone": "09123456789",
            "shippingAddress": "1 Guard Road",
            "shippingCity": "Silay",
            "shippingProvince": "Negros Occidental",
            "shippingZipCode": "6116",
            "shippingLatitude": 10.6765,
            "shippingLongitude": 122.9509,
            "items": [
                {
                    "itemType": "MIXED_CASE",
                    "caseCapacity": 24,
                    "quantity": 1,
                    "components": [
                        {"productId": self.products[0].id, "quantity": 12},
                        {"productId": self.products[1].id, "quantity": 12},
                    ],
                }
            ],
        }
        if request_id is not None:
            payload["requestId"] = request_id
        return payload

    def _post_order(self, payload):
        request = self.factory.post(
            "/api/orders",
            data=json.dumps(payload),
            content_type="application/json",
        )
        with patch("core.views_api._require_auth", return_value=self.customer_auth), patch(
            "core.views_api._email_new_order_to_warehouse_staff"
        ):
            return orders_collection(request)

    def _delivered_mixed_order(self, number="ORD-REPLACEMENT-GUARD"):
        order, item = self.create_mixed_item(number=number)
        order.status = OrderStatus.DELIVERED
        order.save(update_fields=["status", "updated_at"])
        OrderTimeline.objects.create(order=order, delivered_at=timezone.now())
        return order, item

    def _replacement_payload(self, item, component, quantity):
        return {
            "orderId": item.order_id,
            "numberDamagedItems": quantity,
            "damageType": "Damaged bottle",
            "evidence": ["evidence.jpg"],
            "replacementLines": [
                {
                    "originalOrderItemId": item.id,
                    "mixedCaseComponentId": component.id,
                    "inputMode": "bottle",
                    "quantityToReplace": quantity,
                    "quantityToReplaceBottles": quantity,
                    "reason": "Damaged bottle",
                }
            ],
        }

    def _post_replacement(self, payload):
        request = self.factory.post(
            "/api/customer/replacements",
            data=json.dumps(payload),
            content_type="application/json",
        )
        with patch("core.views_api._require_auth", return_value=self.customer_auth), patch(
            "core.views_api._create_staff_notifications"
        ), patch("core.views_api._create_customer_notification"), patch(
            "core.views_api._send_transactional_email"
        ):
            return customer_replacements(request)

    def test_checkout_rejects_past_delivery_date(self):
        payload = self._checkout_payload("checkout-past-delivery")
        payload["deliveryDate"] = (timezone.localdate() - timedelta(days=1)).isoformat()

        response = self._post_order(payload)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            json.loads(response.content)["error"],
            "Delivery date cannot be in the past. Choose today or a future date.",
        )
        self.assertFalse(Order.objects.filter(request_id="checkout-past-delivery").exists())

    def test_checkout_retry_expires_an_existing_past_due_request(self):
        payload = self._checkout_payload("checkout-expired-retry")
        payload["deliveryDate"] = (timezone.localdate() + timedelta(days=1)).isoformat()
        created_response = self._post_order(payload)
        self.assertEqual(created_response.status_code, 201)

        order = Order.objects.get(request_id="checkout-expired-retry")
        order.timeline.delivery_date = timezone.now() - timedelta(days=1)
        order.timeline.save(update_fields=["delivery_date", "updated_at"])

        retry_response = self._post_order(payload)

        self.assertEqual(retry_response.status_code, 200)
        self.assertTrue(json.loads(retry_response.content)["duplicate"])
        order.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.CANCELLED)

    def test_customer_checkout_owns_order_and_ignores_lifecycle_and_charge_tampering(self):
        other_customer = Customer.objects.create(
            email="other-checkout@example.test",
            password="hashed",
            name="Other Customer",
        )
        payload = self._checkout_payload()
        payload.update(
            {
                "customerId": other_customer.id,
                "status": OrderStatus.DELIVERED,
                "paymentStatus": "paid",
                "tax": -1000,
                "shippingCost": -500,
                "totalAmount": 1,
            }
        )

        response = self._post_order(payload)
        self.assertEqual(response.status_code, 403, response.content)
        self.assertFalse(Order.objects.filter(request_id=payload["requestId"]).exists())

        payload["customerId"] = self.customer.id
        response = self._post_order(payload)
        self.assertEqual(response.status_code, 201, response.content)
        created = Order.objects.get(request_id=payload["requestId"])
        self.assertEqual(created.status, OrderStatus.PENDING)
        self.assertEqual(created.payment_status, "pending")
        self.assertNotIn("tax", {field.name for field in Order._meta.fields})
        self.assertEqual(json.loads(response.content)["order"]["shippingCost"], 0)
        self.assertEqual(created.total_amount, 187.5)

    def test_checkout_rejects_a_mixed_case_that_favours_one_product(self):
        payload = self._checkout_payload("checkout-lopsided-mix")
        payload["items"][0]["components"] = [
            {"productId": self.products[0].id, "quantity": 18},
            {"productId": self.products[1].id, "quantity": 6},
        ]

        response = self._post_order(payload)

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn(
            "A 24-unit Mixed Case allows at most 12 units of one product",
            json.loads(response.content)["error"],
        )
        self.assertFalse(Order.objects.filter(request_id="checkout-lopsided-mix").exists())

    def test_customer_checkout_allows_legacy_missing_request_id_and_bounds_supplied_ids(self):
        missing = self._post_order(self._checkout_payload(request_id=None))
        too_long = self._post_order(self._checkout_payload(request_id="x" * 121))
        self.assertEqual(missing.status_code, 201)
        self.assertEqual(too_long.status_code, 400)
        self.assertEqual(Order.objects.count(), 1)

    def test_duplicate_replacement_lines_are_capped_after_merge(self):
        _, item = self._delivered_mixed_order()
        component = item.mixed_case_components.order_by("id").first()
        payload = self._replacement_payload(item, component, 8)
        payload["replacementLines"].append(dict(payload["replacementLines"][0]))

        response = self._post_replacement(payload)
        self.assertEqual(response.status_code, 400, response.content)
        self.assertFalse(Replacement.objects.exists())

    def test_replacement_claims_are_capped_across_active_requests(self):
        _, item = self._delivered_mixed_order(number="ORD-CUMULATIVE-CLAIM")
        component = item.mixed_case_components.order_by("id").first()

        first = self._post_replacement(self._replacement_payload(item, component, 8))
        second = self._post_replacement(self._replacement_payload(item, component, 5))

        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(second.status_code, 400, second.content)
        self.assertEqual(ReplacementLine.objects.count(), 1)
        self.assertEqual(ReplacementLine.objects.get().requested_base_units, 8)

    def test_standard_replacement_cap_uses_server_capacity_and_rejects_fractional_quantity(self):
        order = self.create_order("ORD-STANDARD-CLAIM-GUARD")
        order.status = OrderStatus.DELIVERED
        order.save(update_fields=["status", "updated_at"])
        OrderTimeline.objects.create(order=order, delivered_at=timezone.now())
        item = OrderItem.objects.create(
            order=order,
            product=self.products[0],
            product_name=self.products[0].name,
            product_sku=self.products[0].sku,
            product_unit="case",
            quantity=1,
            unit_price=self.products[0].price,
            total_price=self.products[0].price,
        )
        payload = {
            "orderId": order.id,
            "numberDamagedItems": 25,
            "damageType": "Damaged bottle",
            "evidence": ["evidence.jpg"],
            "replacementLines": [
                {
                    "originalOrderItemId": item.id,
                    "quantityPerCase": 9999,
                    "quantityToReplace": 25,
                    "quantityToReplaceBottles": 25,
                    "reason": "Damaged bottle",
                }
            ],
        }
        over_cap = self._post_replacement(payload)
        payload["replacementLines"][0]["quantityToReplace"] = 12.5
        payload["replacementLines"][0]["quantityToReplaceBottles"] = 12.5
        fractional = self._post_replacement(payload)
        self.assertEqual(over_cap.status_code, 400, over_cap.content)
        self.assertEqual(fractional.status_code, 400, fractional.content)
        self.assertFalse(Replacement.objects.exists())

    def test_product_edits_require_a_warehouse_operator(self):
        driver = {"type": "staff", "userId": "driver-1", "role": RoleType.DRIVER}
        product_request = self.factory.put(
            f"/api/products/{self.products[0].id}",
            data=json.dumps({"name": "Forbidden Driver Edit"}),
            content_type="application/json",
        )
        with patch("core.views_api._require_auth", return_value=driver), patch(
            "core.views_api._require_staff", return_value=(driver, None)
        ):
            denied = product_detail(product_request, self.products[0].id)
        self.assertEqual(denied.status_code, 403)

    def test_product_opening_stock_is_batch_backed_and_fractional_stock_is_rejected(self):
        create_request = self.factory.post(
            "/api/products",
            data=json.dumps(
                {
                    "sku": "OPENING-STOCK-GUARD",
                    "name": "Opening Stock Guard",
                    "unit": "case",
                    "price": 150,
                    "warehouseId": self.warehouse.id,
                    "category": "Carbonated (Glass)",
                    "sizes": ["12oz"],
                    "quantityPerCase": 24,
                    "availableQuantity": 3,
                }
            ),
            content_type="application/json",
        )
        with patch("core.views_api._require_auth", return_value=self.warehouse_auth), patch(
            "core.views_api._require_staff", return_value=(self.warehouse_auth, None)
        ), patch("core.views_api._create_staff_notifications"):
            created_response = products_collection(create_request)
        self.assertEqual(created_response.status_code, 201, created_response.content)

        created_id = json.loads(created_response.content)["product"]["id"]
        inventory = Inventory.objects.get(product_id=created_id, warehouse=self.warehouse)
        opening_batch = StockBatch.objects.get(inventory=inventory)
        self.assertEqual(inventory.quantity, 3)
        self.assertEqual(opening_batch.quantity, 3)
        self.assertEqual(opening_batch.loose_units, 0)
        self.assertEqual(opening_batch.status, "ACTIVE")
        self.assertIsNone(opening_batch.expiry_date)
        self.assertTrue(
            InventoryTransaction.objects.filter(
                product_id=created_id,
                reference_type="stock_batch",
                reference_id=opening_batch.id,
                type="IN",
                quantity=3,
            ).exists()
        )

        fractional_request = self.factory.post(
            "/api/products",
            data=json.dumps(
                {
                    "sku": "FRACTIONAL-STOCK-GUARD",
                    "name": "Fractional Stock Guard",
                    "unit": "case",
                    "price": 150,
                    "warehouseId": self.warehouse.id,
                    "category": "Carbonated (Glass)",
                    "sizes": ["12oz"],
                    "quantityPerCase": 24,
                    "availableQuantity": 1.5,
                }
            ),
            content_type="application/json",
        )
        with patch("core.views_api._require_auth", return_value=self.warehouse_auth), patch(
            "core.views_api._require_staff", return_value=(self.warehouse_auth, None)
        ):
            fractional_response = products_collection(fractional_request)
        self.assertEqual(fractional_response.status_code, 400, fractional_response.content)

    def test_batch_adjustment_rejects_active_reservation_and_lists_loose_only_batch(self):
        _, item = self.create_mixed_item(number="ORD-BATCH-GUARD")
        reserve_order_item(item, "FEFO", "guard")
        reservation = InventoryReservation.objects.filter(order_item=item).order_by("id").first()

        put_request = self.factory.put(
            "/api/stock-batches",
            data=json.dumps({"batchId": reservation.stock_batch_id, "quantity": 0}),
            content_type="application/json",
        )
        with patch("core.views_api._require_staff", return_value=(self.warehouse_auth, None)):
            guarded = stock_batches_collection(put_request)
        self.assertEqual(guarded.status_code, 409, guarded.content)

        loose_batch = StockBatch.objects.get(inventory__product=self.products[2])
        loose_batch.quantity = 0
        loose_batch.loose_units = 5
        loose_batch.save(update_fields=["quantity", "loose_units", "updated_at"])
        get_request = self.factory.get("/api/stock-batches")
        with patch("core.views_api._require_staff", return_value=(self.warehouse_auth, None)):
            listed = stock_batches_collection(get_request)
        payload = json.loads(listed.content)
        self.assertIn(loose_batch.id, {row["id"] for row in payload["stockBatches"]})

    def test_inventory_adjustments_are_ledgered_and_keep_reserved_counters_nonnegative(self):
        inventory = Inventory.objects.get(product=self.products[0], warehouse=self.warehouse)
        quantity_request = self.factory.put(
            f"/api/inventory/{inventory.id}",
            data=json.dumps({"quantity": 1}),
            content_type="application/json",
        )
        reserved_request = self.factory.put(
            f"/api/inventory/{inventory.id}",
            data=json.dumps({"reservedQuantity": 0}),
            content_type="application/json",
        )
        with patch("core.views_api._require_staff", return_value=(self.warehouse_auth, None)):
            quantity_response = inventory_detail(quantity_request, inventory.id)
            reserved_response = inventory_detail(reserved_request, inventory.id)
        self.assertEqual(quantity_response.status_code, 200, quantity_response.content)
        self.assertEqual(reserved_response.status_code, 200, reserved_response.content)
        inventory.refresh_from_db()
        self.assertEqual(inventory.quantity, 1)
        self.assertGreaterEqual(inventory.reserved_quantity, 0)

    def test_manual_depletion_preserves_a_batch_referenced_by_reservation_history(self):
        order, item = self.create_mixed_item(number="ORD-REFERENCED-BATCH-ADJUST")
        component = item.mixed_case_components.filter(product=self.products[2]).first()
        if component is None:
            component = item.mixed_case_components.order_by("id").first()
        inventory = Inventory.objects.get(product=component.product, warehouse=self.warehouse)
        batch = StockBatch.objects.get(inventory=inventory)
        InventoryReservation.objects.create(
            order_item=item,
            mixed_case_component=component,
            inventory=inventory,
            stock_batch=batch,
            product=component.product,
            quantity_base_units=24,
            status="CONSUMED",
            consumed_at=timezone.now(),
        )

        request = self.factory.put(
            "/api/stock-batches",
            data=json.dumps({"batchId": batch.id, "quantity": 0}),
            content_type="application/json",
        )
        with patch("core.views_api._require_staff", return_value=(self.warehouse_auth, None)):
            response = stock_batches_collection(request)
        self.assertEqual(response.status_code, 200, response.content)
        batch.refresh_from_db()
        self.assertEqual(batch.quantity, 0)
        self.assertEqual(batch.status, "DEPLETED")

    def test_quote_and_product_availability_exclude_expired_and_held_batches(self):
        product = self.products[0]
        inventory = Inventory.objects.get(product=product, warehouse=self.warehouse)
        valid_batch = StockBatch.objects.get(inventory=inventory)
        valid_batch.quantity = 1
        valid_batch.expiry_date = timezone.now() + timedelta(days=30)
        valid_batch.save(update_fields=["quantity", "expiry_date", "updated_at"])
        StockBatch.objects.create(
            batch_number="BATCH-EXPIRED-AVAILABILITY",
            inventory=inventory,
            quantity=8,
            receipt_date=timezone.now() - timedelta(days=60),
            expiry_date=timezone.now() - timedelta(days=1),
            status="ACTIVE",
        )
        StockBatch.objects.create(
            batch_number="BATCH-HELD-AVAILABILITY",
            inventory=inventory,
            quantity=4,
            receipt_date=timezone.now() - timedelta(days=30),
            expiry_date=timezone.now() + timedelta(days=30),
            status="QUARANTINED",
        )
        inventory.quantity = 13
        inventory.save(update_fields=["quantity", "updated_at"])

        # Quotes use the allocator's batch-aware availability check. Expired and
        # quarantined batches leave only one full case (24 bottles) sellable.
        self.assertEqual(available_base_units(inventory, product), 24)
        self.assertLess(available_base_units(inventory, product), 3 * 12)

        products_request = self.factory.get("/api/products", {"pageSize": 100})
        with patch("core.views_api._require_auth", return_value=self.customer_auth):
            products_response = products_collection(products_request)
        product_payload = next(
            row for row in json.loads(products_response.content)["products"] if row["id"] == product.id
        )
        self.assertEqual(product_payload["availableBaseUnits"], 24)
        self.assertEqual(product_payload["availableQuantity"], 1)

    def test_transaction_composition_queries_do_not_grow_with_order_items(self):
        # Fix regression: sibling lookup cost stays constant as history grows.
        def read_query_count():
            request = self.factory.get("/api/inventory-transactions", {"pageSize": 100})
            with patch("core.views_api._require_staff", return_value=(self.admin_auth, None)):
                with CaptureQueriesContext(connection) as queries:
                    response = inventory_transactions_list(request)
            self.assertEqual(response.status_code, 200, response.content)
            return len(queries)

        order, item = self.create_mixed_item(number="ORD-QUERY-ONE")
        reserve_order_item(item, "FEFO", "guard")
        consume_order_reservations(order, "guard")
        first_count = read_query_count()
        order, item = self.create_mixed_item(number="ORD-QUERY-TWO")
        reserve_order_item(item, "FEFO", "guard")
        consume_order_reservations(order, "guard")
        self.assertEqual(read_query_count(), first_count)

    def test_inventory_transaction_mixed_case_payload_includes_all_sibling_components(self):
        order, item = self.create_mixed_item(number="ORD-TRANSACTION-COMPOSITION")
        reserve_order_item(item, "FEFO", "guard")
        consume_order_reservations(order, "guard")

        request = self.factory.get("/api/inventory-transactions", {"pageSize": 100})
        with patch("core.views_api._require_staff", return_value=(self.admin_auth, None)):
            response = inventory_transactions_list(request)
        self.assertEqual(response.status_code, 200, response.content)
        transactions = json.loads(response.content)["transactions"]
        mixed_out = next(row for row in transactions if row["type"] == "OUT" and row.get("mixedCase"))
        components = mixed_out["mixedCase"]["components"]
        self.assertEqual(len(components), 2)
        self.assertEqual({row["productId"] for row in components}, {self.products[0].id, self.products[1].id})
        self.assertEqual({row["quantityPerCase"] for row in components}, {12})
        self.assertTrue(all(row["totalBaseUnits"] == 12 for row in components))
        self.assertTrue(all(row["unitPrice"] > 0 for row in components))
        self.assertTrue(all(row["componentSubtotal"] > 0 for row in components))


class MixedCaseBackendGuardConcurrencyTests(MixedCaseFixtureMixin, TransactionTestCase):
    # IDs are strings; SQLite no longer has an autoincrement table to reset.
    reset_sequences = False

    def setUp(self):
        self.build_fixture(case_stock=2)

    @skipUnlessDBFeature("has_select_for_update")
    def test_concurrent_replacement_scheduling_is_singleton_and_delivery_updates_progress(self):
        order, item = self.create_mixed_item(number="ORD-CONCURRENT-SCHEDULE")
        component = item.mixed_case_components.select_related("product").order_by("id").first()
        replacement = Replacement.objects.create(
            replacement_number="RPL-CONCURRENT-SCHEDULE",
            order=order,
            customer_id=self.customer.id,
            reason="Damaged",
            pickup_address="1 Guard Road",
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
        barrier = threading.Barrier(2)
        results = []
        result_lock = threading.Lock()

        def worker():
            close_old_connections()
            try:
                local_replacement = Replacement.objects.get(id=replacement.id)
                barrier.wait(timeout=10)
                scheduled = _create_scheduled_replacement_order(
                    local_replacement,
                    scheduled_date=(timezone.now() + timedelta(days=1)).date(),
                    staff_user_id="admin-guard",
                )
                result = scheduled.id
            except Exception as exc:  # pragma: no cover - assertion reports exact failure
                result = f"ERROR:{type(exc).__name__}:{exc}"
            finally:
                close_old_connections()
            with result_lock:
                results.append(result)

        threads = [threading.Thread(target=worker) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=20)

        self.assertEqual(len(results), 2)
        self.assertFalse(any(result.startswith("ERROR:") for result in results), results)
        self.assertEqual(len(set(results)), 1)
        self.assertEqual(Order.objects.filter(order_number__startswith="RPL-").count(), 1)

        scheduled_order = Order.objects.get(id=results[0])
        _mark_order_delivered(scheduled_order, "admin-guard")
        line.refresh_from_db()
        self.assertEqual(line.replaced_base_units, 12)
        _mark_order_delivered(scheduled_order, "admin-guard")
        line.refresh_from_db()
        self.assertEqual(line.replaced_base_units, 12)

    @skipUnlessDBFeature("has_select_for_update")
    def test_delivery_and_customer_cancellation_finish_in_one_consistent_state(self):
        order, item = self.create_mixed_item(number="ORD-CANCEL-DELIVER-RACE")
        reserve_order_item(item, "FEFO", "guard")
        delivery_holds_order = threading.Event()
        allow_delivery = threading.Event()
        cancellation_started = threading.Event()
        results = {}
        original_finalize = __import__(
            "core.views_api", fromlist=["_finalize_order_inventory_on_delivery"]
        )._finalize_order_inventory_on_delivery

        def paused_finalize(*args, **kwargs):
            delivery_holds_order.set()
            allow_delivery.wait(timeout=10)
            return original_finalize(*args, **kwargs)

        def deliver_worker():
            close_old_connections()
            try:
                local_order = Order.objects.get(id=order.id)
                _mark_order_delivered(local_order, "guard")
                results["delivery"] = "delivered"
            except Exception as exc:  # pragma: no cover - assertion reports exact failure
                results["delivery"] = f"ERROR:{type(exc).__name__}:{exc}"
            finally:
                close_old_connections()

        def cancel_worker():
            close_old_connections()
            try:
                cancellation_started.set()
                request = RequestFactory().patch(f"/api/customer/orders/{order.id}/cancel")
                auth = {"type": "customer", "userId": self.customer.id, "name": self.customer.name}
                with patch("core.views_api._require_auth", return_value=auth):
                    response = customer_order_cancel(request, order.id)
                results["cancel"] = response.status_code
            finally:
                close_old_connections()

        with patch(
            "core.views_api._finalize_order_inventory_on_delivery",
            side_effect=paused_finalize,
        ):
            delivery_thread = threading.Thread(target=deliver_worker)
            delivery_thread.start()
            self.assertTrue(delivery_holds_order.wait(timeout=10))
            cancel_thread = threading.Thread(target=cancel_worker)
            cancel_thread.start()
            self.assertTrue(cancellation_started.wait(timeout=10))
            allow_delivery.set()
            delivery_thread.join(timeout=20)
            cancel_thread.join(timeout=20)

        self.assertEqual(results.get("delivery"), "delivered", results)
        self.assertEqual(results.get("cancel"), 400, results)
        order.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.DELIVERED)
        self.assertEqual(
            set(InventoryReservation.objects.filter(order_item__order=order).values_list("status", flat=True)),
            {"CONSUMED"},
        )
