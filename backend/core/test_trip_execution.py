"""Trip start, stop and drop-point execution API contracts."""

import json
from datetime import timedelta
from unittest.mock import patch

from django.test import Client, TestCase
from django.utils import timezone

from .auth import create_token
from .models import (
    Customer,
    DropPointType,
    Inventory,
    InventoryTransaction,
    Notification,
    Order,
    OrderItem,
    OrderTimeline,
    OrderStatus,
    Product,
    StockBatch,
    Trip,
    TripDropPoint,
    TripStatus,
    User,
    Vehicle,
    VehicleType,
    Warehouse,
)
from .test_support import Role, Driver


class TripExecutionApiContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")

        self.driver_user = User.objects.create(
            email="trip.exec.driver@example.com",
            password="hashed",
            name="Trip Exec Driver",
            role=self.driver_role,
            is_active=True,
        )
        self.other_driver_user = User.objects.create(
            email="trip.exec.driver.other@example.com",
            password="hashed",
            name="Trip Exec Driver Other",
            role=self.driver_role,
            is_active=True,
        )
        self.admin_user = User.objects.create(
            email="trip.exec.admin@example.com",
            password="hashed",
            name="Trip Exec Admin",
            role=self.admin_role,
            is_active=True,
        )

        self.driver = Driver.objects.create(
            user=self.driver_user,
            license_number="LIC-EXEC-001",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )
        self.other_driver = Driver.objects.create(
            user=self.other_driver_user,
            license_number="LIC-EXEC-002",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )

        self.customer = Customer.objects.create(
            email="trip.exec.customer@example.com",
            password="hashed",
            name="Trip Exec Customer",
            is_active=True,
        )

        self.vehicle = Vehicle.objects.create(
            license_plate="EXEC-TRIP-001",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
        )
        self.other_vehicle = Vehicle.objects.create(
            license_plate="EXEC-TRIP-002",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
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
        self.other_driver_token = create_token(
            {
                "userId": self.other_driver_user.id,
                "email": self.other_driver_user.email,
                "name": self.other_driver_user.name,
                "role": "DRIVER",
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
        self.customer_token = create_token(
            {
                "userId": self.customer.id,
                "email": self.customer.email,
                "name": self.customer.name,
                "role": "CUSTOMER",
                "type": "customer",
            }
        )

        self.trip = Trip.objects.create(
            trip_number="TRP-EXEC-001",
            driver=self.driver,
            vehicle=self.vehicle,
            status=TripStatus.PLANNED,
            planned_start_at=timezone.now(),
            total_drop_points=2,
        )
        self.other_trip = Trip.objects.create(
            trip_number="TRP-EXEC-002",
            driver=self.other_driver,
            vehicle=self.other_vehicle,
            status=TripStatus.PLANNED,
            total_drop_points=1,
        )

        self.dp_1 = TripDropPoint.objects.create(
            trip=self.trip,
            sequence=1,
            location_name="Stop 1",
            address="Address 1",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            drop_point_type=DropPointType.DELIVERY,
        )
        self.dp_2 = TripDropPoint.objects.create(
            trip=self.trip,
            sequence=2,
            location_name="Stop 2",
            address="Address 2",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            drop_point_type=DropPointType.DELIVERY,
        )
        self.other_dp = TripDropPoint.objects.create(
            trip=self.other_trip,
            sequence=1,
            location_name="Other Stop",
            address="Other Address",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            drop_point_type=DropPointType.DELIVERY,
        )

    def test_trip_start_requires_staff_authentication(self) -> None:
        response = self.client.post(f"/api/trips/{self.trip.id}/start")
        self.assertEqual(response.status_code, 401)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Unauthorized")

    def test_trip_start_rejects_missing_trip(self) -> None:
        response = self.client.post(
            "/api/trips/missing-trip-id/start",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(response.status_code, 404)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Trip not found")

    def test_trip_start_forbidden_for_customer_token(self) -> None:
        response = self.client.post(
            f"/api/trips/{self.trip.id}/start",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        self.assertEqual(response.status_code, 403)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Forbidden")

    def test_trip_start_forbidden_for_other_driver(self) -> None:
        response = self.client.post(
            f"/api/trips/{self.trip.id}/start",
            HTTP_AUTHORIZATION=f"Bearer {self.other_driver_token}",
        )
        self.assertEqual(response.status_code, 403)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Forbidden")

    def test_trip_start_requires_load_confirmation(self) -> None:
        response = self.client.post(
            f"/api/trips/{self.trip.id}/start",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "Confirm Load is required before starting the trip")
        self.trip.refresh_from_db()
        self.assertEqual(self.trip.status, TripStatus.PLANNED)

    def test_trip_start_rejects_a_different_scheduled_date(self) -> None:
        tomorrow = timezone.now() + timedelta(days=1)
        self.trip.planned_start_at = tomorrow
        self.trip.save(update_fields=["planned_start_at", "updated_at"])

        response = self.client.post(
            f"/api/trips/{self.trip.id}/start",
            data={"confirmLoad": True},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            response.json()["error"],
            f"Trip can only be started on its scheduled date: {timezone.localdate(tomorrow).isoformat()}",
        )
        self.trip.refresh_from_db()
        self.assertEqual(self.trip.status, TripStatus.PLANNED)

    def test_trip_start_sets_in_progress_and_actual_start_at(self) -> None:
        order = Order.objects.create(
            order_number="ORD-TRIP-LOADED-001",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            subtotal=100,
            total_amount=110,
        )
        self.dp_1.order = order
        self.dp_1.save(update_fields=["order", "updated_at"])

        response = self.client.post(
            f"/api/trips/{self.trip.id}/start",
            data={"confirmLoad": True},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["trip"]["status"], TripStatus.IN_PROGRESS)
        self.assertIsNotNone(payload["trip"]["actualStartAt"])

        self.trip.refresh_from_db()
        self.assertEqual(self.trip.status, TripStatus.IN_PROGRESS)
        self.assertIsNotNone(self.trip.actual_start_at)
        order.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.OUT_FOR_DELIVERY)
        self.assertIsNotNone(order.warehouse_dispatched_at)

    def test_trip_start_retry_acknowledges_the_existing_session(self) -> None:
        # A lost mobile response must not make the driver reopen a session manually.
        first_response = self.client.post(
            f"/api/trips/{self.trip.id}/start",
            data={"confirmLoad": True},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(first_response.status_code, 200)
        self.trip.refresh_from_db()
        first_started_at = self.trip.actual_start_at

        retry_response = self.client.post(
            f"/api/trips/{self.trip.id}/start",
            data={"confirmLoad": True},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(retry_response.status_code, 200)
        self.assertTrue(retry_response.json()["success"])
        self.assertTrue(retry_response.json()["alreadyStarted"])
        self.trip.refresh_from_db()
        self.assertEqual(self.trip.status, TripStatus.IN_PROGRESS)
        self.assertEqual(self.trip.actual_start_at, first_started_at)

    def test_drop_point_update_requires_staff_auth(self) -> None:
        response = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_1.id}",
            data={"status": "ARRIVED"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 401)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Unauthorized")

    def test_drop_point_update_forbidden_for_customer_token(self) -> None:
        response = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_1.id}",
            data={"status": "ARRIVED"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        self.assertEqual(response.status_code, 403)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Forbidden")

    def test_drop_point_update_forbidden_for_other_driver(self) -> None:
        response = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_1.id}",
            data={"status": "ARRIVED"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.other_driver_token}",
        )
        self.assertEqual(response.status_code, 403)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Forbidden")

    def test_drop_point_arrived_sets_actual_arrival(self) -> None:
        response = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_1.id}",
            data={"status": "ARRIVED"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["dropPoint"]["status"], "ARRIVED")
        self.assertIsNotNone(payload["dropPoint"]["actualArrival"])

        self.dp_1.refresh_from_db()
        self.assertEqual(self.dp_1.status, "ARRIVED")
        self.assertIsNotNone(self.dp_1.actual_arrival)

    def test_drop_point_completion_updates_trip_completion_fields(self) -> None:
        # Stop completion is a driver action after the trip starts.
        self.trip.status = TripStatus.IN_PROGRESS
        self.trip.actual_start_at = timezone.now()
        self.trip.save(update_fields=["status", "actual_start_at", "updated_at"])
        order_1 = Order.objects.create(
            order_number="PO-NOTIFY-DELIVERY-001",
            purchase_request_number="PR-NOTIFY-DELIVERY-001",
            purchase_order_number="PO-NOTIFY-DELIVERY-001",
            customer=self.customer,
            status=OrderStatus.OUT_FOR_DELIVERY,
            request_status="APPROVED",
            purchase_order_stage="OUT_FOR_DELIVERY",
            subtotal=100,
            total_amount=100,
        )
        order_2 = Order.objects.create(
            order_number="PO-NOTIFY-DELIVERY-002",
            purchase_request_number="PR-NOTIFY-DELIVERY-002",
            purchase_order_number="PO-NOTIFY-DELIVERY-002",
            customer=self.customer,
            status=OrderStatus.OUT_FOR_DELIVERY,
            request_status="APPROVED",
            purchase_order_stage="OUT_FOR_DELIVERY",
            subtotal=100,
            total_amount=100,
        )
        self.dp_1.order = order_1
        self.dp_1.save(update_fields=["order", "updated_at"])
        self.dp_2.order = order_2
        self.dp_2.save(update_fields=["order", "updated_at"])

        response_first = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_1.id}",
            data={"status": "COMPLETED", "deliveryPhoto": "/uploads/pod/first.jpg"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(response_first.status_code, 200)
        self.trip.refresh_from_db()
        self.assertEqual(self.trip.completed_drop_points, 1)
        self.assertEqual(self.trip.status, TripStatus.IN_PROGRESS)

        response_second = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_2.id}",
            data={"status": "COMPLETED", "deliveryPhoto": "/uploads/pod/second.jpg"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(response_second.status_code, 200)
        payload_second = response_second.json()
        self.assertTrue(payload_second["success"])
        self.assertEqual(payload_second["dropPoint"]["status"], "COMPLETED")
        self.assertIsNotNone(payload_second["dropPoint"]["actualDeparture"])

        self.trip.refresh_from_db()
        self.assertEqual(self.trip.completed_drop_points, 2)
        self.assertEqual(self.trip.status, TripStatus.IN_PROGRESS)
        completion = self.client.post(
            f"/api/trips/{self.trip.id}/complete",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(completion.status_code, 200, completion.content)
        self.trip.refresh_from_db()
        self.assertEqual(self.trip.status, TripStatus.COMPLETED)
        self.assertIsNotNone(self.trip.actual_end_at)
        order_1.refresh_from_db()
        order_2.refresh_from_db()
        self.assertEqual(order_1.purchase_order_stage, "DELIVERED")
        self.assertEqual(order_2.purchase_order_stage, "DELIVERED")
        delivered_order_ids = {str(self.dp_1.order_id), str(self.dp_2.order_id)}
        notified_order_ids = set(
            Notification.objects.filter(
                customer=self.customer,
                type="ORDER",
                title="Order delivered",
                reference_id__in=delivered_order_ids,
            ).values_list("reference_id", flat=True)
        )
        self.assertEqual(notified_order_ids, delivered_order_ids)

    def test_drop_point_completion_retry_acknowledges_the_existing_delivery(self) -> None:
        # A delivery confirmation can be retried after a lost response without duplicating it.
        self.trip.status = TripStatus.IN_PROGRESS
        self.trip.actual_start_at = timezone.now()
        self.trip.save(update_fields=["status", "actual_start_at", "updated_at"])
        first_response = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_1.id}",
            data={"status": "COMPLETED", "deliveryPhoto": "/uploads/pod/retry-safe.jpg"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(first_response.status_code, 200)
        self.dp_1.refresh_from_db()
        first_departure = self.dp_1.actual_departure

        retry_response = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_1.id}",
            data={"status": "COMPLETED", "deliveryPhoto": "/uploads/pod/retry-safe.jpg"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(retry_response.status_code, 200)
        self.assertTrue(retry_response.json()["success"])
        self.assertTrue(retry_response.json()["alreadyCompleted"])
        self.dp_1.refresh_from_db()
        self.trip.refresh_from_db()
        self.assertEqual(self.dp_1.status, "COMPLETED")
        self.assertEqual(self.dp_1.actual_departure, first_departure)
        self.assertEqual(self.trip.completed_drop_points, 1)

    @patch("core.views_api._create_staff_notifications")
    def test_trip_complete_with_cancelled_delivery(self, notify_staff) -> None:
        # Fix regression: a cancelled stop must not strand an otherwise finished trip.
        self.trip.status = TripStatus.IN_PROGRESS
        self.trip.save(update_fields=["status"])
        self.trip.drop_points.filter(id=self.dp_1.id).update(status="COMPLETED")
        self.trip.drop_points.filter(id=self.dp_2.id).update(status="CANCELLED")
        cancelled = self.dp_2
        response = self.client.post(
            f"/api/trips/{self.trip.id}/complete",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(response.status_code, 200, response.content.decode())
        self.trip.refresh_from_db()
        cancelled.refresh_from_db()
        self.assertEqual(self.trip.status, TripStatus.COMPLETED)
        self.assertEqual(self.trip.completed_drop_points, 2)
        self.assertIsNotNone(self.trip.actual_end_at)
        self.assertEqual(cancelled.status, "CANCELLED")
        notify_staff.assert_called_once()

    @patch("core.views_api._create_staff_notifications")
    def test_trip_complete_still_blocks_unfinished_delivery(self, notify_staff) -> None:
        # Pending and deferred deliveries still require the driver to finish the work.
        self.trip.status = TripStatus.IN_PROGRESS
        self.trip.save(update_fields=["status"])
        self.trip.drop_points.filter(id=self.dp_1.id).update(status="CANCELLED")
        self.trip.drop_points.filter(id=self.dp_2.id).update(status="PENDING")
        response = self.client.post(
            f"/api/trips/{self.trip.id}/complete",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(response.status_code, 400)
        self.trip.refresh_from_db()
        self.assertEqual(self.trip.status, TripStatus.IN_PROGRESS)
        self.assertIsNone(self.trip.actual_end_at)
        notify_staff.assert_not_called()


    def test_trip_stays_open_when_remaining_drop_point_is_skipped(self) -> None:
        # A skipped stop needs follow-up, so it cannot close the delivery trip.
        self.trip.status = TripStatus.IN_PROGRESS
        self.trip.actual_start_at = timezone.now()
        self.trip.save(update_fields=["status", "actual_start_at", "updated_at"])
        response_first = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_1.id}",
            data={"status": "COMPLETED", "deliveryPhoto": "/uploads/pod/skipped-first.jpg"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(response_first.status_code, 200)

        response_second = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_2.id}",
            data={"status": "SKIPPED", "notes": "Customer unavailable"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(response_second.status_code, 200)

        self.trip.refresh_from_db()
        self.assertEqual(self.trip.completed_drop_points, 2)
        self.assertEqual(self.trip.status, TripStatus.IN_PROGRESS)
        completion = self.client.post(
            f"/api/trips/{self.trip.id}/complete",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(completion.status_code, 400, completion.content)
        self.trip.refresh_from_db()
        self.assertEqual(self.trip.status, TripStatus.IN_PROGRESS)
        self.assertIsNone(self.trip.actual_end_at)

    def test_drop_point_failed_reschedule_today_moves_stop_to_route_end(self) -> None:
        response = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_1.id}",
            data={
                "status": "FAILED",
                "notes": "Customer asked for later today",
                "releaseInventory": False,
                "rescheduleRequested": True,
                "rescheduleWindow": "today",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["dropPoint"]["status"], "PENDING")
        self.assertEqual(payload["dropPoint"]["sequence"], 2)
        self.assertFalse(payload.get("requeuedToRoutePool"))

        self.dp_1.refresh_from_db()
        self.dp_2.refresh_from_db()
        self.trip.refresh_from_db()

        self.assertEqual(self.dp_1.status, "PENDING")
        self.assertEqual(self.dp_1.sequence, 2)
        self.assertEqual(self.dp_2.sequence, 1)
        self.assertEqual(self.trip.completed_drop_points, 0)
        self.assertEqual(self.trip.status, TripStatus.PLANNED)

    def test_drop_point_failed_reschedule_other_date_requeues_order_to_route_pool(self) -> None:
        warehouse = Warehouse.objects.create(
            name="Other Date Warehouse",
            code="WH-OTHER-DATE-001",
            address="Warehouse Address",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            country="Philippines",
        )
        product = Product.objects.create(
            sku="SKU-OTHER-DATE-001",
            name="Other Date Product",
            unit="piece",
            price=20,
        )
        Inventory.objects.create(
            warehouse=warehouse,
            product=product,
            quantity=10,
            reserved_quantity=1,
            threshold=0,
        )
        order = Order.objects.create(
            order_number="ORD-OTHER-DATE-001",
            customer=self.customer,
            status=OrderStatus.OUT_FOR_DELIVERY,
            subtotal=20,
            total_amount=20,
            warehouse_id=warehouse.id,
            ready_to_load_at=timezone.now() - timedelta(days=1),
            loaded_at=timezone.now() - timedelta(hours=8),
            warehouse_dispatched_at=timezone.now() - timedelta(hours=2),
        )
        OrderTimeline.objects.create(order=order, delivery_date=timezone.now())
        order_item = OrderItem.objects.create(
            order=order,
            product=product,
            quantity=1,
            unit_price=20,
            total_price=20,
        )
        InventoryTransaction.objects.create(
            warehouse=warehouse,
            product=product,
            type="RESERVE",
            quantity=1,
            reference_type="order_item_reserve",
            reference_id=order_item.id,
            notes="Initial reservation for other date",
            performed_by=self.admin_user.id,
        )
        self.dp_1.order = order
        self.dp_1.save(update_fields=["order", "updated_at"])

        target_date = (timezone.now() + timedelta(days=3)).date().isoformat()
        response = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_1.id}",
            data={
                "status": "FAILED",
                "notes": "Reschedule on custom date",
                "releaseInventory": False,
                "rescheduleRequested": True,
                "rescheduleWindow": "other_date",
                "rescheduleDate": target_date,
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertTrue(payload.get("requeuedToRoutePool"))
        self.assertEqual(payload["dropPoint"]["status"], "FAILED")

        order.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.RESCHEDULED)

    def test_drop_point_failed_reschedule_keeps_inventory_reserved_while_cancel_releases_it(self) -> None:
        warehouse = Warehouse.objects.create(
            name="Lifecycle Warehouse",
            code="WH-LIFECYCLE-001",
            address="Warehouse Address",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            country="Philippines",
        )
        product = Product.objects.create(
            sku="SKU-LIFECYCLE-001",
            name="Lifecycle Product",
            unit="piece",
            price=25,
        )
        inventory = Inventory.objects.create(
            warehouse=warehouse,
            product=product,
            quantity=10,
            reserved_quantity=2,
            threshold=0,
        )
        batch = StockBatch.objects.create(
            batch_number="BATCH-LIFECYCLE-001",
            inventory=inventory,
            quantity=2,
            receipt_date=timezone.now(),
        )
        order = Order.objects.create(
            order_number="ORD-LIFECYCLE-001",
            customer=self.customer,
            status=OrderStatus.OUT_FOR_DELIVERY,
            subtotal=50,
            total_amount=50,
            warehouse_id=warehouse.id,
            ready_to_load_at=timezone.now() - timedelta(days=1),
            loaded_at=timezone.now() - timedelta(hours=8),
            warehouse_dispatched_at=timezone.now() - timedelta(hours=2),
        )
        order.shipping_name = "Trip Exec Customer"
        order.shipping_phone = "+63-900-000-0000"
        order.shipping_address = "123 Reschedule Street"
        order.shipping_city = "Bacolod"
        order.shipping_province = "Negros Occidental"
        order.shipping_zip_code = "6100"
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
        OrderTimeline.objects.create(order=order, delivery_date=timezone.now())
        order_item = OrderItem.objects.create(
            order=order,
            product=product,
            quantity=2,
            unit_price=25,
            total_price=50,
        )
        InventoryTransaction.objects.create(
            warehouse=warehouse,
            product=product,
            type="RESERVE",
            quantity=2,
            reference_type="order_item_reserve",
            reference_id=order_item.id,
            notes="Initial reservation for lifecycle test",
            performed_by=self.admin_user.id,
        )
        self.dp_1.order = order
        self.dp_1.save(update_fields=["order", "updated_at"])
        self.dp_2.order = order
        self.dp_2.save(update_fields=["order", "updated_at"])

        reschedule_response = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_1.id}",
            data={
                "status": "FAILED",
                "notes": "Reschedule later",
                "releaseInventory": False,
                "rescheduleRequested": True,
                "rescheduleWindow": "tomorrow",
                "rescheduleDate": (timezone.now() + timedelta(days=1)).date().isoformat(),
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(reschedule_response.status_code, 200)
        self.assertTrue(reschedule_response.json().get("requeuedToRoutePool"))
        self.dp_1.refresh_from_db()
        inventory.refresh_from_db()
        order.refresh_from_db()
        self.trip.refresh_from_db()
        self.assertEqual(self.dp_1.status, "FAILED")
        self.assertEqual(inventory.reserved_quantity, 2)
        self.assertEqual(order.status, OrderStatus.RESCHEDULED)
        self.assertIsNone(order.loaded_at)
        self.assertIsNone(order.warehouse_dispatched_at)
        self.assertEqual(self.trip.completed_drop_points, 1)
        self.assertEqual(self.trip.status, TripStatus.PLANNED)
        self.assertIsNone(self.trip.actual_end_at)
        route_plan_response = self.client.get(
            "/api/trips/route-plan",
            data={"warehouseId": warehouse.id},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(route_plan_response.status_code, 200)
        route_plan_payload = route_plan_response.json()
        self.assertTrue(route_plan_payload["success"])
        self.assertIn("orders", route_plan_payload)
        self.assertEqual(
            InventoryTransaction.objects.filter(
                reference_type="order_item_reserve",
                reference_id=order_item.id,
                type="UNRESERVE",
            ).count(),
            0,
        )

        cancel_response = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_2.id}",
            data={"status": "SKIPPED", "notes": "Cancel delivery"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(cancel_response.status_code, 200)
        self.assertFalse(cancel_response.json().get("requeuedToRoutePool"))
        self.dp_2.refresh_from_db()
        inventory.refresh_from_db()
        self.assertEqual(self.dp_2.status, "SKIPPED")
        self.assertEqual(inventory.reserved_quantity, 0)
        self.assertEqual(
            InventoryTransaction.objects.filter(
                reference_type="order_item_reserve",
                reference_id=order_item.id,
                type="UNRESERVE",
            ).count(),
            1,
        )

    def test_drop_point_failed_without_reschedule_cancels_order_for_customer_tracking(self) -> None:
        warehouse = Warehouse.objects.create(
            name="Failed Delivery Warehouse",
            code="WH-FAILED-001",
            address="Warehouse Address",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            country="Philippines",
        )
        product = Product.objects.create(
            sku="SKU-FAILED-001",
            name="Failed Delivery Product",
            unit="piece",
            price=25,
        )
        inventory = Inventory.objects.create(
            warehouse=warehouse,
            product=product,
            quantity=10,
            reserved_quantity=2,
            threshold=0,
        )
        StockBatch.objects.create(
            batch_number="BATCH-FAILED-001",
            inventory=inventory,
            quantity=2,
            receipt_date=timezone.now(),
        )
        order = Order.objects.create(
            order_number="ORD-FAILED-001",
            customer=self.customer,
            status=OrderStatus.OUT_FOR_DELIVERY,
            subtotal=50,
            total_amount=50,
            warehouse_id=warehouse.id,
        )
        OrderTimeline.objects.create(order=order, delivery_date=timezone.now())
        order_item = OrderItem.objects.create(
            order=order,
            product=product,
            quantity=2,
            unit_price=25,
            total_price=50,
        )
        InventoryTransaction.objects.create(
            warehouse=warehouse,
            product=product,
            type="RESERVE",
            quantity=2,
            reference_type="order_item_reserve",
            reference_id=order_item.id,
            notes="Initial reservation for failed delivery test",
            performed_by=self.admin_user.id,
        )
        self.dp_1.order = order
        self.dp_1.save(update_fields=["order", "updated_at"])

        response = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_1.id}",
            data={
                "status": "FAILED",
                "notes": "Customer unavailable",
                "failureReason": "Customer unavailable",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json().get("requeuedToRoutePool"))

        order.refresh_from_db()
        inventory.refresh_from_db()
        self.trip.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.CANCELLED)
        self.assertEqual(inventory.reserved_quantity, 0)
        self.assertIsNotNone(order.timeline.cancelled_at)
        self.assertEqual(self.trip.completed_drop_points, 1)
        self.assertEqual(self.trip.status, TripStatus.PLANNED)
        self.assertIsNone(self.trip.actual_end_at)

    def test_single_failed_drop_point_completes_trip(self) -> None:
        single_trip = Trip.objects.create(
            trip_number="TRP-EXEC-FAILED-ONLY-001",
            driver=self.driver,
            vehicle=self.vehicle,
            status=TripStatus.IN_PROGRESS,
            total_drop_points=1,
            actual_start_at=timezone.now() - timedelta(hours=1),
        )
        single_drop_point = TripDropPoint.objects.create(
            trip=single_trip,
            sequence=1,
            location_name="Only Stop",
            address="Only Address",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            drop_point_type=DropPointType.DELIVERY,
        )

        response = self.client.patch(
            f"/api/trips/{single_trip.id}/drop-points/{single_drop_point.id}",
            data={
                "status": "FAILED",
                "notes": "Customer unavailable",
                "failureReason": "Customer unavailable",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 200)

        single_trip.refresh_from_db()
        single_drop_point.refresh_from_db()
        self.assertEqual(single_drop_point.status, "FAILED")
        self.assertEqual(single_trip.completed_drop_points, 1)
        self.assertEqual(single_trip.total_drop_points, 1)
        self.assertEqual(single_trip.status, TripStatus.IN_PROGRESS)
        completion = self.client.post(
            f"/api/trips/{single_trip.id}/complete",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(completion.status_code, 200, completion.content)
        single_trip.refresh_from_db()
        self.assertEqual(single_trip.status, TripStatus.COMPLETED)
        self.assertIsNotNone(single_trip.actual_end_at)


class TripStopAliasContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.driver_user = User.objects.create(
            email="trip.stop.alias.driver@example.com",
            password="hashed",
            name="Trip Stop Alias Driver",
            role=self.driver_role,
            is_active=True,
        )
        self.driver = Driver.objects.create(
            user=self.driver_user,
            license_number="LIC-STOP-ALIAS-001",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )
        self.customer = Customer.objects.create(
            email="trip.stop.alias.customer@example.com",
            password="hashed",
            name="Trip Stop Alias Customer",
            is_active=True,
        )
        self.vehicle = Vehicle.objects.create(
            license_plate="STOP-ALIAS-001",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
        )
        self.trip = Trip.objects.create(
            trip_number="TRP-STOP-ALIAS-001",
            driver=self.driver,
            vehicle=self.vehicle,
            status=TripStatus.IN_PROGRESS,
            total_drop_points=1,
        )
        self.stop = TripDropPoint.objects.create(
            trip=self.trip,
            sequence=1,
            location_name="Alias Stop",
            address="Alias Address",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            drop_point_type=DropPointType.DELIVERY,
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
        self.customer_token = create_token(
            {
                "userId": self.customer.id,
                "email": self.customer.email,
                "name": self.customer.name,
                "role": "CUSTOMER",
                "type": "customer",
            }
        )

    def test_trip_stop_alias_behaves_like_drop_point_update(self) -> None:
        response = self.client.patch(
            f"/api/trips/{self.trip.id}/stops/{self.stop.id}",
            data={"status": "ARRIVED", "notes": "Reached stop"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["dropPoint"]["status"], "ARRIVED")
        self.assertEqual(payload["dropPoint"]["notes"], "Reached stop")
        self.assertIsNotNone(payload["dropPoint"]["actualArrival"])

    def test_trip_stop_alias_enforces_same_auth_rules(self) -> None:
        unauthorized = self.client.patch(
            f"/api/trips/{self.trip.id}/stops/{self.stop.id}",
            data={"status": "ARRIVED"},
            content_type="application/json",
        )
        self.assertEqual(unauthorized.status_code, 401)

        forbidden = self.client.patch(
            f"/api/trips/{self.trip.id}/stops/{self.stop.id}",
            data={"status": "ARRIVED"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        self.assertEqual(forbidden.status_code, 403)


# These assert the authentication contract and the local-disk fallback, so the object
# storage bucket is pinned off. Without this the suite picks up whatever Supabase
# credentials happen to be in the developer's .env and tries to reach the network.
