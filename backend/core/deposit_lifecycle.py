from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any

from django.db import transaction
from django.utils import timezone

from .models import (
    BottleReturn,
    BottleReturnLine,
    ContainerType,
    Customer,
    CustomerBottleBalance,
    CustomerDepositLedger,
    DepositTransaction,
    Inventory,
    InventoryTransaction,
    MixedCaseComponent,
    Order,
    OrderItem,
    Product,
    ProductPackaging,
)

logger = logging.getLogger(__name__)


def finalize_order_deposits_on_delivery(order: Order, performed_by: str | None = None) -> None:
    """
    On successful order delivery:
    1. Permanently settle customer's used empty bottle balances.
    2. Create accepted BottleReturn / transfer physical empties to the destination warehouse.
    3. Log DepositTransaction (REFUND).
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

    # Check if a BottleReturn already exists for this order to prevent duplicates
    if BottleReturn.objects.filter(order=order, status=BottleReturn.ReturnStatus.ACCEPTED).exists():
        return

    sequence = BottleReturn.objects.count() + 1
    return_number = f"RET-{timezone.now().year}-{str(sequence).zfill(4)}"
    while BottleReturn.objects.filter(return_number=return_number).exists():
        sequence += 1
        return_number = f"RET-{timezone.now().year}-{str(sequence).zfill(4)}"

    bottle_return = BottleReturn.objects.create(
        return_number=return_number,
        customer=customer,
        order=order,
        status=BottleReturn.ReturnStatus.ACCEPTED,
        received_by=str(performed_by or "Driver"),
        received_at=timezone.now(),
        notes=f"Empties collected and returned upon delivery of Order {order.order_number}",
    )

    for ct_id, data in used_by_container.items():
        ct = data["containerType"]
        if not ct:
            continue
        qty = data["quantity"]
        deposit_refunded = data["depositRefunded"]

        BottleReturnLine.objects.create(
            bottle_return=bottle_return,
            container_type=ct,
            quantity_claimed=qty,
            quantity_graded_reusable=qty,
            quantity_graded_damaged=0,
            quantity_rejected=0,
            deposit_refund_amount=deposit_refunded,
            notes=f"Returned on delivery of {order.order_number}",
        )

        balance = CustomerBottleBalance.objects.filter(customer=customer, container_type=ct).first()
        if balance:
            balance_before = balance.deposit_balance
            balance.bottles_outstanding = max(0, balance.bottles_outstanding - qty)
            balance.deposit_balance = max(Decimal("0.00"), balance.deposit_balance - deposit_refunded)
            balance.bottles_returned_total += qty
            balance.last_return_at = timezone.now()
            balance.save(update_fields=["bottles_outstanding", "deposit_balance", "bottles_returned_total", "last_return_at", "updated_at"])

            DepositTransaction.objects.create(
                customer=customer,
                type=DepositTransaction.TransactionType.REFUND,
                amount=-deposit_refunded,
                balance_before=balance_before,
                balance_after=balance.deposit_balance,
                order=order,
                container_type=ct,
                container_count=qty,
                reason=f"Empties settled and returned on delivery of Order {order.order_number}",
                reference_type="order",
                reference_id=order.id,
                performed_by=str(performed_by or "Driver"),
            )


def record_stockin_empty_consumption(inventory: Inventory, batch: Any, qty: int) -> None:
    """When staff stocks in returnable beverages, record the required empty cases consumed."""
    product = inventory.product
    pkg = ProductPackaging.objects.filter(product=product, is_active=True).first()
    containers_per_case = max(1, int(pkg.containers_per_case or 1)) if pkg else 24
    is_returnable = bool(pkg and pkg.is_returnable) or str(getattr(product, "packaging_type", "")).upper() == "RETURNABLE"
    if not is_returnable:
        return

    InventoryTransaction.objects.create(
        warehouse=inventory.warehouse,
        product=product,
        type="CONSUME_EMPTY",
        quantity=qty,
        reference_type="stock_batch_empty_consumed",
        reference_id=str(getattr(batch, "id", "")),
        notes=f"Consumed {qty} empty case(s) ({qty * containers_per_case} bottles) for stock-in batch {getattr(batch, 'batch_number', 'N/A')}",
    )
