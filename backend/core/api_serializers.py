"""Response serialization for orders, replacements, trips and related rows."""

import json
import re
from datetime import datetime
from fractions import Fraction
from typing import Any

from django.db import transaction
from django.db.models import F, Prefetch, Q
from django.forms.models import model_to_dict

from . import views_api as legacy
from .api_constants import (
    DEFAULT_COUNTRY,
    DISCOUNT_NO,
    DISCOUNT_REMOVED,
    PRODUCT_UNIT_CASE,
    _NOT_PROVIDED,
)
from .api_utils import camel as _camel, to_float_or_none as _to_float_or_none, to_int as _int
from .empties_verification import serialize_declared_empties
from .fleet_sync import trip_is_overdue, trip_scheduled_date
from .mixed_case import serialize_mixed_component
from .models import (
    Customer,
    DropPointStatus,
    Inventory,
    InventoryTransaction,
    Order,
    OrderItem,
    OrderItemType,
    OrderStatus,
    Product,
    ProductPackaging,
    PurchaseOrderStage,
    PurchaseRequestStatus,
    Replacement,
    ReplacementStatus,
    Trip,
    TripDropPoint,
    TripStatus,
    User,
    Vehicle,
    Warehouse,
)


# Resolved through views_api so tests and runtime overrides that rebind
# these names on views_api keep applying here.


def empties_adjustments_for_orders(order_ids: list[str]) -> dict[str, dict[str, Any]]:
    return legacy.empties_adjustments_for_orders(order_ids)


# Helpers owned by sibling modules. Routing them through views_api keeps
# a single resolution point, so tests that patch there still apply.


def _calculate_orders_load_for_warehouse(orders: list[Order], warehouse_id: str | None, allocation_map: dict[str, Any] | None=None) -> tuple[int, float]:
    return legacy._calculate_orders_load_for_warehouse(orders, warehouse_id, allocation_map)


def _delivery_date_is_past(value: Any) -> bool:
    return legacy._delivery_date_is_past(value)


def _extract_replacement_meta(notes: Any) -> dict[str, Any]:
    return legacy._extract_replacement_meta(notes)


def _get_product_size_label(product: Any) -> str:
    return legacy._get_product_size_label(product)


def _is_linked_replacement_order_delivered(entry: Replacement, *, order_cache: dict[str, Any] | None=None) -> bool:
    return legacy._is_linked_replacement_order_delivered(entry, order_cache=order_cache)


def _is_replacement_closed(entry: Replacement, *, order_cache: dict[str, Any] | None=None) -> bool:
    return legacy._is_replacement_closed(entry, order_cache=order_cache)


def _normalize_order_status(value: Any) -> str:
    return legacy._normalize_order_status(value)


def _normalize_product_unit(raw: Any) -> str:
    return legacy._normalize_product_unit(raw)


def _normalize_replacement_mode(value: Any) -> str:
    return legacy._normalize_replacement_mode(value)


def _normalize_replacement_status(value: Any, replacement_mode: Any=None) -> str:
    return legacy._normalize_replacement_status(value, replacement_mode)


def _normalize_serialized_replacement_lines(entry: Replacement, order: Order | None, meta: dict[str, Any], *, normalized_status: str, delivered_linked_replacement_order: bool) -> list[dict[str, Any]]:
    return legacy._normalize_serialized_replacement_lines(entry, order, meta, normalized_status=normalized_status, delivered_linked_replacement_order=delivered_linked_replacement_order)


def _real_trips(qs):
    return legacy._real_trips(qs)


def _resolve_primary_admin_phone() -> str:
    return legacy._resolve_primary_admin_phone()


def _select_trip_for_order(order_id: str, require_driver: bool=False) -> Trip | None:
    return legacy._select_trip_for_order(order_id, require_driver)


def _strip_default_country_suffix(address: Any) -> str:
    return legacy._strip_default_country_suffix(address)


def _trip_status_rank(value: Any) -> int:
    return legacy._trip_status_rank(value)


def _serialize_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _serialize_model(obj: Any, include: dict[str, Any] | None = None, exclude: set[str] | None = None) -> dict[str, Any]:
    include = include or {}
    exclude = exclude or set()
    raw = model_to_dict(obj)
    if isinstance(obj, User):
        # Keep the public city-list contract; assignment audit details stay internal.
        raw["service_areas"] = obj.service_area_cities
    raw["id"] = getattr(obj, "id", raw.get("id"))
    out: dict[str, Any] = {}
    for key, val in raw.items():
        if key in exclude:
            continue
        out[_camel(key)] = _serialize_value(val)
    if isinstance(obj, Product):
        try:
            out["unit"] = _normalize_product_unit(raw.get("unit"))
        except ValueError:
            out["unit"] = PRODUCT_UNIT_CASE
        out["quantityPerCase"] = _int(raw.get("quantity_per_unit"), 0)
    if isinstance(obj, Inventory):
        quantity_per_case = _int(getattr(getattr(obj, "product", None), "quantity_per_unit", 0), 0)
        case_count = max(0, _int(raw.get("quantity"), 0))
        loose_bottles = max(0, _int(raw.get("loose_bottles"), 0))
        out["quantityPerCase"] = quantity_per_case
        out["looseBottles"] = loose_bottles
        out["totalBottles"] = (case_count * quantity_per_case) + loose_bottles if quantity_per_case > 0 else case_count + loose_bottles
    for key, fn in include.items():
        out[key] = fn(obj)
    return out


def _serialize_driver_vehicle_link(vehicle: Vehicle) -> dict[str, Any]:
    driver_payload = _serialize_model(vehicle.driver, exclude={"password"}) if getattr(vehicle, "driver", None) else None
    if driver_payload:
        driver_payload["user"] = _serialize_model(vehicle.driver, exclude={"password"})
    return {
        "id": f"veh-assignment-{vehicle.id}",
        "isActive": bool(vehicle.driver_id),
        "assignedAt": vehicle.updated_at.isoformat() if vehicle.driver_id and vehicle.updated_at else None,
        "driverId": vehicle.driver_id,
        "vehicleId": vehicle.id,
        "vehicle": _serialize_model(vehicle),
        "driver": driver_payload,
    }


def _order_refund_claims(order):
    """Deposit refund claims for an order, preferring rows the caller prefetched.

    Chaining .select_related() on the related manager builds a fresh queryset and
    silently bypasses prefetch_related, which is how this became one query per order.
    """
    prefetched = getattr(order, "_serialized_refund_claims", None)
    if prefetched is not None:
        return prefetched
    return order.deposit_refund_claims.select_related("product", "container_type").all()


