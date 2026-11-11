"""What an incident report does to its trip.

A truck reported unable to continue stops its driver from moving on to another stop
until the warehouse decides, and a trip never ends with its incident left open,
except a stranded truck's: that one waits for the warehouse to deal with the truck.
"""

import json
from datetime import datetime, time

from django.test import Client, TestCase
from django.utils import timezone

from .auth import create_token
from .models import (
    Customer,
    Notification,
    Order,
    OrderTimeline,
    Trip,
    TripDropPoint,
    TripStatus,
    User,
    Vehicle,
    VehicleIncident,
    Warehouse,
)


def _user(email: str, name: str, role: str) -> User:
    return User.objects.create(email=email, password="hashed", name=name, role=role, is_active=True)


class IncidentTripLifecycleTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.staff = _user("lifecycle.staff@example.com", "Wally Warehouse", "WAREHOUSE_STAFF")
        self.driver = _user("lifecycle.driver@example.com", "Juan Driver", "DRIVER")
        self.warehouse = Warehouse.objects.create(
            name="Silay Warehouse", code="WH-LIFECYCLE", address="Rizal St", city="Silay",
            province="Negros Occidental", zip_code="6116", manager_id=self.staff.id,
        )
        self.customer = Customer.objects.create(email="store@example.com", password="hashed", name="Lopez Store")
        self.vehicle = Vehicle.objects.create(license_plate="NBC-1231", type="VAN", status="IN_USE", driver=self.driver, capacity=1500)
        self.trip = Trip.objects.create(
            trip_number="TRP-LIFECYCLE", driver=self.driver, vehicle=self.vehicle, warehouse_id=self.warehouse.id,
            status=TripStatus.IN_PROGRESS, actual_start_at=timezone.now(), total_drop_points=2,
        )
        day = timezone.make_aware(datetime.combine(timezone.localdate(), time(9)))
        points = []
        for sequence, point_status in enumerate(["ARRIVED", "PENDING"], start=1):
            order = Order.objects.create(
                order_number=f"ORD-LIFECYCLE-{sequence}", customer=self.customer, status="OUT_FOR_DELIVERY",
                subtotal=0, total_amount=0, warehouse_id=self.warehouse.id, warehouse_dispatched_at=timezone.now(),
            )
            OrderTimeline.objects.create(order=order, delivery_date=day)
            points.append(TripDropPoint.objects.create(
                trip=self.trip, order=order, sequence=sequence, location_name=f"Stop {sequence}", address="Purok 1",
                city="Silay", province="Negros Occidental", zip_code="6116", status=point_status,
                actual_arrival=timezone.now() if point_status == "ARRIVED" else None,
            ))
        self.arrived_stop, self.next_stop = points

    # -- helpers -------------------------------------------------------------------

    def auth(self, user: User) -> dict[str, str]:
        token = create_token({"userId": user.id, "email": user.email, "name": user.name, "role": user.role, "type": "staff"})
        return {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    def post(self, path: str, user: User, body: dict | None = None):
        return self.client.post(path, data=json.dumps(body or {}), content_type="application/json", **self.auth(user))

    def report(self, *, can_continue: bool, request_id: str = "req-1") -> VehicleIncident:
        response = self.post("/api/incidents", self.driver, {
            "requestId": request_id, "tripId": self.trip.id, "type": "VEHICLE_DAMAGE",
            "vehicleCanContinue": can_continue, "description": "Radiator hose burst.",
            "latitude": 10.80, "longitude": 122.97, "accuracy": 10,
        })
        self.assertEqual(response.status_code, 201, response.content)
        return VehicleIncident.objects.get(id=response.json()["incident"]["id"])

    def resolve(self, incident: VehicleIncident, outcome: str):
        return self.client.patch(
            f"/api/incidents/{incident.id}", data=json.dumps({"action": "RESOLVE", "outcome": outcome, "notes": "Handled."}),
            content_type="application/json", **self.auth(self.staff),
        )

    def update_stop(self, point: TripDropPoint, **body):
        return self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{point.id}", data=json.dumps(body),
            content_type="application/json", **self.auth(self.driver),
        )

    def finish_every_stop(self) -> None:
        TripDropPoint.objects.filter(trip=self.trip).update(status="COMPLETED")

    # -- a truck that cannot move stops the driver -----------------------------------

    def test_a_truck_that_cannot_continue_cannot_reach_the_next_stop(self) -> None:
        self.report(can_continue=False)

        response = self.update_stop(self.next_stop, status="ARRIVED")

        self.assertEqual(response.status_code, 409, response.content)
        self.assertIn("unable to continue", response.json()["error"])
        self.next_stop.refresh_from_db()
        self.assertEqual(self.next_stop.status, "PENDING")

    def test_the_stop_already_reached_can_still_be_settled(self) -> None:
        self.report(can_continue=False)

        # The goods are already at this customer's door.
        response = self.update_stop(
            self.arrived_stop, status="FAILED", notes="Store closed", failureReason="Store closed",
            releaseInventory=False, rescheduleRequested=True, rescheduleWindow="tomorrow",
        )

        self.assertEqual(response.status_code, 200, response.content)

    def test_a_truck_that_can_continue_is_not_stopped(self) -> None:
        self.report(can_continue=True)

        self.assertEqual(self.update_stop(self.next_stop, status="ARRIVED").status_code, 200)

    def test_the_warehouse_clearing_the_truck_lets_the_driver_go_on(self) -> None:
        incident = self.report(can_continue=False)
        self.assertEqual(self.resolve(incident, "RESUMED").status_code, 200)

        self.assertEqual(self.update_stop(self.next_stop, status="ARRIVED").status_code, 200)

    def test_a_truck_sent_for_repair_keeps_the_driver_stopped(self) -> None:
        incident = self.report(can_continue=True)
        self.assertEqual(self.resolve(incident, "SENT_FOR_REPAIR").status_code, 200)

        response = self.update_stop(self.next_stop, status="ARRIVED")

        self.assertEqual(response.status_code, 409, response.content)
        self.assertIn("sent for repair", response.json()["error"])

    # -- a trip never ends with its incident open ------------------------------------

    def test_completing_the_trip_closes_an_incident_the_truck_drove_on_with(self) -> None:
        incident = self.report(can_continue=True)
        self.finish_every_stop()

        response = self.post(f"/api/trips/{self.trip.id}/complete", self.driver)

        self.assertEqual(response.status_code, 200, response.content)
        incident.refresh_from_db()
        self.assertEqual((incident.status, incident.resolution_outcome), ("RESOLVED", "RESUMED"))
        self.assertIsNone(incident.resolved_by)
        self.assertIsNotNone(incident.resolved_at)
        self.assertIn("Juan Driver completed trip TRP-LIFECYCLE", incident.resolution_notes)
        alert = Notification.objects.get(user=self.staff, title="Trip completed")
        self.assertIn(f"{incident.incident_number} was closed", alert.message)

    def test_completing_the_trip_leaves_a_stranded_truck_incident_open(self) -> None:
        # Broke down on the way back, after the last delivery.
        incident = self.report(can_continue=False)
        self.finish_every_stop()

        response = self.post(f"/api/trips/{self.trip.id}/complete", self.driver)

        self.assertEqual(response.status_code, 200, response.content)
        incident.refresh_from_db()
        self.assertEqual(incident.status, "REPORTED")
        alert = Notification.objects.get(user=self.staff, title="Trip completed")
        self.assertIn(f"{incident.incident_number} is still open", alert.message)

    def test_cancelling_the_trip_closes_its_incident(self) -> None:
        incident = self.report(can_continue=False)

        response = self.post(f"/api/trips/{self.trip.id}/cancel", self.staff, {"reason": "Truck towed back."})

        self.assertEqual(response.status_code, 200, response.content)
        incident.refresh_from_db()
        self.assertEqual((incident.status, incident.resolution_outcome), ("RESOLVED", "TRIP_ENDED"))
        self.assertEqual(incident.resolution_notes, "Trip cancelled: Truck towed back.")
        self.assertEqual(incident.resolved_by_id, self.staff.id)
        self.assertEqual(incident.acknowledged_by_id, self.staff.id)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.status, "AVAILABLE")

    def test_cancelling_can_send_the_truck_for_repair(self) -> None:
        incident = self.report(can_continue=False)

        response = self.post(
            f"/api/trips/{self.trip.id}/cancel", self.staff, {"reason": "Engine seized.", "sendVehicleForRepair": True},
        )

        self.assertEqual(response.status_code, 200, response.content)
        incident.refresh_from_db()
        self.assertEqual(incident.resolution_outcome, "SENT_FOR_REPAIR")
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.status, "OUT_OF_SERVICE")
