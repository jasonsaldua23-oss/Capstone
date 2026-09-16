"""Trip execution endpoints: routing, start, completion and drop points."""

import logging
import re
from datetime import datetime, time, timedelta
from typing import Any

from django.db import transaction
from django.db.models import Prefetch, Q
from django.http import HttpRequest, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from . import views_api as legacy
from .api_constants import PRODUCT_UNIT_PACK_BUNDLE, RESOLVED_DROP_POINT_STATUSES, _NOT_PROVIDED
from .api_utils import (
    error as _err,
    json_body as _json_body,
    ok as _ok,
    to_float_or_none as _to_float_or_none,
    to_int as _int,
)
from .empties_verification import record_collected_empties
from .mixed_case import serialize_mixed_component
from .models import (
    Order,
    OrderItem,
    OrderItemType,
    OrderStatus,
    OrderTimeline,
    ProductPackaging,
    PurchaseOrderStage,
    RoleType,
    Trip,
    TripDropPoint,
    TripStatus,
    User,
    Vehicle,
    VehicleStatus,
    Warehouse,
)

logger = logging.getLogger(__name__)


# Resolved through views_api so tests and runtime overrides that rebind
# these names on views_api keep applying here.


def driver_vehicle_license_error(driver: Any, vehicle: Any) -> str | None:
    return legacy.driver_vehicle_license_error(driver, vehicle)


# Helpers owned by sibling modules. Routing them through views_api keeps
# a single resolution point, so tests that patch there still apply.


def _build_order_item_warehouse_allocations_map(order_ids: list[str]) -> dict[str, dict[str, list[dict[str, Any]]]]:
    return legacy._build_order_item_warehouse_allocations_map(order_ids)


