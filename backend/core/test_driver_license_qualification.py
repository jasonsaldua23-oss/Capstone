"""A driver may only be put on a vehicle their LTO restriction code covers."""
import json
from datetime import timedelta
from unittest.mock import patch

from django.test import RequestFactory, TestCase
from django.utils import timezone

from .driver_license import driver_vehicle_license_error, license_code_vehicle_error, is_valid_license_codes, normalize_license_codes
from .models import RoleType, User, Vehicle, VehicleStatus, VehicleType
from .views_api import drivers_collection, vehicles_collection

NEEDS_C = "Driver is not qualified to drive this vehicle. License Code C is required."
NEEDS_A1 = "Driver is not qualified to drive this vehicle. License Code A1 is required."


class VehicleModelRequiredTests(TestCase):
    """Required vehicle models must also be enforced when calling the API directly."""

    def submit(self, method, payload):
        request = getattr(RequestFactory(), method)(
            "/api/vehicles", data=json.dumps(payload), content_type="application/json"
        )
        with patch("core.views_api._require_staff", return_value=({"role": RoleType.WAREHOUSE_STAFF}, None)), patch(
            "core.views_api._create_staff_notifications"
        ):
            return vehicles_collection(request)

    def test_create_rejects_missing_empty_and_whitespace_models(self):
        for extra in ({}, {"model": None}, {"model": ""}, {"model": "  \t "}):
            with self.subTest(extra=extra):
                response = self.submit("post", {"licensePlate": "MOD-123", "type": "TRUCK", **extra})
                self.assertEqual(response.status_code, 400)
                self.assertEqual(json.loads(response.content)["error"], "Model is required")
        self.assertFalse(Vehicle.objects.filter(license_plate="MOD-123").exists())

    def test_create_and_edit_accept_and_trim_a_model(self):
        response = self.submit("post", {"licensePlate": "MOD-123", "type": "TRUCK", "model": "  Elf  "})
        self.assertEqual(response.status_code, 201)
        vehicle = Vehicle.objects.get(license_plate="MOD-123")
        self.assertEqual(vehicle.model, "Elf")
        self.assertEqual(self.submit("patch", {"id": vehicle.id, "model": " Canter "}).status_code, 200)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.model, "Canter")

    def test_edit_cannot_clear_model_but_partial_updates_keep_it(self):
        vehicle = Vehicle.objects.create(license_plate="MOD-123", type="TRUCK", model="Elf")
        for model in (None, "", "  \t "):
            with self.subTest(model=model):
                self.assertEqual(self.submit("patch", {"id": vehicle.id, "model": model}).status_code, 400)
                vehicle.refresh_from_db()
                self.assertEqual(vehicle.model, "Elf")
        self.assertEqual(self.submit("patch", {"id": vehicle.id, "isActive": False}).status_code, 200)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.model, "Elf")
        self.assertFalse(vehicle.is_active)


class DriverLicenseRuleTests(TestCase):
    def test_code_a_cannot_drive_tricycle_or_truck(self):
        self.assertEqual(license_code_vehicle_error("A", "TRICYCLE"), NEEDS_A1)
        self.assertEqual(license_code_vehicle_error("A", "TRUCK"), NEEDS_C)

    def test_a_truck_needs_code_c_and_a_tricycle_needs_code_a1(self):
        self.assertIsNone(license_code_vehicle_error("C", "TRUCK"))
        self.assertIsNone(license_code_vehicle_error("A1", "TRICYCLE"))

    def test_trailer_code_does_not_imply_code_c(self):
        self.assertEqual(license_code_vehicle_error("CE", "TRUCK"), NEEDS_C)

    def test_truck_codes_do_not_imply_tricycle_entitlement(self):
        for code in ("C", "CE"):
            self.assertEqual(license_code_vehicle_error(code, "TRICYCLE"), NEEDS_A1)

    def test_multiple_codes_are_normalized_and_match_explicit_entitlements(self):
        self.assertEqual(normalize_license_codes(" a1, c, A1 "), "A1,C")
        for codes in ("A1,C", " c a1 ", "A1,C,CE"):
            self.assertTrue(is_valid_license_codes(codes))
            self.assertIsNone(license_code_vehicle_error(codes, "TRUCK"))
            self.assertIsNone(license_code_vehicle_error(codes, "TRICYCLE"))
        for codes in ("", "A1,INVALID", "C,3", "A1C", ",C", "C,"):
            self.assertFalse(is_valid_license_codes(codes))
            self.assertEqual(license_code_vehicle_error(codes, "TRUCK"), NEEDS_C)

    def test_codes_that_qualify_for_neither_vehicle_are_rejected_for_a_tricycle(self):
        for code in ("A", "B", "B1", "B2", "D", "BE"):
            self.assertEqual(license_code_vehicle_error(code, "TRICYCLE"), NEEDS_A1, code)

    def test_other_non_c_codes_are_also_rejected_for_trucks(self):
        for code in ("A1", "B", "B1", "B2", "D", "BE"):
            self.assertEqual(license_code_vehicle_error(code, "TRUCK"), NEEDS_C, code)

    def test_blank_or_unruled_vehicle_type_is_left_to_other_checks(self):
        self.assertIsNone(license_code_vehicle_error("A", ""))
        self.assertIsNone(license_code_vehicle_error("A", "HOVERCRAFT"))
        # Legacy types the system can no longer create stay unruled on purpose.
        for legacy_type in ("VAN", "CAR", "MOTORCYCLE"):
            self.assertIsNone(license_code_vehicle_error("B", legacy_type), legacy_type)


class DriverVehicleAssignmentApiTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        # Fleet assignments are warehouse operations; exercise the policy's
        # authorized actor rather than an administrator-only fixture.
        self.admin_auth = {"type": "staff", "role": RoleType.WAREHOUSE_STAFF, "userId": "warehouse-1", "name": "Warehouse Operator"}
        self.driver_a = User.objects.create(
            email="code-a@example.com",
            password="x",
            name="Code A Driver",
            role=RoleType.DRIVER,
            phone="+639171234567",
            license_number="D09-22-000984",
            license_type="A",
            license_expiry=timezone.now() + timedelta(days=365),
        )
        self.driver_c = User.objects.create(
            email="code-c@example.com",
            password="x",
            name="Code C Driver",
            role=RoleType.DRIVER,
            phone="+639171234568",
            license_number="D09-22-000985",
            license_type="C",
            license_expiry=timezone.now() + timedelta(days=365),
        )
        self.truck = Vehicle.objects.create(
            license_plate="TRK-0001",
            type=VehicleType.TRUCK,
            classification="LIGHT_DUTY",
            status=VehicleStatus.AVAILABLE,
        )
        self.tricycle = Vehicle.objects.create(
            license_plate="TRI-0001",
            type=VehicleType.TRICYCLE,
            classification="LIGHT_DUTY",
            status=VehicleStatus.AVAILABLE,
        )

    def _update(self, view, payload, method="put"):
        request = getattr(self.factory, method)(
            "/", data=json.dumps(payload), content_type="application/json"
        )
        with patch("core.views_api._require_staff", return_value=(self.admin_auth, None)), patch(
            "core.views_api._create_staff_notifications"
        ):
            return view(request)

    def _patch_vehicle(self, payload):
        return self._update(vehicles_collection, payload, method="patch")

    def _put_driver(self, payload):
        return self._update(drivers_collection, payload)

    def test_helper_matches_driver_against_vehicle_row(self):
        self.assertEqual(driver_vehicle_license_error(self.driver_a, self.truck), NEEDS_C)
        self.assertEqual(driver_vehicle_license_error(self.driver_a, self.tricycle), NEEDS_A1)
        self.assertIsNone(driver_vehicle_license_error(self.driver_c, self.truck))
        self.assertEqual(driver_vehicle_license_error(self.driver_c, self.tricycle), NEEDS_A1)

    def test_assigning_code_a_driver_to_truck_is_rejected(self):
        response = self._patch_vehicle({"id": self.truck.id, "driverId": self.driver_a.id})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(json.loads(response.content)["error"], NEEDS_C)
        self.truck.refresh_from_db()
        self.assertIsNone(self.truck.driver_id)

    def test_assigning_code_a_driver_to_tricycle_is_rejected(self):
        response = self._patch_vehicle({"id": self.tricycle.id, "driverId": self.driver_a.id})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(json.loads(response.content)["error"], NEEDS_A1)
        self.tricycle.refresh_from_db()
        self.assertIsNone(self.tricycle.driver_id)

    def test_assigning_code_c_driver_to_truck_succeeds(self):
        response = self._patch_vehicle({"id": self.truck.id, "driverId": self.driver_c.id})
        self.assertEqual(response.status_code, 200)
        self.truck.refresh_from_db()
        self.assertEqual(self.truck.driver_id, self.driver_c.id)

    def test_assigning_vehicle_from_the_driver_side_is_rejected_too(self):
        response = self._put_driver({"id": self.driver_a.id, "vehicleId": self.truck.id})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(json.loads(response.content)["error"], NEEDS_C)
        self.truck.refresh_from_db()
        self.assertIsNone(self.truck.driver_id)

    def test_downgrading_the_code_of_an_assigned_driver_is_rejected(self):
        self.truck.driver = self.driver_c
        self.truck.save(update_fields=["driver"])
        response = self._put_driver({"id": self.driver_c.id, "licenseType": "A"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("not qualified", json.loads(response.content)["error"])
        self.driver_c.refresh_from_db()
        self.assertEqual(self.driver_c.license_type, "C")

    def test_combined_codes_can_be_saved_and_used_for_assignment(self):
        response = self._put_driver({"id": self.driver_c.id, "licenseType": " a1, c, A1 ", "vehicleId": self.tricycle.id})
        self.assertEqual(response.status_code, 200)
        self.driver_c.refresh_from_db()
        self.tricycle.refresh_from_db()
        self.assertEqual(self.driver_c.license_type, "A1,C")
        self.assertEqual(self.tricycle.driver_id, self.driver_c.id)
        self.assertEqual(self._put_driver({"id": self.driver_c.id, "licenseType": "C"}).status_code, 400)

    def test_invalid_combination_does_not_update_driver(self):
        response = self._put_driver({"id": self.driver_c.id, "licenseType": "C,INVALID"})
        self.assertEqual(response.status_code, 400)
        self.driver_c.refresh_from_db()
        self.assertEqual(self.driver_c.license_type, "C")
