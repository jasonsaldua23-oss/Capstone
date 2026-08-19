import json
import threading
from datetime import timedelta
from unittest.mock import patch

from django.db import close_old_connections
from django.test import RequestFactory, TestCase, TransactionTestCase, skipUnlessDBFeature
from django.utils import timezone

from .mixed_case import consume_order_reservations, receive_component_return, reserve_order_item
from .models import (
    Customer,
    Inventory,
    InventoryReservation,
    InventoryTransaction,
    Order,
    OrderItem,
    OrderStatus,
    OrderTimeline,
    PackagingProfile,
    Replacement,
    ReplacementLine,
    ReturnReceipt,
    RoleType,
    StockBatch,
)
from .test_mixed_case import MixedCaseFixtureMixin
from .views_api import (
    _create_scheduled_replacement_order,
    _mark_order_delivered,
    customer_order_cancel,
    inventory_detail,
    customer_replacements,
    inventory_transactions_list,
    mixed_case_quote,
    orders_collection,
    packaging_profile_detail,
    packaging_profiles_collection,
    product_detail,
    products_collection,
    replacement_receive_return,
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
        self.assertEqual(response.status_code, 201, response.content)
        created = Order.objects.get(request_id=payload["requestId"])
        self.assertEqual(created.customer_id, self.customer.id)
        self.assertEqual(created.status, OrderStatus.PENDING)
        self.assertEqual(created.payment_status, "pending")
        self.assertEqual(created.tax, 0)
        self.assertEqual(created.shipping_cost, 0)
        self.assertEqual(created.total_amount, 187.5)

    def test_customer_checkout_requires_bounded_request_id(self):
        missing = self._post_order(self._checkout_payload(request_id=None))
        too_long = self._post_order(self._checkout_payload(request_id="x" * 121))
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(too_long.status_code, 400)
        self.assertEqual(Order.objects.count(), 0)

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

    def test_returns_are_capped_across_replacement_lines_for_the_same_source(self):
        order, item = self.create_mixed_item(number="ORD-CUMULATIVE-RETURN")
        reserve_order_item(item, "FEFO", "guard")
        consume_order_reservations(order, "guard")
        component = item.mixed_case_components.select_related("product").order_by("id").first()

        lines = []
        for index in range(2):
            replacement = Replacement.objects.create(
                replacement_number=f"RPL-CUMULATIVE-RETURN-{index}",
                order=order,
                customer_id=self.customer.id,
                reason="Damaged",
                pickup_address="1 Guard Road",
                pickup_city="Silay",
                pickup_province="Negros Occidental",
                pickup_zip_code="6116",
            )
            lines.append(
                ReplacementLine.objects.create(
                    replacement=replacement,
                    original_order_item=item,
                    mixed_case_component=component,
                    product=component.product,
                    product_name=component.product_name,
                    product_sku=component.product_sku,
                    base_unit_label="bottle",
                    requested_base_units=8,
                    reason="Damaged",
                )
            )

        receive_component_return(
            replacement=lines[0].replacement,
            request_id="cumulative-return-1",
            returned_lines=[{"replacementLineId": lines[0].id, "quantityBaseUnits": 8}],
            performed_by="guard",
        )
        with self.assertRaisesMessage(ValueError, "remaining consumed source allocation"):
            receive_component_return(
                replacement=lines[1].replacement,
                request_id="cumulative-return-2",
                returned_lines=[{"replacementLineId": lines[1].id, "quantityBaseUnits": 5}],
                performed_by="guard",
            )
        self.assertFalse(ReturnReceipt.objects.filter(request_id="cumulative-return-2").exists())
        inventory = Inventory.objects.get(product=component.product, warehouse=self.warehouse)
        self.assertEqual(inventory.loose_bottles, 20)

    def test_packaging_and_product_capacity_changes_are_guarded_and_admin_only(self):
        driver = {"type": "staff", "userId": "driver-1", "role": RoleType.DRIVER}
        create_request = self.factory.post(
            "/api/packaging-profiles",
            data=json.dumps(
                {
                    "code": "DRIVER-PROFILE",
                    "name": "Driver Profile",
                    "containerType": "Bottle",
                    "containerSize": "1 L",
                    "standardUnitsPerCase": 12,
                }
            ),
            content_type="application/json",
        )
        with patch("core.views_api._require_auth", return_value=driver), patch(
            "core.views_api._require_staff", return_value=(driver, None)
        ):
            denied = packaging_profiles_collection(create_request)
        self.assertEqual(denied.status_code, 403)

        profile_request = self.factory.put(
            f"/api/packaging-profiles/{self.profile.id}",
            data=json.dumps({"standardUnitsPerCase": 12}),
            content_type="application/json",
        )
        with patch("core.views_api._require_auth", return_value=self.admin_auth), patch(
            "core.views_api._require_staff", return_value=(self.admin_auth, None)
        ):
            profile_response = packaging_profile_detail(profile_request, self.profile.id)
        self.assertEqual(profile_response.status_code, 409, profile_response.content)

        product_request = self.factory.put(
            f"/api/products/{self.products[0].id}",
            data=json.dumps({"packagingProfileId": "", "quantityPerCase": 12}),
            content_type="application/json",
        )
        with patch("core.views_api._require_auth", return_value=self.admin_auth), patch(
            "core.views_api._require_staff", return_value=(self.admin_auth, None)
        ):
            product_response = product_detail(product_request, self.products[0].id)
        self.assertEqual(product_response.status_code, 409, product_response.content)

    def test_product_opening_stock_is_batch_backed_and_fractional_stock_is_rejected(self):
        create_request = self.factory.post(
            "/api/products",
            data=json.dumps(
                {
                    "sku": "OPENING-STOCK-GUARD",
                    "name": "Opening Stock Guard",
                    "unit": "case",
                    "price": 150,
                    "packagingProfileId": self.profile.id,
                    "availableQuantity": 3,
                }
            ),
            content_type="application/json",
        )
        with patch("core.views_api._require_auth", return_value=self.admin_auth), patch(
            "core.views_api._require_staff", return_value=(self.admin_auth, None)
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
                    "packagingProfileId": self.profile.id,
                    "availableQuantity": 1.5,
                }
            ),
            content_type="application/json",
        )
        with patch("core.views_api._require_auth", return_value=self.admin_auth), patch(
            "core.views_api._require_staff", return_value=(self.admin_auth, None)
        ):
            fractional_response = products_collection(fractional_request)
        self.assertEqual(fractional_response.status_code, 400, fractional_response.content)

    def test_return_receiving_role_gate_allows_warehouse_but_not_driver(self):
        order = self.create_order("ORD-RETURN-ROLE")
        replacement = Replacement.objects.create(
            replacement_number="RPL-RETURN-ROLE",
            order=order,
            customer_id=self.customer.id,
            reason="Damaged",
            pickup_address="1 Guard Road",
            pickup_city="Silay",
            pickup_province="Negros Occidental",
            pickup_zip_code="6116",
        )
        request = self.factory.post(
            f"/api/replacements/{replacement.id}/receive-return",
            data=json.dumps({}),
            content_type="application/json",
        )
        driver = {"type": "staff", "userId": "driver-1", "role": RoleType.DRIVER}
        warehouse = {"type": "staff", "userId": "warehouse-1", "role": RoleType.WAREHOUSE_STAFF}
        with patch("core.views_api._require_staff", return_value=(driver, None)):
            denied = replacement_receive_return(request, replacement.id)
        with patch("core.views_api._require_staff", return_value=(warehouse, None)):
            allowed_to_validate = replacement_receive_return(request, replacement.id)
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(allowed_to_validate.status_code, 400)

    def test_batch_adjustment_rejects_active_reservation_and_lists_loose_only_batch(self):
        _, item = self.create_mixed_item(number="ORD-BATCH-GUARD")
        reserve_order_item(item, "FEFO", "guard")
        reservation = InventoryReservation.objects.filter(order_item=item).order_by("id").first()

        put_request = self.factory.put(
            "/api/stock-batches",
            data=json.dumps({"batchId": reservation.stock_batch_id, "quantity": 0}),
            content_type="application/json",
        )
        with patch("core.views_api._require_staff", return_value=(self.admin_auth, None)):
            guarded = stock_batches_collection(put_request)
        self.assertEqual(guarded.status_code, 409, guarded.content)

        loose_batch = StockBatch.objects.get(inventory__product=self.products[2])
        loose_batch.quantity = 0
        loose_batch.loose_units = 5
        loose_batch.save(update_fields=["quantity", "loose_units", "updated_at"])
        get_request = self.factory.get("/api/stock-batches")
        with patch("core.views_api._require_staff", return_value=(self.admin_auth, None)):
            listed = stock_batches_collection(get_request)
        payload = json.loads(listed.content)
        self.assertIn(loose_batch.id, {row["id"] for row in payload["stockBatches"]})

    def test_batch_backed_inventory_and_reserved_counters_cannot_be_edited_directly(self):
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
        with patch("core.views_api._require_staff", return_value=(self.admin_auth, None)):
            quantity_response = inventory_detail(quantity_request, inventory.id)
            reserved_response = inventory_detail(reserved_request, inventory.id)
        self.assertEqual(quantity_response.status_code, 409, quantity_response.content)
        self.assertEqual(reserved_response.status_code, 400, reserved_response.content)

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
        with patch("core.views_api._require_staff", return_value=(self.admin_auth, None)):
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

        quote_request = self.factory.post(
            "/api/mixed-case/quote",
            data=json.dumps(
                {
                    "caseCapacity": 24,
                    "quantity": 3,
                    "components": [
                        {"productId": product.id, "quantity": 12},
                        {"productId": self.products[1].id, "quantity": 12},
                    ],
                }
            ),
            content_type="application/json",
        )
        with patch("core.views_api._require_auth", return_value=self.customer_auth):
            quote_response = mixed_case_quote(quote_request)
        self.assertEqual(quote_response.status_code, 409, quote_response.content)

        products_request = self.factory.get("/api/products", {"pageSize": 100})
        with patch("core.views_api._require_auth", return_value=self.customer_auth):
            products_response = products_collection(products_request)
        product_payload = next(
            row for row in json.loads(products_response.content)["products"] if row["id"] == product.id
        )
        self.assertEqual(product_payload["availableBaseUnits"], 24)
        self.assertEqual(product_payload["availableQuantity"], 1)

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
    reset_sequences = True

    def setUp(self):
        self.build_fixture(case_stock=2)

    @skipUnlessDBFeature("has_select_for_update")
    def test_concurrent_return_retry_creates_one_receipt_and_restores_once(self):
        order, item = self.create_mixed_item(number="ORD-CONCURRENT-RETURN")
        reserve_order_item(item, "FEFO", "guard")
        consume_order_reservations(order, "guard")
        component = item.mixed_case_components.select_related("product").order_by("id").first()
        replacement = Replacement.objects.create(
            replacement_number="RPL-CONCURRENT-RETURN",
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
                receipt = receive_component_return(
                    replacement=local_replacement,
                    request_id="concurrent-return-key",
                    returned_lines=[{"replacementLineId": line.id, "quantityBaseUnits": 5}],
                    performed_by="guard",
                )
                result = receipt.id
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
        self.assertEqual(ReturnReceipt.objects.filter(request_id="concurrent-return-key").count(), 1)
        inventory = Inventory.objects.get(product=component.product, warehouse=self.warehouse)
        self.assertEqual(inventory.loose_bottles, 17)

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
