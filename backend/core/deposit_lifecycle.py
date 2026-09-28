from __future__ import annotations

import logging
from collections import defaultdict
from collections.abc import Iterable
from datetime import datetime
from decimal import Decimal
from typing import Any

from django.db import transaction
from django.db.models import Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from .models import (
    BottleReturn,
    BottleReturnLine,
    ContainerType,
    Customer,
    CustomerDepositLedger,
    Inventory,
    InventoryQuantityUnit,
    InventoryTransaction,
    MixedCaseComponent,
    Order,
    OrderItem,
    Product,
    ProductPackaging,
)

logger = logging.getLogger(__name__)


def finalize_order_deposits_on_delivery(order: Order, performed_by: str | None = None) -> None:
    """Close out an order's empties once it has been delivered.

    The settlement itself belongs to the driver's count, recorded through
    `empties_verification.record_collected_empties` while the stop is completed. This
    function only covers the case where no count reached us: it files the declared
    empties as a pending return for the warehouse to reconcile and leaves the
    deposits charged, because a customer's declaration on its own is not evidence
    that any container changed hands.
    """
    customer = getattr(order, "customer", None)
    if not customer:
        return

    used_by_container: dict[str, dict[str, Any]] = {}

    # Standard items
    for item in order.items.select_related("product").all():
        empty_qty = max(0, int(item.empty_returned_quantity or 0))
        if empty_qty <= 0:
            continue
        ct_id = str(item.container_type_id or "").strip()
        if not ct_id and item.product:
            pkg = ProductPackaging.objects.filter(product=item.product, is_active=True).first()
            if pkg and pkg.container_type_id:
                ct_id = str(pkg.container_type_id).strip()
        if not ct_id:
            continue
        if ct_id not in used_by_container:
            ct = ContainerType.objects.filter(id=ct_id).first()
            used_by_container[ct_id] = {
                "containerType": ct,
                "quantity": 0,
                "depositRefunded": Decimal("0.00"),
            }
        used_by_container[ct_id]["quantity"] += empty_qty
        deposit_ref = Decimal(str(item.deposit_refunded or 0))
        used_by_container[ct_id]["depositRefunded"] += deposit_ref

    # Mixed-case components
    for mc in MixedCaseComponent.objects.filter(order_item__order=order, empty_covered_quantity__gt=0).all():
        empty_qty = max(0, int(mc.empty_covered_quantity or 0))
        if empty_qty <= 0:
            continue
        ct_id = str(mc.container_type_id or "").strip()
        if not ct_id:
            continue
        if ct_id not in used_by_container:
            ct = ContainerType.objects.filter(id=ct_id).first()
            used_by_container[ct_id] = {
                "containerType": ct,
                "quantity": 0,
                "depositRefunded": Decimal("0.00"),
            }
        used_by_container[ct_id]["quantity"] += empty_qty
        deposit_ref = Decimal(str(mc.deposit_total or 0))
        used_by_container[ct_id]["depositRefunded"] += deposit_ref

    if not used_by_container:
        return

    # The driver's count settles the empties. If a return was already recorded for
    # this order there is nothing left to do here, whatever its status.
    if BottleReturn.objects.filter(order=order).exists():
        return

    # No count reached us — the order was completed somewhere the driver flow does
    # not run (an admin marking it delivered, or an older client). The customer's
    # declaration alone must never settle money, so the empties are filed as pending
    # for the warehouse to reconcile, with the deposits left charged.
    sequence = BottleReturn.objects.count() + 1
    return_number = f"RET-{timezone.now().year}-{str(sequence).zfill(4)}"
    while BottleReturn.objects.filter(return_number=return_number).exists():
        sequence += 1
        return_number = f"RET-{timezone.now().year}-{str(sequence).zfill(4)}"

    bottle_return = BottleReturn.objects.create(
        return_number=return_number,
        customer=customer,
        order=order,
        status=BottleReturn.ReturnStatus.PENDING,
        received_by=None,
        received_at=None,
        notes=(
            f"Empties declared at checkout for Order {order.order_number} were never "
            "confirmed by a driver. Deposits stay charged until the count is recorded."
        ),
    )

    for ct_id, data in used_by_container.items():
        ct = data["containerType"]
        if not ct:
            continue
        qty = data["quantity"]

        BottleReturnLine.objects.create(
            bottle_return=bottle_return,
            container_type=ct,
            quantity_claimed=qty,
            quantity_graded_reusable=0,
            quantity_graded_damaged=0,
            quantity_rejected=0,
            deposit_refund_amount=Decimal("0.00"),
            notes=f"{qty} declared at checkout of {order.order_number}; not yet verified.",
        )

    logger.warning(
        "Order %s was delivered without a driver empties count; %s pending verification",
        order.order_number,
        bottle_return.return_number,
    )


