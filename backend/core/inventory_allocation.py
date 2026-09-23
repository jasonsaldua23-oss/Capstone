"""Stock reservation, warehouse selection and batch allocation engine."""

import math
import re
from typing import Any

from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone

from . import views_api as legacy
from .api_utils import to_float_or_none as _to_float_or_none, to_int as _int
from .mixed_case import (
    allocatable_standard_cases,
    consume_order_item_reservations,
    release_order_item_reservations,
    reserve_order_item,
    units_per_case,
)
from .models import (
    Inventory,
    InventoryQuantityUnit,
    InventoryReservation,
    InventoryTransaction,
    Order,
    OrderItem,
    OrderItemType,
    Product,
    ReservationStatus,
    StockBatch,
    Vehicle,
    Warehouse,
)


# Helpers owned by sibling modules. Routing them through views_api keeps
# a single resolution point, so tests that patch there still apply.


def _build_order_item_warehouse_allocations_map(order_ids: list[str]) -> dict[str, dict[str, list[dict[str, Any]]]]:
    return legacy._build_order_item_warehouse_allocations_map(order_ids)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    return legacy._haversine_km(lat1, lon1, lat2, lon2)


def _normalize_allocation_policy(raw: Any) -> str:
    return legacy._normalize_allocation_policy(raw)


def _normalize_product_unit(raw: Any) -> str:
    return legacy._normalize_product_unit(raw)


def _real_warehouses(qs):
    return legacy._real_warehouses(qs)


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


def _persist_stock_batch_quantity(batch: StockBatch) -> None:
    """
    Remove empty batches only when no stock or protected history needs them.
    """
    if _int(getattr(batch, "quantity", 0), 0) <= 0:
        # Keep source batches referenced by reservations and any remaining loose stock.
        has_loose_stock = _int(batch.loose_units, 0) > 0
        if has_loose_stock or batch.reservations.exists():
            batch.quantity = 0
            batch.status = "ACTIVE" if has_loose_stock else "DEPLETED"
            batch.save(update_fields=["quantity", "status", "updated_at"])
            return
        batch.delete()
        return
    batch.status = "ACTIVE"
    batch.save(update_fields=["quantity", "status", "updated_at"])


def _extract_allocation_policy_from_notes(notes: Any) -> str:
    text = str(notes or "")
    marker = "AllocationPolicy="
    idx = text.rfind(marker)
    if idx < 0:
        return "FEFO"
    raw = text[idx + len(marker) :].splitlines()[0].strip()
    return _normalize_allocation_policy(raw)