def _serialize_order(
    order: Order,
    include_items: bool = True,
    include_progress: bool = False,
    *,
    warehouse_lookup: dict[str, Warehouse] | None = None,
    assigned_trip: Any = _NOT_PROVIDED,
    fulfillment_legs: list[dict[str, Any]] | None = None,
    warehouse_allocations: list[dict[str, Any]] | None = None,
    item_warehouse_allocations: dict[str, list[dict[str, Any]]] | None = None,
    item_trip_assignments: dict[str, list[dict[str, Any]]] | None = None,
    empties_adjustment: Any = _NOT_PROVIDED,
    packaging_cache: dict[str, ProductPackaging] | None = None,
    delivery_transactions: dict[str, list[str]] | None = None,
    pod_drop_point: TripDropPoint | None = None,
    primary_admin_phone: Any = _NOT_PROVIDED,
) -> dict[str, Any]:
    data = _serialize_model(order)
    # Existing clients still render this amount; the database no longer stores a constant zero column.
    data["shippingCost"] = 0
    data["status"] = _normalize_order_status(data.get("status"))
    # What the empties count added to this order, so every portal can show the
    # charge and say what it is for. Callers listing many orders pass a prebuilt
    # entry; a detail view looks up the single order it is rendering.
    adjustment = (
        empties_adjustment
        if empties_adjustment is not _NOT_PROVIDED
        else empties_adjustments_for_orders([str(order.id)]).get(str(order.id))
    )
    data["emptiesAdjustment"] = adjustment or None
    total_amount = float(getattr(order, "total_amount", 0) or 0)
    data["amountDue"] = round(total_amount + float((adjustment or {}).get("amount") or 0), 2)
    normalized_order_status = str(data.get("status") or "").strip().upper()
    request_status_value = str(data.get("requestStatus") or "").strip().upper()
    # For approved orders, the current delivery status is authoritative for the displayed PO stage.
    if request_status_value == PurchaseRequestStatus.APPROVED or order.purchase_order_number:
        stage_by_status = {
            OrderStatus.CONFIRMED: PurchaseOrderStage.APPROVED,
            OrderStatus.PREPARING: PurchaseOrderStage.PROCESSING,
            OrderStatus.OUT_FOR_DELIVERY: PurchaseOrderStage.OUT_FOR_DELIVERY,
            # A new schedule puts the PO back in the approved queue; processing is a separate staff action.
            OrderStatus.RESCHEDULED: PurchaseOrderStage.APPROVED,
            OrderStatus.DELIVERED: PurchaseOrderStage.DELIVERED,
            OrderStatus.CANCELLED: PurchaseOrderStage.CANCELLED,
            OrderStatus.REJECTED: PurchaseOrderStage.CANCELLED,
        }
        derived_stage = stage_by_status.get(normalized_order_status)
        if derived_stage:
            data["purchaseOrderStage"] = derived_stage
    # Retail and counter-sale orders may intentionally have no linked customer.
    data["customer"] = _serialize_model(order.customer, exclude={"password"}) if order.customer else None
    # Customer receipts use the same primary business contact across old and new orders.
    resolved_admin_phone = (
        _resolve_primary_admin_phone()
        if primary_admin_phone is _NOT_PROVIDED
        else str(primary_admin_phone or "").strip()
    )
    data["adminPhone"] = resolved_admin_phone or None
    data["sellerPhone"] = resolved_admin_phone or None
    warehouse = None
    warehouse_id = str(getattr(order, "warehouse_id", "") or "").strip()
    if warehouse_id:
        warehouse = (warehouse_lookup or {}).get(warehouse_id)
        if warehouse is None:
            warehouse = Warehouse.objects.filter(id=warehouse_id).first()
    data["warehouseName"] = str(getattr(warehouse, "name", "") or "").strip() or None
    data["warehouseCode"] = str(getattr(warehouse, "code", "") or "").strip() or None
    data["warehouseCity"] = str(getattr(warehouse, "city", "") or "").strip() or None
    data["warehouseProvince"] = str(getattr(warehouse, "province", "") or "").strip() or None
    timeline = getattr(order, "timeline", None)
    data["logistics"] = None
    data["timeline"] = _serialize_model(timeline) if timeline else None

    # Keep backward-compatible top-level shipping/timeline fields expected by portal UIs.
    shipping_latitude = order.shipping_latitude if order.shipping_latitude is not None else getattr(order.customer, "latitude", None)
    shipping_longitude = order.shipping_longitude if order.shipping_longitude is not None else getattr(order.customer, "longitude", None)
    data["shippingName"] = order.shipping_name
    data["shippingPhone"] = order.shipping_phone
    data["shippingAddress"] = _strip_default_country_suffix(order.shipping_address)
    data["shippingCity"] = order.shipping_city
    data["shippingProvince"] = order.shipping_province
    data["shippingZipCode"] = order.shipping_zip_code
    data["shippingCountry"] = DEFAULT_COUNTRY
    data["shippingLatitude"] = shipping_latitude
    data["shippingLongitude"] = shipping_longitude
    data["discountDetails"] = {
        "name": getattr(order, "discount_name", None),
        "type": getattr(order, "discount_type", DISCOUNT_NO),
        "status": getattr(order, "discount_status", DISCOUNT_REMOVED),
        "percent": float(getattr(order, "discount_percent_applied", 0) or 0),
        "amountPerCase": 0.0,
        "perCaseDiscount": float(getattr(order, "discount_per_case_applied", 0) or 0),
        "casesAffected": max(0, _int(getattr(order, "discount_cases_affected", 0), 0)),
        "totalDiscount": float(getattr(order, "discount", 0) or 0),
        "appliedByName": getattr(order, "discount_applied_by_name", None),
    }
    # Keep the requested product empties visible on the order for customer,
    # warehouse, admin, and driver workflows.
    # Chaining .select_related() here would build a fresh queryset and bypass any
    # prefetch, so list views hand the rows over on a serializer-only attribute
    # instead - the same pattern as _serialized_order_items below.
    refund_claims = _order_refund_claims(order)
    data["depositRefundClaims"] = [
        {
            "id": claim.id,
            "productId": claim.product_id,
            "productName": claim.product_name,
            "containerTypeId": claim.container_type_id,
            "containerTypeName": claim.container_type.name,
            "requestedQuantity": claim.requested_quantity,
            "collectedQuantity": claim.collected_quantity,
            "requestedCases": claim.requested_cases,
            "requestedLooseBottles": claim.requested_loose_bottles,
            "containersPerCase": claim.containers_per_case,
            "depositPerContainer": float(claim.deposit_per_container),
            "caseDepositAmount": float(claim.case_deposit_amount),
            "requestedAmount": float(claim.requested_amount),
            "collectedAmount": float(claim.collected_amount),
            "status": claim.status,
        }
        for claim in refund_claims
    ]

    if timeline:
        data["deliveryDate"] = timeline.delivery_date.isoformat() if timeline.delivery_date else None
        data["deliveredAt"] = timeline.delivered_at.isoformat() if timeline.delivered_at else None
    else:
        data["deliveryDate"] = None
        data["deliveredAt"] = None

    terminal_statuses = {OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.REJECTED}
    delivery_date_past = bool(
        timeline
        and timeline.delivery_date
        and _delivery_date_is_past(timeline.delivery_date)
        and normalized_order_status not in terminal_statuses
    )
    data["deliveryDatePast"] = delivery_date_past
    # Approved active POs must receive a new schedule before warehouse work continues.
    data["requiresReschedule"] = bool(
        delivery_date_past
        and str(getattr(order, "request_status", "") or "").strip().upper() == PurchaseRequestStatus.APPROVED
    )

    if include_items:
        items = []
        prefetched_items = getattr(order, "_serialized_order_items", None)
        order_items = prefetched_items if prefetched_items is not None else order.items.select_related("product").all()
        for item in order_items:
            row = _serialize_order_item_with_spare_products(
                item,
                include_full_product=True,
                packaging_cache=packaging_cache,
            )
            item_id = str(getattr(item, "id", "") or "").strip()
            if item_warehouse_allocations is not None and item_id:
                allocs = item_warehouse_allocations.get(item_id, [])
                row["warehouseAllocations"] = allocs
                row["allocatedQtyTotal"] = sum(max(0, _int(entry.get("allocatedQty"), 0)) for entry in allocs)
            if item_trip_assignments is not None and item_id:
                row["tripAssignments"] = item_trip_assignments.get(item_id, [])
            items.append(row)
        data["items"] = items

    if fulfillment_legs is not None:
        data["fulfillments"] = fulfillment_legs
    if warehouse_allocations is not None:
        data["warehouseAllocations"] = warehouse_allocations
        data["warehouseIds"] = [str((row or {}).get("warehouseId") or "").strip() for row in warehouse_allocations if str((row or {}).get("warehouseId") or "").strip()]
        data["warehouses"] = [
            {
                "id": str((row or {}).get("warehouseId") or "").strip() or None,
                "name": str((row or {}).get("warehouseName") or "").strip() or None,
                "code": str((row or {}).get("warehouseCode") or "").strip() or None,
            }
            for row in warehouse_allocations
            if str((row or {}).get("warehouseId") or "").strip()
        ]

    data["scheduledReplacement"] = _get_scheduled_replacement_payload(order)

    # Once an order is rescheduled, the previous failed trip should no longer appear
    # as its active assignment/progress until it is planned again.
    if normalized_order_status == OrderStatus.RESCHEDULED:
        assigned_trip = None

    # A caller that resolved trips for the whole page passes None for "this order has
    # none". Treating that as "not supplied" sent every trip-less order back to the
    # database one at a time.
    if assigned_trip is _NOT_PROVIDED:
        assigned_trip = None if normalized_order_status == OrderStatus.RESCHEDULED else _select_trip_for_order(order.id, require_driver=True)
    assigned_driver = getattr(assigned_trip, "driver", None)
    assigned_driver_name = ""
    if assigned_driver:
        assigned_driver_name = str(getattr(getattr(assigned_driver, "user", None), "name", "") or getattr(assigned_driver, "name", "") or "").strip()
    data["isDriverAssigned"] = bool(assigned_driver)
    data["assignedDriverName"] = assigned_driver_name or None
    data["assignedTripId"] = getattr(assigned_trip, "id", None)
    # Some older deliveries stored POD only on the completed trip stop. Callers
    # listing customer orders pass that stop so the customer sees the same proof as staff.
    pod_submitted_at = getattr(order, "pod_submitted_at", None) or getattr(pod_drop_point, "actual_departure", None)
    data["pod"] = {
        "recipientName": getattr(order, "pod_recipient_name", None) or getattr(pod_drop_point, "recipient_name", None),
        "deliveryPhoto": getattr(order, "pod_photo_url", None) or getattr(pod_drop_point, "delivery_photo", None),
        "submittedAt": pod_submitted_at.isoformat() if pod_submitted_at else None,
    }
    if include_progress:
        progress_trip = None if normalized_order_status == OrderStatus.RESCHEDULED else _select_trip_for_order(order.id, require_driver=False)
        if progress_trip:
            progress_trip = Trip.objects.select_related("driver", "vehicle").prefetch_related("drop_points__order").filter(id=progress_trip.id).first()
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
                "deliveryPhoto": getattr(progress_drop_point, "delivery_photo", None) if progress_drop_point else None,
                "actualArrival": progress_drop_point.actual_arrival.isoformat() if progress_drop_point and progress_drop_point.actual_arrival else None,
                "actualDeparture": progress_drop_point.actual_departure.isoformat() if progress_drop_point and progress_drop_point.actual_departure else None,
                "failureReason": getattr(progress_drop_point, "failure_reason", None) if progress_drop_point else None,
                "failureNotes": getattr(progress_drop_point, "failure_notes", None) if progress_drop_point else None,
                "notes": getattr(progress_drop_point, "notes", None) if progress_drop_point else None,
            },
        }

    # A workflow status alone must never promote an unapproved request into a PO.
    # A cancelled fulfillment retains the PO created by the original approval.
    is_approved_order = request_status_value == PurchaseRequestStatus.APPROVED or bool(order.purchase_order_number)
    po_num = str(getattr(order, "purchase_order_number", "") or "").strip() or None
    pr_num = str(getattr(order, "purchase_request_number", "") or "").strip() or None

    data["purchaseRequestNumber"] = pr_num or order.order_number
    data["purchaseOrderNumber"] = po_num if is_approved_order else None
    data["orderNumber"] = (po_num if (is_approved_order and po_num) else (pr_num or order.order_number))

    # Added: expose only the real inventory OUT transactions after delivery and
    # attach each ID to the order item it actually deducted from inventory.
    is_delivered = normalized_order_status == OrderStatus.DELIVERED or bool(getattr(timeline, "delivered_at", None))
    delivery_transaction_ids: list[str] = []
    delivery_transaction_ids_by_item: dict[str, list[str]] = {}
    if is_delivered:
        order_item_ids = [
            str(row.get("id") or "").strip()
            for row in data.get("items", [])
            if str(row.get("id") or "").strip()
        ]
        if not order_item_ids:
            # includeItems=none still needs the ids; the view prefetches them so this
            # does not become one query per delivered order.
            prefetched_item_ids = getattr(order, "_serialized_item_ids", None)
            order_item_ids = (
                [str(item.id) for item in prefetched_item_ids]
                if prefetched_item_ids is not None
                else [str(item_id) for item_id in order.items.values_list("id", flat=True)]
            )
        if order_item_ids and delivery_transactions is not None:
            # Prebuilt for the whole page: one query instead of one per delivered order.
            for item_id in order_item_ids:
                for transaction_id in delivery_transactions.get(item_id, []):
                    delivery_transaction_ids.append(transaction_id)
                    delivery_transaction_ids_by_item.setdefault(item_id, []).append(transaction_id)
        elif order_item_ids:
            order_item_id_set = set(order_item_ids)
            transaction_rows = InventoryTransaction.objects.filter(
                Q(order_item_id__in=order_item_ids)
                | Q(reference_type="order_item", reference_id__in=order_item_ids),
                type="OUT",
            ).order_by("created_at", "id").values("id", "order_item_id", "reference_id")
            for transaction in transaction_rows:
                transaction_id = str(transaction.get("id") or "").strip()
                item_id = str(transaction.get("order_item_id") or transaction.get("reference_id") or "").strip()
                if not transaction_id or item_id not in order_item_id_set:
                    continue
                delivery_transaction_ids.append(transaction_id)
                delivery_transaction_ids_by_item.setdefault(item_id, []).append(transaction_id)

    # Keep transaction IDs on every serialized item so the UI does not rely on
    # unrelated array positions when one item consumes multiple stock batches.
    for item_row in data.get("items", []):
        item_id = str(item_row.get("id") or "").strip()
        item_row["inventoryTransactionIds"] = delivery_transaction_ids_by_item.get(item_id, [])
    data["inventoryTransactionIds"] = delivery_transaction_ids
    data["inventoryTransactionId"] = delivery_transaction_ids[0] if delivery_transaction_ids else None
    # PR pages render the preserved request; PO screens keep the live transaction.
    request = getattr(order, "purchase_request", None)
    purchase_order = getattr(order, "purchase_order", None)
    data["purchaseRequest"] = None
    if request:
        def camel_snapshot(value):
            if isinstance(value, dict):
                return {_camel(key): camel_snapshot(item) for key, item in value.items()}
            if isinstance(value, list):
                return [camel_snapshot(item) for item in value]
            return value

        snapshot = camel_snapshot(request.snapshot)
        # The API's customer object is distinct from the snapshot's FK value.
        snapshot.pop("customer", None)
        snapshot["purchaseRequestNumber"] = request.number
        snapshot["requestStatus"] = request.status
        # Retain the existing item display contract and exclude later PO charges.
        snapshot["amountDue"] = snapshot.get("totalAmount", 0)
        snapshot["emptiesAdjustment"] = None
        snapshot["discountDetails"] = {
            "totalDiscount": snapshot.get("discount", 0),
            "percent": snapshot.get("discountPercentApplied", 0),
        }
        for item in snapshot.get("items", []):
            item["components"] = item.pop("mixedCaseComponents", [])
        data["purchaseRequest"] = {
            "id": request.pk, "number": request.number, "status": request.status,
            "lockedAt": request.locked_at.isoformat() if request.locked_at else None,
            "snapshot": snapshot,
        }
    data["purchaseOrder"] = {
        "id": purchase_order.pk, "number": purchase_order.number,
        "purchaseRequestId": purchase_order.purchase_request_id,
    } if purchase_order else None
    return data


