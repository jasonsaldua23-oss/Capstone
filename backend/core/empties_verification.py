"""Verify the empties a customer declared at checkout against what the driver collects.

At checkout a customer says how many empty containers they will hand over, and that
declaration immediately reduces what they pay: `deposit_refunded` lowers `net_deposit`,
which is part of the order total. Nothing used to check it. A customer could declare
three cases, hand over none, and the system would still record an accepted bottle
return, refund the deposit, and lower their outstanding-bottle count.

This module makes the declaration a claim and the driver's count the fact. The counted
figures settle the deposits, and any shortfall becomes an amount due on the order plus
an audit line on the customer's deposit ledger.
"""

from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any

from django.utils import timezone

from .models import (
    BottleReturn,
    BottleReturnLine,
    ContainerType,
    DepositTransaction,
    MixedCaseComponent,
    Order,
    ProductPackaging,
    TripDropPoint,
)
from .rgb.services import get_or_create_deposit_ledger, process_bottle_return

logger = logging.getLogger(__name__)


def _int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"))


def _resolve_container_type_id(
    item: Any,
    packaging_cache: dict[str, ProductPackaging] | None = None,
) -> str:
    container_type_id = str(getattr(item, "container_type_id", "") or "").strip()
    if container_type_id:
        return container_type_id
    product = getattr(item, "product", None)
    if product is None:
        return ""
    product_id = str(getattr(product, "id", "") or "").strip()
    # Fix: trip endpoints already batch-load packaging, so do not query it once
    # per order item while serializing a page of trips.
    packaging = packaging_cache.get(product_id) if packaging_cache is not None else None
    if packaging_cache is None:
        packaging = ProductPackaging.objects.filter(product=product, is_active=True).first()
    return str(getattr(packaging, "container_type_id", "") or "").strip()


def _containers_per_case(item: Any, packaging_cache: dict[str, ProductPackaging] | None = None) -> int:
    """How many containers a case of this product holds."""
    product = getattr(item, "product", None)
    product_id = str(getattr(item, "product_id", "") or "")
    packaging = packaging_cache.get(product_id) if packaging_cache is not None else None
    if packaging is None and packaging_cache is None and product is not None:
        packaging = ProductPackaging.objects.filter(product=product, is_active=True).first()
    per_case = _int(getattr(packaging, "containers_per_case", 0), 0)
    if per_case <= 0:
        per_case = _int(getattr(item, "case_capacity", 0), 0)
    if per_case <= 0:
        per_case = _int(getattr(product, "quantity_per_unit", 0), 0)
    return max(1, per_case)


def _sold_by_case(item: Any) -> bool:
    return str(getattr(item, "product_unit", "") or "").strip().lower() == "case"