def record_stockin_empty_consumption(inventory: Inventory, batch: Any, qty: int) -> None:
    """Synchronize the exact product's empty-case consumption for a stock batch."""
    product = inventory.product
    packaging = (
        ProductPackaging.objects.filter(product=product, is_active=True, is_returnable=True)
        .order_by("-is_primary", "created_at")
        .first()
    )
    if not packaging:
        return

    requested_cases = max(0, int(qty or 0))
    containers_per_case = max(1, int(packaging.containers_per_case or 1))
    batch_id = str(getattr(batch, "id", "") or "").strip()
    if not batch_id:
        raise ValueError("A stock batch is required to consume empty cases")

    # Lock this warehouse/product row so simultaneous stock-ins cannot consume
    # the same empty cases.
    locked_inventory = Inventory.objects.select_for_update().select_related("warehouse", "product").get(id=inventory.id)
    existing = (
        InventoryTransaction.objects.select_for_update()
        .filter(
            warehouse=locked_inventory.warehouse,
            product=product,
            type="CONSUME_EMPTY",
            reference_type="stock_batch_empty_consumed",
            reference_id=batch_id,
        )
        .order_by("created_at")
        .first()
    )
    previously_consumed_cases = max(0, int(getattr(existing, "quantity", 0) or 0))
    balance = get_product_empty_case_balance(locked_inventory)
    available_before = balance["availableCases"]

    if requested_cases >= previously_consumed_cases:
        # Fix: consume only the matching empties currently available; any remainder
        # is ordinary new stock and must not block the stock-in operation.
        additional_consumed = min(
            requested_cases - previously_consumed_cases,
            available_before,
        )
        consumed_cases = previously_consumed_cases + additional_consumed
    else:
        # Reducing a batch releases any previously consumed cases above its new size.
        consumed_cases = requested_cases

    consumption_delta = consumed_cases - previously_consumed_cases
    available_after = max(0, available_before - consumption_delta)
    if consumed_cases == 0:
        if existing:
            existing.delete()
        return

    defaults = {
        "quantity": consumed_cases,
        "quantity_unit": InventoryQuantityUnit.CASE,
        "stock_unit_label": "Empty case",
        "previous_stock": available_before,
        "updated_stock": available_after,
        "case_capacity_snapshot": containers_per_case,
        "case_count_snapshot": requested_cases,
        "notes": (
            f"Consumed {consumed_cases} available empty case(s) ({consumed_cases * containers_per_case} bottles) "
            f"for stock-in batch {getattr(batch, 'batch_number', 'N/A')} with {requested_cases} case(s) restocked"
        ),
    }
    if existing:
        for field, value in defaults.items():
            setattr(existing, field, value)
        existing.save(update_fields=[*defaults.keys()])
    else:
        InventoryTransaction.objects.create(
            warehouse=locked_inventory.warehouse,
            product=product,
            type="CONSUME_EMPTY",
            reference_type="stock_batch_empty_consumed",
            reference_id=batch_id,
            **defaults,
        )


_EMPTY_CONSUMED_FOR_STOCK_IN = "stock_batch_empty_consumed"  # quantity is in cases
_EMPTY_RETURNED_TO_SUPPLIER = "manual_empty_return"  # quantity is in bottles