def _serialize_replacement(
    entry: Replacement,
    *,
    warehouse_cache: dict[str, Any] | None = None,
    order_cache: dict[str, Any] | None = None,
    order_items_cache: dict[str, list[Any]] | None = None,
    order_item_by_id_cache: dict[str, Any] | None = None,
    product_cache: dict[str, Any] | None = None,
    replacement_pod_cache: dict[str, Any] | None = None,
) -> dict[str, Any]:
    # Optional page-wide lookups, all keyed by id and built once by the caller.
    # Passing none of them keeps the original per-row queries, so every existing
    # caller behaves exactly as before; passing one does not require the others.
    data = _serialize_model(entry)
    meta = _extract_replacement_meta(getattr(entry, "notes", ""))
    data["customerNotes"] = str(meta.get("customerNotes") or "").strip() or None
    order = getattr(entry, "order", None)
    warehouse_id = str(getattr(order, "warehouse_id", "") or "").strip() or None
    if not warehouse_id:
        trip_id = str(meta.get("tripId") or "").strip()
        if trip_id:
            source_trip = Trip.objects.filter(id=trip_id).only("warehouse_id").first()
            warehouse_id = str(getattr(source_trip, "warehouse_id", "") or "").strip() or None
    warehouse = None
    if warehouse_id:
        if warehouse_cache is not None and str(warehouse_id) in warehouse_cache:
            warehouse = warehouse_cache.get(str(warehouse_id))
        else:
            warehouse = Warehouse.objects.filter(id=warehouse_id).first()
    order_customer = getattr(order, "customer", None)
    customer = order_customer
    if not customer and entry.customer_id:
        customer = Customer.objects.filter(id=entry.customer_id).first()
    customer_name = next(
        (
            str(value).strip()
            for value in (
                getattr(customer, "name", None),
                getattr(order, "shipping_name", None),
                getattr(customer, "email", None),
                entry.customer_id,
            )
            if str(value or "").strip()
        ),
        None,
    )
    data["orderId"] = entry.order_id
    data["orderNumber"] = getattr(order, "order_number", None)
    # order_number is the PR number; the PO number is assigned on approval.
    data["purchaseOrderNumber"] = str(getattr(order, "purchase_order_number", "") or "").strip() or None
    data["warehouseId"] = warehouse_id
    data["warehouseName"] = str(getattr(warehouse, "name", "") or "").strip() or None
    data["warehouseCode"] = str(getattr(warehouse, "code", "") or "").strip() or None
    data["warehouseCity"] = str(getattr(warehouse, "city", "") or "").strip() or None
    data["warehouseProvince"] = str(getattr(warehouse, "province", "") or "").strip() or None
    data["customerName"] = customer_name
    data["customer"] = _serialize_model(customer, exclude={"password"}) if customer else None
    data["order"] = {
        "id": getattr(order, "id", None),
        "orderNumber": getattr(order, "order_number", None),
        "purchaseOrderNumber": data["purchaseOrderNumber"],
        "customer": data["customer"],
        "shippingName": getattr(order, "shipping_name", None),
        "warehouseId": warehouse_id,
        "warehouseName": data.get("warehouseName"),
        "warehouseCode": data.get("warehouseCode"),
        "warehouseCity": data.get("warehouseCity"),
        "warehouseProvince": data.get("warehouseProvince"),
    } if order else None
    data["replacementMode"] = _normalize_replacement_mode(data.get("replacementMode"))
    data["scheduledDeliveryDate"] = str(meta.get("scheduledDeliveryDate") or "").strip() or None
    linked_replacement_order_id = str(entry.delivery_transaction_id or meta.get("replacementOrderId") or "").strip() or None
    linked_replacement_order_number = str(meta.get("replacementOrderNumber") or "").strip() or None
    data["replacementOrderId"] = linked_replacement_order_id
    data["replacementOrderNumber"] = linked_replacement_order_number
    # Added: retain a permanent link after delivery so replacement POD remains available.
    data["linkedReplacementOrderId"] = linked_replacement_order_id
    data["linkedReplacementOrderNumber"] = linked_replacement_order_number

    linked_replacement_order = None
    if linked_replacement_order_id:
        if order_cache is not None and str(linked_replacement_order_id) in order_cache:
            linked_replacement_order = order_cache.get(str(linked_replacement_order_id))
        else:
            linked_replacement_order = Order.objects.filter(id=linked_replacement_order_id).first()
    elif linked_replacement_order_number:
        if order_cache is not None and str(linked_replacement_order_number) in order_cache:
            linked_replacement_order = order_cache.get(str(linked_replacement_order_number))
        else:
            linked_replacement_order = Order.objects.filter(order_number=linked_replacement_order_number).first()


    replacement_drop_point = None
    if linked_replacement_order:
        # Use the direct relationship as the source of truth without loading it twice.
        linked_replacement_order_number = str(linked_replacement_order.order_number or "").strip() or None
        data["replacementOrderNumber"] = linked_replacement_order_number
        data["linkedReplacementOrderNumber"] = linked_replacement_order_number
        linked_order_key = str(linked_replacement_order.id)
        if replacement_pod_cache is not None and linked_order_key in replacement_pod_cache:
            replacement_drop_point = replacement_pod_cache[linked_order_key]
        else:
            replacement_drop_point = (
                TripDropPoint.objects.filter(order_id=linked_replacement_order.id)
                .exclude(Q(delivery_photo__isnull=True) | Q(delivery_photo=""))
                .order_by("-actual_departure", "-updated_at")
                .first()
            )
    replacement_pod_submitted_at = (
        getattr(linked_replacement_order, "pod_submitted_at", None)
        if linked_replacement_order
        else None
    ) or (
        getattr(replacement_drop_point, "actual_departure", None)
        if replacement_drop_point
        else None
    )
    data["replacementDeliveryPod"] = {
        "recipientName": (
            getattr(linked_replacement_order, "pod_recipient_name", None)
            if linked_replacement_order
            else None
        ) or getattr(replacement_drop_point, "recipient_name", None),
        "deliveryPhoto": (
            getattr(linked_replacement_order, "pod_photo_url", None)
            if linked_replacement_order
            else None
        ) or getattr(replacement_drop_point, "delivery_photo", None),
        "submittedAt": replacement_pod_submitted_at.isoformat() if replacement_pod_submitted_at else None,
    }
    normalized_status = _normalize_replacement_status(data.get("status"), data.get("replacementMode"))
    linked_replacement_order_status = (
        _normalize_order_status(getattr(linked_replacement_order, "status", None))
        if linked_replacement_order
        else None
    )
    data["replacementOrderStatus"] = linked_replacement_order_status
    delivered_linked_replacement_order = linked_replacement_order_status == OrderStatus.DELIVERED
    if delivered_linked_replacement_order:
        normalized_status = ReplacementStatus.COMPLETED
        # Once linked replacement order is delivered, this replacement must no longer
        # be treated as scheduled/in-progress by downstream UIs.
        data["scheduledDeliveryDate"] = None
        data["replacementOrderId"] = None
        data["replacementOrderNumber"] = None
    elif linked_replacement_order_status in {OrderStatus.CANCELLED, OrderStatus.REJECTED}:
        # Fix: a closed delivery cannot remain actionable in the scheduled list.
        normalized_status = ReplacementStatus.CANCELLED
        data["scheduledDeliveryDate"] = None
        data["replacementOrderId"] = None
        data["replacementOrderNumber"] = None
    data["workflowStatus"] = normalized_status
    data["warehouseStage"] = None
    data["status"] = normalized_status
    original_item = None
    if entry.original_order_item_id:
        item_key = str(entry.original_order_item_id)
        if order_item_by_id_cache is not None and item_key in order_item_by_id_cache:
            original_item = order_item_by_id_cache[item_key]
        else:
            original_item = OrderItem.objects.select_related("product").filter(id=entry.original_order_item_id).first()
    if original_item is None and order is not None:
        original_item = (
            OrderItem.objects.select_related("product")
            .filter(order_id=order.id)
            .order_by("created_at", "id")
            .first()
        )
    replacement_product = None
    if entry.replacement_product_id:
        product_key = str(entry.replacement_product_id)
        if product_cache is not None and product_key in product_cache:
            replacement_product = product_cache[product_key]
        else:
            replacement_product = Product.objects.filter(id=entry.replacement_product_id).first()
    quantity_replaced = _int(meta.get("quantityReplaced"), _int(entry.replacement_quantity, 0))
    quantity_to_replace = _int(
        meta.get("quantityToReplace", meta.get("damagedQuantity", meta.get("totalDamagedQuantity"))),
        quantity_replaced,
    )
    replacement_mode = str(data.get("replacementMode") or "").strip().upper()
    if (
        replacement_mode == "CUSTOMER_SUBMITTED"
        and normalized_status not in {ReplacementStatus.COMPLETED, ReplacementStatus.RESOLVED_ON_DELIVERY}
    ):
        # Customer-submitted requests should not show replaced quantity/loss before approval/completion.
        quantity_replaced = 0
    if delivered_linked_replacement_order and quantity_to_replace > quantity_replaced:
        quantity_replaced = quantity_to_replace
    remaining_quantity = max(quantity_to_replace - quantity_replaced, 0)
    structured_replacement_lines = _normalize_serialized_replacement_lines(
        entry,
        order,
        meta,
        normalized_status=normalized_status,
        delivered_linked_replacement_order=delivered_linked_replacement_order,
    )
    if structured_replacement_lines:
        total_qty_to_replace = sum(max(0, _int(line.get("quantityToReplace"), 0)) for line in structured_replacement_lines)
        total_qty_replaced = sum(max(0, _int(line.get("quantityReplaced"), 0)) for line in structured_replacement_lines)
        total_remaining = max(total_qty_to_replace - total_qty_replaced, 0)
        data["quantityToReplace"] = total_qty_to_replace
        data["quantityReplaced"] = total_qty_replaced
        data["remainingQuantity"] = total_remaining
        data["replacementLines"] = structured_replacement_lines
        data["replacementItems"] = structured_replacement_lines

        # The claim value includes only the selected replacement quantities.
        # Order totals include unrelated products, discounts and deposits.
        replacement_amount = 0.0
        if order is None:
            source_items_by_id = {}
        elif order_items_cache is not None and str(order.id) in order_items_cache:
            source_items_by_id = {str(item.id): item for item in order_items_cache[str(order.id)]}
        else:
            source_items_by_id = {
                str(item.id): item
                for item in OrderItem.objects.select_related("product").filter(order_id=order.id)
            }
        for line in structured_replacement_lines:
            source_item = source_items_by_id.get(str(line.get("originalOrderItemId") or ""))
            unit_price = float(
                (getattr(source_item, "unit_price", 0) if source_item else 0)
                or line.get("unitPrice")
                or line.get("price")
                or 0
            )
            input_mode = str(line.get("lineInputMode") or line.get("replacementInputMode") or "").lower()
            if input_mode == "bottle":
                bottle_quantity = max(0, _int(line.get("quantityToReplaceBottles"), _int(line.get("quantityToReplace"), 0)))
                source_unit = str(
                    getattr(source_item, "product_unit", "")
                    or getattr(getattr(source_item, "product", None), "unit", "")
                    or line.get("originalProductUnit")
                    or ""
                ).lower()
                # A bottle submitted from a case-priced order is a fraction of
                # that order-line price, never the full case price.
                billed_quantity = (
                    bottle_quantity / max(1, _int(line.get("quantityPerCase"), 1))
                    if "bottle" not in source_unit
                    else bottle_quantity
                )
            else:
                billed_quantity = max(
                    0,
                    _int(line.get("quantityToReplaceCases"), _int(line.get("quantityToReplaceUnits"), 0)),
                )
                if billed_quantity <= 0:
                    quantity_per_case = max(1, _int(line.get("quantityPerCase"), 1))
                    billed_quantity = max(0, _int(line.get("quantityToReplace"), 0)) / quantity_per_case
            replacement_amount += unit_price * billed_quantity
        data["replacementAmount"] = round(replacement_amount, 2)
        data["replacementTotalAmount"] = data["replacementAmount"]

        first_line = structured_replacement_lines[0]
        original_names: list[str] = []
        replacement_names: list[str] = []
        for line in structured_replacement_lines:
            original_name = str(line.get("originalProductName") or "").strip()
            replacement_name = str(line.get("replacementProductName") or "").strip()
            if original_name and original_name not in original_names:
                original_names.append(original_name)
            if replacement_name and replacement_name not in replacement_names:
                replacement_names.append(replacement_name)

        def _format_product_summary(values: list[str]) -> str | None:
            if not values:
                return None
            if len(values) <= 3:
                return ", ".join(values)
            return f"{', '.join(values[:3])} +{len(values) - 3} more"

        data["originalProductName"] = _format_product_summary(original_names)
        data["replacementProductName"] = _format_product_summary(replacement_names or original_names)
        data["originalProductSku"] = first_line.get("originalProductSku") or None
        data["replacementProductSku"] = first_line.get("replacementProductSku") or None
        data["originalProductSize"] = first_line.get("originalProductSize") or None
        data["replacementProductSize"] = first_line.get("replacementProductSize") or None

        first_original_order_item_id = str(first_line.get("originalOrderItemId") or "").strip()
        first_original_item = None
        if first_original_order_item_id:
            if order_item_by_id_cache is not None and first_original_order_item_id in order_item_by_id_cache:
                first_original_item = order_item_by_id_cache[first_original_order_item_id]
            else:
                first_original_item = OrderItem.objects.select_related("product").filter(id=first_original_order_item_id).first()
        if first_original_item:
            data["originalOrderItem"] = {
                "id": first_original_item.id,
                "quantity": first_original_item.quantity,
                "product": _serialize_model(first_original_item.product) if first_original_item.product_id else None,
            }
            data["originalQuantity"] = first_original_item.quantity
    elif original_item:
        data["originalOrderItem"] = {
            "id": original_item.id,
            "quantity": original_item.quantity,
            "product": _serialize_model(original_item.product) if original_item.product_id else None,
        }
        original_product_name = str(getattr(original_item.product, "name", "") or getattr(original_item, "product_name", "") or "").strip() or None
        original_product_sku = str(getattr(original_item.product, "sku", "") or getattr(original_item, "product_sku", "") or "").strip() or None
        original_product_sizes = getattr(original_item.product, "sizes", None) if getattr(original_item, "product", None) else None
        original_product_size = ", ".join([str(x).strip() for x in (original_product_sizes or []) if str(x).strip()]) if isinstance(original_product_sizes, list) else None
        data["originalProductName"] = original_product_name
        data["originalProductSku"] = original_product_sku
        data["originalProductSize"] = original_product_size
        data["originalQuantity"] = original_item.quantity
        data["quantityToReplace"] = quantity_to_replace
        data["quantityReplaced"] = quantity_replaced
        data["remainingQuantity"] = remaining_quantity
        replacement_product_name = str(getattr(replacement_product, "name", "") or "").strip() or original_product_name
        replacement_product_sku = str(getattr(replacement_product, "sku", "") or "").strip() or original_product_sku
        replacement_product_sizes = getattr(replacement_product, "sizes", None) if replacement_product else original_product_sizes
        replacement_product_size = ", ".join([str(x).strip() for x in (replacement_product_sizes or []) if str(x).strip()]) if isinstance(replacement_product_sizes, list) else original_product_size
        replacement_lines = [
            {
                "originalOrderItemId": original_item.id,
                "originalProductName": original_product_name,
                "originalProductSku": original_product_sku,
                "originalProductSize": original_product_size,
                "replacementProductName": replacement_product_name,
                "replacementProductSku": replacement_product_sku,
                "replacementProductSize": replacement_product_size,
                "quantityToReplace": quantity_to_replace,
                "quantityReplaced": quantity_replaced,
                "remainingQuantity": remaining_quantity,
            }
        ]
        # `replacementLines` is the canonical key; keep `replacementItems` for compatibility.
        data["replacementLines"] = replacement_lines
        data["replacementItems"] = replacement_lines
    else:
        # Last-resort fallback for legacy records where original item linkage is missing.
        data["quantityToReplace"] = quantity_to_replace
        data["quantityReplaced"] = quantity_replaced
        data["remainingQuantity"] = remaining_quantity
    if replacement_product:
        data["replacementProduct"] = _serialize_model(replacement_product)
        if not structured_replacement_lines:
            data["replacementProductName"] = replacement_product.name
            data["replacementProductSku"] = replacement_product.sku
            replacement_sizes = getattr(replacement_product, "sizes", None)
            data["replacementProductSize"] = ", ".join([str(x).strip() for x in (replacement_sizes or []) if str(x).strip()]) if isinstance(replacement_sizes, list) else None
    elif data.get("originalProductName") and not data.get("replacementProductName"):
        data["replacementProductName"] = data.get("originalProductName")
        data["replacementProductSku"] = data.get("originalProductSku")
        data["replacementProductSize"] = data.get("originalProductSize")
    damage_photo_urls: list[str] = []
    raw_damage_photo_urls = str(getattr(entry, "damage_photo_urls", "") or "").strip()
    if raw_damage_photo_urls:
        try:
            parsed_urls = json.loads(raw_damage_photo_urls)
            if isinstance(parsed_urls, list):
                damage_photo_urls = [str(url).strip() for url in parsed_urls if str(url).strip()]
        except (TypeError, ValueError):
            damage_photo_urls = []
    if not damage_photo_urls:
        meta_damage_photos = meta.get("damagePhotos") if isinstance(meta.get("damagePhotos"), list) else []
        damage_photo_urls = [str(url).strip() for url in meta_damage_photos if str(url).strip()]
    if not damage_photo_urls and str(getattr(entry, "damage_photo_url", "") or "").strip():
        damage_photo_urls = [str(getattr(entry, "damage_photo_url", "")).strip()]
    data["damagePhotoUrls"] = damage_photo_urls
    if damage_photo_urls and not data.get("damagePhotoUrl"):
        data["damagePhotoUrl"] = damage_photo_urls[0]
    status_timeline = [item for item in (meta.get("statusTimeline") or []) if isinstance(item, dict)]
    if not status_timeline or str(status_timeline[-1].get("status") or "").upper() != str(normalized_status or "").upper():
        # Fix: legacy records still expose a timeline that agrees with the latest database status.
        status_at = getattr(entry, "updated_at", None) or getattr(entry, "created_at", None)
        status_timeline.append({
            "status": normalized_status,
            "at": status_at.isoformat() if status_at else None,
        })
    data["statusTimeline"] = status_timeline
    # Expose the immutable review audit fields to monitoring portals.
    data["reviewDecision"] = meta.get("reviewDecision") if isinstance(meta.get("reviewDecision"), dict) else None
    return data


