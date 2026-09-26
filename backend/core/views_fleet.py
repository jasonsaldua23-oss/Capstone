"""Vehicle and driver fleet management endpoints."""

from datetime import datetime, timedelta
from typing import Any

from django.db import transaction
from django.http import HttpRequest, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from . import views_api as legacy
from .api_constants import DRIVER_RESTRICTIONS, DRIVER_STATUSES, PHILIPPINE_PHONE_ERROR
from .api_utils import error as _err, json_body as _json_body, ok as _ok
from .driver_license import license_code_vehicle_error
from .models import DriverStatus, RoleType, User, Vehicle, VehicleStatus


# Resolved through views_api so tests and runtime overrides that rebind
# these names on views_api keep applying here.


def driver_vehicle_license_error(driver: Any, vehicle: Any) -> str | None:
    return legacy.driver_vehicle_license_error(driver, vehicle)


# Helpers owned by sibling modules. Routing them through views_api keeps
# a single resolution point, so tests that patch there still apply.


def _annotate_driver_delivery_counts(qs):
    return legacy._annotate_driver_delivery_counts(qs)


def _assign_vehicle_to_driver(driver: User, vehicle: Vehicle | None) -> None:
    return legacy._assign_vehicle_to_driver(driver, vehicle)


def _create_staff_notifications(*, title: str, message: str, notification_type: str='INVENTORY', reference_type: str | None=None, reference_id: str | None=None) -> None:
    return legacy._create_staff_notifications(title=title, message=message, notification_type=notification_type, reference_type=reference_type, reference_id=reference_id)


def _driver_assignment_blocker(driver: User) -> str | None:
    return legacy._driver_assignment_blocker(driver)


def _driver_unassignment_error(driver: User | None) -> str | None:
    return legacy._driver_unassignment_error(driver)


def _normalize_driver_status(value: Any) -> str:
    return legacy._normalize_driver_status(value)


def _normalize_philippine_phone(value: Any) -> str | None:
    return legacy._normalize_philippine_phone(value)


def _pagination(request: HttpRequest) -> tuple[int, int, int]:
    return legacy._pagination(request)


def _real_drivers(qs):
    return legacy._real_drivers(qs)


def _real_vehicles(qs):
    return legacy._real_vehicles(qs)


def _require_staff(request: HttpRequest) -> tuple[dict[str, Any] | None, JsonResponse | None]:
    return legacy._require_staff(request)


def _require_warehouse_operator(request: HttpRequest) -> tuple[dict[str, Any] | None, JsonResponse | None]:
    return legacy._require_warehouse_operator(request)


def _serialize_driver_vehicle_link(vehicle: Vehicle) -> dict[str, Any]:
    return legacy._serialize_driver_vehicle_link(vehicle)


def _serialize_model(obj: Any, include: dict[str, Any] | None=None, exclude: set[str] | None=None) -> dict[str, Any]:
    return legacy._serialize_model(obj, include, exclude)


def _validate_future_license_expiry(value: Any) -> tuple[datetime | None, str | None]:
    return legacy._validate_future_license_expiry(value)


def _validate_philippine_driver_license(value: Any) -> tuple[str | None, str | None]:
    return legacy._validate_philippine_driver_license(value)