def _sellable_standard_cases(inventory: Inventory, product: Product) -> int:
    """Full cases a standard-case reservation may still take from one inventory row."""
    # The reserved_quantity counter also covers reservations made before
    # reserved_base_units was kept in step, so never trust either one alone.
    counter_available = max(0, _int(inventory.quantity, 0) - _int(inventory.reserved_quantity, 0))
    return min(counter_available, allocatable_standard_cases(inventory, product))


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

    # Lock inventory rows so concurrent approvals cannot reserve the same cases
    # after reading an identical availability snapshot.
    inventory_qs = Inventory.objects.select_for_update().select_related("warehouse").filter(product=product)
    if warehouse_id:
        inventory_qs = inventory_qs.filter(warehouse_id=warehouse_id)

    inventories = list(inventory_qs)
    product_label = str(product.name or product.sku or product.id).strip()
    if not inventories:
        raise ValueError(
            f"Insufficient stock for {product_label}. Available: 0 cases; required: {requested_qty} cases."
        )

    inventory_by_id = {inv.id: inv for inv in inventories}
    batches = list(
        StockBatch.objects.select_for_update().select_related("inventory")
        .filter(inventory_id__in=list(inventory_by_id.keys()), quantity__gt=0)
        # Fix: legacy reservations and deliveries must exclude expired/quarantined stock.
        .filter(status__iexact="ACTIVE")
        .filter(Q(expiry_date__isnull=True) | Q(expiry_date__gt=timezone.now()))
    )
    # Fix: cap by the batch-backed sellable cases the catalog shows, so the error
    # never claims unbatched or mixed-case-held stock is available.
    available_by_inventory = {inv.id: _sellable_standard_cases(inv, product) for inv in inventories}
    total_available = sum(available_by_inventory.values())
    if not batches or total_available < requested_qty:
        raise ValueError(
            f"Insufficient stock for {product_label}. Available: {total_available} cases; "
            f"required: {requested_qty} cases."
        )

    ordered_batches = _sorted_batches_for_policy(batches, allocation_policy)
    remaining = requested_qty
    allocation_by_inventory: dict[str, int] = {}
    allocation_rows: list[dict[str, Any]] = []

    for batch in ordered_batches:
        if remaining <= 0:
            break
        inventory_available = available_by_inventory.get(batch.inventory_id, 0)
        if batch.quantity <= 0 or inventory_available <= 0:
            continue

        take_qty = min(batch.quantity, inventory_available, remaining)
        if take_qty <= 0:
            continue

        inventory = inventory_by_id.get(batch.inventory_id)
        if not inventory:
            continue

        allocation_by_inventory[inventory.id] = allocation_by_inventory.get(inventory.id, 0) + take_qty
        available_by_inventory[inventory.id] = max(0, inventory_available - take_qty)
        allocation_rows.append(
            {
                "batchNumber": batch.batch_number,
                "quantity": take_qty,
                "warehouseId": inventory.warehouse_id,
            }
        )
        remaining -= take_qty

    if remaining > 0:
        raise ValueError(
            f"Insufficient stock for {product_label}. Available: {requested_qty - remaining} cases; "
            f"required: {requested_qty} cases."
        )

    per_case = units_per_case(product)
    for inventory_id, qty in allocation_by_inventory.items():
        inventory = inventory_by_id.get(inventory_id)
        if not inventory:
            continue
        inventory.reserved_quantity = max(0, int(inventory.reserved_quantity or 0) + qty)
        # Fix: catalog availability reads reserved_base_units for reservations that
        # have no InventoryReservation row. Updating only reserved_quantity left a
        # reserved purchase request fully visible as sellable stock.
        inventory.reserved_base_units = max(0, int(inventory.reserved_base_units or 0)) + qty * per_case
        inventory.save(update_fields=["reserved_quantity", "reserved_base_units", "updated_at"])
        InventoryTransaction.objects.create(
            warehouse=inventory.warehouse,
            product=product,
            type="RESERVE",
            quantity=qty,
            quantity_unit=InventoryQuantityUnit.CASE,
            stock_unit_label="Case",
            # Marks that this reservation also counted into reserved_base_units,
            # so consume/release reverse exactly what was added.
            case_capacity_snapshot=per_case,
            reference_type="order_item_reserve",
            reference_id=order_item.id,
            notes=f"{allocation_policy} reserve for order {order.order_number}",
        )

    return allocation_rows


def _standard_case_shortfalls(order_items: list[OrderItem]) -> list[str]:
    """Per-product messages for standard-case lines that current sellable stock cannot cover."""
    required_by_product: dict[str, int] = {}
    products: dict[str, Product] = {}
    for order_item in order_items:
        if order_item.item_type == OrderItemType.MIXED_CASE or order_item.product is None:
            continue
        product_id = str(order_item.product_id)
        products[product_id] = order_item.product
        required_by_product[product_id] = required_by_product.get(product_id, 0) + max(0, _int(order_item.quantity, 0))

    messages: list[str] = []
    for product_id, required in required_by_product.items():
        product = products[product_id]
        # Reservation may fall back to any warehouse, so compare against all of them.
        available = sum(
            _sellable_standard_cases(inventory, product)
            for inventory in Inventory.objects.filter(product_id=product_id)
        )
        if available < required:
            product_label = str(product.name or product.sku or product.id).strip()
            messages.append(
                f"Insufficient stock for {product_label}. Available: {available} cases; required: {required} cases."
            )
    return messages