def _serialize_trip(trip: Trip, include_points: bool = True, *, ctx: dict = None) -> dict[str, Any]:
    if ctx is None: ctx = {}
    data = _serialize_model(trip)
    data["driver"] = _serialize_model(trip.driver, exclude={"password"}) if getattr(trip, "driver", None) else None
    data["vehicle"] = _serialize_model(trip.vehicle)
    trip_orders = [
        point.order
        for point in trip.drop_points.all()
        if getattr(point, "order", None) is not None
    ]
    total_cases, total_weight = _calculate_orders_load_for_warehouse(
        trip_orders,
        str(getattr(trip, "warehouse_id", "") or "").strip() or None,
        ctx.get("allocations_map"),
    )
    vehicle_capacity = float(getattr(getattr(trip, "vehicle", None), "capacity", 0) or 0)
    data["totalCases"] = total_cases
    data["totalWeight"] = round(total_weight, 2)
    data["vehicleMaxWeightCapacity"] = vehicle_capacity
    data["weightRemaining"] = round(vehicle_capacity - total_weight, 2)
    warehouse_lat = None
    warehouse_lng = None
    if trip.warehouse_id:
        warehouse_cache = ctx.get("warehouse_cache")
        warehouse = warehouse_cache.get(str(trip.warehouse_id)) if warehouse_cache is not None else Warehouse.objects.filter(id=trip.warehouse_id).first()
        if warehouse:
            data["warehouse"] = _serialize_model(warehouse)
            warehouse_lat = _to_float_or_none(getattr(warehouse, "latitude", None))
            warehouse_lng = _to_float_or_none(getattr(warehouse, "longitude", None))
    data["warehouseLatitude"] = warehouse_lat
    data["warehouseLongitude"] = warehouse_lng
    trip_schedule_candidates: list[str] = []
    if include_points:
        drop_points: list[dict[str, Any]] = []
        cash_collected_total = 0.0
        prefetched_drop_points = getattr(trip, "_prefetched_objects_cache", {}).get("drop_points")
        if prefetched_drop_points is not None:
            drop_point_rows = sorted(prefetched_drop_points, key=lambda point: point.sequence)
        else:
            drop_point_rows = trip.drop_points.select_related(
                "order",
                "order__customer",
                "order__timeline",
            ).prefetch_related(
                "order__items__product",
            ).order_by("sequence")


        order_ids = [str(dp.order.id) for dp in drop_point_rows if getattr(dp, "order_id", None) and getattr(dp, "order", None)]
        
        allocations_map = ctx.get("allocations_map")
        if allocations_map is None:
            allocations_map = _build_order_item_warehouse_allocations_map(order_ids) if order_ids else {}
            
        all_assignments_map = ctx.get("all_assignments_map")
        if all_assignments_map is None:
            all_assignments_map = _build_order_item_trip_assignments_map(order_ids, trip_id=None) if order_ids else {}

        empties_adjustment_map = ctx.get("empties_adjustment_map")
        if empties_adjustment_map is None:
            empties_adjustment_map = empties_adjustments_for_orders(order_ids) if order_ids else {}

        trip_assignments_map = ctx.get("trip_assignments_map")
        if trip_assignments_map is None and ctx.get("all_assignments_map") is not None:
            # Fix: derive each trip's assignments from the batched all-trip map.
            trip_id = str(getattr(trip, "id", "") or "").strip()
            trip_assignments_map = {
                order_id: {
                    item_id: [entry for entry in entries if str(entry.get("tripId") or "").strip() == trip_id]
                    for item_id, entries in items.items()
                }
                for order_id, items in all_assignments_map.items()
            }
        elif trip_assignments_map is None:
            trip_assignments_map = _build_order_item_trip_assignments_map(order_ids, trip_id=str(getattr(trip, "id", "") or "").strip() or None) if order_ids else {}
            
        warehouse_cache = ctx.get("warehouse_cache")
        if warehouse_cache is None:
            warehouse_cache = {}
            wh_ids = {str(dp.order.warehouse_id) for dp in drop_point_rows if getattr(dp, "order", None) and getattr(dp.order, "warehouse_id", None)}
            if trip.warehouse_id: wh_ids.add(str(trip.warehouse_id))
            if wh_ids:
                warehouse_cache = {str(w.id): w for w in Warehouse.objects.filter(id__in=wh_ids)}
                
        order_returns_map = ctx.get("order_returns_map")
        if order_returns_map is None:
            order_returns_map = {}
            if order_ids:
                from core.models import Replacement
                replacements = Replacement.objects.filter(order_id__in=order_ids)
                for r in replacements:
                    order_returns_map.setdefault(str(r.order_id), []).append(r)

        # Fix: cash is final only after the trip is closed. The delivered order
        # status is the accounting authority even if an older stop status is stale.
        trip_is_completed = str(getattr(trip, "status", "") or "").upper() == TripStatus.COMPLETED

        for dp in drop_point_rows:
            row = _serialize_model(dp)
            row["address"] = _strip_default_country_suffix(row.get("address"))
            if dp.order_id and dp.order:
                if getattr(dp.order, "timeline", None) and dp.order.timeline.delivery_date:
                    trip_schedule_candidates.append(dp.order.timeline.delivery_date.isoformat())
                order_items = list(dp.order.items.all())
                item_allocations_by_order = allocations_map.get(str(dp.order.id), {})
                # Get trip assignments for current trip (for allocation UI)
                item_trip_assignments_by_order = trip_assignments_map.get(str(dp.order.id), {})
                # Get ALL trip assignments for this order (to detect items assigned to other trips)
                all_item_trip_assignments_by_order = all_assignments_map.get(str(dp.order.id), {})
                order_returns = order_returns_map.get(str(dp.order.id), [])
                order_warehouse_id = str(getattr(dp.order, "warehouse_id", "") or "").strip() or None
                order_warehouse = warehouse_cache.get(order_warehouse_id)
                # Fix: edit-trip route rows need each existing order's warehouse-scoped
                # load; the trip-level totals cannot identify the load of selected rows.
                order_load_cases, order_load_weight = _calculate_orders_load_for_warehouse(
                    [dp.order],
                    str(getattr(trip, "warehouse_id", "") or "").strip() or None,
                    allocations_map,
                )
                empties_adjustment = empties_adjustment_map.get(str(dp.order.id))
                amount_due = round(
                    float(getattr(dp.order, "total_amount", 0) or 0)
                    + float((empties_adjustment or {}).get("amount") or 0),
                    2,
                )
                is_replacement_delivery = str(getattr(dp.order, "order_number", "") or "").strip().upper().startswith("RPL-")
                # Fix: scheduled replacements are free fulfillment deliveries and
                # must never be counted as cash collected by the driver.
                if trip_is_completed and not is_replacement_delivery and _normalize_order_status(dp.order.status) == OrderStatus.DELIVERED:
                    cash_collected_total += amount_due
                row["orderStatus"] = _normalize_order_status(dp.order.status)
                row["orderNumber"] = dp.order.order_number
                # The empties the customer claimed at checkout, for the driver to verify.
                row["declaredEmpties"] = serialize_declared_empties(
                    dp.order,
                    packaging_cache=ctx.get("packaging_cache"),
                )
                row["order"] = {
                    "id": dp.order.id,
                    "orderNumber": dp.order.order_number,
                    # Explicit stored identities link this transportation record back to its PR.
                    "purchaseRequestNumber": dp.order.purchase_request_number,
                    "purchaseOrderNumber": dp.order.purchase_order_number,
                    "deliveryDate": dp.order.timeline.delivery_date.isoformat() if getattr(dp.order, "timeline", None) and dp.order.timeline.delivery_date else None,
                    "warehouseId": order_warehouse_id,
                    "warehouseName": str(getattr(order_warehouse, "name", "") or "").strip() or None,
                    "warehouseCode": str(getattr(order_warehouse, "code", "") or "").strip() or None,
                    "warehouseAddress": _strip_default_country_suffix(str(getattr(order_warehouse, "address", "") or "").strip()) or None,
                    "warehouseCity": str(getattr(order_warehouse, "city", "") or "").strip() or None,
                    "warehouseProvince": str(getattr(order_warehouse, "province", "") or "").strip() or None,
                    "status": _normalize_order_status(dp.order.status),
                    "totalCases": order_load_cases,
                    "totalWeight": round(order_load_weight, 2),
                    "isDriverAssigned": bool(trip.driver_id),
                    "assignedDriverName": str(getattr(getattr(trip.driver, "user", None), "name", "") or "").strip() or None,
                    "totalAmount": dp.order.total_amount,
                    "emptiesAdjustment": empties_adjustment,
                    "amountDue": amount_due,
                    # Added: transportation, driver, and warehouse trip details
                    # need the same applied-refund breakdown as the order portals.
                    "depositRefundClaims": [
                        {
                            "id": claim.id,
                            "productName": claim.product_name,
                            "containerTypeId": claim.container_type_id,
                            "requestedQuantity": claim.requested_quantity,
                            "requestedCases": claim.requested_cases,
                            "requestedLooseBottles": claim.requested_loose_bottles,
                            "requestedAmount": float(claim.requested_amount),
                            "status": claim.status,
                        }
                        for claim in _order_refund_claims(dp.order)
                    ],
                    "scheduledReplacement": _get_scheduled_replacement_payload(dp.order),
                    "items": [
                        {
                            **_serialize_order_item_with_spare_products(
                                item,
                                include_full_product=False,
                                packaging_cache=ctx.get("packaging_cache"),
                            ),
                            "warehouseAllocations": item_allocations_by_order.get(str(getattr(item, "id", "") or "").strip(), []),
                            "tripAssignments": item_trip_assignments_by_order.get(str(getattr(item, "id", "") or "").strip(), []),
                            "allTripAssignments": all_item_trip_assignments_by_order.get(str(getattr(item, "id", "") or "").strip(), []),
                        }
                        for item in order_items
                    ],
                    "replacements": [
                        {
                            **_serialize_replacement(
                                entry,
                                warehouse_cache=warehouse_cache,
                                order_cache=ctx.get("order_cache"),
                                order_items_cache=ctx.get("order_items_cache"),
                                order_item_by_id_cache=ctx.get("order_item_by_id_cache"),
                                product_cache=ctx.get("product_cache"),
                                replacement_pod_cache=ctx.get("replacement_pod_cache"),
                            ),
                            "remainingQuantity": max(
                                _int(
                                    next((item.quantity for item in order_items if item.id == entry.original_order_item_id), 0),
                                    0,
                                )
                                - _int(entry.replacement_quantity, 0),
                                0,
                            ),
                            "isClosed": _is_replacement_closed(entry, order_cache=ctx.get("order_cache")),
                        }
                        for entry in order_returns
                        if not dp.order_id or entry.order_id == dp.order_id
                    ],
                }

                # Backfill coordinates for old trips where TripDropPoint lat/lng were saved as null.
                if _to_float_or_none(row.get("latitude")) is None or _to_float_or_none(row.get("longitude")) is None:
                    fallback_lat = _to_float_or_none(
                        getattr(dp.order, "shipping_latitude", None) or getattr(dp.order.customer, "latitude", None)
                    )
                    fallback_lng = _to_float_or_none(
                        getattr(dp.order, "shipping_longitude", None) or getattr(dp.order.customer, "longitude", None)
                    )
                    if fallback_lat is not None and fallback_lng is not None:
                        row["latitude"] = fallback_lat
                        row["longitude"] = fallback_lng
            drop_points.append(row)
        data["dropPoints"] = drop_points
        data["cashCollectedTotal"] = round(cash_collected_total, 2)
    else:
        drop_point_rows = trip.drop_points.select_related("order__timeline").all()
        for dp in drop_point_rows:
            if dp.order_id and getattr(dp, "order", None) and getattr(dp.order, "timeline", None) and dp.order.timeline.delivery_date:
                trip_schedule_candidates.append(dp.order.timeline.delivery_date.isoformat())
    data["tripSchedule"] = min(trip_schedule_candidates) if trip_schedule_candidates else None
    # Added: every portal sorts and flags trips by the same local day trip_start
    # enforces, instead of each client re-deriving it from the timestamps above.
    scheduled_date = trip_scheduled_date(trip, drop_point_rows)
    data["scheduledDate"] = scheduled_date.isoformat() if scheduled_date else None
    data["isOverdue"] = trip_is_overdue(getattr(trip, "status", None), scheduled_date)
    return data