@csrf_exempt
@require_http_methods(["GET", "POST", "PATCH"])
def vehicles_collection(request: HttpRequest) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = _real_vehicles(Vehicle.objects.select_related("driver").all()).order_by("-created_at")
        if request.GET.get("status"):
            qs = qs.filter(status=request.GET.get("status"))
        total = qs.count()
        rows = list(qs[off : off + size])
        vehicles_data = []
        for vehicle in rows:
            row = _serialize_model(vehicle)
            row["drivers"] = [_serialize_driver_vehicle_link(vehicle)] if vehicle.driver_id else []
            vehicles_data.append(row)
        return _ok({"success": True, "vehicles": vehicles_data, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    if str(staff.get("role") or "").strip().upper() != RoleType.WAREHOUSE_STAFF:
        return _err("Only warehouse staff can manage vehicles and assignments", 403)
    body = _json_body(request)
    if request.method == "POST":
        if not body.get("licensePlate") or not body.get("type"):
            return _err("licensePlate and type are required")
        raw_plate = str(body["licensePlate"]).strip()
        if Vehicle.objects.filter(license_plate__iexact=raw_plate).exists():
            return _err(f"A vehicle with plate number {raw_plate} already exists.", 400)
        driver_id = str(body.get("driverId") or "").strip()
        if driver_id:
            driver = User.objects.filter(id=driver_id, role="DRIVER").first()
            if not driver:
                return _err("Driver not found", 404)
            blocker = _driver_assignment_blocker(driver)
            if blocker:
                return _err(f"Driver cannot be assigned: {blocker}", 400)
            license_error = license_code_vehicle_error(driver.license_type, body.get("type"))
            if license_error:
                return _err(license_error, 400)
            existing_veh = Vehicle.objects.filter(driver=driver).first()
            if existing_veh:
                return _err(f"Driver is already assigned to vehicle {existing_veh.license_plate}.", 400)
        v = Vehicle.objects.create(
            license_plate=raw_plate,
            brand=str(body.get("brand") or "").strip(),
            model=str(body.get("model") or "").strip(),
            year=body.get("year"),
            type=body["type"],
            classification=body.get("classification") or "LIGHT_DUTY",
            capacity=body.get("capacity"),
            status=body.get("status") or VehicleStatus.AVAILABLE,
            is_active=bool(body.get("isActive", True)),
        )
        if driver_id:
            _assign_vehicle_to_driver(driver, v)
        actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
        _create_staff_notifications(
            title="Vehicle added",
            message=f"{actor_name} added vehicle {v.license_plate} ({v.type}).",
            notification_type="TRANSPORT",
            reference_type="vehicle",
            reference_id=v.id,
        )
        return _ok({"success": True, "vehicle": _serialize_model(v)}, 201)
    vehicle_id = str(body.get("id", "")).strip()
    if not vehicle_id:
        return _err("id is required")
    try:
        v = Vehicle.objects.get(id=vehicle_id)
    except Vehicle.DoesNotExist:
        return _err("Vehicle not found", 404)
    if "licensePlate" in body:
        new_plate = str(body.get("licensePlate") or "").strip()
        if new_plate and Vehicle.objects.filter(license_plate__iexact=new_plate).exclude(id=v.id).exists():
            return _err(f"A vehicle with plate number {new_plate} already exists.", 400)
    mapping = [("licensePlate", "license_plate"), ("brand", "brand"), ("model", "model"), ("year", "year"), ("type", "type"), ("classification", "classification"), ("capacity", "capacity"), ("status", "status")]
    for key, attr in mapping:
        if key in body:
            setattr(v, attr, body.get(key))
    if "driverId" in body:
        driver_id = str(body.get("driverId") or "").strip()
        if driver_id:
            driver = User.objects.filter(id=driver_id, role="DRIVER").first()
            if not driver:
                return _err("Driver not found", 404)
            if v.driver_id and v.driver_id != driver.id:
                unassignment_error = _driver_unassignment_error(v.driver)
                if unassignment_error:
                    return _err(unassignment_error, 400)
            blocker = _driver_assignment_blocker(driver)
            if blocker:
                return _err(f"Driver cannot be assigned: {blocker}", 400)
            license_error = driver_vehicle_license_error(driver, v)
            if license_error:
                return _err(license_error, 400)
            existing_veh = Vehicle.objects.filter(driver=driver).exclude(id=v.id).first()
            if existing_veh:
                return _err(f"Driver is already assigned to vehicle {existing_veh.license_plate}.", 400)
            _assign_vehicle_to_driver(driver, v)
        else:
            unassignment_error = _driver_unassignment_error(v.driver)
            if unassignment_error:
                return _err(unassignment_error, 400)
            v.driver = None
    if "isActive" in body:
        v.is_active = bool(body.get("isActive"))
    v.save()
    return _ok({"success": True, "vehicle": _serialize_model(v)})


@csrf_exempt
@require_http_methods(["DELETE"])
def vehicle_detail(request: HttpRequest, vehicle_id: str) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    if str(staff.get("role") or "").strip().upper() != RoleType.WAREHOUSE_STAFF:
        return _err("Only warehouse staff can manage vehicles and assignments", 403)
    try:
        v = Vehicle.objects.get(id=vehicle_id)
    except Vehicle.DoesNotExist:
        return _err("Vehicle not found", 404)
    actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
    plate = str(v.license_plate or "").strip()
    v.delete()
    _create_staff_notifications(
        title="Vehicle deleted",
        message=f"{actor_name} deleted vehicle {plate or vehicle_id}.",
        notification_type="TRANSPORT",
        reference_type="vehicle",
        reference_id=vehicle_id,
    )
    return _ok({"success": True})


@csrf_exempt
@require_http_methods(["GET", "POST", "PUT"])
def drivers_collection(request: HttpRequest) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        show_sample = str(request.GET.get("includeSample") or request.GET.get("showSample") or "").strip().lower() in {"1", "true", "yes", "on"}
        base_qs = _annotate_driver_delivery_counts(
            User.objects.prefetch_related("assigned_vehicles").filter(role="DRIVER")
        )
        qs = (base_qs if show_sample else _real_drivers(base_qs)).order_by("-created_at")
        if request.GET.get("active") == "true":
            qs = qs.filter(is_active=True)
        total = qs.count()
        rows = list(qs[off : off + size])
        data = []
        for driver in rows:
            row = _serialize_model(driver, exclude={"password"})
            row["status"] = driver.driver_status
            row["serviceAreas"] = driver.service_area_cities
            row["phone"] = driver.phone
            row["totalDeliveries"] = int(getattr(driver, "completed_delivery_count", 0) or 0)
            row["user"] = _serialize_model(driver, exclude={"password"})
            row["user"]["totalDeliveries"] = row["totalDeliveries"]
            vehicles = list(driver.assigned_vehicles.all())
            row["vehicles"] = [_serialize_driver_vehicle_link(vehicle) for vehicle in vehicles]
            data.append(row)
        return _ok({"success": True, "drivers": data, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    body = _json_body(request)
    # Admin authority is limited to explicit area assignment, not fleet operations.
    if request.method == "PUT" and "serviceAreas" in body:
        actor = User.objects.filter(id=staff.get("userId"), is_active=True, role=RoleType.ADMIN).first()
        if not actor:
            return _err("Only authorized admins can assign driver service areas", 403)
        if set(body) - {"id", "serviceAreas"}:
            return _err("Save service area assignments separately from driver details", 400)
        areas = body.get("serviceAreas")
        if not isinstance(areas, list) or any(not isinstance(city, str) or not city.strip() or len(city.strip()) > 100 for city in areas):
            return _err("Service areas must be a list of city names", 400)
        normalized = sorted({" ".join(city.split()).casefold() for city in areas})
        with transaction.atomic():
            driver = User.objects.select_for_update().filter(id=body.get("id"), role=RoleType.DRIVER).first()
            if not driver:
                return _err("Driver not found", 404)
            # Persist assignments on the locked account and trigger the existing User sync stamp.
            driver.set_service_areas(normalized, actor.id)
            driver.save(update_fields=["service_areas", "updated_at"])
        return _ok({"success": True, "serviceAreas": normalized})
    # Admins monitor driver records; operational profile changes are not admin actions.
    staff, err = _require_warehouse_operator(request)
    if err:
        return err
    body = _json_body(request)
    if request.method == "POST":
        user_id = str(body.get("userId", "")).strip()
        if not user_id:
            return _err("userId is required")
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return _err("User not found", 404)
        if user.role == "DRIVER":
            return _err("User already assigned as driver", 409)
        lic_number, lic_err = _validate_philippine_driver_license(body.get("licenseNumber"))
        if lic_err:
            return _err(lic_err, 400)
        user.role = "DRIVER"
        user.license_number = lic_number
        license_type_value = str(body.get("licenseType") or "B").strip().upper()
        if license_type_value not in DRIVER_RESTRICTIONS:
            return _err("Restrictions must be one of: A, A1, B, B1, B2, C, D, BE, CE", 400)
        user.license_type = license_type_value
        # license images removed; do not accept licensePhotoUrl from client
        if body.get("licenseExpiry"):
            parsed_license_expiry, expiry_error = _validate_future_license_expiry(body.get("licenseExpiry"))
            if expiry_error:
                return _err(expiry_error, 400)
            user.license_expiry = parsed_license_expiry
        else:
            user.license_expiry = timezone.now() + timedelta(days=365)
        driver_status = _normalize_driver_status(body.get("status") or DriverStatus.ACTIVE)
        if driver_status not in DRIVER_STATUSES:
            return _err("Status must be Active, OnLeave, or Inactive", 400)
        user.driver_status = driver_status
        user.is_active = bool(body.get("isActive", True))
        user.save()
        actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
        _create_staff_notifications(
            title="Driver added",
            message=f"{actor_name} added driver {user.name} ({user.email}).",
            notification_type="TRANSPORT",
            reference_type="driver",
            reference_id=user.id,
        )
        driver_payload = _serialize_model(user, exclude={"password"})
        driver_payload["status"] = user.driver_status
        driver_payload["user"] = _serialize_model(user, exclude={"password"})
        return _ok({"success": True, "driver": driver_payload}, 201)
    driver_id = str(body.get("id", "")).strip()
    if not driver_id:
        return _err("id is required")
    try:
        d = User.objects.get(id=driver_id, role="DRIVER")
    except User.DoesNotExist:
        return _err("Driver not found", 404)
    if "licenseNumber" in body:
        lic_number, lic_err = _validate_philippine_driver_license(body.get("licenseNumber"))
        if lic_err:
            return _err(lic_err, 400)
        d.license_number = lic_number
    # totalDeliveries is derived from completed delivery drop points, so it is not
    # accepted here — writing it would only desynchronise it from the trip records.
    mapping = [
        ("licenseType", "license_type"),
    ]
    for key, attr in mapping:
        if key in body:
            next_value = body.get(key)
            if attr == "license_type" and next_value is not None:
                normalized_type = str(next_value).strip().upper()
                if normalized_type not in DRIVER_RESTRICTIONS:
                    return _err("Restrictions must be one of: A, A1, B, B1, B2, C, D, BE, CE", 400)
                setattr(d, attr, normalized_type or None)
            else:
                setattr(d, attr, next_value)
    if "licenseExpiry" in body and body.get("licenseExpiry"):
        parsed_license_expiry, expiry_error = _validate_future_license_expiry(body.get("licenseExpiry"))
        if expiry_error:
            return _err(expiry_error, 400)
        d.license_expiry = parsed_license_expiry
    # Phone and status are applied before the vehicle check so the eligibility
    # guard below sees the values this request is actually saving.
    if "phone" in body:
        normalized_phone = _normalize_philippine_phone(body.get("phone"))
        if not normalized_phone:
            return _err(PHILIPPINE_PHONE_ERROR)
        d.phone = normalized_phone
    if "isActive" in body:
        d.is_active = bool(body.get("isActive"))
    if "status" in body:
        driver_status = _normalize_driver_status(body.get("status"))
        if driver_status not in DRIVER_STATUSES:
            return _err("Status must be Active, OnLeave, or Inactive", 400)
        d.driver_status = driver_status
    if "licenseType" in body and "vehicleId" not in body:
        # Downgrading the code must not leave the driver holding a vehicle they are
        # no longer qualified for; the vehicle has to be released first.
        current_vehicle = Vehicle.objects.filter(driver=d).first()
        if driver_vehicle_license_error(d, current_vehicle):
            return _err(
                f"Driver is not qualified to drive vehicle {current_vehicle.license_plate} with License Code "
                f"{str(d.license_type or '').strip().upper()}. Unassign the vehicle before changing the license code.",
                400,
            )
    if "vehicleId" in body:
        vehicle_id = str(body.get("vehicleId") or "").strip()
        if vehicle_id:
            vehicle = Vehicle.objects.filter(id=vehicle_id).first()
            if not vehicle:
                return _err("Vehicle not found", 404)
            # A status-only edit may retain the driver's current vehicle; eligibility
            # is enforced only when assigning a different vehicle.
            is_current_assignment = str(vehicle.driver_id or "") == str(d.id)
            if not is_current_assignment:
                blocker = _driver_assignment_blocker(d)
                if blocker:
                    return _err(f"Driver cannot be assigned: {blocker}", 400)
                license_error = driver_vehicle_license_error(d, vehicle)
                if license_error:
                    return _err(license_error, 400)
            existing_veh = Vehicle.objects.filter(driver=d).exclude(id=vehicle.id).first()
            if existing_veh:
                return _err(f"Driver is already assigned to vehicle {existing_veh.license_plate}.", 400)
            _assign_vehicle_to_driver(d, vehicle)
        else:
            unassignment_error = _driver_unassignment_error(d)
            if unassignment_error:
                return _err(unassignment_error, 400)
            _assign_vehicle_to_driver(d, None)
    d.save()
    driver_payload = _serialize_model(d, exclude={"password"})
    driver_payload["status"] = d.driver_status
    driver_payload["user"] = _serialize_model(d, exclude={"password"})
    return _ok({"success": True, "driver": driver_payload})
