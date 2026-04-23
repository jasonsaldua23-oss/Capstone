import json
import logging
import math
import secrets
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from django.db import transaction
from django.db.models import Q, Sum
from django.conf import settings
from django.core.mail import send_mail
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.forms.models import model_to_dict
from django.http import HttpRequest, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from .auth import TOKEN_NAME, create_token, decode_token, extract_token, hash_password, verify_password
from .models import (
    Customer,
    Driver,
    DriverVehicle,
    DriverSpareStock,
    Feedback,
    Inventory,
    InventoryTransaction,
    LocationLog,
    Notification,
    Order,
    OrderItem,
    OrderLogistics,
    OrderStatus,
    PasswordResetOTP,
    OrderTimeline,
    WarehouseStage,
    Product,
    ProductCategory,
    Return,
    ReturnStatus,
    Role,
    SavedRouteDraft,
    SpareStockTransaction,
    StockBatch,
    Trip,
    TripDropPoint,
    TripStatus,
    User,
    Vehicle,
    VehicleStatus,
    Warehouse,
)


logger = logging.getLogger(__name__)


def _serialize_driver_vehicle_link(link: DriverVehicle) -> dict[str, Any]:
    return {
        "id": link.id,
        "isActive": bool(link.is_active),
        "assignedAt": link.assigned_at.isoformat() if link.assigned_at else None,
        "driverId": link.driver_id,
        "vehicleId": link.vehicle_id,
        "vehicle": _serialize_model(link.vehicle) if getattr(link, "vehicle", None) else None,
        "driver": _serialize_model(link.driver, include={"user": lambda o: _serialize_model(o.user, exclude={"password"})}) if getattr(link, "driver", None) else None,
    }


def _assign_vehicle_to_driver(driver: Driver, vehicle: Vehicle | None) -> None:
    DriverVehicle.objects.filter(driver=driver, is_active=True).update(is_active=False)

    if not vehicle:
        return

    DriverVehicle.objects.filter(vehicle=vehicle, is_active=True).exclude(driver=driver).update(is_active=False)

    existing = DriverVehicle.objects.filter(driver=driver, vehicle=vehicle).order_by("-assigned_at").first()
    if existing:
        existing.is_active = True
        existing.assigned_at = timezone.now()
        existing.save(update_fields=["is_active", "assigned_at"])
        return

    DriverVehicle.objects.create(driver=driver, vehicle=vehicle, is_active=True)


def _camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def _json_body(request: HttpRequest) -> dict[str, Any]:
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return {}


def _ok(data: dict[str, Any], status: int = 200) -> JsonResponse:
    return JsonResponse(data, status=status)


def _err(message: str, status: int = 400) -> JsonResponse:
    return JsonResponse({"success": False, "error": message}, status=status)


