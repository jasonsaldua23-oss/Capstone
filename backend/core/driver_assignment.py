"""Driver/vehicle pairing, availability and delivery-count rules."""

from typing import Any

from django.db.models import Count
from django.utils import timezone

from . import views_api as legacy
from .driver_license import is_valid_license_codes
from .api_constants import (
    COMPLETED_DELIVERY_FILTER,
    PHILIPPINE_DRIVER_LICENSE_REGEX,
)
from .models import (
    DriverStatus,
    DropPointStatus,
    DropPointType,
    Trip,
    TripDropPoint,
    TripStatus,
    User,
    Vehicle,
)


# Helpers owned by sibling modules. Routing them through views_api keeps
# a single resolution point, so tests that patch there still apply.


def _normalize_driver_status(value: Any) -> str:
    return legacy._normalize_driver_status(value)


def _assign_vehicle_to_driver(driver: User, vehicle: Vehicle | None) -> None:
    if not vehicle:
        Vehicle.objects.filter(driver=driver).update(driver=None)
        return

    Vehicle.objects.filter(driver=driver).exclude(id=vehicle.id).update(driver=None)
    vehicle.driver = driver
    vehicle.save(update_fields=["driver", "updated_at"])


def _active_driver_trip(driver: User | None) -> Trip | None:
    """Return the driver's currently running delivery trip, if one exists."""
    if driver is None:
        return None
    return (
        Trip.objects.filter(driver=driver, status=TripStatus.IN_PROGRESS)
        .order_by("-actual_start_at", "-created_at")
        .first()
    )


def _annotate_driver_delivery_counts(qs):
    """Add `completed_delivery_count` to a queryset of driver Users."""
    return qs.annotate(
        completed_delivery_count=Count("trips__drop_points", filter=COMPLETED_DELIVERY_FILTER, distinct=True)
    )


def _driver_delivery_count(driver: User | None) -> int:
    """Deliveries completed by one driver, for the single-record endpoints."""
    if driver is None:
        return 0
    return TripDropPoint.objects.filter(
        trip__driver=driver,
        status=DropPointStatus.COMPLETED,
        drop_point_type=DropPointType.DELIVERY,
    ).count()


def _driver_unassignment_error(driver: User | None) -> str | None:
    """Explain why removing a driver from their vehicle would disrupt delivery."""
    active_trip = _active_driver_trip(driver)
    if active_trip is None:
        return None
    trip_number = str(active_trip.trip_number or active_trip.id).strip()
    return (
        f"Driver cannot be unassigned while delivery trip {trip_number} is in progress. "
        "Complete or cancel the trip before removing the driver from the vehicle."
    )


def _driver_assignment_blocker(driver: User) -> str | None:
    """Reason a driver cannot be assigned to a vehicle, or None when assignable.

    Mirrors src/lib/driver-eligibility.ts so an incomplete or invalid license
    profile is rejected server-side too, not just hidden in the UI. The
    licence-code-vs-vehicle rule lives in driver_license.py and is applied by the
    callers, which know the target vehicle.
    """
    if driver is None:
        return "Driver not found"
    if getattr(driver, "is_active", True) is False:
        return "Driver account is inactive"
    driver_status = _normalize_driver_status(getattr(driver, "driver_status", DriverStatus.ACTIVE))
    if driver_status == DriverStatus.ON_LEAVE:
        return "Driver is on leave"
    if driver_status == DriverStatus.INACTIVE:
        return "Driver status is inactive"
    phone = str(getattr(driver, "phone", "") or "").strip()
    license_number = str(getattr(driver, "license_number", "") or "").strip().upper()
    license_type = str(getattr(driver, "license_type", "") or "").strip().upper()
    license_expiry = getattr(driver, "license_expiry", None)
    if not phone or not license_number or not license_type or not license_expiry:
        return "Driver profile is incomplete (phone, license number, restriction and expiry are required)"
    if not PHILIPPINE_DRIVER_LICENSE_REGEX.match(license_number):
        return "Driver's license number must follow the format X00-00-000000 (e.g. D09-22-000984)."
    if not is_valid_license_codes(license_type):
        return "Driver's license restrictions must contain one or more of: A, A1, B, B1, B2, C, D, BE, CE"
    if timezone.localtime(license_expiry).date() < timezone.localdate():
        return "Driver's license has expired"
    return None
