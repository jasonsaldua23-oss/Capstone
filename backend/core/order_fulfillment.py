"""Delivery completion, reconciliation and trip/order association."""

import json
import logging
import re
from datetime import datetime, time
from typing import Any

from django.db import transaction
from django.utils import timezone

from . import views_api as legacy
from .api_utils import to_int as _int
from .models import (
    Customer,
    Inventory,
    InventoryQuantityUnit,
    InventoryTransaction,
    Order,
    OrderItem,
    OrderStatus,
    OrderTimeline,
    PurchaseOrderStage,
    PurchaseRequestStatus,
    Replacement,
    ReplacementLine,
    RoleType,
    Trip,
    TripDropPoint,
    TripStatus,
    User,
)

logger = logging.getLogger(__name__)


# Helpers owned by sibling modules. Routing them through views_api keeps
# a single resolution point, so tests that patch there still apply.


def _build_order_item_trip_assignments_map(order_ids: list[str], *, trip_id: str | None=None) -> dict[str, dict[str, list[dict[str, Any]]]]:
    return legacy._build_order_item_trip_assignments_map(order_ids, trip_id=trip_id)


def _build_order_item_warehouse_allocations_map(order_ids: list[str]) -> dict[str, dict[str, list[dict[str, Any]]]]:
    return legacy._build_order_item_warehouse_allocations_map(order_ids)


def _create_customer_notification(*, customer: Customer | None, title: str, message: str, notification_type: str='REPLACEMENT', reference_type: str | None=None, reference_id: str | None=None) -> None:
    return legacy._create_customer_notification(customer=customer, title=title, message=message, notification_type=notification_type, reference_type=reference_type, reference_id=reference_id)


def _email_order_delivered_to_customer(order: Order, *, received_by: str='') -> None:
    return legacy._email_order_delivered_to_customer(order, received_by=received_by)


def _finalize_order_inventory_on_delivery(order: Order, performed_by: str | None) -> None:
    return legacy._finalize_order_inventory_on_delivery(order, performed_by)


def _normalize_order_status(value: Any) -> str:
    return legacy._normalize_order_status(value)


def _normalize_product_unit(raw: Any) -> str:
    return legacy._normalize_product_unit(raw)


def _real_trips(qs):
    return legacy._real_trips(qs)


def _release_order_reservations(order: Order, performed_by: str | None) -> None:
    return legacy._release_order_reservations(order, performed_by)


@transaction.atomic
def _mark_order_delivered(order: Order, performed_by: str | None, delivered_at: datetime | None = None) -> None:
    # Fix: serialize delivery retries and re-read status after the lock, so stock
    # and its ledger commit together exactly once even with stale request objects.
    locked_order = Order.objects.select_for_update().get(pk=order.pk)
    order.status = locked_order.status
    order.request_status = locked_order.request_status
    if _normalize_order_status(order.status) == OrderStatus.DELIVERED:
        timeline, _ = OrderTimeline.objects.get_or_create(order=order)
        if not timeline.delivered_at:
            timeline.delivered_at = delivered_at or timezone.now()
            timeline.save(update_fields=["delivered_at", "updated_at"])
        return

    if _normalize_order_status(order.status) in {OrderStatus.CANCELLED, OrderStatus.REJECTED}:
        raise ValueError("Cancelled/rejected orders cannot be marked as delivered")

    _finalize_order_inventory_on_delivery(order, performed_by)
    from .deposit_lifecycle import finalize_order_deposits_on_delivery
    finalize_order_deposits_on_delivery(order, performed_by)
    _reconcile_replacement_bottle_remainder_on_delivery(order, performed_by)
    _advance_replacement_line_progress_on_delivery(order)
    order.status = OrderStatus.DELIVERED
    update_fields = ["status", "updated_at"]
    if str(order.request_status or "").strip().upper() == PurchaseRequestStatus.APPROVED:
        # Keep the PO workflow stage synchronized with driver-completed delivery.
        order.purchase_order_stage = PurchaseOrderStage.DELIVERED
        update_fields.append("purchase_order_stage")
    order.save(update_fields=update_fields)

    timeline, _ = OrderTimeline.objects.get_or_create(order=order)
    if not timeline.shipped_at:
        timeline.shipped_at = getattr(order, "warehouse_dispatched_at", None) or timezone.now()
    if not timeline.delivered_at:
        timeline.delivered_at = delivered_at or timezone.now()
    timeline.save(update_fields=["shipped_at", "delivered_at", "updated_at"])

    # Notify the order owner only after delivery was successfully persisted.
    _create_customer_notification(
        customer=order.customer,
        title="Order delivered",
        message=f"Your order {order.order_number} has been delivered successfully.",
        notification_type="ORDER",
        reference_type="order",
        reference_id=order.id,
    )
    try:
        delivered_for_mail = (
            Order.objects.select_related("customer", "timeline")
            .prefetch_related("items__product")
            .get(id=order.id)
        )
        _email_order_delivered_to_customer(delivered_for_mail)
    except Exception:
        logger.exception("Failed to email the completed delivery for order %s", order.id)