def _serialize_order_item_with_spare_products(
    item: OrderItem,
    *,
    include_full_product: bool = True,
    packaging_cache: dict[str, ProductPackaging] | None = None,
) -> dict[str, Any]:
    row = _serialize_model(item)
    product = getattr(item, "product", None)
    quantity_per_case = _int(getattr(product, "quantity_per_unit", 0), 0)
    packaging = (
        packaging_cache.get(str(product.id))
        if product and packaging_cache is not None
        else ProductPackaging.objects.filter(product=product, is_active=True).first() if product else None
    )
    containers_per_case = int(packaging.containers_per_case) if (packaging and packaging.containers_per_case) else (quantity_per_case or 1)
    snapshot_name = str(getattr(item, "product_name", "") or "").strip()
    snapshot_sku = str(getattr(item, "product_sku", "") or "").strip()
    snapshot_unit = _normalize_product_unit(getattr(item, "product_unit", None))
    product_size_label = _get_product_size_label(product) if product else ""
    product_sizes = list(getattr(product, "sizes", []) or []) if product else []
    row["quantityPerCase"] = quantity_per_case
    row["containersPerCase"] = containers_per_case
    row["caseDepositAmount"] = float(packaging.case_deposit_amount or 0) if packaging else 0.0
    row["depositAmount"] = float(packaging.deposit_amount or 0) if packaging else 0.0
    if include_full_product:
        if product:
            row["product"] = _serialize_model(product)
            row["product"]["quantityPerCase"] = quantity_per_case
            row["product"]["sizeLabel"] = product_size_label or None
            row["product"]["size"] = product_size_label or None
            row["product"]["sizes"] = product_sizes
            row["product"]["category"] = str(getattr(product, "category", "") or "").strip() or None
        else:
            row["product"] = {
                "id": None,
                "sku": snapshot_sku or None,
                "name": snapshot_name or "Product",
                "unit": snapshot_unit,
                "quantityPerCase": 0,
                "sizeLabel": None,
                "size": None,
                "sizes": [],
                "category": None,
                "isActive": False,
            }
    else:
        row["product"] = (
            {
                "id": product.id,
                "sku": product.sku,
                "name": product.name,
                # Added: driver trip/history thumbnails need the stored product image.
                "imageUrl": product.image_url,
                "unit": _normalize_product_unit(product.unit),
                "quantityPerCase": quantity_per_case,
                "sizeLabel": product_size_label or None,
                "size": product_size_label or None,
                "sizes": product_sizes,
                "category": str(getattr(product, "category", "") or "").strip() or None,
            }
            if product
            else {
                "id": None,
                "sku": snapshot_sku or None,
                "name": snapshot_name or "Product",
                "unit": snapshot_unit,
                "quantityPerCase": 0,
                "sizeLabel": None,
                "size": None,
                "sizes": [],
                "category": None,
            }
        )
    # Mixed-case contents must remain available to every portal after the order is reloaded.
    if str(getattr(item, "item_type", "") or "").strip().upper() == "MIXED_CASE":
        prefetched_components = getattr(item, "_serialized_mixed_case_components", None)
        components = (
            prefetched_components
            if prefetched_components is not None
            else item.mixed_case_components.select_related("product").all().order_by("created_at", "id")
        )
        row["components"] = [serialize_mixed_component(component) for component in components]
    else:
        row["components"] = []
    return row