def declared_empties_by_container(
    order: Order | None,
    *,
    packaging_cache: dict[str, ProductPackaging] | None = None,
) -> dict[str, dict[str, Any]]:
    """What the customer said they would hand over, per container type.

    The deposit value per container comes from the order's own figures rather than
    from the container type, so the settlement uses the same numbers the customer
    was actually discounted by at checkout.
    """
    if order is None:
        return {}

    declared: dict[str, dict[str, Any]] = {}

    def _add(
        container_type_id: str,
        quantity: int,
        deposit_value: Decimal,
        name: str,
        *,
        by_case: bool = False,
        containers_per_case: int = 1,
    ) -> None:
        if not container_type_id or quantity <= 0:
            return
        entry = declared.setdefault(
            container_type_id,
            {
                "containerTypeId": container_type_id,
                "containerTypeName": name,
                "declared": 0,
                "depositValue": Decimal("0.00"),
                # A driver hands back cases, not 288 loose bottles, so the count is
                # kept in whatever unit the product was bought in.
                "byCase": by_case,
                "containersPerCase": max(1, containers_per_case),
            },
        )
        entry["declared"] += quantity
        entry["depositValue"] += deposit_value
        if not entry["containerTypeName"] and name:
            entry["containerTypeName"] = name
        # Mixing loose and cased items of the same container falls back to counting
        # the containers themselves, which is the only unit both share.
        if by_case and entry["byCase"] and entry["containersPerCase"] == max(1, containers_per_case):
            entry["byCase"] = True
        elif not by_case:
            entry["byCase"] = False

    prefetched_items = getattr(order, "_prefetched_objects_cache", {}).get("items")
    items = (
        list(prefetched_items)
        if prefetched_items is not None
        else list(order.items.select_related("product").prefetch_related("mixed_case_components__product").all())
    )

    for item in items:
        quantity = max(0, _int(getattr(item, "empty_returned_quantity", 0)))
        if quantity <= 0:
            continue
        per_case = _containers_per_case(item, packaging_cache)
        _add(
            _resolve_container_type_id(item, packaging_cache),
            quantity,
            Decimal(str(getattr(item, "deposit_refunded", 0) or 0)),
            str(getattr(item, "container_type_name", "") or "").strip(),
            by_case=_sold_by_case(item) and per_case > 1 and quantity % per_case == 0,
            containers_per_case=per_case,
        )

    # Fix: reuse mixed-case rows loaded by the trip query. Other callers keep a
    # single batched fallback query for the order.
    prefetched_components: list[MixedCaseComponent] = []
    components_are_prefetched = True
    for item in items:
        cached = getattr(item, "_prefetched_objects_cache", {}).get("mixed_case_components")
        if cached is None:
            components_are_prefetched = False
            break
        prefetched_components.extend(cached)
    components = (
        prefetched_components
        if components_are_prefetched
        else list(
            MixedCaseComponent.objects.filter(
                order_item__order=order, empty_covered_quantity__gt=0
            ).select_related("product")
        )
    )

    for component in components:
        quantity = max(0, _int(getattr(component, "empty_covered_quantity", 0)))
        if quantity <= 0:
            continue
        _add(
            str(getattr(component, "container_type_id", "") or "").strip(),
            quantity,
            Decimal(str(getattr(component, "deposit_total", 0) or 0)),
            str(getattr(component, "container_type_name", "") or "").strip(),
            by_case=False,
            containers_per_case=1,
        )

    missing_name_ids = [
        container_type_id
        for container_type_id, entry in declared.items()
        if not entry["containerTypeName"]
    ]
    container_names = {
        str(container_type.id): str(container_type.name or "Container")
        for container_type in ContainerType.objects.filter(id__in=missing_name_ids)
    } if missing_name_ids else {}

    for container_type_id, entry in declared.items():
        if not entry["containerTypeName"]:
            entry["containerTypeName"] = container_names.get(container_type_id, "Container")
        declared_qty = max(1, entry["declared"])
        entry["depositPerContainer"] = _money(entry["depositValue"] / Decimal(declared_qty))

        per_case = max(1, _int(entry.get("containersPerCase"), 1))
        counts_by_case = bool(entry.get("byCase")) and per_case > 1 and entry["declared"] % per_case == 0
        entry["countsByCase"] = counts_by_case
        entry["containersPerUnit"] = per_case if counts_by_case else 1
        entry["declaredUnits"] = entry["declared"] // entry["containersPerUnit"]
        entry["unitLabel"] = "Case" if counts_by_case else entry["containerTypeName"]

    return declared


def serialize_declared_empties(
    order: Order | None,
    *,
    packaging_cache: dict[str, ProductPackaging] | None = None,
) -> list[dict[str, Any]]:
    """The declared empties in the shape the driver apps consume."""
    return [
        {
            "containerTypeId": entry["containerTypeId"],
            "containerTypeName": entry["containerTypeName"],
            # Containers, which is what the settlement works in.
            "declaredQuantity": entry["declared"],
            # The same declaration in the unit the driver actually handles.
            "declaredUnits": entry["declaredUnits"],
            "containersPerUnit": entry["containersPerUnit"],
            "countsByCase": entry["countsByCase"],
            "unitLabel": entry["unitLabel"],
            "depositPerContainer": float(entry["depositPerContainer"]),
            "depositValue": float(entry["depositValue"]),
        }
        for entry in sorted(
            declared_empties_by_container(order, packaging_cache=packaging_cache).values(),
            key=lambda item: item["containerTypeName"],
        )
    ]