def _reserve_order_inventory(order: Order, performed_by: str | None) -> None:
    """Reserve every Purchase Request line against the latest locked stock state."""
    order_items = list(
        OrderItem.objects.select_for_update(of=("self",))
        .select_related("product", "order")
        .prefetch_related("mixed_case_components__product")
        .filter(order=order)
        .order_by("created_at", "id")
    )
    warehouses_used: set[str] = set()

    # Approval retries and older already-reserved requests must never reserve twice.
    unreserved_items = [
        order_item
        for order_item in order_items
        if not InventoryReservation.objects.filter(
            order_item=order_item,
            status=ReservationStatus.RESERVED,
        ).exists()
        and not InventoryTransaction.objects.filter(
            reference_type="order_item_reserve",
            reference_id=order_item.id,
            type="RESERVE",
        ).exists()
    ]
    shortfalls = _standard_case_shortfalls(unreserved_items)
    if shortfalls:
        # Added: report every short product at once before anything is reserved.
        raise ValueError(" ".join(shortfalls))

    for order_item in unreserved_items:
        allocation_policy = _extract_allocation_policy_from_notes(order_item.notes)
        if order_item.item_type == OrderItemType.MIXED_CASE:
            reserve_order_item(order_item, allocation_policy, performed_by)
            if str(order.warehouse_id or "").strip():
                warehouses_used.add(str(order.warehouse_id).strip())
            continue

        if order_item.product is None:
            raise ValueError(f"Order item {order_item.id} has no active product")

        requested_warehouse_id = str(order.warehouse_id or "").strip() or None
        used_fallback_warehouse = False
        try:
            allocations = _reserve_inventory_for_order_item(
                product=order_item.product,
                requested_qty=max(0, _int(order_item.quantity, 0)),
                order=order,
                order_item=order_item,
                warehouse_id=requested_warehouse_id,
                allocation_policy=allocation_policy,
                performed_by=performed_by,
            )
        except ValueError:
            if not requested_warehouse_id:
                raise
            used_fallback_warehouse = True
            allocations = _reserve_inventory_for_order_item(
                product=order_item.product,
                requested_qty=max(0, _int(order_item.quantity, 0)),
                order=order,
                order_item=order_item,
                warehouse_id=None,
                allocation_policy=allocation_policy,
                performed_by=performed_by,
            )

        for allocation in allocations:
            warehouse_id = str(allocation.get("warehouseId") or "").strip()
            if warehouse_id:
                warehouses_used.add(warehouse_id)
        allocation_note = f"Reserved using {allocation_policy}: " + ", ".join(
            f"{allocation['batchNumber']} x{allocation['quantity']}" for allocation in allocations
        )
        fallback_note = "\nWarehouseFallback=TRUE" if used_fallback_warehouse else ""
        order_item.notes = f"{order_item.notes or ''}{fallback_note}\n{allocation_note}".strip()
        order_item.save(update_fields=["notes"])

    # A split allocation intentionally has no single owning warehouse; its reserve
    # transactions keep the request visible to every warehouse supplying stock.
    if len(warehouses_used) == 1:
        order.warehouse_id = next(iter(warehouses_used))
    elif len(warehouses_used) > 1:
        order.warehouse_id = None