def _advance_replacement_line_progress_on_delivery(order: Order) -> None:
    """Credit delivered base units back to the ReplacementLine rows they cover.

    The scheduler stamps the outstanding base units it ordered into each item's
    notes, so delivery reads that back rather than re-deriving it from case
    maths. Runs on the single not-delivered-to-delivered transition that
    _mark_order_delivered guards, and caps at the requested amount so a repeat
    call cannot over-credit a line.
    """
    order_number = str(getattr(order, "order_number", "") or "").strip().upper()
    if not order_number.startswith("RPL-"):
        return
    replacement = (
        Replacement.objects.filter(notes__contains=order.id)
        .order_by("created_at")
        .first()
    )
    if replacement is None:
        return

    delivered_by_product: dict[str, int] = {}
    for order_item in order.items.all():
        product_id = str(getattr(order_item, "product_id", "") or "").strip()
        if not product_id:
            continue
        match = re.search(r"ReplacementRequestedBottles=(\d+)", str(getattr(order_item, "notes", "") or ""))
        if not match:
            continue
        delivered_by_product[product_id] = delivered_by_product.get(product_id, 0) + _int(match.group(1), 0)

    if not delivered_by_product:
        return

    rows = (
        ReplacementLine.objects.select_for_update(of=("self",))
        .filter(replacement=replacement)
        .order_by("id")
    )
    for row in rows:
        product_id = str(getattr(row, "product_id", "") or "").strip()
        available = delivered_by_product.get(product_id, 0)
        if available <= 0:
            continue
        requested = max(0, _int(row.requested_base_units, 0))
        replaced = max(0, _int(row.replaced_base_units, 0))
        outstanding = max(0, requested - replaced)
        credited = min(outstanding, available)
        if credited <= 0:
            continue
        row.replaced_base_units = replaced + credited
        row.save(update_fields=["replaced_base_units", "updated_at"])
        delivered_by_product[product_id] = available - credited


def _reconcile_replacement_bottle_remainder_on_delivery(order: Order, performed_by: str | None) -> None:
    order_number = str(getattr(order, "order_number", "") or "").strip().upper()
    if not order_number.startswith("RPL-"):
        return
    warehouse_id = str(getattr(order, "warehouse_id", "") or "").strip() or None
    for order_item in order.items.select_related("product").all():
        item_notes = str(getattr(order_item, "notes", "") or "")
        if "ReplacementUnitMode=BOTTLE" not in item_notes:
            continue
        if InventoryTransaction.objects.filter(
            reference_type="order_item",
            reference_id=order_item.id,
            type="OUT",
            quantity_unit=InventoryQuantityUnit.BASE_UNIT,
        ).exists():
            # New bottle-mode allocations retain an opened case's unused bottles
            # during deduction, so a follow-up stock-in entry would double count.
            continue
        if InventoryTransaction.objects.filter(
            reference_type="replacement_bottle_remainder",
            reference_id=order_item.id,
        ).exists():
            continue
        product = getattr(order_item, "product", None)
        if not product or _normalize_product_unit(getattr(product, "unit", None)) == "bottle":
            continue
        requested_match = re.search(r"ReplacementRequestedBottles=(\d+)", item_notes)
        expected_bottles = _int(requested_match.group(1), 0) if requested_match else 0
        qty_per_case = max(1, _int(getattr(product, "quantity_per_unit", 0), 1))
        delivered_bottle_equivalent = max(0, _int(getattr(order_item, "quantity", 0), 0)) * qty_per_case
        remainder_bottles = max(0, delivered_bottle_equivalent - expected_bottles)
        if remainder_bottles <= 0:
            continue
        inventory = Inventory.objects.filter(product=product, warehouse_id=warehouse_id).first() if warehouse_id else None
        if not inventory:
            inventory = Inventory.objects.filter(product=product).first()
        if not inventory:
            continue
        previous_loose_bottles = max(0, _int(getattr(inventory, "loose_bottles", 0), 0))
        inventory.loose_bottles = previous_loose_bottles + remainder_bottles
        inventory.save(update_fields=["loose_bottles", "updated_at"])
        InventoryTransaction.objects.create(
            warehouse=inventory.warehouse,
            product=product,
            type="IN",
            quantity=remainder_bottles,
            quantity_unit=InventoryQuantityUnit.BASE_UNIT,
            stock_unit_label="Bottle",
            previous_stock=previous_loose_bottles,
            updated_stock=inventory.loose_bottles,
            reference_type="replacement_bottle_remainder",
            reference_id=order_item.id,
            notes=(
                f"RPL bottle reconciliation for {order.order_number}: expected {expected_bottles}, "
                f"deducted {delivered_bottle_equivalent}, returned remainder {remainder_bottles} as loose bottles"
            ),
        )


