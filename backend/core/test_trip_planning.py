"""Trip creation, route planning, and tracking collection API contracts."""

import json
from datetime import datetime, time, timedelta

from django.test import (
    Client,
    TestCase,
)
from django.utils import timezone

from .auth import create_token
from .models import (
    Customer,
    LocationLog,
    Notification,
    Order,
    OrderItem,
    OrderTimeline,
    OrderStatus,
    Product,
    Trip,
    TripDropPoint,
    TripStatus,
    User,
    Vehicle,
    VehicleType,
    Warehouse,
)
from .test_support import Role, Driver


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
            speed=0.0,
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
        # The tracking maps read the GPS speed to tell a parked vehicle from the
        # wander of its fixes, so a standstill has to survive the payload as 0.0
        # rather than being dropped for being falsy.
        self.assertEqual(location["speed"], 0.0)

    def _make_trip(self, trip_number: str, *, status: str, created_days_ago: int, ended_days_ago: int | None = None) -> Trip:
        now = timezone.now()
        trip = Trip.objects.create(
            trip_number=trip_number,
            driver=self.driver,
            vehicle=self.vehicle,
            status=status,
            created_at=now - timedelta(days=created_days_ago),
            actual_end_at=None if ended_days_ago is None else now - timedelta(days=ended_days_ago),
        )
        return trip

    def _trip_numbers(self, **params) -> list[str]:
        response = self.client.get(
            "/api/trips",
            data=params,
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        self.assertTrue(payload["success"])
        return [row["tripNumber"] for row in payload["trips"]]

    def test_trips_collection_status_filter_is_case_insensitive_and_validated(self) -> None:
        self._make_trip("TRP-2026-0001", status=TripStatus.PLANNED, created_days_ago=2)
        self._make_trip("TRP-2026-0002", status=TripStatus.COMPLETED, created_days_ago=1, ended_days_ago=0)

        self.assertEqual(self._trip_numbers(status="completed"), ["TRP-2026-0002"])
        self.assertEqual(self._trip_numbers(status="COMPLETED"), ["TRP-2026-0002"])
        self.assertEqual(self._trip_numbers(status="Planned"), ["TRP-2026-0001"])
        self.assertEqual(self._trip_numbers(), ["TRP-2026-0002", "TRP-2026-0001"])

        response = self.client.get(
            "/api/trips",
            data={"status": "DONE"},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.json()["success"])

    def test_trips_collection_sort_completed_uses_actual_end_not_creation_or_trip_number(self) -> None:
        # Created a month ago but finished today: must be first under sort=completed
        # even though both its creation date and its trip number are the oldest.
        self._make_trip("TRP-2026-0001", status=TripStatus.COMPLETED, created_days_ago=30, ended_days_ago=0)
        self._make_trip("TRP-2026-0002", status=TripStatus.COMPLETED, created_days_ago=5, ended_days_ago=3)
        # Completed rows missing an end timestamp sort after every dated one.
        self._make_trip("TRP-2026-0003", status=TripStatus.COMPLETED, created_days_ago=1, ended_days_ago=None)
        self._make_trip("TRP-2026-0004", status=TripStatus.PLANNED, created_days_ago=0)

        # Default ordering is unchanged: newest created first.
        self.assertEqual(
            self._trip_numbers(),
            ["TRP-2026-0004", "TRP-2026-0003", "TRP-2026-0002", "TRP-2026-0001"],
        )
        self.assertEqual(
            self._trip_numbers(status="COMPLETED", sort="completed"),
            ["TRP-2026-0001", "TRP-2026-0002", "TRP-2026-0003"],
        )
        # Pagination still applies on top of the sort.
        self.assertEqual(
            self._trip_numbers(status="COMPLETED", sort="completed", page="1", pageSize="1"),
            ["TRP-2026-0001"],
        )
        self.assertEqual(
            self._trip_numbers(status="COMPLETED", sort="completed", page="2", pageSize="1"),
            ["TRP-2026-0002"],
        )

    def test_trips_collection_sort_trip_number_desc_and_rejects_unknown_sort(self) -> None:
        self._make_trip("TRP-2026-0002", status=TripStatus.PLANNED, created_days_ago=0)
        self._make_trip("TRP-2026-0010", status=TripStatus.PLANNED, created_days_ago=3)
        self._make_trip("TRP-2026-0001", status=TripStatus.PLANNED, created_days_ago=1)

        self.assertEqual(
            self._trip_numbers(sort="trip_number"),
            ["TRP-2026-0010", "TRP-2026-0002", "TRP-2026-0001"],
        )
        self.assertEqual(
            self._trip_numbers(sort="created"),
            ["TRP-2026-0002", "TRP-2026-0001", "TRP-2026-0010"],
        )

        response = self.client.get(
            "/api/trips",
            data={"sort": "random"},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.json()["success"])

    def test_trips_collection_sort_scheduled_uses_order_delivery_date(self) -> None:
        now = timezone.now()
        early_trip = self._make_trip("TRP-2026-0001", status=TripStatus.PLANNED, created_days_ago=0)
        late_trip = self._make_trip("TRP-2026-0002", status=TripStatus.PLANNED, created_days_ago=10)
        undated_trip = self._make_trip("TRP-2026-0003", status=TripStatus.PLANNED, created_days_ago=1)
        newer_late_trip = self._make_trip("TRP-2026-0004", status=TripStatus.PLANNED, created_days_ago=2)
        customer = Customer.objects.create(
            email="trip-sort-customer@example.com", password="hashed", name="Trip Sort Customer"
        )
        for trip, suffix, delivery_at in (
            (early_trip, "EARLY", now + timedelta(days=1)),
            (late_trip, "LATE", now + timedelta(days=5)),
            (newer_late_trip, "NEWER-LATE", now + timedelta(days=5)),
        ):
            order = Order.objects.create(
                order_number=f"ORD-SORT-{suffix}", customer=customer,
                status=OrderStatus.PREPARING, subtotal=100, total_amount=100,
            )
            OrderTimeline.objects.create(order=order, delivery_date=delivery_at)
            TripDropPoint.objects.create(
                trip=trip, order=order, sequence=1, location_name="Customer",
                address="Address", city="Talisay", province="Negros Occidental", zip_code="6115",
            )

        # Latest delivery dates come first; equal dates use newest creation time,
        # and the trip without a valid schedule remains last.
        self.assertEqual(
            self._trip_numbers(sort="scheduled"),
            [newer_late_trip.trip_number, late_trip.trip_number, early_trip.trip_number, undated_trip.trip_number],
        )

    def test_trips_collection_sort_keeps_tracking_date_filter(self) -> None:
        target_date = timezone.now().date()
        trip = self._make_trip("TRP-2026-0001", status=TripStatus.COMPLETED, created_days_ago=10, ended_days_ago=0)
        trip.planned_start_at = timezone.make_aware(
            timezone.datetime(target_date.year, target_date.month, target_date.day, 9, 0, 0)
        )
        trip.save(update_fields=["planned_start_at"])
        self._make_trip("TRP-2026-0002", status=TripStatus.COMPLETED, created_days_ago=10, ended_days_ago=5)

        self.assertEqual(
            self._trip_numbers(sort="completed", trackingDate=target_date.isoformat()),
            ["TRP-2026-0001"],
        )


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
        self.warehouse_role = Role.objects.create(name="WAREHOUSE_STAFF", description="Warehouse Staff")
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.admin_user = User.objects.create(
            email="route.plan.structure.admin@route.local",
            password="hashed",
            name="Route Plan Structure Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.warehouse_user = User.objects.create(
            email="route.plan.structure.warehouse@route.local",
            password="hashed",
            name="Route Plan Structure Warehouse Staff",
            role=self.warehouse_role,
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
            manager_id=self.warehouse_user.id,
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
        self.warehouse_token = create_token(
            {
                "userId": self.warehouse_user.id,
                "email": self.warehouse_user.email,
                "name": self.warehouse_user.name,
                "role": "WAREHOUSE_STAFF",
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
        route_order = next(row for row in payload["orders"] if row["id"] == order.id)
        # A direct warehouse order has no reservation rows, but must still pass the
        # selected-warehouse quantity filter used by the Create Trip screen.
        self.assertEqual(route_order["allocatedQtyForSelectedWarehouse"], 2)

        plan = payload["routePlans"][0]
        self.assertIn("city", plan)
        self.assertIn("orderCount", plan)
        self.assertIn("totalDistanceKm", plan)
        self.assertIn("orders", plan)

    def test_route_plan_uses_rescheduled_delivery_date_not_created_date(self) -> None:
        future_delivery_date = timezone.localdate() + timedelta(days=2)
        # Midnight local time crosses into the previous UTC date in Manila and
        # must still match the calendar date selected in Create Trip.
        future_delivery = timezone.make_aware(
            datetime.combine(future_delivery_date, time.min),
            timezone.get_current_timezone(),
        )
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
            data={"warehouseId": self.warehouse.id, "date": future_delivery_date.isoformat()},
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
            # Route plan windows the requested day in the server's timezone, so ask
            # for the local date. Using the UTC date silently misses the order for
            # the hours where the two calendars disagree (16:00 UTC onward here).
            data={"warehouseId": self.warehouse.id, "date": timezone.localtime(delivery_date).date().isoformat()},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(assigned_response.status_code, 200)
        assigned_order_ids = [row["id"] for row in assigned_response.json()["orders"]]
        self.assertNotIn(order.id, assigned_order_ids)

        delete_response = self.client.delete(
            f"/api/trips/{trip.id}",
            # Trip changes require a warehouse operator assigned to this warehouse.
            HTTP_AUTHORIZATION=f"Bearer {self.warehouse_token}",
        )
        self.assertEqual(delete_response.status_code, 200)

        released_response = self.client.get(
            "/api/trips/route-plan",
            # Route plan windows the requested day in the server's timezone, so ask
            # for the local date. Using the UTC date silently misses the order for
            # the hours where the two calendars disagree (16:00 UTC onward here).
            data={"warehouseId": self.warehouse.id, "date": timezone.localtime(delivery_date).date().isoformat()},
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
            HTTP_AUTHORIZATION=f"Bearer {self.warehouse_token}",
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
        self.order_1.shipping_city = "Talisay"
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
        self.order_2.shipping_city = "Talisay"
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
        self.driver_user.set_service_areas(["talisay"], self.admin_user.id)
        self.driver_user.save(update_fields=["service_areas"])
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

    def test_trips_post_replays_same_request_without_creating_a_duplicate(self) -> None:
        payload = {
            "requestId": "trip-create-retry-1",
            "driverId": self.driver.id,
            "vehicleId": self.vehicle.id,
            "warehouseId": self.warehouse.id,
            "orderIds": [self.order_1.id, self.order_2.id],
            "status": "PLANNED",
        }

        first = self.client.post(
            "/api/trips", data=payload, content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        replay = self.client.post(
            "/api/trips", data=payload, content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(first.status_code, 201, first.content.decode())
        self.assertEqual(replay.status_code, 200, replay.content.decode())
        self.assertEqual(replay.json()["trip"]["id"], first.json()["trip"]["id"])
        self.assertEqual(Trip.objects.filter(request_id=payload["requestId"]).count(), 1)

    def test_trips_post_rejects_order_with_passed_delivery_date(self) -> None:
        OrderTimeline.objects.create(
            order=self.order_1,
            delivery_date=timezone.now() - timedelta(days=1),
        )

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

        self.assertEqual(response.status_code, 409)
        self.assertIn("must be rescheduled before trip assignment", response.json()["error"])
        self.assertFalse(Trip.objects.filter(vehicle=self.vehicle).exists())

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
        trip_payload = response.json()["trip"]
        self.assertEqual(trip_payload["weightRemaining"], 0.0)
        # Regression: existing orders reopened in Edit Trip retain their per-order load.
        self.assertEqual(trip_payload["dropPoints"][0]["order"]["totalCases"], 5)
        self.assertEqual(trip_payload["dropPoints"][0]["order"]["totalWeight"], 50.0)