def _select_best_warehouse_for_order_items(
    *,
    items: list[dict[str, Any]],
    shipping_latitude: Any,
    shipping_longitude: Any,
) -> str | None:
    requested_by_product: dict[str, int] = {}
    mixed_component_requests: list[tuple[str, int]] = []
    for item in items:
        if str(item.get("itemType") or "").strip().upper() == OrderItemType.MIXED_CASE:
            case_count = max(0, _int(item.get("quantity", item.get("caseCount")), 0))
            for component in item.get("components") or []:
                product_id = str((component or {}).get("productId") or "").strip()
                bottle_quantity = max(0, _int((component or {}).get("quantity"), 0)) * case_count
                if product_id and bottle_quantity > 0:
                    mixed_component_requests.append((product_id, bottle_quantity))
            continue
        product_id = str(item.get("productId") or "").strip()
        if not product_id:
            continue
        qty = _int(item.get("quantity"), 0)
        if qty <= 0:
            continue
        requested_by_product[product_id] = requested_by_product.get(product_id, 0) + qty

    if mixed_component_requests:
        product_ids = {product_id for product_id, _ in mixed_component_requests}
        case_sizes = {
            str(product_id): max(1, _int(quantity_per_unit, 1))
            for product_id, quantity_per_unit in Product.objects.filter(id__in=product_ids).values_list("id", "quantity_per_unit")
        }
        # Warehouse availability is stored in cases; round component bottles up to their source-case requirement.
        for product_id, bottle_quantity in mixed_component_requests:
            required_cases = int(math.ceil(bottle_quantity / max(1, case_sizes.get(product_id, 1))))
            requested_by_product[product_id] = requested_by_product.get(product_id, 0) + required_cases

    if not requested_by_product:
        return None

    inventory_rows = list(
        Inventory.objects.select_related("warehouse")
        .filter(
            product_id__in=list(requested_by_product.keys()),
            warehouse__in=_real_warehouses(Warehouse.objects.all()),
        )
        .values(
            "warehouse_id",
            "product_id",
            "quantity",
            "reserved_quantity",
            "warehouse__latitude",
            "warehouse__longitude",
        )
    )
    if not inventory_rows:
        return None

    available_by_warehouse: dict[str, dict[str, int]] = {}
    warehouse_coords: dict[str, tuple[float | None, float | None]] = {}
    for row in inventory_rows:
        warehouse_id = str(row.get("warehouse_id") or "").strip()
        product_id = str(row.get("product_id") or "").strip()
        if not warehouse_id or not product_id:
            continue
        available_qty = max(0, _int(row.get("quantity"), 0) - _int(row.get("reserved_quantity"), 0))
        available_by_warehouse.setdefault(warehouse_id, {})
        available_by_warehouse[warehouse_id][product_id] = available_by_warehouse[warehouse_id].get(product_id, 0) + available_qty
        if warehouse_id not in warehouse_coords:
            warehouse_coords[warehouse_id] = (
                _to_float_or_none(row.get("warehouse__latitude")),
                _to_float_or_none(row.get("warehouse__longitude")),
            )

    candidate_warehouse_ids: list[str] = []
    for warehouse_id in sorted(available_by_warehouse.keys()):
        product_stock = available_by_warehouse.get(warehouse_id, {})
        can_fulfill_all = True
        for product_id, required_qty in requested_by_product.items():
            if product_stock.get(product_id, 0) < required_qty:
                can_fulfill_all = False
                break
        if can_fulfill_all:
            candidate_warehouse_ids.append(warehouse_id)

    if not candidate_warehouse_ids:
        return None

    ship_lat = _to_float_or_none(shipping_latitude)
    ship_lng = _to_float_or_none(shipping_longitude)
    if ship_lat is None or ship_lng is None:
        return candidate_warehouse_ids[0]

    best_with_distance: tuple[float, str] | None = None
    for warehouse_id in candidate_warehouse_ids:
        wh_lat, wh_lng = warehouse_coords.get(warehouse_id, (None, None))
        if wh_lat is None or wh_lng is None:
            continue
        distance_km = _haversine_km(ship_lat, ship_lng, wh_lat, wh_lng)
        if best_with_distance is None or distance_km < best_with_distance[0]:
            best_with_distance = (distance_km, warehouse_id)

    if best_with_distance is not None:
        return best_with_distance[1]
    return candidate_warehouse_ids[0]