def _build_order_warehouse_allocations_map(order_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    return legacy._build_order_warehouse_allocations_map(order_ids)


def _calculate_order_item_weight(item: OrderItem, quantity: int | None=None) -> float:
    return legacy._calculate_order_item_weight(item, quantity)


def _compute_order_distances(orders: list[dict[str, Any]], start_latitude: float | None=None, start_longitude: float | None=None) -> tuple[list[dict[str, Any]], float]:
    return legacy._compute_order_distances(orders, start_latitude, start_longitude)


def _create_staff_notifications(*, title: str, message: str, notification_type: str='INVENTORY', reference_type: str | None=None, reference_id: str | None=None) -> None:
    return legacy._create_staff_notifications(title=title, message=message, notification_type=notification_type, reference_type=reference_type, reference_id=reference_id)


def _email_delivery_failed_to_customer(order: Order, failure_reason: str, *, rescheduled_for: datetime | None=None, order_cancelled: bool=False) -> None:
    return legacy._email_delivery_failed_to_customer(order, failure_reason, rescheduled_for=rescheduled_for, order_cancelled=order_cancelled)


def _email_order_out_for_delivery_to_customer(order: Order) -> None:
    return legacy._email_order_out_for_delivery_to_customer(order)


def _get_product_size_label(product: Any) -> str:
    return legacy._get_product_size_label(product)


def _get_scheduled_replacement_payload(order: Order) -> dict[str, Any] | None:
    return legacy._get_scheduled_replacement_payload(order)


def _mark_order_delivered(order: Order, performed_by: str | None, delivered_at: datetime | None=None) -> None:
    return legacy._mark_order_delivered(order, performed_by, delivered_at)


def _normalize_order_status(value: Any) -> str:
    return legacy._normalize_order_status(value)


def _normalize_product_unit(raw: Any) -> str:
    return legacy._normalize_product_unit(raw)


def _real_drivers(qs):
    return legacy._real_drivers(qs)


def _real_orders(qs):
    return legacy._real_orders(qs)


def _real_vehicles(qs):
    return legacy._real_vehicles(qs)


def _real_warehouses(qs):
    return legacy._real_warehouses(qs)


def _release_order_reservations(order: Order, performed_by: str | None) -> None:
    return legacy._release_order_reservations(order, performed_by)


def _require_staff(request: HttpRequest) -> tuple[dict[str, Any] | None, JsonResponse | None]:
    return legacy._require_staff(request)


def _serialize_model(obj: Any, include: dict[str, Any] | None=None, exclude: set[str] | None=None) -> dict[str, Any]:
    return legacy._serialize_model(obj, include, exclude)


def _serialize_order(order: Order, include_items: bool=True, include_progress: bool=False, *, warehouse_lookup: dict[str, Warehouse] | None=None, assigned_trip: Trip | None=None, fulfillment_legs: list[dict[str, Any]] | None=None, warehouse_allocations: list[dict[str, Any]] | None=None, item_warehouse_allocations: dict[str, list[dict[str, Any]]] | None=None, item_trip_assignments: dict[str, list[dict[str, Any]]] | None=None, empties_adjustment: Any=_NOT_PROVIDED, packaging_cache: dict[str, ProductPackaging] | None=None, delivery_transactions: dict[str, list[str]] | None=None, pod_drop_point: TripDropPoint | None=None, primary_admin_phone: Any=_NOT_PROVIDED) -> dict[str, Any]:
    return legacy._serialize_order(order, include_items, include_progress, warehouse_lookup=warehouse_lookup, assigned_trip=assigned_trip, fulfillment_legs=fulfillment_legs, warehouse_allocations=warehouse_allocations, item_warehouse_allocations=item_warehouse_allocations, item_trip_assignments=item_trip_assignments, empties_adjustment=empties_adjustment, packaging_cache=packaging_cache, delivery_transactions=delivery_transactions, pod_drop_point=pod_drop_point, primary_admin_phone=primary_admin_phone)


def _serialize_trip(trip: Trip, include_points: bool=True, *, ctx: dict=None) -> dict[str, Any]:
    return legacy._serialize_trip(trip, include_points, ctx=ctx)


@csrf_exempt
@require_http_methods(["GET", "POST"])
def trips_route_plan(request: HttpRequest) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        warehouse_id = str(request.GET.get("warehouseId") or "").strip()
        route_date_raw = str(request.GET.get("date") or "").strip()
        route_date = None
        if route_date_raw:
            try:
                route_date = datetime.fromisoformat(route_date_raw).date()
            except ValueError:
                return _err("Invalid date. Expected YYYY-MM-DD", 400)

        # Do not over-restrict by later global order statuses here; split-warehouse orders can have
        # one leg already moving while another leg still needs trip planning. Still exclude
        # orders that are not yet approved / confirmed for delivery planning.
        route_plan_items = Prefetch(
            "items",
            queryset=OrderItem.objects.select_related("product").prefetch_related("mixed_case_components__product"),
            to_attr="_route_plan_items",
        )
        oqs = _real_orders(
            Order.objects.select_related("customer", "timeline")
            .prefetch_related(route_plan_items)
            .exclude(
                status__in=[
                    OrderStatus.PENDING,
                    OrderStatus.DELIVERED,
                    OrderStatus.CANCELLED,
                    OrderStatus.REJECTED,
                    "UNAPPROVED",
                ]
            )
        ).order_by("created_at")

        active_drop_points_qs = TripDropPoint.objects.filter(
            status__in=["PENDING", "ARRIVED", "IN_TRANSIT", "IN_PROGRESS"]
        )
        if warehouse_id:
            active_drop_points_qs = active_drop_points_qs.filter(trip__warehouse_id=warehouse_id)
        active_route_order_ids = active_drop_points_qs.values_list("order_id", flat=True)
        oqs = oqs.exclude(id__in=active_route_order_ids)

        if route_date:
            # Fix: the selected route date is a Philippine calendar day. Build
            # its boundaries in the configured local timezone before Django
            # converts them to UTC for the database query.
            route_start = timezone.make_aware(
                datetime.combine(route_date, time.min),
                timezone.get_current_timezone(),
            )
            route_end = route_start + timedelta(days=1)
            oqs = oqs.filter(
                Q(timeline__delivery_date__gte=route_start, timeline__delivery_date__lt=route_end)
                | (
                    Q(timeline__isnull=True)
                    & Q(created_at__gte=route_start, created_at__lt=route_end)
                )
                | (
                    Q(timeline__delivery_date__isnull=True)
                    & Q(created_at__gte=route_start, created_at__lt=route_end)
                )
            )

        if warehouse_id:
            oqs = oqs.filter(
                Q(warehouse_id=warehouse_id) | Q(warehouse_id__isnull=True) | Q(warehouse_id="")
            )

        warehouse_start_lat = None
        warehouse_start_lng = None
        if warehouse_id:
            warehouse = _real_warehouses(Warehouse.objects.filter(id=warehouse_id)).only("id", "latitude", "longitude").first()
            if warehouse:
                warehouse_start_lat = _to_float_or_none(getattr(warehouse, "latitude", None))
                warehouse_start_lng = _to_float_or_none(getattr(warehouse, "longitude", None))

        candidate_orders = list(oqs[:600])
        candidate_order_ids = [str(getattr(order, "id", "") or "").strip() for order in candidate_orders if str(getattr(order, "id", "") or "").strip()]
        allocations_map = _build_order_warehouse_allocations_map(candidate_order_ids) if candidate_order_ids else {}
        item_allocations_map = _build_order_item_warehouse_allocations_map(candidate_order_ids) if candidate_order_ids else {}
        if warehouse_id and candidate_orders:
            warehouse_scoped_candidates = []
            for order in candidate_orders:
                direct_warehouse_id = str(getattr(order, "warehouse_id", "") or "").strip()
                if direct_warehouse_id == warehouse_id:
                    warehouse_scoped_candidates.append(order)
                    continue
                order_allocations = allocations_map.get(str(getattr(order, "id", "") or "").strip(), [])
                has_selected_warehouse_allocation = any(
                    str((allocation or {}).get("warehouseId") or "").strip() == warehouse_id
                    for allocation in order_allocations
                )
                if has_selected_warehouse_allocation:
                    warehouse_scoped_candidates.append(order)
            candidate_orders = warehouse_scoped_candidates

        orders = []
        grouped_by_city: dict[str, list[dict[str, Any]]] = {}
        for o in candidate_orders[:300]:
            # Fix: reuse the batched item list; per-order related queries time out on deployed databases.
            order_items = list(getattr(o, "_route_plan_items", []))
            city = str((o.shipping_city or None) or "Unknown").strip() or "Unknown"
            latitude = _to_float_or_none((o.shipping_latitude or None) or o.customer.latitude)
            longitude = _to_float_or_none((o.shipping_longitude or None) or o.customer.longitude)
            address = str((o.shipping_address or None) or "").strip()
            order_allocations = allocations_map.get(str(getattr(o, "id", "") or "").strip(), [])
            allocated_qty_for_selected_warehouse = 0
            if warehouse_id:
                allocated_qty_for_selected_warehouse = sum(
                    max(_int((allocation or {}).get("allocatedQty"), 0), 0)
                    for allocation in order_allocations
                    if str((allocation or {}).get("warehouseId") or "").strip() == warehouse_id
                )
            total_order_qty = sum(max(_int(item.quantity, 0), 0) for item in order_items)
            if str(getattr(o, "warehouse_id", "") or "").strip() == warehouse_id and not order_allocations:
                # Fix: directly assigned orders may not have reserve transactions yet.
                # They still belong to this warehouse leg and must remain selectable for trip planning.
                allocated_qty_for_selected_warehouse = total_order_qty
            selected_load_cases = 0
            selected_load_weight = 0.0
            product_allocations: list[dict[str, Any]] = []
            for item in order_items:
                item_id = str(getattr(item, "id", "") or "").strip()
                item_allocations = (item_allocations_map.get(str(getattr(o, "id", "") or "").strip(), {}) or {}).get(item_id, [])
                allocated_for_selected_warehouse = 0
                if warehouse_id:
                    allocated_for_selected_warehouse = sum(
                        max(_int((allocation or {}).get("allocatedQty"), 0), 0)
                        for allocation in item_allocations
                        if str((allocation or {}).get("warehouseId") or "").strip() == warehouse_id
                    )
                full_item_quantity = max(_int(getattr(item, "quantity", 0), 0), 0)
                load_quantity = (
                    allocated_for_selected_warehouse
                    if warehouse_id and item_allocations
                    else full_item_quantity
                )
                selected_load_cases += load_quantity
                selected_load_weight += _calculate_order_item_weight(item, load_quantity)
                size_label = _get_product_size_label(getattr(item, "product", None))
                product_name = str(getattr(getattr(item, "product", None), "name", "") or getattr(item, "product_name", "") or "Product").strip() or "Product"
                product_allocations.append(
                    {
                        "itemId": item_id or None,
                        # Route details retain the component breakdown of a mixed case.
                        "itemType": item.item_type,
                        "unitLabel": "mixed case(s)" if item.item_type == OrderItemType.MIXED_CASE else _normalize_product_unit(item.product_unit),
                        "components": [serialize_mixed_component(component) for component in item.mixed_case_components.all()] if item.item_type == OrderItemType.MIXED_CASE else [],
                        "productName": product_name,
                        "sizeLabel": size_label or None,
                        "allocatedQtyForSelectedWarehouse": allocated_for_selected_warehouse,
                        "totalQty": max(_int(getattr(item, "quantity", 0), 0), 0),
                        "productWeight": float(getattr(getattr(item, "product", None), "weight", 0) or 0),
                    }
                )
            scheduled_replacement = _get_scheduled_replacement_payload(o)

            def _format_route_plan_qty_label(item: OrderItem) -> str:
                raw_qty = max(_int(getattr(item, "quantity", 0), 0), 0)
                if item.item_type == OrderItemType.MIXED_CASE:
                    return f"{raw_qty} mixed case(s)"
                item_unit = _normalize_product_unit(getattr(item, "product_unit", None))
                # Fix: multi-product replacements store exact bottle counts per item;
                # the order quantity is rounded to packs/cases for loading.
                item_notes = str(getattr(item, "notes", "") or "")
                if str(o.order_number or "").upper().startswith("RPL-") and "ReplacementUnitMode=BOTTLE" in item_notes:
                    bottle_match = re.search(r"ReplacementRequestedBottles=(\d+)", item_notes)
                    if bottle_match and int(bottle_match.group(1)) > 0:
                        return f"{int(bottle_match.group(1))} bottle"
                if scheduled_replacement and len(order_items) == 1:
                    exact_qty = max(
                        _int(scheduled_replacement.get("quantityRemaining"), 0),
                        _int(scheduled_replacement.get("quantityToReplace"), 0),
                    )
                    if exact_qty > 0:
                        if str(scheduled_replacement.get("unitMode") or "").strip().upper() == "BOTTLE":
                            return f"{exact_qty} bottle"
                        if item_unit == PRODUCT_UNIT_PACK_BUNDLE:
                            return f"{exact_qty} pack"
                        return f"{exact_qty} case"
                if item_unit == PRODUCT_UNIT_PACK_BUNDLE:
                    return f"{raw_qty} pack"
                return f"{raw_qty} case"

            products_preview = ", ".join(
                [
                    # Include the stored size without adding parentheses in the route preview.
                    f"{str(getattr(item.product, 'name', '') or getattr(item, 'product_name', '') or 'Product').strip()} {_get_product_size_label(getattr(item, 'product', None)).replace('(', '').replace(')', '')} {_format_route_plan_qty_label(item)}".replace("  ", " ")
                    for item in order_items[:3]
                    if getattr(item, "product", None) or str(getattr(item, "product_name", "") or "").strip()
                ]
            )

            order_row = {
                "id": o.id,
                "orderId": o.id,
                "orderNumber": o.order_number,
                "isScheduledReplacement": str(o.order_number or "").strip().upper().startswith("RPL-"),
                "customerName": o.customer.name,
                "address": address,
                "shippingAddress": address,
                "city": city,
                "province": o.shipping_province,
                "zipCode": o.shipping_zip_code,
                "latitude": latitude,
                "longitude": longitude,
                "shippingLatitude": latitude,
                "shippingLongitude": longitude,
                "products": products_preview,
                "productAllocations": product_allocations,
                "allocatedQtyForSelectedWarehouse": allocated_qty_for_selected_warehouse,
                "totalOrderQty": total_order_qty,
                # Added: route planning exposes the same load values used by
                # backend capacity validation so the UI updates immediately.
                "totalCases": selected_load_cases,
                "totalWeight": round(selected_load_weight, 2),
                "sequence": len(grouped_by_city.get(city, [])) + 1,
                "distanceKm": None,
                "status": o.status,
            }
            orders.append(order_row)
            grouped_by_city.setdefault(city, []).append(order_row)

        route_plans = []
        for city in sorted(grouped_by_city.keys(), key=lambda value: value.lower()):
            city_orders = grouped_by_city[city]
            enriched_orders, city_total_distance_km = _compute_order_distances(
                city_orders,
                warehouse_start_lat,
                warehouse_start_lng,
            )

            route_plans.append(
                {
                    "city": city,
                    "orderCount": len(city_orders),
                    "totalDistanceKm": round(city_total_distance_km, 2),
                    "orders": enriched_orders,
                }
            )

        drivers = [
            _serialize_model(x, exclude={"password"})
            for x in _real_drivers(User.objects.filter(role="DRIVER", is_active=True))[:200]
        ]
        vehicles = [
            _serialize_model(x)
            for x in _real_vehicles(Vehicle.objects.filter(status=VehicleStatus.AVAILABLE, is_active=True))[:200]
        ]
        return _ok({"success": True, "drivers": drivers, "vehicles": vehicles, "orders": orders, "routePlans": route_plans})
    body = _json_body(request)
    return _ok({"success": True, "routePlan": body, "message": "Route plan accepted"})


@csrf_exempt
@require_http_methods(["POST"])
def trip_start(request: HttpRequest, trip_id: str) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    t = Trip.objects.select_related("driver", "vehicle").prefetch_related("drop_points__order__timeline").filter(id=trip_id).first()
    if not t:
        return _err("Trip not found", 404)
    if p.get("role") == "DRIVER" and p.get("userId") != t.driver_id:
        return _err("Forbidden", 403)
    current_trip_status = str(t.status or "").strip().upper()
    # A mobile connection can lose the first successful response. Starting again
    # must confirm the existing trip instead of making the driver tap Start again.
    if current_trip_status == TripStatus.IN_PROGRESS:
        return _ok({"success": True, "alreadyStarted": True, "trip": _serialize_model(t)})
    if current_trip_status != TripStatus.PLANNED:
        return _err("Only planned trips can be started", 409)

    # Added: enforce the same schedule shown to the driver. Order delivery dates
    # define tripSchedule; planned_start_at remains the fallback for older trips.
    scheduled_values = [
        point.order.timeline.delivery_date
        for point in t.drop_points.all()
        if point.order_id
        and getattr(point, "order", None)
        and getattr(point.order, "timeline", None)
        and point.order.timeline.delivery_date
    ]
    scheduled_at = min(scheduled_values) if scheduled_values else t.planned_start_at
    if not scheduled_at:
        return _err("Trip cannot be started because its scheduled date is not set", 409)
    scheduled_date = timezone.localdate(scheduled_at) if timezone.is_aware(scheduled_at) else scheduled_at.date()
    if scheduled_date != timezone.localdate():
        return _err(f"Trip can only be started on its scheduled date: {scheduled_date.isoformat()}", 409)

    body = _json_body(request)
    # Added: the server requires the driver's explicit physical-load
    # confirmation, so calling the endpoint directly cannot bypass the check.
    if body.get("confirmLoad") is not True:
        return _err("Confirm Load is required before starting the trip", 400)

    # The licence can change (or expire into a different code) after the trip was
    # planned, so the qualification is re-checked at the moment of driving.
    license_error = driver_vehicle_license_error(t.driver, t.vehicle)
    if license_error:
        return _err(license_error, 400)

    now = timezone.now()
    with transaction.atomic():
        t.status = TripStatus.IN_PROGRESS
        t.actual_start_at = now
        t.save(update_fields=["status", "actual_start_at", "updated_at"])

        for drop_point in t.drop_points.all():
            if not drop_point.order_id or not drop_point.order:
                continue
            order = drop_point.order
            changed_fields: list[str] = []
            previous_status = _normalize_order_status(order.status)
            if not order.warehouse_dispatched_at:
                order.warehouse_dispatched_at = now
                changed_fields.append("warehouse_dispatched_at")
            if _normalize_order_status(order.status) != OrderStatus.OUT_FOR_DELIVERY:
                order.status = OrderStatus.OUT_FOR_DELIVERY
                changed_fields.append("status")
            if changed_fields:
                changed_fields.append("updated_at")
                order.save(update_fields=changed_fields)
                if previous_status != OrderStatus.OUT_FOR_DELIVERY:
                    refreshed_for_email = (
                        Order.objects.select_related("customer")
                        .prefetch_related("items__product")
                        .filter(id=order.id)
                        .first()
                    )
                    if refreshed_for_email:
                        _email_order_out_for_delivery_to_customer(refreshed_for_email)

            timeline, _ = OrderTimeline.objects.get_or_create(order=order)
            if not timeline.shipped_at:
                timeline.shipped_at = now
                timeline.save(update_fields=["shipped_at", "updated_at"])
    actor_name = str(p.get("name") or "Staff").strip() or "Staff"
    _create_staff_notifications(
        title="Trip started",
        message=f"{actor_name} started trip {t.trip_number}.",
        notification_type="TRIP",
        reference_type="trip",
        reference_id=t.id,
    )
    return _ok({"success": True, "trip": _serialize_model(t)})


@csrf_exempt
@require_http_methods(["POST"])
def trip_complete(request: HttpRequest, trip_id: str) -> JsonResponse:
    """Close a trip once every drop point has an outcome.

    Completing twice is not an error: the second call returns the trip as it already
    stands, so a double tap or a refresh mid-request cannot record the trip twice or
    move the completion time.
    """
    p, err = _require_staff(request)
    if err:
        return err

    with transaction.atomic():
        trip = Trip.objects.select_for_update().filter(id=trip_id).first()
        if not trip:
            return _err("Trip not found", 404)

        if p.get("role") == RoleType.DRIVER and str(p.get("userId") or "") != str(trip.driver_id or ""):
            return _err("Forbidden", 403)

        drop_points = list(trip.drop_points.all())
        total = len(drop_points)
        resolved = [
            point for point in drop_points
            if str(point.status or "").upper() in RESOLVED_DROP_POINT_STATUSES
        ]

        trip.total_drop_points = total
        trip.completed_drop_points = len(resolved)

        if str(trip.status or "").upper() == TripStatus.COMPLETED:
            # Already done. Report success without touching the recorded end time.
            trip.save(update_fields=["total_drop_points", "completed_drop_points", "updated_at"])
            return _ok({
                "success": True,
                "alreadyCompleted": True,
                "trip": _serialize_trip(trip),
                "message": "This trip was already completed.",
            })

        if str(trip.status or "").upper() == TripStatus.CANCELLED:
            return _err("A cancelled trip cannot be completed", 409)

        if total == 0:
            return _err("This trip has no drop points to complete", 400)

        outstanding = total - len(resolved)
        if outstanding > 0:
            trip.save(update_fields=["total_drop_points", "completed_drop_points", "updated_at"])
            return _err(
                f"{outstanding} drop point(s) still need to be completed before the trip can be closed",
                400,
            )

        now = timezone.now()
        trip.status = TripStatus.COMPLETED
        trip.actual_end_at = trip.actual_end_at or now
        trip.save(update_fields=[
            "status",
            "actual_end_at",
            "total_drop_points",
            "completed_drop_points",
            "updated_at",
        ])

    completed_trip = (
        Trip.objects.select_related("driver", "vehicle")
        .prefetch_related("drop_points__order")
        .get(id=trip.id)
    )
    actor_name = str(p.get("name") or "Driver").strip() or "Driver"
    _create_staff_notifications(
        title="Trip completed",
        message=f"{actor_name} completed trip {completed_trip.trip_number}.",
        notification_type="TRIP",
        reference_type="trip",
        reference_id=completed_trip.id,
    )
    return _ok({
        "success": True,
        "alreadyCompleted": False,
        "trip": _serialize_trip(completed_trip),
        "message": "Trip completed.",
    })


@csrf_exempt
@require_http_methods(["PATCH"])
@transaction.atomic
def trip_drop_point_update(request: HttpRequest, trip_id: str, drop_point_id: str) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    dp = TripDropPoint.objects.select_for_update(of=("self",)).select_related("trip").filter(id=drop_point_id, trip_id=trip_id).first()
    if not dp:
        return _err("Drop point not found", 404)
    # Serialize delivery confirmation and cancellation against the same order lock.
    if dp.order_id:
        Order.objects.select_for_update().get(id=dp.order_id)
    if p.get("role") == "DRIVER" and p.get("userId") != dp.trip.driver_id:
        return _err("Forbidden", 403)
    body = _json_body(request)
    requeued_to_route_pool = False
    requested_status = str(body.get("status") or "").strip().upper()
    next_status = requested_status
    if next_status == "COMPLETED" and not str(body.get("deliveryPhoto") or dp.delivery_photo or "").strip():
        return _err("A POD photo is required to confirm delivery", 400)
    if requested_status == "COMPLETED" and str(dp.status or "").upper() == "COMPLETED":
        # The first request may have committed while its response was lost. This
        # acknowledgement makes the driver's automatic confirmation retry safe.
        existing_order_payload = None
        if dp.order_id:
            existing_order_payload = _serialize_order(
                Order.objects.select_related("customer", "timeline").prefetch_related("items__product").get(id=dp.order_id),
                include_items=False,
            )
        return _ok({
            "success": True,
            "alreadyCompleted": True,
            "dropPoint": _serialize_model(dp),
            "order": existing_order_payload,
            "requeuedToRoutePool": False,
            "empties": None,
        })
    cancellation_reason = str(body.get("notes") or body.get("failureReason") or "").strip()
    # Required: driver delivery cancellations must include the selected reason.
    if requested_status == "CANCELLED" and not cancellation_reason:
        return _err("A cancellation reason is required", 400)
    reschedule_window = str(body.get("rescheduleWindow") or "").strip().lower()
    reschedule_requested = bool(body.get("rescheduleRequested")) or bool(reschedule_window)
    defer_within_trip_today = next_status == "FAILED" and reschedule_requested and reschedule_window == "today"
    if defer_within_trip_today:
        next_status = "PENDING"
    rescheduled_delivery_at: datetime | None = None
    if requested_status == "FAILED" and reschedule_requested:
        reschedule_date_raw = str(body.get("rescheduleDate") or "").strip()
        if reschedule_date_raw:
            parsed_delivery_dt: datetime | None = None
            try:
                parsed_delivery_dt = datetime.fromisoformat(reschedule_date_raw.replace("Z", "+00:00"))
            except ValueError:
                try:
                    parsed_delivery_dt = datetime.fromisoformat(f"{reschedule_date_raw}T09:00:00")
                except ValueError:
                    return _err("Invalid rescheduleDate. Expected ISO date or datetime", 400)
            if parsed_delivery_dt is not None:
                if timezone.is_naive(parsed_delivery_dt):
                    parsed_delivery_dt = timezone.make_aware(parsed_delivery_dt, timezone.get_current_timezone())
                rescheduled_delivery_at = parsed_delivery_dt
        elif reschedule_window == "today":
            rescheduled_delivery_at = timezone.now()
        elif reschedule_window == "tomorrow":
            rescheduled_delivery_at = timezone.now() + timedelta(days=1)
    dp.status = next_status
    mapping = [("recipientName", "recipient_name"), ("deliveryPhoto", "delivery_photo"), ("failureReason", "failure_reason"), ("failureNotes", "failure_notes"), ("notes", "notes")]
    for key, attr in mapping:
        if key in body:
            setattr(dp, attr, body.get(key))
    now = timezone.now()
    if next_status == "ARRIVED":
        dp.actual_arrival = now
    if next_status in {"COMPLETED", "FAILED", "SKIPPED", "CANCELLED"}:
        dp.actual_departure = now
    dp.save()

    delivered_order = None
    empties_result = None
    if next_status == "COMPLETED" and dp.order_id:
        delivered_order = Order.objects.select_related("timeline").filter(id=dp.order_id).first()
        if delivered_order:
            delivered_order.pod_recipient_name = str(getattr(dp, "recipient_name", "") or "").strip() or None
            delivered_order.pod_photo_url = str(getattr(dp, "delivery_photo", "") or "").strip() or None
            delivered_order.pod_submitted_at = now
            delivered_order.save(update_fields=["pod_recipient_name", "pod_photo_url", "pod_submitted_at", "updated_at"])
            # The driver's count settles the deposits first, so the finalization below
            # sees a recorded return and leaves the money alone. It gets its own
            # transaction: a problem settling empties must never roll back, or block,
            # the delivery the driver has already made.
            try:
                with transaction.atomic():
                    empties_result = record_collected_empties(
                        order=delivered_order,
                        drop_point=dp,
                        submitted_lines=body.get("returnedEmpties"),
                        performed_by=str(p.get("userId") or "").strip() or None,
                        received_by=str(p.get("name") or "Driver").strip() or "Driver",
                    )
            except Exception:
                logger.exception("Failed to record collected empties for order %s", delivered_order.id)

            try:
                with transaction.atomic():
                    _mark_order_delivered(delivered_order, str(p.get("userId") or "").strip() or None, now)
            except ValueError as e:
                # Keep the stop and POD form retryable when inventory validation fails.
                transaction.set_rollback(True)
                return _err(str(e), 400)
    
    release_inventory = body.get("releaseInventory")
    if isinstance(release_inventory, str):
        normalized_release_inventory = release_inventory.strip().lower()
        parsed_release_inventory = normalized_release_inventory in {"1", "true", "yes", "y", "on"}
    elif release_inventory is None:
        parsed_release_inventory = False
    else:
        parsed_release_inventory = bool(release_inventory)
    # A retry keeps its stock; a terminal failed delivery cancels the PO and must release it.
    should_release_inventory = next_status in {"SKIPPED", "CANCELLED"} or (next_status == "FAILED" and not reschedule_requested) or parsed_release_inventory

    # If drop point is marked as FAILED/SKIPPED/CANCELLED, optionally return items back to inventory
    if next_status in {"FAILED", "SKIPPED", "CANCELLED"} and should_release_inventory and dp.order_id:
        order = Order.objects.prefetch_related("items").filter(id=dp.order_id).first()
        if order:
            user_id = str(p.get("userId") or "").strip() or None
            _release_order_reservations(order, user_id)

    if next_status in {"FAILED", "SKIPPED", "CANCELLED"} and dp.order_id:
        order = Order.objects.select_related("timeline").filter(id=dp.order_id).first()
        if order:
            timeline = getattr(order, "timeline", None)
            if next_status == "FAILED" and reschedule_requested:
                order.status = OrderStatus.RESCHEDULED
                order.loaded_at = None
                order.warehouse_dispatched_at = None
                update_fields = ["status", "loaded_at", "warehouse_dispatched_at", "updated_at"]
                if not order.ready_to_load_at:
                    order.ready_to_load_at = now
                    update_fields.append("ready_to_load_at")
                order.save(update_fields=update_fields)

                if timeline:
                    timeline.delivery_date = rescheduled_delivery_at
                    timeline.save(update_fields=["delivery_date", "updated_at"])
                elif rescheduled_delivery_at is not None:
                    OrderTimeline.objects.create(order=order, delivery_date=rescheduled_delivery_at)
                requeued_to_route_pool = True
            else:
                order.status = OrderStatus.CANCELLED
                order.purchase_order_stage = PurchaseOrderStage.CANCELLED
                order.cancelled_by_user_id = str(p.get("userId") or "").strip() or None
                order.cancelled_by_name = str(p.get("name") or "Driver").strip() or "Driver"
                order.cancellation_reason = cancellation_reason
                order.cancelled_at = now
                # Fix: retain the driver's selected reason on the cancelled order, not only on the stop.
                order.save(update_fields=[
                    "status",
                    "purchase_order_stage",
                    "cancelled_by_user_id",
                    "cancelled_by_name",
                    "cancellation_reason",
                    "cancelled_at",
                    "updated_at",
                ])
                if timeline:
                    if not timeline.cancelled_at:
                        timeline.cancelled_at = now
                    timeline.save(update_fields=["cancelled_at", "updated_at"])
                else:
                    OrderTimeline.objects.create(order=order, cancelled_at=now)

            try:
                order_for_mail = (
                    Order.objects.select_related("customer", "timeline")
                    .prefetch_related("items__product")
                    .get(id=order.id)
                )
                _email_delivery_failed_to_customer(
                    order_for_mail,
                    cancellation_reason or str(getattr(dp, "failure_reason", "") or "").strip(),
                    rescheduled_for=rescheduled_delivery_at if requeued_to_route_pool else None,
                    order_cancelled=not requeued_to_route_pool,
                )
            except Exception:
                logger.exception("Failed to email the delivery outcome for order %s", order.id)

    t = dp.trip
    if defer_within_trip_today:
        with transaction.atomic():
            ordered_drop_points = list(t.drop_points.order_by("sequence", "id"))
            reordered_drop_points = [point for point in ordered_drop_points if point.id != dp.id]
            reordered_drop_points.append(next((point for point in ordered_drop_points if point.id == dp.id), dp))

            for idx, point in enumerate(reordered_drop_points, start=1):
                point.sequence = -idx
            TripDropPoint.objects.bulk_update(reordered_drop_points, ["sequence"])

            for idx, point in enumerate(reordered_drop_points, start=1):
                point.sequence = idx
            TripDropPoint.objects.bulk_update(reordered_drop_points, ["sequence"])

            dp.sequence = len(reordered_drop_points)

    terminal_drop_point_statuses = ["COMPLETED", "FAILED", "SKIPPED", "CANCELLED"]
    actual_total_drop_points = t.drop_points.count()
    effective_total_drop_points = max(_int(t.total_drop_points, 0), actual_total_drop_points)

    t.total_drop_points = effective_total_drop_points
    t.completed_drop_points = t.drop_points.filter(status__in=terminal_drop_point_statuses).count()

    # Completing the last stop no longer completes the trip. The driver confirms
    # that from the trip screen, which is what clears it from their active work.
    if str(t.status or "").upper() != TripStatus.COMPLETED:
        t.status = TripStatus.IN_PROGRESS if t.actual_start_at else TripStatus.PLANNED
        t.actual_end_at = None

    t.save(update_fields=["total_drop_points", "completed_drop_points", "status", "actual_end_at", "updated_at"])
    dp.refresh_from_db()
    order_payload = None
    if delivered_order:
        order_payload = _serialize_order(
            Order.objects.select_related("customer", "timeline").prefetch_related("items__product").get(id=delivered_order.id),
            include_items=False,
        )
    drop_point_payload = _serialize_model(dp)
    stored_delivery_photo = str(getattr(dp, "delivery_photo", "") or "")
    if stored_delivery_photo.startswith("data:"):
        # Fix: an inline POD can be hundreds of kilobytes. It is already stored,
        # so do not echo it twice and risk losing the success response on mobile.
        drop_point_payload.pop("deliveryPhoto", None)
        if isinstance(order_payload, dict) and isinstance(order_payload.get("pod"), dict):
            order_payload["pod"].pop("deliveryPhoto", None)
    return _ok({
        "success": True,
        "dropPoint": drop_point_payload,
        "order": order_payload,
        "requeuedToRoutePool": requeued_to_route_pool,
        "empties": empties_result,
    })


@csrf_exempt
@require_http_methods(["PATCH"])
def trip_stop_update(request: HttpRequest, trip_id: str, stop_id: str) -> JsonResponse:
    return trip_drop_point_update(request, trip_id, stop_id)
