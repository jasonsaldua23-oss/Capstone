"""One driver, several trips: the order they run in on a day, as the trip dialogs show it."""

from datetime import datetime, time, timedelta

from django.test import Client, TestCase
from django.utils import timezone

from .auth import create_token
from .models import Order, OrderTimeline, Trip, TripDropPoint, User, Vehicle, Warehouse
from .views_trip_planning import driver_day_queue


def _user(email: str, name: str, role: str) -> User:
    return User.objects.create(email=email, password="hashed", name=name, role=role, is_active=True)


def _at(day, hour: int = 9):
    return timezone.make_aware(datetime.combine(day, time(hour)), timezone.get_current_timezone())


class DriverDayQueueTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.today = timezone.localdate()
        self.staff = _user("day.staff@example.com", "Wally Warehouse", "WAREHOUSE_STAFF")
        self.admin = _user("day.admin@example.com", "Ana Admin", "ADMIN")
        self.driver = _user("day.driver@example.com", "Juan Driver", "DRIVER")
        self.warehouse = Warehouse.objects.create(
            name="Silay Warehouse", code="WH-DAY-1", address="Rizal St", city="Silay",
            province="Negros Occidental", zip_code="6116", manager_id=self.staff.id,
        )
        self.other_warehouse = Warehouse.objects.create(
            name="Talisay Warehouse", code="WH-DAY-2", address="Mabini St", city="Talisay",
            province="Negros Occidental", zip_code="6115",
        )
        self.vehicle = Vehicle.objects.create(license_plate="NBC-1231", type="VAN", status="AVAILABLE", driver=self.driver, capacity=1500)
        self._orders = 0

    def trip(self, number: str, day, *, status: str = "PLANNED", stops: int = 1, done: int = 0, planned_hour: int | None = None,
             warehouse: Warehouse | None = None) -> Trip:
        trip = Trip.objects.create(
            trip_number=number, driver=self.driver, vehicle=self.vehicle, warehouse_id=(warehouse or self.warehouse).id,
            status=status, planned_start_at=_at(day, planned_hour) if planned_hour is not None else None,
            total_drop_points=stops,
        )
        for sequence in range(1, stops + 1):
            self._orders += 1
            order = Order.objects.create(
                order_number=f"ORD-DAY-{self._orders}", status="OUT_FOR_DELIVERY", subtotal=0, total_amount=0,
                warehouse_id=trip.warehouse_id,
            )
            OrderTimeline.objects.create(order=order, delivery_date=_at(day))
            TripDropPoint.objects.create(
                trip=trip, order=order, sequence=sequence, location_name=f"Stop {sequence}", address="Purok 1",
                city="Silay", province="Negros Occidental", zip_code="6116",
                status="COMPLETED" if sequence <= done else "PENDING",
            )
        return trip

    def get(self, user: User | None, query: str):
        headers = {}
        if user is not None:
            token = create_token({"userId": user.id, "email": user.email, "name": user.name, "role": user.role, "type": "staff"})
            headers["HTTP_AUTHORIZATION"] = f"Bearer {token}"
        return self.client.get(f"/api/trips/driver-day{query}", **headers)

    def numbers(self, day) -> list[str]:
        return [trip.trip_number for trip in driver_day_queue(self.driver.id, day)]

    def test_the_running_trip_leads_then_the_day_runs_in_planned_order(self) -> None:
        self.trip("TRP-3", self.today, planned_hour=8)
        self.trip("TRP-2", self.today, planned_hour=13)
        self.trip("TRP-1", self.today, status="IN_PROGRESS", planned_hour=15)
        self.trip("TRP-4", self.today)  # no planned start: after the timed ones
        self.trip("TRP-TOMORROW", self.today + timedelta(days=1))
        self.trip("TRP-DONE", self.today, status="COMPLETED")

        self.assertEqual(self.numbers(self.today), ["TRP-1", "TRP-3", "TRP-2", "TRP-4"])
        self.assertEqual(self.numbers(self.today + timedelta(days=1)), ["TRP-TOMORROW"])

    def test_trips_planned_for_the_same_time_run_in_the_order_they_were_created(self) -> None:
        self.trip("TRP-2026-0012", self.today, planned_hour=0)
        self.trip("TRP-2026-0011", self.today, planned_hour=0)

        self.assertEqual(self.numbers(self.today), ["TRP-2026-0011", "TRP-2026-0012"])

    def test_a_trip_still_running_from_yesterday_blocks_today(self) -> None:
        self.trip("TRP-YESTERDAY", self.today - timedelta(days=1), status="IN_PROGRESS")
        self.trip("TRP-TODAY", self.today)

        self.assertEqual(self.numbers(self.today), ["TRP-YESTERDAY", "TRP-TODAY"])

    def test_a_load_transfer_runs_before_the_days_other_planned_trips(self) -> None:
        broken = self.trip("TRP-BROKEN", self.today - timedelta(days=1), status="COMPLETED")
        self.trip("TRP-MORNING", self.today, planned_hour=8)
        rescue = self.trip("TRP-RESCUE", self.today - timedelta(days=1), planned_hour=15)
        Trip.objects.filter(id=rescue.id).update(transferred_from=broken)

        self.assertEqual(self.numbers(self.today), ["TRP-RESCUE", "TRP-MORNING"])

    def test_the_dialog_lists_every_warehouse_trip_with_its_stops(self) -> None:
        self.trip("TRP-1", self.today, status="IN_PROGRESS", stops=3, done=2)
        self.trip("TRP-2", self.today, stops=2, warehouse=self.other_warehouse)

        response = self.get(self.staff, f"?driverId={self.driver.id}&date={self.today.isoformat()}")

        self.assertEqual(response.status_code, 200)
        rows = response.json()["trips"]
        self.assertEqual(
            [(row["tripNumber"], row["status"], row["position"], row["stops"], row["openStops"], row["warehouseName"]) for row in rows],
            [("TRP-1", "IN_PROGRESS", 1, 3, 1, "Silay Warehouse"), ("TRP-2", "PLANNED", 2, 2, 2, "Talisay Warehouse")],
        )
        self.assertNotIn("dropPoints", rows[0])

    def test_editing_a_trip_leaves_it_out_of_its_own_day(self) -> None:
        editing = self.trip("TRP-1", self.today)
        self.trip("TRP-2", self.today)

        rows = self.get(self.admin, f"?driverId={self.driver.id}&date={self.today.isoformat()}&excludeTripId={editing.id}").json()["trips"]

        self.assertEqual([(row["tripNumber"], row["position"]) for row in rows], [("TRP-2", 1)])

    def test_only_staff_may_read_a_drivers_day(self) -> None:
        query = f"?driverId={self.driver.id}&date={self.today.isoformat()}"
        self.assertEqual(self.get(self.driver, query).status_code, 403)
        self.assertEqual(self.get(None, query).status_code, 401)
        self.assertEqual(self.get(self.staff, f"?driverId={self.driver.id}").status_code, 400)
        self.assertEqual(self.get(self.staff, f"?driverId={self.staff.id}&date={self.today.isoformat()}").status_code, 404)