def _reconcile_delivered_order_from_completed_drop_point(order: Order, performed_by: str | None = None) -> bool:
    if _normalize_order_status(order.status) in {OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.REJECTED}:
        return False

    completed_drop_point = (
        TripDropPoint.objects.filter(order_id=order.id, status__in=["COMPLETED", "DELIVERED"])
        .order_by("-actual_departure", "-updated_at")
        .first()
    )
    if not completed_drop_point:
        return False

    _mark_order_delivered(order, performed_by, completed_drop_point.actual_departure or timezone.now())
    return True


def _expire_past_delivery_purchase_requests(order_ids: list[str] | None = None) -> set[str]:
    """Cancel unapproved requests whose promised delivery day has already passed."""
    local_midnight = timezone.make_aware(
        datetime.combine(timezone.localdate(), time.min),
        timezone.get_current_timezone(),
    )
    candidates = Order.objects.select_related("customer", "timeline").filter(
        status=OrderStatus.PENDING,
        request_status=PurchaseRequestStatus.PENDING_APPROVAL,
        timeline__delivery_date__lt=local_midnight,
    )
    if order_ids is not None:
        candidates = candidates.filter(id__in=order_ids)

    expired_ids: set[str] = set()
    now = timezone.now()
    reason = "Delivery date expired before approval"
    for order in candidates:
        with transaction.atomic():
            # Fix: the conditional update keeps expiration idempotent if two lists load together.
            updated = Order.objects.filter(
                id=order.id,
                status=OrderStatus.PENDING,
                request_status=PurchaseRequestStatus.PENDING_APPROVAL,
            ).update(
                status=OrderStatus.CANCELLED,
                request_status=PurchaseRequestStatus.CANCELLED,
                purchase_order_stage=None,
                cancelled_by_name="System",
                cancellation_reason=reason,
                cancelled_at=now,
                updated_at=now,
            )
            if not updated:
                continue
            # QuerySet.update bypasses post_save; retain the separate PR decision too.
            from .purchase_documents import sync_purchase_documents
            sync_purchase_documents(order)
            # Fix: cancellation and reservation release must commit together.
            _release_order_reservations(order, None)
            OrderTimeline.objects.filter(order_id=order.id).update(cancelled_at=now, updated_at=now)
        expired_ids.add(str(order.id))
        _create_customer_notification(
            customer=order.customer,
            title="Purchase request expired",
            message=f"Your purchase request {order.purchase_request_number or order.order_number} was cancelled because its delivery date passed before approval.",
            notification_type="ORDER",
            reference_type="order",
            reference_id=order.id,
        )
    return expired_ids


def _select_trip_for_order(order_id: str, require_driver: bool = False) -> Trip | None:
    trip_qs = _real_trips(
        Trip.objects.filter(drop_points__order_id=order_id).select_related("driver", "vehicle").order_by("-updated_at")
    )
    if require_driver:
        trip_qs = trip_qs.filter(driver__isnull=False)

    best_trip: Trip | None = None
    best_rank = 99
    for candidate in trip_qs:
        candidate_rank = _trip_status_rank(getattr(candidate, "status", ""))
        if best_trip is None or candidate_rank < best_rank:
            best_trip = candidate
            best_rank = candidate_rank
            if best_rank == 0:
                break
    return best_trip


def _trip_status_rank(value: Any) -> int:
    normalized = str(value or "").strip().upper()
    if normalized == TripStatus.IN_PROGRESS:
        return 0
    if normalized == TripStatus.PLANNED:
        return 1
    if normalized == TripStatus.COMPLETED:
        return 2
    return 3


def _generate_next_trip_number() -> str:
    current_year = timezone.now().year
    prefix = f"TRP-{current_year}-"
    max_sequence = 0
    for trip_number in Trip.objects.filter(trip_number__startswith=prefix).values_list("trip_number", flat=True):
        raw = str(trip_number or "").strip()
        if not raw.startswith(prefix):
            continue
        suffix = raw[len(prefix):]
        if suffix.isdigit():
            max_sequence = max(max_sequence, int(suffix))
    return f"{prefix}{str(max_sequence + 1).zfill(4)}"