@transaction.atomic
def _adjust_reserved_for_order_item(
    *,
    order_item: OrderItem,
    operation: str,
    performed_by: str | None,
    consume_qty: int | None = None,
) -> None:
    # Legacy reservations have no reservation row; use the parent order as their retry lock.
    Order.objects.select_for_update().get(id=order_item.order_id)
    reserve_rows = list(
        InventoryTransaction.objects.filter(
            reference_type="order_item_reserve",
            reference_id=order_item.id,
        ).values("warehouse_id", "product_id", "type", "quantity", "case_capacity_snapshot")
    )

    if not reserve_rows:
        return

    balances: dict[tuple[str, str], int] = {}
    # Units per case recorded by reservations that also raised reserved_base_units.
    # Older reservations never touched that counter, so they must not lower it.
    base_units_per_case: dict[tuple[str, str], int] = {}
    for row in reserve_rows:
        key = (str(row.get("warehouse_id") or ""), str(row.get("product_id") or ""))
        if not key[0] or not key[1]:
            continue
        qty = _int(row.get("quantity"), 0)
        row_type = str(row.get("type") or "").upper()
        if row_type == "RESERVE":
            balances[key] = balances.get(key, 0) + qty
            if _int(row.get("case_capacity_snapshot"), 0) > 0:
                base_units_per_case[key] = _int(row.get("case_capacity_snapshot"), 0)
        elif row_type in {"UNRESERVE", "RESERVE_CONSUMED"}:
            balances[key] = balances.get(key, 0) - qty

    def _reduce_reserved(inv: Inventory, key: tuple[str, str], qty: int) -> None:
        inv.reserved_quantity = max(0, int(inv.reserved_quantity or 0) - qty)
        inv.reserved_base_units = max(0, int(inv.reserved_base_units or 0) - qty * base_units_per_case.get(key, 0))
        inv.save(update_fields=["reserved_quantity", "reserved_base_units", "updated_at"])

    if operation == "consume":
        remaining = max(0, int(consume_qty or 0))
        for (warehouse_id, product_id), balance in balances.items():
            if remaining <= 0:
                break
            if balance <= 0:
                continue
            qty = min(balance, remaining)
            inv = Inventory.objects.select_for_update().filter(warehouse_id=warehouse_id, product_id=product_id).first()
            if not inv:
                continue
            _reduce_reserved(inv, (warehouse_id, product_id), qty)
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
        inv = Inventory.objects.select_for_update().filter(warehouse_id=warehouse_id, product_id=product_id).first()
        if not inv:
            continue
        _reduce_reserved(inv, (warehouse_id, product_id), balance)
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
    items = list(order.items.select_related("product").prefetch_related("mixed_case_components__product").all())
    for order_item in items:
        # Check for component-level reservations (e.g. Mixed Case items)
        item_reservations = InventoryReservation.objects.filter(order_item=order_item, status=ReservationStatus.RESERVED)
        if item_reservations.exists() or order_item.item_type == OrderItemType.MIXED_CASE:
            allocations = consume_order_item_reservations(order_item, performed_by)
            policy = _extract_allocation_policy_from_notes(order_item.notes) or "FEFO"
            if allocations:
                allocation_note = f"Delivered allocation ({policy}): " + ", ".join(
                    [f"{row['batchNumber']} x{row['quantity']}" for row in allocations]
                )
                order_item.notes = f"{order_item.notes or ''}\n{allocation_note}".strip()
                order_item.save(update_fields=["notes"])
            continue

        if not order_item.product:
            continue

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
        # Released/consumed modern reservations must never fall back to the legacy
        # ledger, whose quantities may be base units rather than cases.
        item_reservations = InventoryReservation.objects.filter(order_item=order_item)
        if item_reservations.exists() or order_item.item_type == OrderItemType.MIXED_CASE:
            release_order_item_reservations(order_item, performed_by)
            continue
        _adjust_reserved_for_order_item(
            order_item=order_item,
            operation="release",
            performed_by=performed_by,
        )


