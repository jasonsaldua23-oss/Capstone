"""Replacement request and warehouse replacement processing contracts."""

import json
from datetime import datetime, timedelta
from unittest.mock import patch

from django.test import Client, TestCase
from django.utils import timezone

from .auth import create_token
from .models import (
    Customer,
    Inventory,
    InventoryTransaction,
    Order,
    OrderItem,
    OrderTimeline,
    OrderStatus,
    Product,
    Replacement,
    ReplacementStatus,
    StockBatch,
    User,
    Warehouse,
)
from .views_api import (
    _create_scheduled_replacement_order,
    _mark_order_delivered,
    _replacement_product_lines,
    _serialize_replacement,
)
from .test_support import Role



class WarehouseReplacementProcessingContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        warehouse_role = Role.objects.create(name="WAREHOUSE_STAFF", description="Warehouse Staff")
        self.warehouse_user = User.objects.create(
            email="warehouse.replacement.processing@example.com",
            password="hashed",
            name="Warehouse Replacement User",
            role=warehouse_role,
            is_active=True,
        )
        self.warehouse = Warehouse.objects.create(
            name="Replacement Processing Warehouse",
            code="WH-REPL-PROCESS",
            address="Replacement Road",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            manager_id=self.warehouse_user.id,
            is_active=True,
        )
        self.customer = Customer.objects.create(
            email="warehouse.replacement.customer@example.com",
            password="hashed",
            name="Replacement Customer",
            is_active=True,
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

    def create_approved_replacement(self, suffix: str) -> Replacement:
        order = Order.objects.create(
            order_number=f"ORD-REPL-{suffix}",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            subtotal=100,
            total_amount=110,
            warehouse_id=self.warehouse.id,
        )
        return Replacement.objects.create(
            replacement_number=f"RET-{suffix}",
            order=order,
            customer_id=self.customer.id,
            reason="Damaged item",
            status=ReplacementStatus.APPROVED,
            replacement_mode="CUSTOMER_SUBMITTED",
        )

    @patch("core.views_api._email_replacement_outcome_to_customer")
    @patch("core.views_api._email_replacement_update_to_staff")
    def test_warehouse_starts_processing_before_scheduling_replacement(
        self,
        _email_staff,
        _email_customer,
    ) -> None:
        replacement = self.create_approved_replacement("PROCESS-001")

        response = self.client.patch(
            "/api/orders",
            data=json.dumps(
                {
                    "scope": "replacement",
                    "replacementId": replacement.id,
                    "status": "IN_PROGRESS",
                    "notes": "Warehouse started processing the approved replacement",
                }
            ),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.warehouse_token}",
        )

        self.assertEqual(response.status_code, 200, response.content)
        replacement.refresh_from_db()
        self.assertEqual(replacement.status, ReplacementStatus.IN_PROGRESS)

    def test_warehouse_cannot_schedule_replacement_before_starting_processing(self) -> None:
        replacement = self.create_approved_replacement("NO-SKIP-001")

        response = self.client.patch(
            "/api/orders",
            data=json.dumps(
                {
                    "scope": "replacement",
                    "replacementId": replacement.id,
                    "status": "IN_PROGRESS",
                    "createReplacementOrder": True,
                    "replacementDeliveryDate": (timezone.now() + timedelta(days=1)).date().isoformat(),
                    "manualScheduleConfirmed": True,
                }
            ),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.warehouse_token}",
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["error"], "Replacement is not eligible for warehouse scheduling yet")
        replacement.refresh_from_db()
        self.assertEqual(replacement.status, ReplacementStatus.APPROVED)


class CustomerReplacementRequestContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.customer = Customer.objects.create(
            email="replacement.customer@gmail.com",
            password="hashed",
            name="Replacement Customer",
            is_active=True,
        )
        self.customer_token = create_token(
            {
                "userId": self.customer.id,
                "email": self.customer.email,
                "name": self.customer.name,
                "role": "CUSTOMER",
                "type": "customer",
            }
        )
        self.order = Order.objects.create(
            order_number="ORD-REPL-CUSTOMER-001",
            customer=self.customer,
            status=OrderStatus.DELIVERED,
            subtotal=100,
            total_amount=110,
        )
        self.product_a = Product.objects.create(
            sku="SKU-REPL-A",
            name="Return Product A",
            unit="case",
            price=10,
            quantity_per_unit=6,
            sizes=["500ml"],
        )
        self.product_b = Product.objects.create(
            sku="SKU-REPL-B",
            name="Return Product B",
            unit="bottle",
            price=20,
            quantity_per_unit=12,
            sizes=["1L"],
        )
        self.order_item_a = OrderItem.objects.create(
            order=self.order,
            product=self.product_a,
            product_name=self.product_a.name,
            product_sku=self.product_a.sku,
            quantity=2,
            unit_price=10,
            total_price=20,
        )
        self.order_item_b = OrderItem.objects.create(
            order=self.order,
            product=self.product_b,
            product_name=self.product_b.name,
            product_sku=self.product_b.sku,
            quantity=1,
            unit_price=20,
            total_price=20,
        )

    def test_completed_replacement_serializes_linked_order_pod(self) -> None:
        pod_submitted_at = timezone.now()
        replacement_order = Order.objects.create(
            order_number="RPL-REPL-CUSTOMER-POD-001",
            customer=self.customer,
            status=OrderStatus.DELIVERED,
            subtotal=0,
            total_amount=0,
            pod_recipient_name="Replacement Receiver",
            pod_photo_url="https://example.com/replacement-pod-full.jpg",
            pod_submitted_at=pod_submitted_at,
        )
        replacement = Replacement.objects.create(
            replacement_number="REP-CUSTOMER-POD-001",
            order=self.order,
            customer_id=self.customer.id,
            reason="Damaged bottle",
            status="IN_PROGRESS",
            requested_by="CUSTOMER",
            replacement_mode="CUSTOMER_SUBMITTED",
            original_order_item_id=self.order_item_a.id,
            replacement_product_id=self.product_a.id,
            replacement_quantity=1,
            notes=(
                "Customer-submitted replacement request\nMeta: "
                + json.dumps(
                    {
                        "replacementOrderId": replacement_order.id,
                        "replacementOrderNumber": replacement_order.order_number,
                        "quantityToReplace": 1,
                    }
                )
            ),
        )

        response = self.client.get(
            "/api/customer/replacements",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 200, response.content.decode())
        row = next(item for item in response.json()["replacements"] if item["id"] == replacement.id)
        self.assertEqual(row["status"], "COMPLETED")
        self.assertEqual(row["statusTimeline"][-1]["status"], "COMPLETED")
        self.assertEqual(row["linkedReplacementOrderId"], replacement_order.id)
        self.assertEqual(row["linkedReplacementOrderNumber"], replacement_order.order_number)
        self.assertEqual(row["replacementDeliveryPod"]["recipientName"], "Replacement Receiver")
        self.assertEqual(row["replacementDeliveryPod"]["deliveryPhoto"], "https://example.com/replacement-pod-full.jpg")
        self.assertIsNotNone(row["replacementDeliveryPod"]["submittedAt"])

    def test_customer_replacement_request_combines_multiple_order_lines_into_one_case(self) -> None:
        response = self.client.post(
            "/api/customer/replacements",
            data={
                "orderId": self.order.id,
                "damageType": "Multiple issues",
                "description": "Combined replacement request",
                "notes": "5 bottles shattered inside the crate upon unloading.",
                "evidence": ["https://example.com/repl-proof-1.jpg"],
                "replacementLines": [
                    {
                        "originalOrderItemId": self.order_item_a.id,
                        "replacementProductId": self.product_a.id,
                        "inputMode": "case",
                        "quantityPerCase": 6,
                        "quantityToReplace": 12,
                        "quantityToReplaceCases": 2,
                        "reason": "Broken seal",
                        "description": "Two units damaged",
                    },
                    {
                        "originalOrderItemId": self.order_item_b.id,
                        "replacementProductId": self.product_b.id,
                        "inputMode": "bottle",
                        "quantityPerCase": 12,
                        "quantityToReplace": 3,
                        "quantityToReplaceBottles": 3,
                        "reason": "Leaking",
                        "description": "Three bottles damaged",
                    },
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(Replacement.objects.count(), 1)

        replacement = Replacement.objects.get()
        self.assertEqual(replacement.order_id, self.order.id)
        self.assertEqual(replacement.replacement_quantity, 15)

        notes = str(replacement.notes or "")
        meta_marker = notes.rfind("Meta:")
        self.assertGreaterEqual(meta_marker, 0)
        meta = json.loads(notes[meta_marker + 5 :].strip())
        self.assertEqual(len(meta.get("replacementLines", [])), 2)
        self.assertEqual(meta["replacementLines"][0]["quantityToReplaceCases"], 2)
        self.assertEqual(meta["replacementLines"][1]["quantityToReplaceBottles"], 3)
        self.assertEqual(meta["customerNotes"], "5 bottles shattered inside the crate upon unloading.")

        serialized = payload["replacement"]
        self.assertEqual(serialized["quantityToReplace"], 15)
        self.assertEqual(serialized["quantityReplaced"], 0)
        self.assertEqual(serialized["customerNotes"], "5 bottles shattered inside the crate upon unloading.")
        self.assertEqual(len(serialized["replacementLines"]), 2)
        self.assertEqual(serialized["replacementLines"][0]["originalProductName"], "Return Product A")
        self.assertEqual(serialized["replacementLines"][1]["originalProductName"], "Return Product B")
        self.assertEqual(serialized["replacementLines"][0]["replacementProductUnit"], "case")
        self.assertEqual(serialized["replacementLines"][1]["replacementProductUnit"], "bottle")
        # Customer emails must use the selected packaging unit, not raw base bottles.
        self.assertEqual(
            [line.quantity for line in _replacement_product_lines(replacement)],
            ["2 Cases", "3 Bottles"],
        )
        self.assertIn("Return Product A", str(serialized.get("originalProductName") or ""))
        self.assertIn("Return Product B", str(serialized.get("originalProductName") or ""))

    def test_case_order_replacement_preserves_the_submitted_bottle_quantity(self) -> None:
        # Current orders persist their selling unit on the delivered line.
        self.order_item_a.product_unit = "case"
        self.order_item_a.save(update_fields=["product_unit"])
        response = self.client.post(
            "/api/customer/replacements",
            data={
                "orderId": self.order.id,
                "damageType": "Broken seal",
                "evidence": ["https://example.com/repl-proof.jpg"],
                "replacementLines": [
                    {
                        "originalOrderItemId": self.order_item_a.id,
                        # The customer explicitly submitted one bottle from this
                        # case-priced order line.
                        "inputMode": "bottle",
                        "quantityToReplace": 1,
                        "quantityToReplaceBottles": 1,
                        "reason": "Broken seal",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 201, response.content.decode())
        serialized = response.json()["replacement"]
        line = serialized["replacementLines"][0]
        self.assertEqual(line["lineInputMode"], "bottle")
        self.assertEqual(line["quantityToReplaceBottles"], 1)
        self.assertEqual(line["quantityToReplace"], 1)
        self.assertNotIn("quantityToReplaceCases", line)
        self.assertEqual(serialized["replacementAmount"], 1.67)

    def test_legacy_case_order_preserves_its_submitted_bottle_quantity(self) -> None:
        replacement = Replacement.objects.create(
            replacement_number="RPL-LEGACY-CASE-UNIT",
            order=self.order,
            customer_id=self.customer.id,
            reason="Broken seal",
            status="PENDING",
            requested_by="CUSTOMER",
            replacement_mode="CUSTOMER_SUBMITTED",
            original_order_item_id=self.order_item_a.id,
            replacement_product_id=self.product_a.id,
            replacement_quantity=1,
            notes="Meta: " + json.dumps(
                {
                    "replacementLines": [
                        {
                            "originalOrderItemId": self.order_item_a.id,
                            "originalProductUnit": "case",
                            "replacementProductId": self.product_a.id,
                            "replacementProductUnit": "case",
                            "lineInputMode": "bottle",
                            "quantityPerCase": 6,
                            "quantityToReplace": 1,
                            "quantityToReplaceBottles": 1,
                        }
                    ]
                }
            ),
        )

        serialized = _serialize_replacement(replacement)
        line = serialized["replacementLines"][0]
        self.assertEqual(line["lineInputMode"], "bottle")
        self.assertEqual(line["quantityToReplaceBottles"], 1)
        self.assertEqual(line["quantityToReplace"], 1)
        self.assertNotIn("quantityToReplaceCases", line)
        self.assertEqual(serialized["replacementAmount"], 1.67)

    def test_saved_replacement_succeeds_when_notifications_fail(self) -> None:
        # Regression: secondary notification failures previously returned HTTP 500
        # even though the replacement request had already been saved.
        with (
            patch("core.views_api._create_staff_notifications", side_effect=RuntimeError("staff notification failed")),
            patch("core.views_api._create_customer_notification", side_effect=RuntimeError("customer notification failed")),
            patch("core.views_api.threading.Thread.start", side_effect=RuntimeError("email thread failed")),
        ):
            response = self.client.post(
                "/api/customer/replacements",
                data={
                    "orderId": self.order.id,
                    "damageType": "Broken seal",
                    "evidence": ["https://example.com/replacement-proof.jpg"],
                    "replacementLines": [
                        {
                            "originalOrderItemId": self.order_item_a.id,
                            "inputMode": "case",
                            "quantityPerCase": 6,
                            "quantityToReplace": 6,
                            "quantityToReplaceCases": 1,
                            "reason": "Broken seal",
                        }
                    ],
                },
                content_type="application/json",
                HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
            )

        self.assertEqual(response.status_code, 201, response.content.decode())
        self.assertTrue(response.json()["success"])
        self.assertEqual(Replacement.objects.filter(order=self.order).count(), 1)

    def test_customer_replacement_retry_reuses_active_request(self) -> None:
        OrderTimeline.objects.create(
            order=self.order,
            delivered_at=timezone.now() - timedelta(days=4),
        )
        existing = Replacement.objects.create(
            replacement_number="RPL-RETRY-001",
            order=self.order,
            customer_id=self.customer.id,
            reason="Broken seal",
            description="Previously saved request",
            status="PENDING",
            requested_by="CUSTOMER",
            replacement_mode="CUSTOMER_SUBMITTED",
            replacement_quantity=1,
            original_order_item_id=self.order_item_a.id,
            replacement_product_id=self.product_a.id,
            damage_photo_url="https://example.com/original-proof.jpg",
            damage_photo_urls=json.dumps(["https://example.com/original-proof.jpg"]),
        )

        response = self.client.post(
            "/api/customer/replacements",
            data={"orderId": self.order.id},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 200, response.content.decode())
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertTrue(payload["reused"])
        self.assertEqual(payload["replacement"]["id"], existing.id)
        self.assertEqual(Replacement.objects.filter(order=self.order).count(), 1)

    def test_customer_replacement_request_does_not_use_order_timestamp_as_delivery_time(self) -> None:
        # A legacy delivered order without a recorded delivery event must not be
        # rejected based on its unrelated creation/update timestamp.
        Order.objects.filter(id=self.order.id).update(
            created_at=timezone.now() - timedelta(days=10),
            updated_at=timezone.now() - timedelta(days=10),
        )

        response = self.client.post(
            "/api/customer/replacements",
            data={
                "orderId": self.order.id,
                "damageType": "Broken seal",
                "evidence": ["https://example.com/legacy-delivery-proof.jpg"],
                "replacementLines": [
                    {
                        "originalOrderItemId": self.order_item_a.id,
                        "inputMode": "case",
                        "quantityPerCase": 6,
                        "quantityToReplace": 6,
                        "quantityToReplaceCases": 1,
                        "reason": "Broken seal",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 201, response.content.decode())
        self.assertTrue(response.json()["success"])
        self.assertEqual(Replacement.objects.filter(order=self.order).count(), 1)

    def test_customer_can_cancel_pending_replacement_before_review(self) -> None:
        replacement = Replacement.objects.create(
            replacement_number="RPL-CANCEL-PENDING-001",
            order=self.order,
            customer_id=self.customer.id,
            reason="Broken seal",
            status="PENDING",
            requested_by="CUSTOMER",
            replacement_mode="CUSTOMER_SUBMITTED",
            replacement_quantity=1,
            notes=(
                "Customer-submitted replacement request\nMeta: "
                + json.dumps({"statusTimeline": [{"status": "PENDING", "at": timezone.now().isoformat()}]})
            ),
        )

        response = self.client.post(
            f"/api/customer/replacements/{replacement.id}/cancel",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 200, response.content.decode())
        replacement.refresh_from_db()
        self.assertEqual(replacement.status, "CANCELLED")
        meta = json.loads(replacement.notes.split("Meta:", 1)[1].strip())
        self.assertEqual(meta["statusTimeline"][-1]["status"], "CANCELLED")
        self.assertIsNotNone(meta.get("cancelledAt"))

    def test_customer_cannot_cancel_replacement_that_is_under_review(self) -> None:
        replacement = Replacement.objects.create(
            replacement_number="RPL-CANCEL-REVIEW-001",
            order=self.order,
            customer_id=self.customer.id,
            reason="Broken seal",
            status="UNDER_REVIEW",
            requested_by="CUSTOMER",
            replacement_mode="CUSTOMER_SUBMITTED",
            replacement_quantity=1,
        )

        response = self.client.post(
            f"/api/customer/replacements/{replacement.id}/cancel",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 409, response.content.decode())
        self.assertIn("already under review", response.json()["error"])
        replacement.refresh_from_db()
        self.assertEqual(replacement.status, "UNDER_REVIEW")

    def test_cancelled_replacement_does_not_block_a_new_request(self) -> None:
        Replacement.objects.create(
            replacement_number="RPL-CANCELLED-OLD-001",
            order=self.order,
            customer_id=self.customer.id,
            reason="Broken seal",
            status="CANCELLED",
            requested_by="CUSTOMER",
            replacement_mode="CUSTOMER_SUBMITTED",
            replacement_quantity=1,
        )

        response = self.client.post(
            "/api/customer/replacements",
            data={
                "orderId": self.order.id,
                "damageType": "Leaking",
                "evidence": ["https://example.com/new-proof.jpg"],
                "replacementLines": [
                    {
                        "originalOrderItemId": self.order_item_a.id,
                        "inputMode": "case",
                        "quantityPerCase": 6,
                        "quantityToReplace": 6,
                        "quantityToReplaceCases": 1,
                        "reason": "Leaking",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 201, response.content.decode())
        self.assertEqual(response.json()["replacement"]["status"], "PENDING")
        self.assertEqual(Replacement.objects.filter(order=self.order).count(), 2)

    def test_scheduled_bottle_replacement_prices_only_requested_bottles(self) -> None:
        warehouse = Warehouse.objects.create(
            name="Bottle Replacement Warehouse",
            code="WH-BOTTLE-REPL-001",
            address="Replacement Road",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            is_active=True,
        )
        self.order.warehouse_id = warehouse.id
        self.order.save(update_fields=["warehouse_id", "updated_at"])
        inventory = Inventory.objects.create(
            warehouse=warehouse,
            product=self.product_b,
            quantity=1,
            reserved_quantity=0,
            threshold=1,
        )
        StockBatch.objects.create(
            batch_number="BATCH-BOTTLE-REPL-PRICE",
            inventory=inventory,
            quantity=1,
            receipt_date=timezone.now(),
            status="ACTIVE",
        )
        replacement = Replacement.objects.create(
            replacement_number="RPL-BOTTLE-PRICE-001",
            order=self.order,
            customer_id=self.customer.id,
            reason="Leaking",
            description="Customer requested by bottle",
            status="APPROVED",
            requested_by="CUSTOMER",
            replacement_mode="CUSTOMER_SUBMITTED",
            replacement_quantity=3,
            original_order_item_id=self.order_item_b.id,
            replacement_product_id=self.product_b.id,
            notes=(
                "Customer-submitted replacement request\n"
                "Meta: "
                + json.dumps(
                    {
                        "replacementLines": [
                            {
                                "originalOrderItemId": self.order_item_b.id,
                                "replacementProductId": self.product_b.id,
                                "replacementProductName": self.product_b.name,
                                "replacementProductUnit": "case",
                                "lineInputMode": "bottle",
                                "replacementInputMode": "bottle",
                                "quantityPerCase": 12,
                                "qtyPerUnit": 12,
                                "quantityToReplace": 3,
                                "quantityReplaced": 0,
                                "quantityToReplaceBottles": 3,
                            }
                        ]
                    }
                )
            ),
        )

        scheduled_order = _create_scheduled_replacement_order(
            replacement,
            scheduled_date=timezone.localdate(),
            staff_user_id=None,
        )

        item = scheduled_order.items.get()
        self.assertEqual(item.quantity, 1)
        self.assertAlmostEqual(item.total_price, 5.0)
        self.assertAlmostEqual(scheduled_order.total_amount, 5.0)

    def test_mixed_case_and_bottle_replacement_deducts_requested_bottles(self) -> None:
        # This scenario requests loose bottles from a product stocked by the case.
        self.product_b.unit = "case"
        self.product_b.save(update_fields=["unit", "updated_at"])
        warehouse = Warehouse.objects.create(
            name="Mixed Replacement Warehouse",
            code="WH-MIXED-REPL-001",
            address="Replacement Road",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            is_active=True,
        )
        self.order.warehouse_id = warehouse.id
        self.order.save(update_fields=["warehouse_id", "updated_at"])
        inventory_a = Inventory.objects.create(
            warehouse=warehouse,
            product=self.product_a,
            quantity=5,
            loose_bottles=0,
            reserved_quantity=0,
            threshold=1,
        )
        inventory_b = Inventory.objects.create(
            warehouse=warehouse,
            product=self.product_b,
            quantity=2,
            loose_bottles=0,
            reserved_quantity=0,
            threshold=1,
        )
        StockBatch.objects.create(
            batch_number="BATCH-MIXED-REPL-A",
            inventory=inventory_a,
            quantity=5,
            receipt_date=timezone.now(),
            status="ACTIVE",
        )
        StockBatch.objects.create(
            batch_number="BATCH-MIXED-REPL-B",
            inventory=inventory_b,
            quantity=2,
            receipt_date=timezone.now(),
            status="ACTIVE",
        )
        replacement = Replacement.objects.create(
            replacement_number="RPL-MIXED-REPL-001",
            order=self.order,
            customer_id=self.customer.id,
            reason="Mixed replacement",
            description="One case line and one bottle line",
            status="APPROVED",
            requested_by="CUSTOMER",
            replacement_mode="CUSTOMER_SUBMITTED",
            replacement_quantity=15,
            notes=(
                "Customer-submitted replacement request\n"
                "Meta: "
                + json.dumps(
                    {
                        "replacementLines": [
                            {
                                "originalOrderItemId": self.order_item_a.id,
                                "replacementProductId": self.product_a.id,
                                "replacementProductName": self.product_a.name,
                                "replacementProductUnit": "case",
                                "lineInputMode": "case",
                                "replacementInputMode": "case",
                                "quantityPerCase": 6,
                                "qtyPerUnit": 6,
                                "quantityToReplace": 12,
                                "quantityReplaced": 0,
                                "quantityToReplaceCases": 2,
                                "quantityToReplaceUnits": 2,
                            },
                            {
                                "originalOrderItemId": self.order_item_b.id,
                                "replacementProductId": self.product_b.id,
                                "replacementProductName": self.product_b.name,
                                "replacementProductUnit": "case",
                                "lineInputMode": "bottle",
                                "replacementInputMode": "bottle",
                                "quantityPerCase": 12,
                                "qtyPerUnit": 12,
                                "quantityToReplace": 3,
                                "quantityReplaced": 0,
                                "quantityToReplaceBottles": 3,
                            },
                        ]
                    }
                )
            ),
        )

        scheduled_order = _create_scheduled_replacement_order(
            replacement,
            scheduled_date=timezone.localdate(),
            staff_user_id=None,
        )
        self.assertEqual(scheduled_order.items.count(), 2)
        bottle_item = scheduled_order.items.get(product=self.product_b)
        self.assertIn("ReplacementUnitMode=BOTTLE", bottle_item.notes)
        self.assertIn("ReplacementRequestedBottles=3", bottle_item.notes)

        _mark_order_delivered(scheduled_order, performed_by="warehouse-test")

        inventory_a.refresh_from_db()
        inventory_b.refresh_from_db()
        self.assertEqual(inventory_a.quantity, 3)
        self.assertEqual(inventory_a.loose_bottles, 0)
        self.assertEqual(inventory_b.quantity, 1)
        self.assertEqual(inventory_b.loose_bottles, 9)
        bottle_deduction = InventoryTransaction.objects.get(
            type="OUT",
            reference_type="order_item",
            reference_id=bottle_item.id,
        )
        self.assertEqual(bottle_deduction.quantity_unit, "BASE_UNIT")
        self.assertEqual(bottle_deduction.stock_unit_label, "Bottle")
        self.assertEqual(bottle_deduction.quantity, 3)
        self.assertEqual((bottle_deduction.previous_stock, bottle_deduction.updated_stock), (24, 21))
        self.assertFalse(
            InventoryTransaction.objects.filter(
                reference_type="replacement_bottle_remainder",
                reference_id=bottle_item.id,
            ).exists()
        )

    def test_bottle_stocked_replacement_records_a_bottle_deduction(self) -> None:
        warehouse = Warehouse.objects.create(
            name="Bottle Replacement Warehouse",
            code="WH-BOTTLE-REPL-001",
            address="Replacement Road",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            is_active=True,
        )
        inventory = Inventory.objects.create(
            warehouse=warehouse,
            product=self.product_b,
            quantity=5,
            reserved_quantity=0,
            threshold=1,
        )
        StockBatch.objects.create(
            batch_number="BATCH-BOTTLE-STOCKED-REPL",
            inventory=inventory,
            quantity=5,
            receipt_date=timezone.now(),
            status="ACTIVE",
        )
        replacement_order = Order.objects.create(
            order_number="RPL-BOTTLE-STOCKED-001",
            customer=self.customer,
            warehouse_id=warehouse.id,
            subtotal=0,
            total_amount=0,
        )
        item = OrderItem.objects.create(
            order=replacement_order,
            product=self.product_b,
            quantity=3,
            unit_price=0,
            total_price=0,
            notes="ReplacementUnitMode=BOTTLE\nReplacementRequestedBottles=3",
        )

        _mark_order_delivered(replacement_order, performed_by="warehouse-test")

        inventory.refresh_from_db()
        deduction = InventoryTransaction.objects.get(type="OUT", reference_id=item.id)
        self.assertEqual(inventory.quantity, 2)
        self.assertEqual((deduction.quantity_unit, deduction.stock_unit_label, deduction.quantity), ("BASE_UNIT", "Bottle", 3))
        self.assertEqual((deduction.previous_stock, deduction.updated_stock), (5, 2))

    def test_customer_replacement_request_rejects_order_delivered_more_than_3_days_ago(self) -> None:
        OrderTimeline.objects.create(
            order=self.order,
            delivered_at=timezone.now() - timedelta(days=4),
        )
        response = self.client.post(
            "/api/customer/replacements",
            data={
                "orderId": self.order.id,
                "damageType": "Leak",
                "replacementLines": [
                    {
                        "originalOrderItemId": self.order_item_a.id,
                        "inputMode": "case",
                        "quantityToReplace": 6,
                        "quantityToReplaceCases": 1,
                        "reason": "Leak",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertIn("within 3 days", payload["error"])

    def test_customer_replacement_request_rejects_if_previous_replacement_was_rejected(self) -> None:
        Replacement.objects.create(
            replacement_number="RET-EXIST-REJECTED-001",
            order=self.order,
            customer_id=self.customer.id,
            reason="Prior replacement",
            description="Prior replacement",
            status="REJECTED",
            requested_by="CUSTOMER",
            replacement_mode="CUSTOMER_SUBMITTED",
            replacement_quantity=1,
        )
        response = self.client.post(
            "/api/customer/replacements",
            data={
                "orderId": self.order.id,
                "damageType": "Leak",
                "replacementLines": [
                    {
                        "originalOrderItemId": self.order_item_a.id,
                        "inputMode": "case",
                        "quantityToReplace": 6,
                        "quantityToReplaceCases": 1,
                        "reason": "Leak",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertIn("cannot request another replacement", payload["error"])

    def test_customer_replacement_request_rejects_if_previous_replacement_was_completed(self) -> None:
        Replacement.objects.create(
            replacement_number="RET-EXIST-COMPLETED-001",
            order=self.order,
            customer_id=self.customer.id,
            reason="Prior replacement",
            description="Prior replacement",
            status="COMPLETED",
            requested_by="CUSTOMER",
            replacement_mode="CUSTOMER_SUBMITTED",
            replacement_quantity=1,
        )
        response = self.client.post(
            "/api/customer/replacements",
            data={
                "orderId": self.order.id,
                "damageType": "Leak",
                "replacementLines": [
                    {
                        "originalOrderItemId": self.order_item_a.id,
                        "inputMode": "case",
                        "quantityToReplace": 6,
                        "quantityToReplaceCases": 1,
                        "reason": "Leak",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertIn("cannot request another replacement", payload["error"])
