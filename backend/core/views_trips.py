"""Trip planning and assignment endpoints."""

import logging
from datetime import datetime
from typing import Any

from django.db import IntegrityError, transaction
from django.db.models import F, Max, Prefetch, Q
from django.db.models.deletion import ProtectedError
from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from . import views_api as legacy
from .api_utils import (
    error as _err,
    json_body as _json_body,
    ok as _ok,
    to_float_or_none as _to_float_or_none,
)
from .models import (
    DriverStatus,
    InventoryTransaction,
    LocationLog,
    Order,
    OrderDepositRefundClaim,
    OrderItem,
    Product,
    ProductPackaging,
    Replacement,
    RoleType,
    Trip,
    TripDropPoint,
    TripStatus,
    User,
    Vehicle,
    Warehouse,
)

logger = logging.getLogger(__name__)


# Resolved through views_api so tests and runtime overrides that rebind
# these names on views_api keep applying here.


def driver_vehicle_license_error(driver: Any, vehicle: Any) -> str | None:
    return legacy.driver_vehicle_license_error(driver, vehicle)


# Helpers owned by sibling modules. Routing them through views_api keeps
# a single resolution point, so tests that patch there still apply.


def _assign_order_items_to_trip_for_warehouse(*, trip: Trip, order_ids: list[str], warehouse_id: str, performed_by: str | None=None) -> int:
    return legacy._assign_order_items_to_trip_for_warehouse(trip=trip, order_ids=order_ids, warehouse_id=warehouse_id, performed_by=performed_by)


def _build_order_item_trip_assignments_map(order_ids: list[str], *, trip_id: str | None=None) -> dict[str, dict[str, list[dict[str, Any]]]]:
    return legacy._build_order_item_trip_assignments_map(order_ids, trip_id=trip_id)


def _build_order_item_warehouse_allocations_map(order_ids: list[str]) -> dict[str, dict[str, list[dict[str, Any]]]]:
    return legacy._build_order_item_warehouse_allocations_map(order_ids)


