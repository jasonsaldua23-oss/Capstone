"""A truck that cannot go on hands its undelivered load to another driver and truck."""

import json
from datetime import datetime, time, timedelta

from django.test import Client, TestCase
from django.utils import timezone

from .auth import create_token
from .models import (
    Customer,
    LocationLog,
    Notification,
    Order,
    OrderItem,
    OrderTimeline,
    Product,
    Trip,
    TripDropPoint,
    TripStatus,
    User,
    Vehicle,
    VehicleIncident,
    Warehouse,
)


def _driver(email: str, name: str, license_number: str) -> User:
    return User.objects.create(
        email=email, password="hashed", name=name, role="DRIVER", is_active=True, phone="09170000001",
        license_number=license_number, license_type="B", license_expiry=timezone.now() + timedelta(days=365),
        service_areas=[{"city": "silay"}],
    )


class TripTransferTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.staff = User.objects.create(email="transfer.staff@example.com", password="hashed", name="Wally Warehouse", role="WAREHOUSE_STAFF", is_active=True)
        self.warehouse = Warehouse.objects.create(
            name="Silay Warehouse", code="WH-TRANSFER", address="Rizal St", city="Silay",
            province="Negros Occidental", zip_code="6116", manager_id=self.staff.id,
        )
        self.customer = Customer.objects.create(email="store@example.com", password="hashed", name="Lopez Store")
        self.product = Product.objects.create(sku="PEPS-12OZ", name="Pepsi 12oz", unit="case", quantity_per_unit=24, weight=20)
        self.driver = _driver("juan@example.com", "Juan Driver", "N01-23-000001")
        self.rescuer = _driver("pedro@example.com", "Pedro Rescue", "N01-23-000002")
        self.broken = Vehicle.objects.create(license_plate="NBC-1231", type="VAN", status="IN_USE", driver=self.driver, capacity=1500)
        self.rescue_truck = Vehicle.objects.create(license_plate="NBC-2232", type="VAN", status="AVAILABLE", driver=self.rescuer, capacity=1500)
        self.trip = Trip.objects.create(
            trip_number="TRP-BROKEN", driver=self.driver, vehicle=self.broken, warehouse_id=self.warehouse.id,
            status=TripStatus.IN_PROGRESS, actual_start_at=timezone.now(), total_drop_points=3,
        )
        # A trip that started on an earlier day: its orders' day has passed.
        day = timezone.make_aware(datetime.combine(timezone.localdate() - timedelta(days=1), time(9)))
        for sequence, (point_status, order_status) in enumerate(
            [("COMPLETED", "DELIVERED"), ("ARRIVED", "OUT_FOR_DELIVERY"), ("PENDING", "OUT_FOR_DELIVERY")], start=1,
        ):
            order = Order.objects.create(
                order_number=f"ORD-TRANSFER-{sequence}", customer=self.customer, status=order_status,
                subtotal=0, total_amount=0, warehouse_id=self.warehouse.id, warehouse_dispatched_at=timezone.now(),
            )
            OrderTimeline.objects.create(order=order, delivery_date=day)
            # Ten 20 kg cases: 200 kg a stop.
            OrderItem.objects.create(
                order=order, product=self.product, product_name=self.product.name, product_unit="case",
                quantity=10, unit_price=0, total_price=0,
            )
            TripDropPoint.objects.create(
                trip=self.trip, order=order, sequence=sequence, location_name=f"Stop {sequence}", address="Purok 1",
                city="Silay", province="Negros Occidental", zip_code="6116", status=point_status,
                actual_arrival=timezone.now() if point_status == "ARRIVED" else None,
            )

    def auth(self, user: User) -> dict[str, str]:
        token = create_token({"userId": user.id, "email": user.email, "name": user.name, "role": user.role, "type": "staff"})
        return {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    def transfer(self, user: User | None = None, **overrides):
        body = {
            "driverId": self.rescuer.id, "vehicleId": self.rescue_truck.id,
            "reason": "Engine failure on the national road.", "requestId": "transfer-1", **overrides,
        }
        return self.client.post(
            f"/api/trips/{self.trip.id}/transfer", data=json.dumps(body),
            content_type="application/json", **self.auth(user or self.staff),
        )

    def test_the_undelivered_stops_move_to_the_rescue_truck(self) -> None:
        LocationLog.objects.create(driver=self.driver, trip=self.trip, latitude=10.81, longitude=122.98, accuracy=8, speed=0, recorded_at=timezone.now())

        response = self.transfer()

        self.assertEqual(response.status_code, 201, response.content)
        rescue = Trip.objects.get(transferred_from=self.trip)
        self.assertEqual((rescue.driver_id, rescue.vehicle_id, rescue.status), (self.rescuer.id, self.rescue_truck.id, TripStatus.PLANNED))
        self.assertEqual((rescue.transferred_from_number, rescue.transfer_reason), ("TRP-BROKEN", "Engine failure on the national road."))
        self.assertEqual((rescue.transfer_latitude, rescue.transfer_longitude), (10.81, 122.98))
        self.assertEqual(
            [(point.sequence, point.status, point.order.order_number) for point in rescue.drop_points.order_by("sequence")],
            [(1, "PENDING", "ORD-TRANSFER-2"), (2, "PENDING", "ORD-TRANSFER-3")],
        )
        # The orders are still on the road, and their day having passed does not make it overdue.
        self.assertEqual(set(Order.objects.filter(order_number__in=["ORD-TRANSFER-2", "ORD-TRANSFER-3"]).values_list("status", flat=True)), {"OUT_FOR_DELIVERY"})
        self.assertFalse(response.json()["trip"]["isOverdue"])

        self.trip.refresh_from_db()
        self.assertEqual((self.trip.status, self.trip.total_drop_points, self.trip.transferred_to_number), (TripStatus.COMPLETED, 1, rescue.trip_number))
        self.assertEqual(list(self.trip.drop_points.values_list("status", flat=True)), ["COMPLETED"])
        self.assertTrue(Notification.objects.filter(user=self.rescuer, title="New trip assigned", message__contains="collect the load of trip TRP-BROKEN").exists())
        self.assertTrue(Notification.objects.filter(user=self.driver, title="Load transferred").exists())
        self.assertEqual(Notification.objects.filter(customer=self.customer, title="Delivery update").count(), 2)

    def test_the_rescue_driver_can_start_it_after_confirming_the_load(self) -> None:
        self.transfer()
        rescue = Trip.objects.get(transferred_from=self.trip)

        started = self.client.post(
            f"/api/trips/{rescue.id}/start", data=json.dumps({"confirmLoad": True}),
            content_type="application/json", **self.auth(self.rescuer),
        )

        self.assertEqual(started.status_code, 200, started.content)
        rescue.refresh_from_db()
        self.assertEqual(rescue.status, TripStatus.IN_PROGRESS)

    def test_sending_the_truck_for_repair_closes_its_incident_report(self) -> None:
        incident = VehicleIncident.objects.create(
            incident_number="INC-2026-0001", request_id="inc-1", trip=self.trip, driver=self.driver, vehicle=self.broken,
            type="VEHICLE_DAMAGE", vehicle_can_continue=False, description="Engine died.", latitude=10.80, longitude=122.97,
        )

        self.transfer(sendVehicleForRepair=True)

        incident.refresh_from_db()
        self.broken.refresh_from_db()
        self.assertEqual((incident.status, incident.resolution_outcome), ("RESOLVED", "SENT_FOR_REPAIR"))
        # Damage or accident alike, a truck sent for repair goes out of service.
        self.assertEqual(self.broken.status, "OUT_OF_SERVICE")
        # The rescue driver is sent to the reported spot.
        rescue = Trip.objects.get(transferred_from=self.trip)
        self.assertEqual((rescue.transfer_latitude, rescue.transfer_longitude), (10.80, 122.97))

    def test_without_repair_the_broken_truck_is_simply_released(self) -> None:
        self.transfer()

        self.broken.refresh_from_db()
        self.assertEqual(self.broken.status, "AVAILABLE")

    def test_without_repair_the_incident_report_still_closes(self) -> None:
        incident = VehicleIncident.objects.create(
            incident_number="INC-2026-0001", request_id="inc-1", trip=self.trip, driver=self.driver, vehicle=self.broken,
            type="ACCIDENT", vehicle_can_continue=False, description="Side-swiped.",
        )

        self.transfer()

        incident.refresh_from_db()
        rescue = Trip.objects.get(transferred_from=self.trip)
        self.assertEqual((incident.status, incident.resolution_outcome), ("RESOLVED", "TRIP_ENDED"))
        self.assertEqual(incident.resolution_notes, f"Load transferred to {rescue.trip_number}.")
        self.assertEqual(incident.resolved_by_id, self.staff.id)

    def test_a_trip_that_delivered_nothing_ends_cancelled(self) -> None:
        TripDropPoint.objects.filter(trip=self.trip, status="COMPLETED").update(status="PENDING")

        self.transfer()

        self.trip.refresh_from_db()
        self.assertEqual(self.trip.status, TripStatus.CANCELLED)
        self.assertTrue(self.trip.cancellation_reason.startswith("Load transferred to TRP-"))

    def test_a_trip_left_without_stops_keeps_its_day(self) -> None:
        TripDropPoint.objects.filter(trip=self.trip, status="COMPLETED").update(status="PENDING")
        self.transfer()

        trips = self.client.get("/api/trips?page=1&pageSize=50", **self.auth(self.staff)).json()["trips"]
        source = next(row for row in trips if row["tripNumber"] == "TRP-BROKEN")
        # No stops are left to date it by, so its own start stands in.
        self.assertEqual(source["dropPoints"], [])
        self.assertTrue(source["tripSchedule"])
        self.assertEqual(source["transferredToNumber"], Trip.objects.get(transferred_from=self.trip).trip_number)

    def test_a_retried_transfer_reports_the_first(self) -> None:
        self.transfer()

        retry = self.transfer()

        self.assertEqual(retry.status_code, 200)
        self.assertTrue(retry.json()["alreadyTransferred"])
        self.assertEqual(Trip.objects.filter(transferred_from=self.trip).count(), 1)

    def test_the_rescue_must_be_free_qualified_and_big_enough(self) -> None:
        self.assertEqual(self.transfer(reason=" ").status_code, 400)
        self.assertEqual(self.transfer(vehicleId=self.broken.id).status_code, 400)
        # The two undelivered stops weigh 400 kg.
        Vehicle.objects.filter(id=self.rescue_truck.id).update(capacity=300)
        self.assertIn("overloaded", self.transfer().json()["error"].lower())
        Vehicle.objects.filter(id=self.rescue_truck.id).update(capacity=1500)
        Trip.objects.create(
            trip_number="TRP-BUSY", driver=self.rescuer, vehicle=self.rescue_truck, warehouse_id=self.warehouse.id,
            status=TripStatus.IN_PROGRESS,
        )
        busy = self.transfer()
        self.assertEqual(busy.status_code, 409)
        self.assertIn("TRP-BUSY", busy.json()["error"])
        self.assertEqual(Trip.objects.filter(transferred_from=self.trip).count(), 0)

    def test_only_warehouse_staff_transfer_a_load(self) -> None:
        admin = User.objects.create(email="transfer.admin@example.com", password="hashed", name="Ana Admin", role="ADMIN", is_active=True)
        self.assertEqual(self.transfer(user=admin).status_code, 403)
        self.assertEqual(self.transfer(user=self.driver).status_code, 403)
