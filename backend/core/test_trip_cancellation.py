"""Warehouse staff cancel a trip: it stays on record, and its undelivered orders come back."""

import json
from datetime import datetime, time

from django.test import Client, TestCase
from django.utils import timezone

from .api_serializers import _build_assigned_trip_map
from .auth import create_token
from .models import (
    Customer,
    Notification,
    Order,
    OrderStatus,
    OrderTimeline,
    Trip,
    TripDropPoint,
    TripStatus,
    User,
    Vehicle,
    Warehouse,
)


def _user(email: str, name: str, role: str) -> User:
    return User.objects.create(email=email, password="hashed", name=name, role=role, is_active=True)


class TripCancellationTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.staff = _user("cancel.staff@example.com", "Wally Warehouse", "WAREHOUSE_STAFF")
        self.other_staff = _user("cancel.other@example.com", "Olga Other", "WAREHOUSE_STAFF")
        self.admin = _user("cancel.admin@example.com", "Ana Admin", "ADMIN")
        self.driver = _user("cancel.driver@example.com", "Juan Driver", "DRIVER")
        self.warehouse = Warehouse.objects.create(
            name="Silay Warehouse", code="WH-CANCEL-1", address="Rizal St", city="Silay",
            province="Negros Occidental", zip_code="6116", manager_id=self.staff.id,
        )
        Warehouse.objects.create(
            name="Talisay Warehouse", code="WH-CANCEL-2", address="Mabini St", city="Talisay",
            province="Negros Occidental", zip_code="6115", manager_id=self.other_staff.id,
        )
        self.customer = Customer.objects.create(email="store@example.com", password="hashed", name="Lopez Store")
        self.vehicle = Vehicle.objects.create(license_plate="NBC-1231", type="VAN", status="AVAILABLE", driver=self.driver, capacity=1500)
        self._orders = 0

    def trip(self, status: str, stops: list[tuple[str, str]]) -> Trip:
        """A trip whose stops are (drop point status, order status) pairs."""
        running = status == TripStatus.IN_PROGRESS
        trip = Trip.objects.create(
            trip_number=f"TRP-CANCEL-{status}", driver=self.driver, vehicle=self.vehicle, warehouse_id=self.warehouse.id,
            status=status, actual_start_at=timezone.now() if running else None, total_drop_points=len(stops),
        )
        if running:
            Vehicle.objects.filter(id=self.vehicle.id).update(status="IN_USE")
        day = timezone.make_aware(datetime.combine(timezone.localdate(), time(9)))
        for sequence, (point_status, order_status) in enumerate(stops, start=1):
            self._orders += 1
            order = Order.objects.create(
                order_number=f"ORD-CANCEL-{self._orders}", customer=self.customer, status=order_status,
                subtotal=0, total_amount=0, warehouse_id=self.warehouse.id,
                warehouse_dispatched_at=timezone.now() if running else None,
            )
            OrderTimeline.objects.create(order=order, delivery_date=day)
            TripDropPoint.objects.create(
                trip=trip, order=order, sequence=sequence, location_name=f"Stop {sequence}", address="Purok 1",
                city="Silay", province="Negros Occidental", zip_code="6116", status=point_status,
            )
        return trip

    def auth(self, user: User) -> dict[str, str]:
        token = create_token({"userId": user.id, "email": user.email, "name": user.name, "role": user.role, "type": "staff"})
        return {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    def cancel(self, trip: Trip, user: User | None = None, reason: str = "Truck needs brake repair before it can go out."):
        return self.client.post(
            f"/api/trips/{trip.id}/cancel", data=json.dumps({"reason": reason}),
            content_type="application/json", **self.auth(user or self.staff),
        )

    def points(self, trip: Trip) -> list[tuple[str, str, str]]:
        return [
            (point.status, point.order.status, point.order.order_number)
            for point in TripDropPoint.objects.select_related("order").filter(trip=trip).order_by("sequence")
        ]

    def test_cancelling_a_planned_trip_keeps_it_on_record_and_frees_its_orders(self) -> None:
        trip = self.trip(TripStatus.PLANNED, [("PENDING", "PREPARING"), ("PENDING", "PREPARING")])

        response = self.cancel(trip)

        self.assertEqual(response.status_code, 200, response.content)
        trip.refresh_from_db()
        self.assertEqual(trip.status, TripStatus.CANCELLED)
        self.assertEqual((trip.cancelled_by_name, trip.cancellation_reason), ("Wally Warehouse", "Truck needs brake repair before it can go out."))
        self.assertIsNotNone(trip.cancelled_at)
        self.assertIsNone(trip.actual_end_at)
        # The orders stay in Processing with their date, free for another trip.
        self.assertEqual([(point, order) for point, order, _ in self.points(trip)], [("CANCELLED", "PREPARING")] * 2)
        self.assertEqual(_build_assigned_trip_map([point.order_id for point in trip.drop_points.all()]), {})
        self.assertEqual(response.json()["returnedOrders"], [])
        self.assertTrue(Notification.objects.filter(user=self.driver, title="Trip cancelled").exists())
        self.assertFalse(Notification.objects.filter(customer=self.customer).exists())

    def test_cancelling_a_running_trip_brings_undelivered_orders_back(self) -> None:
        trip = self.trip(TripStatus.IN_PROGRESS, [("COMPLETED", "DELIVERED"), ("ARRIVED", "OUT_FOR_DELIVERY"), ("PENDING", "OUT_FOR_DELIVERY")])

        response = self.cancel(trip)

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(
            self.points(trip),
            [("COMPLETED", "DELIVERED", "ORD-CANCEL-1"), ("CANCELLED", "RESCHEDULED", "ORD-CANCEL-2"), ("CANCELLED", "RESCHEDULED", "ORD-CANCEL-3")],
        )
        self.assertEqual(response.json()["returnedOrders"], ["ORD-CANCEL-2", "ORD-CANCEL-3"])
        returned = Order.objects.get(order_number="ORD-CANCEL-2")
        self.assertIsNone(returned.warehouse_dispatched_at)
        self.assertIsNotNone(returned.ready_to_load_at)
        trip.refresh_from_db()
        self.assertEqual((trip.status, trip.completed_drop_points), (TripStatus.CANCELLED, 1))
        self.assertIsNotNone(trip.actual_end_at)
        # The truck is free again, and each returned order's customer is told.
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.status, "AVAILABLE")
        self.assertEqual(Notification.objects.filter(customer=self.customer, title="Delivery rescheduled").count(), 2)
        self.assertIn("Bring the undelivered orders back", Notification.objects.get(user=self.driver, title="Trip cancelled").message)

    def test_a_truck_in_the_shop_stays_in_the_shop(self) -> None:
        trip = self.trip(TripStatus.IN_PROGRESS, [("PENDING", "OUT_FOR_DELIVERY")])
        Vehicle.objects.filter(id=self.vehicle.id).update(status="MAINTENANCE")

        self.assertEqual(self.cancel(trip).status_code, 200)

        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.status, "MAINTENANCE")

    def test_a_stop_confirmed_after_the_cancellation_is_refused(self) -> None:
        trip = self.trip(TripStatus.IN_PROGRESS, [("PENDING", "OUT_FOR_DELIVERY")])
        self.cancel(trip)
        point = trip.drop_points.get()

        response = self.client.patch(
            f"/api/trips/{trip.id}/drop-points/{point.id}", data=json.dumps({"status": "ARRIVED"}),
            content_type="application/json", **self.auth(self.driver),
        )

        self.assertEqual(response.status_code, 409)
        self.assertIn("cancelled by the warehouse", response.json()["error"])
        trip.refresh_from_db()
        point.refresh_from_db()
        self.assertEqual((trip.status, point.status), (TripStatus.CANCELLED, "CANCELLED"))

    def test_a_retried_cancellation_reports_the_first(self) -> None:
        trip = self.trip(TripStatus.PLANNED, [("PENDING", "PREPARING")])
        self.cancel(trip)

        retry = self.cancel(trip, reason="Another reason")

        self.assertEqual(retry.status_code, 200)
        self.assertTrue(retry.json()["alreadyCancelled"])
        trip.refresh_from_db()
        self.assertEqual(trip.cancellation_reason, "Truck needs brake repair before it can go out.")
        self.assertEqual(Notification.objects.filter(user=self.driver, title="Trip cancelled").count(), 1)

    def test_a_reason_is_required_and_finished_trips_stay_finished(self) -> None:
        planned = self.trip(TripStatus.PLANNED, [("PENDING", "PREPARING")])
        self.assertEqual(self.cancel(planned, reason="   ").status_code, 400)
        Trip.objects.filter(id=planned.id).update(status=TripStatus.COMPLETED)
        self.assertEqual(self.cancel(planned).status_code, 409)

    def test_only_the_trips_own_warehouse_staff_can_cancel_it(self) -> None:
        trip = self.trip(TripStatus.PLANNED, [("PENDING", "PREPARING")])

        self.assertEqual(self.cancel(trip, self.other_staff).status_code, 403)
        self.assertEqual(self.cancel(trip, self.admin).status_code, 403)
        self.assertEqual(self.cancel(trip, self.driver).status_code, 403)
        trip.refresh_from_db()
        self.assertEqual(trip.status, TripStatus.PLANNED)
