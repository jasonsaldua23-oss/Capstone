from __future__ import annotations

import math
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone

from ..beverage_categories import category_spec

from ..models import (
    BottleReturn,
    BottleReturnLine,
    ContainerType,
    Customer,
    CustomerBottleBalance,
    CustomerDepositLedger,
    DepositTransaction,
    Inventory,
    InventoryQuantityUnit,
    InventoryTransaction,
    MixedCaseComponent,
    Order,
    OrderItem,
    Product,
    ProductPackaging,
    TripDropPoint,
)

MONEY = Decimal("0.01")


def _money(value: Decimal) -> Decimal:
    return value.quantize(MONEY, rounding=ROUND_HALF_UP)


def _int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def get_or_create_deposit_ledger(customer: Customer) -> CustomerDepositLedger:
    """Get or create a deposit ledger for a customer."""
    ledger, _ = CustomerDepositLedger.objects.get_or_create(
        customer=customer,
        defaults={"balance": Decimal("0"), "currency": "PHP"},
    )
    return ledger


def get_or_create_bottle_balance(
    customer: Customer, container_type: ContainerType
) -> CustomerBottleBalance:
    """Get or create a bottle balance record for a customer + container type."""
    balance, _ = CustomerBottleBalance.objects.get_or_create(
        customer=customer,
        container_type=container_type,
        defaults={
            "bottles_outstanding": 0,
            "bottles_returned_total": 0,
            "bottles_sold_total": 0,
        },
    )
    return balance


