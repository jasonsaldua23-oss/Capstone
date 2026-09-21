"""Trip planning previews: the upcoming-deliveries calendar shown while creating a trip."""

import logging
from datetime import date, datetime, time, timedelta
from typing import Any

from django.db.models import Prefetch, Q
from django.http import HttpRequest, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from . import views_api as legacy
from .api_utils import error as _err, ok as _ok, to_int as _int
from .models import Order, OrderItem, OrderStatus, RoleType, TripDropPoint

logger = logging.getLogger(__name__)

UPCOMING_DELIVERIES_DEFAULT_DAYS = 5
UPCOMING_DELIVERIES_MAX_DAYS = 14
# Route planning caps its candidate scan at 600 orders for one day; the preview
# spans up to 14 days, so it gets proportionally more room before truncating.
UPCOMING_DELIVERIES_MAX_ORDERS = 2000

# Every eligibility rule below must stay identical to trips_route_plan in
# views_trip_ops.py: a day chip that says "3 orders" has to show those same
# three orders once Filter Orders runs for that date.
ROUTE_PLAN_EXCLUDED_STATUSES = [
    OrderStatus.PENDING,
    OrderStatus.DELIVERED,
    OrderStatus.CANCELLED,
    OrderStatus.REJECTED,
    "UNAPPROVED",
]
ACTIVE_DROP_POINT_STATUSES = ["PENDING", "ARRIVED", "IN_TRANSIT", "IN_PROGRESS"]


# Helpers owned by sibling modules. Routing them through views_api keeps a
# single resolution point, so tests that patch there still apply.


def _build_order_item_warehouse_allocations_map(order_ids: list[str]) -> dict[str, dict[str, list[dict[str, Any]]]]:
    return legacy._build_order_item_warehouse_allocations_map(order_ids)


