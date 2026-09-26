"""Warehouse management API endpoints."""

from typing import Any

from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from . import views_api as legacy
from .api_utils import error as _err, json_body as _json_body, ok as _ok, to_int as _int
from .models import RoleType, User, Warehouse

DEFAULT_COUNTRY = legacy.DEFAULT_COUNTRY


# Shared policies remain centralized while handlers move behind a domain boundary.
def _require_staff(request: HttpRequest):
    return legacy._require_staff(request)


def _pagination(request: HttpRequest) -> tuple[int, int, int]:
    return legacy._pagination(request)


def _real_warehouses(queryset):
    return legacy._real_warehouses(queryset)


def _get_allowed_warehouse_ids_for_staff(user_id: str) -> set[str]:
    return legacy._get_allowed_warehouse_ids_for_staff(user_id)


def _serialize_model(instance):
    return legacy._serialize_model(instance)


def _ensure_negros_occidental_address(**kwargs):
    return legacy._ensure_negros_occidental_address(**kwargs)


def _resolve_requested_warehouse_manager_id(body: dict[str, Any], manager_id_fallback: str = "") -> str:
    return legacy._resolve_requested_warehouse_manager_id(body, manager_id_fallback)


def _find_staff_already_assigned_elsewhere(staff_id: str, current_warehouse_id: str | None = None):
    return legacy._find_staff_already_assigned_elsewhere(staff_id, current_warehouse_id)


def _strip_default_country_suffix(address: Any) -> str:
    return legacy._strip_default_country_suffix(address)


def _warehouse_capacity_error(warehouse: Warehouse, **kwargs):
    return legacy._warehouse_capacity_error(warehouse, **kwargs)


def _create_staff_notifications(**kwargs) -> None:
    legacy._create_staff_notifications(**kwargs)