def _int(v: Any, default: int) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _to_float_or_none(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_km = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return radius_km * c


def _compute_order_distances(
    orders: list[dict[str, Any]],
    start_latitude: float | None = None,
    start_longitude: float | None = None,
) -> tuple[list[dict[str, Any]], float]:
    previous_lat = _to_float_or_none(start_latitude)
    previous_lng = _to_float_or_none(start_longitude)
    total_distance_km = 0.0
    enriched_orders: list[dict[str, Any]] = []

    for raw_order in orders:
        order_row = dict(raw_order or {})
        order_lat = _to_float_or_none(order_row.get("latitude") or order_row.get("shippingLatitude"))
        order_lng = _to_float_or_none(order_row.get("longitude") or order_row.get("shippingLongitude"))

        if order_lat is None or order_lng is None:
            order_row["distanceKm"] = None
            enriched_orders.append(order_row)
            continue

        if previous_lat is not None and previous_lng is not None:
            segment_distance_km = _haversine_km(previous_lat, previous_lng, order_lat, order_lng)
            order_row["distanceKm"] = round(segment_distance_km, 2)
            total_distance_km += segment_distance_km
        else:
            order_row["distanceKm"] = 0.0

        previous_lat = order_lat
        previous_lng = order_lng
        enriched_orders.append(order_row)

    return enriched_orders, round(total_distance_km, 2)


def _pagination(request: HttpRequest) -> tuple[int, int, int]:
    page = max(1, _int(request.GET.get("page", "1"), 1))
    size = max(1, min(_int(request.GET.get("pageSize", request.GET.get("limit", "20")), 20), 1000))
    return page, size, (page - 1) * size


_ORDER_STATUS_ALIASES: dict[str, str] = {
    "PROCESSING": OrderStatus.PREPARING,
    "PACKED": OrderStatus.PREPARING,
    "DISPATCHED": OrderStatus.OUT_FOR_DELIVERY,
    "READY_FOR_PICKUP": OrderStatus.PREPARING,
    "IN_TRANSIT": OrderStatus.OUT_FOR_DELIVERY,
    "UNAPPROVED": OrderStatus.PENDING,
    "FAILED_DELIVERY": OrderStatus.CANCELLED,
}


def _normalize_order_status(value: Any) -> str:
    raw = str(value or "").strip().upper()
    if not raw:
        return raw
    if raw in {
        OrderStatus.PENDING,
        OrderStatus.CONFIRMED,
        OrderStatus.PREPARING,
        OrderStatus.OUT_FOR_DELIVERY,
        OrderStatus.DELIVERED,
        OrderStatus.CANCELLED,
    }:
        return raw
    return _ORDER_STATUS_ALIASES.get(raw, raw)


def _normalize_replacement_status(value: Any, replacement_mode: Any = None) -> str:
    raw = str(value or "").strip().upper()
    mode = str(replacement_mode or "").strip().upper()
    if not raw:
        return raw
    if raw in {
        ReturnStatus.REPORTED,
        ReturnStatus.IN_PROGRESS,
        ReturnStatus.RESOLVED_ON_DELIVERY,
        ReturnStatus.NEEDS_FOLLOW_UP,
        ReturnStatus.COMPLETED,
    }:
        return raw
    if raw == "REQUESTED":
        return ReturnStatus.REPORTED
    if raw in {"APPROVED", "PICKED_UP", "IN_TRANSIT", "RECEIVED"}:
        return ReturnStatus.IN_PROGRESS
    if raw == "REJECTED":
        return ReturnStatus.NEEDS_FOLLOW_UP
    if raw == "PROCESSED":
        if mode == "SPARE_STOCK_IMMEDIATE":
            return ReturnStatus.RESOLVED_ON_DELIVERY
        return ReturnStatus.COMPLETED
    return raw


def _is_replacement_closed(entry: Return) -> bool:
    normalized = _normalize_replacement_status(entry.status, entry.replacement_mode)
    return normalized in {ReturnStatus.RESOLVED_ON_DELIVERY, ReturnStatus.COMPLETED}


def _serialize_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _serialize_model(obj: Any, include: dict[str, Any] | None = None, exclude: set[str] | None = None) -> dict[str, Any]:
    include = include or {}
    exclude = exclude or set()
    raw = model_to_dict(obj)
    raw["id"] = getattr(obj, "id", raw.get("id"))
    out: dict[str, Any] = {}
    for key, val in raw.items():
        if key in exclude:
            continue
        out[_camel(key)] = _serialize_value(val)
    for key, fn in include.items():
        out[key] = fn(obj)
    return out


def _payload(request: HttpRequest) -> dict[str, Any] | None:
    token = extract_token(request)
    if not token:
        return None
    return decode_token(token)


def _require_auth(request: HttpRequest) -> dict[str, Any] | None:
    return _payload(request)


def _require_staff(request: HttpRequest) -> tuple[dict[str, Any] | None, JsonResponse | None]:
    p = _payload(request)
    if not p:
        return None, _err("Unauthorized", 401)
    if p.get("type") != "staff":
        return None, _err("Forbidden", 403)
    return p, None


def _set_auth_cookie(response: JsonResponse, token: str, remember_me: bool = False) -> None:
    cookie_kwargs = {
        "httponly": True,
        "secure": False,
        "samesite": "Lax",
        "path": "/",
    }
    if remember_me:
        cookie_kwargs["max_age"] = 60 * 60 * 24 * 30
    response.set_cookie(TOKEN_NAME, token, **cookie_kwargs)


def _user_payload(user: User) -> dict[str, Any]:
    return {
        "userId": user.id,
        "email": user.email,
        "name": user.name,
        "avatar": user.avatar,
        "role": user.role.name,
        "type": "staff",
    }


def _customer_payload(customer: Customer) -> dict[str, Any]:
    return {
        "userId": customer.id,
        "email": customer.email,
        "name": customer.name,
        "avatar": customer.avatar,
        "role": "CUSTOMER",
        "type": "customer",
    }


def _serialize_order(order: Order, include_items: bool = True, include_progress: bool = False) -> dict[str, Any]:
    data = _serialize_model(order)
    data["status"] = _normalize_order_status(data.get("status"))
    data["customer"] = _serialize_model(order.customer, exclude={"password"})
    logistics = getattr(order, "logistics", None)
    timeline = getattr(order, "timeline", None)
    data["logistics"] = _serialize_model(logistics) if logistics else None
    data["timeline"] = _serialize_model(timeline) if timeline else None

    # Keep backward-compatible top-level shipping/timeline fields expected by portal UIs.
    if logistics:
        shipping_latitude = logistics.shipping_latitude if logistics.shipping_latitude is not None else order.customer.latitude
        shipping_longitude = logistics.shipping_longitude if logistics.shipping_longitude is not None else order.customer.longitude
        data["shippingName"] = logistics.shipping_name
        data["shippingPhone"] = logistics.shipping_phone
        data["shippingAddress"] = logistics.shipping_address
        data["shippingCity"] = logistics.shipping_city
        data["shippingProvince"] = logistics.shipping_province
        data["shippingZipCode"] = logistics.shipping_zip_code
        data["shippingCountry"] = logistics.shipping_country
        data["shippingLatitude"] = shipping_latitude
        data["shippingLongitude"] = shipping_longitude
    else:
        data["shippingName"] = None
        data["shippingPhone"] = None
        data["shippingAddress"] = None
        data["shippingCity"] = None
        data["shippingProvince"] = None
        data["shippingZipCode"] = None
        data["shippingCountry"] = None
        data["shippingLatitude"] = order.customer.latitude
        data["shippingLongitude"] = order.customer.longitude

    if timeline:
        data["deliveryDate"] = timeline.delivery_date.isoformat() if timeline.delivery_date else None
        data["deliveredAt"] = timeline.delivered_at.isoformat() if timeline.delivered_at else None
    else:
        data["deliveryDate"] = None
        data["deliveredAt"] = None

    if include_items:
        items = []
        for item in order.items.select_related("product").all():
            row = _serialize_model(item)
            row["product"] = _serialize_model(item.product)
            items.append(row)
        data["items"] = items

    assigned_trip = (
        Trip.objects.filter(drop_points__order_id=order.id, driver__isnull=False)
        .select_related("driver__user", "vehicle")
        .order_by("-updated_at")
        .first()
    )
    assigned_driver = getattr(assigned_trip, "driver", None)
    assigned_driver_name = ""
    if assigned_driver:
        assigned_driver_name = str(getattr(getattr(assigned_driver, "user", None), "name", "") or getattr(assigned_driver, "name", "") or "").strip()
    data["isDriverAssigned"] = bool(assigned_driver)
    data["assignedDriverName"] = assigned_driver_name or None
    data["assignedTripId"] = getattr(assigned_trip, "id", None)
    if include_progress:
        progress_trip = (
            Trip.objects.filter(drop_points__order_id=order.id)
            .select_related("driver__user", "vehicle")
            .prefetch_related("drop_points__order")
            .order_by("-updated_at")
            .first()
        )
        progress_drop_point = None
        if progress_trip:
            progress_drop_point = next(
                (dp for dp in progress_trip.drop_points.all() if str(getattr(dp, "order_id", "")) == str(order.id)),
                None,
            )
        data["progress"] = {
            "trip": _serialize_trip(progress_trip, include_points=True) if progress_trip else None,
            "dropPoint": _serialize_model(progress_drop_point) if progress_drop_point else None,
            "pod": {
                "recipientName": getattr(progress_drop_point, "recipient_name", None) if progress_drop_point else None,
                "recipientSignature": getattr(progress_drop_point, "recipient_signature", None) if progress_drop_point else None,
                "deliveryPhoto": getattr(progress_drop_point, "delivery_photo", None) if progress_drop_point else None,
                "actualArrival": progress_drop_point.actual_arrival.isoformat() if progress_drop_point and progress_drop_point.actual_arrival else None,
                "actualDeparture": progress_drop_point.actual_departure.isoformat() if progress_drop_point and progress_drop_point.actual_departure else None,
                "failureReason": getattr(progress_drop_point, "failure_reason", None) if progress_drop_point else None,
                "failureNotes": getattr(progress_drop_point, "failure_notes", None) if progress_drop_point else None,
                "notes": getattr(progress_drop_point, "notes", None) if progress_drop_point else None,
            },
        }
    return data


def _serialize_return(entry: Return) -> dict[str, Any]:
    data = _serialize_model(entry)
    data["status"] = _normalize_replacement_status(data.get("status"), data.get("replacementMode"))
    return data


def _serialize_trip(trip: Trip, include_points: bool = True) -> dict[str, Any]:
    data = _serialize_model(trip)
    data["driver"] = _serialize_model(trip.driver, include={"user": lambda d: _serialize_model(d.user, exclude={"password"})})
    data["vehicle"] = _serialize_model(trip.vehicle)
    warehouse_lat = None
    warehouse_lng = None
    if trip.warehouse_id:
        warehouse = Warehouse.objects.filter(id=trip.warehouse_id).first()
        if warehouse:
            data["warehouse"] = _serialize_model(warehouse)
            warehouse_lat = _to_float_or_none(getattr(warehouse, "latitude", None))
            warehouse_lng = _to_float_or_none(getattr(warehouse, "longitude", None))
    data["warehouseLatitude"] = warehouse_lat
    data["warehouseLongitude"] = warehouse_lng
    if include_points:
        drop_points: list[dict[str, Any]] = []
        for dp in trip.drop_points.select_related("order").order_by("sequence"):
            row = _serialize_model(dp)
            if dp.order_id and dp.order:
                order_items = list(dp.order.items.select_related("product").all())
                order_returns = list(dp.order.returns.all())
                row["orderStatus"] = _normalize_order_status(dp.order.status)
                row["orderNumber"] = dp.order.order_number
                row["order"] = {
                    "id": dp.order.id,
                    "orderNumber": dp.order.order_number,
                    "warehouseStage": str(dp.order.warehouse_stage or WarehouseStage.READY_TO_LOAD),
                    "status": _normalize_order_status(dp.order.status),
                    "totalAmount": dp.order.total_amount,
                    "items": [
                        {
                            "id": item.id,
                            "productId": item.product_id,
                            "quantity": item.quantity,
                            "product": {
                                "sku": item.product.sku if item.product else None,
                                "name": item.product.name if item.product else None,
                            },
                        }
                        for item in order_items
                    ],
                    "returns": [
                        {
                            **_serialize_return(entry),
                            "remainingQuantity": max(
                                _int(
                                    next((item.quantity for item in order_items if item.id == entry.original_order_item_id), 0),
                                    0,
                                )
                                - _int(entry.replacement_quantity, 0),
                                0,
                            ),
                            "isClosed": _is_replacement_closed(entry),
                        }
                        for entry in order_returns
                        if not dp.order_id or str(entry.drop_point_id or "") == str(dp.id)
                    ],
                }

                # Backfill coordinates for old trips where TripDropPoint lat/lng were saved as null.
                if _to_float_or_none(row.get("latitude")) is None or _to_float_or_none(row.get("longitude")) is None:
                    logistics = getattr(dp.order, "logistics", None)
                    fallback_lat = _to_float_or_none(
                        (logistics.shipping_latitude if logistics else None) or getattr(dp.order.customer, "latitude", None)
                    )
                    fallback_lng = _to_float_or_none(
                        (logistics.shipping_longitude if logistics else None) or getattr(dp.order.customer, "longitude", None)
                    )
                    if fallback_lat is not None and fallback_lng is not None:
                        row["latitude"] = fallback_lat
                        row["longitude"] = fallback_lng
            drop_points.append(row)
        data["dropPoints"] = drop_points
    return data


def _serialize_saved_route(route: SavedRouteDraft) -> dict[str, Any]:
    return {
        "id": route.id,
        "date": route.date.isoformat() if route.date else None,
        "warehouseId": route.warehouse_id,
        "warehouseName": route.warehouse_name,
        "city": route.city,
        "totalDistanceKm": float(route.total_distance_km or 0),
        "orderIds": [str(x) for x in (route.order_ids or [])],
        "orders": route.orders_json or [],
        "createdByUserId": route.created_by_user_id,
        "createdAt": route.created_at.isoformat() if route.created_at else None,
        "updatedAt": route.updated_at.isoformat() if route.updated_at else None,
    }


def _warehouse_checklist_complete(order: Order) -> bool:
    return bool(
        order.checklist_items_verified
        and order.checklist_quantity_verified
        and order.checklist_packaging_verified
        and order.checklist_vehicle_assigned
        and order.checklist_driver_assigned
    )


def _normalize_allocation_policy(raw: Any) -> str:
    value = str(raw or "").strip().upper()
    if value == "FIFO":
        return "FIFO"
    return "FEFO"


def _resolve_allocation_policy(body: dict[str, Any]) -> str:
    # Per-order override is supported, but FEFO remains the default for beverage inventory.
    requested = body.get("allocationPolicy")
    if requested:
        return _normalize_allocation_policy(requested)
    configured = getattr(settings, "INVENTORY_ALLOCATION_POLICY", "FEFO")
    return _normalize_allocation_policy(configured)


def _sorted_batches_for_policy(batches: list[StockBatch], policy: str) -> list[StockBatch]:
    if policy == "FIFO":
        return sorted(
            batches,
            key=lambda b: (
                b.receipt_date or timezone.now(),
                b.created_at or timezone.now(),
                b.id,
            ),
        )

    # FEFO: nearest expiry first; if expiry is missing, fall back after dated batches.
    return sorted(
        batches,
        key=lambda b: (
            b.expiry_date is None,
            b.expiry_date or b.receipt_date or timezone.now(),
            b.receipt_date or timezone.now(),
            b.created_at or timezone.now(),
            b.id,
        ),
    )


def _extract_allocation_policy_from_notes(notes: Any) -> str:
    text = str(notes or "")
    marker = "AllocationPolicy="
    idx = text.rfind(marker)
    if idx < 0:
        return "FEFO"
    raw = text[idx + len(marker) :].splitlines()[0].strip()
    return _normalize_allocation_policy(raw)


def _reserve_inventory_for_order_item(
    *,
    product: Product,
    requested_qty: int,
    order: Order,
    order_item: OrderItem,
    warehouse_id: str | None,
    allocation_policy: str,
    performed_by: str | None,
) -> list[dict[str, Any]]:
    if requested_qty <= 0:
        raise ValueError(f"Quantity for product {product.sku} must be greater than zero")

    inventory_qs = Inventory.objects.select_related("warehouse").filter(product=product)
    if warehouse_id:
        inventory_qs = inventory_qs.filter(warehouse_id=warehouse_id)

    inventories = list(inventory_qs)
    if not inventories:
        raise ValueError(f"No inventory found for product {product.sku}")

    inventory_by_id = {inv.id: inv for inv in inventories}
    batches = list(
        StockBatch.objects.select_related("inventory")
        .filter(inventory_id__in=list(inventory_by_id.keys()), quantity__gt=0)
    )
    if not batches:
        raise ValueError(f"No available stock batches for product {product.sku}")

    ordered_batches = _sorted_batches_for_policy(batches, allocation_policy)
    remaining = requested_qty
    allocation_by_inventory: dict[str, int] = {}
    allocation_rows: list[dict[str, Any]] = []

    for batch in ordered_batches:
        if remaining <= 0:
            break
        if batch.quantity <= 0:
            continue

        take_qty = min(batch.quantity, remaining)
        if take_qty <= 0:
            continue

        inventory = inventory_by_id.get(batch.inventory_id)
        if not inventory:
            continue

        allocation_by_inventory[inventory.id] = allocation_by_inventory.get(inventory.id, 0) + take_qty
        allocation_rows.append(
            {
                "batchNumber": batch.batch_number,
                "quantity": take_qty,
                "warehouseId": inventory.warehouse_id,
            }
        )
        remaining -= take_qty

    if remaining > 0:
        raise ValueError(f"Insufficient stock for product {product.sku}. Missing quantity: {remaining}")

    for inventory_id, qty in allocation_by_inventory.items():
        inventory = inventory_by_id.get(inventory_id)
        if not inventory:
            continue
        inventory.reserved_quantity = max(0, int(inventory.reserved_quantity or 0) + qty)
        inventory.save(update_fields=["reserved_quantity", "updated_at"])
        InventoryTransaction.objects.create(
            warehouse=inventory.warehouse,
            product=product,
            type="RESERVE",
            quantity=qty,
            reference_type="order_item_reserve",
            reference_id=order_item.id,
            notes=f"{allocation_policy} reserve for order {order.order_number}",
            performed_by=performed_by,
        )

    return allocation_rows


def _adjust_reserved_for_order_item(
    *,
    order_item: OrderItem,
    operation: str,
    performed_by: str | None,
    consume_qty: int | None = None,
) -> None:
    reserve_rows = list(
        InventoryTransaction.objects.filter(
            reference_type="order_item_reserve",
            reference_id=order_item.id,
        ).values("warehouse_id", "product_id", "type", "quantity")
    )

    if not reserve_rows:
        return

    balances: dict[tuple[str, str], int] = {}
    for row in reserve_rows:
        key = (str(row.get("warehouse_id") or ""), str(row.get("product_id") or ""))
        if not key[0] or not key[1]:
            continue
        qty = _int(row.get("quantity"), 0)
        row_type = str(row.get("type") or "").upper()
        if row_type == "RESERVE":
            balances[key] = balances.get(key, 0) + qty
        elif row_type in {"UNRESERVE", "RESERVE_CONSUMED"}:
            balances[key] = balances.get(key, 0) - qty

    if operation == "consume":
        remaining = max(0, int(consume_qty or 0))
        for (warehouse_id, product_id), balance in balances.items():
            if remaining <= 0:
                break
            if balance <= 0:
                continue
            qty = min(balance, remaining)
            inv = Inventory.objects.filter(warehouse_id=warehouse_id, product_id=product_id).first()
            if not inv:
                continue
            inv.reserved_quantity = max(0, int(inv.reserved_quantity or 0) - qty)
            inv.save(update_fields=["reserved_quantity", "updated_at"])
            InventoryTransaction.objects.create(
                warehouse=inv.warehouse,
                product=order_item.product,
                type="RESERVE_CONSUMED",
                quantity=qty,
                reference_type="order_item_reserve",
                reference_id=order_item.id,
                notes="Reserved quantity consumed on delivery",
                performed_by=performed_by,
            )
            remaining -= qty
        return

    # operation == "release"
    for (warehouse_id, product_id), balance in balances.items():
        if balance <= 0:
            continue
        inv = Inventory.objects.filter(warehouse_id=warehouse_id, product_id=product_id).first()
        if not inv:
            continue
        inv.reserved_quantity = max(0, int(inv.reserved_quantity or 0) - balance)
        inv.save(update_fields=["reserved_quantity", "updated_at"])
        InventoryTransaction.objects.create(
            warehouse=inv.warehouse,
            product=order_item.product,
            type="UNRESERVE",
            quantity=balance,
            reference_type="order_item_reserve",
            reference_id=order_item.id,
            notes="Reserved quantity released on cancellation",
            performed_by=performed_by,
        )


def _finalize_order_inventory_on_delivery(order: Order, performed_by: str | None) -> None:
    items = list(order.items.select_related("product").all())
    for order_item in items:
        policy = _extract_allocation_policy_from_notes(order_item.notes)
        allocations = _allocate_inventory_for_order_item(
            product=order_item.product,
            requested_qty=max(0, int(order_item.quantity or 0)),
            order=order,
            order_item=order_item,
            warehouse_id=str(order.warehouse_id or "").strip() or None,
            allocation_policy=policy,
            performed_by=performed_by,
        )
        _adjust_reserved_for_order_item(
            order_item=order_item,
            operation="consume",
            performed_by=performed_by,
            consume_qty=max(0, int(order_item.quantity or 0)),
        )
        allocation_note = f"Delivered allocation ({policy}): " + ", ".join(
            [f"{row['batchNumber']} x{row['quantity']}" for row in allocations]
        )
        order_item.notes = f"{order_item.notes or ''}\n{allocation_note}".strip()
        order_item.save(update_fields=["notes"])


def _release_order_reservations(order: Order, performed_by: str | None) -> None:
    items = list(order.items.select_related("product").all())
    for order_item in items:
        _adjust_reserved_for_order_item(
            order_item=order_item,
            operation="release",
            performed_by=performed_by,
        )


def _allocate_inventory_for_order_item(
    *,
    product: Product,
    requested_qty: int,
    order: Order,
    order_item: OrderItem,
    warehouse_id: str | None,
    allocation_policy: str,
    performed_by: str | None,
) -> list[dict[str, Any]]:
    if requested_qty <= 0:
        raise ValueError(f"Quantity for product {product.sku} must be greater than zero")

    inventory_qs = Inventory.objects.select_related("warehouse").filter(product=product)
    if warehouse_id:
        inventory_qs = inventory_qs.filter(warehouse_id=warehouse_id)

    inventories = list(inventory_qs)
    if not inventories:
        raise ValueError(f"No inventory found for product {product.sku}")

    inventory_by_id = {inv.id: inv for inv in inventories}
    batches = list(
        StockBatch.objects.select_related("inventory")
        .filter(inventory_id__in=list(inventory_by_id.keys()), quantity__gt=0)
    )
    if not batches:
        raise ValueError(f"No available stock batches for product {product.sku}")

    ordered_batches = _sorted_batches_for_policy(batches, allocation_policy)
    remaining = requested_qty
    allocation_rows: list[dict[str, Any]] = []

    for batch in ordered_batches:
        if remaining <= 0:
            break
        if batch.quantity <= 0:
            continue

        take_qty = min(batch.quantity, remaining)
        if take_qty <= 0:
            continue

        inventory = inventory_by_id.get(batch.inventory_id)
        if not inventory:
            continue

        batch.quantity -= take_qty
        if batch.quantity <= 0:
            batch.status = "DEPLETED"
        batch.save(update_fields=["quantity", "status", "updated_at"])

        inventory.quantity = max(0, int(inventory.quantity) - take_qty)
        inventory.save(update_fields=["quantity", "updated_at"])

        InventoryTransaction.objects.create(
            warehouse=inventory.warehouse,
            product=product,
            type="OUT",
            quantity=take_qty,
            reference_type="order_item",
            reference_id=order_item.id,
            notes=f"{allocation_policy} allocation for order {order.order_number}; batch {batch.batch_number}",
            performed_by=performed_by,
        )

        allocation_rows.append(
            {
                "batchNumber": batch.batch_number,
                "quantity": take_qty,
                "warehouseId": inventory.warehouse_id,
            }
        )
        remaining -= take_qty

    if remaining > 0:
        raise ValueError(f"Insufficient stock for product {product.sku}. Missing quantity: {remaining}")

    return allocation_rows


OTP_EXPIRY_MINUTES = 10
OTP_MAX_ATTEMPTS = 5


def _normalize_email(value: Any) -> str:
    return str(value or "").strip().lower()


def _is_gmail_email(email: str) -> bool:
    return bool(email and email.endswith("@gmail.com") and "@" in email and email.count("@") == 1)


def _staff_email_conflict_message(email: str) -> str | None:
    normalized_email = _normalize_email(email)
    user = User.objects.select_related("role").filter(email=normalized_email).first()
    if not user:
        return None

    return "Invalid credentials"


def _verify_google_token(credential: str) -> dict[str, Any]:
    client_id = getattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "")
    if not client_id:
        raise ValueError("Google OAuth is not configured")
    return google_id_token.verify_oauth2_token(credential, google_requests.Request(), client_id)


def _otp_mail_ready() -> bool:
    return bool(getattr(settings, "OTP_GMAIL_USER", "") and getattr(settings, "OTP_GMAIL_APP_PASSWORD", ""))


def _get_reset_account(account_type: str, email: str) -> User | Customer | None:
    if account_type == "staff":
        return User.objects.filter(email=email, is_active=True).first()
    if account_type == "customer":
        return Customer.objects.filter(email=email, is_active=True).first()
    return None


def _send_reset_otp_email(email: str, otp_code: str) -> None:
    subject = "Ann Ann's Beverages Trading - Password Reset OTP"
    message = (
        "Use this OTP to reset your account password.\n\n"
        f"OTP: {otp_code}\n"
        f"Expires in {OTP_EXPIRY_MINUTES} minutes.\n\n"
        "If you did not request this, you can ignore this email."
    )
    send_mail(
        subject=subject,
        message=message,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[email],
        fail_silently=False,
    )


def _send_email_verification_otp(email: str, otp_code: str) -> None:
    subject = "Ann Ann's Beverages Trading - Email Verification Code"
    message = (
        "Use this code to verify that your Gmail address is active and can receive mail.\n\n"
        f"Verification code: {otp_code}\n"
        f"Expires in {OTP_EXPIRY_MINUTES} minutes.\n\n"
        "If you did not request this, you can ignore this email."
    )
    send_mail(
        subject=subject,
        message=message,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[email],
        fail_silently=False,
    )


def _latest_verified_otp(email: str, account_type: str):
    return (
        PasswordResetOTP.objects.filter(
            email=email,
            account_type=account_type,
            consumed_at__isnull=False,
            verified_at__isnull=False,
        )
        .order_by("-verified_at", "-created_at")
        .first()
    )


def _has_recent_verified_email(email: str, account_type: str) -> bool:
    otp = _latest_verified_otp(email, account_type)
    if not otp:
        return False
    return bool(otp.verified_at and otp.verified_at >= timezone.now() - timedelta(minutes=OTP_EXPIRY_MINUTES))