def get_customer_bottle_balances(customer: Customer) -> list[dict[str, Any]]:
    """Get all bottle balances for a customer, serialized with reservation tracking."""
    # Compute active reserved empty containers across pending/in-progress orders
    active_order_items = (
        OrderItem.objects.filter(
            order__customer=customer,
            empty_returned_quantity__gt=0,
        )
        .exclude(order__status__in=["CANCELLED", "CANCELED", "REJECTED", "DELIVERED", "COMPLETED", "FAILED", "FAILED_DELIVERY"])
        .exclude(order__request_status__in=["REJECTED", "CANCELLED"])
        .select_related("product", "order")
    )
    active_mc_components = (
        MixedCaseComponent.objects.filter(
            order_item__order__customer=customer,
            empty_covered_quantity__gt=0,
        )
        .exclude(order_item__order__status__in=["CANCELLED", "CANCELED", "REJECTED", "DELIVERED", "COMPLETED", "FAILED", "FAILED_DELIVERY"])
        .exclude(order_item__order__request_status__in=["REJECTED", "CANCELLED"])
        .select_related("order_item__order")
    )
    reserved_by_container: dict[str, int] = {}
    for item in active_order_items:
        ct_id = item.container_type_id
        if not ct_id and item.product:
            pkg = ProductPackaging.objects.filter(product=item.product, is_active=True).first()
            if pkg:
                ct_id = pkg.container_type_id
        if ct_id:
            ct_key = str(ct_id)
            reserved_by_container[ct_key] = reserved_by_container.get(ct_key, 0) + max(0, int(item.empty_returned_quantity or 0))

    for mc in active_mc_components:
        ct_id = mc.container_type_id
        if ct_id:
            ct_key = str(ct_id)
            reserved_by_container[ct_key] = reserved_by_container.get(ct_key, 0) + max(0, int(mc.empty_covered_quantity or 0))

    balances = list(CustomerBottleBalance.objects.filter(customer=customer).select_related("container_type"))
    balance_container_ids = [str(balance.container_type_id) for balance in balances]

    # Fix: balances are grouped by reusable container, but declarations are made
    # for a specific product. Recover that product instead of listing every item
    # in the catalog that happens to use the same bottle type.
    declared_product_ids_by_container: dict[str, list[str]] = {}
    legacy_product_names_by_container: dict[str, list[str]] = {}
    declaration_transactions = DepositTransaction.objects.filter(
        customer=customer,
        type=DepositTransaction.TransactionType.ADJUSTMENT,
        container_type_id__in=balance_container_ids,
        reason__startswith="Customer declared ",
    ).order_by("created_at")
    for transaction in declaration_transactions:
        container_key = str(transaction.container_type_id)
        if transaction.reference_type == "product" and transaction.reference_id:
            declared_product_ids_by_container.setdefault(container_key, []).append(str(transaction.reference_id))
            continue
        reason = str(transaction.reason or "")
        if " of " in reason:
            legacy_product_names_by_container.setdefault(container_key, []).append(reason.rsplit(" of ", 1)[-1].strip())

    declared_product_ids = {
        product_id
        for product_ids in declared_product_ids_by_container.values()
        for product_id in product_ids
    }
    legacy_product_names = {
        name
        for names in legacy_product_names_by_container.values()
        for name in names
        if name
    }
    declared_products = list(
        Product.objects.filter(Q(id__in=declared_product_ids) | Q(name__in=legacy_product_names))
        .select_related("packaging_profile")
    ) if declared_product_ids or legacy_product_names else []
    products_by_id = {str(product.id): product for product in declared_products}
    products_by_name: dict[str, list[Product]] = {}
    for product in declared_products:
        products_by_name.setdefault(str(product.name), []).append(product)

    serialized = []
    for balance in balances:
        associated_packagings = list(
            ProductPackaging.objects.filter(container_type=balance.container_type, is_active=True)
            .select_related("product", "product__packaging_profile", "packaging_profile")
            .order_by("-is_primary", "created_at")
        )
        container_key = str(balance.container_type_id)
        exact_products: list[Product] = []
        for product_id in declared_product_ids_by_container.get(container_key, []):
            product = products_by_id.get(product_id)
            if product and product not in exact_products:
                exact_products.append(product)
        for product_name in legacy_product_names_by_container.get(container_key, []):
            for product in products_by_name.get(product_name, []):
                if product not in exact_products:
                    exact_products.append(product)
        if not exact_products:
            exact_products = [
                packaging.product
                for packaging in associated_packagings
                if packaging.product
            ]

        prod_names = list(dict.fromkeys(
            product.name for product in exact_products if product.name
        ))
        product_labels: list[str] = []
        for product in exact_products:
            if not product or not str(product.name or "").strip():
                continue
            sizes = [str(size).strip() for size in (product.sizes or []) if str(size).strip()]
            if not sizes:
                profile = product.packaging_profile
                profile_size = str(getattr(profile, "container_size", "") or "").strip()
                if profile_size:
                    sizes = [profile_size]
            size_label = ", ".join(sizes)
            exact_label = f"{product.name} - {size_label}" if size_label else str(product.name)
            if exact_label not in product_labels:
                product_labels.append(exact_label)
        primary_packaging = associated_packagings[0] if associated_packagings else None
        containers_per_case = max(1, int(primary_packaging.containers_per_case or 1)) if primary_packaging else 1
        
        total_bottles = max(0, int(balance.bottles_outstanding or 0))
        bottles_reserved = max(0, reserved_by_container.get(str(balance.container_type_id), 0))
        bottles_available = max(0, total_bottles - bottles_reserved)

        cases_total, loose_bottles_total = divmod(total_bottles, containers_per_case)
        cases_available, loose_bottles_available = divmod(bottles_available, containers_per_case)
        cases_reserved, loose_bottles_reserved = divmod(bottles_reserved, containers_per_case)

        unit_deposit = float(balance.container_type.deposit_amount or 0)
        case_deposit = float(primary_packaging.case_deposit_amount or 0) if primary_packaging else (unit_deposit * containers_per_case)
        deposit_available = float((cases_available * case_deposit) + (loose_bottles_available * unit_deposit))
        deposit_reserved = float((cases_reserved * case_deposit) + (loose_bottles_reserved * unit_deposit))

        serialized.append({
            "containerTypeId": balance.container_type_id,
            "containerTypeName": balance.container_type.name,
            "containerTypeCode": balance.container_type.code,
            "productName": ", ".join(prod_names) if prod_names else None,
            "productNames": prod_names,
            # Exact stored product names and sizes for the customer portal.
            "productLabel": " · ".join(product_labels) if product_labels else None,
            "productLabels": product_labels,
            "bottlesOutstanding": bottles_available,
            "bottlesTotalOnRecord": total_bottles,
            "bottlesReserved": bottles_reserved,
            "casesReserved": cases_reserved,
            "looseBottlesReserved": loose_bottles_reserved,
            "depositReserved": deposit_reserved,
            "bottlesAvailable": bottles_available,
            "casesAvailable": cases_available,
            "looseBottlesAvailable": loose_bottles_available,
            "depositAvailable": deposit_available,
            "depositAmount": unit_deposit,
            "containersPerCase": containers_per_case,
            "casesOutstanding": cases_available,
            "casesTotalOnRecord": cases_total,
            "looseBottlesOutstanding": loose_bottles_available,
            "caseDepositAmount": case_deposit,
            "depositBalance": deposit_available,
            "depositBalanceTotal": float(balance.deposit_balance),
            "bottlesReturnedTotal": balance.bottles_returned_total,
            "bottlesSoldTotal": balance.bottles_sold_total,
            "lastReturnAt": balance.last_return_at.isoformat() if balance.last_return_at else None,
        })
    return serialized