@transaction.atomic
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
    sku_label = getattr(product, "sku", None) or getattr(order_item, "product_sku", None) or getattr(order_item, "product_name", "UNKNOWN")
    if not product:
        raise ValueError(f"No product found for order item {sku_label}")
    if requested_qty <= 0:
        raise ValueError(f"Quantity for product {sku_label} must be greater than zero")

    # Fix: concurrent deliveries must serialize deductions from the same stock.
    inventory_qs = Inventory.objects.select_for_update(of=("self",)).select_related("warehouse").filter(product=product).order_by("id")
    if warehouse_id:
        inventory_qs = inventory_qs.filter(warehouse_id=warehouse_id)

    inventories = list(inventory_qs)
    if not inventories:
        raise ValueError(f"No inventory found for product {sku_label}")

    effective_requested_qty = requested_qty
    replacement_notes = str(getattr(order_item, "notes", "") or "")
    replacement_unit_mode = str(getattr(order, "order_number", "") or "").strip().upper().startswith("RPL-") and "ReplacementUnitMode=BOTTLE" in replacement_notes
    replacement_bottles_from_cases = 0
    replacement_qty_per_case = 1
    replacement_bottle_case_deduction = False
    replacement_bottle_direct_deduction = replacement_unit_mode and _normalize_product_unit(getattr(product, "unit", None)) == "bottle"
    remaining_bottles = 0
    if replacement_unit_mode and _normalize_product_unit(getattr(product, "unit", None)) != "bottle":
        requested_bottles_match = re.search(r"ReplacementRequestedBottles=(\d+)", replacement_notes)
        requested_bottles = _int(requested_bottles_match.group(1), 0) if requested_bottles_match else 0
        qty_per_case = max(1, _int(getattr(product, "quantity_per_unit", 0), 1))
        replacement_qty_per_case = qty_per_case
        if requested_bottles > 0:
            replacement_bottle_case_deduction = True
            remaining_bottles = requested_bottles
            inventories_sorted = sorted(
                inventories,
                key=lambda inv: str(getattr(inv, "warehouse_id", "") or "") != str(warehouse_id or ""),
            )
            loose_consumed_total = 0
            for inventory in inventories_sorted:
                if remaining_bottles <= 0:
                    break
                # Fix: legacy loose allocation must not bypass batch expiry or consume tracked units twice.
                tracked_loose = StockBatch.objects.filter(inventory=inventory).aggregate(total=Sum("loose_units"))["total"] or 0
                loose_available = max(0, int(inventory.loose_bottles or 0) - int(tracked_loose))
                if loose_available <= 0:
                    continue
                consume_loose = min(loose_available, remaining_bottles)
                if consume_loose <= 0:
                    continue
                previous_loose_stock = int(inventory.loose_bottles or 0)
                inventory.loose_bottles = previous_loose_stock - consume_loose
                inventory.save(update_fields=["loose_bottles", "updated_at"])
                InventoryTransaction.objects.create(
                    warehouse=inventory.warehouse,
                    product=product,
                    type="OUT",
                    quantity=consume_loose,
                    quantity_unit=InventoryQuantityUnit.BASE_UNIT,
                    stock_unit_label="Bottle",
                    # Fix: retain the actual loose-stock change shown in transaction details.
                    previous_stock=previous_loose_stock,
                    updated_stock=inventory.loose_bottles,
                    reference_type="order_item",
                    reference_id=order_item.id,
                    notes=f"Replacement bottle allocation from loose stock for order {order.order_number}",
                )
                loose_consumed_total += consume_loose
                remaining_bottles -= consume_loose

            if loose_consumed_total > 0:
                allocation_rows = [
                    {
                        "batchNumber": "LOOSE_BOTTLES",
                        "quantity": loose_consumed_total,
                        "warehouseId": None,
                    }
                ]
            else:
                allocation_rows = []
            effective_requested_qty = int(math.ceil(remaining_bottles / qty_per_case)) if remaining_bottles > 0 else 0
        else:
            allocation_rows = []
    else:
        allocation_rows = []

    if effective_requested_qty <= 0:
        return allocation_rows

    inventory_by_id = {inv.id: inv for inv in inventories}
    batches = list(
        StockBatch.objects.select_for_update(of=("self",)).select_related("inventory")
        .filter(inventory_id__in=list(inventory_by_id.keys()), quantity__gt=0)
        # Fix: legacy reservations and deliveries must exclude expired/quarantined stock.
        .filter(status__iexact="ACTIVE")
        .filter(Q(expiry_date__isnull=True) | Q(expiry_date__gt=timezone.now()))
    )
    if not batches:
        raise ValueError(f"No available stock batches for product {product.sku}")

    ordered_batches = _sorted_batches_for_policy(batches, allocation_policy)
    remaining = effective_requested_qty
    # Fix: several FEFO batches belong to one item movement, not duplicate OUT rows.
    movements: dict[str, dict[str, Any]] = {}

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
        _persist_stock_batch_quantity(batch)

        previous_qty = max(0, int(inventory.quantity or 0))
        inventory.quantity = max(0, previous_qty - take_qty)
        inventory.save(update_fields=["quantity", "updated_at"])
        # Stock transition notifications are centralized in Inventory signals so
        # retail sales, reservations, corrections, and allocations behave alike.

        movement = movements.setdefault(
            inventory.id,
            {
                "inventory": inventory,
                "previous": previous_qty,
                "previous_bottles": (previous_qty * replacement_qty_per_case) + max(0, int(inventory.loose_bottles or 0)),
                "quantity": 0,
                "batches": [],
            },
        )
        movement["quantity"] += take_qty
        movement["batches"].append(batch.batch_number)

        if replacement_bottle_case_deduction and replacement_bottles_from_cases < remaining_bottles:
            # Fix: opening a case for a bottle replacement only removes the
            # requested bottles. The unused containers remain as loose stock.
            case_bottles = take_qty * replacement_qty_per_case
            deducted_bottles = min(case_bottles, remaining_bottles - replacement_bottles_from_cases)
            opened_case_remainder = case_bottles - deducted_bottles
            if opened_case_remainder > 0:
                inventory.loose_bottles = max(0, int(inventory.loose_bottles or 0)) + opened_case_remainder
                inventory.save(update_fields=["loose_bottles", "updated_at"])
            movement["bottle_quantity"] = movement.get("bottle_quantity", 0) + deducted_bottles
            replacement_bottles_from_cases += deducted_bottles

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

    for movement in movements.values():
        inventory = movement["inventory"]
        if replacement_bottle_case_deduction:
            updated_bottles = (max(0, int(inventory.quantity or 0)) * replacement_qty_per_case) + max(0, int(inventory.loose_bottles or 0))
            InventoryTransaction.objects.create(
                warehouse=inventory.warehouse, product=product, type="OUT",
                quantity=max(0, int(movement.get("bottle_quantity", 0))), quantity_unit=InventoryQuantityUnit.BASE_UNIT,
                stock_unit_label="Bottle", previous_stock=movement["previous_bottles"], updated_stock=updated_bottles,
                reference_type="order_item", reference_id=order_item.id, order_item=order_item,
                performed_by=performed_by,
                notes=f"{allocation_policy} bottle allocation for replacement order {order.order_number}; batches {', '.join(movement['batches'])}",
            )
            continue
        if replacement_bottle_direct_deduction:
            # Fix: products stocked directly by the bottle must not inherit the
            # default case label used by normal order allocations.
            InventoryTransaction.objects.create(
                warehouse=inventory.warehouse, product=product, type="OUT",
                quantity=movement["quantity"], quantity_unit=InventoryQuantityUnit.BASE_UNIT,
                stock_unit_label="Bottle", previous_stock=movement["previous"], updated_stock=inventory.quantity,
                reference_type="order_item", reference_id=order_item.id, order_item=order_item,
                performed_by=performed_by,
                notes=f"{allocation_policy} bottle allocation for replacement order {order.order_number}; batches {', '.join(movement['batches'])}",
            )
            continue
        InventoryTransaction.objects.create(
            warehouse=inventory.warehouse, product=product, type="OUT",
            quantity=movement["quantity"], quantity_unit=InventoryQuantityUnit.CASE,
            stock_unit_label="Case", previous_stock=movement["previous"], updated_stock=inventory.quantity,
            reference_type="order_item", reference_id=order_item.id, order_item=order_item,
            performed_by=performed_by,
            notes=f"{allocation_policy} allocation for order {order.order_number}; batches {', '.join(movement['batches'])}",
        )
    return allocation_rows