def _no_empty_balance() -> dict[str, int]:
    return {
        "containersPerCase": 0,
        "returnedBottles": 0,
        "consumedCases": 0,
        "availableBottles": 0,
        "availableCases": 0,
        "looseBottles": 0,
    }


def _returnable_containers_per_case(product_ids: set[str]) -> dict[str, int]:
    """Containers per case of each product's returnable packaging, primary first."""
    per_case: dict[str, int] = {}
    packagings = (
        ProductPackaging.objects.filter(product_id__in=product_ids, is_active=True, is_returnable=True)
        .order_by("-is_primary", "created_at")
        .only("product_id", "containers_per_case")
    )
    for packaging in packagings:
        per_case.setdefault(packaging.product_id, max(1, int(packaging.containers_per_case or 1)))
    return per_case


def get_empty_case_balances(inventories: Iterable[Inventory]) -> dict[str, dict[str, int]]:
    """Empties on hand for many inventory rows, keyed by inventory id.

    Five grouped queries for the whole list instead of four per row, so a warehouse's
    inventory can carry its empties into the capacity charts.
    """
    rows = [inventory for inventory in inventories if inventory.product_id and inventory.warehouse_id]
    if not rows:
        return {}
    warehouse_ids = {inventory.warehouse_id for inventory in rows}
    product_ids = {inventory.product_id for inventory in rows}
    per_case = _returnable_containers_per_case(product_ids)

    # Checkout reservations remain customer-only; warehouse empties become
    # available only after the associated order is delivered.
    returned: dict[tuple[str, str], int] = defaultdict(int)
    standard_returned = (
        OrderItem.objects.filter(
            order__status="DELIVERED",
            order__warehouse_id__in=warehouse_ids,
            product_id__in=product_ids,
            empty_returned_quantity__gt=0,
        )
        .exclude(item_type="MIXED_CASE")
        .values("order__warehouse_id", "product_id")
        .annotate(total=Sum("empty_returned_quantity"))
    )
    for row in standard_returned:
        returned[(row["order__warehouse_id"], row["product_id"])] += int(row["total"] or 0)
    mixed_returned = (
        MixedCaseComponent.objects.filter(
            order_item__order__status="DELIVERED",
            order_item__order__warehouse_id__in=warehouse_ids,
            product_id__in=product_ids,
            empty_covered_quantity__gt=0,
        )
        .values("order_item__order__warehouse_id", "product_id")
        .annotate(total=Sum("empty_covered_quantity"))
    )
    for row in mixed_returned:
        returned[(row["order_item__order__warehouse_id"], row["product_id"])] += int(row["total"] or 0)

    consumed_cases: dict[tuple[str, str], int] = defaultdict(int)
    # Fix: outgoing warehouse returns do not change customer return records.
    returned_to_supplier: dict[tuple[str, str], int] = defaultdict(int)
    consumption = (
        InventoryTransaction.objects.filter(
            warehouse_id__in=warehouse_ids,
            product_id__in=product_ids,
            type="CONSUME_EMPTY",
            reference_type__in=[_EMPTY_CONSUMED_FOR_STOCK_IN, _EMPTY_RETURNED_TO_SUPPLIER],
        )
        .values("warehouse_id", "product_id", "reference_type")
        .annotate(total=Sum("quantity"))
    )
    for row in consumption:
        target = consumed_cases if row["reference_type"] == _EMPTY_CONSUMED_FOR_STOCK_IN else returned_to_supplier
        target[(row["warehouse_id"], row["product_id"])] += int(row["total"] or 0)

    balances: dict[str, dict[str, int]] = {}
    for inventory in rows:
        containers_per_case = per_case.get(inventory.product_id)
        if not containers_per_case:
            balances[inventory.id] = _no_empty_balance()
            continue
        key = (inventory.warehouse_id, inventory.product_id)
        returned_bottles = max(0, returned[key])
        consumed = max(0, consumed_cases[key])
        available_bottles = max(0, returned_bottles - (consumed * containers_per_case) - returned_to_supplier[key])
        balances[inventory.id] = {
            "containersPerCase": containers_per_case,
            "returnedBottles": returned_bottles,
            "consumedCases": consumed,
            "availableBottles": available_bottles,
            "availableCases": available_bottles // containers_per_case,
            "looseBottles": available_bottles % containers_per_case,
        }
    return balances


