"""Accident and vehicle-damage reports: who may report, see and resolve them."""

import json
import tempfile
from datetime import timedelta
from pathlib import Path

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from django.utils import timezone

from .auth import create_token
from .models import (
    LocationLog,
    Notification,
    SyncStamp,
    Trip,
    TripStatus,
    User,
    Vehicle,
    VehicleIncident,
    VehicleStatus,
    VehicleType,
    Warehouse,
)
from .sync_stamps import scopes_for_path
from .test_upload_storage import PNG_BYTES


def _staff(email: str, name: str, role: str) -> User:
    return User.objects.create(email=email, password="hashed", name=name, role=role, is_active=True)


def _token(user: User) -> str:
    return create_token({"userId": user.id, "email": user.email, "name": user.name, "role": user.role, "type": "staff"})


def _warehouse(code: str, manager: User) -> Warehouse:
    return Warehouse.objects.create(
        name=f"Warehouse {code}", code=code, address="Lacson St", city="Silay",
        province="Negros Occidental", zip_code="6116", manager_id=manager.id,
    )


class VehicleIncidentTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.driver = _staff("incident.driver@example.com", "Juan Driver", "DRIVER")
        self.other_driver = _staff("incident.other@example.com", "Pedro Driver", "DRIVER")
        self.admin = _staff("incident.admin@example.com", "Ana Admin", "ADMIN")
        self.staff = _staff("incident.staff@example.com", "Wally Warehouse", "WAREHOUSE_STAFF")
        self.other_staff = _staff("incident.staff2@example.com", "Olga Other", "WAREHOUSE_STAFF")
        self.warehouse = _warehouse("WH-INC-1", self.staff)
        self.other_warehouse = _warehouse("WH-INC-2", self.other_staff)
        self.vehicle = Vehicle.objects.create(
            license_plate="INC-1234", type=VehicleType.VAN, status=VehicleStatus.IN_USE, is_active=True, driver=self.driver,
        )
        self.other_vehicle = Vehicle.objects.create(
            license_plate="INC-5678", type=VehicleType.VAN, status=VehicleStatus.IN_USE, is_active=True,
            driver=self.other_driver,
        )
        self.started_at = timezone.now() - timedelta(hours=1)
        self.trip = Trip.objects.create(
            trip_number="TRP-INC-001", driver=self.driver, vehicle=self.vehicle, warehouse_id=self.warehouse.id,
            status=TripStatus.IN_PROGRESS, actual_start_at=self.started_at,
        )
        self.other_trip = Trip.objects.create(
            trip_number="TRP-INC-002", driver=self.other_driver, vehicle=self.other_vehicle,
            warehouse_id=self.other_warehouse.id, status=TripStatus.IN_PROGRESS, actual_start_at=self.started_at,
        )

    # -- helpers -------------------------------------------------------------------

    def auth(self, user: User) -> dict[str, str]:
        return {"HTTP_AUTHORIZATION": f"Bearer {_token(user)}"}

    def report(self, user: User | None = None, **overrides):
        body = {
            "requestId": "req-1",
            "tripId": self.trip.id,
            "type": "ACCIDENT",
            "vehicleCanContinue": False,
            "description": "Rear-ended at the Silay rotunda; bumper hanging.",
            "latitude": 10.7971,
            "longitude": 122.9746,
            "accuracy": 12,
        }
        body.update(overrides)
        body = {key: value for key, value in body.items() if value is not ...}
        headers = self.auth(user or self.driver)
        return self.client.post("/api/incidents", data=json.dumps(body), content_type="application/json", **headers)

    def act(self, incident_id: str, user: User, **body):
        return self.client.patch(
            f"/api/incidents/{incident_id}", data=json.dumps(body), content_type="application/json", **self.auth(user),
        )

    def listing(self, user: User, query: str = ""):
        return self.client.get(f"/api/incidents{query}", **self.auth(user))

    # -- reporting -----------------------------------------------------------------

    def test_report_requires_a_signed_in_driver(self) -> None:
        response = self.client.post("/api/incidents", data="{}", content_type="application/json")
        self.assertEqual(response.status_code, 401)
        for user in (self.admin, self.staff):
            response = self.report(user)
            self.assertEqual(response.status_code, 403, response.content)
            self.assertEqual(response.json()["error"], "Only drivers can report incidents")
        self.assertFalse(VehicleIncident.objects.exists())

    def test_driver_reports_an_accident_with_their_device_location(self) -> None:
        response = self.report()

        self.assertEqual(response.status_code, 201, response.content)
        incident = response.json()["incident"]
        self.assertEqual(incident["incidentNumber"], f"INC-{timezone.localdate().year}-0001")
        self.assertEqual(incident["type"], "ACCIDENT")
        self.assertEqual(incident["typeLabel"], "Accident")
        self.assertEqual(incident["status"], "REPORTED")
        self.assertTrue(incident["isOpen"])
        self.assertFalse(incident["vehicleCanContinue"])
        self.assertEqual((incident["latitude"], incident["longitude"]), (10.7971, 122.9746))
        self.assertEqual(incident["locationSource"], "DEVICE")
        self.assertEqual(incident["tripNumber"], "TRP-INC-001")
        self.assertEqual(incident["vehiclePlate"], "INC-1234")
        self.assertEqual(incident["driverName"], "Juan Driver")
        self.assertFalse(incident["canManage"])

        # Every admin and warehouse account hears about it, pointing at the incident.
        alerts = Notification.objects.filter(reference_type="incident", reference_id=incident["id"])
        self.assertEqual({alert.user_id for alert in alerts}, {self.admin.id, self.staff.id, self.other_staff.id})
        alert = alerts.first()
        self.assertEqual(alert.title, "Accident reported")
        self.assertEqual(alert.type, "INCIDENT")
        self.assertIn("TRP-INC-001", alert.message)
        self.assertIn("cannot continue", alert.message)

    def test_report_without_a_device_fix_uses_the_last_gps_fix_of_the_trip(self) -> None:
        fix_time = self.started_at + timedelta(minutes=30)
        LocationLog.objects.create(driver=self.driver, trip=self.trip, latitude=10.80, longitude=122.97, accuracy=8, recorded_at=fix_time)

        incident = self.report(latitude=..., longitude=..., accuracy=..., type="VEHICLE_DAMAGE").json()["incident"]

        self.assertEqual((incident["latitude"], incident["longitude"]), (10.80, 122.97))
        self.assertEqual(incident["locationSource"], "LAST_GPS")
        self.assertEqual(incident["locationRecordedAt"], fix_time.isoformat())

    def test_a_vague_device_fix_gives_way_to_the_last_gps_fix(self) -> None:
        LocationLog.objects.create(driver=self.driver, latitude=10.80, longitude=122.97, recorded_at=timezone.now())
        incident = self.report(accuracy=900).json()["incident"]
        self.assertEqual(incident["locationSource"], "LAST_GPS")

    def test_a_fix_from_before_the_trip_started_is_not_the_incident_location(self) -> None:
        LocationLog.objects.create(
            driver=self.driver, latitude=10.80, longitude=122.97, recorded_at=self.started_at - timedelta(minutes=5),
        )
        incident = self.report(latitude=..., longitude=..., accuracy=...).json()["incident"]
        self.assertIsNone(incident["latitude"])
        self.assertIsNone(incident["locationSource"])

    def test_report_is_validated(self) -> None:
        cases = [
            ({"requestId": ""}, "A requestId of 1 to 120 characters is required"),
            ({"type": "FLAT_TIRE"}, "Choose what happened: an accident or vehicle damage"),
            ({"vehicleCanContinue": "no"}, "Say whether the vehicle can continue the trip"),
            ({"description": "   "}, "Describe what happened"),
            ({"description": "x" * 1001}, "The description must be 1000 characters or fewer"),
            ({"latitude": 95}, "Invalid coordinates"),
            ({"longitude": ...}, "Invalid coordinates"),
            ({"photoUrl": "/api/media/pods/pod-abc.png"}, "Attach a photo uploaded from this account"),
        ]
        for overrides, message in cases:
            with self.subTest(overrides=overrides):
                response = self.report(**overrides)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertEqual(response.json()["error"], message)
        self.assertFalse(VehicleIncident.objects.exists())

    def test_driver_can_report_only_on_their_own_trip_in_progress(self) -> None:
        response = self.report(tripId=self.other_trip.id)
        self.assertEqual(response.status_code, 403)

        self.trip.status = TripStatus.PLANNED
        self.trip.save(update_fields=["status"])
        response = self.report()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "Incidents can only be reported on a trip in progress")

        self.assertEqual(self.report(tripId="missing-trip").status_code, 404)

    def test_a_retried_report_returns_the_incident_it_already_made(self) -> None:
        first = self.report()
        second = self.report()

        self.assertEqual(second.status_code, 200, second.content)
        self.assertEqual(first.json()["incident"]["id"], second.json()["incident"]["id"])
        self.assertEqual(VehicleIncident.objects.count(), 1)
        # The retry raised no second round of alerts.
        self.assertEqual(Notification.objects.filter(reference_type="incident").count(), 3)

        reused = self.report(description="A different event entirely.")
        self.assertEqual(reused.status_code, 409)
        self.assertEqual(reused.json()["error"], "This requestId was already used for another incident")

    def test_only_one_incident_can_be_open_per_trip(self) -> None:
        first = self.report().json()["incident"]

        response = self.report(requestId="req-2", type="VEHICLE_DAMAGE")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "An incident is already open for this trip")
        self.assertEqual(response.json()["incident"]["id"], first["id"])

        # Once resolved, the next problem on the same trip is a new incident.
        self.act(first["id"], self.staff, action="RESOLVE", outcome="RESUMED", notes="Bumper tied back.")
        again = self.report(requestId="req-3", type="VEHICLE_DAMAGE")
        self.assertEqual(again.status_code, 201, again.content)
        self.assertEqual(again.json()["incident"]["incidentNumber"], f"INC-{timezone.localdate().year}-0002")

    # -- photos --------------------------------------------------------------------

    def test_driver_attaches_their_own_photo_and_staff_can_view_it(self) -> None:
        with tempfile.TemporaryDirectory() as media_root, override_settings(
            MEDIA_ROOT=Path(media_root), SUPABASE_URL="", SUPABASE_SERVICE_ROLE_KEY="",
        ):
            denied = self.client.post(
                "/api/incidents/photo",
                data={"file": SimpleUploadedFile("crash.png", PNG_BYTES, content_type="image/png")},
                **self.auth(self.staff),
            )
            self.assertEqual(denied.status_code, 403)

            uploaded = self.client.post(
                "/api/incidents/photo",
                data={"file": SimpleUploadedFile("crash.png", PNG_BYTES, content_type="image/png")},
                **self.auth(self.driver),
            )
            self.assertEqual(uploaded.status_code, 200, uploaded.content)
            photo_url = uploaded.json()["imageUrl"]
            self.assertTrue(photo_url.startswith(f"/api/media/incident-photos/incident-{self.driver.id}-"))

            # Another driver cannot pass this driver's upload off as theirs.
            stolen = self.report(self.other_driver, tripId=self.other_trip.id, photoUrl=photo_url)
            self.assertEqual(stolen.status_code, 400)

            incident = self.report(photoUrl=photo_url).json()["incident"]
            self.assertEqual(incident["photoUrl"], photo_url)

            for user, expected in [
                (self.driver, 200), (self.admin, 200), (self.staff, 200), (self.other_driver, 403), (self.other_staff, 403),
            ]:
                with self.subTest(user=user.name):
                    response = self.client.get(photo_url, **self.auth(user))
                    self.assertEqual(response.status_code, expected)
                    if hasattr(response, "streaming_content"):
                        b"".join(response.streaming_content)
                        response.close()

    # -- reading -------------------------------------------------------------------

    def test_each_role_sees_only_the_incidents_it_may_see(self) -> None:
        mine = self.report().json()["incident"]
        theirs = self.report(self.other_driver, requestId="req-other", tripId=self.other_trip.id).json()["incident"]

        def ids(user: User, query: str = "") -> list[str]:
            response = self.listing(user, query)
            self.assertEqual(response.status_code, 200, response.content)
            return [row["id"] for row in response.json()["incidents"]]

        self.assertCountEqual(ids(self.admin), [mine["id"], theirs["id"]])
        self.assertEqual(ids(self.staff), [mine["id"]])
        self.assertEqual(ids(self.other_staff), [theirs["id"]])
        self.assertEqual(ids(self.driver), [mine["id"]])
        self.assertEqual(ids(self.other_driver), [theirs["id"]])
        self.assertEqual(ids(self.driver, f"?tripId={self.trip.id}"), [mine["id"]])

        # Only the warehouse that owns the trip may act on it; the admin watches.
        self.assertTrue(self.listing(self.staff).json()["incidents"][0]["canManage"])
        self.assertTrue(all(not row["canManage"] for row in self.listing(self.admin).json()["incidents"]))

    def test_list_filters_by_status_and_keeps_open_incidents_on_every_day(self) -> None:
        old = self.report().json()["incident"]
        VehicleIncident.objects.filter(id=old["id"]).update(created_at=timezone.now() - timedelta(days=3))
        self.act(old["id"], self.staff, action="RESOLVE", outcome="RESUMED", notes="Back on the road.")
        still_open = self.report(requestId="req-open", type="VEHICLE_DAMAGE").json()["incident"]
        VehicleIncident.objects.filter(id=still_open["id"]).update(created_at=timezone.now() - timedelta(days=2))

        today = timezone.localdate().isoformat()
        rows = self.listing(self.admin, f"?date={today}").json()["incidents"]
        self.assertEqual([row["id"] for row in rows], [still_open["id"]])

        old_day = (timezone.localdate() - timedelta(days=3)).isoformat()
        rows = self.listing(self.admin, f"?date={old_day}").json()["incidents"]
        # The open one first, then that day's own.
        self.assertEqual([row["id"] for row in rows], [still_open["id"], old["id"]])

        self.assertEqual([row["id"] for row in self.listing(self.admin, "?status=open").json()["incidents"]], [still_open["id"]])
        self.assertEqual([row["id"] for row in self.listing(self.admin, "?status=resolved").json()["incidents"]], [old["id"]])
        self.assertEqual(self.listing(self.admin, "?status=closed").status_code, 400)
        self.assertEqual(self.listing(self.admin, "?date=yesterday").status_code, 400)

    # -- responding ----------------------------------------------------------------

    def test_only_warehouse_staff_of_the_trip_can_respond(self) -> None:
        incident = self.report().json()["incident"]
        for user, status in [(self.admin, 403), (self.driver, 403), (self.other_staff, 403)]:
            with self.subTest(user=user.name):
                self.assertEqual(self.act(incident["id"], user, action="ACKNOWLEDGE").status_code, status)
        self.assertEqual(self.act("missing", self.staff, action="ACKNOWLEDGE").status_code, 404)
        self.assertEqual(self.act(incident["id"], self.staff, action="CLOSE").status_code, 400)
        self.assertEqual(VehicleIncident.objects.get(id=incident["id"]).status, "REPORTED")

    def test_acknowledging_tells_the_driver_once(self) -> None:
        incident = self.report().json()["incident"]

        response = self.act(incident["id"], self.staff, action="ACKNOWLEDGE")

        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()["incident"]
        self.assertEqual(body["status"], "ACKNOWLEDGED")
        self.assertEqual(body["acknowledgedBy"], "Wally Warehouse")
        self.assertTrue(body["canManage"])
        driver_alerts = Notification.objects.filter(user=self.driver)
        self.assertEqual(driver_alerts.count(), 1)
        self.assertEqual(driver_alerts.first().title, "Incident acknowledged")
        self.assertEqual((driver_alerts.first().reference_type, driver_alerts.first().reference_id), ("trip", self.trip.id))

        # A retried acknowledgement changes nothing and says nothing new.
        self.assertEqual(self.act(incident["id"], self.staff, action="ACKNOWLEDGE").status_code, 200)
        self.assertEqual(Notification.objects.filter(user=self.driver).count(), 1)

    def test_resolving_needs_an_outcome_and_notes(self) -> None:
        incident = self.report().json()["incident"]
        cases = [
            ({}, "Choose how the incident was resolved"),
            ({"outcome": "RESUMED"}, "Add notes on how the incident was resolved"),
            ({"outcome": "RESUMED", "notes": "x" * 1001}, "Notes must be 1000 characters or fewer"),
            # Recorded only when a trip ends with the incident open, never chosen by hand.
            ({"outcome": "TRIP_ENDED", "notes": "Closing it."}, "Choose how the incident was resolved"),
        ]
        for body, message in cases:
            with self.subTest(body=body):
                response = self.act(incident["id"], self.staff, action="RESOLVE", **body)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["error"], message)

    def test_sending_the_vehicle_for_repair_takes_it_out_of_dispatch(self) -> None:
        incident = self.report().json()["incident"]

        response = self.act(incident["id"], self.staff, action="RESOLVE", outcome="SENT_FOR_REPAIR", notes="Towed to the shop.")

        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()["incident"]
        self.assertEqual(body["status"], "RESOLVED")
        self.assertFalse(body["isOpen"])
        self.assertFalse(body["canManage"])
        self.assertEqual(body["resolutionOutcomeLabel"], "Vehicle sent for repair")
        # Resolving straight from REPORTED also records who saw it.
        self.assertEqual(body["acknowledgedBy"], "Wally Warehouse")
        # An accident is not routine maintenance: the truck goes out of service.
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.status, VehicleStatus.OUT_OF_SERVICE)
        resolved_alert = Notification.objects.get(user=self.driver)
        self.assertEqual(resolved_alert.title, "Incident resolved")
        self.assertIn("Vehicle sent for repair", resolved_alert.message)

        # A retry is accepted; a different resolution or a late acknowledgement is not.
        self.assertEqual(self.act(incident["id"], self.staff, action="RESOLVE", outcome="SENT_FOR_REPAIR", notes="Towed to the shop.").status_code, 200)
        self.assertEqual(self.act(incident["id"], self.staff, action="RESOLVE", outcome="RESUMED", notes="Fine.").status_code, 409)
        self.assertEqual(self.act(incident["id"], self.staff, action="ACKNOWLEDGE").status_code, 409)

    def test_vehicle_damage_sent_for_repair_also_goes_out_of_service(self) -> None:
        # Even a truck already booked for maintenance: sent for repair means out of service.
        Vehicle.objects.filter(id=self.vehicle.id).update(status=VehicleStatus.MAINTENANCE)
        incident = self.report(type="VEHICLE_DAMAGE", description="Radiator leaking; engine overheating.").json()["incident"]

        response = self.act(incident["id"], self.staff, action="RESOLVE", outcome="SENT_FOR_REPAIR", notes="Radiator replaced at the shop.")

        self.assertEqual(response.status_code, 200, response.content)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.status, VehicleStatus.OUT_OF_SERVICE)

    def test_a_resumed_vehicle_keeps_its_status_and_out_of_service_is_never_downgraded(self) -> None:
        incident = self.report().json()["incident"]
        self.act(incident["id"], self.staff, action="RESOLVE", outcome="RESUMED", notes="Driver continued.")
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.status, VehicleStatus.IN_USE)

        Vehicle.objects.filter(id=self.vehicle.id).update(status=VehicleStatus.OUT_OF_SERVICE)
        incident = self.report(requestId="req-2").json()["incident"]
        self.act(incident["id"], self.staff, action="RESOLVE", outcome="SENT_FOR_REPAIR", notes="Written off.")
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.status, VehicleStatus.OUT_OF_SERVICE)

    # -- cross-device sync ---------------------------------------------------------

    def test_incident_writes_move_the_incidents_scope(self) -> None:
        self.assertEqual(scopes_for_path("/api/incidents"), ("incidents",))
        self.assertEqual(scopes_for_path("/api/incidents/abc"), ("incidents",))
        # An upload alone changes no record anyone is looking at.
        self.assertEqual(scopes_for_path("/api/incidents/photo"), ())

        with self.captureOnCommitCallbacks(execute=True):
            self.report()
        self.assertGreater(SyncStamp.objects.get(scope="incidents").revision, 0)
