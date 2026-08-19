from __future__ import annotations
from typing import Any, Tuple


VEHICLE_CAPACITY_CONFIG: dict[str, dict[str, float]] = {
    "TRUCK": {
        "LIGHT_DUTY": 2500.0,
        "MEDIUM_DUTY": 5000.0,
        "HEAVY_DUTY": 10000.0,
    },
    "TRICYCLE": {
        "LIGHT_DUTY": 500.0,
    },
}

VALID_STATUSES = {"AVAILABLE", "IN_USE", "MAINTENANCE", "OUT_OF_SERVICE"}


def get_vehicle_capacity(vehicle_type: str | None, classification: str | None) -> float | None:
    norm_type = str(vehicle_type or "").strip().upper()
    norm_class = str(classification or "").strip().upper()
    type_dict = VEHICLE_CAPACITY_CONFIG.get(norm_type)
    if not type_dict:
        return None
    return type_dict.get(norm_class)


def is_valid_type_classification(vehicle_type: str | None, classification: str | None) -> bool:
    norm_type = str(vehicle_type or "").strip().upper()
    norm_class = str(classification or "").strip().upper()
    type_dict = VEHICLE_CAPACITY_CONFIG.get(norm_type)
    if not type_dict:
        return False
    return norm_class in type_dict


def get_default_classification(vehicle_type: str | None) -> str:
    norm_type = str(vehicle_type or "").strip().upper()
    type_dict = VEHICLE_CAPACITY_CONFIG.get(norm_type)
    if type_dict:
        return next(iter(type_dict.keys()))
    return "LIGHT_DUTY"


def validate_vehicle_payload(body: dict[str, Any], is_create: bool = True) -> Tuple[bool, str | None, dict[str, Any]]:
    license_plate = str(body.get("licensePlate") or "").strip().upper()
    if is_create and not license_plate:
        return False, "License plate is required", {}

    brand = str(body.get("brand") or body.get("make") or "").strip()
    if is_create and not brand:
        return False, "Vehicle Brand / Make is required", {}

    model = str(body.get("model") or "").strip()
    if is_create and not model:
        return False, "Vehicle Model is required", {}

    raw_year = body.get("year") or body.get("modelYear")
    year_val: int | None = None
    if raw_year is not None and str(raw_year).strip() != "":
        try:
            year_val = int(raw_year)
            if year_val < 1900 or year_val > 2100:
                return False, "Please enter a valid model year (between 1900 and 2100)", {}
        except (ValueError, TypeError):
            return False, "Model year must be a valid number", {}
    elif is_create:
        return False, "Model year is required", {}

    vehicle_type = str(body.get("type") or "").strip().upper()
    if is_create and not vehicle_type:
        return False, "Vehicle type is required", {}

    if vehicle_type and vehicle_type not in VEHICLE_CAPACITY_CONFIG:
        # Fallback for existing legacy types if any (e.g. VAN)
        valid_types = list(VEHICLE_CAPACITY_CONFIG.keys())
        return False, f"Invalid vehicle type. Allowed options: {', '.join(valid_types)}", {}

    classification = str(body.get("classification") or "").strip().upper()
    if not classification:
        classification = get_default_classification(vehicle_type)

    if vehicle_type and not is_valid_type_classification(vehicle_type, classification):
        allowed_classes = list(VEHICLE_CAPACITY_CONFIG.get(vehicle_type, {}).keys())
        return False, f"Invalid classification '{classification}' for vehicle type '{vehicle_type}'. Allowed: {', '.join(allowed_classes)}", {}

    capacity = get_vehicle_capacity(vehicle_type, classification)
    if capacity is None and is_create:
        return False, "Could not determine vehicle weight capacity", {}

    status = str(body.get("status") or "AVAILABLE").strip().upper()
    if status not in VALID_STATUSES:
        status = "AVAILABLE"

    is_active = bool(body.get("isActive", True)) if "isActive" in body else True

    validated_data = {
        "license_plate": license_plate,
        "brand": brand,
        "model": model,
        "year": year_val,
        "type": vehicle_type,
        "classification": classification,
        "capacity": capacity,
        "status": status,
        "is_active": is_active,
    }
    return True, None, validated_data