def _resolve_primary_admin_phone() -> str:
    """Return the configured business contact, preferring the oldest active super admin."""
    base_query = (
        User.objects.filter(is_active=True)
        .exclude(phone__isnull=True)
        .exclude(phone__exact="")
        .only("phone")
    )
    super_admin = base_query.filter(role=RoleType.SUPER_ADMIN).order_by("created_at").first()
    if super_admin:
        return str(getattr(super_admin, "phone", "") or "").strip()
    admin_user = base_query.filter(role=RoleType.ADMIN).order_by("created_at").first()
    return str(getattr(admin_user, "phone", "") or "").strip()


def _assign_order_items_to_trip_for_warehouse(
    *,
    trip: Trip,
    order_ids: list[str],
    warehouse_id: str,
    performed_by: str | None = None,
) -> int:
    normalized_order_ids = [str(order_id or "").strip() for order_id in order_ids if str(order_id or "").strip()]
    target_warehouse_id = str(warehouse_id or "").strip()
    trip_id_value = str(getattr(trip, "id", "") or "").strip()
    trip_number_value = str(getattr(trip, "trip_number", "") or "").strip()
    if not normalized_order_ids or not target_warehouse_id or not trip_id_value:
        return 0

    order_item_allocations = _build_order_item_warehouse_allocations_map(normalized_order_ids)
    order_item_trip_assignments = _build_order_item_trip_assignments_map(normalized_order_ids, trip_id=trip_id_value)
    order_items = list(
        OrderItem.objects.select_related("product").prefetch_related("mixed_case_components__product").filter(order_id__in=normalized_order_ids)
    )

    rows_created = 0
    for item in order_items:
        item_id = str(getattr(item, "id", "") or "").strip()
        order_id = str(getattr(item, "order_id", "") or "").strip()
        if not item_id or not order_id:
            continue

        warehouse_allocs = (order_item_allocations.get(order_id, {}) or {}).get(item_id, [])
        allocated_for_target_warehouse = sum(
            max(0, _int(entry.get("allocatedQty"), 0))
            for entry in warehouse_allocs
            if str(entry.get("warehouseId") or "").strip() == target_warehouse_id
        )
        if allocated_for_target_warehouse <= 0:
            continue

        assigned_rows = (order_item_trip_assignments.get(order_id, {}) or {}).get(item_id, [])
        already_assigned_for_trip = sum(
            max(0, _int(entry.get("allocatedQty"), 0))
            for entry in assigned_rows
            if str(entry.get("warehouseId") or "").strip() == target_warehouse_id
            and str(entry.get("tripId") or "").strip() == trip_id_value
        )

        pending_qty = max(0, allocated_for_target_warehouse - already_assigned_for_trip)
        if pending_qty <= 0:
            continue

        if item.product_id:
            InventoryTransaction.objects.create(
                warehouse_id=target_warehouse_id,
                product=item.product,
                type="ASSIGN",
                quantity=pending_qty,
                reference_type="order_item_trip_assign",
                reference_id=item_id,
                order_item=item,
                notes=json.dumps(
                    {
                        "tripId": trip_id_value,
                        "tripNumber": trip_number_value or None,
                        "orderId": order_id,
                    },
                    separators=(",", ":"),
                ),
            )
            rows_created += 1
        elif item.item_type == "MIXED_CASE":
            components = item.mixed_case_components.select_related("product").all()
            for comp in components:
                if comp.product:
                    comp_qty = comp.quantity_per_case * pending_qty
                    InventoryTransaction.objects.create(
                        warehouse_id=target_warehouse_id,
                        product=comp.product,
                        type="ASSIGN",
                        quantity=comp_qty,
                        # Preserve units and snapshots so trip retries compare cases consistently.
                        quantity_unit=InventoryQuantityUnit.BASE_UNIT,
                        case_capacity_snapshot=item.case_capacity,
                        case_count_snapshot=pending_qty,
                        performed_by=performed_by,
                        reference_type="order_item_trip_assign",
                        reference_id=item_id,
                        mixed_case_component=comp,
                        order_item=item,
                        notes=json.dumps(
                            {
                                "tripId": trip_id_value,
                                "tripNumber": trip_number_value or None,
                                "orderId": order_id,
                                "componentId": comp.id,
                            },
                            separators=(",", ":"),
                        ),
                    )
                    rows_created += 1

    return rows_created