def empties_adjustments_for_orders(order_ids: list[str]) -> dict[str, dict[str, Any]]:
    """The empties charge-back recorded against each of these orders, if any.

    Read in one query so a page of orders does not fan out into one lookup per row.
    """
    cleaned = [str(order_id) for order_id in order_ids if str(order_id or "").strip()]
    if not cleaned:
        return {}

    adjustments: dict[str, dict[str, Any]] = {}
    rows = (
        DepositTransaction.objects.filter(
            order_id__in=cleaned,
            type=DepositTransaction.TransactionType.ADJUSTMENT,
            reference_type="bottle_return",
        )
        .order_by("created_at")
    )
    for row in rows:
        order_key = str(row.order_id)
        entry = adjustments.setdefault(
            order_key,
            {"amount": Decimal("0.00"), "reason": "", "recordedAt": None, "lines": []},
        )
        entry["amount"] += Decimal(str(row.amount or 0))
        entry["reason"] = str(row.reason or "").strip() or entry["reason"]
        entry["recordedAt"] = row.created_at

    container_names = {
        str(container_type.id): str(container_type.name or "Container")
        for container_type in ContainerType.objects.filter(
            id__in=[str(row.container_type_id) for row in rows if row.container_type_id]
        )
    }
    for row in rows:
        entry = adjustments.get(str(row.order_id))
        if entry is None:
            continue
        entry["lines"].append({
            "containerTypeName": container_names.get(str(row.container_type_id), "Container"),
            "shortQuantity": _int(getattr(row, "container_count", 0), 0),
            "amount": float(_money(Decimal(str(row.amount or 0)))),
        })

    return {
        order_id: {
            "amount": float(_money(entry["amount"])),
            "reason": entry["reason"],
            "recordedAt": entry["recordedAt"].isoformat() if entry["recordedAt"] else None,
            "lines": entry["lines"],
        }
        for order_id, entry in adjustments.items()
        if entry["amount"] > 0
    }


def _create_uncollected_return(order: Order, drop_point: TripDropPoint | None, declared: dict[str, dict[str, Any]], received_by: str) -> BottleReturn:
    """Record that empties were declared but none were handed over."""
    year = timezone.now().year
    sequence = BottleReturn.objects.filter(return_number__startswith=f"RTR-{year}-").count() + 1
    return_number = f"RTR-{year}-{str(sequence).zfill(4)}"
    while BottleReturn.objects.filter(return_number=return_number).exists():
        sequence += 1
        return_number = f"RTR-{year}-{str(sequence).zfill(4)}"

    bottle_return = BottleReturn.objects.create(
        return_number=return_number,
        customer=getattr(order, "customer", None),
        order=order,
        trip=getattr(drop_point, "trip", None),
        drop_point=drop_point,
        status=BottleReturn.ReturnStatus.REJECTED,
        received_by=received_by,
        received_at=timezone.now(),
        notes=f"No empty containers were handed over on delivery of {order.order_number}.",
    )
    for entry in declared.values():
        container_type = ContainerType.objects.filter(id=entry["containerTypeId"]).first()
        if container_type is None:
            continue
        BottleReturnLine.objects.create(
            bottle_return=bottle_return,
            container_type=container_type,
            quantity_claimed=0,
            quantity_graded_reusable=0,
            quantity_graded_damaged=0,
            quantity_rejected=0,
            deposit_refund_amount=Decimal("0.00"),
            notes=f"{entry['declared']} declared at checkout, none collected.",
        )
    return bottle_return