def get_deposit_ledger_transactions(
    customer: Customer, limit: int = 50
) -> list[dict[str, Any]]:
    """Get recent deposit transactions for a customer."""
    txs = (
        DepositTransaction.objects.filter(customer=customer)
        .select_related("container_type", "order")
        .order_by("-created_at")[:limit]
    )
    return [
        {
            "id": t.id,
            "type": t.type,
            "amount": float(t.amount),
            "balanceBefore": float(t.balance_before),
            "balanceAfter": float(t.balance_after),
            "containerTypeName": t.container_type.name if t.container_type else None,
            "containerCount": t.container_count,
            "orderNumber": t.order.order_number if t.order else None,
            "reason": t.reason,
            "performedBy": t.performed_by,
            "createdAt": t.created_at.isoformat(),
        }
        for t in txs
    ]


def calculate_deposit_for_order_item(
    product: Product,
    full_quantity: int,
    empty_returned_quantity: int,
) -> dict[str, Any]:
    """Calculate deposit amounts for a single order line item.

    Returns deposit info including the ProductPackaging to use.
    """
    product_spec = category_spec(product.category)
    # Alcohol uses glass packaging but is completely excluded from deposit accounting.
    if product_spec and product_spec["depositExempt"]:
        return {
            "is_returnable": False,
            "containerTypeId": None,
            "containerTypeName": None,
            "depositPerUnit": Decimal("0"),
            "depositCharged": Decimal("0"),
            "depositRefunded": Decimal("0"),
            "netDeposit": Decimal("0"),
            "depositStatus": "Exempt",
        }

    packaging = (
        ProductPackaging.objects.filter(
            product=product,
            is_returnable=True,
            is_active=True,
        )
        .select_related("container_type")
        .first()
    )

    if not packaging:
        return {
            "is_returnable": False,
            "containerTypeId": None,
            "containerTypeName": None,
            "depositPerUnit": Decimal("0"),
            "depositCharged": Decimal("0"),
            "depositRefunded": Decimal("0"),
            "netDeposit": Decimal("0"),
        }

    deposit_per_unit = packaging.deposit_amount
    deposit_charged = _money(deposit_per_unit * Decimal(full_quantity))
    deposit_refunded = _money(deposit_per_unit * Decimal(empty_returned_quantity))
    net_deposit = _money(deposit_charged - deposit_refunded)

    return {
        "is_returnable": True,
        "containerTypeId": packaging.container_type_id,
        "containerTypeName": packaging.container_type.name,
        "depositPerUnit": float(deposit_per_unit),
        "depositCharged": float(deposit_charged),
        "depositRefunded": float(deposit_refunded),
        "netDeposit": float(net_deposit),
        "packaging": {
            "id": packaging.id,
            "containersPerCase": packaging.containers_per_case,
            "unitsPerContainer": packaging.units_per_container,
        },
    }


