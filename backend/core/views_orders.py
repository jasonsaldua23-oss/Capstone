"""Order collection, detail and status transition endpoints."""

import logging
from datetime import date, datetime
from typing import Any

from django.db import IntegrityError, transaction
from django.db.models import Prefetch, Q
from django.http import HttpRequest, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from . import views_api as legacy
from .api_constants import DISCOUNT_NO, PERSON_NAME_NUMBER_ERROR, _NOT_PROVIDED
from .api_utils import error as _err, json_body as _json_body, ok as _ok
from .mixed_case import normalize_checkout_items
from .models import (
    Customer,
    InventoryTransaction,
    MixedCaseComponent,
    Order,
    OrderItem,
    OrderStatus,
    OrderTimeline,
    ProductPackaging,
    PurchaseOrderStage,
    PurchaseRequestStatus,
    Replacement,
    ReplacementStatus,
    RoleType,
    SalesChannel,
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


def _build_assigned_trip_map(order_ids: list[str], require_driver: bool=True) -> dict[str, Trip]:
    return legacy._build_assigned_trip_map(order_ids, require_driver)


def _build_delivery_transactions_map(order_ids: list[str]) -> dict[str, dict[str, list[str]]]:
    return legacy._build_delivery_transactions_map(order_ids)


def _build_discount_breakdown_for_customer(*, customer: Customer, subtotal: float, total_cases: int) -> dict[str, Any]:
    return legacy._build_discount_breakdown_for_customer(customer=customer, subtotal=subtotal, total_cases=total_cases)


def _build_order_fulfillment_legs_map(order_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    return legacy._build_order_fulfillment_legs_map(order_ids)


def _build_order_item_trip_assignments_map(order_ids: list[str], *, trip_id: str | None=None) -> dict[str, dict[str, list[dict[str, Any]]]]:
    return legacy._build_order_item_trip_assignments_map(order_ids, trip_id=trip_id)


def _build_order_item_warehouse_allocations_map(order_ids: list[str]) -> dict[str, dict[str, list[dict[str, Any]]]]:
    return legacy._build_order_item_warehouse_allocations_map(order_ids)


def _build_order_warehouse_allocations_map(order_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    return legacy._build_order_warehouse_allocations_map(order_ids)


def _count_discount_eligible_cases(items: list[dict[str, Any]]) -> int:
    return legacy._count_discount_eligible_cases(items)


def _create_customer_notification(*, customer: Customer | None, title: str, message: str, notification_type: str='REPLACEMENT', reference_type: str | None=None, reference_id: str | None=None) -> None:
    return legacy._create_customer_notification(customer=customer, title=title, message=message, notification_type=notification_type, reference_type=reference_type, reference_id=reference_id)


def _create_order_from_checkout_payload(*, customer: Customer, body: dict[str, Any], normalized_items: list[dict[str, Any]], subtotal: float, tax: float, shipping_cost: float, discount: float, total_amount: float, selected_warehouse_id: str | None, shipping_latitude: Any, shipping_longitude: Any, payment_status: str, performed_by: str | None, discount_breakdown: dict[str, Any] | None=None) -> Order:
    return legacy._create_order_from_checkout_payload(customer=customer, body=body, normalized_items=normalized_items, subtotal=subtotal, tax=tax, shipping_cost=shipping_cost, discount=discount, total_amount=total_amount, selected_warehouse_id=selected_warehouse_id, shipping_latitude=shipping_latitude, shipping_longitude=shipping_longitude, payment_status=payment_status, performed_by=performed_by, discount_breakdown=discount_breakdown)


def _create_scheduled_replacement_order(replacement: Replacement, *, scheduled_date: date, staff_user_id: str | None) -> Order:
    return legacy._create_scheduled_replacement_order(replacement, scheduled_date=scheduled_date, staff_user_id=staff_user_id)


def _create_staff_notifications(*, title: str, message: str, notification_type: str='INVENTORY', reference_type: str | None=None, reference_id: str | None=None) -> None:
    return legacy._create_staff_notifications(title=title, message=message, notification_type=notification_type, reference_type=reference_type, reference_id=reference_id)


def _delivery_date_is_past(value: Any) -> bool:
    return legacy._delivery_date_is_past(value)


def _email_new_order_to_warehouse_staff(order: Order) -> None:
    return legacy._email_new_order_to_warehouse_staff(order)


def _email_order_cancelled_to_customer(order: Order, cancellation_reason: str, *, cancelled_by_customer: bool=False) -> None:
    return legacy._email_order_cancelled_to_customer(order, cancellation_reason, cancelled_by_customer=cancelled_by_customer)


def _email_order_delivered_to_customer(order: Order, *, received_by: str='') -> None:
    return legacy._email_order_delivered_to_customer(order, received_by=received_by)


def _email_order_out_for_delivery_to_customer(order: Order) -> None:
    return legacy._email_order_out_for_delivery_to_customer(order)


def _email_order_preparing_to_customer(order: Order) -> None:
    return legacy._email_order_preparing_to_customer(order)


def _email_order_rejected_to_customer(order: Order, rejection_reason: str) -> None:
    return legacy._email_order_rejected_to_customer(order, rejection_reason)


def _email_purchase_request_approved_to_customer(order: Order) -> None:
    return legacy._email_purchase_request_approved_to_customer(order)


def _email_purchase_request_submitted_to_customer(order: Order) -> None:
    return legacy._email_purchase_request_submitted_to_customer(order)


def _email_replacement_outcome_to_customer(replacement: Replacement, status: str, *, notes: str='', scheduled_delivery_date: Any=None) -> None:
    return legacy._email_replacement_outcome_to_customer(replacement, status, notes=notes, scheduled_delivery_date=scheduled_delivery_date)


def _email_replacement_update_to_staff(replacement: Replacement, status: str, *, actor_name: str, notes: str='', scheduled_delivery_date: Any=None) -> None:
    return legacy._email_replacement_update_to_staff(replacement, status, actor_name=actor_name, notes=notes, scheduled_delivery_date=scheduled_delivery_date)


def _ensure_negros_occidental_address(*, latitude: Any, longitude: Any, city: Any=None, province: Any, require_coordinates: bool=False) -> str | None:
    return legacy._ensure_negros_occidental_address(latitude=latitude, longitude=longitude, city=city, province=province, require_coordinates=require_coordinates)


def _expire_past_delivery_purchase_requests(order_ids: list[str] | None=None) -> set[str]:
    return legacy._expire_past_delivery_purchase_requests(order_ids)


def _extract_replacement_meta(notes: Any) -> dict[str, Any]:
    return legacy._extract_replacement_meta(notes)


def _finalize_order_inventory_on_delivery(order: Order, performed_by: str | None) -> None:
    return legacy._finalize_order_inventory_on_delivery(order, performed_by)


def _generate_next_purchase_workflow_number(field_name: str, prefix: str) -> str:
    return legacy._generate_next_purchase_workflow_number(field_name, prefix)


def _get_allowed_warehouse_ids_for_staff(user_id: str) -> set[str]:
    return legacy._get_allowed_warehouse_ids_for_staff(user_id)


def _normalize_order_status(value: Any) -> str:
    return legacy._normalize_order_status(value)


def _normalize_replacement_status(value: Any, replacement_mode: Any=None) -> str:
    return legacy._normalize_replacement_status(value, replacement_mode)


def _pagination(request: HttpRequest) -> tuple[int, int, int]:
    return legacy._pagination(request)


def _parse_iso_datetime(value: Any) -> datetime | None:
    return legacy._parse_iso_datetime(value)


def _person_name_has_number(*values: Any) -> bool:
    return legacy._person_name_has_number(*values)


def _real_customers(qs):
    return legacy._real_customers(qs)


def _real_orders(qs):
    return legacy._real_orders(qs)


def _real_warehouses(qs):
    return legacy._real_warehouses(qs)


def _reconcile_delivered_order_from_completed_drop_point(order: Order, performed_by: str | None=None) -> bool:
    return legacy._reconcile_delivered_order_from_completed_drop_point(order, performed_by)


def _release_order_reservations(order: Order, performed_by: str | None) -> None:
    return legacy._release_order_reservations(order, performed_by)


def _replacement_has_outstanding_quantity(replacement: Replacement) -> bool:
    return legacy._replacement_has_outstanding_quantity(replacement)


def _require_auth(request: HttpRequest) -> dict[str, Any] | None:
    return legacy._require_auth(request)


def _require_staff(request: HttpRequest) -> tuple[dict[str, Any] | None, JsonResponse | None]:
    return legacy._require_staff(request)


def _reserve_order_inventory(order: Order, performed_by: str | None) -> None:
    return legacy._reserve_order_inventory(order, performed_by)


def _resolve_primary_admin_phone() -> str:
    return legacy._resolve_primary_admin_phone()


def _select_best_warehouse_for_order_items(*, items: list[dict[str, Any]], shipping_latitude: Any, shipping_longitude: Any) -> str | None:
    return legacy._select_best_warehouse_for_order_items(items=items, shipping_latitude=shipping_latitude, shipping_longitude=shipping_longitude)


def _serialize_order(order: Order, include_items: bool=True, include_progress: bool=False, *, warehouse_lookup: dict[str, Warehouse] | None=None, assigned_trip: Trip | None=None, fulfillment_legs: list[dict[str, Any]] | None=None, warehouse_allocations: list[dict[str, Any]] | None=None, item_warehouse_allocations: dict[str, list[dict[str, Any]]] | None=None, item_trip_assignments: dict[str, list[dict[str, Any]]] | None=None, empties_adjustment: Any=_NOT_PROVIDED, packaging_cache: dict[str, ProductPackaging] | None=None, delivery_transactions: dict[str, list[str]] | None=None, pod_drop_point: TripDropPoint | None=None, primary_admin_phone: Any=_NOT_PROVIDED) -> dict[str, Any]:
    return legacy._serialize_order(order, include_items, include_progress, warehouse_lookup=warehouse_lookup, assigned_trip=assigned_trip, fulfillment_legs=fulfillment_legs, warehouse_allocations=warehouse_allocations, item_warehouse_allocations=item_warehouse_allocations, item_trip_assignments=item_trip_assignments, empties_adjustment=empties_adjustment, packaging_cache=packaging_cache, delivery_transactions=delivery_transactions, pod_drop_point=pod_drop_point, primary_admin_phone=primary_admin_phone)


def _serialize_replacement(entry: Replacement, *, warehouse_cache: dict[str, Any] | None=None, order_cache: dict[str, Any] | None=None) -> dict[str, Any]:
    return legacy._serialize_replacement(entry, warehouse_cache=warehouse_cache, order_cache=order_cache)


def _upsert_replacement_meta(notes: Any, updates: dict[str, Any]) -> str:
    return legacy._upsert_replacement_meta(notes, updates)


@csrf_exempt
@require_http_methods(["GET", "POST", "PATCH"])
def orders_collection(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    if request.method == "GET":
        # Fix: pending requests cannot remain actionable after their delivery day passes.
        _expire_past_delivery_purchase_requests()
        page, size, off = _pagination(request)
        include_replacements = str(request.GET.get("includeReplacements") or "").strip().lower() == "true"
        include_orders = request.GET.get("includeOrders", "true") != "false"
        include_items = str(request.GET.get("includeItems", "full") or "full").strip().lower()
        include_fulfillments = str(request.GET.get("includeFulfillments") or "").strip().lower() in {"1", "true", "yes"}
        updated_after = _parse_iso_datetime(request.GET.get("updatedAfter"))
        sort = str(request.GET.get("sort") or "").strip().lower()
        where = Q()
        if p.get("type") == "customer":
            where &= Q(customer_id=p.get("userId"))
        elif p.get("type") == "staff":
            staff_role = str(p.get("role") or "").strip().upper()
            staff_user_id = str(p.get("userId") or "").strip()
            if staff_role == "WAREHOUSE_STAFF" and staff_user_id:
                allowed_warehouse_ids = set(
                    _get_allowed_warehouse_ids_for_staff(staff_user_id)
                )
                if not allowed_warehouse_ids:
                    return _ok({
                        "success": True,
                        "orders": [],
                        "replacements": [],
                        "total": 0,
                        "page": page,
                        "pageSize": size,
                        "totalPages": 0 if include_orders else 0,
                    })
                # Include direct warehouse-bound orders and split-allocation orders
                # whose stock reservations belong to this warehouse.
                reserved_order_ids = list(
                    OrderItem.objects.filter(
                        id__in=InventoryTransaction.objects.filter(
                            reference_type="order_item_reserve",
                            type="RESERVE",
                            warehouse_id__in=list(allowed_warehouse_ids),
                        ).values_list("reference_id", flat=True)
                    ).values_list("order_id", flat=True)
                )
                where &= (
                    Q(warehouse_id__in=list(allowed_warehouse_ids))
                    | Q(id__in=reserved_order_ids)
                )
        if request.GET.get("status"):
            where &= Q(status=_normalize_order_status(request.GET.get("status")))
        if updated_after:
            where &= Q(updated_at__gt=updated_after)
        s = str(request.GET.get("search", "")).strip()
        if s:
            where &= Q(order_number__icontains=s) | Q(customer__name__icontains=s)
        # POS receipts belong to the retail transaction history, not the regular order workflow.
        orders_qs = Order.objects.select_related("customer", "timeline").filter(where).exclude(
            sales_channel=SalesChannel.RETAIL_POS
        )
        if include_items != "none":
            # Serializer-only attributes keep item and component hydration to two batched queries.
            serialized_components = Prefetch(
                "mixed_case_components",
                queryset=MixedCaseComponent.objects.select_related("product").order_by("created_at", "id"),
                to_attr="_serialized_mixed_case_components",
            )
            serialized_items = Prefetch(
                "items",
                queryset=OrderItem.objects.select_related("product").prefetch_related(serialized_components),
                to_attr="_serialized_order_items",
            )
            orders_qs = orders_qs.prefetch_related(serialized_items)
        order_by_field = "-updated_at" if sort in {"updated", "updated_at"} else "-created_at"
        oqs = _real_orders(orders_qs).order_by(order_by_field)
        total = oqs.count() if include_orders else 0
        orders = list(oqs[off : off + size]) if include_orders else []
        order_ids = [str(getattr(order, "id", "") or "").strip() for order in orders]
        warehouse_ids = {str(getattr(order, "warehouse_id", "") or "").strip() for order in orders if str(getattr(order, "warehouse_id", "") or "").strip()}
        warehouse_lookup = {warehouse.id: warehouse for warehouse in Warehouse.objects.filter(id__in=warehouse_ids)} if warehouse_ids else {}
        assigned_trip_map = _build_assigned_trip_map(order_ids, require_driver=True)
        fulfillment_legs_map = _build_order_fulfillment_legs_map(order_ids) if include_fulfillments else {}
        warehouse_allocations_map = _build_order_warehouse_allocations_map(order_ids)
        item_warehouse_allocations_map = _build_order_item_warehouse_allocations_map(order_ids)
        item_trip_assignments_map = _build_order_item_trip_assignments_map(order_ids)
        empties_adjustment_map = empties_adjustments_for_orders(order_ids)
        delivery_transactions_map = _build_delivery_transactions_map(order_ids)
        # Resolve the receipt contact once for the page instead of once per order.
        primary_admin_phone = _resolve_primary_admin_phone()
        # Reconciliation only matters for orders that are still open and already have
        # a completed stop. Asking that once for the page avoids a lookup per order.
        open_order_ids = [
            str(o.id)
            for o in orders
            if _normalize_order_status(o.status) not in {OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.REJECTED}
        ]
        reconcilable_order_ids = set(
            TripDropPoint.objects.filter(
                order_id__in=open_order_ids, status__in=["COMPLETED", "DELIVERED"]
            ).values_list("order_id", flat=True)
        ) if open_order_ids else set()
        # Packaging is read for every returnable item; without this the page spends
        # one round trip per item on a table it could load in a single query.
        page_product_ids = {
            str(item.product_id)
            for order in orders
            for item in (getattr(order, "_serialized_order_items", None) or order.items.all())
            if getattr(item, "product_id", None)
        }
        packaging_cache = {
            str(packaging.product_id): packaging
            for packaging in ProductPackaging.objects.filter(
                product_id__in=page_product_ids, is_active=True
            )
        } if page_product_ids else {}
        out = []
        for o in orders:
            try:
                if str(o.id) in reconcilable_order_ids and _reconcile_delivered_order_from_completed_drop_point(o, p.get("userId")):
                    o.refresh_from_db()
            except ValueError as e:
                logger.warning("Unable to reconcile delivered order %s: %s", o.id, e)
            row = _serialize_order(
                o,
                include_items=include_items != "none",
                warehouse_lookup=warehouse_lookup,
                assigned_trip=assigned_trip_map.get(str(getattr(o, "id", "") or "").strip()),
                fulfillment_legs=fulfillment_legs_map.get(str(getattr(o, "id", "") or "").strip()) if include_fulfillments else None,
                warehouse_allocations=warehouse_allocations_map.get(str(getattr(o, "id", "") or "").strip(), []),
                item_warehouse_allocations=item_warehouse_allocations_map.get(str(getattr(o, "id", "") or "").strip(), {}),
                item_trip_assignments=item_trip_assignments_map.get(str(getattr(o, "id", "") or "").strip(), {}),
                empties_adjustment=empties_adjustment_map.get(str(getattr(o, "id", "") or "").strip()),
                packaging_cache=packaging_cache,
                delivery_transactions=delivery_transactions_map.get(str(getattr(o, "id", "") or "").strip(), {}),
                primary_admin_phone=primary_admin_phone,
            )
            if include_items == "preview" and "items" in row:
                row["itemCount"] = len(row["items"])
                row["items"] = row["items"][:2]
            if include_items == "none":
                row.pop("items", None)
            out.append(row)
        replacements_out = []
        if include_replacements:
            replacements_qs = Replacement.objects.select_related("order", "order__customer").filter(
                order__in=oqs,
                order__customer__in=_real_customers(Customer.objects.all()),
            ).order_by("-created_at")
            replacements_out = [_serialize_replacement(r) for r in replacements_qs[:size]]
        return _ok({
            "success": True,
            "orders": out,
            "replacements": replacements_out,
            "total": total,
            "page": page,
            "pageSize": size,
            "totalPages": (total + size - 1) // size if include_orders else 0,
        })
    if request.method == "POST":
        # Fix: existing on-behalf flows belong to administration and warehouse staff.
        if p.get("type") == "staff" and p.get("role") not in {RoleType.ADMIN, RoleType.SUPER_ADMIN, RoleType.WAREHOUSE_STAFF}:
            return _err("Forbidden", 403)
        body = _json_body(request)
        if _person_name_has_number(body.get("shippingName")):
            # Fix: shipping contact names follow the same validation as customer profiles.
            return _err(PERSON_NAME_NUMBER_ERROR, 400)
        customer_id = str(body.get("customerId") or "").strip()
        if p.get("type") == "customer":
            authenticated_customer_id = str(p.get("userId") or "").strip()
            # Fix: reject an on-behalf customer ID instead of silently accepting
            # a request that attempted to create an order for another account.
            if customer_id and customer_id != authenticated_customer_id:
                return _err("Forbidden", 403)
            customer_id = authenticated_customer_id
        if not customer_id:
            return _err("customerId is required")
        try:
            customer = Customer.objects.get(id=customer_id)
        except Customer.DoesNotExist:
            return _err("Customer not found", 404)
        request_id = str(body.get("requestId") or "").strip()
        # Request IDs make a retry idempotent when a client supplies one. Older
        # customer clients can still submit a purchase request without one.
        if len(request_id) > 120:
            return _err("requestId must be 120 characters or fewer", 400)
        if request_id:
            existing_order = (
                Order.objects.select_related("customer", "timeline")
                .prefetch_related("items__product", "items__mixed_case_components__product")
                .filter(customer=customer, request_id=request_id)
                .first()
            )
            if existing_order:
                # An idempotent retry must not revive a request whose delivery date passed.
                _expire_past_delivery_purchase_requests([str(existing_order.id)])
                existing_order.refresh_from_db()
                return _ok({"success": True, "duplicate": True, "order": _serialize_order(existing_order)})
        delivery_date_raw = str(body.get("deliveryDate") or "").strip()
        if delivery_date_raw:
            parsed_delivery_date = _parse_iso_datetime(delivery_date_raw)
            if parsed_delivery_date is None:
                return _err("Invalid deliveryDate format", 400)
            if _delivery_date_is_past(parsed_delivery_date):
                return _err("Delivery date cannot be in the past. Choose today or a future date.", 400)
            # Store one validated ISO value so checkout and workflow comparisons agree.
            body["deliveryDate"] = parsed_delivery_date.isoformat()
        items = body.get("items") or []
        if not isinstance(items, list) or not items:
            return _err("items are required")
        selected_warehouse_id = str(body.get("warehouseId") or "").strip() or None
        if p.get("type") == "customer" and not selected_warehouse_id:
            shipping_latitude = body.get("shippingLatitude") if body.get("shippingLatitude") is not None else customer.latitude
            shipping_longitude = body.get("shippingLongitude") if body.get("shippingLongitude") is not None else customer.longitude
            selected_warehouse_id = _select_best_warehouse_for_order_items(
                items=items,
                shipping_latitude=shipping_latitude,
                shipping_longitude=shipping_longitude,
            )
            if not selected_warehouse_id:
                # Fix: an oversized request still belongs in the warehouse review
                # queue even when current stock cannot fulfill it immediately.
                selected_warehouse_id = (
                    _real_warehouses(Warehouse.objects.filter(is_active=True))
                    .values_list("id", flat=True)
                    .first()
                )
        shipping_latitude = body.get("shippingLatitude") if body.get("shippingLatitude") is not None else customer.latitude
        shipping_longitude = body.get("shippingLongitude") if body.get("shippingLongitude") is not None else customer.longitude
        shipping_city = body.get("shippingCity") if body.get("shippingCity") is not None else customer.city
        shipping_province = body.get("shippingProvince") if body.get("shippingProvince") is not None else customer.province
        address_error = _ensure_negros_occidental_address(
            latitude=shipping_latitude,
            longitude=shipping_longitude,
            city=shipping_city,
            province=shipping_province,
            require_coordinates=True,
        )
        if address_error:
            return _err(address_error, 400)
        try:
            # Mixed cases do not have a parent productId; use the component-aware server normalizer.
            normalized_items, normalized_subtotal = normalize_checkout_items(items)
            subtotal = float(normalized_subtotal)
            # Only case-equivalent lines qualify; individual bottles are excluded.
            total_cases = _count_discount_eligible_cases(normalized_items)
            discount_breakdown = _build_discount_breakdown_for_customer(
                customer=customer,
                subtotal=subtotal,
                total_cases=total_cases,
            )
            # Required: neither regular orders nor retail charge tax or shipping fees.
            tax = 0.0
            shipping_cost = 0.0
            discount = float(discount_breakdown.get("totalDiscount") or 0)
            total = float(subtotal - discount)
            with transaction.atomic():
                order = _create_order_from_checkout_payload(
                    customer=customer,
                    body=body,
                    normalized_items=normalized_items,
                    subtotal=subtotal,
                    tax=tax,
                    shipping_cost=shipping_cost,
                    discount=discount,
                    total_amount=total,
                    selected_warehouse_id=selected_warehouse_id,
                    shipping_latitude=shipping_latitude,
                    shipping_longitude=shipping_longitude,
                    # Checkout has no payment workflow; ignore legacy client values.
                    payment_status="pending",
                    performed_by=(p or {}).get("userId"),
                    discount_breakdown=discount_breakdown,
                )
                # Fix: reserve fulfillable requests immediately so Available stock
                # is accurate. Keep insufficient requests visible for staff review.
                try:
                    with transaction.atomic():
                        _reserve_order_inventory(order, (p or {}).get("userId"))
                except ValueError as reserve_error:
                    if "insufficient" not in str(reserve_error).lower():
                        raise
                order.save(update_fields=["warehouse_id", "updated_at"])
        except ValueError as e:
            return _err(str(e), 400)
        except IntegrityError:
            logger.exception("Order create integrity error")
            return _err("Unable to create order right now. Please try again.", 409)
        order = Order.objects.select_related("customer", "timeline").prefetch_related("items__product").get(id=order.id)
        try:
            # Fix: notification delivery is best-effort after the purchase request commits.
            _email_new_order_to_warehouse_staff(order)
        except Exception:
            logger.exception("Failed to email warehouse staff for committed order %s", order.id)
        try:
            _email_purchase_request_submitted_to_customer(order)
        except Exception:
            logger.exception("Failed to email the submitted purchase request for order %s", order.id)
        # Added: warehouse staff need an in-app alert for every new order,
        # including orders submitted directly through the customer portal.
        actor_name = (
            str(customer.name or "Customer").strip() or "Customer"
            if p.get("type") == "customer"
            else str(p.get("name") or "Staff").strip() or "Staff"
        )
        try:
            # Fix: a notification failure must not turn a committed request into HTTP 500.
            _create_staff_notifications(
                title="New order received" if p.get("type") == "customer" else "Order created",
                message=f"{actor_name} created order {order.order_number}.",
                notification_type="ORDER",
                reference_type="order",
                reference_id=order.id,
            )
        except Exception:
            logger.exception("Failed to notify staff for committed order %s", order.id)
        # Notify the customer when the bulk-order discount (>=50 cases/packs) is applied.
        if discount > 0 and discount_breakdown.get("option", DISCOUNT_NO) != DISCOUNT_NO:
            try:
                _discount_percent = float(discount_breakdown.get("percent") or 0)
                _cases_affected = int(discount_breakdown.get("casesAffected") or 0)
                _discount_name = str(discount_breakdown.get("name") or "Discount").strip()
                _create_customer_notification(
                    customer=customer,
                    title="Bulk order discount applied! 🎉",
                    message=(
                        f"Your order {order.order_number} qualifies for a {_discount_percent:g}% discount "
                        f"({_discount_name}) because it includes {_cases_affected} case(s)/pack(s) "
                        "meeting the 50-case minimum. "
                        f"You saved ₱{discount:,.2f} on this order."
                    ),
                    notification_type="ORDER",
                    reference_type="order",
                    reference_id=order.id,
                )
            except Exception:
                logger.exception("Failed to send discount notification for order %s", order.id)
        return _ok({"success": True, "duplicate": False, "order": _serialize_order(order)}, 201)
    staff, err = _require_staff(request)
    if err:
        return err
    body = _json_body(request)
    if body.get("scope") != "replacement":
        return _err("Invalid patch scope")
    return_id = str(body.get("replacementId") or "")
    status = str(body.get("status") or "")
    if not return_id or not status:
        return _err("replacementId and status are required")
    try:
        r = Replacement.objects.select_related("order").get(id=return_id)
    except Replacement.DoesNotExist:
        return _err("Replacement record not found", 404)
    normalized_status = _normalize_replacement_status(status, r.replacement_mode)
    allowed_statuses = {
        ReplacementStatus.PENDING,
        ReplacementStatus.UNDER_REVIEW,
        ReplacementStatus.APPROVED,
        ReplacementStatus.REJECTED,
        ReplacementStatus.REPORTED,
        ReplacementStatus.IN_PROGRESS,
        ReplacementStatus.RESOLVED_ON_DELIVERY,
        ReplacementStatus.NEEDS_FOLLOW_UP,
        ReplacementStatus.COMPLETED,
    }
    if normalized_status not in allowed_statuses:
        return _err("Invalid replacement status", 400)

    replacement_delivery_date_raw = str(body.get("replacementDeliveryDate") or "").strip()
    replacement_delivery_date = None
    if replacement_delivery_date_raw:
        try:
            replacement_delivery_date = datetime.fromisoformat(replacement_delivery_date_raw).date()
        except ValueError:
            return _err("Invalid replacementDeliveryDate. Expected YYYY-MM-DD", 400)

    create_replacement_order = bool(body.get("createReplacementOrder"))
    manual_schedule_confirmed = bool(body.get("manualScheduleConfirmed"))
    staff_role = str(staff.get("role") or "").strip().upper()
    is_admin_role = staff_role in {RoleType.ADMIN, RoleType.SUPER_ADMIN}
    is_warehouse_role = staff_role == RoleType.WAREHOUSE_STAFF

    current_status_normalized = str(_normalize_replacement_status(getattr(r, "status", None), r.replacement_mode) or "").upper()
    if current_status_normalized == ReplacementStatus.CANCELLED:
        return _err("Cancelled replacement requests cannot be updated", 409)
    if create_replacement_order and normalized_status != ReplacementStatus.IN_PROGRESS:
        return _err("Replacement is not eligible for scheduling delivery", 400)
    if create_replacement_order and not replacement_delivery_date:
        return _err("replacementDeliveryDate is required when createReplacementOrder is true", 400)
    if create_replacement_order and not manual_schedule_confirmed:
        return _err("Manual schedule confirmation is required", 400)
    if create_replacement_order and not is_warehouse_role:
        return _err("Only warehouse staff can schedule replacement deliveries", 403)
    # Added: warehouse staff may perform exactly one status-only transition:
    # APPROVED -> IN_PROGRESS. Scheduling is unlocked only after this step.
    is_warehouse_start_processing = (
        not create_replacement_order
        and is_warehouse_role
        and current_status_normalized == ReplacementStatus.APPROVED
        and normalized_status == ReplacementStatus.IN_PROGRESS
    )
    if not create_replacement_order and not is_admin_role and not is_warehouse_start_processing:
        return _err("Only admin can set replacement UNDER_REVIEW, APPROVED, or REJECTED", 403)
    if is_admin_role and normalized_status not in {ReplacementStatus.UNDER_REVIEW, ReplacementStatus.APPROVED, ReplacementStatus.REJECTED}:
        return _err("Admin can only set replacement to UNDER_REVIEW, APPROVED, or REJECTED here", 400)
    if create_replacement_order and current_status_normalized != ReplacementStatus.IN_PROGRESS:
        return _err("Replacement is not eligible for warehouse scheduling yet", 400)
    if normalized_status in {ReplacementStatus.RESOLVED_ON_DELIVERY, ReplacementStatus.COMPLETED}:
        if _replacement_has_outstanding_quantity(r):
            return _err(
                "Replacement cannot be marked completed while there are still products to replace",
                400,
            )

    r.status = normalized_status
    status_notes = str(body.get("notes") or "").strip()
    if normalized_status == ReplacementStatus.REJECTED and not status_notes:
        return _err("Rejection reason is required in notes", 400)
    if normalized_status == ReplacementStatus.IN_PROGRESS:
        r.pickup_completed = timezone.now()
    if normalized_status in {ReplacementStatus.RESOLVED_ON_DELIVERY, ReplacementStatus.COMPLETED}:
        r.processed_at = timezone.now()
        r.processed_by = staff.get("userId")
    if create_replacement_order and replacement_delivery_date:
        try:
            replacement_order = _create_scheduled_replacement_order(
                r,
                scheduled_date=replacement_delivery_date,
                staff_user_id=str(staff.get("userId") or "").strip() or None,
            )
        except ValueError as e:
            return _err(str(e), 400)
        except Exception:
            logger.exception("Failed to schedule replacement delivery for %s", r.id)
            return _err("Unable to schedule replacement delivery right now", 500)
        r.status = ReplacementStatus.IN_PROGRESS
        if normalized_status == ReplacementStatus.APPROVED and not status_notes:
            status_notes = "Replacement approved and scheduled for delivery"
        _create_staff_notifications(
            title="Replacement delivery scheduled",
            message=(
                f"{str(staff.get('name') or 'Staff').strip() or 'Staff'} scheduled {r.replacement_number} "
                f"as order {replacement_order.order_number} for {replacement_delivery_date.isoformat()}."
            ),
            notification_type="REPLACEMENT",
            reference_type="order",
            reference_id=replacement_order.id,
        )
    final_status = str(r.status or normalized_status)
    status_meta = _extract_replacement_meta(r.notes)
    status_timeline = [item for item in (status_meta.get("statusTimeline") or []) if isinstance(item, dict)]
    if not status_timeline or str(status_timeline[-1].get("status") or "").upper() != final_status.upper():
        status_timeline.append({
            "status": final_status,
            "at": timezone.now().isoformat(),
            "by": str(staff.get("userId") or ""),
            # Preserve the decision-maker, timestamp, and remarks for audit.
            "byName": str(staff.get("name") or "Staff").strip() or "Staff",
            "remarks": status_notes,
        })
    # Fix: persist every status transition so customer claim timelines stay current.
    review_decision = {}
    if is_admin_role and final_status in {ReplacementStatus.APPROVED, ReplacementStatus.REJECTED}:
        review_decision = {
            "reviewDecision": {
                "status": final_status,
                "adminId": str(staff.get("userId") or ""),
                "adminName": str(staff.get("name") or "Staff").strip() or "Staff",
                "decidedAt": timezone.now().isoformat(),
                "remarks": status_notes,
            }
        }
    r.notes = _upsert_replacement_meta(r.notes, {"statusTimeline": status_timeline, **review_decision})
    r.notes = _append_replacement_note_line(
        r.notes,
        f"{final_status}{f': {status_notes}' if status_notes else ''}",
    )
    r.save()
    actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
    serialized_replacement = _serialize_replacement(r)
    replacement_lines = serialized_replacement.get("replacementLines") or serialized_replacement.get("replacementItems") or []
    product_names: list[str] = []
    for line in replacement_lines[:3]:
        if not isinstance(line, dict):
            continue
        name = str(line.get("originalProductName") or line.get("replacementProductName") or "").strip()
        if name:
            product_names.append(name)
    replacement_product_hint = ", ".join(product_names) if product_names else "N/A"
    replacement_reason = str(getattr(r, "reason", "") or "").strip() or "N/A"
    _create_staff_notifications(
        title="Replacement updated",
        message=(
            f"{actor_name} changed replacement {r.replacement_number} to {final_status}. "
            f"Reason: {replacement_reason}. Product Ref: {replacement_product_hint}."
        ),
        notification_type="REPLACEMENT",
        reference_type="replacement",
        reference_id=r.id,
    )
    customer_obj = getattr(getattr(r, "order", None), "customer", None)
    _create_customer_notification(
        customer=customer_obj,
        title="Replacement status updated",
        message=(
            f"Replacement {r.replacement_number} is now {final_status}. "
            f"Reason: {replacement_reason}. "
            f"{f'Scheduled delivery date: {replacement_delivery_date.isoformat()}. ' if replacement_delivery_date else ''}"
        ),
        notification_type="REPLACEMENT",
        reference_type="replacement",
        reference_id=r.id,
    )
    try:
        _email_replacement_update_to_staff(
            r,
            final_status,
            actor_name=actor_name,
            notes=status_notes,
            scheduled_delivery_date=replacement_delivery_date,
        )
        _email_replacement_outcome_to_customer(
            r,
            final_status,
            notes=status_notes,
            scheduled_delivery_date=replacement_delivery_date,
        )
    except Exception:
        logger.exception("Failed to email the replacement outcome for %s", r.id)
    return _ok({"success": True, "replacement": _serialize_replacement(r), "message": "Replacement status updated"})


@require_GET
def order_detail(request: HttpRequest, order_id: str) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    try:
        o = Order.objects.select_related("customer", "timeline").prefetch_related("items__product").get(id=order_id)
    except Order.DoesNotExist:
        return _err("Order not found", 404)
    if p.get("type") == "customer" and p.get("userId") != o.customer_id:
        return _err("Forbidden", 403)
    try:
        if _reconcile_delivered_order_from_completed_drop_point(o, p.get("userId")):
            o = Order.objects.select_related("customer", "timeline").prefetch_related("items__product").get(id=order_id)
    except ValueError as e:
        logger.warning("Unable to reconcile delivered order %s: %s", o.id, e)
    legs_map = _build_order_fulfillment_legs_map([str(o.id)])
    warehouse_allocations_map = _build_order_warehouse_allocations_map([str(o.id)])
    item_warehouse_allocations_map = _build_order_item_warehouse_allocations_map([str(o.id)])
    item_trip_assignments_map = _build_order_item_trip_assignments_map([str(o.id)])
    return _ok(
        {
            "success": True,
            "order": _serialize_order(
                o,
                include_progress=True,
                fulfillment_legs=legs_map.get(str(o.id), []),
                warehouse_allocations=warehouse_allocations_map.get(str(o.id), []),
                item_warehouse_allocations=item_warehouse_allocations_map.get(str(o.id), {}),
                item_trip_assignments=item_trip_assignments_map.get(str(o.id), {}),
            ),
        }
    )


@csrf_exempt
@require_http_methods(["PATCH"])
def order_status_update(request: HttpRequest, order_id: str) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    body = _json_body(request)
    status = body.get("status")
    rejection_reason = str(body.get("reason") or "").strip()
    if not status:
        return _err("status is required")
    next_status = _normalize_order_status(status)
    allowed_statuses = {
        OrderStatus.PENDING,
        OrderStatus.CONFIRMED,
        OrderStatus.PREPARING,
        OrderStatus.RESCHEDULED,
        OrderStatus.OUT_FOR_DELIVERY,
        OrderStatus.DELIVERED,
        OrderStatus.REJECTED,
        OrderStatus.CANCELLED,
    }
    if next_status not in allowed_statuses:
        return _err("Invalid status", 400)
    try:
        o = Order.objects.select_related("timeline").get(id=order_id)
    except Order.DoesNotExist:
        return _err("Order not found", 404)

    # Dispatch is recorded only by the driver trip-start flow, which keeps the
    # delivery status tied to a real assigned vehicle and active trip.
    if next_status == OrderStatus.OUT_FOR_DELIVERY:
        return _err("OUT_FOR_DELIVERY is set automatically when the trip starts", 400)

    current_status = _normalize_order_status(o.status)
    is_pending_request = str(o.request_status or "").strip().upper() == PurchaseRequestStatus.PENDING_APPROVAL
    timeline = getattr(o, "timeline", None)
    delivery_date_past = bool(timeline and timeline.delivery_date and _delivery_date_is_past(timeline.delivery_date))

    # Fix: an expired pending request is closed consistently even if approval is attempted directly.
    if is_pending_request and delivery_date_past:
        _expire_past_delivery_purchase_requests([str(o.id)])
        return _err("Purchase request expired because its delivery date has passed.", 409)

    rescheduled_delivery_at: datetime | None = None
    if next_status == OrderStatus.RESCHEDULED:
        rescheduled_delivery_at = _parse_iso_datetime(body.get("deliveryDate"))
        if rescheduled_delivery_at is None:
            return _err("A valid deliveryDate is required to reschedule the order", 400)
        if _delivery_date_is_past(rescheduled_delivery_at):
            return _err("Delivery date cannot be in the past. Choose today or a future date.", 400)
        active_trip_assignment = TripDropPoint.objects.filter(
            order_id=o.id,
            status__in=["PENDING", "ARRIVED", "IN_TRANSIT", "IN_PROGRESS"],
        ).exists()
        if active_trip_assignment:
            return _err("Remove the order from its active delivery trip before rescheduling it.", 409)
    repairs_missing_approval = (
        next_status == OrderStatus.CONFIRMED
        and (is_pending_request or not str(o.purchase_order_number or "").strip())
    )

    if current_status == next_status and not repairs_missing_approval and next_status != OrderStatus.RESCHEDULED:
        current = Order.objects.select_related("customer", "timeline").get(id=o.id)
        return _ok({"success": True, "order": _serialize_order(current, include_items=False)})

    if current_status == OrderStatus.DELIVERED and next_status != OrderStatus.DELIVERED:
        return _err("Delivered orders cannot be moved to another status", 400)

    allowed_transitions = {
        OrderStatus.PENDING: {OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.REJECTED, OrderStatus.CANCELLED},
        OrderStatus.CONFIRMED: {OrderStatus.PREPARING, OrderStatus.RESCHEDULED, OrderStatus.REJECTED, OrderStatus.CANCELLED},
        OrderStatus.PREPARING: {OrderStatus.RESCHEDULED, OrderStatus.OUT_FOR_DELIVERY, OrderStatus.REJECTED, OrderStatus.CANCELLED},
        OrderStatus.RESCHEDULED: {OrderStatus.PREPARING, OrderStatus.OUT_FOR_DELIVERY, OrderStatus.REJECTED, OrderStatus.CANCELLED},
        OrderStatus.OUT_FOR_DELIVERY: {OrderStatus.DELIVERED, OrderStatus.REJECTED, OrderStatus.CANCELLED},
        OrderStatus.DELIVERED: set(),
        OrderStatus.REJECTED: set(),
        OrderStatus.CANCELLED: set(),
    }
    if current_status != next_status and next_status not in allowed_transitions.get(current_status, set()):
        return _err(f"Invalid transition from {current_status} to {next_status}", 400)

    staff_role = str(staff.get("role") or "").strip().upper()
    if (is_pending_request or current_status == OrderStatus.PENDING) and next_status == OrderStatus.CONFIRMED:
        if staff_role != RoleType.WAREHOUSE_STAFF:
            return _err("Only warehouse staff can approve purchase requests", 403)

    # Pending requests must go through approval before any PO fulfillment stage.
    if is_pending_request and next_status not in {
        OrderStatus.CONFIRMED,
        OrderStatus.REJECTED,
        OrderStatus.CANCELLED,
    }:
        return _err("Purchase request must be approved before processing", 400)

    if delivery_date_past and next_status == OrderStatus.PREPARING:
        return _err("Delivery date has passed. Reschedule the order before processing it.", 409)

    if next_status == OrderStatus.REJECTED and not rejection_reason:
        return _err("A rejection reason is required", 400)

    # Required: every order cancellation must record the reason supplied by the user.
    if next_status == OrderStatus.CANCELLED and not rejection_reason:
        return _err("A cancellation reason is required", 400)

    try:
        with transaction.atomic():
            # Fix: lock and update the PR workflow together with the order status so approval creates one PO.
            o = Order.objects.select_for_update().get(id=order_id)
            # Revalidate after waiting for another approval/cancellation/delivery.
            current_status = _normalize_order_status(o.status)
            is_pending_request = o.request_status == PurchaseRequestStatus.PENDING_APPROVAL
            # PostgreSQL cannot lock the nullable side of select_related("timeline").
            # Lock the one-to-one timeline separately while the parent order is locked.
            locked_timeline = OrderTimeline.objects.select_for_update().filter(order_id=o.id).first()
            locked_delivery_date_past = bool(
                locked_timeline
                and locked_timeline.delivery_date
                and _delivery_date_is_past(locked_timeline.delivery_date)
            )
            if locked_delivery_date_past and next_status == OrderStatus.PREPARING:
                return _err("Delivery date has passed. Reschedule the order before processing it.", 409)
            if current_status == next_status and not (next_status == OrderStatus.CONFIRMED and (is_pending_request or not o.purchase_order_number)) and next_status != OrderStatus.RESCHEDULED:
                return _ok({"success": True, "order": _serialize_order(o, include_items=False)})
            if current_status != next_status and next_status not in allowed_transitions.get(current_status, set()):
                return _err(f"Invalid transition from {current_status} to {next_status}", 409)
            now = timezone.now()
            actor_id = str(staff.get("userId") or "").strip()
            actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
            if next_status == OrderStatus.DELIVERED:
                _finalize_order_inventory_on_delivery(o, staff.get("userId"))
                from .deposit_lifecycle import finalize_order_deposits_on_delivery
                finalize_order_deposits_on_delivery(o, staff.get("userId"))
            elif next_status in {OrderStatus.CANCELLED, OrderStatus.REJECTED}:
                _release_order_reservations(o, staff.get("userId"))

            o.status = next_status
            update_fields = ["status", "updated_at"]

            if next_status == OrderStatus.CONFIRMED:
                # Keep approval idempotent for older requests that may not yet have
                # submission-time reservations.
                _reserve_order_inventory(o, staff.get("userId"))
                update_fields.append("warehouse_id")
                if not str(o.purchase_request_number or "").strip():
                    o.purchase_request_number = _generate_next_purchase_workflow_number("purchase_request_number", "PR")
                    update_fields.append("purchase_request_number")
                if not str(o.purchase_order_number or "").strip():
                    o.purchase_order_number = _generate_next_purchase_workflow_number("purchase_order_number", "PO")
                    update_fields.append("purchase_order_number")
                o.order_number = o.purchase_order_number
                update_fields.append("order_number")
                o.request_status = PurchaseRequestStatus.APPROVED
                o.purchase_order_stage = PurchaseOrderStage.APPROVED
                o.approved_by_user_id = actor_id
                o.approved_by_name = actor_name
                o.approved_at = now
                update_fields.extend(["request_status", "purchase_order_stage", "approved_by_user_id", "approved_by_name", "approved_at"])
            elif is_pending_request and next_status == OrderStatus.REJECTED:
                # Keep rejected requests as PR records without creating a PO stage.
                o.request_status = PurchaseRequestStatus.REJECTED
                o.purchase_order_stage = None
                o.rejected_by_user_id = actor_id
                o.rejected_by_name = actor_name
                o.rejection_reason = rejection_reason
                o.rejected_at = now
                update_fields.extend(["request_status", "purchase_order_stage", "rejected_by_user_id", "rejected_by_name", "rejection_reason", "rejected_at"])
            elif is_pending_request and next_status == OrderStatus.CANCELLED:
                # Keep cancelled requests as PR records without creating a PO stage.
                o.request_status = PurchaseRequestStatus.CANCELLED
                o.purchase_order_stage = None
                o.cancelled_by_user_id = actor_id
                o.cancelled_by_name = actor_name
                o.cancellation_reason = rejection_reason
                o.cancelled_at = now
                update_fields.extend(["request_status", "purchase_order_stage", "cancelled_by_user_id", "cancelled_by_name", "cancellation_reason", "cancelled_at"])
            elif next_status == OrderStatus.PREPARING:
                o.purchase_order_stage = PurchaseOrderStage.PROCESSING
                update_fields.append("purchase_order_stage")
            elif next_status == OrderStatus.RESCHEDULED:
                # A manual reschedule returns the PO to the warehouse queue with a valid date.
                o.purchase_order_stage = PurchaseOrderStage.APPROVED
                update_fields.append("purchase_order_stage")
            elif next_status == OrderStatus.OUT_FOR_DELIVERY:
                o.purchase_order_stage = PurchaseOrderStage.OUT_FOR_DELIVERY
                update_fields.append("purchase_order_stage")
            elif next_status == OrderStatus.DELIVERED:
                o.purchase_order_stage = PurchaseOrderStage.DELIVERED
                update_fields.append("purchase_order_stage")
            elif next_status == OrderStatus.CANCELLED:
                o.purchase_order_stage = PurchaseOrderStage.CANCELLED
                o.cancelled_by_user_id = actor_id
                o.cancelled_by_name = actor_name
                o.cancellation_reason = rejection_reason
                o.cancelled_at = now
                update_fields.extend(["purchase_order_stage", "cancelled_by_user_id", "cancelled_by_name", "cancellation_reason", "cancelled_at"])
            elif next_status == OrderStatus.REJECTED:
                o.purchase_order_stage = PurchaseOrderStage.CANCELLED
                o.rejected_by_user_id = actor_id
                o.rejected_by_name = actor_name
                o.rejection_reason = rejection_reason
                o.rejected_at = now
                update_fields.extend(["purchase_order_stage", "rejected_by_user_id", "rejected_by_name", "rejection_reason", "rejected_at"])

            if rejection_reason:
                existing_notes = str(getattr(o, "notes", "") or "").strip()
                note_line = f"Order Note: {rejection_reason}"
                o.notes = f"{existing_notes}\n{note_line}".strip() if existing_notes else note_line
                update_fields.append("notes")
            o.save(update_fields=list(dict.fromkeys(update_fields)))

            timeline, _ = OrderTimeline.objects.get_or_create(order=o)
            if next_status == OrderStatus.RESCHEDULED and rescheduled_delivery_at is not None:
                timeline.delivery_date = rescheduled_delivery_at
            status_map = {
                "CONFIRMED": "confirmed_at",
                "PREPARING": "processed_at",
                "OUT_FOR_DELIVERY": "shipped_at",
                "DELIVERED": "delivered_at",
                "REJECTED": "cancelled_at",
                "CANCELLED": "cancelled_at",
            }
            field = status_map.get(o.status)
            if field:
                setattr(timeline, field, now)
            timeline.save()
    except ValueError as e:
        return _err(str(e), 400)

    updated = Order.objects.select_related("customer", "timeline").get(id=o.id)
    actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
    # Display the business-facing approval label without changing the internal status enum.
    notification_status = "APPROVED" if next_status == OrderStatus.CONFIRMED else next_status
    _create_staff_notifications(
        title="Order status updated",
        message=f"{actor_name} changed order {updated.order_number} status to {notification_status}.",
        notification_type="ORDER",
        reference_type="order",
        reference_id=updated.id,
    )

    if next_status == OrderStatus.CONFIRMED:
        po_number = str(updated.purchase_order_number or updated.order_number or "").strip()
        # Fix: customer notifications use direct customer-facing order language;
        # staff actor/audit wording remains limited to staff notifications above.
        _create_customer_notification(
            customer=updated.customer,
            title="Order approved",
            message=f"Your order {po_number} was approved.",
            notification_type="ORDER",
            reference_type="order",
            reference_id=updated.id,
        )
    elif next_status == OrderStatus.DELIVERED:
        # Direct staff delivery updates do not pass through _mark_order_delivered.
        _create_customer_notification(
            customer=updated.customer,
            title="Order delivered",
            message=f"Your order {updated.order_number} has been delivered successfully.",
            notification_type="ORDER",
            reference_type="order",
            reference_id=updated.id,
        )
    elif next_status == OrderStatus.RESCHEDULED and rescheduled_delivery_at is not None:
        _create_customer_notification(
            customer=updated.customer,
            title="Order rescheduled",
            message=f"Your order {updated.order_number} was rescheduled to {timezone.localtime(rescheduled_delivery_at).date().isoformat()}.",
            notification_type="ORDER",
            reference_type="order",
            reference_id=updated.id,
        )

    # Every outcome the customer can see gets its own message, written for that
    # outcome rather than one template with the status swapped in.
    try:
        order_for_mail = (
            Order.objects.select_related("customer", "timeline")
            .prefetch_related("items__product")
            .get(id=updated.id)
        )
        if next_status == OrderStatus.CONFIRMED:
            _email_purchase_request_approved_to_customer(order_for_mail)
        elif next_status == OrderStatus.PREPARING:
            _email_order_preparing_to_customer(order_for_mail)
        elif next_status == OrderStatus.OUT_FOR_DELIVERY:
            _email_order_out_for_delivery_to_customer(order_for_mail)
        elif next_status == OrderStatus.DELIVERED:
            _email_order_delivered_to_customer(order_for_mail)
        elif next_status == OrderStatus.REJECTED:
            _email_order_rejected_to_customer(order_for_mail, rejection_reason)
        elif next_status == OrderStatus.CANCELLED:
            _email_order_cancelled_to_customer(order_for_mail, rejection_reason)
    except Exception:
        logger.exception("Failed to email the order outcome for %s", updated.id)

    return _ok({"success": True, "order": _serialize_order(updated, include_items=False)})
