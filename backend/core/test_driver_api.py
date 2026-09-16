"""Driver-facing API contracts: location, vehicles, trips, and profile."""

import json
from datetime import datetime, timedelta
from unittest.mock import patch

from django.test import Client, TestCase
from django.utils import timezone

from .auth import create_token
from .models import (
    LocationLog,
    Order,
    OrderStatus,
    Replacement,
    Trip,
    TripDropPoint,
    TripStatus,
    User,
    Vehicle,
    VehicleType,
    Warehouse,
)
from .test_support import Role, Driver



class DriverLocationAccuracyContractTests(TestCase):
    def test_delayed_upload_cannot_replace_a_newer_fix(self) -> None:
        recent = timezone.now() - timedelta(seconds=2)
        for timestamp, latitude in [(recent, 10.68), (recent - timedelta(minutes=1), 10.67)]:
            response = self.client.post('/api/driver/location',
                data={'latitude': latitude, 'longitude': 122.95, 'accuracy': 10, 'recordedAt': int(timestamp.timestamp() * 1000)},
                content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.token}')
            self.assertEqual(response.status_code, 200)
        saved = LocationLog.objects.get(driver=self.driver)
        self.assertEqual(saved.latitude, 10.68)
        self.assertAlmostEqual(saved.recorded_at.timestamp(), recent.timestamp(), places=2)

    def test_offline_fix_keeps_capture_time_and_future_fix_is_rejected(self) -> None:
        captured = timezone.now() - timedelta(minutes=5)
        response = self.client.post('/api/driver/location',
            data={'latitude': 10.68, 'longitude': 122.95, 'accuracy': 10, 'recordedAt': int(captured.timestamp() * 1000)},
            content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.token}')
        self.assertEqual(response.status_code, 200)
        self.assertAlmostEqual(LocationLog.objects.get(driver=self.driver).recorded_at.timestamp(), captured.timestamp(), places=2)
        response = self.client.post('/api/driver/location',
            data={'latitude': 10.69, 'longitude': 122.95, 'accuracy': 10, 'recordedAt': int((timezone.now() + timedelta(hours=1)).timestamp() * 1000)},
            content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.token}')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(LocationLog.objects.get(driver=self.driver).latitude, 10.68)

    def setUp(self) -> None:
        self.client = Client()
        self.driver = User.objects.create(
            email="accurate.location.driver@example.com",
            password="hashed",
            name="Accurate Location Driver",
            role="DRIVER",
            is_active=True,
        )
        self.token = create_token(
            {
                "userId": self.driver.id,
                "email": self.driver.email,
                "name": self.driver.name,
                "role": "DRIVER",
                "type": "staff",
            }
        )

    def test_inaccurate_sample_cannot_overwrite_reliable_driver_location(self) -> None:
        reliable = self.client.post(
            "/api/driver/location",
            data={"latitude": 10.6765, "longitude": 122.9509, "accuracy": 15},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(reliable.status_code, 200)

        inaccurate = self.client.post(
            "/api/driver/location",
            data={"latitude": 10.7000, "longitude": 123.0000, "accuracy": 500},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(inaccurate.status_code, 400)

        latest = LocationLog.objects.get(driver=self.driver)
        self.assertEqual(latest.latitude, 10.6765)
        self.assertEqual(latest.longitude, 122.9509)
        self.assertEqual(latest.accuracy, 15)

    def test_degraded_but_usable_gps_sample_updates_the_driver_location(self) -> None:
        # After the client grace period, 100–300m GPS estimates keep the vehicle moving.
        response = self.client.post(
            "/api/driver/location",
            data={"latitude": 10.6800, "longitude": 122.9600, "accuracy": 250},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 200)
        latest = LocationLog.objects.get(driver=self.driver)
        self.assertEqual(latest.latitude, 10.6800)
        self.assertEqual(latest.longitude, 122.9600)
        self.assertEqual(latest.accuracy, 250)

    def test_each_driver_account_keeps_its_own_latest_location(self) -> None:
        other_driver = User.objects.create(
            email="other.location.driver@example.com",
            password="hashed",
            name="Other Location Driver",
            role="DRIVER",
            is_active=True,
        )
        other_token = create_token(
            {
                "userId": other_driver.id,
                "email": other_driver.email,
                "name": other_driver.name,
                "role": "DRIVER",
                "type": "staff",
            }
        )

        first_response = self.client.post(
            "/api/driver/location",
            # A supplied driverId must never override the authenticated account owner.
            data={"driverId": other_driver.id, "latitude": 10.6765, "longitude": 122.9509, "accuracy": 15},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        second_response = self.client.post(
            "/api/driver/location",
            data={"latitude": 10.7000, "longitude": 123.0000, "accuracy": 20},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {other_token}",
        )

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(second_response.status_code, 200)
        self.assertEqual(LocationLog.objects.filter(driver=self.driver).count(), 1)
        self.assertEqual(LocationLog.objects.filter(driver=other_driver).count(), 1)
        self.assertEqual(LocationLog.objects.get(driver=self.driver).latitude, 10.6765)
        self.assertEqual(LocationLog.objects.get(driver=other_driver).latitude, 10.7000)
        self.assertNotEqual(
            first_response.json()["locationLogId"],
            second_response.json()["locationLogId"],
        )


class DriverVehicleActiveTripValidationTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.staff = User.objects.create(
            email="transport.admin@example.com",
            password="hashed",
            name="Transport Warehouse Operator",
            role="WAREHOUSE_STAFF",
            is_active=True,
        )
        self.driver = User.objects.create(
            email="active.trip.driver@example.com",
            password="hashed",
            name="Active Trip Driver",
            phone="09171234567",
            role="DRIVER",
            license_number="D09-22-000984",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )
        self.vehicle = Vehicle.objects.create(
            license_plate="ACTIVE-TRIP-001",
            type=VehicleType.TRUCK,
            driver=self.driver,
        )
        self.trip = Trip.objects.create(
            trip_number="TRIP-ACTIVE-UNASSIGN-001",
            driver=self.driver,
            vehicle=self.vehicle,
            status=TripStatus.IN_PROGRESS,
            actual_start_at=timezone.now(),
        )
        self.token = create_token(
            {
                "userId": self.staff.id,
                "email": self.staff.email,
                "name": self.staff.name,
                "role": "WAREHOUSE_STAFF",
                "type": "staff",
            }
        )

    def test_vehicle_update_rejects_unassignment_during_active_trip(self) -> None:
        response = self.client.patch(
            "/api/vehicles",
            data={"id": self.vehicle.id, "driverId": ""},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn(self.trip.trip_number, response.json()["error"])
        self.assertIn("Complete or cancel the trip", response.json()["error"])
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.driver_id, self.driver.id)

    def test_driver_update_allows_unassignment_after_trip_is_closed(self) -> None:
        self.trip.status = TripStatus.COMPLETED
        self.trip.actual_end_at = timezone.now()
        self.trip.save(update_fields=["status", "actual_end_at", "updated_at"])

        response = self.client.put(
            "/api/drivers",
            data={"id": self.driver.id, "vehicleId": ""},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.vehicle.refresh_from_db()
        self.assertIsNone(self.vehicle.driver_id)

    def test_driver_status_update_persists_and_is_returned(self) -> None:
        response = self.client.put(
            "/api/drivers",
            data={"id": self.driver.id, "status": "OnLeave", "vehicleId": self.vehicle.id},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["driver"]["status"], "ON_LEAVE")
        self.driver.refresh_from_db()
        self.assertEqual(self.driver.driver_status, "ON_LEAVE")

        list_response = self.client.get(
            "/api/drivers?includeSample=true",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(list_response.status_code, 200, list_response.content)
        row = next(item for item in list_response.json()["drivers"] if item["id"] == self.driver.id)
        self.assertEqual(row["status"], "ON_LEAVE")


class DriverTripsApiContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")

        self.driver_user = User.objects.create(
            email="driver.trips@example.com",
            password="hashed",
            name="Driver Trips",
            role=self.driver_role,
            is_active=True,
        )
        self.other_driver_user = User.objects.create(
            email="driver.trips.other@example.com",
            password="hashed",
            name="Driver Trips Other",
            role=self.driver_role,
            is_active=True,
        )
        self.admin_user = User.objects.create(
            email="driver.trips.admin@example.com",
            password="hashed",
            name="Driver Trips Admin",
            role=self.admin_role,
            is_active=True,
        )

        self.driver = Driver.objects.create(
            user=self.driver_user,
            license_number="LIC-TRIPS-001",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )
        self.other_driver = Driver.objects.create(
            user=self.other_driver_user,
            license_number="LIC-TRIPS-002",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )

        self.vehicle = Vehicle.objects.create(
            license_plate="TRIPS-001",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
        )
        self.other_vehicle = Vehicle.objects.create(
            license_plate="TRIPS-002",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
        )

        self.driver_token = create_token(
            {
                "userId": self.driver_user.id,
                "email": self.driver_user.email,
                "name": self.driver_user.name,
                "role": "DRIVER",
                "type": "staff",
            }
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

    def test_driver_trips_returns_only_authenticated_driver_trips_with_latest_location(self) -> None:
        own_trip = Trip.objects.create(
            trip_number="TRP-DRIVER-001",
            driver=self.driver,
            vehicle=self.vehicle,
            status=TripStatus.IN_PROGRESS,
        )
        Trip.objects.create(
            trip_number="TRP-DRIVER-OTHER-001",
            driver=self.other_driver,
            vehicle=self.other_vehicle,
            status=TripStatus.PLANNED,
        )

        LocationLog.objects.create(
            driver=self.driver,
            trip=own_trip,
            latitude=10.1001,
            longitude=123.9001,
            recorded_at=timezone.now() - timedelta(minutes=3),
        )
        latest_log = LocationLog.objects.create(
            driver=self.driver,
            trip=own_trip,
            latitude=10.2002,
            longitude=123.8002,
            recorded_at=timezone.now(),
        )

        response = self.client.get(
            "/api/driver/trips",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(len(payload["trips"]), 1)

        row = payload["trips"][0]
        self.assertEqual(row["id"], own_trip.id)
        self.assertEqual(row["tripNumber"], own_trip.trip_number)
        self.assertIn("dropPoints", row)
        self.assertIn("driver", row)
        self.assertIn("vehicle", row)
        self.assertIsNotNone(row["latestLocation"])
        self.assertEqual(row["latestLocation"]["latitude"], float(latest_log.latitude))
        self.assertEqual(row["latestLocation"]["longitude"], float(latest_log.longitude))

    def test_driver_trip_sums_cash_from_successfully_delivered_orders(self) -> None:
        trip = Trip.objects.create(
            trip_number="TRP-DRIVER-CASH-001",
            driver=self.driver,
            vehicle=self.vehicle,
            status=TripStatus.IN_PROGRESS,
            total_drop_points=3,
        )
        orders = [
            Order.objects.create(order_number=f"ORD-CASH-{index}", subtotal=amount, total_amount=amount)
            for index, amount in enumerate((100.0, 200.0, 300.0), start=1)
        ]
        for index, order in enumerate(orders, start=1):
            if index < 3:
                order.status = OrderStatus.DELIVERED
                order.save(update_fields=["status", "updated_at"])
            TripDropPoint.objects.create(
                trip=trip,
                order=order,
                sequence=index,
                status="COMPLETED" if index < 3 else "PENDING",
                location_name=f"Cash Stop {index}",
                address=f"Address {index}",
                city="Bacolod",
                province="Negros Occidental",
                zip_code="6100",
            )

        response = self.client.get(
            "/api/driver/trips",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 200)
        row = next(item for item in response.json()["trips"] if item["id"] == trip.id)
        # Cash remains unfinalized until the whole trip is explicitly closed.
        self.assertEqual(row["cashCollectedTotal"], 0.0)

        trip.drop_points.filter(order=orders[2]).update(status="COMPLETED")
        orders[2].status = OrderStatus.DELIVERED
        orders[2].save(update_fields=["status", "updated_at"])
        trip.status = TripStatus.COMPLETED
        trip.save(update_fields=["status", "updated_at"])
        replacement_order = Order.objects.create(
            order_number="RPL-CASH-EXCLUDED-001",
            subtotal=999,
            total_amount=999,
            status=OrderStatus.DELIVERED,
        )
        TripDropPoint.objects.create(
            trip=trip,
            order=replacement_order,
            sequence=4,
            status="COMPLETED",
            location_name="Replacement Stop",
            address="Replacement Address",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
        )
        # The finalized total includes post-delivery additions such as a verified
        # empties shortfall, while free replacement deliveries remain excluded.
        # Deductions are already stored in order.total_amount.
        with patch(
            "core.views_api.empties_adjustments_for_orders",
            return_value={orders[2].id: {"amount": 50.0}},
        ):
            completed_response = self.client.get(
                "/api/driver/trips",
                HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
            )

        completed_row = next(item for item in completed_response.json()["trips"] if item["id"] == trip.id)
        self.assertEqual(completed_row["cashCollectedTotal"], 650.0)

    def test_driver_trips_forbidden_for_non_driver_staff(self) -> None:
        response = self.client.get(
            "/api/driver/trips",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(response.status_code, 403)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Forbidden")

    def test_driver_trip_uses_latest_unlinked_driver_log_as_gps_fallback(self) -> None:
        trip = Trip.objects.create(
            trip_number="TRP-DRIVER-FALLBACK-001",
            driver=self.driver,
            vehicle=self.vehicle,
            status=TripStatus.PLANNED,
        )
        latest_log = LocationLog.objects.create(
            driver=self.driver,
            trip=None,
            latitude=10.3155,
            longitude=123.8855,
            accuracy=18,
        )

        response = self.client.get(
            "/api/driver/trips",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 200)
        row = next(item for item in response.json()["trips"] if item["id"] == trip.id)
        self.assertEqual(row["latestLocation"]["latitude"], latest_log.latitude)
        self.assertEqual(row["latestLocation"]["longitude"], latest_log.longitude)
        self.assertEqual(row["latestLocation"]["accuracy"], latest_log.accuracy)

    def test_driver_trip_never_falls_back_to_another_driver_location(self) -> None:
        trip = Trip.objects.create(
            trip_number="TRP-DRIVER-NO-LOCATION-001",
            driver=self.driver,
            vehicle=self.vehicle,
            status=TripStatus.PLANNED,
        )
        LocationLog.objects.create(
            driver=self.other_driver,
            trip=None,
            latitude=10.9999,
            longitude=122.9999,
            accuracy=12,
        )

        response = self.client.get(
            "/api/driver/trips",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 200)
        row = next(item for item in response.json()["trips"] if item["id"] == trip.id)
        # No own saved GPS means unavailable; another account is never a fallback.
        self.assertIsNone(row["latestLocation"])


class DriverProfileApiContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")

        self.driver_user = User.objects.create(
            email="profile.driver@example.com",
            password="hashed",
            name="Profile Driver",
            phone="+1-555-2222",
            role=self.driver_role,
            is_active=True,
        )
        self.admin_user = User.objects.create(
            email="profile.admin@example.com",
            password="hashed",
            name="Profile Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.driver = Driver.objects.create(
            user=self.driver_user,
            license_number="LIC-PROFILE-001",
            license_type="C",
            license_expiry=timezone.now() + timedelta(days=365),
            emergency_contact="Old Contact",
            is_active=True,
        )

        self.driver_token = create_token(
            {
                "userId": self.driver_user.id,
                "email": self.driver_user.email,
                "name": self.driver_user.name,
                "role": "DRIVER",
                "type": "staff",
            }
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

    def test_driver_profile_get_returns_driver_and_user_shape(self) -> None:
        response = self.client.get(
            "/api/driver/profile",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertIn("driver", payload)
        self.assertEqual(payload["driver"]["id"], self.driver.id)
        self.assertEqual(payload["driver"]["user"]["id"], self.driver_user.id)
        self.assertEqual(payload["driver"]["user"]["email"], self.driver_user.email)

    def test_driver_profile_put_updates_avatar(self) -> None:
        response = self.client.put(
            "/api/driver/profile",
            data={"avatar": "/uploads/customers/driver-avatar.png"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 200)
        self.driver_user.refresh_from_db()
        self.assertEqual(self.driver_user.avatar, "/uploads/customers/driver-avatar.png")
        self.assertEqual(response.json()["driver"]["avatar"], self.driver_user.avatar)

    def test_driver_profile_put_updates_gmail_and_refreshes_token(self) -> None:
        response = self.client.put(
            "/api/driver/profile",
            data={"email": "updated.profile.driver@gmail.com"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.driver_user.refresh_from_db()
        self.assertEqual(self.driver_user.email, "updated.profile.driver@gmail.com")
        self.assertEqual(response.json()["driver"]["email"], self.driver_user.email)
        self.assertTrue(response.json().get("token"))

    def test_driver_profile_put_updates_driver_and_user_fields(self) -> None:
        response = self.client.put(
            "/api/driver/profile",
            data={
                "name": "Updated Driver Name",
                "firstName": "Updated",
                "lastName": "Driver",
                "phone": "09171234567",
                "avatar": "/uploads/avatars/new.png",
                "emergencyContact": "Updated Emergency Contact",
                "licenseNumber": "D09-22-000984",
                "licenseType": "C",
                "licenseExpiry": "2030-01-15T10:00:00Z",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["driver"]["user"]["name"], "Updated Driver")
        self.assertEqual(payload["driver"]["user"]["firstName"], "Updated")
        self.assertEqual(payload["driver"]["user"]["lastName"], "Driver")
        self.assertEqual(payload["driver"]["user"]["phone"], "09171234567")
        self.assertEqual(payload["driver"]["licenseNumber"], "D09-22-000984")
        self.assertEqual(payload["driver"]["licenseType"], "C")
        self.assertIsNone(payload["driver"]["licensePhotoUrl"])

        self.driver.refresh_from_db()
        self.driver_user.refresh_from_db()
        self.assertEqual(self.driver.emergency_contact, "Updated Emergency Contact")
        self.assertEqual(self.driver.license_number, "D09-22-000984")
        self.assertEqual(self.driver.license_type, "C")
        self.assertIsNone(self.driver.license_photo_url)
        self.assertEqual(self.driver_user.name, "Updated Driver")
        self.assertEqual(self.driver_user.first_name, "Updated")
        self.assertEqual(self.driver_user.last_name, "Driver")
        self.assertEqual(self.driver_user.phone, "09171234567")
        self.assertEqual(self.driver_user.avatar, "/uploads/avatars/new.png")
        self.assertEqual(self.driver.license_expiry.year, 2030)

    def test_driver_profile_rejects_invalid_phone_and_past_license_expiry(self) -> None:
        invalid_phone = self.client.put(
            "/api/driver/profile",
            data={"phone": "not-a-number"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(invalid_phone.status_code, 400)
        self.assertEqual(invalid_phone.json()["error"], "Please enter a valid Philippine mobile number")

        expired_license = self.client.put(
            "/api/driver/profile",
            data={"licenseExpiry": "2020-01-01"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(expired_license.status_code, 400)
        self.assertEqual(expired_license.json()["error"], "License expiration date cannot be in the past.")

        invalid_restriction = self.client.put(
            "/api/driver/profile",
            data={"licenseType": "3"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(invalid_restriction.status_code, 400)
        self.assertEqual(
            invalid_restriction.json()["error"],
            "Restrictions must be one of: A, A1, B, B1, B2, C, D, BE, CE",
        )

    def test_driver_profile_forbidden_for_non_driver_staff(self) -> None:
        response = self.client.get(
            "/api/driver/profile",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(response.status_code, 403)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Forbidden")