@transaction.atomic
def process_order_deposits(
    order: Order,
    performed_by: str | None = None,
) -> list[DepositTransaction]:
    """Process all deposit transactions for an order.

    Called after order creation for RGB items. Creates CHARGE and REFUND
    transactions and updates customer balances.
    """
    customer = order.customer
    ledger = get_or_create_deposit_ledger(customer)
    transactions: list[DepositTransaction] = []

    order_items = OrderItem.objects.filter(order=order).select_related("product")

    for item in order_items:
        product_spec = category_spec(getattr(getattr(item, "product", None), "category", None))
        if product_spec and product_spec["depositExempt"]:
            continue
        if not item.is_returnable_item:
            continue

        container_type_id = item.container_type_id
        if not container_type_id:
            continue

        container_type = ContainerType.objects.filter(id=container_type_id).first()
        if not container_type:
            continue

        full_qty = max(0, _int(item.full_quantity, 0))
        empty_returned = max(0, _int(item.empty_returned_quantity, 0))
        deposit_per_unit = Decimal(str(item.deposit_per_unit or "0"))

        # CHARGE for full containers delivered
        if full_qty > 0 and deposit_per_unit > 0:
            charge_amount = _money(deposit_per_unit * Decimal(full_qty))
            balance_before = ledger.balance
            ledger.balance += charge_amount
            ledger.save(update_fields=["balance", "last_transaction_at", "updated_at"])

            tx = DepositTransaction.objects.create(
                customer=customer,
                ledger=ledger,
                type=DepositTransaction.TransactionType.CHARGE,
                amount=charge_amount,
                balance_before=balance_before,
                balance_after=ledger.balance,
                order=order,
                order_item=item,
                container_type=container_type,
                container_count=full_qty,
                reason=f"Deposit charge for {full_qty} {container_type.name}(s) — Order {order.order_number}",
                reference_type="order",
                reference_id=order.id,
                performed_by=performed_by,
            )
            transactions.append(tx)

        # REFUND for empties returned
        if empty_returned > 0 and deposit_per_unit > 0:
            refund_amount = _money(deposit_per_unit * Decimal(empty_returned))
            balance_before = ledger.balance
            ledger.balance -= refund_amount
            ledger.save(update_fields=["balance", "last_transaction_at", "updated_at"])

            tx = DepositTransaction.objects.create(
                customer=customer,
                ledger=ledger,
                type=DepositTransaction.TransactionType.REFUND,
                amount=-refund_amount,
                balance_before=balance_before,
                balance_after=ledger.balance,
                order=order,
                order_item=item,
                container_type=container_type,
                container_count=empty_returned,
                reason=f"Deposit refund for {empty_returned} {container_type.name}(s) returned — Order {order.order_number}",
                reference_type="order",
                reference_id=order.id,
                performed_by=performed_by,
            )
            transactions.append(tx)

        # Update bottle balance
        bottle_balance = get_or_create_bottle_balance(customer, container_type)
        bottle_balance.bottles_outstanding = max(
            0,
            bottle_balance.bottles_outstanding + full_qty - empty_returned,
        )
        bottle_balance.bottles_sold_total += full_qty
        bottle_balance.bottles_returned_total += empty_returned
        if empty_returned > 0:
            bottle_balance.last_return_at = timezone.now()
        bottle_balance.save(
            update_fields=[
                "bottles_outstanding",
                "bottles_sold_total",
                "bottles_returned_total",
                "last_return_at",
                "updated_at",
            ]
        )

    ledger.last_transaction_at = timezone.now()
    ledger.save(update_fields=["last_transaction_at", "updated_at"])

    return transactions


@transaction.atomic
def reverse_order_deposits(
    order: Order,
    performed_by: str | None = None,
) -> list[DepositTransaction]:
    """Reverse all deposit transactions for a cancelled order."""
    customer = order.customer
    ledger = get_or_create_deposit_ledger(customer)
    reversal_transactions: list[DepositTransaction] = []

    original_txs = DepositTransaction.objects.filter(
        order=order,
        type__in=[
            DepositTransaction.TransactionType.CHARGE,
            DepositTransaction.TransactionType.REFUND,
        ],
    ).select_related("container_type", "order_item")

    for original_tx in original_txs:
        reversal_amount = -original_tx.amount
        balance_before = ledger.balance
        ledger.balance += reversal_amount
        ledger.save(update_fields=["balance", "last_transaction_at", "updated_at"])

        rev_tx = DepositTransaction.objects.create(
            customer=customer,
            ledger=ledger,
            type=DepositTransaction.TransactionType.ADJUSTMENT,
            amount=reversal_amount,
            balance_before=balance_before,
            balance_after=ledger.balance,
            order=order,
            order_item=original_tx.order_item,
            container_type=original_tx.container_type,
            container_count=original_tx.container_count,
            reason=f"Reversal of {original_tx.type} — Order {order.order_number} cancelled",
            reference_type="order_cancellation",
            reference_id=order.id,
            performed_by=performed_by,
        )
        reversal_transactions.append(rev_tx)

        # Reverse bottle balance
        if original_tx.container_type and original_tx.container_count:
            bottle_balance = get_or_create_bottle_balance(customer, original_tx.container_type)
            if original_tx.type == DepositTransaction.TransactionType.CHARGE:
                bottle_balance.bottles_outstanding = max(
                    0, bottle_balance.bottles_outstanding - original_tx.container_count
                )
                bottle_balance.bottles_sold_total = max(
                    0, bottle_balance.bottles_sold_total - original_tx.container_count
                )
            elif original_tx.type == DepositTransaction.TransactionType.REFUND:
                bottle_balance.bottles_outstanding += original_tx.container_count
                bottle_balance.bottles_returned_total = max(
                    0, bottle_balance.bottles_returned_total - original_tx.container_count
                )
            bottle_balance.save(
                update_fields=[
                    "bottles_outstanding",
                    "bottles_sold_total",
                    "bottles_returned_total",
                    "updated_at",
                ]
            )

    ledger.last_transaction_at = timezone.now()
    ledger.save(update_fields=["last_transaction_at", "updated_at"])

    return reversal_transactions