@csrf_exempt
@require_http_methods(["POST"])
def auth_email_verification_request(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    email = _normalize_email(body.get("email"))
    account_type = str(body.get("accountType", "staff")).strip().lower()

    if not email:
        return _err("Email is required")
    if not _is_gmail_email(email):
        return _err("Only Gmail addresses are allowed")
    if account_type not in {"staff", "customer"}:
        return _err("accountType must be 'staff' or 'customer'")
    if _email_exists_anywhere(email):
        return _err("Email already exists in the system", 409)
    if not _otp_mail_ready():
        return _err("Verification email service is not configured", 500)

    now = timezone.now()
    code = f"{secrets.randbelow(1000000):06d}"
    PasswordResetOTP.objects.filter(email=email, account_type=account_type, consumed_at__isnull=True).update(consumed_at=now)
    otp = PasswordResetOTP.objects.create(
        email=email,
        account_type=account_type,
        otp_hash=hash_password(code),
        expires_at=now + timedelta(minutes=OTP_EXPIRY_MINUTES),
    )
    try:
        _send_email_verification_otp(email, code)
    except Exception:
        otp.consumed_at = now
        otp.save(update_fields=["consumed_at", "updated_at"])
        return _err("Unable to send verification email right now", 500)

    return _ok({"success": True, "message": "Verification code sent."})


@csrf_exempt
@require_http_methods(["POST"])
def auth_email_verification_confirm(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    email = _normalize_email(body.get("email"))
    account_type = str(body.get("accountType", "staff")).strip().lower()
    otp_code = str(body.get("otp", "")).strip()

    if not email:
        return _err("Email is required")
    if not _is_gmail_email(email):
        return _err("Only Gmail addresses are allowed")
    if account_type not in {"staff", "customer"}:
        return _err("accountType must be 'staff' or 'customer'")
    if not otp_code:
        return _err("Verification code is required")

    now = timezone.now()
    otp = (
        PasswordResetOTP.objects.filter(
            email=email,
            account_type=account_type,
            consumed_at__isnull=True,
        )
        .order_by("-created_at")
        .first()
    )
    if not otp or otp.expires_at < now:
        return _err("Invalid or expired verification code", 400)
    if otp.attempt_count >= OTP_MAX_ATTEMPTS:
        return _err("Too many invalid verification attempts. Request a new code.", 429)
    if not verify_password(otp_code, otp.otp_hash):
        otp.attempt_count += 1
        otp.save(update_fields=["attempt_count", "updated_at"])
        return _err("Invalid or expired verification code", 400)

    otp.verified_at = now
    otp.consumed_at = now
    otp.save(update_fields=["verified_at", "consumed_at", "updated_at"])
    PasswordResetOTP.objects.filter(email=email, account_type=account_type, consumed_at__isnull=True).update(consumed_at=now)
    return _ok({"success": True, "message": "Email verified successfully"})


@require_GET
def api_root(_request: HttpRequest) -> JsonResponse:
    return _ok({"success": True, "message": "Django Logistics API", "version": "1.0"})


@require_GET
def health(_request: HttpRequest) -> JsonResponse:
    return _ok({"success": True, "service": "django-backend", "status": "ok"})


@csrf_exempt
@require_http_methods(["POST"])
def auth_login(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    email = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", ""))
    remember_me = bool(body.get("rememberMe", False))
    if not email or not password:
        return _err("Email and password are required")
    try:
        user = User.objects.select_related("role").get(email=email)
    except User.DoesNotExist:
        return _err("Invalid email or password", 401)
    if not user.is_active or not verify_password(password, user.password):
        return _err("Invalid email or password", 401)
    user.last_login_at = timezone.now()
    user.save(update_fields=["last_login_at", "updated_at"])
    payload = _user_payload(user)
    token = create_token(payload, 24 * 30 if remember_me else 24)
    resp = _ok({"success": True, "user": payload, "token": token, "message": "Login successful"})
    _set_auth_cookie(resp, token, remember_me)
    return resp


@csrf_exempt
@require_http_methods(["POST"])
def auth_customer_login(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    email = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", ""))
    remember_me = bool(body.get("rememberMe", False))
    if not email or not password:
        return _err("Email and password are required")
    try:
        customer = Customer.objects.get(email=email)
    except Customer.DoesNotExist:
        return _err("Invalid email or password", 401)
    if not customer.is_active or not verify_password(password, customer.password):
        return _err("Invalid email or password", 401)
    payload = _customer_payload(customer)
    token = create_token(payload, 24 * 30 if remember_me else 24)
    resp = _ok({"success": True, "user": payload, "token": token, "message": "Login successful"})
    _set_auth_cookie(resp, token, remember_me)
    return resp


@csrf_exempt
@require_http_methods(["POST"])
def auth_customer_google(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    credential = str(body.get("credential") or body.get("idToken") or "").strip()
    remember_me = bool(body.get("rememberMe", False))
    if not credential:
        return _err("Google credential is required")

    if not getattr(settings, "GOOGLE_OAUTH_CLIENT_ID", ""):
        return _err("Google OAuth is not configured on the server", 500)

    try:
        claims = _verify_google_token(credential)
    except ValueError:
        return _err("Invalid Google credential", 401)
    except Exception:
        logger.exception("Google customer token verification failed")
        return _err("Google authentication service is temporarily unavailable", 503)

    email = _normalize_email(claims.get("email"))
    if not email:
        return _err("Google account email is unavailable")
    if not bool(claims.get("email_verified")):
        return _err("Google email is not verified", 401)
    if not _is_gmail_email(email):
        return _err("Only Gmail addresses are allowed (example@gmail.com)")

    name = str(claims.get("name") or "").strip() or email.split("@")[0]
    avatar = str(claims.get("picture") or "").strip() or None

    with transaction.atomic():
        customer = Customer.objects.filter(email=email).first()
        created = False

        if customer and not customer.is_active:
            return _err("Account is deactivated", 403)

        if not customer:
            customer = Customer.objects.create(
                email=email,
                password=hash_password(secrets.token_urlsafe(32)),
                name=name,
                avatar=avatar,
            )
            created = True
        else:
            changed_fields: list[str] = []
            if avatar and customer.avatar != avatar:
                customer.avatar = avatar
                changed_fields.append("avatar")
            if changed_fields:
                changed_fields.append("updated_at")
                customer.save(update_fields=changed_fields)

    payload = _customer_payload(customer)
    token = create_token(payload, 24 * 30 if remember_me else 24)
    resp = _ok(
        {
            "success": True,
            "user": payload,
            "token": token,
            "message": "Registration successful" if created else "Login successful",
            "created": created,
        },
        201 if created else 200,
    )
    _set_auth_cookie(resp, token, remember_me)
    return resp


@csrf_exempt
@require_http_methods(["POST"])
def auth_staff_google(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    credential = str(body.get("credential") or body.get("idToken") or "").strip()
    portal = str(body.get("portal") or "").strip().lower()
    remember_me = bool(body.get("rememberMe", False))

    if not credential or portal not in {"driver", "warehouse"}:
        return _err("Invalid credentials", 401)

    if not getattr(settings, "GOOGLE_OAUTH_CLIENT_ID", ""):
        return _err("Google OAuth is not configured on the server", 500)

    try:
        claims = _verify_google_token(credential)
    except ValueError:
        return _err("Invalid credentials", 401)
    except Exception:
        logger.exception("Google staff token verification failed")
        return _err("Google authentication service is temporarily unavailable", 503)

    email = _normalize_email(claims.get("email"))
    if not email or not bool(claims.get("email_verified")):
        return _err("Invalid credentials", 401)
    if not _is_gmail_email(email):
        return _err("Invalid credentials", 401)

    expected_roles = {"driver": {"DRIVER"}, "warehouse": {"WAREHOUSE_STAFF"}}
    user = (
        User.objects.select_related("role")
        .filter(email=email, is_active=True, role__name__in=expected_roles[portal])
        .first()
    )
    if not user:
        return _err("Invalid credentials", 401)

    user.last_login_at = timezone.now()
    user.save(update_fields=["last_login_at", "updated_at"])
    payload = _user_payload(user)
    if portal == "warehouse" and user.role.name != "WAREHOUSE_STAFF":
        return _err("Invalid credentials", 401)
    if portal == "driver" and user.role.name != "DRIVER":
        return _err("Invalid credentials", 401)

    token = create_token(payload, 24 * 30 if remember_me else 24)
    resp = _ok({"success": True, "user": payload, "token": token, "message": "Login successful"})
    _set_auth_cookie(resp, token, remember_me)
    return resp


@csrf_exempt
@require_http_methods(["POST"])
def auth_register(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    name = str(body.get("name", "")).strip()
    email = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", ""))
    if not name or not email or not password:
        return _err("Name, email and password are required")
    if not _is_gmail_email(email):
        return _err("Only Gmail addresses are allowed (example@gmail.com)")
    if Customer.objects.filter(email=email).exists():
        return _err("Email is already registered", 409)
    customer = Customer.objects.create(
        email=email,
        password=hash_password(password),
        name=name,
        phone=body.get("phone"),
        address=body.get("address"),
        city=body.get("city"),
        province=body.get("province"),
        zip_code=body.get("zipCode"),
    )
    payload = _customer_payload(customer)
    token = create_token(payload)
    resp = _ok({"success": True, "user": payload, "token": token, "message": "Registration successful"}, 201)
    _set_auth_cookie(resp, token)
    return resp


@require_GET
def auth_me(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    return _ok({"success": True, "user": p})


@csrf_exempt
@require_http_methods(["POST"])
def auth_logout(_request: HttpRequest) -> JsonResponse:
    resp = _ok({"success": True, "message": "Logout successful"})
    resp.delete_cookie(TOKEN_NAME, path="/")
    return resp


@csrf_exempt
@require_http_methods(["POST"])
def auth_password_reset_request_otp(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    email = _normalize_email(body.get("email"))
    account_type = str(body.get("accountType", "")).strip().lower()

    if not email:
        return _err("Email is required")
    try:
        validate_email(email)
    except ValidationError:
        return _err("Please enter a valid email address")
    if account_type not in {"staff", "customer"}:
        return _err("accountType must be 'staff' or 'customer'")
    if not _otp_mail_ready():
        return _err("OTP email service is not configured", 500)

    account = _get_reset_account(account_type, email)
    if not account:
        return _err("Account not found for this email", 404)

    now = timezone.now()
    code = f"{secrets.randbelow(1000000):06d}"
    PasswordResetOTP.objects.filter(email=email, account_type=account_type, consumed_at__isnull=True).update(consumed_at=now)
    otp = PasswordResetOTP.objects.create(
        email=email,
        account_type=account_type,
        otp_hash=hash_password(code),
        expires_at=now + timedelta(minutes=OTP_EXPIRY_MINUTES),
    )
    try:
        _send_reset_otp_email(email, code)
    except Exception:
        otp.consumed_at = now
        otp.save(update_fields=["consumed_at", "updated_at"])
        return _err("Unable to send OTP email right now", 500)

    return _ok({"success": True, "message": "OTP sent successfully."})


@csrf_exempt
@require_http_methods(["POST"])
def auth_password_reset_reset(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    email = _normalize_email(body.get("email"))
    account_type = str(body.get("accountType", "")).strip().lower()
    otp_code = str(body.get("otp", "")).strip()
    new_password = str(body.get("newPassword", "")).strip()

    if not email:
        return _err("Email is required")
    if account_type not in {"staff", "customer"}:
        return _err("accountType must be 'staff' or 'customer'")
    if not otp_code:
        return _err("OTP is required")
    if len(new_password) < 8:
        return _err("New password must be at least 8 characters")

    now = timezone.now()
    otp = (
        PasswordResetOTP.objects.filter(
            email=email,
            account_type=account_type,
            consumed_at__isnull=True,
        )
        .order_by("-created_at")
        .first()
    )
    if not otp or otp.expires_at < now:
        return _err("Invalid or expired OTP", 400)
    if otp.attempt_count >= OTP_MAX_ATTEMPTS:
        return _err("Too many invalid OTP attempts. Request a new code.", 429)
    if not verify_password(otp_code, otp.otp_hash):
        otp.attempt_count += 1
        otp.save(update_fields=["attempt_count", "updated_at"])
        return _err("Invalid or expired OTP", 400)

    if account_type == "staff":
        account = User.objects.filter(email=email, is_active=True).first()
    else:
        account = Customer.objects.filter(email=email, is_active=True).first()
    if not account:
        return _err("Invalid account", 404)

    account.password = hash_password(new_password)
    account.save(update_fields=["password", "updated_at"])

    otp.verified_at = now
    otp.consumed_at = now
    otp.save(update_fields=["verified_at", "consumed_at", "updated_at"])
    PasswordResetOTP.objects.filter(email=email, account_type=account_type, consumed_at__isnull=True).update(consumed_at=now)

    return _ok({"success": True, "message": "Password reset successful. Please log in."})


@require_GET
def roles_list(request: HttpRequest) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    roles = Role.objects.all().order_by("name")
    return _ok({"success": True, "roles": [_serialize_model(r) for r in roles]})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def users_collection(request: HttpRequest) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = User.objects.select_related("role").all().order_by("-created_at")
        s = str(request.GET.get("search", "")).strip()
        if s:
            qs = qs.filter(Q(name__icontains=s) | Q(email__icontains=s))
        total = qs.count()
        rows = list(qs[off : off + size])
        users = [_serialize_model(u, include={"role": lambda x: _serialize_model(x.role)}, exclude={"password"}) for u in rows]
        return _ok({"success": True, "users": users, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})

    body = _json_body(request)
    email = str(body.get("email", "")).strip().lower()
    name = str(body.get("name", "")).strip()
    password = str(body.get("password", "")).strip()
    role_id = str(body.get("roleId", "")).strip()
    if not email or not name or not password or not role_id:
        return _err("name, email, password and roleId are required")
    if not _is_gmail_email(email):
        return _err("Only Gmail addresses are allowed for staff/driver accounts")
    existing_message = _staff_email_conflict_message(email)
    if existing_message:
        return _err(existing_message, 409)
    if not _has_recent_verified_email(email, "staff"):
        return _err("Please verify this Gmail address before creating the user", 400)
    try:
        role = Role.objects.get(id=role_id)
    except Role.DoesNotExist:
        return _err("Role not found", 404)
    user = User.objects.create(
        email=email,
        password=hash_password(password),
        name=name,
        phone=body.get("phone"),
        avatar=body.get("avatar"),
        role=role,
        is_active=bool(body.get("isActive", True)),
    )
    return _ok({"success": True, "user": _serialize_model(user, include={"role": lambda x: _serialize_model(x.role)}, exclude={"password"})}, 201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
def user_detail(request: HttpRequest, user_id: str) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    try:
        user = User.objects.select_related("role").get(id=user_id)
    except User.DoesNotExist:
        return _err("User not found", 404)
    if request.method == "GET":
        return _ok({"success": True, "user": _serialize_model(user, include={"role": lambda x: _serialize_model(x.role)}, exclude={"password"})})
    if request.method == "DELETE":
        user.delete()
        return _ok({"success": True})
    body = _json_body(request)
    for key, attr in [("name", "name"), ("phone", "phone"), ("avatar", "avatar")]:
        if key in body:
            setattr(user, attr, body.get(key))
    if "isActive" in body:
        user.is_active = bool(body.get("isActive"))
    if body.get("password"):
        user.password = hash_password(str(body["password"]))
    if body.get("roleId"):
        try:
            user.role = Role.objects.get(id=str(body["roleId"]))
        except Role.DoesNotExist:
            return _err("Role not found", 404)
    user.save()
    return _ok({"success": True, "user": _serialize_model(user, include={"role": lambda x: _serialize_model(x.role)}, exclude={"password"})})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def customers_collection(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = Customer.objects.all().order_by("-created_at")
        s = str(request.GET.get("search", "")).strip()
        if s:
            qs = qs.filter(Q(name__icontains=s) | Q(email__icontains=s) | Q(phone__icontains=s))
        total = qs.count()
        rows = list(qs[off : off + size])
        return _ok({"success": True, "customers": [_serialize_model(c, exclude={"password"}) for c in rows], "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    _, err = _require_staff(request)
    if err:
        return err
    body = _json_body(request)
    email = str(body.get("email", "")).strip().lower()
    name = str(body.get("name", "")).strip()
    password = str(body.get("password", "")).strip()
    if not email or not name or not password:
        return _err("name, email and password are required")
    if not _is_gmail_email(email):
        return _err("Only Gmail addresses are allowed for customer accounts")
    if _email_exists_anywhere(email):
        return _err("Email already exists in the system", 409)
    c = Customer.objects.create(
        email=email,
        password=hash_password(password),
        name=name,
        phone=body.get("phone"),
        avatar=body.get("avatar"),
        address=body.get("address"),
        city=body.get("city"),
        province=body.get("province"),
        zip_code=body.get("zipCode"),
        country=body.get("country") or "USA",
        latitude=body.get("latitude"),
        longitude=body.get("longitude"),
        is_active=bool(body.get("isActive", True)),
    )
    return _ok({"success": True, "customer": _serialize_model(c, exclude={"password"})}, 201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
def customer_detail(request: HttpRequest, customer_id: str) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    try:
        c = Customer.objects.get(id=customer_id)
    except Customer.DoesNotExist:
        return _err("Customer not found", 404)
    if request.method == "GET":
        if p.get("type") == "customer" and p.get("userId") != c.id:
            return _err("Forbidden", 403)
        return _ok({"success": True, "customer": _serialize_model(c, exclude={"password"})})
    if p.get("type") != "staff" and p.get("userId") != c.id:
        return _err("Forbidden", 403)
    if request.method == "DELETE":
        c.delete()
        return _ok({"success": True})
    body = _json_body(request)
    mapping = [("name", "name"), ("phone", "phone"), ("avatar", "avatar"), ("address", "address"), ("city", "city"), ("province", "province"), ("zipCode", "zip_code"), ("country", "country"), ("latitude", "latitude"), ("longitude", "longitude")]
    for key, attr in mapping:
        if key in body:
            setattr(c, attr, body.get(key))
    if "isActive" in body and p.get("type") == "staff":
        c.is_active = bool(body.get("isActive"))
    if body.get("password"):
        c.password = hash_password(str(body["password"]))
    c.save()
    return _ok({"success": True, "customer": _serialize_model(c, exclude={"password"})})


@require_GET
def categories_list(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    rows = ProductCategory.objects.filter(is_active=True).order_by("name")
    return _ok({"success": True, "categories": [_serialize_model(r) for r in rows]})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def warehouses_collection(request: HttpRequest) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = Warehouse.objects.all().order_by("name")
        total = qs.count()
        rows = list(qs[off : off + size])
        return _ok({"success": True, "warehouses": [_serialize_model(x) for x in rows], "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    body = _json_body(request)
    required = ["name", "code", "address", "city", "province", "zipCode"]
    for f in required:
        if not body.get(f):
            return _err(f"{f} is required")
    w = Warehouse.objects.create(
        name=body["name"],
        code=body["code"],
        address=body["address"],
        city=body["city"],
        province=body["province"],
        zip_code=body["zipCode"],
        country=body.get("country") or "USA",
        latitude=body.get("latitude"),
        longitude=body.get("longitude"),
        capacity=_int(body.get("capacity"), 1000),
        manager_id=body.get("managerId"),
        is_active=bool(body.get("isActive", True)),
    )
    return _ok({"success": True, "warehouse": _serialize_model(w)}, 201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
def warehouse_detail(request: HttpRequest, warehouse_id: str) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    try:
        w = Warehouse.objects.get(id=warehouse_id)
    except Warehouse.DoesNotExist:
        return _err("Warehouse not found", 404)
    if request.method == "GET":
        return _ok({"success": True, "warehouse": _serialize_model(w)})
    if request.method == "DELETE":
        w.is_active = False
        w.save(update_fields=["is_active", "updated_at"])
        return _ok({"success": True})
    body = _json_body(request)
    mapping = [("name", "name"), ("code", "code"), ("address", "address"), ("city", "city"), ("province", "province"), ("zipCode", "zip_code"), ("country", "country"), ("latitude", "latitude"), ("longitude", "longitude"), ("capacity", "capacity"), ("managerId", "manager_id")]
    for key, attr in mapping:
        if key in body:
            setattr(w, attr, body.get(key))
    if "isActive" in body:
        w.is_active = bool(body.get("isActive"))
    w.save()
    return _ok({"success": True, "warehouse": _serialize_model(w)})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def products_collection(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = Product.objects.select_related("category").all().order_by("name")
        s = str(request.GET.get("search", "")).strip()
        if s:
            qs = qs.filter(Q(name__icontains=s) | Q(sku__icontains=s))
        total = qs.count()
        rows = list(qs[off : off + size])
        product_ids = [x.id for x in rows]
        inventory_rows = list(
            Inventory.objects.filter(product_id__in=product_ids).values(
                "product_id", "quantity", "reserved_quantity"
            )
        )
        inventory_by_product: dict[str, list[dict[str, int]]] = {}
        for inv in inventory_rows:
            pid = str(inv.get("product_id") or "")
            if not pid:
                continue
            inventory_by_product.setdefault(pid, []).append(
                {
                    "quantity": _int(inv.get("quantity"), 0),
                    "reservedQuantity": _int(inv.get("reserved_quantity"), 0),
                }
            )

        products_out = []
        for product in rows:
            row = _serialize_model(
                product,
                include={"category": (lambda o: _serialize_model(o.category) if o.category else None)},
            )
            inventory_entries = inventory_by_product.get(product.id, [])
            available_quantity = sum(
                max(0, _int(item.get("quantity"), 0) - _int(item.get("reservedQuantity"), 0))
                for item in inventory_entries
            )
            row["inventory"] = inventory_entries
            row["availableQuantity"] = available_quantity
            products_out.append(row)

        return _ok({"success": True, "products": products_out, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    _, err = _require_staff(request)
    if err:
        return err
    body = _json_body(request)
    if not body.get("sku") or not body.get("name"):
        return _err("sku and name are required")
    category = None
    if body.get("categoryId"):
        try:
            category = ProductCategory.objects.get(id=str(body["categoryId"]))
        except ProductCategory.DoesNotExist:
            return _err("Category not found", 404)
    prod = Product.objects.create(
        sku=str(body["sku"]).strip(),
        name=str(body["name"]).strip(),
        image_url=body.get("imageUrl"),
        description=body.get("description"),
        category=category,
        unit=body.get("unit") or "piece",
        weight=body.get("weight"),
        dimensions=body.get("dimensions"),
        price=float(body.get("price") or 0),
        is_active=bool(body.get("isActive", True)),
    )
    return _ok({"success": True, "product": _serialize_model(prod, include={"category": (lambda o: _serialize_model(o.category) if o.category else None)})}, 201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
def product_detail(request: HttpRequest, product_id: str) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    try:
        prod = Product.objects.select_related("category").get(id=product_id)
    except Product.DoesNotExist:
        return _err("Product not found", 404)
    if request.method == "GET":
        return _ok({"success": True, "product": _serialize_model(prod, include={"category": (lambda o: _serialize_model(o.category) if o.category else None)})})
    _, err = _require_staff(request)
    if err:
        return err
    if request.method == "DELETE":
        prod.delete()
        return _ok({"success": True})
    body = _json_body(request)
    mapping = [("sku", "sku"), ("name", "name"), ("imageUrl", "image_url"), ("description", "description"), ("unit", "unit"), ("weight", "weight"), ("dimensions", "dimensions"), ("price", "price")]
    for key, attr in mapping:
        if key in body:
            setattr(prod, attr, body.get(key))
    if "isActive" in body:
        prod.is_active = bool(body.get("isActive"))
    if "categoryId" in body:
        if body.get("categoryId"):
            try:
                prod.category = ProductCategory.objects.get(id=str(body["categoryId"]))
            except ProductCategory.DoesNotExist:
                return _err("Category not found", 404)
        else:
            prod.category = None
    prod.save()
    return _ok({"success": True, "product": _serialize_model(prod, include={"category": (lambda o: _serialize_model(o.category) if o.category else None)})})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def inventory_collection(request: HttpRequest) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = Inventory.objects.select_related("warehouse", "product").all().order_by("-updated_at")
        if request.GET.get("warehouseId"):
            qs = qs.filter(warehouse_id=request.GET.get("warehouseId"))
        total = qs.count()
        rows = list(qs[off : off + size])
        data = [_serialize_model(x, include={"warehouse": lambda o: _serialize_model(o.warehouse), "product": lambda o: _serialize_model(o.product)}) for x in rows]
        return _ok({"success": True, "inventory": data, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    body = _json_body(request)
    warehouse_id = str(body.get("warehouseId", "")).strip()
    product_id = str(body.get("productId", "")).strip()
    qty = _int(body.get("quantity"), 0)
    if not warehouse_id or not product_id:
        return _err("warehouseId and productId are required")
    try:
        warehouse = Warehouse.objects.get(id=warehouse_id)
        product = Product.objects.get(id=product_id)
    except (Warehouse.DoesNotExist, Product.DoesNotExist):
        return _err("Warehouse or Product not found", 404)
    item, created = Inventory.objects.get_or_create(
        warehouse=warehouse,
        product=product,
        defaults={"quantity": qty, "reserved_quantity": 0, "min_stock": _int(body.get("minStock"), 10), "max_stock": _int(body.get("maxStock"), 100), "reorder_point": _int(body.get("reorderPoint"), 20), "last_restocked_at": timezone.now()},
    )
    if not created:
        item.quantity += qty
        item.last_restocked_at = timezone.now()
        item.save()
    InventoryTransaction.objects.create(
        warehouse=warehouse,
        product=product,
        type=str(body.get("type") or "IN"),
        quantity=qty,
        reference_type=body.get("referenceType"),
        reference_id=body.get("referenceId"),
        notes=body.get("notes"),
        performed_by=(_payload(request) or {}).get("userId"),
    )
    return _ok({"success": True, "inventory": _serialize_model(item, include={"warehouse": lambda o: _serialize_model(o.warehouse), "product": lambda o: _serialize_model(o.product)})}, 201)


@csrf_exempt
@require_http_methods(["PUT"])
def inventory_detail(request: HttpRequest, inventory_id: str) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    try:
        item = Inventory.objects.select_related("warehouse", "product").get(id=inventory_id)
    except Inventory.DoesNotExist:
        return _err("Inventory not found", 404)
    body = _json_body(request)
    mapping = [("quantity", "quantity"), ("reservedQuantity", "reserved_quantity"), ("minStock", "min_stock"), ("maxStock", "max_stock"), ("reorderPoint", "reorder_point")]
    for key, attr in mapping:
        if key in body:
            setattr(item, attr, _int(body.get(key), getattr(item, attr)))
    item.save()
    return _ok({"success": True, "inventory": _serialize_model(item, include={"warehouse": lambda o: _serialize_model(o.warehouse), "product": lambda o: _serialize_model(o.product)})})


@require_GET
def inventory_transactions_list(request: HttpRequest) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    page, size, off = _pagination(request)
    qs = InventoryTransaction.objects.select_related("warehouse", "product").all().order_by("-created_at")
    total = qs.count()
    rows = list(qs[off : off + size])
    data = [_serialize_model(x, include={"warehouse": lambda o: _serialize_model(o.warehouse), "product": lambda o: _serialize_model(o.product)}) for x in rows]
    return _ok({"success": True, "transactions": data, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def stock_batches_collection(request: HttpRequest) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = StockBatch.objects.select_related("inventory", "inventory__warehouse", "inventory__product").all().order_by("-created_at")
        total = qs.count()
        rows = list(qs[off : off + size])
        data = [_serialize_model(x, include={"inventory": lambda o: _serialize_model(o.inventory, include={"warehouse": lambda i: _serialize_model(i.warehouse), "product": lambda i: _serialize_model(i.product)})}) for x in rows]
        return _ok({"success": True, "stockBatches": data, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    body = _json_body(request)
    qty = _int(body.get("quantity"), 0)
    if qty <= 0:
        return _err("quantity must be > 0")

    expiry_raw = str(body.get("expiryDate") or body.get("expiry_date") or "").strip()
    expiry_date = None
    if expiry_raw:
        try:
            expiry_date = datetime.fromisoformat(expiry_raw.replace("Z", "+00:00"))
        except ValueError:
            return _err("Invalid expiryDate", 400)

    created_by = (_payload(request) or {}).get("userId")

    try:
        with transaction.atomic():
            inv = None
            inventory_id = str(body.get("inventoryId") or "").strip()

            if inventory_id:
                inv = Inventory.objects.select_related("warehouse", "product").filter(id=inventory_id).first()
                if not inv:
                    return _err("Inventory not found", 404)
            else:
                warehouse_id = str(body.get("warehouseId") or "").strip()
                product_id = str(body.get("productId") or "").strip()
                is_new_product = bool(body.get("isNewProduct"))

                if not warehouse_id:
                    return _err("warehouseId is required", 400)

                warehouse = Warehouse.objects.filter(id=warehouse_id).first()
                if not warehouse:
                    return _err("Warehouse not found", 404)

                product = None
                if is_new_product and not product_id:
                    name = str(body.get("productName") or "").strip()
                    if not name:
                        return _err("productName is required", 400)

                    sku = str(body.get("sku") or "").strip()
                    if not sku:
                        sku = f"SKU-{int(timezone.now().timestamp())}-{secrets.token_hex(2).upper()}"

                    if Product.objects.filter(sku=sku).exists():
                        sku = f"{sku}-{secrets.token_hex(1).upper()}"

                    product = Product.objects.create(
                        sku=sku,
                        name=name,
                        image_url=body.get("imageUrl"),
                        description=body.get("description"),
                        unit=str(body.get("unit") or "piece").strip() or "piece",
                        price=float(body.get("price") or 0),
                        is_active=True,
                    )
                else:
                    if not product_id:
                        return _err("productId is required", 400)
                    product = Product.objects.filter(id=product_id).first()
                    if not product:
                        return _err("Product not found", 404)

                threshold = _int(body.get("threshold"), 10)
                inv, created = Inventory.objects.select_related("warehouse", "product").get_or_create(
                    warehouse=warehouse,
                    product=product,
                    defaults={
                        "quantity": 0,
                        "reserved_quantity": 0,
                        "min_stock": max(0, threshold),
                        "max_stock": max(100, threshold * 5 if threshold > 0 else 100),
                        "reorder_point": max(20, threshold * 2 if threshold > 0 else 20),
                        "last_restocked_at": timezone.now(),
                    },
                )

                if not created and "threshold" in body and threshold >= 0:
                    inv.min_stock = threshold

            batch = StockBatch.objects.create(
                batch_number=str(body.get("batchNumber") or f"BATCH-{int(timezone.now().timestamp())}"),
                inventory=inv,
                quantity=qty,
                receipt_date=timezone.now(),
                expiry_date=expiry_date,
                location_label=body.get("locationLabel"),
                status=body.get("status") or "ACTIVE",
                created_by=created_by,
            )

            inv.quantity += qty
            inv.last_restocked_at = timezone.now()
            inv.save(update_fields=["quantity", "min_stock", "last_restocked_at", "updated_at"])

            InventoryTransaction.objects.create(
                warehouse=inv.warehouse,
                product=inv.product,
                type="IN",
                quantity=qty,
                reference_type="stock_batch",
                reference_id=batch.id,
                notes="Stock batch added",
                performed_by=created_by,
            )

            return _ok({"success": True, "stockBatch": _serialize_model(batch)}, 201)
    except Exception as e:
        return _err(str(e), 500)


@csrf_exempt
@require_http_methods(["GET", "POST", "PATCH"])
def vehicles_collection(request: HttpRequest) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = Vehicle.objects.prefetch_related("drivers__driver__user").all().order_by("-created_at")
        if request.GET.get("status"):
            qs = qs.filter(status=request.GET.get("status"))
        total = qs.count()
        rows = list(qs[off : off + size])
        vehicles_data = []
        for vehicle in rows:
            row = _serialize_model(vehicle)
            links = [link for link in vehicle.drivers.all() if link.is_active]
            row["drivers"] = [_serialize_driver_vehicle_link(link) for link in links]
            vehicles_data.append(row)
        return _ok({"success": True, "vehicles": vehicles_data, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    body = _json_body(request)
    if request.method == "POST":
        if not body.get("licensePlate") or not body.get("type"):
            return _err("licensePlate and type are required")
        v = Vehicle.objects.create(
            license_plate=body["licensePlate"],
            type=body["type"],
            color=body.get("color"),
            capacity=body.get("capacity"),
            volume=body.get("volume"),
            status=body.get("status") or VehicleStatus.AVAILABLE,
            mileage=body.get("mileage") or 0,
            is_active=bool(body.get("isActive", True)),
        )
        driver_id = str(body.get("driverId") or "").strip()
        if driver_id:
            driver = Driver.objects.filter(id=driver_id).first()
            if not driver:
                return _err("Driver not found", 404)
            _assign_vehicle_to_driver(driver, v)
        return _ok({"success": True, "vehicle": _serialize_model(v)}, 201)
    vehicle_id = str(body.get("id", "")).strip()
    if not vehicle_id:
        return _err("id is required")
    try:
        v = Vehicle.objects.get(id=vehicle_id)
    except Vehicle.DoesNotExist:
        return _err("Vehicle not found", 404)
    mapping = [("licensePlate", "license_plate"), ("type", "type"), ("color", "color"), ("capacity", "capacity"), ("volume", "volume"), ("status", "status"), ("mileage", "mileage")]
    for key, attr in mapping:
        if key in body:
            setattr(v, attr, body.get(key))
    if "driverId" in body:
        driver_id = str(body.get("driverId") or "").strip()
        if driver_id:
            driver = Driver.objects.filter(id=driver_id).first()
            if not driver:
                return _err("Driver not found", 404)
            _assign_vehicle_to_driver(driver, v)
        else:
            DriverVehicle.objects.filter(vehicle=v, is_active=True).update(is_active=False)
    if "isActive" in body:
        v.is_active = bool(body.get("isActive"))
    v.save()
    return _ok({"success": True, "vehicle": _serialize_model(v)})


@csrf_exempt
@require_http_methods(["DELETE"])
def vehicle_detail(request: HttpRequest, vehicle_id: str) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    try:
        v = Vehicle.objects.get(id=vehicle_id)
    except Vehicle.DoesNotExist:
        return _err("Vehicle not found", 404)
    v.delete()
    return _ok({"success": True})


@csrf_exempt
@require_http_methods(["GET", "POST", "PUT"])
def drivers_collection(request: HttpRequest) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = Driver.objects.select_related("user").prefetch_related("vehicles__vehicle").all().order_by("-created_at")
        if request.GET.get("active") == "true":
            qs = qs.filter(is_active=True)
        total = qs.count()
        rows = list(qs[off : off + size])
        data = []
        for driver in rows:
            row = _serialize_model(driver, include={"user": lambda o: _serialize_model(o.user, exclude={"password"})})
            links = [link for link in driver.vehicles.all() if link.is_active]
            row["vehicles"] = [_serialize_driver_vehicle_link(link) for link in links]
            data.append(row)
        return _ok({"success": True, "drivers": data, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    body = _json_body(request)
    if request.method == "POST":
        user_id = str(body.get("userId", "")).strip()
        if not user_id:
            return _err("userId is required")
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return _err("User not found", 404)
        if hasattr(user, "driver"):
            return _err("User already assigned as driver", 409)
        d = Driver.objects.create(
            user=user,
            license_number=body.get("licenseNumber") or f"DRV-{int(timezone.now().timestamp())}",
            license_type=body.get("licenseType") or "B",
            license_expiry=datetime.fromisoformat(body["licenseExpiry"]) if body.get("licenseExpiry") else timezone.now() + timedelta(days=365),
            license_photo=body.get("licensePhoto"),
            phone=body.get("phone") or user.phone,
            emergency_contact=body.get("emergencyContact"),
            is_active=bool(body.get("isActive", True)),
        )
        return _ok({"success": True, "driver": _serialize_model(d, include={"user": lambda o: _serialize_model(o.user, exclude={"password"})})}, 201)
    driver_id = str(body.get("id", "")).strip()
    if not driver_id:
        return _err("id is required")
    try:
        d = Driver.objects.select_related("user").get(id=driver_id)
    except Driver.DoesNotExist:
        return _err("Driver not found", 404)
    mapping = [
        ("licenseNumber", "license_number"),
        ("licenseType", "license_type"),
        ("licensePhoto", "license_photo"),
        ("phone", "phone"),
        ("emergencyContact", "emergency_contact"),
        ("rating", "rating"),
        ("totalDeliveries", "total_deliveries"),
    ]
    for key, attr in mapping:
        if key in body:
            setattr(d, attr, body.get(key))
    if "licenseExpiry" in body and body.get("licenseExpiry"):
        d.license_expiry = datetime.fromisoformat(body["licenseExpiry"])
    if "vehicleId" in body:
        vehicle_id = str(body.get("vehicleId") or "").strip()
        if vehicle_id:
            vehicle = Vehicle.objects.filter(id=vehicle_id).first()
            if not vehicle:
                return _err("Vehicle not found", 404)
            _assign_vehicle_to_driver(d, vehicle)
        else:
            _assign_vehicle_to_driver(d, None)
    if "isActive" in body:
        d.is_active = bool(body.get("isActive"))
    d.save()
    return _ok({"success": True, "driver": _serialize_model(d, include={"user": lambda o: _serialize_model(o.user, exclude={"password"})})})


@require_GET
def dashboard_stats(request: HttpRequest) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    today = timezone.now().date()
    stats = {
        "ordersTotal": Order.objects.count(),
        "ordersToday": Order.objects.filter(created_at__date=today).count(),
        "pendingOrders": Order.objects.filter(status__in=[OrderStatus.PENDING, OrderStatus.PREPARING]).count(),
        "deliveredOrders": Order.objects.filter(status=OrderStatus.DELIVERED).count(),
        "activeTrips": Trip.objects.filter(status=TripStatus.IN_PROGRESS).count(),
        "lowStockCount": Inventory.objects.filter(quantity__lte=10).count(),
        "customersTotal": Customer.objects.count(),
        "driversTotal": Driver.objects.count(),
        "revenueTotal": float(Order.objects.filter(status=OrderStatus.DELIVERED).aggregate(total=Sum("total_amount")).get("total") or 0),
    }
    return _ok({"success": True, "stats": stats})


@csrf_exempt
@require_http_methods(["GET", "POST", "PATCH"])
def feedback_collection(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = Feedback.objects.select_related("customer", "order").all().order_by("-created_at")
        if p.get("type") == "customer":
            qs = qs.filter(customer_id=p.get("userId"))
        total = qs.count()
        rows = list(qs[off : off + size])
        data = [_serialize_model(x, include={"customer": lambda o: _serialize_model(o.customer, exclude={"password"})}) for x in rows]
        return _ok({"success": True, "feedback": data, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    if request.method == "POST":
        body = _json_body(request)
        customer_id = p.get("userId") if p.get("type") == "customer" else str(body.get("customerId") or "")
        if not customer_id:
            return _err("customerId is required")
        try:
            customer = Customer.objects.get(id=customer_id)
        except Customer.DoesNotExist:
            return _err("Customer not found", 404)
        order = None
        if body.get("orderId"):
            order = Order.objects.filter(id=str(body["orderId"])).first()
        f = Feedback.objects.create(
            customer=customer,
            order=order,
            type=body.get("type") or "SUGGESTION",
            subject=str(body.get("subject") or "General Feedback"),
            message=str(body.get("message") or ""),
            rating=body.get("rating"),
            status="OPEN",
        )
        return _ok({"success": True, "feedback": _serialize_model(f)}, 201)
    _, err = _require_staff(request)
    if err:
        return err
    body = _json_body(request)
    feedback_id = str(body.get("id", "")).strip()
    if not feedback_id:
        return _err("id is required")
    try:
        f = Feedback.objects.get(id=feedback_id)
    except Feedback.DoesNotExist:
        return _err("Feedback not found", 404)
    if "status" in body:
        f.status = body.get("status")
    if "response" in body:
        f.response = body.get("response")
        f.responded_at = timezone.now()
        f.responded_by = (_payload(request) or {}).get("userId")
    f.save()
    return _ok({"success": True})


@csrf_exempt
@require_http_methods(["GET", "PATCH"])
def notifications_collection(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    scoped_qs = Notification.objects.all()
    if p.get("type") == "staff":
        scoped_qs = scoped_qs.filter(user_id=p.get("userId"))
    else:
        scoped_qs = scoped_qs.filter(customer_id=p.get("userId"))

    if request.method == "GET":
        qs = scoped_qs.order_by("-created_at")
        limit = max(1, min(_int(request.GET.get("limit", "100"), 100), 500))
        rows = list(qs[:limit])
        unread_count = scoped_qs.filter(is_read=False).count()
        return _ok({"success": True, "notifications": [_serialize_model(x) for x in rows], "unreadCount": unread_count})
    body = _json_body(request)

    if body.get("markAll") is True:
        qs = scoped_qs.filter(is_read=False)
        updated_count = qs.count()
        qs.update(is_read=True, read_at=timezone.now())
        return _ok({"success": True, "updated": updated_count, "unreadCount": 0})

    ids = body.get("ids") or []
    if not isinstance(ids, list) or not ids:
        return _err("ids is required")
    qs = scoped_qs.filter(id__in=ids)
    qs.update(is_read=True, read_at=timezone.now())
    unread_count = scoped_qs.filter(is_read=False).count()
    return _ok({"success": True, "updated": qs.count(), "unreadCount": unread_count})


@csrf_exempt
@require_http_methods(["GET", "POST", "PATCH"])
def orders_collection(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    if request.method == "GET":
        page, size, off = _pagination(request)
        include_returns = request.GET.get("includeReturns") == "true"
        include_orders = request.GET.get("includeOrders", "true") != "false"
        include_items = request.GET.get("includeItems", "full")
        where = Q()
        if p.get("type") == "customer":
            where &= Q(customer_id=p.get("userId"))
        if request.GET.get("status"):
            where &= Q(status=_normalize_order_status(request.GET.get("status")))
        s = str(request.GET.get("search", "")).strip()
        if s:
            where &= Q(order_number__icontains=s) | Q(customer__name__icontains=s)
        oqs = Order.objects.select_related("customer", "logistics", "timeline").prefetch_related("items__product").filter(where).order_by("-created_at")
        total = oqs.count() if include_orders else 0
        orders = list(oqs[off : off + size]) if include_orders else []
        out = []
        for o in orders:
            row = _serialize_order(o, include_items=include_items != "none")
            if include_items == "preview" and "items" in row:
                row["itemCount"] = len(row["items"])
                row["items"] = row["items"][:2]
            if include_items == "none":
                row.pop("items", None)
            out.append(row)
        returns_out = []
        if include_returns:
            returns_out = [_serialize_return(r) for r in Return.objects.filter(order__in=oqs)[:size]]
        return _ok({"success": True, "orders": out, "returns": returns_out, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size if include_orders else 0})
    if request.method == "POST":
        body = _json_body(request)
        customer_id = str(body.get("customerId") or (p.get("userId") if p.get("type") == "customer" else "") or "").strip()
        if not customer_id:
            return _err("customerId is required")
        try:
            customer = Customer.objects.get(id=customer_id)
        except Customer.DoesNotExist:
            return _err("Customer not found", 404)
        items = body.get("items") or []
        if not isinstance(items, list) or not items:
            return _err("items are required")
        try:
            with transaction.atomic():
                count = Order.objects.count() + 1
                order = Order.objects.create(
                    order_number=f"ORD-{timezone.now().year}-{str(count).zfill(4)}",
                    customer=customer,
                    status=_normalize_order_status(body.get("status") or OrderStatus.PENDING),
                    priority=body.get("priority") or "normal",
                    subtotal=0,
                    tax=0,
                    shipping_cost=float(body.get("shippingCost") or 0),
                    discount=float(body.get("discount") or 0),
                    total_amount=0,
                    payment_status=body.get("paymentStatus") or "pending",
                    payment_method=body.get("paymentMethod"),
                    warehouse_id=body.get("warehouseId"),
                )
                subtotal = 0.0
                allocation_policy = _resolve_allocation_policy(body)
                performed_by = (p or {}).get("userId")

                for item in items:
                    pid = str(item.get("productId") or "").strip()
                    if not pid:
                        continue
                    prod = Product.objects.filter(id=pid).first()
                    if not prod:
                        raise ValueError(f"Product not found: {pid}")

                    qty = _int(item.get("quantity"), 0)
                    if qty <= 0:
                        raise ValueError(f"Quantity must be greater than zero for product {prod.sku}")

                    unit = float(item.get("unitPrice") or prod.price)
                    subtotal += unit * qty
                    order_item = OrderItem.objects.create(
                        order=order,
                        product=prod,
                        quantity=qty,
                        unit_price=unit,
                        total_price=float(item.get("totalPrice") or unit * qty),
                        notes=item.get("notes"),
                    )

                    allocations = _reserve_inventory_for_order_item(
                        product=prod,
                        requested_qty=qty,
                        order=order,
                        order_item=order_item,
                        warehouse_id=str(order.warehouse_id or "").strip() or None,
                        allocation_policy=allocation_policy,
                        performed_by=performed_by,
                    )
                    allocation_note = f"Reserved using {allocation_policy}: " + ", ".join(
                        [f"{row['batchNumber']} x{row['quantity']}" for row in allocations]
                    )
                    policy_note = f"AllocationPolicy={allocation_policy}"
                    order_item.notes = f"{order_item.notes or ''}\n{policy_note}\n{allocation_note}".strip()
                    order_item.save(update_fields=["notes"])

                tax = float(body.get("tax") if body.get("tax") is not None else subtotal * 0.08)
                total = float(body.get("totalAmount") if body.get("totalAmount") is not None else subtotal + tax + order.shipping_cost - order.discount)
                order.subtotal = subtotal
                order.tax = tax
                order.total_amount = total
                order.save(update_fields=["subtotal", "tax", "total_amount", "updated_at"])
                OrderLogistics.objects.create(
                    order=order,
                    shipping_name=body.get("shippingName") or customer.name,
                    shipping_phone=body.get("shippingPhone") or customer.phone or "",
                    shipping_address=body.get("shippingAddress") or customer.address or "",
                    shipping_city=body.get("shippingCity") or customer.city or "",
                    shipping_province=body.get("shippingProvince") or customer.province or "",
                    shipping_zip_code=body.get("shippingZipCode") or customer.zip_code or "",
                    shipping_country=body.get("shippingCountry") or customer.country,
                    shipping_latitude=body.get("shippingLatitude") if body.get("shippingLatitude") is not None else customer.latitude,
                    shipping_longitude=body.get("shippingLongitude") if body.get("shippingLongitude") is not None else customer.longitude,
                    notes=body.get("notes"),
                    special_instructions=body.get("specialInstructions"),
                )
                OrderTimeline.objects.create(order=order, delivery_date=datetime.fromisoformat(body["deliveryDate"]) if body.get("deliveryDate") else None)
        except ValueError as e:
            return _err(str(e), 400)
        order = Order.objects.select_related("customer", "logistics", "timeline").prefetch_related("items__product").get(id=order.id)
        return _ok({"success": True, "order": _serialize_order(order)}, 201)
    staff, err = _require_staff(request)
    if err:
        return err
    body = _json_body(request)
    if body.get("scope") != "replacement":
        return _err("Invalid patch scope")
    return_id = str(body.get("returnId") or "")
    status = str(body.get("status") or "")
    if not return_id or not status:
        return _err("returnId and status are required")
    try:
        r = Return.objects.select_related("order").get(id=return_id)
    except Return.DoesNotExist:
        return _err("Replacement record not found", 404)
    normalized_status = _normalize_replacement_status(status, r.replacement_mode)
    allowed_statuses = {
        ReturnStatus.REPORTED,
        ReturnStatus.IN_PROGRESS,
        ReturnStatus.RESOLVED_ON_DELIVERY,
        ReturnStatus.NEEDS_FOLLOW_UP,
        ReturnStatus.COMPLETED,
    }
    if normalized_status not in allowed_statuses:
        return _err("Invalid replacement status", 400)

    r.status = normalized_status
    if normalized_status == ReturnStatus.IN_PROGRESS:
        r.pickup_completed = timezone.now()
    if normalized_status in {ReturnStatus.RESOLVED_ON_DELIVERY, ReturnStatus.COMPLETED}:
        r.processed_at = timezone.now()
        r.processed_by = staff.get("userId")
    r.notes = f"{r.notes or ''}\n{normalized_status}".strip()
    r.save()
    return _ok({"success": True, "replacement": _serialize_return(r), "message": "Replacement status updated"})


@require_GET
def order_detail(request: HttpRequest, order_id: str) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    try:
        o = Order.objects.select_related("customer", "logistics", "timeline").prefetch_related("items__product").get(id=order_id)
    except Order.DoesNotExist:
        return _err("Order not found", 404)
    if p.get("type") == "customer" and p.get("userId") != o.customer_id:
        return _err("Forbidden", 403)
    return _ok({"success": True, "order": _serialize_order(o, include_progress=True)})


@csrf_exempt
@require_http_methods(["PATCH"])
def order_status_update(request: HttpRequest, order_id: str) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    body = _json_body(request)
    status = body.get("status")
    if not status:
        return _err("status is required")
    next_status = _normalize_order_status(status)
    allowed_statuses = {
        OrderStatus.PENDING,
        OrderStatus.CONFIRMED,
        OrderStatus.PREPARING,
        OrderStatus.OUT_FOR_DELIVERY,
        OrderStatus.DELIVERED,
        OrderStatus.CANCELLED,
    }
    if next_status not in allowed_statuses:
        return _err("Invalid status", 400)
    try:
        o = Order.objects.get(id=order_id)
    except Order.DoesNotExist:
        return _err("Order not found", 404)

    current_status = _normalize_order_status(o.status)

    if current_status == next_status:
        current = Order.objects.select_related("customer", "logistics", "timeline").prefetch_related("items__product").get(id=o.id)
        return _ok({"success": True, "order": _serialize_order(current, include_items=False)})

    if current_status == OrderStatus.DELIVERED and next_status != OrderStatus.DELIVERED:
        return _err("Delivered orders cannot be moved to another status", 400)

    allowed_transitions = {
        OrderStatus.PENDING: {OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.CANCELLED},
        OrderStatus.CONFIRMED: {OrderStatus.PREPARING, OrderStatus.CANCELLED},
        OrderStatus.PREPARING: {OrderStatus.OUT_FOR_DELIVERY, OrderStatus.CANCELLED},
        OrderStatus.OUT_FOR_DELIVERY: {OrderStatus.DELIVERED, OrderStatus.CANCELLED},
        OrderStatus.DELIVERED: set(),
        OrderStatus.CANCELLED: set(),
    }
    if next_status not in allowed_transitions.get(current_status, set()):
        return _err(f"Invalid transition from {current_status} to {next_status}", 400)

    if next_status == OrderStatus.OUT_FOR_DELIVERY:
        return _err("OUT_FOR_DELIVERY is set automatically when the trip starts", 400)

    try:
        with transaction.atomic():
            if next_status == OrderStatus.DELIVERED:
                _finalize_order_inventory_on_delivery(o, staff.get("userId"))
            elif next_status == OrderStatus.CANCELLED:
                _release_order_reservations(o, staff.get("userId"))

            o.status = next_status
            o.save(update_fields=["status", "updated_at"])

            timeline, _ = OrderTimeline.objects.get_or_create(order=o)
            now = timezone.now()
            status_map = {
                "CONFIRMED": "confirmed_at",
                "PREPARING": "processed_at",
                "OUT_FOR_DELIVERY": "shipped_at",
                "DELIVERED": "delivered_at",
                "CANCELLED": "cancelled_at",
            }
            field = status_map.get(o.status)
            if field:
                setattr(timeline, field, now)
                timeline.save()
    except ValueError as e:
        return _err(str(e), 400)

    updated = Order.objects.select_related("customer", "logistics", "timeline").prefetch_related("items__product").get(id=o.id)
    return _ok({"success": True, "order": _serialize_order(updated, include_items=False)})


@csrf_exempt
@require_http_methods(["PATCH"])
def order_warehouse_stage_update(request: HttpRequest, order_id: str) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    body = _json_body(request)

    stage = str(body.get("warehouseStage") or "").strip().upper()
    valid_stages = {WarehouseStage.READY_TO_LOAD, WarehouseStage.LOADED, WarehouseStage.DISPATCHED}
    if stage not in valid_stages:
        return _err("warehouseStage is required and must be READY_TO_LOAD, LOADED, or DISPATCHED")

    try:
        order = Order.objects.get(id=order_id)
    except Order.DoesNotExist:
        return _err("Order not found", 404)

    current_stage = str(order.warehouse_stage or WarehouseStage.READY_TO_LOAD)
    stage_rank = {
        WarehouseStage.READY_TO_LOAD: 1,
        WarehouseStage.LOADED: 2,
        WarehouseStage.DISPATCHED: 3,
    }
    if stage_rank.get(stage, 0) < stage_rank.get(current_stage, 0):
        return _err("Warehouse stage cannot move backward", 400)

    if stage == WarehouseStage.DISPATCHED:
        return _err("DISPATCHED is set automatically when the trip starts", 400)

    checklist = body.get("checklist") if isinstance(body.get("checklist"), dict) else {}
    if "itemsVerified" in checklist:
        order.checklist_items_verified = bool(checklist.get("itemsVerified"))
    if "quantityVerified" in checklist:
        order.checklist_quantity_verified = bool(checklist.get("quantityVerified"))
    if "packagingVerified" in checklist:
        order.checklist_packaging_verified = bool(checklist.get("packagingVerified"))
    if "vehicleAssigned" in checklist:
        order.checklist_vehicle_assigned = bool(checklist.get("vehicleAssigned"))
    if "driverAssigned" in checklist:
        order.checklist_driver_assigned = bool(checklist.get("driverAssigned"))

    if "shortLoadQty" in body:
        order.exception_short_load_qty = max(0, _int(body.get("shortLoadQty"), 0))
    if "damagedOnLoadingQty" in body:
        order.exception_damaged_on_loading_qty = max(0, _int(body.get("damagedOnLoadingQty"), 0))
    if "holdReason" in body:
        order.exception_hold_reason = str(body.get("holdReason") or "").strip() or None
    if "exceptionNotes" in body:
        order.exception_notes = str(body.get("exceptionNotes") or "").strip() or None

    signoff_name = str(body.get("signoffName") or "").strip()

    if stage == WarehouseStage.LOADED:
        assigned_trip = Trip.objects.filter(drop_points__order_id=order.id, driver__isnull=False).order_by("-updated_at").first()
        if not assigned_trip:
            return _err("Order must be assigned to a driver before LOADED", 400)
        if not _warehouse_checklist_complete(order):
            return _err("Checklist must be completed before LOADED", 400)

    if stage == WarehouseStage.DISPATCHED:
        if not _warehouse_checklist_complete(order):
            return _err("All dispatch checklist items are required before DISPATCHED", 400)
        if str(order.exception_hold_reason or "").strip():
            return _err("Order has hold reason and cannot be dispatched", 400)
        if not signoff_name and not str(order.dispatch_signed_off_by or "").strip():
            return _err("signoffName is required before DISPATCHED", 400)
        if signoff_name:
            order.dispatch_signed_off_by = signoff_name
        order.dispatch_signed_off_user_id = staff.get("userId")
        order.dispatch_signed_off_at = timezone.now()

    now = timezone.now()
    order.warehouse_stage = stage
    if stage == WarehouseStage.READY_TO_LOAD and not order.ready_to_load_at:
        order.ready_to_load_at = now
    if stage == WarehouseStage.LOADED and not order.loaded_at:
        order.loaded_at = now
    if stage == WarehouseStage.DISPATCHED and not order.warehouse_dispatched_at:
        order.warehouse_dispatched_at = now

    if stage == WarehouseStage.LOADED and _normalize_order_status(order.status) in {OrderStatus.PREPARING, OrderStatus.CONFIRMED}:
        order.status = OrderStatus.PREPARING
    if stage == WarehouseStage.DISPATCHED:
        order.status = OrderStatus.OUT_FOR_DELIVERY

    order.save()

    if stage == WarehouseStage.DISPATCHED:
        timeline, _ = OrderTimeline.objects.get_or_create(order=order)
        if not timeline.shipped_at:
            timeline.shipped_at = now
            timeline.save(update_fields=["shipped_at", "updated_at"])

    serialized_order = _serialize_order(
        Order.objects.select_related("customer", "logistics", "timeline").prefetch_related("items__product").get(id=order.id),
        include_items=False,
    )
    return _ok({"success": True, "order": serialized_order, "message": f"Warehouse stage moved to {stage}"})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def trips_collection(request: HttpRequest) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = Trip.objects.select_related("driver__user", "vehicle").prefetch_related("drop_points__order").all().order_by("-created_at")
        tracking_date_raw = str(request.GET.get("trackingDate") or "").strip()
        include_tracking = str(request.GET.get("includeTracking") or "").strip().lower() in {"1", "true", "yes"}

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
            ).distinct()
        total = qs.count()
        rows = list(qs[off : off + size])
        serialized_rows = [_serialize_trip(t) for t in rows]

        if include_tracking and serialized_rows:
            trip_ids = [row.get("id") for row in serialized_rows if row.get("id")]
            logs_qs = LocationLog.objects.filter(trip_id__in=trip_ids)
            if tracking_date:
                logs_qs = logs_qs.filter(recorded_at__date=tracking_date)
            logs_qs = logs_qs.order_by("recorded_at")

            logs_by_trip: dict[str, list[dict[str, Any]]] = {}
            latest_log_by_trip: dict[str, dict[str, Any]] = {}
            for log in logs_qs:
                if not log.trip_id:
                    continue
                row = _serialize_model(log)
                logs_by_trip.setdefault(log.trip_id, []).append(row)
                latest_log_by_trip[log.trip_id] = row

            for trip_row in serialized_rows:
                trip_id = trip_row.get("id")
                if not trip_id:
                    continue
                trip_row["locationLogs"] = logs_by_trip.get(trip_id, [])
                trip_row["latestLocation"] = latest_log_by_trip.get(trip_id)

        return _ok(
            {
                "success": True,
                "trips": serialized_rows,
                "total": total,
                "page": page,
                "pageSize": size,
                "totalPages": (total + size - 1) // size,
            }
        )
    body = _json_body(request)
    try:
        driver = Driver.objects.select_related("user").get(id=str(body.get("driverId", "")))
        vehicle = Vehicle.objects.get(id=str(body.get("vehicleId", "")))
    except (Driver.DoesNotExist, Vehicle.DoesNotExist):
        return _err("Driver or vehicle not found", 404)
    count = Trip.objects.count() + 1
    trip = Trip.objects.create(trip_number=f"TRP-{timezone.now().year}-{str(count).zfill(4)}", driver=driver, vehicle=vehicle, warehouse_id=body.get("warehouseId"), status=body.get("status") or TripStatus.PLANNED, planned_start_at=datetime.fromisoformat(body["plannedStartAt"]) if body.get("plannedStartAt") else None, notes=body.get("notes"))
    seq = 1
    for oid in body.get("orderIds") or []:
        order = Order.objects.filter(id=str(oid)).first()
        if not order:
            continue
        log = OrderLogistics.objects.filter(order=order).first()
        drop_latitude = _to_float_or_none((log.shipping_latitude if log else None) or getattr(order.customer, "latitude", None))
        drop_longitude = _to_float_or_none((log.shipping_longitude if log else None) or getattr(order.customer, "longitude", None))
        TripDropPoint.objects.create(
            trip=trip,
            order=order,
            sequence=seq,
            location_name=(log.shipping_name if log else f"Order {order.order_number}"),
            address=(log.shipping_address if log else "Address"),
            city=(log.shipping_city if log else "City"),
            province=(log.shipping_province if log else "Province"),
            zip_code=(log.shipping_zip_code if log else "00000"),
            latitude=drop_latitude,
            longitude=drop_longitude,
            contact_name=(log.shipping_name if log else None),
            contact_phone=(log.shipping_phone if log else None),
        )
        seq += 1
    trip.total_drop_points = trip.drop_points.count()
    trip.save(update_fields=["total_drop_points", "updated_at"])
    trip = Trip.objects.select_related("driver__user", "vehicle").prefetch_related("drop_points__order").get(id=trip.id)
    return _ok({"success": True, "trip": _serialize_trip(trip)}, 201)


@require_GET
def driver_trips(request: HttpRequest) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    if p.get("role") != "DRIVER":
        return _err("Forbidden", 403)
    d = Driver.objects.filter(user_id=p.get("userId")).first()
    if not d:
        return _err("Driver profile not found", 404)
    rows = Trip.objects.select_related("driver__user", "vehicle").prefetch_related("drop_points__order").filter(driver=d).order_by("-updated_at")[:100]

    trip_ids = [trip.id for trip in rows]
    latest_log_by_trip: dict[str, LocationLog] = {}
    if trip_ids:
        logs = LocationLog.objects.filter(trip_id__in=trip_ids).order_by("trip_id", "-recorded_at")
        for log in logs:
            if not log.trip_id:
                continue
            if log.trip_id not in latest_log_by_trip:
                latest_log_by_trip[log.trip_id] = log

    payload_rows: list[dict[str, Any]] = []
    for trip in rows:
        row = _serialize_trip(trip)
        latest_log = latest_log_by_trip.get(trip.id)
        row["latestLocation"] = (
            {
                "latitude": float(latest_log.latitude),
                "longitude": float(latest_log.longitude),
                "recordedAt": latest_log.recorded_at.isoformat() if latest_log.recorded_at else None,
            }
            if latest_log
            else None
        )
        payload_rows.append(row)

    return _ok({"success": True, "trips": payload_rows})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def customer_orders(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p or p.get("type") != "customer":
        return _err("Unauthorized", 401)
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = Order.objects.select_related("customer", "logistics", "timeline").prefetch_related("items__product").filter(customer_id=p.get("userId")).order_by("-created_at")
        total = qs.count()
        rows = list(qs[off : off + size])
        return _ok({"success": True, "orders": [_serialize_order(x) for x in rows], "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    body = _json_body(request)
    body["customerId"] = p.get("userId")
    request._body = json.dumps(body).encode("utf-8")
    return orders_collection(request)


@csrf_exempt
@require_http_methods(["PATCH"])
def customer_order_cancel(request: HttpRequest, order_id: str) -> JsonResponse:
    p = _require_auth(request)
    if not p or p.get("type") != "customer":
        return _err("Unauthorized", 401)
    try:
        o = Order.objects.get(id=order_id, customer_id=p.get("userId"))
    except Order.DoesNotExist:
        return _err("Order not found", 404)
    if o.status in {OrderStatus.PREPARING, OrderStatus.DELIVERED, OrderStatus.CANCELLED}:
        return _err("Order cannot be cancelled", 400)

    with transaction.atomic():
        _release_order_reservations(o, p.get("userId"))
        o.status = OrderStatus.CANCELLED
        o.save(update_fields=["status", "updated_at"])
        timeline, _ = OrderTimeline.objects.get_or_create(order=o)
        timeline.cancelled_at = timezone.now()
        timeline.save()

    return _ok({"success": True, "order": _serialize_order(o, include_items=False)})


@require_GET
def customer_replacements(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p or p.get("type") != "customer":
        return _err("Unauthorized", 401)
    rows = Return.objects.filter(customer_id=p.get("userId")).order_by("-created_at")[:200]
    return _ok({"success": True, "replacements": [_serialize_return(x) for x in rows]})


@require_GET
def customer_tracking(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p or p.get("type") != "customer":
        return _err("Unauthorized", 401)
    orders = Order.objects.filter(customer_id=p.get("userId")).order_by("-updated_at")[:100]
    tracking = []
    for o in orders:
        trip = Trip.objects.filter(drop_points__order_id=o.id).select_related("driver__user", "vehicle").order_by("-updated_at").first()
        tracking.append(
            {
                "orderId": o.id,
                "orderNumber": o.order_number,
                "status": _normalize_order_status(o.status),
                "orderStatus": _normalize_order_status(o.status),
                "updatedAt": o.updated_at.isoformat() if o.updated_at else None,
                "trip": _serialize_trip(trip, include_points=False) if trip else None,
            }
        )
    return _ok({"success": True, "tracking": tracking})


@csrf_exempt
@require_http_methods(["POST"])
def driver_location(request: HttpRequest) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    if p.get("role") != "DRIVER":
        return _err("Forbidden", 403)
    d = Driver.objects.filter(user_id=p.get("userId")).first()
    if not d:
        return _err("Driver not found", 404)
    body = _json_body(request)
    lat = body.get("latitude")
    lng = body.get("longitude")
    if lat is None or lng is None:
        return _err("Invalid coordinates")
    trip_id = body.get("tripId")
    if not trip_id:
        t = Trip.objects.filter(driver=d, status=TripStatus.IN_PROGRESS).order_by("-updated_at").first()
        trip_id = t.id if t else None
    log = LocationLog.objects.create(driver=d, trip_id=trip_id, latitude=float(lat), longitude=float(lng), speed=body.get("speed"), heading=body.get("heading"), altitude=body.get("altitude"), accuracy=body.get("accuracy"), battery=body.get("battery"))
    return _ok({"success": True, "locationLogId": log.id})


@csrf_exempt
@require_http_methods(["GET", "PUT"])
def driver_profile(request: HttpRequest) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    if p.get("role") != "DRIVER":
        return _err("Forbidden", 403)
    d = Driver.objects.select_related("user").filter(user_id=p.get("userId")).first()
    if not d:
        return _err("Driver profile not found", 404)
    if request.method == "GET":
        return _ok({"success": True, "driver": _serialize_model(d, include={"user": lambda o: _serialize_model(o.user, exclude={"password"})})})
    body = _json_body(request)
    for key, attr in [
        ("phone", "phone"),
        ("emergencyContact", "emergency_contact"),
        ("licenseNumber", "license_number"),
        ("licenseType", "license_type"),
        ("licensePhoto", "license_photo"),
    ]:
        if key in body:
            setattr(d, attr, body.get(key))
    if "licenseExpiry" in body and body.get("licenseExpiry"):
        d.license_expiry = datetime.fromisoformat(str(body["licenseExpiry"]).replace("Z", "+00:00"))
    d.save()
    for key, attr in [("name", "name"), ("phone", "phone"), ("avatar", "avatar")]:
        if key in body:
            setattr(d.user, attr, body.get(key))
    d.user.save()
    return _ok({"success": True, "driver": _serialize_model(d, include={"user": lambda o: _serialize_model(o.user, exclude={"password"})})})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def driver_spare_stock(request: HttpRequest) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    if p.get("role") != "DRIVER":
        return _err("Forbidden", 403)
    d = Driver.objects.filter(user_id=p.get("userId")).first()
    if not d:
        return _err("Driver not found", 404)
    if request.method == "GET":
        rows = DriverSpareStock.objects.select_related("product").filter(driver=d).order_by("product__name")
        data = [_serialize_model(x, include={"product": lambda o: _serialize_model(o.product)}) for x in rows]
        return _ok({"success": True, "spareStock": data})
    body = _json_body(request)
    pid = str(body.get("productId") or "")
    qty = _int(body.get("quantity"), 0)
    if not pid or qty == 0:
        return _err("productId and non-zero quantity are required")
    prod = Product.objects.filter(id=pid).first()
    if not prod:
        return _err("Product not found", 404)
    stock, _ = DriverSpareStock.objects.get_or_create(driver=d, product=prod, defaults={"quantity": 0, "min_quantity": 0})
    stock.quantity += qty
    if "minQuantity" in body:
        stock.min_quantity = _int(body.get("minQuantity"), stock.min_quantity)
    stock.save()
    SpareStockTransaction.objects.create(driver=d, product=prod, type=body.get("type") or ("IN" if qty > 0 else "OUT"), quantity=qty, reference_type=body.get("referenceType"), reference_id=body.get("referenceId"), notes=body.get("notes"))
    return _ok({"success": True, "spareStock": _serialize_model(stock)})


@csrf_exempt
@require_http_methods(["POST"])
def driver_replacements_from_spare_stock(request: HttpRequest) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    if p.get("role") != "DRIVER":
        return _err("Forbidden", 403)
    d = Driver.objects.filter(user_id=p.get("userId")).first()
    if not d:
        return _err("Driver not found", 404)
    body = _json_body(request)
    outcome = str(body.get("outcome") or "RESOLVED").strip().upper()
    if outcome not in {"RESOLVED", "PARTIALLY_REPLACED"}:
        return _err("outcome is required and must be RESOLVED or PARTIALLY_REPLACED")

    follow_up_return_id = str(body.get("followUpReturnId") or "").strip()
    follow_up_return = None
    if follow_up_return_id:
        follow_up_return = Return.objects.select_related("order").filter(id=follow_up_return_id).first()

    order_item = None
    order_item_id = str(body.get("orderItemId") or "").strip()
    if order_item_id:
        order_item = OrderItem.objects.select_related("order", "product").filter(id=order_item_id).first()

    order = order_item.order if order_item else Order.objects.filter(id=str(body.get("orderId") or "")).first()
    product = order_item.product if order_item else Product.objects.filter(id=str(body.get("productId") or "")).first()
    qty = _int(body.get("quantity"), 0)
    resolved_on_delivery = outcome == "RESOLVED"
    if not order:
        return _err("orderItemId or orderId is required")
    if resolved_on_delivery and not product:
        return _err("product is required for RESOLVED outcome")
    if qty < 0:
        return _err("quantity cannot be negative")
    if outcome == "RESOLVED" and qty <= 0:
        return _err("quantity must be greater than zero for RESOLVED outcome")
    if order_item and qty > _int(order_item.quantity, 0):
        return _err("quantity cannot exceed ordered quantity")

    if follow_up_return:
        if not order:
            order = follow_up_return.order
        if not product and follow_up_return.replacement_product_id:
            product = Product.objects.filter(id=follow_up_return.replacement_product_id).first()
        if follow_up_return.order_id != getattr(order, "id", None):
            return _err("followUpReturnId does not match the selected order", 400)
        if follow_up_return.drop_point_id and follow_up_return.drop_point_id != str(body.get("dropPointId") or "").strip():
            return _err("followUpReturnId does not match the selected drop point", 400)
        if _is_replacement_closed(follow_up_return):
            return _err("Replacement is already closed", 400)
        if outcome != "RESOLVED":
            return _err("Follow-up replacement can only be submitted as RESOLVED", 400)
        if not order_item and follow_up_return.original_order_item_id:
            order_item = OrderItem.objects.select_related("order", "product").filter(id=follow_up_return.original_order_item_id).first()
        if order_item and qty > max(_int(order_item.quantity, 0) - _int(follow_up_return.replacement_quantity, 0), 0):
            return _err("quantity cannot exceed the remaining quantity to replace", 400)

    stock = DriverSpareStock.objects.filter(driver=d, product=product).first() if product else None
    available_qty = _int(getattr(stock, "quantity", 0), 0)
    if qty > available_qty:
        return _err("Insufficient spare stock for selected replacement quantity", 400)
    replacement_status = ReturnStatus.RESOLVED_ON_DELIVERY if resolved_on_delivery else ReturnStatus.NEEDS_FOLLOW_UP
    replacement_mode = "SPARE_STOCK_IMMEDIATE" if resolved_on_delivery else "SPARE_STOCK_PARTIAL"

    damage_photo = str(body.get("damagePhoto") or "").strip() or None
    damage_photos_raw = body.get("damagePhotos") if isinstance(body.get("damagePhotos"), list) else []
    damage_photos = [str(x).strip() for x in damage_photos_raw if str(x).strip()]
    if damage_photo and damage_photo not in damage_photos:
        damage_photos.insert(0, damage_photo)
    if not damage_photos:
        return _err("At least one damage photo is required", 400)

    meta = {
        "outcome": outcome,
        "damagePhotos": damage_photos,
        "reportedAt": timezone.now().isoformat(),
        "tripId": str(body.get("tripId") or "").strip() or None,
        "dropPointId": str(body.get("dropPointId") or "").strip() or None,
    }

    with transaction.atomic():
        if qty > 0:
            stock.quantity -= qty
            stock.save(update_fields=["quantity", "updated_at"])
            SpareStockTransaction.objects.create(
                driver=d,
                product=product,
                type="OUT",
                quantity=qty,
                reference_type="replacement",
                reference_id=order.id,
                notes="Driver replacement from spare stock",
            )
        if follow_up_return:
            follow_up_return.status = ReturnStatus.COMPLETED
            follow_up_return.replacement_mode = follow_up_return.replacement_mode or replacement_mode
            follow_up_return.replacement_quantity = _int(follow_up_return.replacement_quantity, 0) + qty
            follow_up_return.damage_photo_url = damage_photos[0]
            follow_up_return.processed_at = timezone.now()
            follow_up_return.processed_by = p.get("userId")
            follow_up_return.notes = (
                f"{follow_up_return.notes or ''}\nFollow-up replacement completed by driver\nMeta: {json.dumps(meta)}"
            ).strip()
            follow_up_return.save()
            r = follow_up_return
        else:
            count = Return.objects.count() + 1
            r = Return.objects.create(
                return_number=f"RET-{timezone.now().year}-{str(count).zfill(4)}",
                order=order,
                customer_id=order.customer_id,
                reason=str(body.get("reason") or "Damaged item"),
                description=body.get("description") or ("Replacement fulfilled by driver spare stock" if resolved_on_delivery else "Partial replacement from driver spare stock; follow-up required"),
                status=replacement_status,
                requested_by="DRIVER",
                replacement_mode=replacement_mode,
                original_order_item_id=order_item.id if order_item else (body.get("orderItemId") or ""),
                replacement_product_id=product.id if product else None,
                replacement_quantity=qty,
                trip_id=str(body.get("tripId") or "").strip() or None,
                drop_point_id=str(body.get("dropPointId") or "").strip() or None,
                pickup_address=body.get("pickupAddress") or "",
                pickup_city=body.get("pickupCity") or "",
                pickup_province=body.get("pickupProvince") or "",
                pickup_zip_code=body.get("pickupZipCode") or "",
                damage_photo_url=damage_photos[0],
                processed_at=timezone.now() if resolved_on_delivery else None,
                processed_by=p.get("userId") if resolved_on_delivery else None,
                notes=f"{'Immediate replacement completed by driver' if resolved_on_delivery else 'Partial replacement reported by driver'}\nMeta: {json.dumps(meta)}",
            )
    remaining_qty = max((_int(order_item.quantity, 0) if order_item else 0) - _int(r.replacement_quantity, 0), 0)
    return _ok({"success": True, "replacement": _serialize_return(r), "remainingSpareStock": max(available_qty - qty, 0), "remainingReplacementQty": remaining_qty})


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

        oqs = (
            Order.objects.select_related("customer", "logistics", "timeline")
            .prefetch_related("items__product")
            .filter(status__in=[OrderStatus.PREPARING, OrderStatus.CONFIRMED])
            .order_by("created_at")
        )

        if route_date:
            oqs = oqs.filter(
                Q(timeline__delivery_date__date=route_date) | Q(created_at__date=route_date)
            )

        if warehouse_id:
            oqs = oqs.filter(
                Q(warehouse_id=warehouse_id) | Q(warehouse_id__isnull=True) | Q(warehouse_id="")
            )

        warehouse_start_lat = None
        warehouse_start_lng = None
        if warehouse_id:
            warehouse = Warehouse.objects.filter(id=warehouse_id).only("id", "latitude", "longitude").first()
            if warehouse:
                warehouse_start_lat = _to_float_or_none(getattr(warehouse, "latitude", None))
                warehouse_start_lng = _to_float_or_none(getattr(warehouse, "longitude", None))

        orders = []
        grouped_by_city: dict[str, list[dict[str, Any]]] = {}
        for o in oqs[:300]:
            log = getattr(o, "logistics", None)
            city = str((log.shipping_city if log else None) or "Unknown").strip() or "Unknown"
            latitude = _to_float_or_none((log.shipping_latitude if log else None) or o.customer.latitude)
            longitude = _to_float_or_none((log.shipping_longitude if log else None) or o.customer.longitude)
            address = str((log.shipping_address if log else None) or "").strip()
            products_preview = ", ".join(
                [
                    f"{item.product.name} x{item.quantity}"
                    for item in o.items.select_related("product").all()[:3]
                    if item.product
                ]
            )

            order_row = {
                "id": o.id,
                "orderId": o.id,
                "orderNumber": o.order_number,
                "customerName": o.customer.name,
                "address": address,
                "shippingAddress": address,
                "city": city,
                "province": log.shipping_province if log else None,
                "zipCode": log.shipping_zip_code if log else None,
                "latitude": latitude,
                "longitude": longitude,
                "shippingLatitude": latitude,
                "shippingLongitude": longitude,
                "products": products_preview,
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

        drivers = [_serialize_model(x, include={"user": lambda o: _serialize_model(o.user, exclude={"password"})}) for x in Driver.objects.select_related("user").filter(is_active=True)[:200]]
        vehicles = [_serialize_model(x) for x in Vehicle.objects.filter(status=VehicleStatus.AVAILABLE, is_active=True)[:200]]
        return _ok({"success": True, "drivers": drivers, "vehicles": vehicles, "orders": orders, "routePlans": route_plans})
    body = _json_body(request)
    return _ok({"success": True, "routePlan": body, "message": "Route plan accepted"})


@csrf_exempt
@require_http_methods(["GET", "POST", "DELETE"])
def trips_saved_routes(request: HttpRequest) -> JsonResponse:
    payload, err = _require_staff(request)
    if err:
        return err

    role = str(payload.get("role") or "").upper()
    user_id = str(payload.get("userId") or "").strip() or None

    if request.method == "GET":
        qs = SavedRouteDraft.objects.all().order_by("-created_at")

        warehouse_id = str(request.GET.get("warehouseId") or "").strip()
        if warehouse_id:
            qs = qs.filter(warehouse_id=warehouse_id)

        # Warehouse users should only see their own drafts.
        if role == "WAREHOUSE_STAFF" and user_id:
            qs = qs.filter(created_by_user_id=user_id)

        route_rows = list(qs[:300])
        warehouse_ids = {str(route.warehouse_id) for route in route_rows if route.warehouse_id}
        warehouse_lookup = {
            warehouse.id: (
                _to_float_or_none(warehouse.latitude),
                _to_float_or_none(warehouse.longitude),
            )
            for warehouse in Warehouse.objects.filter(id__in=warehouse_ids).only("id", "latitude", "longitude")
        }

        rows = []
        for route in route_rows:
            row = _serialize_saved_route(route)
            start_lat, start_lng = warehouse_lookup.get(str(route.warehouse_id), (None, None))
            orders_raw = [dict(order) for order in (row.get("orders") or []) if isinstance(order, dict)]
            enriched_orders, computed_total_km = _compute_order_distances(orders_raw, start_lat, start_lng)
            row["orders"] = enriched_orders
            if enriched_orders:
                row["totalDistanceKm"] = computed_total_km
            rows.append(row)
        return _ok({"success": True, "savedRoutes": rows})

    if request.method == "POST":
        body = _json_body(request)

        date_raw = str(body.get("date") or "").strip()
        warehouse_id = str(body.get("warehouseId") or "").strip()
        warehouse_name = str(body.get("warehouseName") or "").strip()
        city = str(body.get("city") or "").strip()
        total_distance_km = body.get("totalDistanceKm")
        order_ids = body.get("orderIds") or []
        orders = body.get("orders") or []

        if not date_raw or not warehouse_id or not city:
            return _err("date, warehouseId, and city are required")

        try:
            parsed_date = datetime.fromisoformat(date_raw).date()
        except ValueError:
            return _err("Invalid date. Expected YYYY-MM-DD")

        if not isinstance(order_ids, list) or len(order_ids) == 0:
            return _err("At least one orderId is required")

        if not isinstance(orders, list):
            return _err("orders must be an array")

        try:
            total_distance_value = float(total_distance_km or 0)
        except (TypeError, ValueError):
            total_distance_value = 0.0

        created_by = User.objects.filter(id=user_id).first() if user_id else None
        route = SavedRouteDraft.objects.create(
            date=parsed_date,
            warehouse_id=warehouse_id,
            warehouse_name=warehouse_name or "Unknown Warehouse",
            city=city,
            total_distance_km=total_distance_value,
            order_ids=[str(x) for x in order_ids],
            orders_json=orders,
            created_by_user=created_by,
        )
        return _ok({"success": True, "savedRoute": _serialize_saved_route(route)}, 201)

    body = _json_body(request)
    route_id = str(request.GET.get("id") or body.get("id") or "").strip()
    if not route_id:
        return _err("Route id is required")

    route = SavedRouteDraft.objects.filter(id=route_id).first()
    if not route:
        return _err("Saved route not found", 404)

    if role == "WAREHOUSE_STAFF" and user_id and route.created_by_user_id and route.created_by_user_id != user_id:
        return _err("Forbidden", 403)

    route.delete()
    return _ok({"success": True})


@csrf_exempt
@require_http_methods(["POST"])
def trip_start(request: HttpRequest, trip_id: str) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    t = Trip.objects.prefetch_related("drop_points__order").filter(id=trip_id).first()
    if not t:
        return _err("Trip not found", 404)
    if p.get("role") == "DRIVER" and p.get("userId") != t.driver.user_id:
        return _err("Forbidden", 403)

    # Drivers can only start a trip when all assigned delivery orders are loaded.
    not_loaded_order_numbers: list[str] = []
    for drop_point in t.drop_points.all():
        if not drop_point.order_id or not drop_point.order:
            continue
        stage = str(drop_point.order.warehouse_stage or "").upper()
        if stage not in {WarehouseStage.LOADED, WarehouseStage.DISPATCHED}:
            not_loaded_order_numbers.append(str(drop_point.order.order_number or drop_point.order_id))

    if not_loaded_order_numbers:
        preview = ", ".join(not_loaded_order_numbers[:5])
        if len(not_loaded_order_numbers) > 5:
            preview += f", +{len(not_loaded_order_numbers) - 5} more"
        return _err(f"Trip cannot be started. Orders not loaded yet: {preview}", 400)

    now = timezone.now()
    with transaction.atomic():
        t.status = TripStatus.IN_PROGRESS
        t.actual_start_at = now
        t.save(update_fields=["status", "actual_start_at", "updated_at"])

        for drop_point in t.drop_points.all():
            if not drop_point.order_id or not drop_point.order:
                continue
            order = drop_point.order
            if str(order.warehouse_stage or "").upper() == WarehouseStage.LOADED:
                order.warehouse_stage = WarehouseStage.DISPATCHED
                order.warehouse_dispatched_at = now
                order.status = OrderStatus.OUT_FOR_DELIVERY
                order.save(update_fields=["warehouse_stage", "warehouse_dispatched_at", "status", "updated_at"])

                timeline, _ = OrderTimeline.objects.get_or_create(order=order)
                if not timeline.shipped_at:
                    timeline.shipped_at = now
                    timeline.save(update_fields=["shipped_at", "updated_at"])
    return _ok({"success": True, "trip": _serialize_model(t)})


@csrf_exempt
@require_http_methods(["PATCH"])
def trip_drop_point_update(request: HttpRequest, trip_id: str, drop_point_id: str) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    dp = TripDropPoint.objects.select_related("trip").filter(id=drop_point_id, trip_id=trip_id).first()
    if not dp:
        return _err("Drop point not found", 404)
    if p.get("role") == "DRIVER" and p.get("userId") != dp.trip.driver.user_id:
        return _err("Forbidden", 403)
    body = _json_body(request)
    requeued_to_route_pool = False
    next_status = str(body.get("status") or "").strip().upper()
    reschedule_window = str(body.get("rescheduleWindow") or "").strip().lower()
    reschedule_requested = bool(body.get("rescheduleRequested")) or bool(reschedule_window)
    rescheduled_delivery_at: datetime | None = None
    if next_status == "FAILED" and reschedule_requested:
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
    if next_status == "COMPLETED" and dp.order_id:
        open_replacements = []
        for entry in Return.objects.filter(order_id=dp.order_id, drop_point_id=dp.id):
            if not _is_replacement_closed(entry):
                open_replacements.append(entry)
        if open_replacements:
            return _err("Drop point cannot be completed while a replacement follow-up is still open", 400)
    mapping = [("status", "status"), ("recipientName", "recipient_name"), ("recipientSignature", "recipient_signature"), ("deliveryPhoto", "delivery_photo"), ("failureReason", "failure_reason"), ("failureNotes", "failure_notes"), ("notes", "notes")]
    for key, attr in mapping:
        if key in body:
            setattr(dp, attr, body.get(key))
    now = timezone.now()
    if body.get("status") == "ARRIVED":
        dp.actual_arrival = now
    if body.get("status") in {"COMPLETED", "FAILED", "SKIPPED"}:
        dp.actual_departure = now
    dp.save()
    
    release_inventory = body.get("releaseInventory")
    if isinstance(release_inventory, str):
        normalized_release_inventory = release_inventory.strip().lower()
        parsed_release_inventory = normalized_release_inventory in {"1", "true", "yes", "y", "on"}
    elif release_inventory is None:
        parsed_release_inventory = True
    else:
        parsed_release_inventory = bool(release_inventory)
    should_release_inventory = body.get("status") == "SKIPPED" or parsed_release_inventory

    # If drop point is marked as FAILED or SKIPPED, optionally return items back to inventory
    if body.get("status") in {"FAILED", "SKIPPED"} and should_release_inventory and dp.order_id:
        order = Order.objects.prefetch_related("items").filter(id=dp.order_id).first()
        if order:
            user_id = str(p.get("userId") or "").strip() or None
            for order_item in order.items.all():
                _adjust_reserved_for_order_item(
                    order_item=order_item,
                    operation="release",
                    performed_by=user_id,
                )

    if next_status in {"FAILED", "SKIPPED"} and dp.order_id:
        order = Order.objects.select_related("timeline").filter(id=dp.order_id).first()
        if order:
            timeline = getattr(order, "timeline", None)
            if next_status == "FAILED" and reschedule_requested:
                order.status = OrderStatus.PREPARING
                order.warehouse_stage = WarehouseStage.READY_TO_LOAD
                order.loaded_at = None
                order.warehouse_dispatched_at = None
                update_fields = ["status", "warehouse_stage", "loaded_at", "warehouse_dispatched_at", "updated_at"]
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
                order.save(update_fields=["status", "updated_at"])
                if timeline:
                    if not timeline.cancelled_at:
                        timeline.cancelled_at = now
                    timeline.save(update_fields=["cancelled_at", "updated_at"])
                else:
                    OrderTimeline.objects.create(order=order, cancelled_at=now)
    
    t = dp.trip
    terminal_drop_point_statuses = ["COMPLETED", "FAILED", "SKIPPED"]
    actual_total_drop_points = t.drop_points.count()
    effective_total_drop_points = max(_int(t.total_drop_points, 0), actual_total_drop_points)

    t.total_drop_points = effective_total_drop_points
    t.completed_drop_points = t.drop_points.filter(status__in=terminal_drop_point_statuses).count()

    all_drop_points_terminal = effective_total_drop_points > 0 and t.completed_drop_points >= effective_total_drop_points
    if all_drop_points_terminal:
        t.status = TripStatus.COMPLETED
        t.actual_end_at = now
    else:
        t.status = TripStatus.IN_PROGRESS if t.actual_start_at else TripStatus.PLANNED
        t.actual_end_at = None

    t.save(update_fields=["total_drop_points", "completed_drop_points", "status", "actual_end_at", "updated_at"])
    return _ok({"success": True, "dropPoint": _serialize_model(dp), "requeuedToRoutePool": requeued_to_route_pool})


@csrf_exempt
@require_http_methods(["PATCH"])
def trip_stop_update(request: HttpRequest, trip_id: str, stop_id: str) -> JsonResponse:
    return trip_drop_point_update(request, trip_id, stop_id)


def _handle_image_upload(request: HttpRequest, folder: str, prefix: str) -> JsonResponse:
    file_obj = request.FILES.get("file")
    if not file_obj:
        return _err("Image file is required")
    if not str(file_obj.content_type or "").lower().startswith("image/"):
        return _err("Only image files are allowed")
    media_root = Path(__file__).resolve().parents[1] / "media" / "uploads" / folder
    media_root.mkdir(parents=True, exist_ok=True)
    ext = (Path(file_obj.name).suffix or ".png").lower()
    name = f"{prefix}-{int(timezone.now().timestamp() * 1000)}{ext}"
    target = media_root / name
    with target.open("wb") as f:
        for chunk in file_obj.chunks():
            f.write(chunk)
    return _ok({"success": True, "imageUrl": f"/uploads/{folder}/{name}"})


@csrf_exempt
@require_http_methods(["POST"])
def upload_product_image(request: HttpRequest) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    return _handle_image_upload(request, "products", "product")


@csrf_exempt
@require_http_methods(["POST"])
def upload_pod_image(request: HttpRequest) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    if p.get("role") != "DRIVER":
        return _err("Forbidden", 403)
    return _handle_image_upload(request, "pods", "pod")


@csrf_exempt
@require_http_methods(["POST"])
def upload_customer_avatar(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    return _handle_image_upload(request, "customers", "customer")


@csrf_exempt
@require_http_methods(["POST"])
def upload_driver_license(request: HttpRequest) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    if p.get("role") != "DRIVER":
        return _err("Forbidden", 403)
    return _handle_image_upload(request, "driver-licenses", "license")


def ensure_demo_accounts() -> None:
    super_admin_role, _ = Role.objects.get_or_create(name="SUPER_ADMIN", defaults={"description": "Full system access"})
    driver_role, _ = Role.objects.get_or_create(name="DRIVER", defaults={"description": "Delivery driver"})
    warehouse_role, _ = Role.objects.get_or_create(name="WAREHOUSE_STAFF", defaults={"description": "Warehouse operations"})
    User.objects.get_or_create(email="admin@logistics.com", defaults={"name": "Admin User", "password": hash_password("admin123"), "phone": "+1-555-0100", "role": super_admin_role, "is_active": True})
    driver_user, _ = User.objects.get_or_create(email="driver@logistics.com", defaults={"name": "Demo Driver", "password": hash_password("driver123"), "phone": "+1-555-0103", "role": driver_role, "is_active": True})
    User.objects.get_or_create(email="warehouse@logistics.com", defaults={"name": "Warehouse Staff", "password": hash_password("admin123"), "phone": "+1-555-0102", "role": warehouse_role, "is_active": True})
    Customer.objects.get_or_create(email="customer@example.com", defaults={"name": "Demo Customer", "password": hash_password("customer123"), "phone": "+1-555-0104", "is_active": True})
    Driver.objects.get_or_create(user=driver_user, defaults={"license_number": f"DEMO-DRIVER-{driver_user.id[-6:].upper()}", "license_type": "B", "license_expiry": timezone.now() + timedelta(days=1500), "phone": driver_user.phone, "is_active": True})
