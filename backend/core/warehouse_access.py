"""Warehouse-scoped authorization, staff assignment and capacity rules."""

from typing import Any

from django.db.models import Sum
from django.http import HttpRequest, JsonResponse

from . import views_api as legacy
from .api_utils import error as _err, to_int as _int
from .models import Inventory, RoleType, Warehouse


# Helpers owned by sibling modules. Routing them through views_api keeps
# a single resolution point, so tests that patch there still apply.


def _require_staff(request: HttpRequest) -> tuple[dict[str, Any] | None, JsonResponse | None]:
    return legacy._require_staff(request)


def _require_warehouse_operator(request: HttpRequest) -> tuple[dict[str, Any] | None, JsonResponse | None]:
    """Allow warehouse-operational writes only from warehouse staff.

    Admin accounts retain read access to the same records, but cannot mutate
    products, fleet records, or warehouse inventory through these endpoints.
    """
    staff, err = _require_staff(request)
    if err:
        return None, err
    if str(staff.get("role") or "").strip().upper() != RoleType.WAREHOUSE_STAFF:
        return None, _err("Only warehouse staff can perform warehouse operations", 403)
    return staff, None


def _get_allowed_warehouse_ids_for_staff(user_id: str) -> set[str]:
    normalized_user_id = str(user_id or "").strip()
    if not normalized_user_id:
        return set()
    return {
        str(warehouse_id).strip()
        for warehouse_id in
        Warehouse.objects.filter(manager_id=normalized_user_id).values_list("id", flat=True)
        if str(warehouse_id).strip()
    }


def _resolve_requested_warehouse_manager_id(body: dict[str, Any], manager_id_fallback: str = "") -> str:
    manager_id = str(body.get("managerId") or "").strip()
    if manager_id:
        return manager_id
    requested_staff_ids = [
        str(value or "").strip()
        for value in (body.get("staffIds") or [])
        if str(value or "").strip()
    ]
    if requested_staff_ids:
        return requested_staff_ids[0]
    return str(manager_id_fallback or "").strip()


def _find_staff_already_assigned_elsewhere(staff_id: str, current_warehouse_id: str | None = None) -> str | None:
    normalized_staff_id = str(staff_id or "").strip()
    if not normalized_staff_id:
        return None
    manager_qs = Warehouse.objects.filter(manager_id=normalized_staff_id)
    if current_warehouse_id:
        manager_qs = manager_qs.exclude(id=current_warehouse_id)
    for warehouse in manager_qs.only("id", "name", "code", "manager_id"):
        return f"{warehouse.name} ({warehouse.code})"
    return None


def _warehouse_capacity_error(
    warehouse: Warehouse,
    *,
    incoming_cases: int = 0,
    proposed_capacity: int | None = None,
) -> str | None:
    """Return a user-facing error when a stock change would exceed hard capacity."""
    used_cases = max(
        0,
        _int(
            Inventory.objects.filter(warehouse_id=warehouse.id)
            .aggregate(total=Sum("quantity"))
            .get("total"),
            0,
        ),
    )
    capacity = max(
        0,
        _int(proposed_capacity if proposed_capacity is not None else warehouse.capacity, 0),
    )
    projected_cases = used_cases + max(0, _int(incoming_cases, 0))
    if projected_cases <= capacity:
        return None
    # Added: capacity is a hard warehouse-wide case limit, not only a report metric.
    return (
        f"Warehouse capacity exceeded. Current stock is {used_cases} case(s), "
        f"the requested change would use {projected_cases}, and capacity is {capacity}."
    )