def _build_delivery_transactions_map(order_ids: list[str]) -> dict[str, dict[str, list[str]]]:
    """Stock-out movements per order item, for a whole page of orders at once."""
    normalized_ids = [str(order_id or "").strip() for order_id in order_ids if str(order_id or "").strip()]
    if not normalized_ids:
        return {}

    item_to_order = {
        str(item_id): str(order_id)
        for item_id, order_id in OrderItem.objects.filter(order_id__in=normalized_ids).values_list("id", "order_id")
    }
    if not item_to_order:
        return {}

    grouped: dict[str, dict[str, list[str]]] = {}
    rows = (
        InventoryTransaction.objects.filter(
            Q(order_item_id__in=item_to_order.keys())
            | Q(reference_type="order_item", reference_id__in=item_to_order.keys()),
            type="OUT",
        )
        .order_by("created_at", "id")
        .values("id", "order_item_id", "reference_id")
    )
    for row in rows:
        transaction_id = str(row.get("id") or "").strip()
        item_id = str(row.get("order_item_id") or row.get("reference_id") or "").strip()
        order_id = item_to_order.get(item_id)
        if not transaction_id or not order_id:
            continue
        grouped.setdefault(order_id, {}).setdefault(item_id, []).append(transaction_id)
    return grouped


def _build_order_fulfillment_legs_map(order_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    normalized_ids = [str(order_id or "").strip() for order_id in order_ids if str(order_id or "").strip()]
    if not normalized_ids:
        return {}

    # Get fulfillment legs from TripDropPoint (existing logic)
    points = (
        TripDropPoint.objects.select_related("trip")
        .filter(order_id__in=normalized_ids)
        .order_by("order_id", "sequence", "created_at", "id")
    )

    warehouse_ids = {
        str(getattr(point.trip, "warehouse_id", "") or "").strip()
        for point in points
        if getattr(point, "trip", None) is not None
    }
    warehouse_ids = {warehouse_id for warehouse_id in warehouse_ids if warehouse_id}
    warehouse_lookup = {
        warehouse.id: warehouse
        for warehouse in Warehouse.objects.filter(id__in=list(warehouse_ids))
    } if warehouse_ids else {}

    out: dict[str, list[dict[str, Any]]] = {}
    seen_keys: dict[str, set[str]] = {}  # order_id -> set of "warehouse_id::trip_id" keys

    for point in points:
        order_id = str(getattr(point, "order_id", "") or "").strip()
        if not order_id:
            continue
        trip = getattr(point, "trip", None)
        # Skip if trip doesn't exist (was deleted)
        if not trip:
            continue
        warehouse_id = str(getattr(trip, "warehouse_id", "") or "").strip()
        warehouse = warehouse_lookup.get(warehouse_id) if warehouse_id else None
        status_value = _normalize_order_status(getattr(point, "status", None) or getattr(trip, "status", None))
        trip_id = str(getattr(trip, "id", "") or "").strip()
        trip_number = str(getattr(trip, "trip_number", "") or "").strip()

        # Check for duplicates BEFORE adding
        key = f"{warehouse_id}::{trip_id}"
        if key in seen_keys.get(order_id, set()):
            continue  # Skip duplicate
        
        # Track seen combination
        seen_keys.setdefault(order_id, set()).add(key)

        out.setdefault(order_id, []).append(
            {
                "id": str(getattr(point, "id", "") or "").strip() or None,
                "warehouseId": warehouse_id,
                "warehouseName": str(getattr(warehouse, "name", "") or "").strip() or None,
                "warehouseCode": str(getattr(warehouse, "code", "") or "").strip() or None,
                "status": status_value,
                "tripId": trip_id,
                "tripNumber": trip_number,
                "sequence": getattr(point, "sequence", None),
            }
        )

    # Also include fulfillment legs from trip assignments (InventoryTransaction)
    # ONLY for orders that don't have TripDropPoint data
    # This prevents duplicates while ensuring all trip assignments are represented
    item_trip_assignments = _build_order_item_trip_assignments_map(normalized_ids)
    for order_id, items_map in item_trip_assignments.items():
        # Skip if this order already has TripDropPoint data
        if order_id in out and len(out[order_id]) > 0:
            continue
        # Collect unique warehouse/trip combinations
        added_keys: set[str] = set()
        for item_id, assignments in items_map.items():
            for assignment in assignments:
                warehouse_id = str(assignment.get("warehouseId") or "").strip()
                trip_id = str(assignment.get("tripId") or "").strip()
                trip_number = str(assignment.get("tripNumber") or "").strip()

                if not warehouse_id:
                    continue

                # Skip duplicates within this order
                key = f"{warehouse_id}::{trip_id}"
                if key in added_keys:
                    continue
                added_keys.add(key)

                # Get warehouse info
                warehouse = warehouse_lookup.get(warehouse_id) or Warehouse.objects.filter(id=warehouse_id).first()

                # Add to fulfillment legs
                out.setdefault(order_id, []).append(
                    {
                        "id": None,
                        "warehouseId": warehouse_id,
                        "warehouseName": str(getattr(warehouse, "name", "") or "").strip() or None,
                        "warehouseCode": str(getattr(warehouse, "code", "") or "").strip() or None,
                        "status": "PENDING",
                        "tripId": trip_id or None,
                        "tripNumber": trip_number or None,
                        "sequence": None,
                        "source": "transaction",
                    }
                )

    return out


def _build_order_warehouse_allocations_map(order_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    normalized_ids = [str(order_id or "").strip() for order_id in order_ids if str(order_id or "").strip()]
    if not normalized_ids:
        return {}

    order_items = list(
        OrderItem.objects.filter(order_id__in=normalized_ids).only("id", "order_id", "item_type", "case_capacity")
    )
    if not order_items:
        return {}
    # Mixed component reservation quantities are bottles; transportation totals are cases.
    mixed_capacities = {str(item.id): max(1, int(item.case_capacity or 1)) for item in order_items if item.item_type == OrderItemType.MIXED_CASE}

    order_by_item_id = {
        str(item.id): str(item.order_id)
        for item in order_items
        if str(item.id or "").strip() and str(item.order_id or "").strip()
    }
    item_ids = list(order_by_item_id.keys())
    if not item_ids:
        return {}

    tx_rows = list(
        InventoryTransaction.objects.filter(
            reference_type="order_item_reserve",
            reference_id__in=item_ids,
            type="RESERVE",
        ).values("reference_id", "warehouse_id", "quantity")
    )
    if not tx_rows:
        return {}

    warehouse_ids = {
        str(row.get("warehouse_id") or "").strip()
        for row in tx_rows
        if str(row.get("warehouse_id") or "").strip()
    }
    warehouse_lookup = {
        warehouse.id: warehouse
        for warehouse in Warehouse.objects.filter(id__in=list(warehouse_ids))
    } if warehouse_ids else {}

    grouped_qty: dict[str, dict[str, int]] = {}
    for row in tx_rows:
        ref_id = str(row.get("reference_id") or "").strip()
        warehouse_id = str(row.get("warehouse_id") or "").strip()
        if not ref_id or not warehouse_id:
            continue
        order_id = order_by_item_id.get(ref_id)
        if not order_id:
            continue
        qty = max(0, _int(row.get("quantity"), 0))
        if ref_id in mixed_capacities:
            # Exact fractions prevent e.g. 24 component units rounding below one case.
            qty = Fraction(qty, mixed_capacities[ref_id])
        grouped_qty.setdefault(order_id, {})
        grouped_qty[order_id][warehouse_id] = grouped_qty[order_id].get(warehouse_id, 0) + qty

    out: dict[str, list[dict[str, Any]]] = {}
    for order_id, by_wh in grouped_qty.items():
        rows: list[dict[str, Any]] = []
        for warehouse_id, qty in sorted(by_wh.items(), key=lambda entry: entry[0]):
            warehouse = warehouse_lookup.get(warehouse_id)
            rows.append(
                {
                    "warehouseId": warehouse_id,
                    "warehouseName": str(getattr(warehouse, "name", "") or "").strip() or None,
                    "warehouseCode": str(getattr(warehouse, "code", "") or "").strip() or None,
                    "allocatedQty": int(qty) if int(qty) == qty else float(qty),
                }
            )
        out[order_id] = rows
    return out


def _build_order_item_warehouse_allocations_map(order_ids: list[str]) -> dict[str, dict[str, list[dict[str, Any]]]]:
    normalized_ids = [str(order_id or "").strip() for order_id in order_ids if str(order_id or "").strip()]
    if not normalized_ids:
        return {}

    order_items = list(
        OrderItem.objects.filter(order_id__in=normalized_ids).only("id", "order_id", "item_type", "case_capacity")
    )
    if not order_items:
        return {}
    mixed_capacities = {str(item.id): max(1, int(item.case_capacity or 1)) for item in order_items if item.item_type == OrderItemType.MIXED_CASE}

    order_by_item_id = {
        str(item.id): str(item.order_id)
        for item in order_items
        if str(item.id or "").strip() and str(item.order_id or "").strip()
    }
    item_ids = list(order_by_item_id.keys())
    if not item_ids:
        return {}

    tx_rows = list(
        InventoryTransaction.objects.filter(
            reference_type="order_item_reserve",
            reference_id__in=item_ids,
            type="RESERVE",
        ).values("reference_id", "warehouse_id", "quantity")
    )
    if not tx_rows:
        return {}

    warehouse_ids = {
        str(row.get("warehouse_id") or "").strip()
        for row in tx_rows
        if str(row.get("warehouse_id") or "").strip()
    }
    warehouse_lookup = {
        warehouse.id: warehouse
        for warehouse in Warehouse.objects.filter(id__in=list(warehouse_ids))
    } if warehouse_ids else {}

    grouped: dict[str, dict[str, dict[str, int]]] = {}
    for row in tx_rows:
        item_id = str(row.get("reference_id") or "").strip()
        warehouse_id = str(row.get("warehouse_id") or "").strip()
        if not item_id or not warehouse_id:
            continue
        order_id = order_by_item_id.get(item_id)
        if not order_id:
            continue
        grouped.setdefault(order_id, {})
        grouped[order_id].setdefault(item_id, {})
        quantity = Fraction(max(0, _int(row.get("quantity"), 0)), mixed_capacities.get(item_id, 1))
        grouped[order_id][item_id][warehouse_id] = grouped[order_id][item_id].get(warehouse_id, 0) + quantity

    out: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for order_id, by_item in grouped.items():
        out[order_id] = {}
        for item_id, by_wh in by_item.items():
            allocs: list[dict[str, Any]] = []
            for warehouse_id, qty in sorted(by_wh.items(), key=lambda entry: entry[0]):
                warehouse = warehouse_lookup.get(warehouse_id)
                allocs.append({
                    "warehouseId": warehouse_id,
                    "warehouseName": str(getattr(warehouse, "name", "") or "").strip() or None,
                    "warehouseCode": str(getattr(warehouse, "code", "") or "").strip() or None,
                    "allocatedQty": int(qty) if int(qty) == qty else float(qty),
                })
            out[order_id][item_id] = allocs
    return out


def _build_order_item_trip_assignments_map(
    order_ids: list[str],
    *,
    trip_id: str | None = None,
) -> dict[str, dict[str, list[dict[str, Any]]]]:
    normalized_ids = [str(order_id or "").strip() for order_id in order_ids if str(order_id or "").strip()]
    if not normalized_ids:
        return {}

    order_items = list(
        OrderItem.objects.filter(order_id__in=normalized_ids).only("id", "order_id", "item_type", "case_capacity")
    )
    if not order_items:
        return {}
    mixed_capacities = {str(item.id): max(1, int(item.case_capacity or 1)) for item in order_items if item.item_type == OrderItemType.MIXED_CASE}

    order_by_item_id = {
        str(item.id): str(item.order_id)
        for item in order_items
        if str(item.id or "").strip() and str(item.order_id or "").strip()
    }
    item_ids = list(order_by_item_id.keys())
    if not item_ids:
        return {}

    tx_qs = InventoryTransaction.objects.filter(
        reference_type="order_item_trip_assign",
        reference_id__in=item_ids,
        type="ASSIGN",
    )
    if trip_id:
        tx_qs = tx_qs.filter(notes__icontains=f'"tripId":"{trip_id}"')
    tx_rows = list(tx_qs.values("reference_id", "warehouse_id", "quantity", "notes"))
    if not tx_rows:
        return {}

    warehouse_ids = {
        str(row.get("warehouse_id") or "").strip()
        for row in tx_rows
        if str(row.get("warehouse_id") or "").strip()
    }
    warehouse_lookup = {
        warehouse.id: warehouse
        for warehouse in Warehouse.objects.filter(id__in=list(warehouse_ids))
    } if warehouse_ids else {}

    grouped: dict[str, dict[str, dict[str, int]]] = {}
    for row in tx_rows:
        item_id = str(row.get("reference_id") or "").strip()
        warehouse_id = str(row.get("warehouse_id") or "").strip()
        if not item_id or not warehouse_id:
            continue
        order_id = order_by_item_id.get(item_id)
        if not order_id:
            continue
        meta_raw = str(row.get("notes") or "").strip()
        meta: dict[str, Any] = {}
        if meta_raw:
            try:
                meta = json.loads(meta_raw)
            except Exception:
                meta = {}
        meta_trip_id = str(meta.get("tripId") or "").strip()
        meta_trip_number = str(meta.get("tripNumber") or "").strip()
        key = f"{warehouse_id}::{meta_trip_id}::{meta_trip_number}"
        grouped.setdefault(order_id, {}).setdefault(item_id, {})
        quantity = Fraction(max(0, _int(row.get("quantity"), 0)), mixed_capacities.get(item_id, 1))
        grouped[order_id][item_id][key] = grouped[order_id][item_id].get(key, 0) + quantity

    out: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for order_id, by_item in grouped.items():
        out[order_id] = {}
        for item_id, by_key in by_item.items():
            rows: list[dict[str, Any]] = []
            for joined_key, qty in sorted(by_key.items(), key=lambda entry: entry[0]):
                warehouse_id, meta_trip_id, meta_trip_number = joined_key.split("::", 2)
                warehouse = warehouse_lookup.get(warehouse_id)
                rows.append(
                    {
                        "warehouseId": warehouse_id,
                        "warehouseName": str(getattr(warehouse, "name", "") or "").strip() or None,
                        "warehouseCode": str(getattr(warehouse, "code", "") or "").strip() or None,
                        "tripId": meta_trip_id or None,
                        "tripNumber": meta_trip_number or None,
                        "allocatedQty": int(qty) if int(qty) == qty else float(qty),
                    }
                )
            out[order_id][item_id] = rows
    return out


def _build_assigned_trip_map(order_ids: list[str], require_driver: bool = True) -> dict[str, Trip]:
    normalized_order_ids = [str(order_id or "").strip() for order_id in order_ids if str(order_id or "").strip()]
    if not normalized_order_ids:
        return {}

    trip_qs = _real_trips(
        Trip.objects.filter(drop_points__order_id__in=normalized_order_ids).select_related("driver", "vehicle")
    ).order_by("-updated_at").prefetch_related(
        Prefetch(
            "drop_points",
            queryset=TripDropPoint.objects.filter(order_id__in=normalized_order_ids).only("id", "trip_id", "order_id"),
        )
    )

    if require_driver:
        trip_qs = trip_qs.filter(driver__isnull=False)

    best_by_order_id: dict[str, Trip] = {}
    best_rank_by_order_id: dict[str, int] = {}
    best_updated_ts_by_order_id: dict[str, float] = {}
    for trip in trip_qs:
        rank = _trip_status_rank(getattr(trip, "status", ""))
        updated_ts = trip.updated_at.timestamp() if getattr(trip, "updated_at", None) else 0.0
        for drop_point in trip.drop_points.all():
            order_id = str(getattr(drop_point, "order_id", "") or "").strip()
            if not order_id:
                continue
            current_rank = best_rank_by_order_id.get(order_id)
            current_updated_ts = best_updated_ts_by_order_id.get(order_id, 0.0)
            if current_rank is None or rank < current_rank or (rank == current_rank and updated_ts > current_updated_ts):
                best_by_order_id[order_id] = trip
                best_rank_by_order_id[order_id] = rank
                best_updated_ts_by_order_id[order_id] = updated_ts

    return best_by_order_id


def _build_order_pod_drop_point_map(order_ids: list[str]) -> dict[str, TripDropPoint]:
    """Return the newest stored POD stop per order in one query."""
    normalized_order_ids = [str(order_id or "").strip() for order_id in order_ids if str(order_id or "").strip()]
    if not normalized_order_ids:
        return {}

    pod_by_order_id: dict[str, TripDropPoint] = {}
    pod_points = (
        TripDropPoint.objects.filter(
            order_id__in=normalized_order_ids,
            status__in=[DropPointStatus.COMPLETED, "DELIVERED"],
        )
        .exclude(Q(delivery_photo__isnull=True) | Q(delivery_photo=""))
        .order_by(F("actual_departure").desc(nulls_last=True), "-updated_at")
    )
    for drop_point in pod_points:
        order_id = str(getattr(drop_point, "order_id", "") or "").strip()
        if order_id and order_id not in pod_by_order_id:
            pod_by_order_id[order_id] = drop_point
    return pod_by_order_id


def _get_scheduled_replacement_payload(order: Order) -> dict[str, Any] | None:
    return None


def _get_scheduled_replacement_payload_bak(order: Order) -> dict[str, Any] | None:
    order_number_upper = str(getattr(order, "order_number", "") or "").strip().upper()
    if not order_number_upper.startswith("RPL-"):
        return None
    replacement = (
        Replacement.objects.filter(
            Q(notes__icontains=f'"replacementOrderId": "{order.id}"')
            | Q(notes__icontains=f'"replacementOrderNumber": "{getattr(order, "order_number", "")}"')
        )
        .order_by("-created_at")
        .first()
    )
    if not replacement:
        return None

    replacement_payload = _serialize_replacement(replacement)
    replacement_lines_raw = replacement_payload.get("replacementLines") or replacement_payload.get("replacementItems") or []
    replacement_lines = [line for line in replacement_lines_raw if isinstance(line, dict)]
    total_qty_to_replace = 0
    total_qty_replaced = 0
    for line in replacement_lines:
        total_qty_to_replace += max(0, _int(line.get("quantityToReplace"), 0))
        total_qty_replaced += max(0, _int(line.get("quantityReplaced"), 0))
    notes_text = f'{str(getattr(replacement, "description", "") or "")} {str(getattr(replacement, "notes", "") or "")}'.lower()
    by_bottle = bool(re.search(r"\bby\s*bottle\b", notes_text))
    first_line = replacement_lines[0] if replacement_lines else {}
    qty_per_unit = max(
        1,
        _int(
            first_line.get("quantityPerCase"),
            _int(
                first_line.get("qtyPerUnit"),
                _int(first_line.get("quantityPerUnit"), 1),
            ),
        ),
    )
    return {
        "replacementId": replacement_payload.get("id"),
        "replacementNumber": replacement_payload.get("replacementNumber"),
        "quantityToReplace": total_qty_to_replace,
        "quantityReplaced": total_qty_replaced,
        "quantityRemaining": max(total_qty_to_replace - total_qty_replaced, 0),
        "unitMode": "BOTTLE" if by_bottle else "UNIT",
        "qtyPerUnit": qty_per_unit,
        "replacementLines": replacement_lines,
        "replacementItems": replacement_lines,
    }
