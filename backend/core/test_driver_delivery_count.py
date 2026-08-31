"""The deliveries figure on a driver comes from their completed delivery drop points.

User.total_deliveries is never incremented anywhere in the codebase, so it reported 0
for every driver no matter how many orders they had delivered. The API now derives the
number from the trip records instead.
"""
import json
from unittest.mock import patch

from django.test import RequestFactory, TestCase

from .models import (
    DropPointStatus,
    DropPointType,
    RoleType,
    Trip,
    TripDropPoint,
    TripStatus,
    User,
    Vehicle,
    VehicleType,
)
from .views_api import _driver_delivery_count, drivers_collection


class DriverDeliveryCountTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.admin_auth = {"type": "staff", "role": "ADMIN", "userId": "admin-1", "name": "Admin"}
        self.driver = User.objects.create(
            email="counted.driver@gmail.com",
            password="x",
            name="Counted Driver",
            role=RoleType.DRIVER,
            phone="+639171234567",
            license_number="D09-22-000984",
            license_type="C",
            # The stale stored counter must not leak into the reported figure.
            total_deliveries=0,
        )
        self.other_driver = User.objects.create(
            email="other.driver@gmail.com",
            password="x",
            name="Other Driver",
            role=RoleType.DRIVER,
            phone="+639171234568",
            license_number="D09-22-000985",
            license_type="C",
        )
        self.vehicle = Vehicle.objects.create(
            license_plate="TRK-9001", type=VehicleType.TRUCK, classification="LIGHT_DUTY"
        )

    def _drop_point(self, trip, status, drop_point_type=DropPointType.DELIVERY, sequence=1):
        return TripDropPoint.objects.create(
            trip=trip,
            drop_point_type=drop_point_type,
            sequence=sequence,
            status=status,
            location_name="Stop",
            address="123 Street",
            city="Silay",
            province="Negros Occidental",
            zip_code="6116",
        )

    def _trip(self, driver, number):
        return Trip.objects.create(
            trip_number=number, driver=driver, vehicle=self.vehicle, status=TripStatus.COMPLETED
        )

    def _list_drivers(self):
        request = self.factory.get("/")
        with patch("core.views_api._require_staff", return_value=(self.admin_auth, None)):
            response = drivers_collection(request)
        self.assertEqual(response.status_code, 200)
        rows = json.loads(response.content)["drivers"]
        return {row["id"]: row for row in rows}

    def test_a_driver_with_no_trips_reports_zero(self):
        self.assertEqual(_driver_delivery_count(self.driver), 0)
        self.assertEqual(self._list_drivers()[self.driver.id]["totalDeliveries"], 0)

    def test_only_completed_delivery_drop_points_are_counted(self):
        trip = self._trip(self.driver, "TRIP-0001")
        self._drop_point(trip, DropPointStatus.COMPLETED, sequence=1)
        self._drop_point(trip, DropPointStatus.COMPLETED, sequence=2)
        self._drop_point(trip, DropPointStatus.PENDING, sequence=3)
        self._drop_point(trip, DropPointStatus.FAILED, sequence=4)
        self._drop_point(trip, DropPointStatus.SKIPPED, sequence=5)
        # A completed pickup is not a delivery.
        self._drop_point(trip, DropPointStatus.COMPLETED, DropPointType.PICKUP, sequence=6)

        self.assertEqual(_driver_delivery_count(self.driver), 2)
        self.assertEqual(self._list_drivers()[self.driver.id]["totalDeliveries"], 2)

    def test_deliveries_accumulate_across_trips(self):
        first = self._trip(self.driver, "TRIP-0002")
        second = self._trip(self.driver, "TRIP-0003")
        self._drop_point(first, DropPointStatus.COMPLETED, sequence=1)
        self._drop_point(second, DropPointStatus.COMPLETED, sequence=1)
        self._drop_point(second, DropPointStatus.COMPLETED, sequence=2)

        self.assertEqual(_driver_delivery_count(self.driver), 3)
        self.assertEqual(self._list_drivers()[self.driver.id]["totalDeliveries"], 3)

    def test_another_drivers_deliveries_are_not_counted(self):
        mine = self._trip(self.driver, "TRIP-0004")
        theirs = self._trip(self.other_driver, "TRIP-0005")
        self._drop_point(mine, DropPointStatus.COMPLETED, sequence=1)
        self._drop_point(theirs, DropPointStatus.COMPLETED, sequence=1)
        self._drop_point(theirs, DropPointStatus.COMPLETED, sequence=2)

        rows = self._list_drivers()
        self.assertEqual(rows[self.driver.id]["totalDeliveries"], 1)
        self.assertEqual(rows[self.other_driver.id]["totalDeliveries"], 2)

    def test_the_nested_user_payload_carries_the_same_figure(self):
        trip = self._trip(self.driver, "TRIP-0006")
        self._drop_point(trip, DropPointStatus.COMPLETED, sequence=1)
        row = self._list_drivers()[self.driver.id]
        self.assertEqual(row["user"]["totalDeliveries"], 1)

    def test_the_stale_stored_counter_does_not_override_the_derived_figure(self):
        self.driver.total_deliveries = 999
        self.driver.save(update_fields=["total_deliveries"])
        trip = self._trip(self.driver, "TRIP-0007")
        self._drop_point(trip, DropPointStatus.COMPLETED, sequence=1)
        self.assertEqual(self._list_drivers()[self.driver.id]["totalDeliveries"], 1)
