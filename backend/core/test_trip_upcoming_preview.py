"""Upcoming-deliveries preview: per-day counts must match the route planner."""

from datetime import datetime, time, timedelta

from django.test import Client, TestCase
from django.utils import timezone

from .auth import create_token
from .models import (
    Customer,
    Order,
    OrderItem,
    OrderStatus,
    OrderTimeline,
    Product,
    Trip,
    TripDropPoint,
    TripStatus,
    User,
    Vehicle,
    VehicleType,
    Warehouse,
)
from .test_support import Driver, Role


def _local_noon(day) -> datetime:
    return timezone.make_aware(datetime.combine(day, time(12, 0)), timezone.get_current_timezone())


class UpcomingDeliveriesPreviewTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")
        self.warehouse_role = Role.objects.create(name="WAREHOUSE_STAFF", description="Warehouse Staff")
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.admin_user = User.objects.create(
            email="upcoming.admin@route.local",
            password="hashed",
            name="Upcoming Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.warehouse_user = User.objects.create(
            email="upcoming.warehouse@route.local",
            password="hashed",
            name="Upcoming Warehouse Staff",
            role=self.warehouse_role,
            is_active=True,
        )
        self.other_warehouse_user = User.objects.create(
            email="upcoming.other.warehouse@route.local",
            password="hashed",
            name="Other Warehouse Staff",
            role=self.warehouse_role,
            is_active=True,
        )
        driver_user = User.objects.create(
            email="upcoming.driver@route.local",
            password="hashed",
            name="Upcoming Driver",
            role=self.driver_role,
            is_active=True,
        )
        self.driver = Driver.objects.create(
            user=driver_user,
            license_number="LIC-UPCOMING-001",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )
        self.vehicle = Vehicle.objects.create(
            license_plate="UPCOMING-001",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
        )
        self.customer = Customer.objects.create(
            email="upcoming.customer@route.local",
            password="hashed",
            name="Upcoming Customer",
            latitude=10.31,
            longitude=123.89,
            is_active=True,
        )
        self.warehouse = Warehouse.objects.create(
            name="Upcoming WH",
            code="WH-UPCOMING-001",
            address="Upcoming Road",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            latitude=10.30,
            longitude=123.90,
            manager_id=self.warehouse_user.id,
            is_active=True,
        )
        # Fix: production enforces one warehouse; the second staff account still
        # checks that an unassigned user cannot access its preview.
        self.product = Product.objects.create(
            sku="SKU-UPCOMING-001",
            name="Sparkling Water",
            unit="case",
            price=100,
            weight=2.5,
            is_active=True,
        )
        self.admin_token = self._token(self.admin_user, "ADMIN")
        self.warehouse_token = self._token(self.warehouse_user, "WAREHOUSE_STAFF")
        self.other_warehouse_token = self._token(self.other_warehouse_user, "WAREHOUSE_STAFF")
        self.today = timezone.localdate()

    def _token(self, user: User, role: str) -> str:
        return create_token(
            {
                "userId": user.id,
                "email": user.email,
                "name": user.name,
                "role": role,
                "type": "staff",
            }
        )

    def _seed_order(
        self,
        order_number: str,
        *,
        status: str,
        delivery_day=None,
        created_day=None,
        timeline: bool = True,
        quantity: int = 2,
        city: str = "Bacolod",
        warehouse_id: str | None = None,
    ) -> Order:
        order = Order.objects.create(
            order_number=order_number,
            customer=self.customer,
            status=status,
            subtotal=100 * quantity,
            total_amount=110 * quantity,
            warehouse_id=self.warehouse.id if warehouse_id is None else warehouse_id,
            shipping_name=f"Customer {order_number}",
            shipping_address="123 Upcoming Street",
            shipping_city=city,
            shipping_province="Negros Occidental",
            shipping_zip_code="6100",
            shipping_country="Philippines",
            shipping_latitude=10.32,
            shipping_longitude=123.88,
        )
        OrderItem.objects.create(
            order=order,
            product=self.product,
            quantity=quantity,
            unit_price=100,
            total_price=100 * quantity,
        )
        if created_day is not None:
            # created_at defaults to now; the fallback rule needs it on a chosen day.
            Order.objects.filter(id=order.id).update(created_at=_local_noon(created_day))
        if timeline:
            OrderTimeline.objects.create(
                order=order,
                delivery_date=_local_noon(delivery_day) if delivery_day is not None else None,
            )
        return order

    def _put_on_active_trip(self, order: Order, day) -> Trip:
        trip = Trip.objects.create(
            trip_number=f"TRP-{order.order_number}",
            driver=self.driver,
            vehicle=self.vehicle,
            warehouse_id=self.warehouse.id,
            status=TripStatus.PLANNED,
            planned_start_at=_local_noon(day),
        )
        TripDropPoint.objects.create(
            trip=trip,
            order=order,
            sequence=1,
            status="PENDING",
            location_name=order.shipping_name,
            address=order.shipping_address,
            city=order.shipping_city,
            province=order.shipping_province,
            zip_code=order.shipping_zip_code,
        )
        return trip

    def _seed_six_days(self) -> dict[str, Order]:
        d = [self.today + timedelta(days=offset) for offset in range(6)]
        seeded = {
            # Day 0: one eligible order and one still awaiting approval.
            "d0_confirmed": self._seed_order("ORD-UP-D0-CONF", status=OrderStatus.CONFIRMED, delivery_day=d[0]),
            "d0_pending": self._seed_order("ORD-UP-D0-PEND", status=OrderStatus.PENDING, delivery_day=d[0]),
            # Day 1: preparing counts; delivered does not. A second city tests the breakdown.
            "d1_preparing": self._seed_order("ORD-UP-D1-PREP", status=OrderStatus.PREPARING, delivery_day=d[1], quantity=3),
            "d1_preparing_talisay": self._seed_order(
                "ORD-UP-D1-PREP-TAL", status=OrderStatus.PREPARING, delivery_day=d[1], city="Talisay"
            ),
            "d1_delivered": self._seed_order("ORD-UP-D1-DELV", status=OrderStatus.DELIVERED, delivery_day=d[1]),
            # Day 2: an order already on an active trip is hidden; an order with no
            # timeline row falls back to its creation day.
            "d2_on_trip": self._seed_order("ORD-UP-D2-TRIP", status=OrderStatus.PREPARING, delivery_day=d[2]),
            "d2_no_timeline": self._seed_order(
                "ORD-UP-D2-NOTL", status=OrderStatus.CONFIRMED, created_day=d[2], timeline=False
            ),
            # Day 3: timeline row exists but has no delivery date -> creation day.
            "d3_blank_delivery": self._seed_order(
                "ORD-UP-D3-BLANK", status=OrderStatus.CONFIRMED, created_day=d[3], delivery_day=None
            ),
            # Day 4: nothing. Day 5: eligible but outside a 5-day window.
            "d5_confirmed": self._seed_order("ORD-UP-D5-CONF", status=OrderStatus.CONFIRMED, delivery_day=d[5]),
        }
        self._put_on_active_trip(seeded["d2_on_trip"], d[2])
        return seeded

    def _route_plan_order_ids(self, day, token: str | None = None) -> set[str]:
        response = self.client.get(
            "/api/trips/route-plan",
            data={"warehouseId": self.warehouse.id, "date": day.isoformat()},
            HTTP_AUTHORIZATION=f"Bearer {token or self.admin_token}",
        )
        self.assertEqual(response.status_code, 200)
        return {row["id"] for row in response.json()["orders"]}

    def _route_plan_orders(self, day) -> list[dict]:
        response = self.client.get(
            "/api/trips/route-plan",
            data={"warehouseId": self.warehouse.id, "date": day.isoformat()},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 200)
        return response.json()["orders"]

    def test_requires_staff_auth(self) -> None:
        response = self.client.get("/api/trips/upcoming-deliveries")
        self.assertEqual(response.status_code, 401)

    def test_rejects_invalid_from_date(self) -> None:
        response = self.client.get(
            "/api/trips/upcoming-deliveries",
            data={"warehouseId": self.warehouse.id, "from": "2026-13-40"},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.json()["success"])

    def test_defaults_to_today_and_five_days_with_empty_entries(self) -> None:
        response = self.client.get(
            "/api/trips/upcoming-deliveries",
            data={"warehouseId": self.warehouse.id},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["from"], self.today.isoformat())
        self.assertEqual(payload["to"], (self.today + timedelta(days=4)).isoformat())
        self.assertEqual(len(payload["days"]), 5)
        for offset, day in enumerate(payload["days"]):
            self.assertEqual(day["date"], (self.today + timedelta(days=offset)).isoformat())
            self.assertEqual(day["orderCount"], 0)
            self.assertEqual(day["totalCases"], 0)
            self.assertEqual(day["totalWeight"], 0)
            self.assertEqual(day["cities"], [])
            self.assertEqual(day["orders"], [])

    def test_days_is_clamped_between_one_and_fourteen(self) -> None:
        for requested, expected in (("0", 1), ("-3", 1), ("99", 14), ("abc", 5), ("7", 7)):
            response = self.client.get(
                "/api/trips/upcoming-deliveries",
                data={"warehouseId": self.warehouse.id, "days": requested},
                HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
            )
            self.assertEqual(response.status_code, 200, requested)
            self.assertEqual(len(response.json()["days"]), expected, requested)

    def test_per_day_counts_match_route_plan_for_each_day(self) -> None:
        seeded = self._seed_six_days()
        response = self.client.get(
            "/api/trips/upcoming-deliveries",
            data={"warehouseId": self.warehouse.id, "from": self.today.isoformat(), "days": "6"},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["days"]), 6)

        expected_ids_by_offset = {
            0: {seeded["d0_confirmed"].id},
            1: {seeded["d1_preparing"].id, seeded["d1_preparing_talisay"].id},
            2: {seeded["d2_no_timeline"].id},
            3: {seeded["d3_blank_delivery"].id},
            4: set(),
            5: {seeded["d5_confirmed"].id},
        }
        for offset, day in enumerate(payload["days"]):
            target_day = self.today + timedelta(days=offset)
            route_plan_orders = self._route_plan_orders(target_day)
            route_plan_ids = {row["id"] for row in route_plan_orders}
            preview_ids = {row["id"] for row in day["orders"]}
            # The chip must promise exactly what Filter Orders will then show.
            self.assertEqual(preview_ids, route_plan_ids, f"day offset {offset}")
            self.assertEqual(day["orderCount"], len(route_plan_orders), f"day offset {offset}")
            self.assertEqual(preview_ids, expected_ids_by_offset[offset], f"day offset {offset}")
            self.assertEqual(day["totalCases"], sum(row["totalCases"] for row in route_plan_orders), f"day offset {offset}")
            self.assertAlmostEqual(
                day["totalWeight"], sum(row["totalWeight"] for row in route_plan_orders), places=2, msg=f"day offset {offset}"
            )
            for row in day["orders"]:
                self.assertEqual(row["deliveryDate"], target_day.isoformat())

        day_one = payload["days"][1]
        self.assertEqual(day_one["totalCases"], 5)
        self.assertAlmostEqual(day_one["totalWeight"], 12.5, places=2)
        self.assertEqual(
            day_one["cities"],
            [
                {"city": "Bacolod", "orderCount": 1, "totalCases": 3},
                {"city": "Talisay", "orderCount": 1, "totalCases": 2},
            ],
        )
        order_row = next(row for row in day_one["orders"] if row["id"] == seeded["d1_preparing"].id)
        self.assertEqual(order_row["orderNumber"], "ORD-UP-D1-PREP")
        self.assertEqual(order_row["customerName"], "Customer ORD-UP-D1-PREP")
        self.assertEqual(order_row["city"], "Bacolod")
        self.assertEqual(order_row["cases"], 3)
        self.assertAlmostEqual(order_row["weight"], 7.5, places=2)

    def test_five_day_window_excludes_the_sixth_day(self) -> None:
        seeded = self._seed_six_days()
        response = self.client.get(
            "/api/trips/upcoming-deliveries",
            data={"warehouseId": self.warehouse.id, "from": self.today.isoformat(), "days": "5"},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 200)
        listed_ids = {row["id"] for day in response.json()["days"] for row in day["orders"]}
        self.assertNotIn(seeded["d5_confirmed"].id, listed_ids)
        self.assertNotIn(seeded["d0_pending"].id, listed_ids)
        self.assertNotIn(seeded["d1_delivered"].id, listed_ids)
        self.assertNotIn(seeded["d2_on_trip"].id, listed_ids)

    def test_order_released_from_trip_reappears_in_preview(self) -> None:
        seeded = self._seed_six_days()
        day_two = self.today + timedelta(days=2)
        TripDropPoint.objects.filter(order=seeded["d2_on_trip"]).update(status="CANCELLED")
        response = self.client.get(
            "/api/trips/upcoming-deliveries",
            data={"warehouseId": self.warehouse.id, "from": day_two.isoformat(), "days": "1"},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 200)
        preview_ids = {row["id"] for row in response.json()["days"][0]["orders"]}
        self.assertEqual(preview_ids, self._route_plan_order_ids(day_two))
        self.assertIn(seeded["d2_on_trip"].id, preview_ids)

    def test_warehouse_staff_can_only_query_their_own_warehouse(self) -> None:
        self._seed_six_days()
        own = self.client.get(
            "/api/trips/upcoming-deliveries",
            data={"warehouseId": self.warehouse.id},
            HTTP_AUTHORIZATION=f"Bearer {self.warehouse_token}",
        )
        self.assertEqual(own.status_code, 200)
        self.assertEqual(own.json()["days"][0]["orderCount"], 1)

        foreign = self.client.get(
            "/api/trips/upcoming-deliveries",
            data={"warehouseId": self.warehouse.id},
            HTTP_AUTHORIZATION=f"Bearer {self.other_warehouse_token}",
        )
        self.assertEqual(foreign.status_code, 403)
        self.assertEqual(foreign.json()["error"], "Forbidden")

        missing = self.client.get(
            "/api/trips/upcoming-deliveries",
            HTTP_AUTHORIZATION=f"Bearer {self.warehouse_token}",
        )
        self.assertEqual(missing.status_code, 400)

    def test_admin_without_warehouse_sees_the_single_warehouse(self) -> None:
        seeded = self._seed_six_days()
        response = self.client.get(
            "/api/trips/upcoming-deliveries",
            data={"from": self.today.isoformat(), "days": "1"},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 200)
        preview_ids = {row["id"] for row in response.json()["days"][0]["orders"]}
        self.assertEqual(preview_ids, {seeded["d0_confirmed"].id})
