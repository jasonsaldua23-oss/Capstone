"""Purchase request workflow, order status transitions, delivery lifecycle, and pagination guards."""

import json
from datetime import datetime, timedelta
from unittest.mock import patch

from django.test import Client, TestCase
from django.utils import timezone

from .auth import create_token
from .models import (
    Customer,
    DropPointType,
    Notification,
    Order,
    OrderItem,
    OrderTimeline,
    OrderStatus,
    PurchaseOrderStage,
    PurchaseOrder,
    PurchaseRequest,
    PurchaseRequestStatus,
    Product,
    Replacement,
    Trip,
    TripDropPoint,
    TripStatus,
    User,
    Vehicle,
    VehicleType,
    Warehouse,
)
from .test_support import Role, Driver



class PurchaseRequestWorkflowTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.warehouse = Warehouse.objects.create(
            name="Central Warehouse",
            code="WH-001",
            address="Burgos Street",
            city="Talisay",
            province="Negros Occidental",
            zip_code="6115",
        )
        self.staff = User.objects.create(
            email="warehouse.staff@example.com",
            password="hashed",
            name="Warehouse Staff",
            role="WAREHOUSE_STAFF",
            is_active=True,
        )
        self.customer = Customer.objects.create(
            email="customer@example.com",
            password="hashed",
            name="Portal Customer",
            phone="09123456789",
            address="Main Street",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
        )
        self.token = create_token(
            {
                "userId": self.staff.id,
                "email": self.staff.email,
                "name": self.staff.name,
                "role": "WAREHOUSE_STAFF",
                "type": "staff",
            }
        )
        self.order = Order.objects.create(
            order_number="ORD-2026-9001",
            purchase_request_number="PR-2026-9001",
            customer=self.customer,
            status=OrderStatus.PENDING,
            request_status="PENDING_APPROVAL",
            subtotal=100.0,
            total_amount=100.0,
            payment_status="pending",
            warehouse_id=self.warehouse.id,
            shipping_name=self.customer.name,
            shipping_phone=self.customer.phone,
            shipping_address=self.customer.address,
            shipping_city=self.customer.city,
            shipping_province=self.customer.province,
            shipping_zip_code=self.customer.zip_code,
        )
        OrderTimeline.objects.create(order=self.order)

    def test_warehouse_approval_creates_purchase_order_metadata(self) -> None:
        response = self.client.patch(
            f"/api/orders/{self.order.id}/status",
            data='{"status":"APPROVED"}',
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 200)
        self.order.refresh_from_db()
        self.assertEqual(self.order.request_status, "APPROVED")
        self.assertEqual(self.order.status, OrderStatus.APPROVED)
        self.assertEqual(self.order.purchase_order_stage, "APPROVED")
        self.assertTrue(str(self.order.purchase_order_number or "").startswith("PO-"))
        self.assertEqual(self.order.approved_by_name, self.staff.name)
        self.assertIsNotNone(self.order.approved_at)
        approval_notice = Notification.objects.filter(
            customer=self.customer,
            type="ORDER",
            reference_id=self.order.id,
            title="Order approved",
        ).first()
        self.assertIsNotNone(approval_notice)
        self.assertEqual(
            approval_notice.message,
            f"Your order {self.order.purchase_order_number} was approved.",
        )

    def test_legacy_confirmed_status_is_stored_as_approved(self) -> None:
        # Installed app builds still send the old CONFIRMED value when approving.
        response = self.client.patch(
            f"/api/orders/{self.order.id}/status",
            data='{"status":"CONFIRMED"}',
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["order"]["status"], OrderStatus.APPROVED)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, OrderStatus.APPROVED)
        self.assertEqual(self.order.purchase_order_stage, "APPROVED")

    def test_warehouse_approval_expires_request_with_past_delivery_date(self) -> None:
        timeline = self.order.timeline
        timeline.delivery_date = timezone.now() - timedelta(days=1)
        timeline.save(update_fields=["delivery_date", "updated_at"])

        response = self.client.patch(
            f"/api/orders/{self.order.id}/status",
            data='{"status":"APPROVED"}',
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 409)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, OrderStatus.CANCELLED)
        self.assertEqual(self.order.request_status, PurchaseRequestStatus.CANCELLED)
        self.assertEqual(self.order.cancellation_reason, "Delivery date expired before approval")
        self.assertFalse(bool(self.order.purchase_order_number))

    def test_approved_request_is_a_locked_document_linked_to_one_po(self):
        self.test_warehouse_approval_creates_purchase_order_metadata()
        request = PurchaseRequest.objects.get(transaction=self.order)
        purchase_order = PurchaseOrder.objects.get(transaction=self.order)
        self.assertEqual(purchase_order.purchase_request_id, request.pk)
        self.assertIsNotNone(request.locked_at)
        snapshot = request.snapshot.copy()
        # Later fulfillment cancellation belongs to the PO, never to its original PR.
        self.order.status = OrderStatus.CANCELLED
        self.order.cancellation_reason = 'Delivery cancelled after approval'
        self.order.total_amount = 125
        self.order.save()
        request.refresh_from_db()
        self.assertEqual(request.snapshot, snapshot)
        self.assertIsNone(request.snapshot['cancellation_reason'])
        self.assertEqual(request.snapshot['total_amount'], 100)
        self.assertEqual(PurchaseOrder.objects.filter(transaction=self.order).count(), 1)
        request.status = PurchaseRequestStatus.CANCELLED
        with self.assertRaisesMessage(ValueError, 'cannot be updated'):
            request.save()

    def test_orders_list_expires_pending_request_with_past_delivery_date(self) -> None:
        timeline = self.order.timeline
        timeline.delivery_date = timezone.now() - timedelta(days=1)
        timeline.save(update_fields=["delivery_date", "updated_at"])

        response = self.client.get(
            "/api/orders",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 200)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, OrderStatus.CANCELLED)
        self.assertEqual(self.order.request_status, PurchaseRequestStatus.CANCELLED)
        self.assertEqual(self.order.cancellation_reason, "Delivery date expired before approval")

    def test_pending_request_cannot_skip_approval_and_start_processing(self) -> None:
        response = self.client.patch(
            f"/api/orders/{self.order.id}/status",
            data='{"status":"PREPARING"}',
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 400)
        self.order.refresh_from_db()
        self.assertEqual(self.order.request_status, "PENDING_APPROVAL")
        self.assertEqual(self.order.status, OrderStatus.PENDING)
        self.assertFalse(bool(self.order.purchase_order_number))
        self.assertFalse(bool(self.order.purchase_order_stage))


    def test_reject_pending_request_requires_reason_and_does_not_create_purchase_order(self) -> None:
        missing_reason = self.client.patch(
            f"/api/orders/{self.order.id}/status",
            data='{"status":"REJECTED"}',
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(missing_reason.status_code, 400)

        response = self.client.patch(
            f"/api/orders/{self.order.id}/status",
            data='{"status":"REJECTED","reason":"Insufficient stock confirmation"}',
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 200)
        self.order.refresh_from_db()
        self.assertEqual(self.order.request_status, "REJECTED")
        self.assertEqual(self.order.status, OrderStatus.REJECTED)
        self.assertFalse(bool(self.order.purchase_order_number))
        self.assertEqual(self.order.rejection_reason, "Insufficient stock confirmation")

    def test_cancel_pending_request_requires_and_saves_reason(self) -> None:
        missing_reason = self.client.patch(
            f"/api/orders/{self.order.id}/status",
            data={"status": "CANCELLED"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(missing_reason.status_code, 400)
        self.assertEqual(missing_reason.json()["error"], "A cancellation reason is required")

        response = self.client.patch(
            f"/api/orders/{self.order.id}/status",
            data={"status": "CANCELLED", "reason": "Duplicate purchase request"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(response.status_code, 200)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, OrderStatus.CANCELLED)
        self.assertEqual(self.order.request_status, "CANCELLED")
        self.assertEqual(self.order.cancellation_reason, "Duplicate purchase request")


class OrderStatusTransitionApiContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")
        self.admin_user = User.objects.create(
            email="status.admin@example.com",
            password="hashed",
            name="Status Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.admin_token = create_token(
            {
                "userId": self.admin_user.id,
                "email": self.admin_user.email,
                "name": self.admin_user.name,
                "role": self.admin_role.name,
                "type": "staff",
            }
        )
        self.customer = Customer.objects.create(
            email="status.customer@example.com",
            password="hashed",
            name="Status Customer",
            is_active=True,
        )

    def _create_order(self, **overrides):
        base = {
            "order_number": f"ORD-STATUS-{Order.objects.count() + 1:03d}",
            "customer": self.customer,
            "status": OrderStatus.PREPARING,
            "request_status": "APPROVED",
            "subtotal": 100,
            "total_amount": 110,
        }
        base.update(overrides)
        return Order.objects.create(**base)

    def _patch_status(self, order_id: str, payload: dict):
        return self.client.patch(
            f"/api/orders/{order_id}/status",
            data=payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

    def test_order_status_update_requires_status(self) -> None:
        order = self._create_order()

        response = self._patch_status(order.id, {})
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "status is required")

    def test_dispatched_status_is_automatic_when_trip_starts(self) -> None:
        order = self._create_order()

        response = self._patch_status(order.id, {"status": "DISPATCHED"})
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "OUT_FOR_DELIVERY is set automatically when the trip starts")

    def test_out_for_delivery_status_is_automatic_when_trip_starts(self) -> None:
        order = self._create_order(status=OrderStatus.PREPARING)

        response = self._patch_status(order.id, {"status": "OUT_FOR_DELIVERY"})
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "OUT_FOR_DELIVERY is set automatically when the trip starts")

    def test_preparing_status_updates_order_and_timeline(self) -> None:
        order = self._create_order(status=OrderStatus.PENDING)

        response = self._patch_status(order.id, {"status": "PREPARING"})
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["order"]["status"], OrderStatus.PREPARING)

        order.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.PREPARING)

        timeline = OrderTimeline.objects.get(order=order)
        self.assertIsNotNone(timeline.processed_at)

    def test_overdue_approved_order_requires_reschedule_before_processing(self) -> None:
        order = self._create_order(
            status=OrderStatus.APPROVED,
            purchase_order_number="PO-STATUS-OVERDUE-001",
            purchase_order_stage=PurchaseOrderStage.APPROVED,
        )
        OrderTimeline.objects.create(order=order, delivery_date=timezone.now() - timedelta(days=1))

        response = self._patch_status(order.id, {"status": "PREPARING"})

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "Delivery date has passed. Reschedule the order before processing it.")
        order.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.APPROVED)

    def test_overdue_approved_order_can_be_rescheduled_to_valid_date(self) -> None:
        order = self._create_order(
            status=OrderStatus.APPROVED,
            purchase_order_number="PO-STATUS-RESCHEDULE-001",
            purchase_order_stage=PurchaseOrderStage.APPROVED,
        )
        OrderTimeline.objects.create(order=order, delivery_date=timezone.now() - timedelta(days=1))
        new_delivery_date = timezone.localdate() + timedelta(days=2)

        response = self._patch_status(
            order.id,
            {"status": "RESCHEDULED", "deliveryDate": new_delivery_date.isoformat()},
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["order"]["requiresReschedule"])
        self.assertEqual(response.json()["order"]["status"], OrderStatus.RESCHEDULED)
        self.assertEqual(response.json()["order"]["purchaseOrderStage"], PurchaseOrderStage.APPROVED)
        order.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.RESCHEDULED)
        self.assertEqual(order.purchase_order_stage, PurchaseOrderStage.APPROVED)
        self.assertEqual(timezone.localtime(order.timeline.delivery_date).date(), new_delivery_date)

    def test_staff_cancellation_requires_and_saves_reason(self) -> None:
        order = self._create_order(status=OrderStatus.PREPARING)

        missing_reason = self._patch_status(order.id, {"status": "CANCELLED"})
        self.assertEqual(missing_reason.status_code, 400)
        self.assertEqual(missing_reason.json()["error"], "A cancellation reason is required")

        response = self._patch_status(
            order.id,
            {"status": "CANCELLED", "reason": "Customer requested cancellation"},
        )
        self.assertEqual(response.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.CANCELLED)
        self.assertEqual(order.cancellation_reason, "Customer requested cancellation")

    @patch("core.views_api._email_order_cancelled_to_customer")
    def test_staff_can_cancel_rescheduled_order(self, _mock_cancel_email) -> None:
        # Regression: the warehouse UI must be able to use the supported RESCHEDULED -> CANCELLED transition.
        order = self._create_order(
            status=OrderStatus.RESCHEDULED,
            request_status="APPROVED",
            purchase_order_stage=PurchaseOrderStage.OUT_FOR_DELIVERY,
            purchase_order_number="PO-STATUS-RESCHEDULED-001",
        )

        response = self._patch_status(
            order.id,
            {"status": "CANCELLED", "reason": "Order no longer needed after rescheduling"},
        )

        self.assertEqual(response.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.CANCELLED)
        self.assertEqual(order.purchase_order_stage, PurchaseOrderStage.CANCELLED)
        self.assertEqual(order.cancellation_reason, "Order no longer needed after rescheduling")

    def test_staff_rejection_requires_and_saves_selected_reason(self) -> None:
        order = self._create_order(status=OrderStatus.PREPARING)

        missing_reason = self._patch_status(order.id, {"status": "REJECTED"})
        self.assertEqual(missing_reason.status_code, 400)
        self.assertEqual(missing_reason.json()["error"], "A rejection reason is required")

        response = self._patch_status(
            order.id,
            {"status": "REJECTED", "reason": "Product out of stock"},
        )
        self.assertEqual(response.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.REJECTED)
        self.assertEqual(order.rejection_reason, "Product out of stock")


class DeliveryLifecycleFlowContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")

        self.admin_user = User.objects.create(
            email="lifecycle.admin@example.com",
            password="hashed",
            name="Lifecycle Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.driver_user = User.objects.create(
            email="lifecycle.driver@example.com",
            password="hashed",
            name="Lifecycle Driver",
            role=self.driver_role,
            is_active=True,
        )
        self.driver = Driver.objects.create(
            user=self.driver_user,
            license_number="LIC-LIFECYCLE-001",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )
        self.vehicle = Vehicle.objects.create(
            license_plate="LIFECYCLE-001",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
        )
        self.warehouse = Warehouse.objects.create(
            name="Lifecycle Warehouse",
            code="WH-LIFECYCLE-001",
            address="Warehouse Address",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            is_active=True,
        )
        self.customer = Customer.objects.create(
            email="lifecycle.customer@example.com",
            password="hashed",
            name="Lifecycle Customer",
            is_active=True,
        )
        self.order = Order.objects.create(
            order_number="ORD-LIFECYCLE-001",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            warehouse_id=self.warehouse.id,
            subtotal=200,
            total_amount=220,
        )
        self.trip = Trip.objects.create(
            trip_number="TRP-LIFECYCLE-001",
            driver=self.driver,
            vehicle=self.vehicle,
            status=TripStatus.PLANNED,
            planned_start_at=timezone.now(),
            total_drop_points=1,
        )
        self.trip_drop_point = TripDropPoint.objects.create(
            trip=self.trip,
            order=self.order,
            sequence=1,
            location_name=self.order.order_number,
            address="Lifecycle Address",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            drop_point_type=DropPointType.DELIVERY,
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
        self.driver_token = create_token(
            {
                "userId": self.driver_user.id,
                "email": self.driver_user.email,
                "name": self.driver_user.name,
                "role": "DRIVER",
                "type": "staff",
            }
        )

    def test_delivery_lifecycle_end_to_end(self) -> None:
        trip_id = self.trip.id
        drop_point_id = self.trip_drop_point.id

        start_trip = self.client.post(
            f"/api/trips/{trip_id}/start",
            data={"confirmLoad": True},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(start_trip.status_code, 200)
        self.assertEqual(start_trip.json()["trip"]["status"], TripStatus.IN_PROGRESS)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, OrderStatus.OUT_FOR_DELIVERY)

        arrived = self.client.patch(
            f"/api/trips/{trip_id}/drop-points/{drop_point_id}",
            data={"status": "ARRIVED"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(arrived.status_code, 200)
        self.assertEqual(arrived.json()["dropPoint"]["status"], "ARRIVED")

        completed = self.client.patch(
            f"/api/trips/{trip_id}/drop-points/{drop_point_id}",
            data={"status": "COMPLETED", "deliveryPhoto": "/uploads/pod/lifecycle.jpg"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(completed.status_code, 200)
        self.assertEqual(completed.json()["dropPoint"]["status"], "COMPLETED")
        self.assertEqual(completed.json()["order"]["status"], OrderStatus.DELIVERED)

        # Resolving the last stop updates progress, then the driver explicitly
        # confirms the whole trip from the trip screen.
        trip_in_progress = Trip.objects.get(id=trip_id)
        self.assertEqual(trip_in_progress.status, TripStatus.IN_PROGRESS)
        self.assertEqual(trip_in_progress.completed_drop_points, 1)

        complete_trip = self.client.post(
            f"/api/trips/{trip_id}/complete",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(complete_trip.status_code, 200, complete_trip.content)
        self.assertEqual(complete_trip.json()["trip"]["status"], TripStatus.COMPLETED)

        trip_db = Trip.objects.get(id=trip_id)
        self.assertEqual(trip_db.status, TripStatus.COMPLETED)
        self.assertEqual(trip_db.completed_drop_points, 1)
        self.assertIsNotNone(trip_db.actual_end_at)

        self.order.refresh_from_db()
        self.assertEqual(self.order.status, OrderStatus.DELIVERED)
        order_timeline = OrderTimeline.objects.get(order=self.order)
        self.assertIsNotNone(order_timeline.delivered_at)


class PaginationGuardsContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.admin_user = User.objects.create(
            email="pagination.admin@example.com",
            password="hashed",
            name="Pagination Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.driver_user = User.objects.create(
            email="pagination.driver@example.com",
            password="hashed",
            name="Pagination Driver",
            role=self.driver_role,
            is_active=True,
        )
        self.driver = Driver.objects.create(
            user=self.driver_user,
            license_number="LIC-PAGINATION-001",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )
        self.vehicle = Vehicle.objects.create(
            license_plate="PAGINATION-001",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
        )
        self.customer = Customer.objects.create(
            email="pagination.customer@logitrack.local",
            password="hashed",
            name="Pagination Customer",
            is_active=True,
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

        for idx in range(3):
            Order.objects.create(
                order_number=f"ORD-PAGINATION-{idx + 1:03d}",
                customer=self.customer,
                status=OrderStatus.PREPARING,
                subtotal=100 + idx,
                total_amount=110 + idx,
            )
            Trip.objects.create(
                trip_number=f"TRP-PAGINATION-{idx + 1:03d}",
                driver=self.driver,
                vehicle=self.vehicle,
                status=TripStatus.PLANNED,
            )

    def test_orders_endpoint_uses_expected_default_pagination(self) -> None:
        response = self.client.get("/api/orders", HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["page"], 1)
        self.assertEqual(payload["pageSize"], 20)
        self.assertEqual(payload["total"], 3)
        self.assertEqual(payload["totalPages"], 1)
        self.assertEqual(len(payload["orders"]), 3)

    def test_orders_endpoint_clamps_invalid_and_extreme_pagination_values(self) -> None:
        low_bound = self.client.get(
            "/api/orders",
            data={"page": -7, "pageSize": 0},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(low_bound.status_code, 200)
        low_payload = low_bound.json()
        self.assertEqual(low_payload["page"], 1)
        self.assertEqual(low_payload["pageSize"], 1)
        self.assertEqual(len(low_payload["orders"]), 1)

        high_bound = self.client.get(
            "/api/orders",
            data={"pageSize": 50000},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(high_bound.status_code, 200)
        high_payload = high_bound.json()
        self.assertEqual(high_payload["pageSize"], 1000)
        self.assertEqual(len(high_payload["orders"]), 3)

    def test_orders_include_returns_always_exposes_customer_display_name(self) -> None:
        order = Order.objects.create(
            order_number="ORD-RETURN-CUSTOMER",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            subtotal=100,
            total_amount=110,
        )
        order.shipping_name = "Fallback Shipping Customer"
        order.shipping_phone = "555-0100"
        order.shipping_address = "123 Return Street"
        order.shipping_city = "Return City"
        order.shipping_province = "Return Province"
        order.shipping_zip_code = "5000"
        order.shipping_country = "Philippines"
        order.save(
            update_fields=[
                "shipping_name",
                "shipping_phone",
                "shipping_address",
                "shipping_city",
                "shipping_province",
                "shipping_zip_code",
                "shipping_country",
                "updated_at",
            ]
        )
        self.customer.name = ""
        self.customer.save(update_fields=["name", "updated_at"])
        Replacement.objects.create(
            replacement_number="RET-CUSTOMER-001",
            order=order,
            customer_id=self.customer.id,
            reason="Damaged item",
            pickup_address="123 Return Street",
            pickup_city="Return City",
            pickup_province="Return Province",
            pickup_zip_code="5000",
        )

        response = self.client.get(
            "/api/orders",
            data={"includeReplacements": "true", "includeOrders": "false", "includeItems": "none", "limit": 10},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        returned = next(row for row in payload["replacements"] if row["replacementNumber"] == "RET-CUSTOMER-001")
        self.assertEqual(returned["customerName"], "Fallback Shipping Customer")
        self.assertEqual(returned["order"]["customer"]["id"], self.customer.id)

    def test_orders_include_returns_exposes_replacement_item_quantities(self) -> None:
        order = Order.objects.create(
            order_number="ORD-RETURN-QUANTITIES",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            subtotal=100,
            total_amount=110,
        )
        product = Product.objects.create(sku="PEPS-CAS-12OZ-N94CX", name="Pepsi", price=10)
        order_item = OrderItem.objects.create(
            order=order,
            product=product,
            quantity=7,
            unit_price=10,
            total_price=70,
        )
        Replacement.objects.create(
            replacement_number="RET-QUANTITY-001",
            order=order,
            customer_id=self.customer.id,
            reason="Damaged item",
            status="NEEDS_FOLLOW_UP",
            original_order_item_id=order_item.id,
            replacement_product_id=product.id,
            replacement_quantity=1,
            pickup_address="123 Return Street",
            pickup_city="Return City",
            pickup_province="Return Province",
            pickup_zip_code="5000",
            notes='Partial replacement reported by driver\nMeta: {"quantityToReplace": 6, "quantityReplaced": 1}',
        )

        response = self.client.get(
            "/api/orders",
            data={"includeReplacements": "true", "includeOrders": "false", "includeItems": "none", "limit": 10},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(response.status_code, 200)
        returned = next(row for row in response.json()["replacements"] if row["replacementNumber"] == "RET-QUANTITY-001")
        self.assertEqual(returned["quantityToReplace"], 6)
        self.assertEqual(returned["quantityReplaced"], 1)
        self.assertEqual(returned["remainingQuantity"], 5)
        self.assertEqual(returned["replacementItems"][0]["quantityToReplace"], 6)
        self.assertEqual(returned["replacementItems"][0]["quantityReplaced"], 1)

    def test_trips_endpoint_uses_expected_pagination_defaults_and_bounds(self) -> None:
        default_response = self.client.get("/api/trips", HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        self.assertEqual(default_response.status_code, 200)
        default_payload = default_response.json()
        self.assertEqual(default_payload["page"], 1)
        self.assertEqual(default_payload["pageSize"], 20)
        self.assertEqual(default_payload["total"], 3)
        self.assertEqual(len(default_payload["trips"]), 3)

        bounded_response = self.client.get(
            "/api/trips",
            data={"page": 0, "pageSize": 0},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(bounded_response.status_code, 200)
        bounded_payload = bounded_response.json()
        self.assertEqual(bounded_payload["page"], 1)
        self.assertEqual(bounded_payload["pageSize"], 1)
        self.assertEqual(len(bounded_payload["trips"]), 1)