@csrf_exempt
@require_http_methods(["GET", "POST"])
def warehouses_collection(request: HttpRequest) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = _real_warehouses(Warehouse.objects.all()).order_by("name")
        role = str(staff.get("role") or "").strip().upper()
        user_id = str(staff.get("userId") or "").strip()
        if role == "WAREHOUSE_STAFF" and user_id:
            qs = qs.filter(id__in=list(_get_allowed_warehouse_ids_for_staff(user_id)))
        total = qs.count()
        rows = list(qs[off : off + size])
        payload_rows = []
        for row in rows:
            serialized = _serialize_model(row)
            manager_id = str(getattr(row, "manager_id", "") or "").strip()
            serialized["staffIds"] = [manager_id] if manager_id else []
            payload_rows.append(serialized)
        return _ok({"success": True, "warehouses": payload_rows, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    if str(staff.get("role") or "").strip().upper() != RoleType.ADMIN:
        return _err("Only administrators can manage warehouses", 403)
    body = _json_body(request)
    required = ["name", "code", "address", "city", "province", "zipCode", "capacity"]
    for f in required:
        if not body.get(f):
            return _err(f"{f} is required")
    capacity_value = _int(body.get("capacity"), 0)
    if capacity_value <= 0:
        return _err("capacity must be greater than 0", 400)
    address_error = _ensure_negros_occidental_address(
        latitude=body.get("latitude"),
        longitude=body.get("longitude"),
        city=body.get("city"),
        province=body.get("province"),
        require_coordinates=False,
    )
    if address_error:
        return _err(address_error, 400)
    requested_manager_id = _resolve_requested_warehouse_manager_id(body)
    warehouse_label = _find_staff_already_assigned_elsewhere(requested_manager_id)
    if warehouse_label:
        staff_user = User.objects.filter(id=requested_manager_id).only("name", "email").first()
        staff_name = str(getattr(staff_user, "name", "") or getattr(staff_user, "email", "") or requested_manager_id)
        return _err(f"{staff_name} is already assigned to {warehouse_label}. One warehouse staff can only belong to one warehouse.", 400)
    w = Warehouse.objects.create(
        name=body["name"],
        code=body["code"],
        address=_strip_default_country_suffix(body["address"]),
        city=body["city"],
        province=body["province"],
        zip_code=body["zipCode"],
        country=DEFAULT_COUNTRY,
        latitude=body.get("latitude"),
        longitude=body.get("longitude"),
        capacity=capacity_value,
        manager_id=requested_manager_id or None,
        is_active=bool(body.get("isActive", True)),
    )
    actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
    _create_staff_notifications(
        title="Warehouse added",
        message=f"{actor_name} added warehouse {w.name} ({w.code}).",
        notification_type="WAREHOUSE",
        reference_type="warehouse",
        reference_id=w.id,
    )
    warehouse_data = _serialize_model(w)
    warehouse_data["staffIds"] = [requested_manager_id] if requested_manager_id else []
    return _ok({"success": True, "warehouse": warehouse_data}, 201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
def warehouse_detail(request: HttpRequest, warehouse_id: str) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    try:
        w = Warehouse.objects.get(id=warehouse_id)
    except Warehouse.DoesNotExist:
        return _err("Warehouse not found", 404)
    if request.method == "GET":
        warehouse_data = _serialize_model(w)
        manager_id = str(getattr(w, "manager_id", "") or "").strip()
        warehouse_data["staffIds"] = [manager_id] if manager_id else []
        return _ok({"success": True, "warehouse": warehouse_data})
    if str(staff.get("role") or "").strip().upper() != RoleType.ADMIN:
        return _err("Only administrators can manage warehouses", 403)
    if request.method == "DELETE":
        w.is_active = False
        w.save(update_fields=["is_active", "updated_at"])
        actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
        _create_staff_notifications(
            title="Warehouse deactivated",
            message=f"{actor_name} deactivated warehouse {w.name} ({w.code}).",
            notification_type="WAREHOUSE",
            reference_type="warehouse",
            reference_id=w.id,
        )
        return _ok({"success": True})
    body = _json_body(request)
    if "capacity" in body:
        raw_capacity = body.get("capacity")
        if raw_capacity in (None, ""):
            return _err("capacity is required", 400)
        capacity_value = _int(raw_capacity, 0)
        if capacity_value <= 0:
            return _err("capacity must be greater than 0", 400)
        capacity_error = _warehouse_capacity_error(w, proposed_capacity=capacity_value)
        if capacity_error:
            return _err(capacity_error, 400)
        body["capacity"] = capacity_value
    mapping = [("name", "name"), ("code", "code"), ("address", "address"), ("city", "city"), ("province", "province"), ("zipCode", "zip_code"), ("latitude", "latitude"), ("longitude", "longitude"), ("capacity", "capacity"), ("managerId", "manager_id")]
    for key, attr in mapping:
        if key in body:
            if key == "address":
                setattr(w, attr, _strip_default_country_suffix(body.get(key)))
            else:
                setattr(w, attr, body.get(key))
    w.country = DEFAULT_COUNTRY
    if any(key in body for key in {"address", "city", "province", "zipCode", "latitude", "longitude"}):
        address_error = _ensure_negros_occidental_address(
            latitude=w.latitude,
            longitude=w.longitude,
            city=w.city,
            province=w.province,
            require_coordinates=False,
        )
        if address_error:
            return _err(address_error, 400)
    if "isActive" in body:
        w.is_active = bool(body.get("isActive"))
    if "staffIds" in body or "managerId" in body:
        requested_manager_id = _resolve_requested_warehouse_manager_id(body, manager_id_fallback=str(getattr(w, "manager_id", "") or ""))
        warehouse_label = _find_staff_already_assigned_elsewhere(requested_manager_id, current_warehouse_id=str(w.id))
        if warehouse_label:
            staff_user = User.objects.filter(id=requested_manager_id).only("name", "email").first()
            staff_name = str(getattr(staff_user, "name", "") or getattr(staff_user, "email", "") or requested_manager_id)
            return _err(f"{staff_name} is already assigned to {warehouse_label}. One warehouse staff can only belong to one warehouse.", 400)
        w.manager_id = requested_manager_id or None
    w.save()
    warehouse_data = _serialize_model(w)
    manager_id = str(getattr(w, "manager_id", "") or "").strip()
    warehouse_data["staffIds"] = [manager_id] if manager_id else []
    return _ok({"success": True, "warehouse": warehouse_data})