def get_product_empty_case_balance(inventory: Inventory) -> dict[str, int]:
    """Return delivered, consumed, and currently available empties for one product."""
    return get_empty_case_balances([inventory]).get(inventory.id) or _no_empty_balance()


def get_empty_bottle_changes(
    inventories: Iterable[Inventory],
    since: datetime | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """Dated changes to each row's empties, oldest first, keyed by inventory id.

    Returned empties arrive when their order is delivered: the timeline's delivery
    time, or for a walk-in sale (delivered as it is rung up) the sale itself. Empties
    used for a stock-in or sent back to the supplier leave when that is recorded.
    Subtracting the changes after a day from today's balance gives that day's empties,
    which is how the capacity trends stop treating empties as if they never moved.
    """
    rows = [inventory for inventory in inventories if inventory.product_id and inventory.warehouse_id]
    if not rows:
        return {}
    warehouse_ids = {inventory.warehouse_id for inventory in rows}
    product_ids = {inventory.product_id for inventory in rows}
    per_case = _returnable_containers_per_case(product_ids)
    changes: dict[tuple[str, str], dict[datetime, int]] = defaultdict(lambda: defaultdict(int))

    standard_returned = (
        OrderItem.objects.filter(
            order__status="DELIVERED",
            order__warehouse_id__in=warehouse_ids,
            product_id__in=product_ids,
            empty_returned_quantity__gt=0,
        )
        .exclude(item_type="MIXED_CASE")
        .annotate(arrived_at=Coalesce("order__timeline__delivered_at", "order__pod_submitted_at", "order__created_at"))
    )
    mixed_returned = MixedCaseComponent.objects.filter(
        order_item__order__status="DELIVERED",
        order_item__order__warehouse_id__in=warehouse_ids,
        product_id__in=product_ids,
        empty_covered_quantity__gt=0,
    ).annotate(
        arrived_at=Coalesce(
            "order_item__order__timeline__delivered_at",
            "order_item__order__pod_submitted_at",
            "order_item__order__created_at",
        )
    )
    consumption = InventoryTransaction.objects.filter(
        warehouse_id__in=warehouse_ids,
        product_id__in=product_ids,
        type="CONSUME_EMPTY",
        reference_type__in=[_EMPTY_CONSUMED_FOR_STOCK_IN, _EMPTY_RETURNED_TO_SUPPLIER],
    )
    if since is not None:
        standard_returned = standard_returned.filter(arrived_at__gt=since)
        mixed_returned = mixed_returned.filter(arrived_at__gt=since)
        consumption = consumption.filter(created_at__gt=since)

    for warehouse_id, product_id, at, bottles in standard_returned.values_list(
        "order__warehouse_id", "product_id", "arrived_at", "empty_returned_quantity"
    ):
        changes[(warehouse_id, product_id)][at] += int(bottles or 0)
    for warehouse_id, product_id, at, bottles in mixed_returned.values_list(
        "order_item__order__warehouse_id", "product_id", "arrived_at", "empty_covered_quantity"
    ):
        changes[(warehouse_id, product_id)][at] += int(bottles or 0)
    for warehouse_id, product_id, at, reference_type, quantity in consumption.values_list(
        "warehouse_id", "product_id", "created_at", "reference_type", "quantity"
    ):
        bottles = int(quantity or 0)
        if reference_type == _EMPTY_CONSUMED_FOR_STOCK_IN:
            bottles *= per_case.get(product_id, 1)
        changes[(warehouse_id, product_id)][at] -= bottles

    result: dict[str, list[dict[str, Any]]] = {}
    for inventory in rows:
        dated = changes.get((inventory.warehouse_id, inventory.product_id)) or {}
        result[inventory.id] = [
            {"at": at.isoformat(), "bottles": bottles}
            for at, bottles in sorted(dated.items())
            if at is not None and bottles
        ]
    return result
