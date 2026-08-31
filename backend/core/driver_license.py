"""LTO driver's license restriction codes matched against the vehicle being driven.

A driver's registered restriction code says which vehicles they are legally allowed
to operate. The rules live here (and are mirrored in
src/lib/driver-license-restrictions.ts) so every "assign a driver" surface — vehicle
assignment, trip creation, changing a trip's driver, and starting a trip — rejects an
unqualified driver with the same message, instead of each endpoint inventing its own.

Only TRUCK and TRICYCLE can be registered today, and those are the two types the
requirement covers: a truck needs Code C, a tricycle needs Code A1, and a code good
for the heavier vehicle is good for the lighter one.
"""
from __future__ import annotations

from typing import Any

# Required code per vehicle type, plus the codes that also cover it.
#
# TRUCK is Code C: C is goods vehicles above 3,500 kg GVW, and every truck class this
# system can register carries 2,500 kg or more of payload, so all of them clear that
# threshold once the vehicle's own weight is counted. CE (heavy articulated) covers
# the truck it tows, so it is accepted too.
#
# TRICYCLE is Code A1, the LTO code for motorized tricycles, and the codes are treated
# as a seniority ladder: a driver cleared for the heavier vehicle is also cleared for
# the lighter one, so every code that qualifies for a truck qualifies for a tricycle
# too. A1 stays the code the rejection message names, since it is the entry-level
# qualification for the vehicle.
#
# Only the two types the system can actually register are ruled on. Legacy VAN, CAR
# and MOTORCYCLE rows are deliberately left unruled: no new one can be created, and
# inventing a code requirement for them would invalidate existing assignments.
TRUCK_CODES = {"C", "CE"}
TRICYCLE_CODES = {"A1"} | TRUCK_CODES

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
    return normalize_license_code(license_code) in rule["accepted"]


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