def record_collected_empties(
    *,
    order: Order,
    drop_point: TripDropPoint | None,
    submitted_lines: Any,
    performed_by: str | None = None,
    received_by: str | None = None,
) -> dict[str, Any] | None:
    """Settle an order's empties from the driver's count.

    Returns a summary of declared, collected and short quantities, or None when the
    order involves no returnable containers and nothing was collected.
    """
    customer = getattr(order, "customer", None)
    declared = declared_empties_by_container(order)

    counted: dict[str, int] = {}
    for line in submitted_lines or []:
        if not isinstance(line, dict):
            continue
        container_type_id = str(line.get("containerTypeId") or "").strip()
        if not container_type_id:
            continue
        quantity = max(0, _int(line.get("returnedQuantity") or line.get("quantityCollected"), 0))
        counted[container_type_id] = counted.get(container_type_id, 0) + quantity

    if not declared and not any(counted.values()):
        return None

    if customer is None:
        logger.warning("Order %s has no customer; empties cannot be settled", getattr(order, "id", ""))
        return None

    # A stop is settled once. Re-completing a drop point must not refund twice.
    existing = BottleReturn.objects.filter(order=order).order_by("created_at").first()
    if existing is not None:
        return {
            "alreadyRecorded": True,
            "bottleReturnId": existing.id,
            "returnNumber": existing.return_number,
        }

    receiver = str(received_by or performed_by or "Driver").strip() or "Driver"
    return_lines: list[dict[str, Any]] = []
    summary_lines: list[dict[str, Any]] = []
    shortfall_amount = Decimal("0.00")

    container_ids = list(dict.fromkeys(list(declared.keys()) + list(counted.keys())))
    for container_type_id in container_ids:
        entry = declared.get(container_type_id)
        declared_qty = int(entry["declared"]) if entry else 0
        deposit_value = entry["depositValue"] if entry else Decimal("0.00")
        deposit_per_container = entry["depositPerContainer"] if entry else Decimal("0.00")
        submitted_qty = max(0, counted.get(container_type_id, 0))
        # The deposit refunded here is the one charged on this order, so collecting
        # more than was declared cannot pay out more than was taken. Extra empties a
        # customer hands over belong to a separate return, not to this settlement.
        collected_qty = min(submitted_qty, declared_qty) if declared_qty > 0 else submitted_qty
        short_qty = max(0, declared_qty - collected_qty)
        if declared_qty > 0 and short_qty > 0:
            shortfall_amount += _money(deposit_value * Decimal(short_qty) / Decimal(declared_qty))

        container_type = ContainerType.objects.filter(id=container_type_id).first()
        summary_lines.append({
            "submittedQuantity": submitted_qty,
            "containerTypeId": container_type_id,
            "containerTypeName": (entry or {}).get("containerTypeName") or str(getattr(container_type, "name", "") or "Container"),
            "declaredQuantity": declared_qty,
            "collectedQuantity": collected_qty,
            "shortQuantity": short_qty,
        })

        if collected_qty > 0 and container_type is not None:
            note = f"Collected on delivery of {order.order_number}"
            if declared_qty:
                note = f"{note}; {declared_qty} declared at checkout"
            line: dict[str, Any] = {
                "containerTypeId": container_type_id,
                "quantityClaimed": collected_qty,
                "quantityGradedReusable": collected_qty,
                "quantityGradedDamaged": 0,
                "quantityRejected": 0,
                "notes": note,
            }
            if declared_qty > 0 and deposit_value > 0:
                # Refund at the rate the customer was charged on this order, not the
                # container type's standing deposit.
                line["depositPerContainer"] = deposit_value / Decimal(declared_qty)
            elif deposit_per_container > 0:
                line["depositPerContainer"] = deposit_per_container
            return_lines.append(line)

    if return_lines:
        bottle_return = process_bottle_return(
            customer=customer,
            order=order,
            trip=getattr(drop_point, "trip", None),
            drop_point=drop_point,
            lines=return_lines,
            received_by=receiver,
            performed_by=str(performed_by or receiver),
        )
    elif declared:
        bottle_return = _create_uncollected_return(order, drop_point, declared, receiver)
    else:
        return None

    if drop_point is not None:
        drop_point.empties_collected = bool(return_lines)
        drop_point.bottle_return_id = bottle_return.id
        drop_point.save(update_fields=["empties_collected", "bottle_return_id", "updated_at"])

    shortfall_amount = _money(shortfall_amount)
    if shortfall_amount > 0:
        _charge_shortfall(
            order=order,
            customer=customer,
            bottle_return=bottle_return,
            summary_lines=summary_lines,
            shortfall_amount=shortfall_amount,
            performed_by=str(performed_by or receiver),
        )

    return {
        "bottleReturnId": bottle_return.id,
        "returnNumber": bottle_return.return_number,
        "status": bottle_return.status,
        "lines": summary_lines,
        "shortfallAmount": float(shortfall_amount),
        "remainingBalance": float(getattr(order, "remaining_balance", 0) or 0),
    }


