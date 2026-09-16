"""Customer portal endpoints for orders, replacements and tracking."""

import json
import logging
import math
import re
import threading
from datetime import timedelta
from decimal import Decimal
from typing import Any

from django.db import transaction
from django.db.models import F, Q, Sum
from django.http import HttpRequest, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from . import views_api as legacy
from .api_constants import _NOT_PROVIDED
from .api_utils import (
    error as _err,
    is_whole_number as _is_whole_number,
    json_body as _json_body,
    ok as _ok,
    to_float_or_none as _to_float_or_none,
    to_int as _int,
)
from .models import (
    Customer,
    LocationLog,
    Order,
    OrderDepositRefundRequest,
    OrderStatus,
    OrderTimeline,
    ProductPackaging,
    PurchaseOrderStage,
    PurchaseRequestStatus,
    Replacement,
    ReplacementLine,
    ReplacementStatus,
    Trip,
    TripDropPoint,
    Warehouse,
)

logger = logging.getLogger(__name__)


# Resolved through views_api so tests and runtime overrides that rebind
# these names on views_api keep applying here.


def empties_adjustments_for_orders(order_ids: list[str]) -> dict[str, dict[str, Any]]:
    return legacy.empties_adjustments_for_orders(order_ids)


# Helpers owned by sibling modules. Routing them through views_api keeps
# a single resolution point, so tests that patch there still apply.


def _append_replacement_note_line(notes: Any, line: str) -> str:
    return legacy._append_replacement_note_line(notes, line)


def _build_order_pod_drop_point_map(order_ids: list[str]) -> dict[str, TripDropPoint]:
    return legacy._build_order_pod_drop_point_map(order_ids)


def _create_customer_notification(*, customer: Customer | None, title: str, message: str, notification_type: str='REPLACEMENT', reference_type: str | None=None, reference_id: str | None=None) -> None:
    return legacy._create_customer_notification(customer=customer, title=title, message=message, notification_type=notification_type, reference_type=reference_type, reference_id=reference_id)


def _create_deposit_refund_claims(*, order: Order, customer: Customer, raw_refund_lines: Any, maximum_order_credit: Decimal, client_amount: Any=None) -> Decimal:
    return legacy._create_deposit_refund_claims(order=order, customer=customer, raw_refund_lines=raw_refund_lines, maximum_order_credit=maximum_order_credit, client_amount=client_amount)


def _create_staff_notifications(*, title: str, message: str, notification_type: str='INVENTORY', reference_type: str | None=None, reference_id: str | None=None) -> None:
    return legacy._create_staff_notifications(title=title, message=message, notification_type=notification_type, reference_type=reference_type, reference_id=reference_id)


def _customer_payload(customer: Customer) -> dict[str, Any]:
    return legacy._customer_payload(customer)


def _email_order_cancelled_to_customer(order: Order, cancellation_reason: str, *, cancelled_by_customer: bool=False) -> None:
    return legacy._email_order_cancelled_to_customer(order, cancellation_reason, cancelled_by_customer=cancelled_by_customer)


def _email_replacement_submitted_to_customer(replacement: Replacement) -> None:
    return legacy._email_replacement_submitted_to_customer(replacement)


def _email_replacement_submitted_to_staff(replacement: Replacement) -> None:
    return legacy._email_replacement_submitted_to_staff(replacement)


def _extract_replacement_meta(notes: Any) -> dict[str, Any]:
    return legacy._extract_replacement_meta(notes)


def _get_allowed_warehouse_ids_for_staff(user_id: str) -> set[str]:
    return legacy._get_allowed_warehouse_ids_for_staff(user_id)


def _get_product_size_label(product: Any) -> str:
    return legacy._get_product_size_label(product)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    return legacy._haversine_km(lat1, lon1, lat2, lon2)


def _is_linked_replacement_order_delivered(entry: Replacement, *, order_cache: dict[str, Any] | None=None) -> bool:
    return legacy._is_linked_replacement_order_delivered(entry, order_cache=order_cache)


def _normalize_order_status(value: Any) -> str:
    return legacy._normalize_order_status(value)


def _normalize_product_unit(raw: Any) -> str:
    return legacy._normalize_product_unit(raw)


def _normalize_replacement_status(value: Any, replacement_mode: Any=None) -> str:
    return legacy._normalize_replacement_status(value, replacement_mode)


def _pagination(request: HttpRequest) -> tuple[int, int, int]:
    return legacy._pagination(request)


def _real_orders(qs):
    return legacy._real_orders(qs)


def _release_order_reservations(order: Order, performed_by: str | None) -> None:
    return legacy._release_order_reservations(order, performed_by)


def _require_auth(request: HttpRequest) -> dict[str, Any] | None:
    return legacy._require_auth(request)


def _resolve_primary_admin_phone() -> str:
    return legacy._resolve_primary_admin_phone()


def _serialize_order(order: Order, include_items: bool=True, include_progress: bool=False, *, warehouse_lookup: dict[str, Warehouse] | None=None, assigned_trip: Trip | None=None, fulfillment_legs: list[dict[str, Any]] | None=None, warehouse_allocations: list[dict[str, Any]] | None=None, item_warehouse_allocations: dict[str, list[dict[str, Any]]] | None=None, item_trip_assignments: dict[str, list[dict[str, Any]]] | None=None, empties_adjustment: Any=_NOT_PROVIDED, packaging_cache: dict[str, ProductPackaging] | None=None, delivery_transactions: dict[str, list[str]] | None=None, pod_drop_point: TripDropPoint | None=None, primary_admin_phone: Any=_NOT_PROVIDED) -> dict[str, Any]:
    return legacy._serialize_order(order, include_items, include_progress, warehouse_lookup=warehouse_lookup, assigned_trip=assigned_trip, fulfillment_legs=fulfillment_legs, warehouse_allocations=warehouse_allocations, item_warehouse_allocations=item_warehouse_allocations, item_trip_assignments=item_trip_assignments, empties_adjustment=empties_adjustment, packaging_cache=packaging_cache, delivery_transactions=delivery_transactions, pod_drop_point=pod_drop_point, primary_admin_phone=primary_admin_phone)


