"""LTO driver's license restriction codes matched against the vehicle being driven.

A driver's recorded codes are checked against the basic fleet assignment policy.
The rules live here (and are mirrored in
src/lib/driver-license-restrictions.ts) so every "assign a driver" surface — vehicle
assignment, trip creation, changing a trip's driver, and starting a trip — rejects an
unqualified driver with the same message, instead of each endpoint inventing its own.

Basic fleet policy: trucks require C and tricycles require A1. Staff verify the
truck's registered GVW separately; payload capacity does not establish GVW.
"""
from __future__ import annotations

import re
from typing import Any
from .api_constants import DRIVER_RESTRICTIONS

# Fix: codes are explicit entitlements, not a heavier-to-lighter hierarchy.
# LTO categories: https://lto.gov.ph/wp-content/uploads/2023/09/14-CC2024-DL-CODES.pdf
TRUCK_CODES = {"C"}
TRICYCLE_CODES = {"A1"}


def parse_license_codes(value: Any) -> list[str]:
    """Keep the existing string field compatible with single or multiple codes."""
    normalized = str(value or "").strip().upper()
    return list(dict.fromkeys(re.split(r"[,\s]+", normalized))) if normalized else []


def is_valid_license_codes(value: Any) -> bool:
    codes = parse_license_codes(value)
    return bool(codes) and all(code in DRIVER_RESTRICTIONS for code in codes)


def normalize_license_codes(value: Any) -> str:
    return ",".join(parse_license_codes(value))


VEHICLE_LICENSE_RULES: dict[str, dict[str, Any]] = {
    "TRUCK": {"required": "C", "accepted": TRUCK_CODES},
    "TRICYCLE": {"required": "A1", "accepted": TRICYCLE_CODES},
}

NOT_QUALIFIED_MESSAGE = "Driver is not qualified to drive this vehicle. License Code {code} is required."


def normalize_license_code(value: Any) -> str:
    return str(value or "").strip().upper()


def get_required_license_code(vehicle_type: Any) -> str | None:
    """The restriction code a driver must hold for this vehicle type, if it is ruled on."""
    rule = VEHICLE_LICENSE_RULES.get(normalize_license_code(vehicle_type))
    return rule["required"] if rule else None


def is_license_code_allowed_for_vehicle(license_code: Any, vehicle_type: Any) -> bool:
    rule = VEHICLE_LICENSE_RULES.get(normalize_license_code(vehicle_type))
    if not rule:
        # An unmapped legacy type is not something this rule can judge, so it is
        # left to the other profile checks rather than blocking every driver.
        return True
    return is_valid_license_codes(license_code) and bool(set(parse_license_codes(license_code)) & rule["accepted"])


def license_code_vehicle_error(license_code: Any, vehicle_type: Any) -> str | None:
    """The exact rejection message for this code/vehicle pair, or None when allowed."""
    required = get_required_license_code(vehicle_type)
    if not required:
        return None
    if is_license_code_allowed_for_vehicle(license_code, vehicle_type):
        return None
    return NOT_QUALIFIED_MESSAGE.format(code=required)


def driver_vehicle_license_error(driver: Any, vehicle: Any) -> str | None:
    """Reason the driver's license does not cover this vehicle, or None when it does."""
    if driver is None or vehicle is None:
        return None
    return license_code_vehicle_error(
        getattr(driver, "license_type", None),
        getattr(vehicle, "type", None),
    )