def _build_order_warehouse_allocations_map(order_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    return legacy._build_order_warehouse_allocations_map(order_ids)


def _calculate_orders_load_for_warehouse(orders: list[Order], warehouse_id: str | None, allocation_map: dict[str, Any] | None=None) -> tuple[int, float]:
    return legacy._calculate_orders_load_for_warehouse(orders, warehouse_id, allocation_map)


def empties_adjustments_for_orders(order_ids: list[str]) -> dict[str, dict[str, Any]]:
    return legacy.empties_adjustments_for_orders(order_ids)


def _create_staff_notifications(*, title: str, message: str, notification_type: str='INVENTORY', reference_type: str | None=None, reference_id: str | None=None) -> None:
    return legacy._create_staff_notifications(title=title, message=message, notification_type=notification_type, reference_type=reference_type, reference_id=reference_id)


def _create_user_notification(*, user: User | None, title: str, message: str, notification_type: str, reference_type: str | None=None, reference_id: str | None=None) -> None:
    return legacy._create_user_notification(user=user, title=title, message=message, notification_type=notification_type, reference_type=reference_type, reference_id=reference_id)


def _delivery_date_is_past(value: Any) -> bool:
    return legacy._delivery_date_is_past(value)


def _email_trip_assigned_to_driver(trip: Trip) -> None:
    return legacy._email_trip_assigned_to_driver(trip)


def _extract_replacement_meta(notes: Any) -> dict[str, Any]:
    return legacy._extract_replacement_meta(notes)


def _generate_next_trip_number() -> str:
    return legacy._generate_next_trip_number()


def _get_allowed_warehouse_ids_for_staff(user_id: str) -> set[str]:
    return legacy._get_allowed_warehouse_ids_for_staff(user_id)


def _missing_driver_profile_fields(driver: User) -> list[str]:
    return legacy._missing_driver_profile_fields(driver)


def _pagination(request: HttpRequest) -> tuple[int, int, int]:
    return legacy._pagination(request)


def _require_staff(request: HttpRequest) -> tuple[dict[str, Any] | None, JsonResponse | None]:
    return legacy._require_staff(request)


def _require_warehouse_operator(request: HttpRequest) -> tuple[dict[str, Any] | None, JsonResponse | None]:
    return legacy._require_warehouse_operator(request)


def _serialize_model(obj: Any, include: dict[str, Any] | None=None, exclude: set[str] | None=None) -> dict[str, Any]:
    return legacy._serialize_model(obj, include, exclude)


def _serialize_trip(trip: Trip, include_points: bool=True, *, ctx: dict=None) -> dict[str, Any]:
    return legacy._serialize_trip(trip, include_points, ctx=ctx)


def _strip_default_country_suffix(address: Any) -> str:
    return legacy._strip_default_country_suffix(address)


def _vehicle_overload_message(vehicle: Vehicle, assigned_weight: float) -> str | None:
    return legacy._vehicle_overload_message(vehicle, assigned_weight)


def _driver_service_area_error(driver: User, cities) -> str | None:
    if not driver.is_active or driver.driver_status != DriverStatus.ACTIVE:
        return "Selected driver is not active or is on leave"
    allowed = set(driver.service_areas.values_list("city", flat=True))
    # Every delivery destination must be explicitly assigned by an admin.
    excluded = sorted({str(city or "").strip() for city in cities
                       if " ".join(str(city or "").split()).casefold() not in allowed})
    if excluded:
        return "Driver is not assigned to delivery area(s): " + ", ".join(city or "Unspecified city" for city in excluded)
    return None


@csrf_exempt
@require_http_methods(["GET", "POST"])
def trips_collection(request: HttpRequest) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        # Batch-load the complete trip graph used by serialization. Without this,
        # each trip repeats order-item, product, and mixed-case queries until the UI times out.
        drop_points_prefetch = Prefetch(
            "drop_points",
            queryset=TripDropPoint.objects.select_related(
                "order",
                "order__customer",
                "order__timeline",
            ).prefetch_related(
                Prefetch(
                    "order__items",
                    queryset=OrderItem.objects.select_related("product").prefetch_related("mixed_case_components__product"),
                ),
                # Every stop serializes its order's deposit refund claims, and the
                # empties counter reads them again. One batched query for the page
                # replaces two per stop.
                Prefetch(
                    "order__deposit_refund_claims",
                    queryset=OrderDepositRefundClaim.objects.select_related("product", "container_type"),
                    to_attr="_serialized_refund_claims",
                ),
            ).order_by("sequence"),
        )
        qs = (
            Trip.objects.select_related("driver", "vehicle").prefetch_related(drop_points_prefetch).all()
        ).order_by("-created_at")
        tracking_date_raw = str(request.GET.get("trackingDate") or "").strip()
        include_tracking = str(request.GET.get("includeTracking") or "").strip().lower() in {"1", "true", "yes"}
        staff_role = str(staff.get("role") or "").strip().upper()
        staff_user_id = str(staff.get("userId") or "").strip()
        allowed_warehouse_ids: set[str] | None = None
        if staff_role == "WAREHOUSE_STAFF" and staff_user_id:
            allowed_warehouse_ids = set(
                _get_allowed_warehouse_ids_for_staff(staff_user_id)
            )
            if not allowed_warehouse_ids:
                return _ok({"success": True, "trips": [], "total": 0, "page": page, "pageSize": size, "totalPages": 0})
            # Show trips directly tied to the staff's warehouse assignments
            # and trips that carry orders allocated to those same warehouses.
            reserved_order_ids = list(
                OrderItem.objects.filter(
                    id__in=InventoryTransaction.objects.filter(
                        reference_type="order_item_reserve",
                        type="RESERVE",
                        warehouse_id__in=list(allowed_warehouse_ids),
                    ).values_list("reference_id", flat=True)
                ).values_list("order_id", flat=True)
            )
            qs = qs.filter(
                Q(warehouse_id__in=list(allowed_warehouse_ids))
                | Q(drop_points__order_id__in=reserved_order_ids)
            ).distinct()
        requested_warehouse_id = str(request.GET.get("warehouseId") or "").strip()
        if requested_warehouse_id:
            if allowed_warehouse_ids is not None and requested_warehouse_id not in allowed_warehouse_ids:
                return _err("Forbidden", 403)
            qs = qs.filter(warehouse_id=requested_warehouse_id)

        tracking_date = None
        if tracking_date_raw:
            try:
                tracking_date = datetime.fromisoformat(tracking_date_raw).date()
            except ValueError:
                return _err("Invalid trackingDate. Expected YYYY-MM-DD")

        if request.GET.get("status"):
            qs = qs.filter(status=request.GET.get("status"))
        if tracking_date:
            qs = qs.filter(
                Q(planned_start_at__date=tracking_date)
                | Q(actual_start_at__date=tracking_date)
                | Q(created_at__date=tracking_date)
                | Q(drop_points__actual_arrival__date=tracking_date)
                | Q(drop_points__actual_departure__date=tracking_date)
                | Q(drop_points__order__timeline__delivery_date__date=tracking_date)
                | Q(location_logs__recorded_at__date=tracking_date)
            ).distinct()
        total = qs.count()
        rows = list(qs[off : off + size])

        # Build shared lookup maps once for the whole page instead of once per trip.
        all_order_ids: set[str] = set()
        all_warehouse_ids: set[str] = set()
        all_product_ids: set[str] = set()
        for trip in rows:
            if trip.warehouse_id:
                all_warehouse_ids.add(str(trip.warehouse_id))
            for drop_point in trip.drop_points.all():
                order = getattr(drop_point, "order", None)
                if not order:
                    continue
                all_order_ids.add(str(order.id))
                if order.warehouse_id:
                    all_warehouse_ids.add(str(order.warehouse_id))
                for item in order.items.all():
                    if item.product_id:
                        all_product_ids.add(str(item.product_id))

        order_returns_map: dict[str, list[Replacement]] = {}
        linked_rep_order_ids: set[str] = set()
        linked_rep_order_numbers: set[str] = set()
        if all_order_ids:
            for replacement in Replacement.objects.select_related("order", "order__customer").filter(order_id__in=all_order_ids):
                order_returns_map.setdefault(str(replacement.order_id), []).append(replacement)
                meta = _extract_replacement_meta(getattr(replacement, "notes", ""))
                r_id = str(meta.get("replacementOrderId") or "").strip()
                r_num = str(meta.get("replacementOrderNumber") or "").strip()
                if r_id:
                    linked_rep_order_ids.add(r_id)
                if r_num:
                    linked_rep_order_numbers.add(r_num)

        replacement_order_cache: dict[str, Any] = {}
        if linked_rep_order_ids or linked_rep_order_numbers:
            q_filter = Q()
            if linked_rep_order_ids:
                q_filter |= Q(id__in=linked_rep_order_ids)
            if linked_rep_order_numbers:
                q_filter |= Q(order_number__in=linked_rep_order_numbers)
            for o in Order.objects.filter(q_filter):
                replacement_order_cache[str(o.id)] = o
                if o.order_number:
                    replacement_order_cache[str(o.order_number)] = o

        # Page-wide lookups for replacement serialization. Without these,
        # _serialize_replacement issues up to five queries per replacement
        # (original item by id, the order's items, the replacement product, and
        # the linked replacement order's proof-of-delivery stop).
        replacement_entries = [r for entries in order_returns_map.values() for r in entries]
        linked_order_ids = {str(o.id) for o in replacement_order_cache.values()}
        items_order_ids = set(all_order_ids) | linked_order_ids

        order_items_cache: dict[str, list[OrderItem]] = {}
        order_item_by_id_cache: dict[str, OrderItem] = {}
        if items_order_ids:
            for item in OrderItem.objects.select_related("product").filter(order_id__in=list(items_order_ids)):
                order_items_cache.setdefault(str(item.order_id), []).append(item)
                order_item_by_id_cache[str(item.id)] = item
            # An order with no items must still register as "looked up", or the
            # serializer falls back to querying it one row at a time.
            for order_id in items_order_ids:
                order_items_cache.setdefault(str(order_id), [])

        replacement_product_ids = {
            str(r.replacement_product_id) for r in replacement_entries if r.replacement_product_id
        }
        product_cache = {
            str(p.id): p for p in Product.objects.filter(id__in=list(replacement_product_ids))
        } if replacement_product_ids else {}

        replacement_pod_cache: dict[str, Any] = {}
        if linked_order_ids:
            # Mirrors the serializer's ordering so the chosen stop is identical.
            for order_id in linked_order_ids:
                replacement_pod_cache[order_id] = None
            for stop in (
                TripDropPoint.objects.filter(order_id__in=list(linked_order_ids))
                .exclude(Q(delivery_photo__isnull=True) | Q(delivery_photo=""))
                .order_by("-actual_departure", "-updated_at")
            ):
                key = str(stop.order_id)
                if replacement_pod_cache.get(key) is None:
                    replacement_pod_cache[key] = stop

        serialization_context = {
            "allocations_map": _build_order_item_warehouse_allocations_map(list(all_order_ids)) if all_order_ids else {},
            "all_assignments_map": _build_order_item_trip_assignments_map(list(all_order_ids), trip_id=None) if all_order_ids else {},
            "trip_assignments_map": None,
            "warehouse_cache": {
                str(warehouse.id): warehouse
                for warehouse in Warehouse.objects.filter(id__in=all_warehouse_ids)
            } if all_warehouse_ids else {},
            "packaging_cache": {
                str(packaging.product_id): packaging
                for packaging in ProductPackaging.objects.filter(product_id__in=all_product_ids, is_active=True)
            } if all_product_ids else {},
            # Built once for the page: _serialize_trip falls back to one
            # DepositTransaction query per trip when this is absent.
            "empties_adjustment_map": empties_adjustments_for_orders(list(all_order_ids)) if all_order_ids else {},
            "order_items_cache": order_items_cache,
            "order_item_by_id_cache": order_item_by_id_cache,
            "product_cache": product_cache,
            "replacement_pod_cache": replacement_pod_cache,
            "order_returns_map": order_returns_map,
            "order_cache": replacement_order_cache,
        }
        serialized_rows = [_serialize_trip(trip, ctx=serialization_context) for trip in rows]

        driver_locations: list[dict[str, Any]] = []
        if include_tracking:
            if serialized_rows:
                trip_ids = [row.get("id") for row in serialized_rows if row.get("id")]
                latest_logs_qs = (
                    # Only expose a trip location when its owner matches the assigned driver.
                    LocationLog.objects.filter(
                        trip_id__in=trip_ids,
                        driver_id=F("trip__driver_id"),
                    )
                    .order_by("trip_id", "-recorded_at", "-id")
                )
                if tracking_date:
                    latest_logs_qs = latest_logs_qs.filter(recorded_at__date=tracking_date)

                logs_by_trip: dict[str, list[dict[str, Any]]] = {}
                latest_log_by_trip: dict[str, dict[str, Any]] = {}
                for log in latest_logs_qs:
                    if not log.trip_id:
                        continue
                    row = _serialize_model(log)
                    logs_by_trip.setdefault(log.trip_id, []).append(row)
                    if log.trip_id not in latest_log_by_trip:
                        latest_log_by_trip[log.trip_id] = row

                for trip_row in serialized_rows:
                    trip_id = trip_row.get("id")
                    if not trip_id:
                        continue
                    trip_row["locationLogs"] = logs_by_trip.get(trip_id, [])
                    trip_row["latestLocation"] = latest_log_by_trip.get(trip_id)

            # Fix: expose one latest GPS point per active driver independently of
            # trip status. Completed or unlinked locations must remain visible to
            # authorized admin and warehouse tracking views without exposing routes.
            seen_driver_ids: set[str] = set()
            latest_driver_logs = (
                LocationLog.objects.select_related("driver", "trip", "trip__vehicle")
                .prefetch_related("driver__assigned_vehicles")
                .filter(driver__role=RoleType.DRIVER, driver__is_active=True)
                .order_by("driver_id", "-recorded_at", "-id")
            )
            for log in latest_driver_logs:
                driver_id = str(log.driver_id or "").strip()
                if not driver_id or driver_id in seen_driver_ids:
                    continue
                seen_driver_ids.add(driver_id)
                tracked_vehicle = getattr(log.trip, "vehicle", None) if log.trip else None
                if tracked_vehicle is None:
                    tracked_vehicle = next(
                        (
                            vehicle
                            for vehicle in log.driver.assigned_vehicles.all()
                            if bool(getattr(vehicle, "is_active", False))
                        ),
                        None,
                    )
                driver_locations.append(
                    {
                        **_serialize_model(log),
                        "driverId": driver_id,
                        "driverName": str(getattr(log.driver, "name", "") or "Driver"),
                        "tripId": str(log.trip_id or "").strip() or None,
                        "tripStatus": str(getattr(log.trip, "status", "") or "").strip() or None,
                        "vehiclePlate": str(getattr(tracked_vehicle, "license_plate", "") or "").strip() or None,
                    }
                )

        return _ok(
            {
                "success": True,
                "trips": serialized_rows,
                "driverLocations": driver_locations,
                "total": total,
                "page": page,
                "pageSize": size,
                "totalPages": (total + size - 1) // size,
            }
        )
    body = _json_body(request)
    request_id = str(body.get("requestId") or "").strip()
    if len(request_id) > 120:
        return _err("requestId must be 120 characters or fewer", 400)
    if request_id:
        # A retried create must return the committed trip instead of failing because
        # its orders are now assigned by the first, response-lost attempt.
        existing_trip = Trip.objects.filter(request_id=request_id).first()
        if existing_trip:
            if str(existing_trip.created_by_user_id or "") != str(staff.get("userId") or ""):
                return _err("requestId has already been used", 409)
            existing_trip = Trip.objects.select_related("driver", "vehicle").prefetch_related("drop_points__order").get(id=existing_trip.id)
            return _ok({"success": True, "trip": _serialize_trip(existing_trip)}, 200)
    try:
        driver = User.objects.get(id=str(body.get("driverId", "")), role="DRIVER")
        vehicle = Vehicle.objects.get(id=str(body.get("vehicleId", "")))
    except (User.DoesNotExist, Vehicle.DoesNotExist):
        return _err("Driver or vehicle not found", 404)
    missing_driver_fields = _missing_driver_profile_fields(driver)
    if missing_driver_fields:
        return _err(
            "Driver cannot be assigned to trip because driver's license is not yet verified or filled out. Missing/Invalid: " + ", ".join(missing_driver_fields),
            400,
        )
    license_error = driver_vehicle_license_error(driver, vehicle)
    if license_error:
        return _err(license_error, 400)
    requested_order_ids = [str(oid) for oid in (body.get("orderIds") or []) if str(oid).strip()]
    requested_warehouse_id = str(body.get("warehouseId") or "").strip()
    if not requested_warehouse_id:
        return _err("warehouseId is required", 400)

    staff_role = str(staff.get("role") or "").strip().upper()
    staff_user_id = str(staff.get("userId") or "").strip()
    if staff_role != "WAREHOUSE_STAFF":
        return _err("Only warehouse staff can create trips", 403)
    if staff_role == "WAREHOUSE_STAFF" and staff_user_id:
        allowed_warehouse_ids = set(
            _get_allowed_warehouse_ids_for_staff(staff_user_id)
        )
        if requested_warehouse_id not in allowed_warehouse_ids:
            return _err("Forbidden: trip warehouse is outside your assigned warehouse scope", 403)

    orders_to_assign = list(
        Order.objects.select_related("timeline").filter(id__in=requested_order_ids).prefetch_related("items__product").all()
    )
    orders_by_id = {str(order.id): order for order in orders_to_assign}
    missing_order_ids = [oid for oid in requested_order_ids if oid not in orders_by_id]
    if missing_order_ids:
        return _err("Some orders were not found", 404)
    overdue_orders = [
        str(order.order_number)
        for order in orders_to_assign
        if getattr(order, "timeline", None)
        and order.timeline.delivery_date
        and _delivery_date_is_past(order.timeline.delivery_date)
    ]
    if overdue_orders:
        return _err(
            "Order(s) have a passed delivery date and must be rescheduled before trip assignment: "
            + ", ".join(overdue_orders),
            409,
        )

    order_allocations_map = _build_order_warehouse_allocations_map(requested_order_ids)
    incompatible_orders: list[str] = []
    for order_id in requested_order_ids:
        order = orders_by_id.get(order_id)
        if not order:
            continue
        allowed_order_warehouse_ids = set()
        direct_order_warehouse_id = str(getattr(order, "warehouse_id", "") or "").strip()
        if direct_order_warehouse_id:
            allowed_order_warehouse_ids.add(direct_order_warehouse_id)
        for allocation in order_allocations_map.get(order_id, []):
            wid = str((allocation or {}).get("warehouseId") or "").strip()
            if wid:
                allowed_order_warehouse_ids.add(wid)

        # Enforce warehouse-leg correctness for split orders and direct-bound orders.
        # Orders with no warehouse binding at all are not eligible for trip assignment.
        if not allowed_order_warehouse_ids or requested_warehouse_id not in allowed_order_warehouse_ids:
            incompatible_orders.append(str(getattr(order, "order_number", order_id)))

    if incompatible_orders:
        return _err(
            "Order(s) are not allocated to the selected warehouse: " + ", ".join(incompatible_orders),
            400,
        )
    active_assignment_statuses = ["PENDING", "ARRIVED", "IN_TRANSIT", "IN_PROGRESS"]
    already_assigned_order_ids = set(
        TripDropPoint.objects.filter(
            order_id__in=requested_order_ids,
            status__in=active_assignment_statuses,
        ).values_list("order_id", flat=True)
    )
    if already_assigned_order_ids:
        assigned_orders = list(
            Order.objects.filter(id__in=already_assigned_order_ids).values_list("order_number", flat=True)
        )
        return _err(
            f"Order(s) already assigned to a trip: {', '.join(assigned_orders or sorted(already_assigned_order_ids))}",
            400,
        )

    # Validate the complete rated capacity before entering the creation transaction.
    _, new_orders_weight = _calculate_orders_load_for_warehouse(orders_to_assign, requested_warehouse_id)
    overload_message = _vehicle_overload_message(vehicle, new_orders_weight)
    if overload_message:
        return _err(overload_message, 400)

    planned_start_at = None
    planned_start_raw = str(body.get("plannedStartAt") or "").strip()
    if planned_start_raw:
        try:
            planned_start_at = datetime.fromisoformat(planned_start_raw.replace("Z", "+00:00"))
        except ValueError:
            return _err("Invalid plannedStartAt. Expected ISO date/time (e.g. YYYY-MM-DD)", 400)

    trip = None
    trip_was_created = False
    for _ in range(5):
        try:
            with transaction.atomic():
                # Fix: lock the vehicle and repeat validation inside the write
                # transaction so simultaneous trip requests cannot bypass capacity.
                # Share the driver lock with admin area updates to prevent stale authorization.
                driver = User.objects.select_for_update().get(id=driver.id)
                locked_vehicle = Vehicle.objects.select_for_update().get(id=vehicle.id)
                if str(locked_vehicle.driver_id or '') != str(driver.id):
                    return _err('Selected vehicle is not assigned to the selected driver', 400)
                if not locked_vehicle.is_active or locked_vehicle.status != 'AVAILABLE':
                    return _err('Selected vehicle is not available for a new trip', 409)
                area_error = _driver_service_area_error(driver, [order.shipping_city for order in orders_to_assign])
                if area_error:
                    return _err(area_error, 400)
                locked_overload_message = _vehicle_overload_message(locked_vehicle, new_orders_weight)
                if locked_overload_message:
                    transaction.set_rollback(True)
                    return _err(locked_overload_message, 400)
                trip = Trip.objects.create(
                    trip_number=_generate_next_trip_number(),
                    request_id=request_id or None,
                    driver=driver,
                    vehicle=vehicle,
                    warehouse_id=requested_warehouse_id,
                    created_by_user_id=staff_user_id or None,
                    status=body.get("status") or TripStatus.PLANNED,
                    planned_start_at=planned_start_at,
                    notes=body.get("notes"),
                )
                seq = 1
                for oid in requested_order_ids:
                    order = orders_by_id.get(str(oid))
                    if not order:
                        continue
                    drop_latitude = _to_float_or_none(order.shipping_latitude or getattr(order.customer, "latitude", None))
                    drop_longitude = _to_float_or_none(order.shipping_longitude or getattr(order.customer, "longitude", None))
                    TripDropPoint.objects.create(
                        trip=trip,
                        order=order,
                        sequence=seq,
                        location_name=(order.shipping_name or f"Order {order.order_number}"),
                        address=_strip_default_country_suffix(order.shipping_address or "Address"),
                        city=(order.shipping_city or "City"),
                        province=(order.shipping_province or "Province"),
                        zip_code=(order.shipping_zip_code or "00000"),
                        latitude=drop_latitude,
                        longitude=drop_longitude,
                        contact_name=(order.shipping_name or None),
                        contact_phone=(order.shipping_phone or None),
                    )
                    seq += 1
                _assign_order_items_to_trip_for_warehouse(
                    trip=trip,
                    order_ids=requested_order_ids,
                    warehouse_id=requested_warehouse_id,
                    performed_by=staff_user_id or None,
                )
            trip_was_created = True
            break
        except IntegrityError:
            # A concurrent retry may have committed this request while this
            # transaction waited on the unique request key.
            if request_id:
                trip = Trip.objects.filter(request_id=request_id).first()
                if trip:
                    break
            trip = None
            continue

    if not trip:
        return _err("Failed to create trip number. Please try again.", 409)

    trip.total_drop_points = trip.drop_points.count()
    trip.save(update_fields=["total_drop_points", "updated_at"])
    trip = Trip.objects.select_related("driver", "vehicle").prefetch_related("drop_points__order").get(id=trip.id)
    if trip_was_created:
        actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
        _create_staff_notifications(
            title="Trip created",
            message=f"{actor_name} created trip {trip.trip_number} for driver {driver.name}.",
            notification_type="TRIP",
            reference_type="trip",
            reference_id=trip.id,
        )
        # Send the assignment directly to the driver who owns this trip.
        _create_user_notification(
            user=trip.driver,
            title="New trip assigned",
            message=f"You were assigned to trip {trip.trip_number} with {trip.total_drop_points} delivery stop(s).",
            notification_type="TRIP",
            reference_type="trip",
            reference_id=trip.id,
        )
        try:
            _email_trip_assigned_to_driver(trip)
        except Exception:
            logger.exception("Failed to email the trip assignment for %s", trip.id)
    return _ok({"success": True, "trip": _serialize_trip(trip)}, 201 if trip_was_created else 200)


@csrf_exempt
@require_http_methods(["DELETE", "PATCH"])
def trip_detail(request: HttpRequest, trip_id: str) -> JsonResponse:
    # Fleet/trip mutations belong to the warehouse; list endpoints retain monitoring access.
    staff, err = _require_warehouse_operator(request)
    if err:
        return err

    trip = Trip.objects.filter(id=trip_id).first()
    if not trip:
        return _err("Trip not found", 404)
    if str(trip.warehouse_id or '') not in {str(value) for value in _get_allowed_warehouse_ids_for_staff(str(staff.get('userId') or ''))}:
        return _err('Trip is outside your assigned warehouse scope', 403)

    if request.method == "PATCH":
        if str(trip.status or "").upper() != TripStatus.PLANNED:
            return _err("Only planned trips can be edited", 409)
        body = _json_body(request)
        add_order_ids = [str(oid).strip() for oid in (body.get("addOrderIds") or []) if str(oid).strip()]
        remove_drop_point_ids = [str(did).strip() for did in (body.get("removeDropPointIds") or []) if str(did).strip()]
        assign_warehouse_legs = bool(body.get("assignWarehouseLegs"))
        assign_warehouse_id = str(body.get("assignWarehouseId") or "").strip()
        requested_driver_id = str(body.get("driverId") or "").strip()
        requested_vehicle_id = str(body.get("vehicleId") or "").strip()
        driver_change_requested = "driverId" in body or "vehicleId" in body
        driver_changed = False
        next_driver = None
        next_vehicle = None

        if driver_change_requested:
            if not requested_driver_id or not requested_vehicle_id:
                return _err("driverId and vehicleId are required when changing the trip driver", 400)
            try:
                next_driver = User.objects.get(id=requested_driver_id, role=RoleType.DRIVER)
                next_vehicle = Vehicle.objects.get(id=requested_vehicle_id)
            except (User.DoesNotExist, Vehicle.DoesNotExist):
                return _err("Driver or vehicle not found", 404)
            missing_driver_fields = _missing_driver_profile_fields(next_driver)
            if missing_driver_fields:
                return _err(
                    "Selected driver profile is incomplete. Missing: " + ", ".join(missing_driver_fields),
                    400,
                )
            license_error = driver_vehicle_license_error(next_driver, next_vehicle)
            if license_error:
                return _err(license_error, 400)
            if str(next_vehicle.driver_id or "").strip() != str(next_driver.id or "").strip():
                return _err("Selected vehicle is not assigned to the selected driver", 400)
            driver_changed = (
                str(trip.driver_id or "").strip() != str(next_driver.id or "").strip()
                or str(trip.vehicle_id or "").strip() != str(next_vehicle.id or "").strip()
            )

        if not add_order_ids and not remove_drop_point_ids and not assign_warehouse_legs and not driver_changed:
            return _err("No trip changes provided", 400)

        terminal_drop_point_statuses = {"COMPLETED", "FAILED", "SKIPPED", "CANCELLED"}

        with transaction.atomic():
            existing_drop_points_count = TripDropPoint.objects.select_for_update().filter(trip_id=trip.id).count()
            assignment_driver = User.objects.select_for_update().get(id=(next_driver or trip.driver).id)
            destination_cities = list(TripDropPoint.objects.filter(trip=trip).exclude(id__in=remove_drop_point_ids).values_list('city', flat=True))
            destination_cities.extend(Order.objects.filter(id__in=add_order_ids).values_list('shipping_city', flat=True))
            area_error = _driver_service_area_error(assignment_driver, destination_cities)
            if area_error:
                return _err(area_error, 400)
            projected_drop_points_count = existing_drop_points_count - len(remove_drop_point_ids)
            if add_order_ids:
                existing_order_ids_on_trip = set(
                    TripDropPoint.objects.filter(trip_id=trip.id).values_list("order_id", flat=True)
                )
                deduplicated_add_order_ids = {
                    oid for oid in add_order_ids if oid not in existing_order_ids_on_trip
                }
                projected_drop_points_count += len(deduplicated_add_order_ids)

            if projected_drop_points_count <= 0:
                return _err("A trip must keep at least one drop point", 409)

            if remove_drop_point_ids:
                drop_points_to_remove = list(
                    TripDropPoint.objects.select_for_update().filter(trip_id=trip.id, id__in=remove_drop_point_ids)
                )
                found_ids = {str(dp.id) for dp in drop_points_to_remove}
                missing_ids = [dpid for dpid in remove_drop_point_ids if dpid not in found_ids]
                if missing_ids:
                    return _err("Some drop points were not found in this trip", 404)
                blocked = [
                    dp for dp in drop_points_to_remove if str(dp.status or "").upper() in terminal_drop_point_statuses
                ]
                if blocked:
                    return _err("Completed/terminal drop points cannot be removed", 409)
                TripDropPoint.objects.filter(id__in=[dp.id for dp in drop_points_to_remove]).delete()

            requested_add_order_ids = list(add_order_ids)
            if add_order_ids:
                existing_order_ids_on_trip = set(
                    TripDropPoint.objects.filter(trip_id=trip.id).values_list("order_id", flat=True)
                )
                duplicate_on_trip = [oid for oid in add_order_ids if oid in existing_order_ids_on_trip]
                if duplicate_on_trip and not assign_warehouse_legs:
                    return _err("Some orders are already in this trip", 409)
                add_order_ids = [oid for oid in add_order_ids if oid not in existing_order_ids_on_trip]

                active_assignment_statuses = ["PENDING", "ARRIVED", "IN_TRANSIT", "IN_PROGRESS"]
                already_assigned_order_ids = set(
                    TripDropPoint.objects.filter(
                        order_id__in=add_order_ids,
                        status__in=active_assignment_statuses,
                    )
                    .exclude(trip_id=trip.id)
                    .values_list("order_id", flat=True)
                )
                if already_assigned_order_ids:
                    assigned_orders = list(
                        Order.objects.filter(id__in=already_assigned_order_ids).values_list("order_number", flat=True)
                    )
                    return _err(
                        f"Order(s) already assigned to another trip: {', '.join(assigned_orders or sorted(already_assigned_order_ids))}",
                        400,
                    )

                orders_map = {
                    str(order.id): order
                    for order in Order.objects.select_related("customer", "timeline").filter(id__in=add_order_ids)
                }
                missing_order_ids = [oid for oid in add_order_ids if oid not in orders_map]
                if missing_order_ids:
                    return _err("Some orders were not found", 404)
                overdue_orders = [
                    str(order.order_number)
                    for order in orders_map.values()
                    if getattr(order, "timeline", None)
                    and order.timeline.delivery_date
                    and _delivery_date_is_past(order.timeline.delivery_date)
                ]
                if overdue_orders:
                    return _err(
                        "Order(s) have a passed delivery date and must be rescheduled before trip assignment: "
                        + ", ".join(overdue_orders),
                        409,
                    )

                staff_role = str(staff.get("role") or "").strip().upper()
                staff_user_id = str(staff.get("userId") or "").strip()
                if staff_role == "WAREHOUSE_STAFF" and staff_user_id:
                    allowed_warehouse_ids = set(
                        _get_allowed_warehouse_ids_for_staff(staff_user_id)
                    )
                    if not allowed_warehouse_ids:
                        return _err("Forbidden: no warehouse assignment found for this staff", 403)
                    order_allocations_map = _build_order_warehouse_allocations_map(add_order_ids)
                    inaccessible_orders: list[str] = []
                    for order_id in add_order_ids:
                        order = orders_map.get(order_id)
                        if not order:
                            continue
                        order_warehouse_ids = set()
                        direct_order_warehouse_id = str(getattr(order, "warehouse_id", "") or "").strip()
                        if direct_order_warehouse_id:
                            order_warehouse_ids.add(direct_order_warehouse_id)
                        for allocation in order_allocations_map.get(order_id, []):
                            wid = str((allocation or {}).get("warehouseId") or "").strip()
                            if wid:
                                order_warehouse_ids.add(wid)
                        if not order_warehouse_ids.intersection(allowed_warehouse_ids):
                            inaccessible_orders.append(str(getattr(order, "order_number", order_id)))
                    if inaccessible_orders:
                        return _err(
                            "Order(s) are outside your warehouse scope: " + ", ".join(inaccessible_orders),
                            403,
                        )

                max_sequence = (
                    TripDropPoint.objects.filter(trip_id=trip.id).aggregate(max_seq=Max("sequence")).get("max_seq") or 0
                )
                next_sequence = int(max_sequence)
                for order_id in add_order_ids:
                    order = orders_map.get(order_id)
                    if not order:
                        continue
                    next_sequence += 1
                    drop_latitude = _to_float_or_none(order.shipping_latitude or getattr(order.customer, "latitude", None))
                    drop_longitude = _to_float_or_none(order.shipping_longitude or getattr(order.customer, "longitude", None))
                    TripDropPoint.objects.create(
                        trip=trip,
                        order=order,
                        sequence=next_sequence,
                        status="PENDING",
                        location_name=(order.shipping_name or f"Order {order.order_number}"),
                        address=_strip_default_country_suffix(order.shipping_address or "Address"),
                        city=(order.shipping_city or "City"),
                        province=(order.shipping_province or "Province"),
                        zip_code=(order.shipping_zip_code or "00000"),
                        latitude=drop_latitude,
                        longitude=drop_longitude,
                        contact_name=(order.shipping_name or None),
                        contact_phone=(order.shipping_phone or None),
                    )

            if assign_warehouse_legs and requested_add_order_ids:
                target_warehouse_id = assign_warehouse_id or str(getattr(trip, "warehouse_id", "") or "").strip()
                if target_warehouse_id:
                    staff_role = str(staff.get("role") or "").strip().upper()
                    staff_user_id = str(staff.get("userId") or "").strip()
                    if staff_role == "WAREHOUSE_STAFF" and staff_user_id:
                        allowed_warehouse_ids = set(_get_allowed_warehouse_ids_for_staff(staff_user_id))
                        if target_warehouse_id not in allowed_warehouse_ids:
                            return _err("Forbidden: cannot assign allocation for this warehouse", 403)
                    _assign_order_items_to_trip_for_warehouse(
                        trip=trip,
                        order_ids=requested_add_order_ids,
                        warehouse_id=target_warehouse_id,
                        performed_by=staff_user_id or None,
                    )

            # Enforce full rated vehicle capacity on trip edits as well.
            selected_vehicle = next_vehicle if (driver_changed and next_vehicle is not None) else trip.vehicle
            if selected_vehicle:
                locked_vehicle = Vehicle.objects.select_for_update().get(id=selected_vehicle.id)
                trip_order_ids = list(
                    TripDropPoint.objects.filter(trip_id=trip.id)
                    .exclude(order_id__isnull=True)
                    .values_list("order_id", flat=True)
                    .distinct()
                )
                trip_orders = list(Order.objects.filter(id__in=trip_order_ids).prefetch_related(
                    "items__product",
                    "items__mixed_case_components__product",
                ))
                _, trip_total_weight = _calculate_orders_load_for_warehouse(
                    trip_orders,
                    str(getattr(trip, "warehouse_id", "") or "").strip() or None,
                )
                overload_message = _vehicle_overload_message(locked_vehicle, trip_total_weight)
                if overload_message:
                    # Fix: edits before this check must roll back with the overload response.
                    transaction.set_rollback(True)
                    return _err(overload_message, 400)

            reordered_drop_points = list(TripDropPoint.objects.filter(trip_id=trip.id).order_by("sequence", "id"))
            for idx, point in enumerate(reordered_drop_points, start=1):
                if point.sequence != idx:
                    point.sequence = idx
            if reordered_drop_points:
                TripDropPoint.objects.bulk_update(reordered_drop_points, ["sequence"])

            total_drop_points = TripDropPoint.objects.filter(trip_id=trip.id).count()
            completed_drop_points = TripDropPoint.objects.filter(
                trip_id=trip.id,
                status__in=list(terminal_drop_point_statuses),
            ).count()
            update_fields = ["total_drop_points", "completed_drop_points", "updated_at"]
            if driver_changed and next_driver and next_vehicle:
                trip.driver = next_driver
                trip.vehicle = next_vehicle
                update_fields.extend(["driver", "vehicle"])
            trip.total_drop_points = total_drop_points
            trip.completed_drop_points = completed_drop_points
            trip.save(update_fields=update_fields)

        actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
        update_summary_parts = [
            f"+{len(add_order_ids)} added",
            f"-{len(remove_drop_point_ids)} removed",
        ]
        if driver_changed and next_driver and next_vehicle:
            next_driver_name = str(getattr(next_driver, "name", "") or "").strip() or "Driver"
            next_vehicle_label = str(getattr(next_vehicle, "license_plate", "") or "").strip() or "vehicle"
            update_summary_parts.append(f"driver changed to {next_driver_name} ({next_vehicle_label})")
        _create_staff_notifications(
            title="Trip updated",
            message=(
                f"{actor_name} updated trip {trip.trip_number}: "
                + ", ".join(update_summary_parts)
                + "."
            ),
            notification_type="TRIP",
            reference_type="trip",
            reference_id=trip.id,
        )
        if driver_changed and next_driver:
            # Notify only the newly assigned driver when trip ownership changes.
            _create_user_notification(
                user=next_driver,
                title="Trip assigned to you",
                message=f"You were assigned to trip {trip.trip_number}.",
                notification_type="TRIP",
                reference_type="trip",
                reference_id=trip.id,
            )
        trip = Trip.objects.select_related("driver", "vehicle").prefetch_related("drop_points__order").get(id=trip.id)
        return _ok({"success": True, "trip": _serialize_trip(trip)})

    if str(trip.status or "").upper() != TripStatus.PLANNED:
        return _err("Only planned trips can be deleted", 409)

    trip_number = trip.trip_number

    try:
        # Explicitly delete related objects first to ensure clean deletion
        with transaction.atomic():
            # Delete drop points
            TripDropPoint.objects.filter(trip_id=trip.id).delete()
            # "stops" alias is backed by TripDropPoint in this codebase.
            TripDropPoint.objects.filter(trip_id=trip.id).delete()
            # Delete location logs
            LocationLog.objects.filter(trip_id=trip.id).delete()
            # Delete inventory transactions related to this trip
            InventoryTransaction.objects.filter(
                reference_type="order_item_trip_assign",
                notes__icontains=f'"tripId":"{trip.id}"'
            ).delete()
            # Finally delete the trip
            trip.delete()
    except ProtectedError:
        return _err("Trip cannot be deleted because it is referenced by protected records", 409)
    except Exception as exc:
        return _err(f"Trip delete failed: {str(exc)}", 500)
    
    actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
    _create_staff_notifications(
        title="Trip deleted",
        message=f"{actor_name} deleted trip {trip_number}.",
        notification_type="TRIP",
        reference_type="trip",
        reference_id=trip_id,
    )
    return _ok({"success": True, "message": f"Trip {trip_number} deleted"})


@require_GET
def trip_check(request: HttpRequest, trip_number: str) -> JsonResponse:
    """Check if a trip exists and return its details."""
    staff, err = _require_staff(request)
    if err:
        return err
    
    trip = Trip.objects.filter(trip_number=trip_number).first()
    if not trip:
        return _ok({"exists": False, "message": f"Trip {trip_number} not found"})
    
    # Count related objects
    drop_points_count = TripDropPoint.objects.filter(trip_id=trip.id).count()
    # "stops" alias is backed by TripDropPoint in this codebase.
    stops_count = TripDropPoint.objects.filter(trip_id=trip.id).count()
    location_logs_count = LocationLog.objects.filter(trip_id=trip.id).count()
    
    return _ok({
        "exists": True,
        "trip": {
            "id": trip.id,
            "tripNumber": trip.trip_number,
            "status": trip.status,
            "driverId": trip.driver_id,
            "vehicleId": trip.vehicle_id,
            "warehouseId": trip.warehouse_id,
        },
        "relatedCounts": {
            "dropPoints": drop_points_count,
            "stops": stops_count,
            "locationLogs": location_logs_count,
        }
    })


@csrf_exempt
@require_http_methods(["POST"])
def trip_unassign_items(request: HttpRequest, trip_id: str) -> JsonResponse:
    """Unassign order items from a trip for a specific warehouse."""
    staff, err = _require_staff(request)
    if err:
        return err

    trip = Trip.objects.filter(id=trip_id).first()
    if not trip:
        return _err("Trip not found", 404)

    if str(trip.status or "").upper() != TripStatus.PLANNED:
        return _err("Only planned trips can be modified", 409)

    body = _json_body(request)
    order_id = str(body.get("orderId") or "").strip()
    warehouse_id = str(body.get("warehouseId") or "").strip()
    item_ids = [str(iid).strip() for iid in (body.get("itemIds") or []) if str(iid).strip()]

    if not order_id:
        return _err("orderId is required", 400)
    if not warehouse_id:
        return _err("warehouseId is required", 400)
    if not item_ids:
        return _err("itemIds is required", 400)

    # Verify the order is in this trip
    drop_point = TripDropPoint.objects.filter(trip_id=trip.id, order_id=order_id).first()
    if not drop_point:
        return _err("Order not found in this trip", 404)

    # Delete the ASSIGN transactions for these items
    deleted_count = 0
    with transaction.atomic():
        for item_id in item_ids:
            txs = InventoryTransaction.objects.filter(
                reference_type="order_item_trip_assign",
                reference_id=item_id,
                type="ASSIGN",
                warehouse_id=warehouse_id,
            ).filter(notes__icontains=f'"tripId":"{trip_id}"')
            deleted_count += txs.count()
            txs.delete()

    return _ok({
        "success": True,
        "message": f"Unassigned {deleted_count} items from trip",
        "deletedCount": deleted_count,
    })
