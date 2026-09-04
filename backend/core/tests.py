import json
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from django.utils import timezone

from .auth import create_token
from .models import (
    ContainerType,
    Customer,
    DropPointType,
    Feedback,
    Inventory,
    InventoryTransaction,
    LocationLog,
    Notification,
    Order,
    OrderItem,
    OrderTimeline,
    OrderStatus,
    PurchaseOrderStage,
    Product,
    ProductPackaging,
    Replacement,
    StockBatch,
    Trip,
    TripDropPoint,
    TripStatus,
    User,
    Vehicle,
    VehicleType,
    Warehouse,
)
from .views_api import _create_scheduled_replacement_order, _mark_order_delivered


class _RoleValue(str):
    def __new__(cls, value: str):
        obj = str.__new__(cls, value)
        obj.id = value
        obj.name = value
        return obj


class Role:
    class objects:
        @staticmethod
        def create(name: str, description: str | None = None):
            return _RoleValue(name)


class Driver:
    class objects:
        @staticmethod
        def create(*, user: User, **kwargs):
            user.role = "DRIVER"
            if "license_number" in kwargs:
                user.license_number = kwargs.get("license_number")
            if "license_type" in kwargs:
                user.license_type = kwargs.get("license_type")
            if "license_expiry" in kwargs:
                user.license_expiry = kwargs.get("license_expiry")
            if "emergency_contact" in kwargs:
                user.emergency_contact = kwargs.get("emergency_contact")
            if "rating" in kwargs:
                user.rating = kwargs.get("rating")
            if "total_deliveries" in kwargs:
                user.total_deliveries = kwargs.get("total_deliveries")
            if "is_active" in kwargs:
                user.is_active = bool(kwargs.get("is_active"))
            if "hired_at" in kwargs:
                user.hired_at = kwargs.get("hired_at")
            user.save()
            user.user = user
            return user


class NotificationsApiContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")
        self.primary_user = User.objects.create(
            email="primary.admin@example.com",
            password="hashed",
            name="Primary Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.other_user = User.objects.create(
            email="other.admin@example.com",
            password="hashed",
            name="Other Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.primary_token = create_token(
            {
                "userId": self.primary_user.id,
                "email": self.primary_user.email,
                "name": self.primary_user.name,
                "role": self.admin_role.name,
                "type": "staff",
            }
        )

    def test_get_notifications_includes_unread_count_and_scopes_to_authenticated_user(self) -> None:
        Notification.objects.create(
            user=self.primary_user,
            title="Unread 1",
            message="Primary unread 1",
            type="order_update",
            is_read=False,
        )
        Notification.objects.create(
            user=self.primary_user,
            title="Unread 2",
            message="Primary unread 2",
            type="order_update",
            is_read=False,
        )
        Notification.objects.create(
            user=self.primary_user,
            title="Read 1",
            message="Primary read 1",
            type="order_update",
            is_read=True,
            read_at=timezone.now(),
        )
        Notification.objects.create(
            user=self.other_user,
            title="Other unread",
            message="Other unread",
            type="order_update",
            is_read=False,
        )

        response = self.client.get(
            "/api/notifications",
            HTTP_AUTHORIZATION=f"Bearer {self.primary_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["unreadCount"], 2)
        self.assertEqual(len(payload["notifications"]), 3)
        for item in payload["notifications"]:
            self.assertEqual(item["user"], self.primary_user.id)

    def test_patch_notifications_mark_all_marks_only_current_user_and_returns_unread_count(self) -> None:
        primary_unread_1 = Notification.objects.create(
            user=self.primary_user,
            title="Unread 1",
            message="Primary unread 1",
            type="order_update",
            is_read=False,
        )
        primary_unread_2 = Notification.objects.create(
            user=self.primary_user,
            title="Unread 2",
            message="Primary unread 2",
            type="order_update",
            is_read=False,
        )
        other_unread = Notification.objects.create(
            user=self.other_user,
            title="Other unread",
            message="Other unread",
            type="order_update",
            is_read=False,
        )

        response = self.client.patch(
            "/api/notifications",
            data='{"markAll": true}',
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.primary_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["updated"], 2)
        self.assertEqual(payload["unreadCount"], 0)

        primary_unread_1.refresh_from_db()
        primary_unread_2.refresh_from_db()
        other_unread.refresh_from_db()

        self.assertTrue(primary_unread_1.is_read)
        self.assertTrue(primary_unread_2.is_read)
        self.assertIsNotNone(primary_unread_1.read_at)
        self.assertIsNotNone(primary_unread_2.read_at)
        self.assertFalse(other_unread.is_read)

    def test_patch_notifications_by_ids_marks_selected_owned_records_only(self) -> None:
        target_1 = Notification.objects.create(
            user=self.primary_user,
            title="Target 1",
            message="Target 1",
            type="order_update",
            is_read=False,
        )
        target_2 = Notification.objects.create(
            user=self.primary_user,
            title="Target 2",
            message="Target 2",
            type="order_update",
            is_read=False,
        )
        untouched_same_user = Notification.objects.create(
            user=self.primary_user,
            title="Untouched",
            message="Untouched",
            type="order_update",
            is_read=False,
        )
        other_user_notification = Notification.objects.create(
            user=self.other_user,
            title="Other user",
            message="Other user",
            type="order_update",
            is_read=False,
        )

        response = self.client.patch(
            "/api/notifications",
            data=f'{{"ids": ["{target_1.id}", "{other_user_notification.id}", "{target_2.id}"]}}',
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.primary_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["updated"], 2)
        self.assertEqual(payload["unreadCount"], 1)

        target_1.refresh_from_db()
        target_2.refresh_from_db()
        untouched_same_user.refresh_from_db()
        other_user_notification.refresh_from_db()

        self.assertTrue(target_1.is_read)
        self.assertTrue(target_2.is_read)
        self.assertFalse(untouched_same_user.is_read)
        self.assertFalse(other_user_notification.is_read)

    def test_notifications_requires_authentication(self) -> None:
        response = self.client.get("/api/notifications")
        self.assertEqual(response.status_code, 401)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Unauthorized")

    def test_patch_notifications_requires_ids_when_mark_all_is_not_used(self) -> None:
        response = self.client.patch(
            "/api/notifications",
            data="{}",
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.primary_token}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "ids is required")

    def test_patch_notifications_mark_all_takes_precedence_over_ids(self) -> None:
        n1 = Notification.objects.create(
            user=self.primary_user,
            title="N1",
            message="N1",
            type="order_update",
            is_read=False,
        )
        n2 = Notification.objects.create(
            user=self.primary_user,
            title="N2",
            message="N2",
            type="order_update",
            is_read=False,
        )

        response = self.client.patch(
            "/api/notifications",
            data=f'{{"markAll": true, "ids": ["{n1.id}"]}}',
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.primary_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["updated"], 2)
        self.assertEqual(payload["unreadCount"], 0)

        n1.refresh_from_db()
        n2.refresh_from_db()
        self.assertTrue(n1.is_read)
        self.assertTrue(n2.is_read)


class FeedbackRatingContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.customer = Customer.objects.create(
            email="required.feedback.customer@example.com",
            password="hashed",
            name="Required Feedback Customer",
            is_active=True,
        )
        self.order = Order.objects.create(
            order_number="ORD-REQUIRED-FEEDBACK-001",
            customer=self.customer,
            status=OrderStatus.DELIVERED,
            subtotal=100,
            total_amount=100,
        )
        self.token = create_token(
            {
                "userId": self.customer.id,
                "email": self.customer.email,
                "name": self.customer.name,
                "role": "CUSTOMER",
                "type": "customer",
            }
        )

    def test_rating_requires_non_empty_feedback_message(self) -> None:
        response = self.client.post(
            "/api/feedback",
            data={
                "orderId": self.order.id,
                "rating": 5,
                "type": "COMPLIMENT",
                "subject": f"Order Review - {self.order.order_number}",
                "message": "   ",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "Feedback is required when submitting a rating")
        self.assertFalse(Feedback.objects.filter(order=self.order, customer=self.customer).exists())


class DriverLocationAccuracyContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.driver = User.objects.create(
            email="accurate.location.driver@example.com",
            password="hashed",
            name="Accurate Location Driver",
            role="DRIVER",
            is_active=True,
        )
        self.token = create_token(
            {
                "userId": self.driver.id,
                "email": self.driver.email,
                "name": self.driver.name,
                "role": "DRIVER",
                "type": "staff",
            }
        )

    def test_inaccurate_sample_cannot_overwrite_reliable_driver_location(self) -> None:
        reliable = self.client.post(
            "/api/driver/location",
            data={"latitude": 10.6765, "longitude": 122.9509, "accuracy": 15},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(reliable.status_code, 200)

        inaccurate = self.client.post(
            "/api/driver/location",
            data={"latitude": 10.7000, "longitude": 123.0000, "accuracy": 500},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(inaccurate.status_code, 400)

        latest = LocationLog.objects.get(driver=self.driver)
        self.assertEqual(latest.latitude, 10.6765)
        self.assertEqual(latest.longitude, 122.9509)
        self.assertEqual(latest.accuracy, 15)

    def test_each_driver_account_keeps_its_own_latest_location(self) -> None:
        other_driver = User.objects.create(
            email="other.location.driver@example.com",
            password="hashed",
            name="Other Location Driver",
            role="DRIVER",
            is_active=True,
        )
        other_token = create_token(
            {
                "userId": other_driver.id,
                "email": other_driver.email,
                "name": other_driver.name,
                "role": "DRIVER",
                "type": "staff",
            }
        )

        first_response = self.client.post(
            "/api/driver/location",
            # A supplied driverId must never override the authenticated account owner.
            data={"driverId": other_driver.id, "latitude": 10.6765, "longitude": 122.9509, "accuracy": 15},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        second_response = self.client.post(
            "/api/driver/location",
            data={"latitude": 10.7000, "longitude": 123.0000, "accuracy": 20},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {other_token}",
        )

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(second_response.status_code, 200)
        self.assertEqual(LocationLog.objects.filter(driver=self.driver).count(), 1)
        self.assertEqual(LocationLog.objects.filter(driver=other_driver).count(), 1)
        self.assertEqual(LocationLog.objects.get(driver=self.driver).latitude, 10.6765)
        self.assertEqual(LocationLog.objects.get(driver=other_driver).latitude, 10.7000)
        self.assertNotEqual(
            first_response.json()["locationLogId"],
            second_response.json()["locationLogId"],
        )


class PurchaseRequestWorkflowTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.warehouse = Warehouse.objects.create(
            name="Central Warehouse",
            code="WH-001",
            address="Burgos Street",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
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
            data='{"status":"CONFIRMED"}',
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 200)
        self.order.refresh_from_db()
        self.assertEqual(self.order.request_status, "APPROVED")
        self.assertEqual(self.order.status, OrderStatus.CONFIRMED)
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


class DriverVehicleActiveTripValidationTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.staff = User.objects.create(
            email="transport.admin@example.com",
            password="hashed",
            name="Transport Admin",
            role="ADMIN",
            is_active=True,
        )
        self.driver = User.objects.create(
            email="active.trip.driver@example.com",
            password="hashed",
            name="Active Trip Driver",
            phone="09171234567",
            role="DRIVER",
            license_number="D09-22-000984",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )
        self.vehicle = Vehicle.objects.create(
            license_plate="ACTIVE-TRIP-001",
            type=VehicleType.TRUCK,
            driver=self.driver,
        )
        self.trip = Trip.objects.create(
            trip_number="TRIP-ACTIVE-UNASSIGN-001",
            driver=self.driver,
            vehicle=self.vehicle,
            status=TripStatus.IN_PROGRESS,
            actual_start_at=timezone.now(),
        )
        self.token = create_token(
            {
                "userId": self.staff.id,
                "email": self.staff.email,
                "name": self.staff.name,
                "role": "ADMIN",
                "type": "staff",
            }
        )

    def test_vehicle_update_rejects_unassignment_during_active_trip(self) -> None:
        response = self.client.patch(
            "/api/vehicles",
            data={"id": self.vehicle.id, "driverId": ""},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn(self.trip.trip_number, response.json()["error"])
        self.assertIn("Complete or cancel the trip", response.json()["error"])
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.driver_id, self.driver.id)

    def test_driver_update_allows_unassignment_after_trip_is_closed(self) -> None:
        self.trip.status = TripStatus.COMPLETED
        self.trip.actual_end_at = timezone.now()
        self.trip.save(update_fields=["status", "actual_end_at", "updated_at"])

        response = self.client.put(
            "/api/drivers",
            data={"id": self.driver.id, "vehicleId": ""},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.vehicle.refresh_from_db()
        self.assertIsNone(self.vehicle.driver_id)

    def test_driver_status_update_persists_and_is_returned(self) -> None:
        response = self.client.put(
            "/api/drivers",
            data={"id": self.driver.id, "status": "OnLeave", "vehicleId": self.vehicle.id},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["driver"]["status"], "ON_LEAVE")
        self.driver.refresh_from_db()
        self.assertEqual(self.driver.driver_status, "ON_LEAVE")

        list_response = self.client.get(
            "/api/drivers?includeSample=true",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(list_response.status_code, 200, list_response.content)
        row = next(item for item in list_response.json()["drivers"] if item["id"] == self.driver.id)
        self.assertEqual(row["status"], "ON_LEAVE")


class CustomerTrackingApiContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.driver_user = User.objects.create(
            email="driver.contract@example.com",
            password="hashed",
            name="Driver Contract",
            role=self.driver_role,
            is_active=True,
        )
        self.driver = Driver.objects.create(
            user=self.driver_user,
            license_number="LIC-CONTRACT-001",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )
        self.vehicle = Vehicle.objects.create(
            license_plate="TEST-TRACK-001",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
        )

        self.customer = Customer.objects.create(
            email="customer.contract@example.com",
            password="hashed",
            name="Customer Contract",
            is_active=True,
        )
        self.other_customer = Customer.objects.create(
            email="other.customer.contract@example.com",
            password="hashed",
            name="Other Customer Contract",
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

    def test_customer_tracking_returns_status_and_order_status_for_compatibility(self) -> None:
        order = Order.objects.create(
            order_number="ORD-CONTRACT-001",
            customer=self.customer,
            status=OrderStatus.OUT_FOR_DELIVERY,
            subtotal=100,
            total_amount=110,
        )
        Order.objects.create(
            order_number="ORD-CONTRACT-OTHER-001",
            customer=self.other_customer,
            status=OrderStatus.PREPARING,
            subtotal=80,
            total_amount=85,
        )
        trip = Trip.objects.create(
            trip_number="TRIP-CONTRACT-001",
            driver=self.driver,
            vehicle=self.vehicle,
            status=TripStatus.IN_PROGRESS,
        )
        TripDropPoint.objects.create(
            trip=trip,
            order=order,
            drop_point_type=DropPointType.DELIVERY,
            sequence=1,
            location_name="Customer Address",
            address="123 Main St",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
        )
        response = self.client.get(
            "/api/customer/tracking",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(len(payload["tracking"]), 1)
        item = payload["tracking"][0]
        self.assertEqual(item["orderId"], order.id)
        self.assertEqual(item["status"], OrderStatus.OUT_FOR_DELIVERY)
        self.assertEqual(item["orderStatus"], OrderStatus.OUT_FOR_DELIVERY)
        self.assertIn("trip", item)
        self.assertIsNotNone(item["trip"])

    def test_customer_profile_put_persists_first_and_last_names(self) -> None:
        response = self.client.put(
            f"/api/customers/{self.customer.id}",
            data={
                "name": "Updated Customer Name",
                "firstName": "Updated",
                "lastName": "Customer",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["customer"]["firstName"], "Updated")
        self.assertEqual(payload["customer"]["lastName"], "Customer")
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.first_name, "Updated")
        self.assertEqual(self.customer.last_name, "Customer")


class CustomerOrdersApiContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.customer = Customer.objects.create(
            email="orders.customer@example.com",
            password="hashed",
            name="Orders Customer",
            is_active=True,
        )
        self.other_customer = Customer.objects.create(
            email="orders.other@example.com",
            password="hashed",
            name="Orders Other Customer",
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
        self.staff_role = Role.objects.create(name="ADMIN", description="Admin")
        self.staff_user = User.objects.create(
            email="orders.staff@example.com",
            password="hashed",
            name="Orders Staff",
            phone="+63 9171234567",
            role=self.staff_role,
            is_active=True,
        )
        self.staff_token = create_token(
            {
                "userId": self.staff_user.id,
                "email": self.staff_user.email,
                "name": self.staff_user.name,
                "role": self.staff_role.name,
                "type": "staff",
            }
        )

    def test_customer_orders_returns_only_authenticated_customer_orders_and_shape(self) -> None:
        own_order = Order.objects.create(
            order_number="ORD-CUST-001",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            subtotal=500,
            total_amount=550,
        )
        Order.objects.create(
            order_number="ORD-CUST-OTHER-001",
            customer=self.other_customer,
            status=OrderStatus.CONFIRMED,
            subtotal=300,
            total_amount=330,
        )

        response = self.client.get(
            "/api/customer/orders",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["total"], 1)
        self.assertEqual(len(payload["orders"]), 1)
        order_row = payload["orders"][0]
        self.assertEqual(order_row["id"], own_order.id)
        self.assertEqual(order_row["orderNumber"], own_order.order_number)
        self.assertEqual(order_row["customer"]["id"], self.customer.id)
        self.assertEqual(order_row["adminPhone"], self.staff_user.phone)
        self.assertEqual(order_row["sellerPhone"], self.staff_user.phone)
        self.assertIn("items", order_row)
        self.assertIn("logistics", order_row)
        self.assertIn("timeline", order_row)

    def test_order_payload_exposes_inventory_transaction_ids_only_after_delivery(self) -> None:
        warehouse = Warehouse.objects.create(
            name="Delivery Transaction Warehouse",
            code="WH-DELIVERY-TX",
            address="Warehouse Road",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
        )
        product = Product.objects.create(
            sku="SKU-DELIVERY-TX",
            name="Delivery Transaction Product",
            unit="case",
            price=100,
        )
        delivered_order = Order.objects.create(
            order_number="ORD-DELIVERY-TX",
            customer=self.customer,
            status=OrderStatus.DELIVERED,
            subtotal=100,
            total_amount=100,
            warehouse_id=warehouse.id,
        )
        delivered_item = OrderItem.objects.create(
            order=delivered_order,
            product=product,
            product_name=product.name,
            quantity=1,
            unit_price=100,
            total_price=100,
        )
        OrderTimeline.objects.create(order=delivered_order, delivered_at=timezone.now())
        delivery_transaction = InventoryTransaction.objects.create(
            warehouse=warehouse,
            product=product,
            type="OUT",
            quantity=1,
            reference_type="order_item",
            reference_id=delivered_item.id,
        )
        related_delivery_transaction = InventoryTransaction.objects.create(
            warehouse=warehouse,
            product=product,
            type="OUT",
            quantity=1,
            order_item=delivered_item,
            reference_type="mixed_case_component",
            reference_id="component-transaction",
        )

        pending_order = Order.objects.create(
            order_number="ORD-NOT-DELIVERED-TX",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            subtotal=100,
            total_amount=100,
            warehouse_id=warehouse.id,
        )
        OrderItem.objects.create(
            order=pending_order,
            product=product,
            product_name=product.name,
            quantity=1,
            unit_price=100,
            total_price=100,
        )

        response = self.client.get(
            "/api/customer/orders",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 200)
        orders_by_id = {row["id"]: row for row in response.json()["orders"]}
        expected_transaction_ids = [delivery_transaction.id, related_delivery_transaction.id]
        self.assertEqual(orders_by_id[delivered_order.id]["inventoryTransactionIds"], expected_transaction_ids)
        self.assertEqual(orders_by_id[delivered_order.id]["inventoryTransactionId"], delivery_transaction.id)
        delivered_items_by_id = {row["id"]: row for row in orders_by_id[delivered_order.id]["items"]}
        self.assertEqual(delivered_items_by_id[delivered_item.id]["inventoryTransactionIds"], expected_transaction_ids)
        self.assertEqual(orders_by_id[pending_order.id]["inventoryTransactionIds"], [])
        self.assertIsNone(orders_by_id[pending_order.id]["inventoryTransactionId"])
        self.assertEqual(orders_by_id[pending_order.id]["items"][0]["inventoryTransactionIds"], [])

    def test_customer_orders_rejects_non_customer_tokens(self) -> None:
        response = self.client.get(
            "/api/customer/orders",
            HTTP_AUTHORIZATION=f"Bearer {self.staff_token}",
        )

        self.assertEqual(response.status_code, 401)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Unauthorized")

    def test_customer_cannot_cancel_preparing_order(self) -> None:
        order = Order.objects.create(
            order_number="ORD-CANCEL-PREPARING-001",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            subtotal=100,
            total_amount=110,
        )

        response = self.client.patch(
            f"/api/customer/orders/{order.id}/cancel",
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Order cannot be cancelled")

        order.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.PREPARING)

    def test_customer_cancellation_requires_and_saves_reason(self) -> None:
        order = Order.objects.create(
            order_number="ORD-CANCEL-REASON-001",
            customer=self.customer,
            status=OrderStatus.PENDING,
            subtotal=100,
            total_amount=110,
        )

        missing_reason = self.client.patch(
            f"/api/customer/orders/{order.id}/cancel",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        self.assertEqual(missing_reason.status_code, 400)
        self.assertEqual(missing_reason.json()["error"], "A cancellation reason is required")

        response = self.client.patch(
            f"/api/customer/orders/{order.id}/cancel",
            data={"reason": "Incorrect delivery address"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        self.assertEqual(response.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.CANCELLED)
        self.assertEqual(order.cancellation_reason, "Incorrect delivery address")

    def test_customer_order_create_defaults_to_pending(self) -> None:
        warehouse = Warehouse.objects.create(
            name="Pending Warehouse",
            code="WH-PENDING-001",
            address="Warehouse Road",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            is_active=True,
        )
        product = Product.objects.create(
            sku="SKU-PENDING-001",
            name="Pending Product",
            unit="piece",
            price=25,
        )
        inventory = Inventory.objects.create(
            warehouse=warehouse,
            product=product,
            quantity=10,
            reserved_quantity=0,
            threshold=1,
        )
        StockBatch.objects.create(
            batch_number="BATCH-PENDING-001",
            inventory=inventory,
            quantity=10,
            receipt_date=timezone.now(),
            status="ACTIVE",
        )

        response = self.client.post(
            "/api/customer/orders",
            data={
                "warehouseId": warehouse.id,
                "shippingLatitude": 10.67,
                "shippingLongitude": 122.95,
                "shippingProvince": "Negros Occidental",
                "items": [
                    {
                        "productId": product.id,
                        "quantity": 2,
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["order"]["status"], OrderStatus.PENDING)


class DriverTripsApiContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")

        self.driver_user = User.objects.create(
            email="driver.trips@example.com",
            password="hashed",
            name="Driver Trips",
            role=self.driver_role,
            is_active=True,
        )
        self.other_driver_user = User.objects.create(
            email="driver.trips.other@example.com",
            password="hashed",
            name="Driver Trips Other",
            role=self.driver_role,
            is_active=True,
        )
        self.admin_user = User.objects.create(
            email="driver.trips.admin@example.com",
            password="hashed",
            name="Driver Trips Admin",
            role=self.admin_role,
            is_active=True,
        )

        self.driver = Driver.objects.create(
            user=self.driver_user,
            license_number="LIC-TRIPS-001",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )
        self.other_driver = Driver.objects.create(
            user=self.other_driver_user,
            license_number="LIC-TRIPS-002",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )

        self.vehicle = Vehicle.objects.create(
            license_plate="TRIPS-001",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
        )
        self.other_vehicle = Vehicle.objects.create(
            license_plate="TRIPS-002",
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
        self.admin_token = create_token(
            {
                "userId": self.admin_user.id,
                "email": self.admin_user.email,
                "name": self.admin_user.name,
                "role": "ADMIN",
                "type": "staff",
            }
        )

    def test_driver_trips_returns_only_authenticated_driver_trips_with_latest_location(self) -> None:
        own_trip = Trip.objects.create(
            trip_number="TRP-DRIVER-001",
            driver=self.driver,
            vehicle=self.vehicle,
            status=TripStatus.IN_PROGRESS,
        )
        Trip.objects.create(
            trip_number="TRP-DRIVER-OTHER-001",
            driver=self.other_driver,
            vehicle=self.other_vehicle,
            status=TripStatus.PLANNED,
        )

        LocationLog.objects.create(
            driver=self.driver,
            trip=own_trip,
            latitude=10.1001,
            longitude=123.9001,
            recorded_at=timezone.now() - timedelta(minutes=3),
        )
        latest_log = LocationLog.objects.create(
            driver=self.driver,
            trip=own_trip,
            latitude=10.2002,
            longitude=123.8002,
            recorded_at=timezone.now(),
        )

        response = self.client.get(
            "/api/driver/trips",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(len(payload["trips"]), 1)

        row = payload["trips"][0]
        self.assertEqual(row["id"], own_trip.id)
        self.assertEqual(row["tripNumber"], own_trip.trip_number)
        self.assertIn("dropPoints", row)
        self.assertIn("driver", row)
        self.assertIn("vehicle", row)
        self.assertIsNotNone(row["latestLocation"])
        self.assertEqual(row["latestLocation"]["latitude"], float(latest_log.latitude))
        self.assertEqual(row["latestLocation"]["longitude"], float(latest_log.longitude))

    def test_driver_trips_forbidden_for_non_driver_staff(self) -> None:
        response = self.client.get(
            "/api/driver/trips",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(response.status_code, 403)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Forbidden")

    def test_driver_trip_uses_latest_unlinked_driver_log_as_gps_fallback(self) -> None:
        trip = Trip.objects.create(
            trip_number="TRP-DRIVER-FALLBACK-001",
            driver=self.driver,
            vehicle=self.vehicle,
            status=TripStatus.PLANNED,
        )
        latest_log = LocationLog.objects.create(
            driver=self.driver,
            trip=None,
            latitude=10.3155,
            longitude=123.8855,
            accuracy=18,
        )

        response = self.client.get(
            "/api/driver/trips",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 200)
        row = next(item for item in response.json()["trips"] if item["id"] == trip.id)
        self.assertEqual(row["latestLocation"]["latitude"], latest_log.latitude)
        self.assertEqual(row["latestLocation"]["longitude"], latest_log.longitude)
        self.assertEqual(row["latestLocation"]["accuracy"], latest_log.accuracy)

    def test_driver_trip_never_falls_back_to_another_driver_location(self) -> None:
        trip = Trip.objects.create(
            trip_number="TRP-DRIVER-NO-LOCATION-001",
            driver=self.driver,
            vehicle=self.vehicle,
            status=TripStatus.PLANNED,
        )
        LocationLog.objects.create(
            driver=self.other_driver,
            trip=None,
            latitude=10.9999,
            longitude=122.9999,
            accuracy=12,
        )

        response = self.client.get(
            "/api/driver/trips",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 200)
        row = next(item for item in response.json()["trips"] if item["id"] == trip.id)
        # No own saved GPS means unavailable; another account is never a fallback.
        self.assertIsNone(row["latestLocation"])


class CustomerOrdersPostApiContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.customer = Customer.objects.create(
            email="post.customer@example.com",
            password="hashed",
            name="Post Customer",
            phone="+1-555-1000",
            address="123 Test Ave",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            is_active=True,
        )
        self.other_customer = Customer.objects.create(
            email="post.other.customer@example.com",
            password="hashed",
            name="Post Other Customer",
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

        self.warehouse = Warehouse.objects.create(
            name="Main Warehouse",
            code="WH-POST-001",
            address="Warehouse Road",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            is_active=True,
        )
        self.product = Product.objects.create(
            sku="SKU-POST-001",
            name="Mineral Water",
            unit="case",
            price=120,
            is_active=True,
        )
        self.inventory = Inventory.objects.create(
            warehouse=self.warehouse,
            product=self.product,
            quantity=20,
            reserved_quantity=0,
            threshold=2,
        )
        StockBatch.objects.create(
            batch_number="BATCH-POST-001",
            inventory=self.inventory,
            quantity=20,
            receipt_date=timezone.now(),
            status="ACTIVE",
        )

    def test_customer_orders_post_creates_unreserved_purchase_request_for_authenticated_customer(self) -> None:
        warehouse_staff = User.objects.create(
            email="order.alert.warehouse@example.com",
            password="hashed",
            name="Order Alert Warehouse Staff",
            role=Role.objects.create(name="WAREHOUSE_STAFF", description="Warehouse staff"),
            is_active=True,
        )
        response = self.client.post(
            "/api/customer/orders",
            data={
                "customerId": self.other_customer.id,
                "warehouseId": self.warehouse.id,
                "shippingAddress": "Overridden Shipping Address",
                "shippingLatitude": 10.67,
                "shippingLongitude": 122.95,
                "shippingCity": "Talisay",
                "shippingProvince": "Negros Occidental",
                "items": [
                    {
                        "productId": self.product.id,
                        "quantity": 2,
                        "unitPrice": 120,
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 201, response.content.decode())
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertIn("order", payload)

        order_row = payload["order"]
        self.assertEqual(order_row["customer"]["id"], self.customer.id)
        self.assertEqual(order_row["warehouseId"], self.warehouse.id)
        self.assertEqual(len(order_row["items"]), 1)
        self.assertEqual(order_row["items"][0]["product"]["id"], self.product.id)
        self.assertEqual(order_row["items"][0]["quantity"], 2)

        created_order = Order.objects.get(id=order_row["id"])
        self.assertEqual(created_order.customer_id, self.customer.id)
        # Added: customer checkout must create a navigable warehouse notification.
        self.assertTrue(
            Notification.objects.filter(
                user=warehouse_staff,
                title="New order received",
                type="ORDER",
                reference_type="order",
                reference_id=created_order.id,
                is_read=False,
            ).exists()
        )

        self.inventory.refresh_from_db()
        self.assertEqual(self.inventory.quantity, 20)
        self.assertEqual(self.inventory.reserved_quantity, 0)

        reserve_count = InventoryTransaction.objects.filter(
            reference_type="order_item_reserve",
            type="RESERVE",
        ).count()
        self.assertEqual(reserve_count, 0)

    def test_customer_orders_post_adds_standard_case_deposit_to_total(self) -> None:
        container_type = ContainerType.objects.create(
            code="RGB-TOTAL-330",
            name="330ml Returnable Glass Bottle",
            deposit_amount=2,
        )
        self.product.category = "Carbonated (Glass)"
        self.product.packaging_type = "RETURNABLE"
        self.product.quantity_per_unit = 24
        self.product.price = 240
        self.product.save(update_fields=["category", "packaging_type", "quantity_per_unit", "price", "updated_at"])
        ProductPackaging.objects.create(
            product=self.product,
            container_type=container_type,
            containers_per_case=24,
            is_primary=True,
            is_returnable=True,
            deposit_amount=2,
            case_deposit_amount=42,
        )

        response = self.client.post(
            "/api/customer/orders",
            data={
                "warehouseId": self.warehouse.id,
                "shippingLatitude": 10.67,
                "shippingLongitude": 122.95,
                "shippingCity": "Talisay",
                "shippingProvince": "Negros Occidental",
                "items": [{"productId": self.product.id, "quantity": 1}],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 201, response.content.decode())
        created_order = Order.objects.get(id=response.json()["order"]["id"])
        # The product subtotal and new container deposit must both be payable.
        self.assertEqual(created_order.subtotal, 240)
        self.assertEqual(created_order.total_amount, 282)
        self.assertEqual(created_order.items.get().net_deposit, 42)

    @patch("core.views_api._email_new_order_to_warehouse_staff")
    @patch("core.views_api._email_order_confirmed_to_customer")
    def test_second_purchase_request_approval_is_blocked_when_first_uses_remaining_stock(
        self,
        _mock_approval_email,
        _mock_new_order_email,
    ) -> None:
        # Two requests may be submitted, but approval must serialize against the
        # latest reserved quantity so the second cannot overbook inventory.
        self.inventory.quantity = 10
        self.inventory.reserved_quantity = 0
        self.inventory.save(update_fields=["quantity", "reserved_quantity", "updated_at"])
        StockBatch.objects.filter(inventory=self.inventory).update(quantity=10)

        warehouse_staff = User.objects.create(
            email="approval.stock.staff@example.com",
            password="hashed",
            name="Approval Stock Staff",
            role="WAREHOUSE_STAFF",
            is_active=True,
        )
        staff_token = create_token(
            {
                "userId": warehouse_staff.id,
                "email": warehouse_staff.email,
                "name": warehouse_staff.name,
                "role": "WAREHOUSE_STAFF",
                "type": "staff",
            }
        )
        other_customer_token = create_token(
            {
                "userId": self.other_customer.id,
                "email": self.other_customer.email,
                "name": self.other_customer.name,
                "role": "CUSTOMER",
                "type": "customer",
            }
        )
        order_payload = {
            "warehouseId": self.warehouse.id,
            "shippingAddress": "Approval Test Address",
            "shippingCity": "Talisay",
            "shippingProvince": "Negros Occidental",
            "shippingLatitude": 10.67,
            "shippingLongitude": 122.95,
            "items": [{"productId": self.product.id, "quantity": 10}],
        }

        first_request = self.client.post(
            "/api/customer/orders",
            data=order_payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        second_request = self.client.post(
            "/api/customer/orders",
            data=order_payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {other_customer_token}",
        )
        self.assertEqual(first_request.status_code, 201, first_request.content)
        self.assertEqual(second_request.status_code, 201, second_request.content)
        first_order_id = first_request.json()["order"]["id"]
        second_order_id = second_request.json()["order"]["id"]

        first_approval = self.client.patch(
            f"/api/orders/{first_order_id}/status",
            data={"status": "CONFIRMED"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {staff_token}",
        )
        second_approval = self.client.patch(
            f"/api/orders/{second_order_id}/status",
            data={"status": "CONFIRMED"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {staff_token}",
        )

        self.assertEqual(first_approval.status_code, 200, first_approval.content)
        self.assertEqual(second_approval.status_code, 400, second_approval.content)
        self.assertIn("Available: 0 cases; required: 10 cases", second_approval.json()["error"])
        self.inventory.refresh_from_db()
        self.assertEqual(self.inventory.reserved_quantity, 10)
        self.assertLessEqual(self.inventory.reserved_quantity, self.inventory.quantity)
        self.assertEqual(Order.objects.get(id=second_order_id).request_status, "PENDING_APPROVAL")

    @patch("core.views_api._create_staff_notifications", side_effect=RuntimeError("notification unavailable"))
    @patch("core.views_api._email_new_order_to_warehouse_staff", side_effect=RuntimeError("email unavailable"))
    def test_customer_orders_post_succeeds_when_post_commit_notifications_fail(
        self,
        _mock_email,
        _mock_staff_notifications,
    ) -> None:
        # Fix: a committed purchase request must never be reported to the customer as failed.
        response = self.client.post(
            "/api/customer/orders",
            data={
                "warehouseId": self.warehouse.id,
                "shippingAddress": "Notification Failure Address",
                "shippingLatitude": 10.67,
                "shippingLongitude": 122.95,
                "shippingCity": "Talisay",
                "shippingProvince": "Negros Occidental",
                "items": [{"productId": self.product.id, "quantity": 2}],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 201, response.content.decode())
        self.assertTrue(response.json()["success"])
        self.assertEqual(Order.objects.filter(customer=self.customer).count(), 1)

    def test_customer_orders_post_requires_items(self) -> None:
        response = self.client.post(
            "/api/customer/orders",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "items are required")

    def test_customer_orders_post_auto_assigns_nearest_fulfillable_warehouse_when_not_provided(self) -> None:
        near_warehouse = Warehouse.objects.create(
            name="Near Warehouse",
            code="WH-POST-NEAR-001",
            address="Near Road",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            latitude=10.3150,
            longitude=123.3000,
            is_active=True,
        )
        far_warehouse = Warehouse.objects.create(
            name="Far Warehouse",
            code="WH-POST-FAR-001",
            address="Far Road",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            latitude=9.3000,
            longitude=122.3000,
            is_active=True,
        )

        near_inventory = Inventory.objects.create(
            warehouse=near_warehouse,
            product=self.product,
            quantity=20,
            reserved_quantity=0,
            threshold=2,
        )
        far_inventory = Inventory.objects.create(
            warehouse=far_warehouse,
            product=self.product,
            quantity=20,
            reserved_quantity=0,
            threshold=2,
        )
        StockBatch.objects.create(
            batch_number="BATCH-POST-NEAR-001",
            inventory=near_inventory,
            quantity=20,
            receipt_date=timezone.now(),
            status="ACTIVE",
        )
        StockBatch.objects.create(
            batch_number="BATCH-POST-FAR-001",
            inventory=far_inventory,
            quantity=20,
            receipt_date=timezone.now(),
            status="ACTIVE",
        )

        response = self.client.post(
            "/api/customer/orders",
            data={
                "shippingLatitude": 10.3140,
                "shippingLongitude": 123.3010,
                "items": [
                    {
                        "productId": self.product.id,
                        "quantity": 2,
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["order"]["warehouseId"], near_warehouse.id)

    def test_customer_orders_post_leaves_warehouse_unassigned_when_no_single_warehouse_can_fulfill(self) -> None:
        product_two = Product.objects.create(
            sku="SKU-POST-002",
            name="Sparkling Water",
            unit="case",
            price=140,
            is_active=True,
        )

        warehouse_two = Warehouse.objects.create(
            name="Secondary Warehouse",
            code="WH-POST-002",
            address="Secondary Road",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            is_active=True,
        )

        self.inventory.quantity = 5
        self.inventory.reserved_quantity = 0
        self.inventory.save(update_fields=["quantity", "reserved_quantity", "updated_at"])

        inventory_two = Inventory.objects.create(
            warehouse=warehouse_two,
            product=product_two,
            quantity=5,
            reserved_quantity=0,
            threshold=1,
        )
        StockBatch.objects.create(
            batch_number="BATCH-POST-002",
            inventory=inventory_two,
            quantity=5,
            receipt_date=timezone.now(),
            status="ACTIVE",
        )

        response = self.client.post(
            "/api/customer/orders",
            data={
                "shippingLatitude": 10.67,
                "shippingLongitude": 122.95,
                "shippingProvince": "Negros Occidental",
                "items": [
                    {
                        "productId": self.product.id,
                        "quantity": 2,
                    },
                    {
                        "productId": product_two.id,
                        "quantity": 2,
                    },
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertIsNone(payload["order"]["warehouseId"])


class DriverProfileApiContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")

        self.driver_user = User.objects.create(
            email="profile.driver@example.com",
            password="hashed",
            name="Profile Driver",
            phone="+1-555-2222",
            role=self.driver_role,
            is_active=True,
        )
        self.admin_user = User.objects.create(
            email="profile.admin@example.com",
            password="hashed",
            name="Profile Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.driver = Driver.objects.create(
            user=self.driver_user,
            license_number="LIC-PROFILE-001",
            license_type="C",
            license_expiry=timezone.now() + timedelta(days=365),
            emergency_contact="Old Contact",
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
        self.admin_token = create_token(
            {
                "userId": self.admin_user.id,
                "email": self.admin_user.email,
                "name": self.admin_user.name,
                "role": "ADMIN",
                "type": "staff",
            }
        )

    def test_driver_profile_get_returns_driver_and_user_shape(self) -> None:
        response = self.client.get(
            "/api/driver/profile",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertIn("driver", payload)
        self.assertEqual(payload["driver"]["id"], self.driver.id)
        self.assertEqual(payload["driver"]["user"]["id"], self.driver_user.id)
        self.assertEqual(payload["driver"]["user"]["email"], self.driver_user.email)

    def test_driver_profile_put_updates_avatar(self) -> None:
        response = self.client.put(
            "/api/driver/profile",
            data={"avatar": "/uploads/customers/driver-avatar.png"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 200)
        self.driver_user.refresh_from_db()
        self.assertEqual(self.driver_user.avatar, "/uploads/customers/driver-avatar.png")
        self.assertEqual(response.json()["driver"]["avatar"], self.driver_user.avatar)

    def test_driver_profile_put_updates_gmail_and_refreshes_token(self) -> None:
        response = self.client.put(
            "/api/driver/profile",
            data={"email": "updated.profile.driver@gmail.com"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.driver_user.refresh_from_db()
        self.assertEqual(self.driver_user.email, "updated.profile.driver@gmail.com")
        self.assertEqual(response.json()["driver"]["email"], self.driver_user.email)
        self.assertTrue(response.json().get("token"))

    def test_driver_profile_put_updates_driver_and_user_fields(self) -> None:
        response = self.client.put(
            "/api/driver/profile",
            data={
                "name": "Updated Driver Name",
                "firstName": "Updated",
                "lastName": "Driver",
                "phone": "09171234567",
                "avatar": "/uploads/avatars/new.png",
                "emergencyContact": "Updated Emergency Contact",
                "licenseNumber": "LIC-PROFILE-UPDATED",
                "licenseType": "C",
                "licensePhotoUrl": "/uploads/licenses/license-new.png",
                "licenseExpiry": "2030-01-15T10:00:00Z",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["driver"]["user"]["name"], "Updated Driver")
        self.assertEqual(payload["driver"]["user"]["firstName"], "Updated")
        self.assertEqual(payload["driver"]["user"]["lastName"], "Driver")
        self.assertEqual(payload["driver"]["user"]["phone"], "09171234567")
        self.assertEqual(payload["driver"]["licenseNumber"], "LIC-PROFILE-UPDATED")
        self.assertEqual(payload["driver"]["licenseType"], "C")
        self.assertEqual(payload["driver"]["licensePhotoUrl"], "/uploads/licenses/license-new.png")

        self.driver.refresh_from_db()
        self.driver_user.refresh_from_db()
        self.assertEqual(self.driver.emergency_contact, "Updated Emergency Contact")
        self.assertEqual(self.driver.license_number, "LIC-PROFILE-UPDATED")
        self.assertEqual(self.driver.license_type, "C")
        self.assertEqual(self.driver.license_photo_url, "/uploads/licenses/license-new.png")
        self.assertEqual(self.driver_user.name, "Updated Driver")
        self.assertEqual(self.driver_user.first_name, "Updated")
        self.assertEqual(self.driver_user.last_name, "Driver")
        self.assertEqual(self.driver_user.phone, "09171234567")
        self.assertEqual(self.driver_user.avatar, "/uploads/avatars/new.png")
        self.assertEqual(self.driver.license_expiry.year, 2030)

    def test_driver_profile_rejects_invalid_phone_and_past_license_expiry(self) -> None:
        invalid_phone = self.client.put(
            "/api/driver/profile",
            data={"phone": "not-a-number"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(invalid_phone.status_code, 400)
        self.assertEqual(invalid_phone.json()["error"], "Please enter a valid Philippine mobile number")

        expired_license = self.client.put(
            "/api/driver/profile",
            data={"licenseExpiry": "2020-01-01"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(expired_license.status_code, 400)
        self.assertEqual(expired_license.json()["error"], "License expiration date cannot be in the past.")

        invalid_restriction = self.client.put(
            "/api/driver/profile",
            data={"licenseType": "3"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(invalid_restriction.status_code, 400)
        self.assertEqual(
            invalid_restriction.json()["error"],
            "Restrictions must be one of: A, A1, B, B1, B2, C, D, BE, CE",
        )

    def test_driver_profile_forbidden_for_non_driver_staff(self) -> None:
        response = self.client.get(
            "/api/driver/profile",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(response.status_code, 403)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Forbidden")


class StaffPhoneValidationContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin = User.objects.create(
            email="phone.admin@example.com",
            password="hashed",
            name="Phone Admin",
            phone="09171234567",
            role="ADMIN",
            is_active=True,
        )
        self.staff = User.objects.create(
            email="phone.staff@example.com",
            password="hashed",
            name="Phone Staff",
            phone="639181234567",
            role="WAREHOUSE_STAFF",
            is_active=True,
        )
        self.admin_token = create_token(
            {
                "userId": self.admin.id,
                "email": self.admin.email,
                "name": self.admin.name,
                "role": "ADMIN",
                "type": "staff",
            }
        )
        self.staff_token = create_token(
            {
                "userId": self.staff.id,
                "email": self.staff.email,
                "name": self.staff.name,
                "role": "WAREHOUSE_STAFF",
                "type": "staff",
            }
        )

    def test_auth_me_returns_saved_phone_for_admin_and_warehouse_staff(self) -> None:
        admin_response = self.client.get(
            "/api/auth/me",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        staff_response = self.client.get(
            "/api/auth/me",
            HTTP_AUTHORIZATION=f"Bearer {self.staff_token}",
        )

        self.assertEqual(admin_response.status_code, 200)
        self.assertEqual(admin_response.json()["user"]["phone"], self.admin.phone)
        self.assertEqual(staff_response.status_code, 200)
        self.assertEqual(staff_response.json()["user"]["phone"], self.staff.phone)

    def test_staff_phone_update_persists_valid_philippine_mobile(self) -> None:
        response = self.client.put(
            f"/api/users/{self.staff.id}",
            data={"phone": "639171234567"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 200)
        self.staff.refresh_from_db()
        self.assertEqual(self.staff.phone, "639171234567")
        self.assertEqual(response.json()["user"]["phone"], "639171234567")

    def test_staff_phone_update_rejects_non_numeric_or_invalid_mobile(self) -> None:
        response = self.client.put(
            f"/api/users/{self.staff.id}",
            data={"phone": "09AB1234567"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "Please enter a valid Philippine mobile number")


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
            data={"status": "COMPLETED"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(response_first.status_code, 200)
        self.trip.refresh_from_db()
        self.assertEqual(self.trip.completed_drop_points, 1)
        self.assertEqual(self.trip.status, TripStatus.PLANNED)

        response_second = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_2.id}",
            data={"status": "COMPLETED"},
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

    def test_trip_completes_when_remaining_drop_point_is_skipped(self) -> None:
        response_first = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_1.id}",
            data={"status": "COMPLETED"},
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
        self.assertEqual(self.trip.status, TripStatus.COMPLETED)
        self.assertIsNotNone(self.trip.actual_end_at)

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
        self.assertEqual(order.status, OrderStatus.PREPARING)

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
        self.assertEqual(order.status, OrderStatus.PREPARING)
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
@override_settings(SUPABASE_URL="", SUPABASE_SERVICE_ROLE_KEY="")
class UploadEndpointsAuthContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")

        self.driver_user = User.objects.create(
            email="upload.driver@example.com",
            password="hashed",
            name="Upload Driver",
            role=self.driver_role,
            is_active=True,
        )
        self.admin_user = User.objects.create(
            email="upload.admin@example.com",
            password="hashed",
            name="Upload Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.customer = Customer.objects.create(
            email="upload.customer@example.com",
            password="hashed",
            name="Upload Customer",
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

    def test_upload_product_image_requires_staff_auth(self) -> None:
        response = self.client.post("/api/uploads/product-image")
        self.assertEqual(response.status_code, 401)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Unauthorized")

    def test_upload_pod_image_requires_driver_role(self) -> None:
        pod_as_admin = self.client.post(
            "/api/uploads/pod-image",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(pod_as_admin.status_code, 403)
        self.assertEqual(pod_as_admin.json()["error"], "Forbidden")

    def test_upload_customer_avatar_requires_authenticated_user(self) -> None:
        response = self.client.post("/api/uploads/customer-avatar")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"], "Unauthorized")

    def test_upload_endpoints_validate_missing_and_non_image_files(self) -> None:
        missing_file = self.client.post(
            "/api/uploads/pod-image",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(missing_file.status_code, 400)
        self.assertEqual(missing_file.json()["error"], "Image file is required")

        text_file = SimpleUploadedFile("notes.txt", b"not-an-image", content_type="text/plain")
        non_image = self.client.post(
            "/api/uploads/pod-image",
            data={"file": text_file},
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(non_image.status_code, 400)
        self.assertEqual(non_image.json()["error"], "Only image files are allowed")

    def test_upload_customer_avatar_accepts_authenticated_customer_with_image(self) -> None:
        image_file = SimpleUploadedFile("avatar.png", b"\x89PNG\r\n\x1a\nfake", content_type="image/png")
        response = self.client.post(
            "/api/uploads/customer-avatar",
            data={"file": image_file},
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertIn("/uploads/customers/customer-", payload["imageUrl"])

    def test_upload_customer_avatar_accepts_authenticated_driver_with_image(self) -> None:
        image_file = SimpleUploadedFile("driver-avatar.png", b"\x89PNG\r\n\x1a\nfake", content_type="image/png")
        response = self.client.post(
            "/api/uploads/customer-avatar",
            data={"file": image_file},
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["success"])


class TripsCollectionTrackingContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")
        self.admin_user = User.objects.create(
            email="trips.collection.admin@example.com",
            password="hashed",
            name="Trips Collection Admin",
            role=self.admin_role,
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
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.driver_user = User.objects.create(
            email="trips.collection.driver@example.com",
            password="hashed",
            name="Trips Collection Driver",
            role=self.driver_role,
            is_active=True,
        )
        self.driver = Driver.objects.create(
            user=self.driver_user,
            license_number="LIC-TRIPS-COLLECTION-001",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )
        self.vehicle = Vehicle.objects.create(
            license_plate="TRIPS-COLLECTION-001",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
        )

    def test_trips_collection_include_tracking_and_date_filter(self) -> None:
        target_date = timezone.now().date()
        other_date = target_date - timedelta(days=1)

        trip_on_target = Trip.objects.create(
            trip_number="TRP-COLLECTION-001",
            driver=self.driver,
            vehicle=self.vehicle,
            status=TripStatus.IN_PROGRESS,
            planned_start_at=timezone.make_aware(
                timezone.datetime(target_date.year, target_date.month, target_date.day, 9, 0, 0)
            ),
        )
        Trip.objects.create(
            trip_number="TRP-COLLECTION-002",
            driver=self.driver,
            vehicle=self.vehicle,
            status=TripStatus.PLANNED,
            created_at=timezone.make_aware(
                timezone.datetime(other_date.year, other_date.month, other_date.day, 7, 0, 0)
            ),
            planned_start_at=timezone.make_aware(
                timezone.datetime(other_date.year, other_date.month, other_date.day, 9, 0, 0)
            ),
        )

        LocationLog.objects.create(
            driver=self.driver,
            trip=trip_on_target,
            latitude=10.01,
            longitude=123.01,
            recorded_at=timezone.make_aware(
                timezone.datetime(target_date.year, target_date.month, target_date.day, 10, 0, 0)
            ),
        )
        latest_target_log = LocationLog.objects.create(
            driver=self.driver,
            trip=trip_on_target,
            latitude=10.02,
            longitude=123.02,
            recorded_at=timezone.make_aware(
                timezone.datetime(target_date.year, target_date.month, target_date.day, 11, 0, 0)
            ),
        )
        LocationLog.objects.create(
            driver=self.driver,
            trip=trip_on_target,
            latitude=9.99,
            longitude=122.99,
            recorded_at=timezone.make_aware(
                timezone.datetime(other_date.year, other_date.month, other_date.day, 8, 0, 0)
            ),
        )

        response = self.client.get(
            "/api/trips",
            data={"includeTracking": "true", "trackingDate": target_date.isoformat()},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(len(payload["trips"]), 1)

        trip_row = payload["trips"][0]
        self.assertEqual(trip_row["id"], trip_on_target.id)
        self.assertIn("locationLogs", trip_row)
        self.assertIn("latestLocation", trip_row)
        self.assertEqual(len(trip_row["locationLogs"]), 2)
        self.assertIsNotNone(trip_row["latestLocation"])
        self.assertEqual(trip_row["latestLocation"]["id"], latest_target_log.id)

    def test_trips_collection_rejects_invalid_tracking_date(self) -> None:
        response = self.client.get(
            "/api/trips",
            data={"trackingDate": "2026-99-99"},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Invalid trackingDate. Expected YYYY-MM-DD")

    def test_include_tracking_returns_latest_driver_location_without_an_active_trip(self) -> None:
        latest_log = LocationLog.objects.create(
            driver=self.driver,
            trip=None,
            latitude=10.7999,
            longitude=122.9787,
            recorded_at=timezone.now(),
        )

        response = self.client.get(
            "/api/trips",
            data={"includeTracking": "true"},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(len(payload["driverLocations"]), 1)
        location = payload["driverLocations"][0]
        self.assertEqual(location["id"], latest_log.id)
        self.assertEqual(location["driverId"], self.driver.id)
        self.assertEqual(location["driverName"], self.driver.name)
        self.assertIsNone(location["tripId"])


class RoutePlanContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")
        self.admin_user = User.objects.create(
            email="route.plan.admin@example.com",
            password="hashed",
            name="Route Plan Admin",
            role=self.admin_role,
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

    def test_route_plan_requires_staff_auth(self) -> None:
        response = self.client.get("/api/trips/route-plan")
        self.assertEqual(response.status_code, 401)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Unauthorized")

    def test_route_plan_get_rejects_invalid_date(self) -> None:
        response = self.client.get(
            "/api/trips/route-plan",
            data={"date": "2026-13-01"},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Invalid date. Expected YYYY-MM-DD")

    def test_route_plan_post_accepts_payload_echo(self) -> None:
        response = self.client.post(
            "/api/trips/route-plan",
            data={"city": "Bacolod", "orders": [{"id": "ord-1"}]},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["message"], "Route plan accepted")
        self.assertEqual(payload["routePlan"]["city"], "Bacolod")


class RoutePlanStructureContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.admin_user = User.objects.create(
            email="route.plan.structure.admin@route.local",
            password="hashed",
            name="Route Plan Structure Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.driver_user = User.objects.create(
            email="route.plan.structure.driver@route.local",
            password="hashed",
            name="Route Plan Structure Driver",
            role=self.driver_role,
            is_active=True,
        )
        self.driver = Driver.objects.create(
            user=self.driver_user,
            license_number="LIC-ROUTE-STRUCTURE-001",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )
        self.vehicle = Vehicle.objects.create(
            license_plate="ROUTE-STRUCTURE-001",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
        )
        self.customer = Customer.objects.create(
            email="route.plan.structure.customer@route.local",
            password="hashed",
            name="Route Plan Structure Customer",
            latitude=10.31,
            longitude=123.89,
            is_active=True,
        )
        self.warehouse = Warehouse.objects.create(
            name="Route Plan WH",
            code="WH-ROUTE-STRUCT-001",
            address="Route Plan Road",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            latitude=10.30,
            longitude=123.90,
            is_active=True,
        )
        self.product = Product.objects.create(
            sku="SKU-ROUTE-STRUCT-001",
            name="Sparkling Water",
            unit="case",
            price=100,
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

    def test_route_plan_get_returns_drivers_vehicles_orders_and_grouped_plans(self) -> None:
        order = Order.objects.create(
            order_number="ORD-ROUTE-STRUCT-001",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            subtotal=200,
            total_amount=220,
            warehouse_id=self.warehouse.id,
        )
        OrderItem.objects.create(
            order=order,
            product=self.product,
            quantity=2,
            unit_price=100,
            total_price=200,
        )
        order.shipping_name = "Customer A"
        order.shipping_phone = "+1-555-0100"
        order.shipping_address = "123 Structure Street"
        order.shipping_city = "Bacolod"
        order.shipping_province = "Negros Occidental"
        order.shipping_zip_code = "6100"
        order.shipping_country = "Philippines"
        order.shipping_latitude = 10.32
        order.shipping_longitude = 123.88
        order.save(
            update_fields=[
                "shipping_name",
                "shipping_phone",
                "shipping_address",
                "shipping_city",
                "shipping_province",
                "shipping_zip_code",
                "shipping_country",
                "shipping_latitude",
                "shipping_longitude",
                "updated_at",
            ]
        )
        OrderTimeline.objects.create(order=order, delivery_date=timezone.now())

        response = self.client.get(
            "/api/trips/route-plan",
            data={"warehouseId": self.warehouse.id},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertIn("drivers", payload)
        self.assertIn("vehicles", payload)
        self.assertIn("orders", payload)
        self.assertIn("routePlans", payload)
        self.assertGreaterEqual(len(payload["drivers"]), 1)
        self.assertGreaterEqual(len(payload["vehicles"]), 1)
        self.assertGreaterEqual(len(payload["orders"]), 1)
        self.assertGreaterEqual(len(payload["routePlans"]), 1)

        plan = payload["routePlans"][0]
        self.assertIn("city", plan)
        self.assertIn("orderCount", plan)
        self.assertIn("totalDistanceKm", plan)
        self.assertIn("orders", plan)

    def test_route_plan_uses_rescheduled_delivery_date_not_created_date(self) -> None:
        future_delivery = timezone.now() + timedelta(days=2)
        order = Order.objects.create(
            order_number="ORD-ROUTE-RESCHEDULED-001",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            subtotal=200,
            total_amount=220,
            warehouse_id=self.warehouse.id,
        )
        OrderItem.objects.create(
            order=order,
            product=self.product,
            quantity=2,
            unit_price=100,
            total_price=200,
        )
        order.shipping_name = "Customer A"
        order.shipping_phone = "+1-555-0100"
        order.shipping_address = "123 Structure Street"
        order.shipping_city = "Bacolod"
        order.shipping_province = "Negros Occidental"
        order.shipping_zip_code = "6100"
        order.shipping_country = "Philippines"
        order.shipping_latitude = 10.32
        order.shipping_longitude = 123.88
        order.save(
            update_fields=[
                "shipping_name",
                "shipping_phone",
                "shipping_address",
                "shipping_city",
                "shipping_province",
                "shipping_zip_code",
                "shipping_country",
                "shipping_latitude",
                "shipping_longitude",
                "updated_at",
            ]
        )
        OrderTimeline.objects.create(order=order, delivery_date=future_delivery)

        today_response = self.client.get(
            "/api/trips/route-plan",
            data={"warehouseId": self.warehouse.id, "date": timezone.now().date().isoformat()},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(today_response.status_code, 200)
        today_order_ids = [row["id"] for row in today_response.json()["orders"]]
        self.assertNotIn(order.id, today_order_ids)

        future_response = self.client.get(
            "/api/trips/route-plan",
            data={"warehouseId": self.warehouse.id, "date": future_delivery.date().isoformat()},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(future_response.status_code, 200)
        future_order_ids = [row["id"] for row in future_response.json()["orders"]]
        self.assertIn(order.id, future_order_ids)

    def test_route_plan_hides_order_assigned_to_trip_until_trip_deleted(self) -> None:
        delivery_date = timezone.now() + timedelta(days=1)
        order = Order.objects.create(
            order_number="ORD-ROUTE-ASSIGNED-001",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            subtotal=200,
            total_amount=220,
            warehouse_id=self.warehouse.id,
        )
        OrderItem.objects.create(
            order=order,
            product=self.product,
            quantity=2,
            unit_price=100,
            total_price=200,
        )
        order.shipping_name = "Customer A"
        order.shipping_phone = "+1-555-0100"
        order.shipping_address = "123 Structure Street"
        order.shipping_city = "Bacolod"
        order.shipping_province = "Negros Occidental"
        order.shipping_zip_code = "6100"
        order.shipping_country = "Philippines"
        order.shipping_latitude = 10.32
        order.shipping_longitude = 123.88
        order.save(
            update_fields=[
                "shipping_name",
                "shipping_phone",
                "shipping_address",
                "shipping_city",
                "shipping_province",
                "shipping_zip_code",
                "shipping_country",
                "shipping_latitude",
                "shipping_longitude",
                "updated_at",
            ]
        )
        OrderTimeline.objects.create(order=order, delivery_date=delivery_date)
        trip = Trip.objects.create(
            trip_number="TRP-ROUTE-ASSIGNED-001",
            driver=self.driver,
            vehicle=self.vehicle,
            warehouse_id=self.warehouse.id,
            status=TripStatus.PLANNED,
            planned_start_at=delivery_date,
        )
        TripDropPoint.objects.create(
            trip=trip,
            order=order,
            sequence=1,
            status="PENDING",
            location_name="Customer A",
            address="123 Structure Street",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
        )

        assigned_response = self.client.get(
            "/api/trips/route-plan",
            data={"warehouseId": self.warehouse.id, "date": delivery_date.date().isoformat()},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(assigned_response.status_code, 200)
        assigned_order_ids = [row["id"] for row in assigned_response.json()["orders"]]
        self.assertNotIn(order.id, assigned_order_ids)

        delete_response = self.client.delete(
            f"/api/trips/{trip.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(delete_response.status_code, 200)

        released_response = self.client.get(
            "/api/trips/route-plan",
            data={"warehouseId": self.warehouse.id, "date": delivery_date.date().isoformat()},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(released_response.status_code, 200)
        released_order_ids = [row["id"] for row in released_response.json()["orders"]]
        self.assertIn(order.id, released_order_ids)

    def test_trip_delete_rejects_non_planned_trip(self) -> None:
        trip = Trip.objects.create(
            trip_number="TRP-DELETE-IN-PROGRESS-001",
            driver=self.driver,
            vehicle=self.vehicle,
            warehouse_id=self.warehouse.id,
            status=TripStatus.IN_PROGRESS,
            planned_start_at=timezone.now(),
            actual_start_at=timezone.now(),
        )

        response = self.client.delete(
            f"/api/trips/{trip.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "Only planned trips can be deleted")
        self.assertTrue(Trip.objects.filter(id=trip.id).exists())


class TripsPostCreationContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin_role = Role.objects.create(name="WAREHOUSE_STAFF", description="Warehouse Staff")
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.admin_user = User.objects.create(
            email="trips.post.admin@example.com",
            password="hashed",
            name="Trips Post Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.driver_user = User.objects.create(
            email="trips.post.driver@example.com",
            password="hashed",
            name="Trips Post Driver",
            phone="09123456789",
            role=self.driver_role,
            is_active=True,
        )
        self.driver = Driver.objects.create(
            user=self.driver_user,
            license_number="D09-22-000984",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )
        self.vehicle = Vehicle.objects.create(
            license_plate="TRIPS-POST-001",
            type=VehicleType.VAN,
            status="AVAILABLE",
            capacity=1000,
            driver=self.driver_user,
            is_active=True,
        )
        self.warehouse = Warehouse.objects.create(
            name="Trips Post Warehouse",
            code="WH-TRIPS-POST",
            city="Bacolod",
            province="Negros Occidental",
            manager_id=self.admin_user.id,
        )
        self.customer = Customer.objects.create(
            email="trips.post.customer@example.com",
            password="hashed",
            name="Trips Post Customer",
            latitude=10.40,
            longitude=123.80,
            is_active=True,
        )
        self.order_1 = Order.objects.create(
            order_number="ORD-TRIPS-POST-001",
            customer=self.customer,
            status=OrderStatus.OUT_FOR_DELIVERY,
            subtotal=120,
            total_amount=132,
            warehouse_id=self.warehouse.id,
        )
        self.order_2 = Order.objects.create(
            order_number="ORD-TRIPS-POST-002",
            customer=self.customer,
            status=OrderStatus.OUT_FOR_DELIVERY,
            subtotal=140,
            total_amount=154,
            warehouse_id=self.warehouse.id,
        )
        self.order_1.shipping_name = "Customer 1"
        self.order_1.shipping_phone = "+1-555-0001"
        self.order_1.shipping_address = "Address 1"
        self.order_1.shipping_city = "Bacolod"
        self.order_1.shipping_province = "Negros Occidental"
        self.order_1.shipping_zip_code = "6100"
        self.order_1.shipping_country = "Philippines"
        self.order_1.shipping_latitude = 10.41
        self.order_1.shipping_longitude = 123.81
        self.order_1.save(
            update_fields=[
                "shipping_name",
                "shipping_phone",
                "shipping_address",
                "shipping_city",
                "shipping_province",
                "shipping_zip_code",
                "shipping_country",
                "shipping_latitude",
                "shipping_longitude",
                "updated_at",
            ]
        )
        self.order_2.shipping_name = "Customer 2"
        self.order_2.shipping_phone = "+1-555-0002"
        self.order_2.shipping_address = "Address 2"
        self.order_2.shipping_city = "Bacolod"
        self.order_2.shipping_province = "Negros Occidental"
        self.order_2.shipping_zip_code = "6100"
        self.order_2.shipping_country = "Philippines"
        self.order_2.shipping_latitude = 10.42
        self.order_2.shipping_longitude = 123.82
        self.order_2.save(
            update_fields=[
                "shipping_name",
                "shipping_phone",
                "shipping_address",
                "shipping_city",
                "shipping_province",
                "shipping_zip_code",
                "shipping_country",
                "shipping_latitude",
                "shipping_longitude",
                "updated_at",
            ]
        )
        self.admin_token = create_token(
            {
                "userId": self.admin_user.id,
                "email": self.admin_user.email,
                "name": self.admin_user.name,
                "role": "WAREHOUSE_STAFF",
                "type": "staff",
            }
        )

    def test_trips_post_creates_trip_with_drop_points_and_total_count(self) -> None:
        response = self.client.post(
            "/api/trips",
            data={
                "driverId": self.driver.id,
                "vehicleId": self.vehicle.id,
                "warehouseId": self.warehouse.id,
                "orderIds": [self.order_1.id, self.order_2.id],
                "status": "PLANNED",
                "notes": "Test trip creation",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(response.status_code, 201, response.content.decode())
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertIn("trip", payload)
        trip = payload["trip"]
        self.assertEqual(trip["driver"]["id"], self.driver.id)
        self.assertEqual(trip["vehicle"]["id"], self.vehicle.id)
        self.assertEqual(trip["status"], TripStatus.PLANNED)
        self.assertEqual(len(trip["dropPoints"]), 2)
        self.assertEqual(trip["totalDropPoints"], 2)

        trip_db = Trip.objects.get(id=trip["id"])
        self.assertEqual(trip_db.total_drop_points, 2)
        self.assertEqual(trip_db.drop_points.count(), 2)
        self.assertTrue(
            Notification.objects.filter(
                user=self.driver_user,
                type="TRIP",
                reference_id=trip_db.id,
                title="New trip assigned",
            ).exists()
        )

    def test_trips_post_returns_404_when_driver_or_vehicle_missing(self) -> None:
        response = self.client.post(
            "/api/trips",
            data={
                "driverId": "missing-driver",
                "vehicleId": self.vehicle.id,
                "orderIds": [self.order_1.id],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 404)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Driver or vehicle not found")

    def test_trips_post_rejects_vehicle_overload_and_reports_excess_weight(self) -> None:
        product = Product.objects.create(sku="LOAD-TEST-001", name="Pepsi Load Test", weight=10, price=100)
        OrderItem.objects.create(
            order=self.order_1,
            product=product,
            quantity=6,
            unit_price=100,
            total_price=600,
        )
        self.vehicle.capacity = 50
        self.vehicle.save(update_fields=["capacity", "updated_at"])

        response = self.client.post(
            "/api/trips",
            data={
                "driverId": self.driver.id,
                "vehicleId": self.vehicle.id,
                "warehouseId": self.warehouse.id,
                "orderIds": [self.order_1.id],
                "status": "PLANNED",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("Vehicle overloaded by 10.00 kg", response.json()["error"])
        self.assertFalse(Trip.objects.filter(vehicle=self.vehicle).exists())

    def test_trips_post_allows_load_up_to_full_rated_capacity(self) -> None:
        product = Product.objects.create(sku="LOAD-TEST-002", name="Pepsi Capacity Test", weight=10, price=100)
        OrderItem.objects.create(
            order=self.order_1,
            product=product,
            quantity=5,
            unit_price=100,
            total_price=500,
        )
        self.vehicle.capacity = 50
        self.vehicle.save(update_fields=["capacity", "updated_at"])

        response = self.client.post(
            "/api/trips",
            data={
                "driverId": self.driver.id,
                "vehicleId": self.vehicle.id,
                "warehouseId": self.warehouse.id,
                "orderIds": [self.order_1.id],
                "status": "PLANNED",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(response.status_code, 201, response.content.decode())
        self.assertEqual(response.json()["trip"]["weightRemaining"], 0.0)


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
            data={"status": "COMPLETED"},
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

    def test_stock_batch_quantity_edit_syncs_or_deletes_linked_transaction(self) -> None:
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
        self.assertEqual(original_tx.quantity, 6)

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
        self.assertFalse(InventoryTransaction.objects.filter(id=original_tx.id).exists())

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


class PasswordPolicyContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.admin_user = User.objects.create(
            email="password.policy.admin@gmail.com",
            password="hashed",
            name="Password Policy Admin",
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
            email="password.policy.customer@gmail.com",
            password="hashed",
            name="Password Policy Customer",
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

    def test_auth_register_rejects_weak_password(self) -> None:
        response = self.client.post(
            "/api/auth/register",
            data={
                "name": "Weak Password Customer",
                "email": "weak.register@gmail.com",
                "password": "weakpass",
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertIn("Password must be at least 8 characters", payload["error"])

    def test_users_collection_rejects_weak_password(self) -> None:
        response = self.client.post(
            "/api/users",
            data={
                "name": "Weak Staff",
                "email": "weak.staff@gmail.com",
                "password": "weakpass",
                "roleId": self.driver_role.id,
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertIn("Password must be at least 8 characters", payload["error"])

    def test_customer_update_rejects_weak_password(self) -> None:
        response = self.client.put(
            f"/api/customers/{self.customer.id}",
            data={"password": "weakpass"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertIn("Password must be at least 8 characters", payload["error"])

    def test_password_reset_rejects_weak_password_before_otp_validation(self) -> None:
        response = self.client.post(
            "/api/auth/password-reset/reset",
            data={
                "email": "password.policy.admin@gmail.com",
                "accountType": "staff",
                "portal": "admin",
                "otp": "123456",
                "newPassword": "weakpass",
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertIn("Password must be at least 8 characters", payload["error"])


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
            price=10,
            quantity_per_unit=6,
            sizes=["500ml"],
        )
        self.product_b = Product.objects.create(
            sku="SKU-REPL-B",
            name="Return Product B",
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
        self.assertIn("Return Product A", str(serialized.get("originalProductName") or ""))
        self.assertIn("Return Product B", str(serialized.get("originalProductName") or ""))

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

    def test_mixed_case_and_bottle_replacement_returns_unused_bottles_to_loose_stock(self) -> None:
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
        self.assertTrue(
            InventoryTransaction.objects.filter(
                type="OUT",
                quantity_unit="BASE_UNIT",
                reference_type="order_item",
                reference_id=bottle_item.id,
                quantity=3,
            ).exists()
        )

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


class CustomerCreationPermissionContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.owner_user = User.objects.create(
            email="owner.customer.create@gmail.com",
            password="hashed",
            name="Owner User",
            role="SUPER_ADMIN",
            is_active=True,
        )
        self.owner_token = create_token(
            {
                "userId": self.owner_user.id,
                "email": self.owner_user.email,
                "name": self.owner_user.name,
                "role": self.owner_user.role,
                "type": "staff",
            }
        )

    def test_super_admin_cannot_create_customer_account(self) -> None:
        response = self.client.post(
            "/api/customers",
            data={
                "name": "Blocked Customer",
                "email": "blocked.customer.create@gmail.com",
                "password": "StrongPass1!",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.owner_token}",
        )
        self.assertEqual(response.status_code, 403)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Forbidden")