def _serialize_replacement(entry: Replacement, *, warehouse_cache: dict[str, Any] | None=None, order_cache: dict[str, Any] | None=None) -> dict[str, Any]:
    return legacy._serialize_replacement(entry, warehouse_cache=warehouse_cache, order_cache=order_cache)


def _serialize_trip(trip: Trip, include_points: bool=True, *, ctx: dict=None) -> dict[str, Any]:
    return legacy._serialize_trip(trip, include_points, ctx=ctx)


def _upsert_replacement_meta(notes: Any, updates: dict[str, Any]) -> str:
    return legacy._upsert_replacement_meta(notes, updates)


def orders_collection(request: HttpRequest) -> JsonResponse:
    return legacy.orders_collection(request)


@csrf_exempt
@require_http_methods(["GET", "POST"])
def customer_orders(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p or p.get("type") != "customer":
        return _err("Unauthorized", 401)
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = _real_orders(
            Order.objects.select_related("customer", "timeline")
            .prefetch_related("items__product")
            .filter(customer_id=p.get("userId"))
        ).order_by("-created_at")
        total = qs.count()
        rows = list(qs[off : off + size])
        order_ids = [str(row.id) for row in rows]
        adjustments = empties_adjustments_for_orders([str(row.id) for row in rows])
        # Backfill legacy POD fields from trip stops without one query per order.
        pod_drop_points = _build_order_pod_drop_point_map(order_ids)
        primary_admin_phone = _resolve_primary_admin_phone()
        customer_product_ids = {
            str(item.product_id)
            for row in rows
            for item in (getattr(row, "_serialized_order_items", None) or row.items.all())
            if getattr(item, "product_id", None)
        }
        customer_packaging_cache = {
            str(packaging.product_id): packaging
            for packaging in ProductPackaging.objects.filter(
                product_id__in=customer_product_ids, is_active=True
            )
        } if customer_product_ids else {}
        return _ok({
            "success": True,
            "orders": [
                _serialize_order(
                    row,
                    empties_adjustment=adjustments.get(str(row.id)),
                    packaging_cache=customer_packaging_cache,
                    pod_drop_point=pod_drop_points.get(str(row.id)),
                    primary_admin_phone=primary_admin_phone,
                )
                for row in rows
            ],
            "total": total,
            "page": page,
            "pageSize": size,
            "totalPages": (total + size - 1) // size,
        })
    body = _json_body(request)
    body["customerId"] = p.get("userId")
    request._body = json.dumps(body).encode("utf-8")
    return orders_collection(request)


@csrf_exempt
@require_http_methods(["POST"])
def customer_order_deposit_refund(request: HttpRequest, order_id: str) -> JsonResponse:
    """Apply product-specific empty credit to an undelivered purchase order."""
    p = _require_auth(request)
    if not p or p.get("type") != "customer":
        return _err("Unauthorized", 401)
    # Fix: parse the request before entering the existing locked refund workflow.
    body = _json_body(request)
    request_id = str(body.get("requestId") or "").strip()
    if len(request_id) > 120:
        return _err("requestId must be 120 characters or fewer", 400)

    try:
        with transaction.atomic():
            order = (
                Order.objects.select_for_update()
                # Fix: PostgreSQL cannot lock the nullable side of the timeline
                # outer join; only the required customer relation is needed here.
                .select_related("customer")
                .get(id=order_id, customer_id=p.get("userId"))
            )
            previous_request = (
                OrderDepositRefundRequest.objects.select_for_update().filter(request_id=request_id).first()
                if request_id
                else None
            )
            if previous_request is not None:
                if previous_request.order_id != order.id:
                    return _err("Request ID was already used for another deposit refund", 409)
                # A lost response may cause the shared client to replay this POST.
                # Return the committed result without reserving or crediting it again.
                applied_credit = previous_request.applied_amount
            else:
                # Deposit refunds belong to an approved PO, never to its pending PR.
                if not str(order.purchase_order_number or "").strip():
                    return _err("Deposit refunds can only be applied to a purchase order", 400)
                if order.status in {OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.REJECTED}:
                    return _err("Deposit refunds cannot be added to this order", 400)
                if order.request_status in {PurchaseRequestStatus.REJECTED, PurchaseRequestStatus.CANCELLED}:
                    return _err("Deposit refunds cannot be added to this order", 400)
                if order.bottle_returns.exists():
                    return _err("The empty-container collection for this order is already complete", 400)

                # Delivery state controls eligibility; payment state does not.
                maximum_credit = max(Decimal("0.00"), Decimal(str(order.total_amount or 0)))
                applied_credit = _create_deposit_refund_claims(
                    order=order,
                    customer=order.customer,
                    raw_refund_lines=body.get("depositRefundLines"),
                    maximum_order_credit=maximum_credit,
                    client_amount=body.get("depositCreditAmount"),
                )
                if applied_credit <= 0:
                    return _err("Select at least one empty container to refund", 400)
                order.total_amount = max(0.0, float(Decimal(str(order.total_amount or 0)) - applied_credit))
                order.save(update_fields=["total_amount", "updated_at"])
                if request_id:
                    OrderDepositRefundRequest.objects.create(
                        request_id=request_id,
                        order=order,
                        applied_amount=applied_credit,
                    )
    except Order.DoesNotExist:
        return _err("Order not found", 404)
    except ValueError as error:
        return _err(str(error), 400)

    refreshed_order = (
        Order.objects.select_related("customer", "timeline")
        .prefetch_related("items__product", "deposit_refund_claims__product", "deposit_refund_claims__container_type")
        .get(id=order.id)
    )
    return _ok({
        "success": True,
        "order": _serialize_order(refreshed_order),
        "user": _customer_payload(refreshed_order.customer),
        "appliedAmount": float(applied_credit),
    })


@csrf_exempt
@require_http_methods(["PATCH"])
def customer_order_cancel(request: HttpRequest, order_id: str) -> JsonResponse:
    p = _require_auth(request)
    if not p or p.get("type") != "customer":
        return _err("Unauthorized", 401)
    body = _json_body(request)
    cancellation_reason = str(body.get("reason") or "").strip()
    try:
        o = Order.objects.get(id=order_id, customer_id=p.get("userId"))
    except Order.DoesNotExist:
        return _err("Order not found", 404)
    if o.status == OrderStatus.CANCELLED:
        return _ok({"success": True, "order": _serialize_order(o, include_items=False)})
    if o.status in {OrderStatus.PREPARING, OrderStatus.DELIVERED, OrderStatus.REJECTED}:
        return _err("Order cannot be cancelled", 400)
    # Required: reject valid cancellation attempts that omit the reason.
    if not cancellation_reason:
        return _err("A cancellation reason is required", 400)

    with transaction.atomic():
        # Serialize customer retries with staff approval and delivery operations.
        o = Order.objects.select_for_update().get(id=order_id, customer_id=p.get("userId"))
        if o.status == OrderStatus.CANCELLED:
            return _ok({"success": True, "order": _serialize_order(o, include_items=False)})
        if o.status in {OrderStatus.PREPARING, OrderStatus.DELIVERED, OrderStatus.REJECTED}:
            return _err("Order cannot be cancelled", 409)
        _release_order_reservations(o, p.get("userId"))
        now = timezone.now()
        actor_name = str((o.customer.name if getattr(o, "customer", None) else None) or "Customer").strip() or "Customer"
        o.status = OrderStatus.CANCELLED
        # Cancelling fulfillment does not undo the PR approval or its PO identity.
        if not o.purchase_order_number and o.request_status != PurchaseRequestStatus.APPROVED:
            o.request_status = PurchaseRequestStatus.CANCELLED
        o.purchase_order_stage = PurchaseOrderStage.CANCELLED
        o.cancelled_by_user_id = str(p.get("userId") or "").strip() or None
        o.cancelled_by_name = actor_name
        o.cancellation_reason = cancellation_reason
        o.cancelled_at = now
        o.save(update_fields=[
            "status",
            "request_status",
            "purchase_order_stage",
            "cancelled_by_user_id",
            "cancelled_by_name",
            "cancellation_reason",
            "cancelled_at",
            "updated_at",
        ])
        timeline, _ = OrderTimeline.objects.get_or_create(order=o)
        timeline.cancelled_at = now
        timeline.save()

    try:
        cancelled_order = (
            Order.objects.select_related("customer", "timeline")
            .prefetch_related("items__product")
            .get(id=o.id)
        )
        _email_order_cancelled_to_customer(cancelled_order, cancellation_reason, cancelled_by_customer=True)
    except Exception:
        logger.exception("Failed to email the cancellation for order %s", o.id)

    return _ok({"success": True, "order": _serialize_order(o, include_items=False)})


@require_GET
def replacements_collection(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    page, size, off = _pagination(request)
    qs = Replacement.objects.select_related("order", "order__customer")

    if p.get("type") == "customer":
        qs = qs.filter(order__in=_real_orders(Order.objects.all()))
        qs = qs.filter(customer_id=p.get("userId"))
    elif p.get("type") == "staff":
        staff_role = str(p.get("role") or "").strip().upper()
        staff_user_id = str(p.get("userId") or "").strip()
        allowed_warehouse_ids: set[str] | None = None
        if staff_role == "WAREHOUSE_STAFF" and staff_user_id:
            allowed_warehouse_ids = set(
                _get_allowed_warehouse_ids_for_staff(staff_user_id)
            )
            if not allowed_warehouse_ids:
                return _ok({"success": True, "replacements": [], "total": 0, "page": page, "pageSize": size, "totalPages": 0})
            qs = qs.filter(order__warehouse_id__in=list(allowed_warehouse_ids))
    else:
        return _err("Forbidden", 403)

    qs = qs.filter(replacement_mode="CUSTOMER_SUBMITTED")

    warehouse_id = str(request.GET.get("warehouseId") or "").strip()
    if warehouse_id:
        if p.get("type") == "staff":
            staff_role = str(p.get("role") or "").strip().upper()
            if staff_role == "WAREHOUSE_STAFF":
                allowed_warehouse_ids = set(
                    _get_allowed_warehouse_ids_for_staff(str(p.get("userId") or "").strip())
                )
                if warehouse_id not in allowed_warehouse_ids:
                    return _err("Forbidden", 403)
        qs = qs.filter(order__warehouse_id=warehouse_id)

    order_id = str(request.GET.get("orderId") or "").strip()
    if order_id:
        qs = qs.filter(order_id=order_id)

    status = str(request.GET.get("status") or "").strip().upper()
    if status:
        qs = qs.filter(status=status)

    q = str(request.GET.get("search") or "").strip()
    if q:
        qs = qs.filter(
            Q(replacement_number__icontains=q)
            | Q(order__order_number__icontains=q)
            | Q(order__customer__name__icontains=q)
            | Q(reason__icontains=q)
        )

    qs = qs.order_by("-created_at")
    total = qs.count()
    rows = list(qs[off : off + size])
    return _ok(
        {
            "success": True,
            "replacements": [_serialize_replacement(x) for x in rows],
            "total": total,
            "page": page,
            "pageSize": size,
            "totalPages": (total + size - 1) // size,
        }
    )


@csrf_exempt
@require_http_methods(["GET", "POST"])
def customer_replacements(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p or p.get("type") != "customer":
        return _err("Unauthorized", 401)
    if request.method == "GET":
        return replacements_collection(request)

    body = _json_body(request)
    order_id = str(body.get("orderId") or "").strip()
    if not order_id:
        return _err("orderId is required", 400)
    order = (
        Order.objects.select_related("customer", "timeline")
        .prefetch_related("items__product")
        .filter(id=order_id, customer_id=p.get("userId"))
        .first()
    )
    if not order:
        return _err("Order not found", 404)

    normalized_order_status = _normalize_order_status(getattr(order, "status", None))
    if normalized_order_status != OrderStatus.DELIVERED:
        return _err("Replacement request is only allowed for delivered orders", 400)

    existing_customer_replacements = (
        Replacement.objects.filter(order_id=order.id, customer_id=order.customer_id, replacement_mode="CUSTOMER_SUBMITTED")
        .only("id", "status", "replacement_mode", "notes")
        .order_by("-created_at")
    )
    active_customer_replacement = None
    for existing in existing_customer_replacements:
        normalized_existing_status = _normalize_replacement_status(existing.status, existing.replacement_mode)
        if normalized_existing_status == ReplacementStatus.CANCELLED:
            # A customer-cancelled pending request does not block a new request.
            continue
        if normalized_existing_status in {
            ReplacementStatus.REJECTED,
            ReplacementStatus.COMPLETED,
            ReplacementStatus.RESOLVED_ON_DELIVERY,
        }:
            return _err(
                "You cannot request another replacement for this order after a rejected or completed replacement case",
                400,
            )
        if _is_linked_replacement_order_delivered(existing):
            return _err(
                "You cannot request another replacement for this order after a rejected or completed replacement case",
                400,
            )
        if active_customer_replacement is None:
            active_customer_replacement = existing
    if active_customer_replacement is not None:
        # A bare retry cannot alter the saved claim, so return it safely. Any
        # payload with a new claim remains blocked without an idempotency key.
        replacement_claim_fields = {
            "replacementLines",
            "numberDamagedItems",
            "damageType",
            "reason",
            "evidence",
            "evidencePrimary",
            "damagePhoto",
        }
        if not any(field in body for field in replacement_claim_fields):
            return _ok({
                "success": True,
                "replacement": _serialize_replacement(active_customer_replacement),
                "reused": True,
            })
        return _err("An active replacement request already exists for this order", 400)

    # Fix: calculate the deadline only from an actual delivery event. Order update
    # and creation timestamps are unrelated and caused valid production requests
    # to be rejected when legacy timeline data was incomplete.
    delivered_at = (
        getattr(getattr(order, "timeline", None), "delivered_at", None)
        or getattr(order, "pod_submitted_at", None)
    )
    if delivered_at is None:
        delivered_at = (
            TripDropPoint.objects.filter(
                order_id=order.id,
                status__in=["COMPLETED", "DELIVERED"],
                actual_departure__isnull=False,
            )
            .order_by("-actual_departure")
            .values_list("actual_departure", flat=True)
            .first()
        )
    if delivered_at is not None and timezone.now() > (delivered_at + timedelta(days=3)):
        return _err("Replacement request is only allowed within 3 days after delivery", 400)

    order_items = list(order.items.select_related("product").all())
    order_items_by_id = {
        str(getattr(item, "id", "") or "").strip(): item
        for item in order_items
        if str(getattr(item, "id", "") or "").strip()
    }

    replacement_lines_input = body.get("replacementLines") if isinstance(body.get("replacementLines"), list) else []
    replacement_lines: list[dict[str, Any]] = []
    if replacement_lines_input:
        merged_lines_by_source: dict[str, dict[str, Any]] = {}
        for raw_line in replacement_lines_input:
            if not isinstance(raw_line, dict):
                continue
            # Fix: reject decimal claims before _int can truncate them into a
            # smaller, seemingly valid replacement request.
            for quantity_field in (
                "quantityToReplace",
                "quantityToReplaceCases",
                "quantityToReplaceUnits",
                "quantityToReplaceBottles",
            ):
                if quantity_field in raw_line and not _is_whole_number(raw_line.get(quantity_field)):
                    return _err("Replacement quantities must be whole numbers", 400)
            original_order_item_id = str(
                raw_line.get("originalOrderItemId")
                or raw_line.get("productId")
                or raw_line.get("orderItemId")
                or ""
            ).strip()
            source_item = order_items_by_id.get(original_order_item_id)
            if not source_item:
                return _err("Each replacement line must reference a valid product from the order", 400)

            mixed_component_id = str(raw_line.get("mixedCaseComponentId") or "").strip()
            mixed_component = None
            if mixed_component_id:
                mixed_component = source_item.mixed_case_components.select_related("product").filter(id=mixed_component_id).first()
                if mixed_component is None:
                    return _err("Each mixed-case replacement line must reference a component from its order item", 400)
            product = mixed_component.product if mixed_component is not None else getattr(source_item, "product", None)
            # Server-side product/component capacity is authoritative. Never allow
            # replacement claims to inflate it with a client-supplied pack size.
            quantity_per_case = max(
                1,
                _int(
                    getattr(mixed_component, "quantity_per_case", 0) if mixed_component is not None else getattr(product, "quantity_per_unit", 0),
                    1,
                ),
            )
            submitted_input_mode = str(raw_line.get("inputMode") or raw_line.get("lineInputMode") or "").strip().lower()
            recorded_source_unit = str(getattr(source_item, "product_unit", "") or "").strip()
            source_product_unit = _normalize_product_unit(
                recorded_source_unit or getattr(product, "unit", None)
            )
            # Fix: replacements retain the unit used by the delivered order line.
            # Legacy orders have no saved unit, so keep their explicit submitted
            # mode rather than reinterpret historical quantities.
            if mixed_component is not None:
                input_mode = "bottle"
            elif submitted_input_mode in {"case", "bottle"}:
                input_mode = submitted_input_mode
            elif recorded_source_unit:
                input_mode = "bottle" if "bottle" in recorded_source_unit.lower() else "case"
            else:
                input_mode = "case"
            quantity_to_replace = max(0, _int(raw_line.get("quantityToReplace"), 0))
            quantity_to_replace_cases = max(
                0,
                _int(
                    raw_line.get("quantityToReplaceCases"),
                    _int(raw_line.get("quantityToReplaceUnits"), 0),
                ),
            )
            quantity_to_replace_bottles = max(0, _int(raw_line.get("quantityToReplaceBottles"), 0))

            if input_mode == "case":
                if submitted_input_mode == "bottle" and quantity_to_replace_cases <= 0:
                    quantity_to_replace_cases = quantity_to_replace_bottles or quantity_to_replace
                elif not submitted_input_mode and quantity_to_replace_cases <= 0:
                    # Legacy requests without a mode carry base units. Reject a partial
                    # case rather than silently rounding it down to one whole case.
                    legacy_base_quantity = quantity_to_replace_bottles or quantity_to_replace
                    if legacy_base_quantity % quantity_per_case:
                        return _err("Case replacement quantities must be whole cases", 400)
                    quantity_to_replace_cases = legacy_base_quantity // quantity_per_case
                if quantity_to_replace_cases <= 0 and quantity_to_replace > 0 and quantity_per_case > 0:
                    quantity_to_replace_cases = max(1, quantity_to_replace // quantity_per_case)
                quantity_to_replace = quantity_to_replace_cases * quantity_per_case
                quantity_to_replace_bottles = 0
            else:
                if submitted_input_mode == "case" and quantity_to_replace_bottles <= 0:
                    quantity_to_replace_bottles = quantity_to_replace_cases or quantity_to_replace
                if quantity_to_replace_bottles <= 0 and quantity_to_replace > 0:
                    quantity_to_replace_bottles = quantity_to_replace
                quantity_to_replace = quantity_to_replace_bottles
                quantity_to_replace_cases = 0

            if quantity_to_replace <= 0:
                return _err("Each replacement line must have quantity greater than zero", 400)

            reason = str(raw_line.get("reason") or body.get("damageType") or body.get("reason") or "").strip()
            if not reason:
                return _err("Each replacement line must include a reason", 400)
            description = str(raw_line.get("description") or "").strip()
            original_product_name = str(
                getattr(product, "name", "")
                or getattr(source_item, "product_name", "")
                or raw_line.get("originalProductName")
                or ""
            ).strip() or "Product"
            original_product_sku = str(
                getattr(product, "sku", "")
                or getattr(source_item, "product_sku", "")
                or raw_line.get("originalProductSku")
                or ""
            ).strip() or None
            original_product_size = _get_product_size_label(product) or str(raw_line.get("originalProductSize") or "").strip() or None
            replacement_product_id = str(
                raw_line.get("replacementProductId")
                or getattr(source_item, "product_id", "")
                or ""
            ).strip() or None

            next_line = {
                "originalOrderItemId": source_item.id,
                "mixedCaseComponentId": mixed_component.id if mixed_component is not None else None,
                "originalProductId": str(getattr(source_item, "product_id", "") or "").strip() or None,
                "originalProductName": original_product_name,
                "originalProductSku": original_product_sku,
                "originalProductSize": original_product_size,
                "originalProductUnit": str(source_product_unit or "").strip() or None,
                "replacementProductId": replacement_product_id,
                "replacementProductName": original_product_name,
                "replacementProductSku": original_product_sku,
                "replacementProductSize": original_product_size,
                "replacementProductUnit": str(source_product_unit or "").strip() or None,
                "lineInputMode": input_mode,
                "replacementInputMode": input_mode,
                "quantityPerCase": quantity_per_case,
                "qtyPerUnit": quantity_per_case,
                "quantityToReplace": quantity_to_replace,
                "quantityReplaced": 0,
                "remainingQuantity": quantity_to_replace,
                "reason": reason,
                "description": description or None,
            }
            if input_mode == "case":
                next_line["quantityToReplaceCases"] = quantity_to_replace_cases
                next_line["quantityToReplaceUnits"] = quantity_to_replace_cases
            else:
                next_line["quantityToReplaceBottles"] = quantity_to_replace_bottles

            source_key = f"{source_item.id}:{mixed_component.id if mixed_component is not None else getattr(product, 'id', '')}"
            existing_line = merged_lines_by_source.get(source_key)
            if existing_line:
                existing_line["quantityToReplace"] = max(0, _int(existing_line.get("quantityToReplace"), 0)) + quantity_to_replace
                existing_line["remainingQuantity"] = existing_line["quantityToReplace"]
                if input_mode == "case":
                    existing_line["quantityToReplaceCases"] = max(0, _int(existing_line.get("quantityToReplaceCases"), 0)) + quantity_to_replace_cases
                    existing_line["quantityToReplaceUnits"] = existing_line["quantityToReplaceCases"]
                else:
                    existing_line["quantityToReplaceBottles"] = max(0, _int(existing_line.get("quantityToReplaceBottles"), 0)) + quantity_to_replace_bottles
                if reason and reason not in str(existing_line.get("reason") or ""):
                    existing_line["reason"] = f"{existing_line['reason']}; {reason}"
                if description:
                    previous_description = str(existing_line.get("description") or "").strip()
                    if description not in previous_description:
                        existing_line["description"] = f"{previous_description}; {description}".strip("; ")
            else:
                merged_lines_by_source[source_key] = next_line

        replacement_lines = list(merged_lines_by_source.values())
        if not replacement_lines:
            return _err("At least one valid replacement line is required", 400)

        for line in replacement_lines:
            source_item = order_items_by_id[str(line["originalOrderItemId"])]
            component_id = str(line.get("mixedCaseComponentId") or "").strip()
            component = source_item.mixed_case_components.select_related("product").filter(id=component_id).first() if component_id else None
            product = component.product if component is not None else source_item.product
            if product is None:
                return _err("Each replacement line must reference an available product", 400)
            recorded_source_unit = str(getattr(source_item, "product_unit", "") or "").strip()
            source_product_unit = _normalize_product_unit(
                recorded_source_unit or getattr(product, "unit", None)
            )
            source_capacity = (
                max(0, _int(component.total_base_units, 0))
                if component is not None
                else max(0, _int(source_item.quantity, 0)) * (
                    1 if recorded_source_unit and "bottle" in recorded_source_unit.lower() else max(1, _int(product.quantity_per_unit, 0))
                )
            )
            requested_units = max(0, _int(line.get("quantityToReplace"), 0))
            active_claims = ReplacementLine.objects.filter(
                original_order_item=source_item,
                mixed_case_component=component,
                product=product,
                replacement__replacement_mode="CUSTOMER_SUBMITTED",
            ).exclude(
                replacement__status__in=[
                    ReplacementStatus.CANCELLED,
                    ReplacementStatus.REJECTED,
                    ReplacementStatus.COMPLETED,
                    ReplacementStatus.RESOLVED_ON_DELIVERY,
                ]
            ).aggregate(total=Sum("requested_base_units")).get("total") or 0
            if requested_units + max(0, _int(active_claims, 0)) > source_capacity:
                return _err("Replacement quantity exceeds the remaining delivered source allocation", 400)

    if "numberDamagedItems" in body and not _is_whole_number(body.get("numberDamagedItems")):
        return _err("numberDamagedItems must be a whole number", 400)
    number_damaged_items = max(
        0,
        _int(
            body.get("numberDamagedItems"),
            sum(max(0, _int(line.get("quantityToReplace"), 0)) for line in replacement_lines),
        ),
    )
    if number_damaged_items <= 0:
        return _err("numberDamagedItems must be greater than zero", 400)
    damage_type = str(body.get("damageType") or body.get("reason") or "").strip()
    if not damage_type and replacement_lines:
        unique_reasons = [str(line.get("reason") or "").strip() for line in replacement_lines if str(line.get("reason") or "").strip()]
        unique_reasons = list(dict.fromkeys(unique_reasons))
        if len(unique_reasons) == 1:
            damage_type = unique_reasons[0]
        elif len(unique_reasons) > 1:
            damage_type = "Multiple issues"
    if not damage_type:
        return _err("reason/type of damage is required", 400)
    evidence_list_raw = body.get("evidence") if isinstance(body.get("evidence"), list) else []
    evidence_list = [str(item).strip() for item in evidence_list_raw if str(item).strip()]
    primary_evidence = str(body.get("evidencePrimary") or body.get("damagePhoto") or "").strip()
    if primary_evidence and primary_evidence not in evidence_list:
        evidence_list.insert(0, primary_evidence)
    if not evidence_list:
        return _err("At least one evidence file is required", 400)
    customer_notes = str(body.get("notes") or "").strip()[:500]

    if Replacement.objects.filter(order=order, status__in=[ReplacementStatus.COMPLETED, ReplacementStatus.RESOLVED_ON_DELIVERY]).exists():
        return _err("A replacement request is already completed for this order", 400)

    count = Replacement.objects.count() + 1
    now = timezone.now()
    if replacement_lines:
        product_summaries = []
        for line in replacement_lines:
            product_name = str(line.get("originalProductName") or "Product").strip()
            quantity_text = str(line.get("quantityToReplace") or "0").strip()
            reason_text = str(line.get("reason") or damage_type).strip()
            line_detail = str(line.get("description") or "").strip()
            summary = f"[{product_name}] qty {quantity_text}. Reason: {reason_text}"
            if line_detail:
                summary = f"{summary}. {line_detail}"
            product_summaries.append(summary)
        description_text = str(body.get("description") or "").strip() or "; ".join(product_summaries)
    else:
        description_text = str(body.get("description") or "Customer replacement request").strip() or "Customer replacement request"

    meta = {
        "submittedBy": "CUSTOMER",
        "submittedAt": now.isoformat(),
        "numberDamagedItems": number_damaged_items,
        "damageType": damage_type,
        "evidence": evidence_list,
        "damagePhotos": evidence_list,
        "customerNotes": customer_notes,
        "quantityToReplace": number_damaged_items,
        "quantityReplaced": 0,
        "statusTimeline": [
            {"status": ReplacementStatus.PENDING, "at": now.isoformat(), "by": str(order.customer_id)},
        ],
    }
    if replacement_lines:
        meta["replacementLines"] = replacement_lines
        meta["replacementItems"] = replacement_lines
    replacement = Replacement.objects.create(
        replacement_number=f"RPL-{timezone.now().year}-{str(count).zfill(4)}",
        order=order,
        customer_id=order.customer_id,
        reason=damage_type,
        description=description_text,
        status=ReplacementStatus.PENDING,
        requested_by="CUSTOMER",
        replacement_mode="CUSTOMER_SUBMITTED",
        replacement_quantity=number_damaged_items,
        original_order_item_id=str(replacement_lines[0].get("originalOrderItemId") or "").strip() or None if replacement_lines else None,
        replacement_product_id=str(replacement_lines[0].get("replacementProductId") or "").strip() or None if replacement_lines else None,
        damage_photo_url=evidence_list[0],
        damage_photo_urls=json.dumps(evidence_list),
        notes=f"Customer-submitted replacement request\nMeta: {json.dumps(meta)}",
    )
    for line in replacement_lines:
        source_item = order_items_by_id[str(line["originalOrderItemId"])]
        component_id = str(line.get("mixedCaseComponentId") or "").strip()
        component = source_item.mixed_case_components.select_related("product").filter(id=component_id).first() if component_id else None
        product = component.product if component is not None else source_item.product
        if product is None:  # Guarded above; keep the write safe if the row was removed concurrently.
            raise ValueError("Replacement product is no longer available")
        ReplacementLine.objects.create(
            replacement=replacement,
            product=product,
            product_name=str(line.get("replacementProductName") or product.name),
            product_sku=str(line.get("replacementProductSku") or product.sku or "") or None,
            base_unit_label=str(line.get("lineInputMode") or "unit"),
            requested_base_units=max(0, _int(line.get("quantityToReplace"), 0)),
            reason=str(line.get("reason") or damage_type),
            description=line.get("description"),
            original_order_item=source_item,
            mixed_case_component=component,
        )
    customer_name = str(getattr(order.customer, "name", "") or "Customer").strip()
    if replacement_lines:
        product_names = list(
            dict.fromkeys(
                str(line.get("originalProductName") or "").strip()
                for line in replacement_lines
                if str(line.get("originalProductName") or "").strip()
            )
        )
        product_hint = ", ".join(product_names[:3]) if product_names else "N/A"
        if len(product_names) > 3:
            product_hint = f"{product_hint} +{len(product_names) - 3} more"
    else:
        product_name_match = re.search(r"\[([^\]]+)\]", str(replacement.description or ""))
        product_hint = str(product_name_match.group(1) if product_name_match else "").strip() or "N/A"
    description_hint = str(replacement.description or "").strip() or "N/A"
    # Fix: the request is already saved; notification failures must not invite duplicate submissions.
    try:
        _create_staff_notifications(
            title="New replacement request",
            message=(
                f"{customer_name} submitted replacement request {replacement.replacement_number} for order {order.order_number}. "
                f"Product: {product_hint}. Reason: {damage_type}. Details: {description_hint}."
            ),
            notification_type="REPLACEMENT",
            reference_type="replacement",
            reference_id=replacement.id,
        )
        _create_customer_notification(
            customer=order.customer,
            title="Replacement request submitted",
            message=(
                f"Replacement request {replacement.replacement_number} was submitted. "
                f"Product: {product_hint}. Reason: {damage_type}. "
                "You will be notified once admin reviews and approves/rejects it."
            ),
            notification_type="REPLACEMENT",
            reference_type="replacement",
            reference_id=replacement.id,
        )
    except Exception:
        logger.exception("Failed to create replacement submission notifications for %s", replacement.id)
    # Fix: email provider retries are best-effort and must not turn a saved request
    # into a client-side submission failure while the API waits on network I/O.
    def _send_replacement_submission_emails(replacement_id: str) -> None:
        try:
            entry = (
                Replacement.objects.select_related("order__customer")
                .prefetch_related("lines__product")
                .filter(id=replacement_id)
                .first()
            )
            if entry is None:
                return
            _email_replacement_submitted_to_staff(entry)
            _email_replacement_submitted_to_customer(entry)
        except Exception:
            logger.exception("Failed to email the submitted replacement %s", replacement_id)

    def _schedule_replacement_submission_emails() -> None:
        try:
            threading.Thread(
                target=_send_replacement_submission_emails,
                args=(replacement.id,),
                name=f"replacement-email-{replacement.id}",
                daemon=True,
            ).start()
        except Exception:
            logger.exception("Failed to schedule replacement notification email for %s", replacement.id)

    try:
        # The worker opens its own connection, so start it only after the
        # replacement commit. This also prevents SQLite test-table locks.
        transaction.on_commit(_schedule_replacement_submission_emails)
    except Exception:
        logger.exception("Failed to register replacement notification email for %s", replacement.id)
    return _ok({"success": True, "replacement": _serialize_replacement(replacement)}, 201)


@csrf_exempt
@require_http_methods(["POST"])
def customer_replacement_cancel(request: HttpRequest, replacement_id: str) -> JsonResponse:
    p = _require_auth(request)
    if not p or p.get("type") != "customer":
        return _err("Unauthorized", 401)

    with transaction.atomic():
        replacement = (
            Replacement.objects.select_for_update()
            .filter(
                id=replacement_id,
                customer_id=p.get("userId"),
                replacement_mode="CUSTOMER_SUBMITTED",
            )
            .first()
        )
        if not replacement:
            return _err("Replacement request not found", 404)

        current_status = _normalize_replacement_status(replacement.status, replacement.replacement_mode)
        if current_status == ReplacementStatus.CANCELLED:
            # A repeated cancel request is safe and returns the existing state.
            return _ok({
                "success": True,
                "replacement": _serialize_replacement(replacement),
                "reused": True,
            })
        if current_status != ReplacementStatus.PENDING:
            return _err(
                "Replacement request can no longer be cancelled because it is already under review",
                409,
            )

        now = timezone.now()
        meta = _extract_replacement_meta(replacement.notes)
        status_timeline = list(meta.get("statusTimeline") or [])
        status_timeline.append(
            {
                "status": ReplacementStatus.CANCELLED,
                "at": now.isoformat(),
                "by": str(p.get("userId") or ""),
            }
        )
        replacement.notes = _upsert_replacement_meta(
            replacement.notes,
            {
                "statusTimeline": status_timeline,
                "cancelledAt": now.isoformat(),
                "cancelledBy": str(p.get("userId") or ""),
            },
        )
        replacement.notes = _append_replacement_note_line(
            replacement.notes,
            "CANCELLED: Cancelled by customer before review",
        )
        replacement.status = ReplacementStatus.CANCELLED
        replacement.save(update_fields=["status", "notes", "updated_at"])

    cancellation_customer_name = str(
        getattr(getattr(getattr(replacement, "order", None), "customer", None), "name", "")
        or "Customer"
    ).strip() or "Customer"
    _create_staff_notifications(
        title="Replacement request cancelled",
        message=(
            f"{cancellation_customer_name} "
            f"cancelled replacement request {replacement.replacement_number} before review."
        ),
        notification_type="REPLACEMENT",
        reference_type="replacement",
        reference_id=replacement.id,
    )
    return _ok(
        {
            "success": True,
            "replacement": _serialize_replacement(replacement),
            "message": "Replacement request cancelled",
        }
    )


@require_GET
def customer_tracking(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p or p.get("type") != "customer":
        return _err("Unauthorized", 401)
    orders = list(
        _real_orders(Order.objects.select_related("customer").filter(customer_id=p.get("userId")))
        .order_by("-updated_at")[:100]
    )
    order_ids = [o.id for o in orders]

    latest_drop_point_by_order: dict[str, TripDropPoint] = {}
    trip_ids: set[str] = set()
    if order_ids:
        drop_points = (
            TripDropPoint.objects.select_related("trip__driver", "trip__vehicle")
            .filter(order_id__in=order_ids)
            .order_by("order_id", "-trip__updated_at", "-updated_at")
        )
        for drop_point in drop_points:
            if not drop_point.order_id:
                continue
            if drop_point.order_id in latest_drop_point_by_order:
                continue
            latest_drop_point_by_order[drop_point.order_id] = drop_point
            if drop_point.trip_id:
                trip_ids.add(drop_point.trip_id)

    latest_log_by_trip: dict[str, LocationLog] = {}
    if trip_ids:
        # Ignore malformed legacy rows whose owner does not match the assigned trip driver.
        logs = LocationLog.objects.filter(
            trip_id__in=list(trip_ids),
            driver_id=F("trip__driver_id"),
        ).order_by("trip_id", "-recorded_at")
        for log in logs:
            if not log.trip_id:
                continue
            if log.trip_id not in latest_log_by_trip:
                latest_log_by_trip[log.trip_id] = log

    tracking: list[dict[str, Any]] = []
    for o in orders:
        drop_point = latest_drop_point_by_order.get(o.id)
        trip = drop_point.trip if drop_point else None
        latest_log = latest_log_by_trip.get(trip.id) if trip else None
        normalized_order_status = _normalize_order_status(o.status)

        driver_lat = _to_float_or_none(getattr(latest_log, "latitude", None))
        driver_lng = _to_float_or_none(getattr(latest_log, "longitude", None))
        drop_lat = _to_float_or_none(getattr(drop_point, "latitude", None))
        drop_lng = _to_float_or_none(getattr(drop_point, "longitude", None))
        shipping_lat = _to_float_or_none(o.shipping_latitude or getattr(o.customer, "latitude", None))
        shipping_lng = _to_float_or_none(o.shipping_longitude or getattr(o.customer, "longitude", None))

        if driver_lat is not None and driver_lng is not None:
            latitude = driver_lat
            longitude = driver_lng
            source = "driver_gps"
        elif drop_lat is not None and drop_lng is not None:
            latitude = drop_lat
            longitude = drop_lng
            source = "trip_stop"
        elif shipping_lat is not None and shipping_lng is not None:
            latitude = shipping_lat
            longitude = shipping_lng
            source = "shipping_address"
        else:
            latitude = None
            longitude = None
            source = "unavailable"

        route_points = []
        if latest_log:
            log_lat = _to_float_or_none(getattr(latest_log, "latitude", None))
            log_lng = _to_float_or_none(getattr(latest_log, "longitude", None))
            if log_lat is not None and log_lng is not None:
                route_points.append(
                    {
                        "latitude": float(log_lat),
                        "longitude": float(log_lng),
                        "recordedAt": latest_log.recorded_at.isoformat() if latest_log.recorded_at else None,
                    }
                )

        driver_name = None
        driver_phone = None
        driver_avatar = None
        trip_number = None
        if trip:
            trip_number = trip.trip_number
            if getattr(trip, "driver", None):
                driver_name = getattr(trip.driver, "name", None) or getattr(getattr(trip.driver, "user", None), "name", None)
                driver_phone = getattr(trip.driver, "phone", None) or getattr(getattr(trip.driver, "user", None), "phone", None)
                driver_avatar = getattr(getattr(trip.driver, "user", None), "avatar", None)

        eta_minutes: int | None = None
        eta_arrival_at: str | None = None
        destination_lat = drop_lat if drop_lat is not None else shipping_lat
        destination_lng = drop_lng if drop_lng is not None else shipping_lng
        if (
            normalized_order_status == OrderStatus.OUT_FOR_DELIVERY
            and driver_lat is not None
            and driver_lng is not None
            and destination_lat is not None
            and destination_lng is not None
        ):
            remaining_distance_km = _haversine_km(float(driver_lat), float(driver_lng), float(destination_lat), float(destination_lng))
            # Prefer actual GPS speed (m/s → km/h) when available, fall back to 24 km/h.
            raw_driver_speed = _to_float_or_none(getattr(latest_log, "speed", None)) if latest_log else None
            speed_kph = (raw_driver_speed * 3.6) if raw_driver_speed is not None and raw_driver_speed > 0 else 24.0
            speed_kph = min(max(float(speed_kph), 10.0), 70.0)
            computed_eta = int(math.ceil((remaining_distance_km / speed_kph) * 60)) if remaining_distance_km > 0 else 1
            eta_minutes = max(1, computed_eta)
            eta_arrival_at = (timezone.now() + timedelta(minutes=eta_minutes)).isoformat()

        tracking.append(
            {
                "orderId": o.id,
                "orderNumber": o.order_number,
                "status": normalized_order_status,
                "orderStatus": normalized_order_status,
                "updatedAt": (
                    latest_log.recorded_at.isoformat()
                    if latest_log and latest_log.recorded_at
                    else (o.updated_at.isoformat() if o.updated_at else None)
                ),
                "tripNumber": trip_number,
                "driverName": driver_name,
                "driverPhone": driver_phone,
                "driverAvatar": driver_avatar,
                "latitude": latitude,
                "longitude": longitude,
                "source": source,
                "destinationLatitude": drop_lat if drop_lat is not None else shipping_lat,
                "destinationLongitude": drop_lng if drop_lng is not None else shipping_lng,
                "etaMinutes": eta_minutes,
                "etaArrivalAt": eta_arrival_at,
                "recipientName": getattr(drop_point, "recipient_name", None),
                "deliveryPhoto": getattr(drop_point, "delivery_photo", None),
                "deliveredMessage": "Your order has been delivered." if normalized_order_status == OrderStatus.DELIVERED else None,
                "routePoints": route_points,
                "trip": _serialize_trip(trip, include_points=False) if trip else None,
            }
        )
    return _ok({"success": True, "tracking": tracking})