def _calculate_order_item_weight(item: OrderItem, quantity: int | None = None) -> float:
    """Return the loaded weight for an order line, including mixed-case components."""
    item_quantity = max(0, _int(item.quantity if quantity is None else quantity, 0))
    product = getattr(item, "product", None)
    if product:
        return float(getattr(product, "weight", 0) or 0) * item_quantity

    # Fix: mixed cases have no direct product, so derive their per-case weight
    # from each component's base-unit share of its source product case.
    total_weight = 0.0
    # Reuse prefetched mixed-case rows when trip lists batch-load their orders.
    prefetched_components = getattr(item, "_prefetched_objects_cache", {}).get("mixed_case_components")
    components = prefetched_components if prefetched_components is not None else item.mixed_case_components.select_related("product").all()
    for component in components:
        component_product = getattr(component, "product", None)
        product_weight = float(getattr(component_product, "weight", 0) or 0)
        units_per_case = max(1, _int(getattr(component_product, "quantity_per_unit", 0), 1))
        component_units_per_case = max(0, _int(getattr(component, "quantity_per_case", 0), 0))
        total_weight += (product_weight / units_per_case) * component_units_per_case * item_quantity
    return total_weight


def _calculate_order_load(order: Order) -> tuple[int, float]:
    """Calculate total cases/order units and weight for a delivery order."""
    total_cases = 0
    total_weight = 0.0
    for item in order.items.select_related("product").prefetch_related("mixed_case_components__product").all():
        item_quantity = max(0, _int(item.quantity, 0))
        total_cases += item_quantity
        total_weight += _calculate_order_item_weight(item, item_quantity)
    return total_cases, total_weight


