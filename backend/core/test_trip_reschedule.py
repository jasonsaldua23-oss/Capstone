"""Rescheduling a planned trip, the warehouse's way back from an overdue one."""

from datetime import datetime, time, timedelta

from django.test import Client, TestCase
from django.utils import timezone

from .auth import create_token
from .fleet_sync import trip_is_overdue, trip_scheduled_date
from .models import (
    Customer,
    DropPointType,
    Notification,
    Order,
    OrderStatus,
    OrderTimeline,
    Replacement,
    Trip,
    TripDropPoint,
    TripStatus,
    User,
    Vehicle,
    VehicleType,
    Warehouse,
)
from .replacement_services import _extract_replacement_meta, _upsert_replacement_meta
from .test_support import Driver, Role


def _local(day, hour: int) -> datetime:
    return timezone.make_aware(datetime.combine(day, time(hour=hour)))


class TripRescheduleContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        warehouse_role = Role.objects.create(name="WAREHOUSE_STAFF", description="Warehouse Staff")
        driver_role = Role.objects.create(name="DRIVER", description="Driver")
        admin_role = Role.objects.create(name="ADMIN", description="Admin")
        self.staff_user = User.objects.create(
            email="reschedule.staff@example.com", password="hashed", name="Reschedule Staff",
            role=warehouse_role, is_active=True,
        )
        self.other_staff_user = User.objects.create(
            email="reschedule.other.staff@example.com", password="hashed", name="Other Staff",
            role=warehouse_role, is_active=True,
        )
        self.admin_user = User.objects.create(
            email="reschedule.admin@example.com", password="hashed", name="Reschedule Admin",
            role=admin_role, is_active=True,
        )
        driver_user = User.objects.create(
            email="reschedule.driver@example.com", password="hashed", name="Reschedule Driver",
            role=driver_role, is_active=True,
        )
        self.driver = Driver.objects.create(
            user=driver_user,
            license_number="LIC-RESCHED-001",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )
        self.vehicle = Vehicle.objects.create(
            license_plate="RESCHED-001", type=VehicleType.VAN, status="AVAILABLE", is_active=True,
        )
        self.warehouse = Warehouse.objects.create(
            name="Reschedule Warehouse", code="WH-RESCHED", city="Talisay",
            province="Negros Occidental", manager_id=self.staff_user.id,
        )
        Warehouse.objects.create(
            name="Other Warehouse", code="WH-RESCHED-OTHER", city="Silay",
            province="Negros Occidental", manager_id=self.other_staff_user.id,
        )
        self.customer = Customer.objects.create(
            email="reschedule.customer@example.com", password="hashed", name="Reschedule Customer", is_active=True,
        )

        self.missed_day = timezone.localdate() - timedelta(days=3)
        self.trip = Trip.objects.create(
            trip_number="TRP-RESCHED-001",
            driver=self.driver,
            vehicle=self.vehicle,
            warehouse_id=self.warehouse.id,
            status=TripStatus.PLANNED,
            planned_start_at=_local(self.missed_day, 8),
            total_drop_points=2,
        )
        self.order_a = self._order_on_trip("ORD-RESCHED-A", sequence=1, delivery_at=_local(self.missed_day, 10))
        self.order_b = self._order_on_trip("ORD-RESCHED-B", sequence=2, delivery_at=_local(self.missed_day, 14))

    def _order_on_trip(self, number: str, *, sequence: int, delivery_at, status=OrderStatus.PREPARING) -> Order:
        order = Order.objects.create(
            order_number=number,
            customer=self.customer,
            status=status,
            subtotal=100,
            total_amount=100,
            warehouse_id=self.warehouse.id,
        )
        OrderTimeline.objects.create(order=order, delivery_date=delivery_at)
        TripDropPoint.objects.create(
            trip=self.trip,
            order=order,
            sequence=sequence,
            location_name=f"Stop {sequence}",
            address=f"Address {sequence}",
            city="Talisay",
            province="Negros Occidental",
            zip_code="6115",
            drop_point_type=DropPointType.DELIVERY,
        )
        return order

    def _token(self, user: User, role: str) -> str:
        return create_token({"userId": user.id, "email": user.email, "name": user.name, "role": role, "type": "staff"})

    def _reschedule(self, scheduled_date, *, token: str | None = None):
        return self.client.post(
            f"/api/trips/{self.trip.id}/reschedule",
            data={"scheduledDate": scheduled_date},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token or self._token(self.staff_user, 'WAREHOUSE_STAFF')}",
        )

    def _delivery_at(self, order: Order) -> datetime:
        return timezone.localtime(OrderTimeline.objects.get(order=order).delivery_date)

    def test_overdue_trip_and_its_orders_move_to_the_new_day(self) -> None:
        self.assertTrue(trip_is_overdue(self.trip.status, trip_scheduled_date(self.trip)))
        new_day = timezone.localdate() + timedelta(days=1)

        response = self._reschedule(new_day.isoformat())

        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()["trip"]
        self.assertEqual(payload["scheduledDate"], new_day.isoformat())
        self.assertFalse(payload["isOverdue"])
        self.trip.refresh_from_db()
        self.assertEqual(self.trip.status, TripStatus.PLANNED)
        # Only the day moves; each delivery keeps its time.
        self.assertEqual(self._delivery_at(self.order_a), _local(new_day, 10))
        self.assertEqual(self._delivery_at(self.order_b), _local(new_day, 14))
        self.assertEqual(timezone.localtime(self.trip.planned_start_at), _local(new_day, 8))
        self.order_a.refresh_from_db()
        self.assertEqual(self.order_a.status, OrderStatus.PREPARING)

        customer_messages = sorted(
            Notification.objects.filter(customer=self.customer, title="Order rescheduled").values_list("message", flat=True)
        )
        self.assertEqual(customer_messages, [
            f"Your order ORD-RESCHED-A was rescheduled to {new_day.isoformat()}.",
            f"Your order ORD-RESCHED-B was rescheduled to {new_day.isoformat()}.",
        ])
        self.assertTrue(
            Notification.objects.filter(
                user_id=self.driver.id,
                title="Trip rescheduled",
                message=f"Trip TRP-RESCHED-001 was moved to {new_day.isoformat()}.",
            ).exists()
        )

    def test_rescheduled_trip_can_be_started_on_its_new_day(self) -> None:
        self.assertEqual(self._reschedule(timezone.localdate().isoformat()).status_code, 200)

        response = self.client.post(
            f"/api/trips/{self.trip.id}/start",
            data={"confirmLoad": True},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self._token(self.driver, 'DRIVER')}",
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.trip.refresh_from_db()
        self.assertEqual(self.trip.status, TripStatus.IN_PROGRESS)

    def test_replacement_delivery_on_the_trip_keeps_its_date_in_step(self) -> None:
        source_order = Order.objects.create(
            order_number="ORD-RESCHED-SOURCE", customer=self.customer, status=OrderStatus.DELIVERED,
            subtotal=100, total_amount=100,
        )
        replacement = Replacement.objects.create(
            replacement_number="RPL-RESCHED-001",
            order=source_order,
            customer_id=self.customer.id,
            reason="Damaged",
            pickup_address="Address",
            pickup_city="Talisay",
            pickup_province="Negros Occidental",
            pickup_zip_code="6115",
            delivery_transaction=self.order_b,
            notes=_upsert_replacement_meta("", {"scheduledDeliveryDate": self.missed_day.isoformat()}),
        )
        new_day = timezone.localdate() + timedelta(days=2)

        self.assertEqual(self._reschedule(new_day.isoformat()).status_code, 200)

        replacement.refresh_from_db()
        self.assertEqual(_extract_replacement_meta(replacement.notes)["scheduledDeliveryDate"], new_day.isoformat())

    def test_closed_order_that_would_keep_the_trip_overdue_is_named_and_nothing_moves(self) -> None:
        self._order_on_trip(
            "ORD-RESCHED-CANCELLED", sequence=3, delivery_at=_local(self.missed_day, 9), status=OrderStatus.CANCELLED,
        )

        response = self._reschedule((timezone.localdate() + timedelta(days=1)).isoformat())

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            response.json()["error"],
            "Remove cancelled, rejected or delivered orders from this trip before rescheduling it: ORD-RESCHED-CANCELLED",
        )
        self.assertEqual(self._delivery_at(self.order_a), _local(self.missed_day, 10))
        self.assertFalse(Notification.objects.filter(title="Order rescheduled").exists())

    def test_past_or_missing_dates_are_rejected(self) -> None:
        yesterday = (timezone.localdate() - timedelta(days=1)).isoformat()
        past = self._reschedule(yesterday)
        self.assertEqual(past.status_code, 400)
        self.assertEqual(past.json()["error"], "Delivery date cannot be in the past. Choose today or a future date.")

        missing = self._reschedule("")
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(missing.json()["error"], "A valid scheduledDate is required")
        self.assertEqual(self._delivery_at(self.order_a), _local(self.missed_day, 10))

    def test_same_day_is_rejected_instead_of_notifying_everyone_again(self) -> None:
        new_day = (timezone.localdate() + timedelta(days=1)).isoformat()
        self.assertEqual(self._reschedule(new_day).status_code, 200)

        response = self._reschedule(new_day)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], f"This trip is already scheduled for {new_day}")

    def test_only_planned_trips_can_be_rescheduled(self) -> None:
        self.trip.status = TripStatus.IN_PROGRESS
        self.trip.save(update_fields=["status", "updated_at"])

        response = self._reschedule((timezone.localdate() + timedelta(days=1)).isoformat())

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "Only planned trips can be rescheduled")

    def test_only_staff_of_the_trip_warehouse_can_reschedule(self) -> None:
        new_day = (timezone.localdate() + timedelta(days=1)).isoformat()
        for token in (
            self._token(self.admin_user, "ADMIN"),
            self._token(self.driver, "DRIVER"),
            self._token(self.other_staff_user, "WAREHOUSE_STAFF"),
        ):
            self.assertEqual(self._reschedule(new_day, token=token).status_code, 403)
        self.assertEqual(self._delivery_at(self.order_a), _local(self.missed_day, 10))