@transaction.atomic
def process_bottle_return(
    *,
    customer: Customer,
    order: Order | None = None,
    trip=None,
    drop_point: TripDropPoint | None = None,
    lines: list[dict[str, Any]],
    received_by: str | None = None,
    performed_by: str | None = None,
) -> BottleReturn:
    """Process a bottle return with grading.

    Args:
        customer: The customer returning empties
        order: Optional associated order
        trip: Optional associated trip
        drop_point: Optional associated drop point
        lines: List of dicts with:
            - containerTypeId: str
            - quantityClaimed: int
            - quantityGradedReusable: int
            - quantityGradedDamaged: int
            - quantityRejected: int
            - notes: str (optional)
        received_by: Name of person who received the return
        performed_by: User identifier for audit trail

    Returns:
        The created BottleReturn record
    """
    if not lines:
        raise ValueError("At least one return line is required")

    # Generate return number
    year = timezone.now().year
    sequence = BottleReturn.objects.filter(
        return_number__startswith=f"RTR-{year}-"
    ).count() + 1
    return_number = f"RTR-{year}-{str(sequence).zfill(4)}"
    while BottleReturn.objects.filter(return_number=return_number).exists():
        sequence += 1
        return_number = f"RTR-{year}-{str(sequence).zfill(4)}"

    # Determine status based on grading
    all_reusable = all(
        _int(line.get("quantityRejected"), 0) == 0
        and _int(line.get("quantityGradedDamaged"), 0) == 0
        for line in lines
    )
    all_rejected = all(
        _int(line.get("quantityRejected"), 0) == _int(line.get("quantityClaimed"), 0)
        for line in lines
    )
    if all_rejected:
        status = BottleReturn.ReturnStatus.REJECTED
    elif all_reusable:
        status = BottleReturn.ReturnStatus.ACCEPTED
    else:
        status = BottleReturn.ReturnStatus.GRADED

    bottle_return = BottleReturn.objects.create(
        return_number=return_number,
        customer=customer,
        order=order,
        trip=trip,
        drop_point=drop_point,
        status=status,
        received_by=received_by,
        received_at=timezone.now(),
    )

    ledger = get_or_create_deposit_ledger(customer)

    for line_data in lines:
        container_type_id = str(line_data.get("containerTypeId") or "").strip()
        container_type = ContainerType.objects.filter(id=container_type_id).first()
        if not container_type:
            raise ValueError(f"Container type not found: {container_type_id}")

        quantity_claimed = _int(line_data.get("quantityClaimed"), 0)
        quantity_graded_reusable = _int(line_data.get("quantityGradedReusable"), 0)
        quantity_graded_damaged = _int(line_data.get("quantityGradedDamaged"), 0)
        quantity_rejected = _int(line_data.get("quantityRejected"), 0)

        if quantity_claimed <= 0:
            raise ValueError("quantityClaimed must be greater than zero")
        if quantity_graded_reusable + quantity_graded_damaged + quantity_rejected > quantity_claimed:
            raise ValueError("Graded quantities cannot exceed claimed quantity")

        # Calculate refund for reusable containers. A caller that knows what the
        # customer was actually charged for this container passes that rate in;
        # refunding the container type's standing deposit instead would credit a
        # different amount than was collected.
        rate_override = line_data.get("depositPerContainer")
        deposit_rate = (
            Decimal(str(rate_override))
            if rate_override not in (None, "")
            else Decimal(str(container_type.deposit_amount))
        )
        deposit_refund = _money(deposit_rate * Decimal(quantity_graded_reusable))

        BottleReturnLine.objects.create(
            bottle_return=bottle_return,
            container_type=container_type,
            quantity_claimed=quantity_claimed,
            quantity_graded_reusable=quantity_graded_reusable,
            quantity_graded_damaged=quantity_graded_damaged,
            quantity_rejected=quantity_rejected,
            deposit_refund_amount=deposit_refund,
            notes=line_data.get("notes", ""),
        )

        # Update bottle balance
        bottle_balance = get_or_create_bottle_balance(customer, container_type)
        bottle_balance.bottles_outstanding = max(
            0,
            bottle_balance.bottles_outstanding - quantity_graded_reusable - quantity_graded_damaged,
        )
        bottle_balance.bottles_returned_total += quantity_graded_reusable + quantity_graded_damaged
        bottle_balance.last_return_at = timezone.now()
        bottle_balance.save(
            update_fields=[
                "bottles_outstanding",
                "bottles_returned_total",
                "last_return_at",
                "updated_at",
            ]
        )

        # Create deposit refund transaction
        if deposit_refund > 0:
            balance_before = ledger.balance
            ledger.balance -= deposit_refund
            ledger.save(update_fields=["balance", "last_transaction_at", "updated_at"])

            DepositTransaction.objects.create(
                customer=customer,
                ledger=ledger,
                type=DepositTransaction.TransactionType.REFUND,
                amount=-deposit_refund,
                balance_before=balance_before,
                balance_after=ledger.balance,
                order=order,
                container_type=container_type,
                container_count=quantity_graded_reusable,
                reason=(
                    f"Bottle return {return_number}: {quantity_graded_reusable} "
                    f"{container_type.name}(s) graded reusable"
                ),
                reference_type="bottle_return",
                reference_id=bottle_return.id,
                performed_by=performed_by,
            )

    ledger.last_transaction_at = timezone.now()
    ledger.save(update_fields=["last_transaction_at", "updated_at"])

    return bottle_return