def _calculate_order_weight(order: Order) -> float:
    """Calculate total delivery weight in kilograms for capacity validation."""
    return _calculate_order_load(order)[1]


def _calculate_orders_load_for_warehouse(
    orders: list[Order],
    warehouse_id: str | None,
    allocation_map: dict[str, Any] | None = None,
) -> tuple[int, float]:
    """Calculate only the order quantities assigned to the trip's warehouse leg."""
    order_ids = [str(order.id) for order in orders]
    if allocation_map is None:
        allocation_map = _build_order_item_warehouse_allocations_map(order_ids) if warehouse_id and order_ids else {}
    total_cases = 0
    total_weight = 0.0
    for order in orders:
        allocations_by_item = allocation_map.get(str(order.id), {})
        prefetched_items = getattr(order, "_prefetched_objects_cache", {}).get("items")
        order_items = prefetched_items if prefetched_items is not None else order.items.select_related("product").prefetch_related("mixed_case_components__product").all()
        for item in order_items:
            item_allocations = allocations_by_item.get(str(item.id), [])
            if warehouse_id and item_allocations:
                load_quantity = sum(
                    max(0, _int((allocation or {}).get("allocatedQty"), 0))
                    for allocation in item_allocations
                    if str((allocation or {}).get("warehouseId") or "").strip() == warehouse_id
                )
            else:
                load_quantity = max(0, _int(item.quantity, 0))
            total_cases += load_quantity
            total_weight += _calculate_order_item_weight(item, load_quantity)
    return total_cases, total_weight


def _vehicle_overload_message(vehicle: Vehicle, assigned_weight: float) -> str | None:
    """Build the non-bypassable capacity error using the vehicle's full rated capacity."""
    vehicle_capacity = float(getattr(vehicle, "capacity", 0) or 0)
    if vehicle_capacity <= 0:
        return "Vehicle maximum weight capacity must be configured before creating or updating a trip."
    if assigned_weight <= vehicle_capacity:
        return None
    exceeded_by = assigned_weight - vehicle_capacity
    return (
        f"Vehicle overloaded by {exceeded_by:.2f} kg. Total assigned weight is "
        f"{assigned_weight:.2f} kg, exceeding the vehicle maximum capacity of "
        f"{vehicle_capacity:.2f} kg."
    )
