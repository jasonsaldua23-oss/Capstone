from __future__ import annotations

import math
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone

from .beverage_categories import require_category_spec

from .models import (
    Inventory,
    InventoryQuantityUnit,
    InventoryReservation,
    InventoryTransaction,
    MixedCaseComponent,
    Order,
    OrderItem,
    OrderItemType,
    Product,
    ReservationStatus,
    SalesChannel,
    StockBatch,
)


MONEY = Decimal("0.01")
UNIT_PRICE = Decimal("0.000001")

# A Mixed Case is split between exactly this many products, so no single product
# may take more than its equal share of the case (12 of 24). The retail POS keeps
# its own rules in retail_pos.py; this bound is for online checkout only.
MIXED_CASE_MAX_PRODUCTS = 2


def mixed_case_max_units_per_product(case_capacity: int) -> int:
    return max(0, _int(case_capacity, 0)) // MIXED_CASE_MAX_PRODUCTS


def _int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _money(value: Decimal) -> Decimal:
    return value.quantize(MONEY, rounding=ROUND_HALF_UP)


def _decimal_price(value: Any) -> Decimal:
    try:
        return max(Decimal("0"), Decimal(str(value or 0)))
    except Exception:
        return Decimal("0")


def _positive_whole_number(value: Any, label: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{label} must be a positive whole number")
    try:
        parsed = Decimal(str(value))
    except Exception as exc:
        raise ValueError(f"{label} must be a positive whole number") from exc
    if not parsed.is_finite() or parsed <= 0 or parsed != parsed.to_integral_value():
        raise ValueError(f"{label} must be a positive whole number")
    return int(parsed)


def units_per_case(product: Product) -> int:
    # Product quantity is the source of truth now that profiles are not used.
    return max(1, _int(getattr(product, "quantity_per_unit", 0), 1))


def repack_batch_loose_stock(inventory: Inventory, batch: StockBatch) -> int:
    """Convert full loose quantities within their source batch, preserving units."""
    # Added: use the registered capacity, never assume twelve or merge expiry lots.
    capacity = _int(inventory.product.quantity_per_unit, 0)
    if capacity <= 0:
        return 0
    cases, remainder = divmod(max(0, _int(batch.loose_units, 0)), capacity)
    if not cases:
        return 0
    converted_units = cases * capacity
    if inventory.loose_bottles < converted_units:
        raise ValueError("Batch loose stock exceeds the inventory loose stock")
    batch.quantity += cases
    batch.loose_units = remainder
    inventory.quantity += cases
    inventory.loose_bottles -= converted_units
    return cases


def base_unit_price(product: Product) -> Decimal:
    return (_decimal_price(product.price) / Decimal(units_per_case(product))).quantize(
        UNIT_PRICE,
        rounding=ROUND_HALF_UP,
    )


def _product_size_key(product: Product) -> str:
    """Normalize the product size used to keep mixed-case bottles physically compatible."""
    sizes = getattr(product, "sizes", None)
    if not isinstance(sizes, list):
        return ""
    return "|".join(str(size or "").strip().lower() for size in sizes if str(size or "").strip())


def inventory_base_units(inventory: Inventory, product: Product | None = None) -> int:
    resolved_product = product or inventory.product
    return max(0, _int(inventory.quantity, 0)) * units_per_case(resolved_product) + max(
        0, _int(inventory.loose_bottles, 0)
    )


def available_base_units(inventory: Inventory, product: Product | None = None) -> int:
    """Return stock that the normalized allocator can actually reserve.

    Inventory summary columns include expired/quarantined batches for accounting
    purposes. Checkout must use the same ACTIVE/unexpired batch rules as the
    allocator, otherwise a quote can succeed and the immediately following
    reservation can fail.
    """
    resolved_product = product or inventory.product
    per_case = units_per_case(resolved_product)
    now = timezone.now()

    prefetched_batches = getattr(inventory, "_availability_batches", None)
    batches = list(prefetched_batches) if prefetched_batches is not None else list(
        StockBatch.objects.filter(inventory=inventory)
    )
    prefetched_reservations = getattr(inventory, "_active_reservations", None)
    reservations = (
        list(prefetched_reservations)
        if prefetched_reservations is not None
        else list(
            InventoryReservation.objects.filter(
                inventory=inventory,
                status=ReservationStatus.RESERVED,
            )
        )
    )

    reserved_by_batch: dict[str, int] = {}
    reserved_unbatched = 0
    normalized_reserved_total = 0
    for reservation in reservations:
        reserved_units = max(0, _int(reservation.quantity_base_units, 0))
        normalized_reserved_total += reserved_units
        batch_id = str(reservation.stock_batch_id or "").strip()
        if batch_id:
            reserved_by_batch[batch_id] = reserved_by_batch.get(batch_id, 0) + reserved_units
        else:
            reserved_unbatched += reserved_units

    tracked_loose_units = sum(max(0, _int(batch.loose_units, 0)) for batch in batches)
    allocatable = 0
    for batch in batches:
        is_active = str(batch.status or "").strip().upper() == "ACTIVE"
        is_unexpired = batch.expiry_date is None or batch.expiry_date > now
        if not is_active or not is_unexpired:
            continue
        batch_units = max(0, _int(batch.quantity, 0)) * per_case + max(0, _int(batch.loose_units, 0))
        allocatable += max(0, batch_units - reserved_by_batch.get(batch.id, 0))

    # Legacy unbatched loose stock remains allocatable. Loose units already tied
    # to any batch (including an ineligible batch) must never be counted again.
    unbatched_loose = max(0, _int(inventory.loose_bottles, 0) - tracked_loose_units)
    allocatable += max(0, unbatched_loose - reserved_unbatched)

    # Be conservative if a legacy reservation updated the summary counter but
    # has no normalized InventoryReservation row.
    legacy_reserved = max(
        0,
        _int(inventory.reserved_base_units, 0) - normalized_reserved_total,
    )
    # Legacy movements can leave stale batch units after physical stock was consumed.
    # Never advertise or reserve more than the physical balance after active reservations.
    physical_available = max(
        0,
        inventory_base_units(inventory, resolved_product)
        - normalized_reserved_total
        - legacy_reserved,
    )
    return min(physical_available, max(0, allocatable - legacy_reserved))


def allocatable_standard_cases(inventory: Inventory, product: Product | None = None) -> int:
    """Return full cases that the standard-case allocator can reserve."""
    resolved_product = product or inventory.product
    per_case = units_per_case(resolved_product)
    now = timezone.now()
    prefetched_batches = getattr(inventory, "_availability_batches", None)
    batches = list(prefetched_batches) if prefetched_batches is not None else list(
        StockBatch.objects.filter(inventory=inventory)
    )
    prefetched_reservations = getattr(inventory, "_active_reservations", None)
    reservations = (
        list(prefetched_reservations)
        if prefetched_reservations is not None
        else list(
            InventoryReservation.objects.filter(
                inventory=inventory,
                status=ReservationStatus.RESERVED,
            )
        )
    )
    reserved_by_batch: dict[str, int] = {}
    for reservation in reservations:
        batch_id = str(reservation.stock_batch_id or "").strip()
        if batch_id:
            reserved_by_batch[batch_id] = reserved_by_batch.get(batch_id, 0) + max(
                0, _int(reservation.quantity_base_units, 0)
            )

    available_cases = 0
    for batch in batches:
        is_active = str(batch.status or "").strip().upper() == "ACTIVE"
        is_unexpired = batch.expiry_date is None or batch.expiry_date > now
        if not is_active or not is_unexpired:
            continue
        batch_cases = max(0, _int(batch.quantity, 0))
        batch_units = batch_cases * per_case + max(0, _int(batch.loose_units, 0))
        remaining_units = max(0, batch_units - reserved_by_batch.get(batch.id, 0))
        # Added: the allocator repacks complete loose sets under the stock lock.
        available_cases += min(batch_units // per_case, remaining_units // per_case)

    # Fix: legacy purchase-order reservations can live only in the case counter.
    # Include complete loose sets, which the allocator can repack into cases.
    physical_cases = max(0, _int(inventory.quantity, 0)) + max(0, _int(inventory.loose_bottles, 0)) // per_case
    counter_available = max(0, physical_cases - _int(inventory.reserved_quantity, 0))
    return min(available_cases, available_base_units(inventory, resolved_product) // per_case, counter_available)


def normalize_checkout_items(raw_items: Any) -> tuple[list[dict[str, Any]], Decimal]:
    if not isinstance(raw_items, list) or not raw_items:
        raise ValueError("items are required")

    normalized: list[dict[str, Any]] = []
    subtotal = Decimal("0")
    for raw_item in raw_items:
        item = raw_item if isinstance(raw_item, dict) else {}
        item_type = str(item.get("itemType") or OrderItemType.STANDARD_CASE).strip().upper()
        if item_type == OrderItemType.STANDARD_CASE:
            product_id = str(item.get("productId") or "").strip()
            product = Product.objects.filter(id=product_id, is_active=True).first()
            if product is None:
                raise ValueError(f"Active product not found: {product_id or 'missing product id'}")
            quantity = _positive_whole_number(
                item.get("quantity"),
                f"Quantity for product {product.sku}",
            )
            unit_price = _money(_decimal_price(product.price))
            line_total = _money(unit_price * quantity)
            normalized.append(
                {
                    "itemType": OrderItemType.STANDARD_CASE,
                    "product": product,
                    "productId": product.id,
                    "quantity": quantity,
                    "unitPrice": unit_price,
                    "totalPrice": line_total,
                    "notes": item.get("notes"),
                    "emptyReturnedQuantity": max(0, _int(item.get("emptyReturnedQuantity"), 0)),
                }
            )
            subtotal += line_total
            continue

        if item_type != OrderItemType.MIXED_CASE:
            raise ValueError(f"Unsupported order item type: {item_type}")

        case_capacity = _positive_whole_number(item.get("caseCapacity"), "Mixed Case capacity")
        case_count = _positive_whole_number(
            item.get("quantity", item.get("caseCount")),
            "Mixed Case quantity",
        )
        raw_components = item.get("components")
        if not isinstance(raw_components, list) or len(raw_components) < MIXED_CASE_MAX_PRODUCTS:
            raise ValueError("A Mixed Case must contain at least two different products")
        if len(raw_components) > MIXED_CASE_MAX_PRODUCTS:
            raise ValueError("A Mixed Case can contain only two different products")
        max_units_per_product = mixed_case_max_units_per_product(case_capacity)
        if any(not isinstance(row, dict) for row in raw_components):
            raise ValueError("Every Mixed Case component must be an object")

        product_ids = [str((row or {}).get("productId") or "").strip() for row in raw_components]
        if any(not product_id for product_id in product_ids):
            raise ValueError("Every Mixed Case component must reference a product")
        if len(product_ids) != len(set(product_ids)):
            raise ValueError("A product cannot appear more than once in the same Mixed Case")

        products = {
            product.id: product
            for product in Product.objects.filter(
                id__in=product_ids,
                is_active=True,
            )
        }
        if len(products) != len(product_ids):
            raise ValueError("Deleted, inactive, or Mixed Case-ineligible products cannot be added")

        compatibility_keys: set[str] = set()
        component_size_keys: set[str] = set()
        normalized_components: list[dict[str, Any]] = []
        total_units_per_case = 0
        parent_unit_price = Decimal("0")
        for raw_component in raw_components:
            product_id = str((raw_component or {}).get("productId") or "").strip()
            product = products[product_id]
            category_details = require_category_spec(product.category)
            quantity_per_case = _positive_whole_number(
                raw_component.get("quantity"),
                f"Component quantity for product {product.sku}",
            )
            # Only full cases of carbonated glass bottles can supply a Mixed Case.
            if category_details["category"] != "Carbonated (Glass)" or str(product.unit or "").strip().lower() != "case":
                raise ValueError(f"Product {product.sku} is not eligible for Mixed Case ordering")
            if case_capacity != units_per_case(product):
                raise ValueError(
                    f"Capacity {case_capacity} does not match product {product.sku} case quantity"
                )
            # Added: an equal split is the ceiling per product. 18 + 6 still totals
            # 24, so the total check alone would let one product crowd out the other.
            if quantity_per_case > max_units_per_product:
                raise ValueError(
                    f"A {case_capacity}-unit Mixed Case allows at most {max_units_per_product} units "
                    f"of one product; received {quantity_per_case} of {product.sku}"
                )
            # Mixed-case compatibility follows the product category, never a manually typed profile key.
            compatibility_keys.add(category_details["compatibilityKey"])
            component_size_keys.add(_product_size_key(product))
            total_units_per_case += quantity_per_case
            component_unit_price = base_unit_price(product)
            per_case_subtotal = _money(component_unit_price * quantity_per_case)
            component_subtotal = _money(per_case_subtotal * case_count)
            parent_unit_price += per_case_subtotal
            normalized_components.append(
                {
                    "product": product,
                    "productId": product.id,
                    "quantityPerCase": quantity_per_case,
                    "caseCount": case_count,
                    "totalBaseUnits": quantity_per_case * case_count,
                    "unitPrice": component_unit_price,
                    "perCaseSubtotal": per_case_subtotal,
                    "componentSubtotal": component_subtotal,
                    "baseUnitLabel": category_details["looseUnit"],
                    "emptyReturnedQuantity": max(0, _int(raw_component.get("emptyReturnedQuantity"), 0)),
                }
            )

        if "" in compatibility_keys or len(compatibility_keys) != 1:
            raise ValueError("These products use different packaging types and cannot be combined in the same case.")
        if "" in component_size_keys or len(component_size_keys) != 1:
            raise ValueError("Mixed Case products must use the same bottle size.")
        if total_units_per_case != case_capacity:
            raise ValueError(
                f"Mixed Case components must total exactly {case_capacity} units; received {total_units_per_case}"
            )

        parent_unit_price = _money(parent_unit_price)
        parent_total = _money(parent_unit_price * case_count)
        normalized.append(
            {
                "itemType": OrderItemType.MIXED_CASE,
                "product": None,
                "productId": None,
                "quantity": case_count,
                "caseCapacity": case_capacity,
                "unitPrice": parent_unit_price,
                "totalPrice": parent_total,
                "components": normalized_components,
                "notes": item.get("notes"),
                "emptyReturnedQuantity": max(0, _int(item.get("emptyReturnedQuantity"), 0)),
            }
        )
        subtotal += parent_total

    if not normalized:
        raise ValueError("items are required")
    return normalized, _money(subtotal)


def _sorted_batches(batches: list[StockBatch], policy: str) -> list[StockBatch]:
    if policy == "FIFO":
        return sorted(
            batches,
            key=lambda batch: (batch.receipt_date, batch.created_at, batch.id),
        )
    return sorted(
        batches,
        key=lambda batch: (
            batch.expiry_date is None,
            batch.expiry_date or batch.receipt_date,
            batch.receipt_date,
            batch.created_at,
            batch.id,
        ),
    )


def _active_reserved_by_batch(inventory_id: str) -> tuple[dict[str, int], int]:
    rows = (
        InventoryReservation.objects.filter(inventory_id=inventory_id, status=ReservationStatus.RESERVED)
        .values("stock_batch_id")
        .annotate(total=Sum("quantity_base_units"))
    )
    by_batch: dict[str, int] = {}
    unbatched = 0
    for row in rows:
        quantity = max(0, _int(row.get("total"), 0))
        batch_id = str(row.get("stock_batch_id") or "").strip()
        if batch_id:
            by_batch[batch_id] = quantity
        else:
            unbatched += quantity
    return by_batch, unbatched


def _reserve_product_units(
    *,
    order_item: OrderItem,
    product: Product,
    quantity_base_units: int,
    standard_case_quantity: int | None,
    component: MixedCaseComponent | None,
    allocation_policy: str,
    performed_by: str | None,
) -> list[InventoryReservation]:
    inventory = (
        Inventory.objects.select_for_update(of=("self",))
        .select_related("warehouse", "product")
        .filter(warehouse_id=order_item.order.warehouse_id, product=product)
        .first()
    )
    if inventory is None:
        raise ValueError(f"No inventory found for product {product.sku}")
    if quantity_base_units <= 0:
        raise ValueError(f"Quantity for product {product.sku} must be greater than zero")
    allocatable_units = available_base_units(inventory, product)
    if allocatable_units < quantity_base_units:
        missing = quantity_base_units - allocatable_units
        raise ValueError(
            f"Insufficient allocatable stock (Insufficient stock) for product {product.sku}. "
            f"Missing {missing} base unit(s)"
        )

    batches = list(
        StockBatch.objects.select_for_update(of=("self",))
        .filter(inventory=inventory)
        .filter(status__iexact="ACTIVE")
        .filter(Q(expiry_date__isnull=True) | Q(expiry_date__gt=timezone.now()))
        .filter(Q(quantity__gt=0) | Q(loose_units__gt=0))
    )
    # Added: existing full loose batches become reservable cases on the next sale.
    repacked = False
    for batch in batches:
        if repack_batch_loose_stock(inventory, batch):
            batch.save(update_fields=["quantity", "loose_units", "updated_at"])
            repacked = True
    if repacked:
        inventory.save(update_fields=["quantity", "loose_bottles", "updated_at"])
    if not batches and inventory.loose_bottles <= 0:
        raise ValueError(f"No available stock batches for product {product.sku}")

    reserved_by_batch, reserved_unbatched = _active_reserved_by_batch(inventory.id)
    per_case = units_per_case(product)
    remaining = quantity_base_units
    reservations: list[InventoryReservation] = []
    remaining_standard_cases = max(0, _int(standard_case_quantity, 0))

    for batch in _sorted_batches(batches, allocation_policy):
        if remaining <= 0:
            break
        total_batch_units = max(0, _int(batch.quantity, 0)) * per_case + max(0, _int(batch.loose_units, 0))
        available_units = max(0, total_batch_units - reserved_by_batch.get(batch.id, 0))
        if standard_case_quantity is not None:
            available_cases = min(max(0, _int(batch.quantity, 0)), available_units // per_case)
            take_cases = min(available_cases, remaining_standard_cases)
            take_units = take_cases * per_case
            remaining_standard_cases -= take_cases
        else:
            take_units = min(available_units, remaining)
            take_cases = 0
        if take_units <= 0:
            continue
        reservations.append(
            InventoryReservation.objects.create(
                order_item=order_item,
                mixed_case_component=component,
                inventory=inventory,
                stock_batch=batch,
                product=product,
                quantity_base_units=take_units,
                standard_case_quantity=take_cases or None,
                allocation_policy=allocation_policy,
                status=ReservationStatus.RESERVED,
            )
        )
        remaining -= take_units

    if standard_case_quantity is None and remaining > 0:
        # Aggregate all batch-held loose units, including expired or quarantined
        # batches. Otherwise excluded stock would be misclassified as legacy
        # unbatched stock and become reservable again.
        tracked_loose = max(
            0,
            _int(
                StockBatch.objects.filter(inventory=inventory).aggregate(total=Sum("loose_units"))["total"],
                0,
            ),
        )
        unbatched_loose = max(0, _int(inventory.loose_bottles, 0) - tracked_loose)
        unbatched_available = max(0, unbatched_loose - reserved_unbatched)
        take_units = min(unbatched_available, remaining)
        if take_units > 0:
            reservations.append(
                InventoryReservation.objects.create(
                    order_item=order_item,
                    mixed_case_component=component,
                    inventory=inventory,
                    stock_batch=None,
                    product=product,
                    quantity_base_units=take_units,
                    standard_case_quantity=None,
                    allocation_policy=allocation_policy,
                    status=ReservationStatus.RESERVED,
                )
            )
            remaining -= take_units

    if remaining > 0 or remaining_standard_cases > 0:
        raise ValueError(f"Insufficient allocatable stock for product {product.sku}")

    inventory.reserved_base_units = max(0, _int(inventory.reserved_base_units, 0)) + quantity_base_units
    if standard_case_quantity is not None:
        inventory.reserved_quantity = max(0, _int(inventory.reserved_quantity, 0)) + standard_case_quantity
    inventory.save(update_fields=["reserved_base_units", "reserved_quantity", "updated_at"])

    tx_quantity = standard_case_quantity if standard_case_quantity is not None else quantity_base_units
    quantity_unit = (
        InventoryQuantityUnit.CASE if standard_case_quantity is not None else InventoryQuantityUnit.BASE_UNIT
    )
    stock_unit_label = "Case" if quantity_unit == InventoryQuantityUnit.CASE else require_category_spec(product.category)["looseUnit"]
    stock_snapshot = inventory.quantity if standard_case_quantity is not None else inventory_base_units(inventory, product)
    InventoryTransaction.objects.create(
        warehouse=inventory.warehouse,
        product=product,
        type="RESERVE",
        quantity=tx_quantity,
        quantity_unit=quantity_unit,
        stock_unit_label=stock_unit_label,
        previous_stock=stock_snapshot,
        updated_stock=stock_snapshot,
        reference_type="order_item_reserve",
        reference_id=order_item.id,
        order_item=order_item,
        mixed_case_component=component,
        case_capacity_snapshot=order_item.case_capacity,
        case_count_snapshot=order_item.quantity,
        notes=f"{allocation_policy} reserve for order {order_item.order.order_number}",
    )
    return reservations


@transaction.atomic
def reserve_order_item(order_item: OrderItem, allocation_policy: str, performed_by: str | None) -> None:
    order_item = (
        OrderItem.objects.select_for_update(of=("self",))
        .select_related("order", "product")
        .get(id=order_item.id)
    )
    if InventoryReservation.objects.filter(order_item=order_item).exists():
        raise ValueError("Order item already has inventory reservations")
    policy = "FIFO" if str(allocation_policy or "").strip().upper() == "FIFO" else "FEFO"
    if order_item.item_type == OrderItemType.MIXED_CASE:
        components = list(
            order_item.mixed_case_components.select_related(
                "product",
            ).order_by("product_id", "id")
        )
        if len(components) < 2:
            raise ValueError("A Mixed Case must contain at least two component products")
        for component in components:
            if component.product is None or not component.product.is_active:
                raise ValueError(f"Mixed Case component {component.product_name} is unavailable")
            _reserve_product_units(
                order_item=order_item,
                product=component.product,
                quantity_base_units=component.total_base_units,
                standard_case_quantity=None,
                component=component,
                allocation_policy=policy,
                performed_by=performed_by,
            )
        return

    if order_item.product is None or not order_item.product.is_active:
        raise ValueError(f"Order item {order_item.id} has no active product")
    case_quantity = max(0, _int(order_item.quantity, 0))
    _reserve_product_units(
        order_item=order_item,
        product=order_item.product,
        quantity_base_units=case_quantity * units_per_case(order_item.product),
        standard_case_quantity=case_quantity,
        component=None,
        allocation_policy=policy,
        performed_by=performed_by,
    )


@transaction.atomic
def reserve_base_unit_order_item(
    order_item: OrderItem,
    product: Product,
    quantity_base_units: int,
    allocation_policy: str,
    performed_by: str | None,
) -> None:
    order_item = (
        OrderItem.objects.select_for_update(of=("self",))
        .select_related("order", "product")
        .get(id=order_item.id)
    )
    if InventoryReservation.objects.filter(order_item=order_item).exists():
        raise ValueError("Order item already has inventory reservations")
    policy = "FIFO" if str(allocation_policy or "").strip().upper() == "FIFO" else "FEFO"
    _reserve_product_units(
        order_item=order_item,
        product=product,
        quantity_base_units=max(0, _int(quantity_base_units, 0)),
        standard_case_quantity=None,
        component=None,
        allocation_policy=policy,
        performed_by=performed_by,
    )


def _persist_batch(batch: StockBatch) -> None:
    if _int(batch.quantity, 0) <= 0 and _int(batch.loose_units, 0) <= 0:
        # Keep the source batch as an immutable allocation/return anchor. Normalized
        # reservations protect it, and a later component return must be restored to
        # the exact batch that supplied the order.
        batch.quantity = 0
        batch.loose_units = 0
        batch.status = "DEPLETED"
        batch.save(update_fields=["quantity", "loose_units", "status", "updated_at"])
        return
    batch.status = "ACTIVE"
    batch.save(update_fields=["quantity", "loose_units", "status", "updated_at"])


def _consume_reservation(reservation: InventoryReservation, performed_by: str | None) -> None:
    inventory = (
        Inventory.objects.select_for_update(of=("self",))
        .select_related("warehouse", "product")
        .get(id=reservation.inventory_id)
    )
    product = inventory.product
    batch = None
    if reservation.stock_batch_id:
        batch = StockBatch.objects.select_for_update(of=("self",)).get(id=reservation.stock_batch_id)
        if str(batch.status or "").strip().upper() != "ACTIVE":
            raise ValueError(f"Reserved batch is no longer active for product {product.sku}")
        if batch.expiry_date is not None and batch.expiry_date <= timezone.now():
            raise ValueError(f"Reserved batch has expired for product {product.sku}")

    quantity_units = max(0, _int(reservation.quantity_base_units, 0))
    standard_cases = _int(reservation.standard_case_quantity, 0)
    before_cases = max(0, _int(inventory.quantity, 0))
    before_base_units = inventory_base_units(inventory, product)

    if standard_cases > 0:
        if batch is None or _int(batch.quantity, 0) < standard_cases:
            raise ValueError(f"Reserved standard cases are no longer available for product {product.sku}")
        batch.quantity -= standard_cases
        inventory.quantity -= standard_cases
    else:
        remaining = quantity_units
        if batch is None:
            if _int(inventory.loose_bottles, 0) < remaining:
                raise ValueError(f"Reserved loose stock is no longer available for product {product.sku}")
            inventory.loose_bottles -= remaining
            remaining = 0
        else:
            take_loose = min(max(0, _int(batch.loose_units, 0)), remaining)
            if take_loose > 0:
                batch.loose_units -= take_loose
                inventory.loose_bottles -= take_loose
                remaining -= take_loose
            if remaining > 0:
                per_case = units_per_case(product)
                cases_to_open = int(math.ceil(remaining / per_case))
                if _int(batch.quantity, 0) < cases_to_open:
                    raise ValueError(f"Reserved batch stock is no longer available for product {product.sku}")
                batch.quantity -= cases_to_open
                inventory.quantity -= cases_to_open
                generated_units = cases_to_open * per_case
                leftover = generated_units - remaining
                batch.loose_units += leftover
                inventory.loose_bottles += leftover
                remaining = 0

    if inventory.quantity < 0 or inventory.loose_bottles < 0:
        raise ValueError(f"Inventory would become negative for product {product.sku}")

    inventory.reserved_base_units = max(0, _int(inventory.reserved_base_units, 0) - quantity_units)
    if standard_cases > 0:
        inventory.reserved_quantity = max(0, _int(inventory.reserved_quantity, 0) - standard_cases)
    inventory.save(
        update_fields=[
            "quantity",
            "loose_bottles",
            "reserved_quantity",
            "reserved_base_units",
            "updated_at",
        ]
    )
    if batch is not None:
        _persist_batch(batch)

    reservation.status = ReservationStatus.CONSUMED
    reservation.consumed_at = timezone.now()
    reservation.save(update_fields=["status", "consumed_at"])

    quantity_unit = InventoryQuantityUnit.CASE if standard_cases > 0 else InventoryQuantityUnit.BASE_UNIT
    tx_quantity = standard_cases if standard_cases > 0 else quantity_units
    is_retail_sale = reservation.order_item.order.sales_channel == SalesChannel.RETAIL_POS
    stock_unit_label = "Case" if quantity_unit == InventoryQuantityUnit.CASE else require_category_spec(product.category)["looseUnit"]
    # Fix: batch reservations for one item/unit share one physical movement.
    # The inventory lock above serializes this lookup with concurrent consumers;
    # reservation status still controls whether stock may be deducted at all.
    existing_movement = InventoryTransaction.objects.filter(
        warehouse=inventory.warehouse, product=product, type="OUT",
        order_item_id=reservation.order_item_id,
        mixed_case_component_id=reservation.mixed_case_component_id,
        quantity_unit=quantity_unit,
        reference_type="retail_sale" if is_retail_sale else ("mixed_case_component" if reservation.mixed_case_component_id else "order_item"),
    ).first()
    if existing_movement:
        existing_movement.quantity += tx_quantity
        existing_movement.updated_stock = inventory.quantity if standard_cases > 0 else inventory_base_units(inventory, product)
        existing_movement.save(update_fields=["quantity", "updated_stock"])
        return
    InventoryTransaction.objects.create(
        warehouse=inventory.warehouse,
        product=product,
        type="OUT",
        quantity=tx_quantity,
        quantity_unit=quantity_unit,
        stock_unit_label=stock_unit_label,
        previous_stock=before_cases if standard_cases > 0 else before_base_units,
        updated_stock=inventory.quantity if standard_cases > 0 else inventory_base_units(inventory, product),
        # POS movements keep the retail transaction as their searchable audit reference.
        reference_type=("retail_sale" if is_retail_sale else ("mixed_case_component" if reservation.mixed_case_component_id else "order_item")),
        reference_id=(reservation.order_item.order_id if is_retail_sale else (reservation.mixed_case_component_id or reservation.order_item_id)),
        order_item_id=reservation.order_item_id,
        mixed_case_component_id=reservation.mixed_case_component_id,
        case_capacity_snapshot=reservation.order_item.case_capacity,
        case_count_snapshot=reservation.order_item.quantity,
        notes=f"{reservation.allocation_policy} {'retail sale' if is_retail_sale else 'delivery allocation for order'} {reservation.order_item.order.order_number}",
    )


@transaction.atomic
def consume_order_reservations(order: Order, performed_by: str | None) -> None:
    reservations = list(
        InventoryReservation.objects.select_for_update(of=("self",))
        .select_related("order_item__order", "mixed_case_component")
        .filter(order_item__order=order, status=ReservationStatus.RESERVED)
        .order_by("inventory_id", "stock_batch_id", "id")
    )
    expected_item_ids = set(order.items.values_list("id", flat=True))
    reserved_item_ids = {reservation.order_item_id for reservation in reservations}
    if expected_item_ids and expected_item_ids != reserved_item_ids:
        missing = sorted(expected_item_ids - reserved_item_ids)
        raise ValueError(f"Order reservations are incomplete for item(s): {', '.join(missing)}")
    for reservation in reservations:
        _consume_reservation(reservation, performed_by)


@transaction.atomic
def consume_order_item_reservations(order_item: OrderItem, performed_by: str | None) -> list[dict[str, Any]]:
    reservations = list(
        InventoryReservation.objects.select_for_update(of=("self",))
        .select_related("inventory__warehouse", "inventory__product", "stock_batch", "mixed_case_component")
        .filter(order_item=order_item, status=ReservationStatus.RESERVED)
        .order_by("inventory_id", "stock_batch_id", "id")
    )
    allocations: list[dict[str, Any]] = []
    for reservation in reservations:
        _consume_reservation(reservation, performed_by)
        batch_num = reservation.stock_batch.batch_number if reservation.stock_batch else "LOOSE_BOTTLES"
        allocations.append({
            "batchNumber": batch_num,
            "quantity": reservation.quantity_base_units,
            "warehouseId": reservation.inventory.warehouse_id if reservation.inventory else None,
        })
    return allocations


@transaction.atomic
def release_order_item_reservations(order_item: OrderItem, performed_by: str | None) -> None:
    reservations = list(
        InventoryReservation.objects.select_for_update(of=("self",))
        .select_related("inventory__warehouse", "inventory__product", "order_item__order")
        .filter(order_item=order_item, status=ReservationStatus.RESERVED)
        .order_by("inventory_id", "stock_batch_id", "id")
    )
    for reservation in reservations:
        inventory = Inventory.objects.select_for_update(of=("self",)).get(id=reservation.inventory_id)
        quantity_units = max(0, _int(reservation.quantity_base_units, 0))
        standard_cases = max(0, _int(reservation.standard_case_quantity, 0))
        inventory.reserved_base_units = max(0, _int(inventory.reserved_base_units, 0) - quantity_units)
        if standard_cases > 0:
            inventory.reserved_quantity = max(0, _int(inventory.reserved_quantity, 0) - standard_cases)
        inventory.save(update_fields=["reserved_base_units", "reserved_quantity", "updated_at"])
        reservation.status = ReservationStatus.RELEASED
        reservation.released_at = timezone.now()
        reservation.save(update_fields=["status", "released_at"])
        InventoryTransaction.objects.create(
            warehouse=inventory.warehouse,
            product=inventory.product,
            type="UNRESERVE",
            quantity=standard_cases if standard_cases > 0 else quantity_units,
            quantity_unit=(
                InventoryQuantityUnit.CASE if standard_cases > 0 else InventoryQuantityUnit.BASE_UNIT
            ),
            stock_unit_label=(
                "Case" if standard_cases > 0 else require_category_spec(inventory.product.category)["looseUnit"]
            ),
            reference_type="order_item_reserve",
            reference_id=reservation.order_item_id,
            order_item_id=reservation.order_item_id,
            mixed_case_component_id=reservation.mixed_case_component_id,
            case_capacity_snapshot=reservation.order_item.case_capacity,
            case_count_snapshot=reservation.order_item.quantity,
            notes="Reserved quantity released on cancellation",
            performed_by=performed_by,
        )


@transaction.atomic
def release_order_reservations(order: Order, performed_by: str | None) -> None:
    reservations = list(
        InventoryReservation.objects.select_for_update(of=("self",))
        .select_related("inventory__warehouse", "inventory__product", "order_item__order")
        .filter(order_item__order=order, status=ReservationStatus.RESERVED)
        .order_by("inventory_id", "stock_batch_id", "id")
    )
    for reservation in reservations:
        inventory = Inventory.objects.select_for_update(of=("self",)).get(id=reservation.inventory_id)
        quantity_units = max(0, _int(reservation.quantity_base_units, 0))
        standard_cases = max(0, _int(reservation.standard_case_quantity, 0))
        inventory.reserved_base_units = max(0, _int(inventory.reserved_base_units, 0) - quantity_units)
        if standard_cases > 0:
            inventory.reserved_quantity = max(0, _int(inventory.reserved_quantity, 0) - standard_cases)
        inventory.save(update_fields=["reserved_base_units", "reserved_quantity", "updated_at"])
        reservation.status = ReservationStatus.RELEASED
        reservation.released_at = timezone.now()
        reservation.save(update_fields=["status", "released_at"])
        InventoryTransaction.objects.create(
            warehouse=inventory.warehouse,
            product=inventory.product,
            type="UNRESERVE",
            quantity=standard_cases if standard_cases > 0 else quantity_units,
            quantity_unit=(
                InventoryQuantityUnit.CASE if standard_cases > 0 else InventoryQuantityUnit.BASE_UNIT
            ),
            stock_unit_label=(
                "Case" if standard_cases > 0 else require_category_spec(inventory.product.category)["looseUnit"]
            ),
            reference_type="order_item_reserve",
            reference_id=reservation.order_item_id,
            order_item_id=reservation.order_item_id,
            mixed_case_component_id=reservation.mixed_case_component_id,
            case_capacity_snapshot=reservation.order_item.case_capacity,
            case_count_snapshot=reservation.order_item.quantity,
            notes="Reserved quantity released on cancellation",
            performed_by=performed_by,
        )


def serialize_mixed_component(component: MixedCaseComponent) -> dict[str, Any]:
    product = component.product
    return {
        "id": component.id,
        "productId": component.product_id,
        "productName": component.product_name,
        "productSku": component.product_sku,
        "baseUnitLabel": component.base_unit_label,
        "quantityPerCase": component.quantity_per_case,
        "caseCount": component.case_count,
        "totalBaseUnits": component.total_base_units,
        "unitPrice": float(component.unit_price),
        "componentSubtotal": float(component.component_subtotal),
        "containerTypeId": component.container_type_id,
        "containerTypeName": component.container_type_name,
        "depositPerUnit": float(component.deposit_per_unit),
        "depositTotal": float(component.deposit_total),
        "emptyCoveredQuantity": component.empty_covered_quantity,
        "product": (
            {
                "id": product.id,
                "name": product.name,
                "sku": product.sku,
                "imageUrl": product.image_url,
                "category": product.category,
                "sizes": product.sizes,
                "isActive": product.is_active,
            }
            if product
            else None
        ),
    }