def _build_order_warehouse_allocations_map(order_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    return legacy._build_order_warehouse_allocations_map(order_ids)


def _calculate_order_item_weight(item: OrderItem, quantity: int | None = None) -> float:
    return legacy._calculate_order_item_weight(item, quantity)


def _get_allowed_warehouse_ids_for_staff(user_id: str) -> set[str]:
    return legacy._get_allowed_warehouse_ids_for_staff(user_id)


def _real_orders(qs):
    return legacy._real_orders(qs)


def _require_staff(request: HttpRequest) -> tuple[dict[str, Any] | None, JsonResponse | None]:
    return legacy._require_staff(request)


def _local_day_start(day: date) -> datetime:
    # Delivery dates are Philippine calendar days; build the boundary in the
    # configured local timezone so Django converts it to UTC for the query.
    return timezone.make_aware(datetime.combine(day, time.min), timezone.get_current_timezone())


def _order_planning_date(order: Order) -> date:
    """The calendar day route planning files this order under.

    Mirrors the route-plan date filter: the timeline delivery date when one is
    set, otherwise the order's creation date.
    """
    timeline = None
    try:
        timeline = order.timeline
    except Exception:  # RelatedObjectDoesNotExist when no timeline row exists
        timeline = None
    delivery_at = getattr(timeline, "delivery_date", None) if timeline is not None else None
    effective_at = delivery_at or order.created_at
    return timezone.localtime(effective_at).date()


def _scope_orders_to_warehouse(
    orders: list[Order], warehouse_id: str, allocations_map: dict[str, list[dict[str, Any]]]
) -> list[Order]:
    scoped: list[Order] = []
    for order in orders:
        direct_warehouse_id = str(getattr(order, "warehouse_id", "") or "").strip()
        if direct_warehouse_id == warehouse_id:
            scoped.append(order)
            continue
        order_allocations = allocations_map.get(str(getattr(order, "id", "") or "").strip(), [])
        if any(str((allocation or {}).get("warehouseId") or "").strip() == warehouse_id for allocation in order_allocations):
            scoped.append(order)
    return scoped


def _order_load_for_warehouse(
    order: Order,
    warehouse_id: str,
    item_allocations_map: dict[str, dict[str, list[dict[str, Any]]]],
) -> tuple[int, float]:
    """Cases and kilograms this warehouse leg loads, as route planning counts them."""
    order_items = list(getattr(order, "_upcoming_items", []))
    allocations_by_item = item_allocations_map.get(str(getattr(order, "id", "") or "").strip(), {}) or {}
    total_cases = 0
    total_weight = 0.0
    for item in order_items:
        item_allocations = allocations_by_item.get(str(getattr(item, "id", "") or "").strip(), [])
        full_item_quantity = max(_int(getattr(item, "quantity", 0), 0), 0)
        if warehouse_id and item_allocations:
            load_quantity = sum(
                max(_int((allocation or {}).get("allocatedQty"), 0), 0)
                for allocation in item_allocations
                if str((allocation or {}).get("warehouseId") or "").strip() == warehouse_id
            )
        else:
            load_quantity = full_item_quantity
        total_cases += load_quantity
        total_weight += _calculate_order_item_weight(item, load_quantity)
    return total_cases, total_weight


@csrf_exempt
@require_http_methods(["GET"])
def trips_upcoming_deliveries(request: HttpRequest) -> JsonResponse:
    """Per-day eligible order totals for the next few days of one warehouse.

    GET /api/trips/upcoming-deliveries?warehouseId=<id>&from=YYYY-MM-DD&days=5
    """
    staff, err = _require_staff(request)
    if err:
        return err

    warehouse_id = str(request.GET.get("warehouseId") or "").strip()
    from_raw = str(request.GET.get("from") or "").strip()
    from_day = timezone.localdate()
    if from_raw:
        try:
            from_day = datetime.fromisoformat(from_raw).date()
        except ValueError:
            return _err("Invalid from date. Expected YYYY-MM-DD", 400)
    days = min(max(_int(request.GET.get("days"), UPCOMING_DELIVERIES_DEFAULT_DAYS), 1), UPCOMING_DELIVERIES_MAX_DAYS)

    # Warehouse staff only ever plan for their own warehouses; admins see any.
    staff_role = str(staff.get("role") or "").strip().upper()
    if staff_role == RoleType.WAREHOUSE_STAFF:
        if not warehouse_id:
            return _err("warehouseId is required", 400)
        allowed_warehouse_ids = _get_allowed_warehouse_ids_for_staff(str(staff.get("userId") or ""))
        if warehouse_id not in allowed_warehouse_ids:
            return _err("Forbidden", 403)

    window_start = _local_day_start(from_day)
    window_end = window_start + timedelta(days=days)

    upcoming_items = Prefetch(
        "items",
        queryset=OrderItem.objects.select_related("product").prefetch_related("mixed_case_components__product"),
        to_attr="_upcoming_items",
    )
    oqs = _real_orders(
        Order.objects.select_related("customer", "timeline")
        .prefetch_related(upcoming_items)
        .exclude(status__in=ROUTE_PLAN_EXCLUDED_STATUSES)
    ).order_by("created_at")

    active_drop_points_qs = TripDropPoint.objects.filter(status__in=ACTIVE_DROP_POINT_STATUSES)
    if warehouse_id:
        active_drop_points_qs = active_drop_points_qs.filter(trip__warehouse_id=warehouse_id)
    oqs = oqs.exclude(id__in=active_drop_points_qs.values_list("order_id", flat=True))

    # One query for the whole window; the rows are bucketed per day below using
    # the same delivery-date-else-created-at rule.
    oqs = oqs.filter(
        Q(timeline__delivery_date__gte=window_start, timeline__delivery_date__lt=window_end)
        | (Q(timeline__isnull=True) & Q(created_at__gte=window_start, created_at__lt=window_end))
        | (Q(timeline__delivery_date__isnull=True) & Q(created_at__gte=window_start, created_at__lt=window_end))
    )
    if warehouse_id:
        oqs = oqs.filter(Q(warehouse_id=warehouse_id) | Q(warehouse_id__isnull=True) | Q(warehouse_id=""))

    candidate_orders = list(oqs[:UPCOMING_DELIVERIES_MAX_ORDERS])
    candidate_order_ids = [str(getattr(order, "id", "") or "").strip() for order in candidate_orders]
    candidate_order_ids = [order_id for order_id in candidate_order_ids if order_id]
    allocations_map = _build_order_warehouse_allocations_map(candidate_order_ids) if candidate_order_ids else {}
    item_allocations_map = _build_order_item_warehouse_allocations_map(candidate_order_ids) if candidate_order_ids else {}
    if warehouse_id and candidate_orders:
        candidate_orders = _scope_orders_to_warehouse(candidate_orders, warehouse_id, allocations_map)

    day_keys = [from_day + timedelta(days=offset) for offset in range(days)]
    buckets: dict[date, list[dict[str, Any]]] = {day: [] for day in day_keys}
    for order in candidate_orders:
        planning_day = _order_planning_date(order)
        bucket = buckets.get(planning_day)
        if bucket is None:
            continue
        cases, weight = _order_load_for_warehouse(order, warehouse_id, item_allocations_map)
        city = str((order.shipping_city or None) or "Unknown").strip() or "Unknown"
        customer_name = str(
            (order.shipping_name or None)
            or getattr(getattr(order, "customer", None), "name", None)
            or ""
        ).strip()
        bucket.append(
            {
                "id": order.id,
                "orderNumber": order.order_number,
                "customerName": customer_name,
                "city": city,
                "cases": cases,
                "weight": round(weight, 2),
                "deliveryDate": planning_day.isoformat(),
                "status": order.status,
            }
        )

    day_rows: list[dict[str, Any]] = []
    for day in day_keys:
        day_orders = buckets[day]
        cities: dict[str, dict[str, Any]] = {}
        for row in day_orders:
            city_entry = cities.setdefault(row["city"], {"city": row["city"], "orderCount": 0, "totalCases": 0})
            city_entry["orderCount"] += 1
            city_entry["totalCases"] += row["cases"]
        day_rows.append(
            {
                "date": day.isoformat(),
                "orderCount": len(day_orders),
                "totalCases": sum(row["cases"] for row in day_orders),
                "totalWeight": round(sum(row["weight"] for row in day_orders), 2),
                "cities": sorted(cities.values(), key=lambda entry: (-entry["orderCount"], entry["city"].lower())),
                "orders": day_orders,
            }
        )

    return _ok(
        {
            "success": True,
            "warehouseId": warehouse_id or None,
            "from": from_day.isoformat(),
            "to": day_keys[-1].isoformat(),
            "days": day_rows,
        }
    )