def _charge_shortfall(
    *,
    order: Order,
    customer: Any,
    bottle_return: BottleReturn,
    summary_lines: list[dict[str, Any]],
    shortfall_amount: Decimal,
    performed_by: str,
) -> None:
    """Bill back the deposit discount the customer took but did not earn.

    The money is added to the order as an amount still due, so the driver can
    collect it at the door. The ledger entry is an ADJUSTMENT that records the
    discrepancy without moving the deposit balance: the deposit for the containers
    the customer kept was never refunded in the first place, and their outstanding
    bottle count was never reduced for them.
    """
    short_summary = ", ".join(
        f"{line['shortQuantity']} {line['containerTypeName']}"
        for line in summary_lines
        if line["shortQuantity"] > 0
    )

    previous_balance = Decimal(str(getattr(order, "remaining_balance", 0) or 0))
    order.remaining_balance = previous_balance + shortfall_amount
    note_line = (
        f"Empties shortfall on delivery: {short_summary} declared but not handed over. "
        f"PHP {shortfall_amount:,.2f} deposit is due."
    )
    existing_notes = str(getattr(order, "notes", "") or "").strip()
    order.notes = f"{existing_notes}\n{note_line}".strip() if existing_notes else note_line
    order.save(update_fields=["remaining_balance", "notes", "updated_at"])

    ledger = get_or_create_deposit_ledger(customer)
    short_lines = [line for line in summary_lines if line["shortQuantity"] > 0]
    total_short = sum(line["shortQuantity"] for line in short_lines) or 1
    remaining = shortfall_amount

    # One entry per container type, carrying the short count itself, so the portals
    # can show what was charged instead of parsing it back out of a sentence.
    for index, line in enumerate(short_lines):
        if index == len(short_lines) - 1:
            line_amount = remaining
        else:
            line_amount = _money(shortfall_amount * Decimal(line["shortQuantity"]) / Decimal(total_short))
            remaining -= line_amount

        DepositTransaction.objects.create(
            customer=customer,
            ledger=ledger,
            type=DepositTransaction.TransactionType.ADJUSTMENT,
            amount=line_amount,
            balance_before=ledger.balance,
            balance_after=ledger.balance,
            order=order,
            container_type_id=line["containerTypeId"] or None,
            container_count=line["shortQuantity"],
            reason=(
                f"Bottle return {bottle_return.return_number}: {line['shortQuantity']} "
                f"{line['containerTypeName']} of the {line['declaredQuantity']} declared at "
                f"checkout were not handed over. PHP {line_amount:,.2f} added to the amount "
                f"due on order {order.order_number}."
            ),
            reference_type="bottle_return",
            reference_id=bottle_return.id,
            performed_by=performed_by,
        )