def serialize_bottle_return(bottle_return: BottleReturn) -> dict[str, Any]:
    """Serialize a BottleReturn with its lines for API responses."""
    lines = BottleReturnLine.objects.filter(bottle_return=bottle_return).select_related("container_type")

    return {
        "id": bottle_return.id,
        "returnNumber": bottle_return.return_number,
        "customerId": bottle_return.customer_id,
        "customerName": bottle_return.customer.name,
        "orderId": bottle_return.order_id,
        "orderNumber": bottle_return.order.order_number if bottle_return.order else None,
        "tripId": bottle_return.trip_id,
        "dropPointId": bottle_return.drop_point_id,
        "status": bottle_return.status,
        "receivedBy": bottle_return.received_by,
        "receivedAt": bottle_return.received_at.isoformat() if bottle_return.received_at else None,
        "notes": bottle_return.notes,
        "lines": [
            {
                "id": line.id,
                "containerTypeId": line.container_type_id,
                "containerTypeName": line.container_type.name,
                "containerTypeCode": line.container_type.code,
                "quantityClaimed": line.quantity_claimed,
                "quantityGradedReusable": line.quantity_graded_reusable,
                "quantityGradedDamaged": line.quantity_graded_damaged,
                "quantityRejected": line.quantity_rejected,
                "depositRefundAmount": float(line.deposit_refund_amount),
                "notes": line.notes,
            }
            for line in lines
        ],
        "createdAt": bottle_return.created_at.isoformat(),
        "updatedAt": bottle_return.updated_at.isoformat(),
    }


def get_container_types_serialized() -> list[dict[str, Any]]:
    """Get all active container types."""
    types = ContainerType.objects.filter(is_active=True)
    return [
        {
            "id": t.id,
            "code": t.code,
            "name": t.name,
            "category": t.category,
            "material": t.material,
            "volumeMl": t.volume_ml,
            "capacityUnits": t.capacity_units,
            "depositAmount": float(t.deposit_amount),
            "isReturnable": t.is_returnable,
        }
        for t in types
    ]


def get_product_packaging_serialized(product_id: str) -> list[dict[str, Any]]:
    """Get all active packaging options for a product."""
    options = ProductPackaging.objects.filter(
        product_id=product_id,
        is_active=True,
    ).select_related("container_type")

    return [
        {
            "id": o.id,
            "containerTypeId": o.container_type_id,
            "containerTypeName": o.container_type.name,
            "containerTypeCode": o.container_type.code,
            "depositAmount": float(o.deposit_amount),
            "caseDepositAmount": float(o.case_deposit_amount),
            "isReturnable": o.is_returnable,
            "isPrimary": o.is_primary,
            "unitsPerContainer": o.units_per_container,
            "containersPerCase": o.containers_per_case,
        }
        for o in options
    ]
