"""Checkout normalization, discounts, deposits and order creation."""

from datetime import datetime
from decimal import Decimal
from typing import Any

from django.utils import timezone

from . import views_api as legacy
from .api_constants import (
    DEFAULT_COUNTRY,
    DISCOUNT_CANCELLED,
    DISCOUNT_NO,
    DISCOUNT_OTHER,
    DISCOUNT_PRESET_LABEL,
    DISCOUNT_PRESET_PERCENT,
    DISCOUNT_REMOVED,
    PRODUCT_UNIT_BOTTLE,
    PRODUCT_UNIT_MIXED_CASE,
)
from .api_utils import to_int as _int
from .bottle_services import is_returnable_product as _is_returnable_product
from .deposit_math import deposit_for_case_and_bottles, full_case_deposit
from .models import (
    Customer,
    CustomerBottleBalance,
    MixedCaseComponent,
    Order,
    OrderDepositRefundClaim,
    OrderItem,
    OrderItemType,
    OrderStatus,
    OrderTimeline,
    Product,
    ProductPackaging,
    PurchaseRequestStatus,
)


# Helpers owned by sibling modules. Routing them through views_api keeps
# a single resolution point, so tests that patch there still apply.


def _normalize_product_unit(raw: Any) -> str:
    return legacy._normalize_product_unit(raw)


def _resolve_allocation_policy(body: dict[str, Any]) -> str:
    return legacy._resolve_allocation_policy(body)


def _strip_default_country_suffix(address: Any) -> str:
    return legacy._strip_default_country_suffix(address)


def _normalize_order_items_for_checkout(raw_items: Any) -> tuple[list[dict[str, Any]], float]:
    if not isinstance(raw_items, list) or not raw_items:
        raise ValueError("items are required")

    normalized_items: list[dict[str, Any]] = []
    subtotal = 0.0
    for item in raw_items:
        pid = str((item or {}).get("productId") or "").strip()
        if not pid:
            continue
        prod = Product.objects.filter(id=pid).first()
        if not prod:
            raise ValueError(f"Product not found: {pid}")

        qty = _int((item or {}).get("quantity"), 0)
        if qty <= 0:
            raise ValueError(f"Quantity must be greater than zero for product {prod.sku}")

        unit = float((item or {}).get("unitPrice") or prod.price)
        line_total = float((item or {}).get("totalPrice") or unit * qty)
        subtotal += unit * qty
        normalized_items.append(
            {
                "productId": pid,
                "quantity": qty,
                "unitPrice": unit,
                "totalPrice": line_total,
                "notes": (item or {}).get("notes"),
            }
        )

    if not normalized_items:
        raise ValueError("items are required")
    return normalized_items, subtotal


def _compute_order_totals(body: dict[str, Any], subtotal: float) -> tuple[float, float, float]:
    # Required: orders have no tax or shipping fees, even if an older client sends them.
    shipping_cost = 0.0
    discount = float(body.get("discount") or 0)
    total = float(subtotal - discount)
    return shipping_cost, discount, total


def _count_discount_eligible_cases(items: list[dict[str, Any]]) -> int:
    """Count case and pack lines while excluding individually sold bottles."""
    total_cases = 0
    for item in items:
        quantity = max(0, _int(item.get("quantity"), 0))
        if str(item.get("itemType") or "").upper() == OrderItemType.MIXED_CASE:
            total_cases += quantity
            continue
        product = item.get("product")
        if _normalize_product_unit(getattr(product, "unit", None)) != PRODUCT_UNIT_BOTTLE:
            total_cases += quantity
    return total_cases


def _build_discount_breakdown_for_customer(*, customer: Customer, subtotal: float, total_cases: int) -> dict[str, Any]:
    option = str(getattr(customer, "discount_option", DISCOUNT_NO) or DISCOUNT_NO).strip().upper()
    status = str(getattr(customer, "discount_status", DISCOUNT_REMOVED) or DISCOUNT_REMOVED).strip().upper()
    if status in {DISCOUNT_CANCELLED, DISCOUNT_REMOVED}:
        option = DISCOUNT_NO

    percent = 0.0
    amount_per_case = 0.0
    discount_type = "PERCENTAGE"
    if option in DISCOUNT_PRESET_PERCENT:
        percent = float(DISCOUNT_PRESET_PERCENT[option])
    elif option == DISCOUNT_OTHER:
        # Custom discounts are percentage-based so they always scale with product prices.
        percent = max(0.0, float(getattr(customer, "discount_percent", 0) or 0))
    else:
        option = DISCOUNT_NO

    per_case_discount = 0.0
    # The customer portal and the backend share a 50-case eligibility threshold.
    is_eligible = total_cases >= 50
    if option != DISCOUNT_NO and not is_eligible:
        option = DISCOUNT_NO
    if option != DISCOUNT_NO and is_eligible:
        average_case_price = subtotal / max(1, total_cases)
        per_case_discount = average_case_price * (percent / 100.0)

    total_discount = per_case_discount * max(0, total_cases)
    total_discount = min(total_discount, max(0.0, subtotal))

    return {
        "option": option,
        "status": status if option != DISCOUNT_NO else DISCOUNT_REMOVED,
        "name": DISCOUNT_PRESET_LABEL.get(option, "No Discount"),
        "type": discount_type if option != DISCOUNT_NO else DISCOUNT_NO,
        "percent": percent if option != DISCOUNT_NO else 0.0,
        "amountPerCase": 0.0,
        "perCaseDiscount": per_case_discount if option != DISCOUNT_NO else 0.0,
        "casesAffected": max(0, total_cases) if is_eligible else 0,
        "totalDiscount": max(0.0, total_discount),
        "appliedByName": str(getattr(customer, "discount_applied_by_name", "") or "").strip() or None,
    }


def _generate_next_purchase_workflow_number(field_name: str, prefix: str) -> str:
    """Return the next PR/PO number while preserving the existing four-digit format."""
    year = timezone.now().year
    full_prefix = f"{prefix}-{year}-"
    max_sequence = 0
    for value in Order.objects.filter(**{f"{field_name}__startswith": full_prefix}).values_list(field_name, flat=True):
        suffix = str(value or "")[len(full_prefix):]
        if suffix.isdigit():
            max_sequence = max(max_sequence, int(suffix))
    return f"{full_prefix}{str(max_sequence + 1).zfill(4)}"


def _create_deposit_refund_claims(
    *,
    order: Order,
    customer: Customer,
    raw_refund_lines: Any,
    maximum_order_credit: Decimal,
    client_amount: Any = None,
) -> Decimal:
    """Validate and reserve product-specific empties for collection on an order."""
    if raw_refund_lines in (None, ""):
        raw_refund_lines = []
    if not isinstance(raw_refund_lines, list):
        raise ValueError("depositRefundLines must be a list")
    if not raw_refund_lines:
        return Decimal("0.00")

    from .rgb.services import get_customer_bottle_balances

    locked_balances = {
        str(balance.container_type_id): balance
        for balance in CustomerBottleBalance.objects.select_for_update().filter(customer=customer)
    }
    available_product_rows = {
        (str(product_row.get("productId")), str(row.get("containerTypeId"))): product_row
        for row in get_customer_bottle_balances(customer)
        for product_row in row.get("productBalances", [])
    }
    requested_by_product_container: dict[tuple[str, str], int] = {}
    normalized_lines: list[dict[str, Any]] = []
    seen_pairs: set[tuple[str, str]] = set()
    applied_credit = Decimal("0.00")

    for raw_line in raw_refund_lines:
        if not isinstance(raw_line, dict):
            raise ValueError("Each deposit refund line must be an object")
        product_id = str(raw_line.get("productId") or "").strip()
        container_type_id = str(raw_line.get("containerTypeId") or "").strip()
        if not product_id or not container_type_id:
            raise ValueError("Each deposit refund requires a product and container type")
        pair = (product_id, container_type_id)
        if pair in seen_pairs:
            raise ValueError("Duplicate product deposit refund line")
        seen_pairs.add(pair)

        product = Product.objects.filter(id=product_id).first()
        packaging = (
            ProductPackaging.objects.filter(
                product_id=product_id,
                container_type_id=container_type_id,
                is_active=True,
                is_returnable=True,
            )
            .select_related("container_type")
            .order_by("-is_primary", "created_at")
            .first()
        )
        if product is None or packaging is None:
            raise ValueError("The selected product is not linked to that returnable container")
        balance = locked_balances.get(container_type_id)
        # Fix: an empty balance belongs to the declared product even when another
        # product uses the same physical container type and deposit price.
        available_row = available_product_rows.get(pair) or {}
        if balance is None:
            raise ValueError("No verified empty-container balance is available for the selected product")

        containers_per_case = max(1, _int(packaging.containers_per_case, 1))
        has_unit_breakdown = "cases" in raw_line or "bottles" in raw_line
        requested_cases = max(0, _int(raw_line.get("cases"), 0)) if has_unit_breakdown else 0
        requested_loose_bottles = max(0, _int(raw_line.get("bottles"), 0)) if has_unit_breakdown else 0
        quantity = (
            (requested_cases * containers_per_case) + requested_loose_bottles
            if has_unit_breakdown
            else max(0, _int(raw_line.get("quantity"), 0))
        )
        if quantity <= 0:
            raise ValueError("Each deposit refund requires at least one case or bottle")

        requested_for_product = requested_by_product_container.get(pair, 0) + quantity
        available_quantity = max(0, _int(available_row.get("bottlesAvailable"), 0))
        deposit_per_container = Decimal(str(packaging.deposit_amount or packaging.container_type.deposit_amount or 0))
        case_deposit_amount = Decimal(str(packaging.case_deposit_amount or 0))
        remaining_balance = Decimal(str(available_row.get("depositAvailable") or 0))
        # Preserve the selected units so a full returned case credits its bottle
        # deposits plus the configured physical-case deposit.
        line_amount = (
            deposit_for_case_and_bottles(
                cases=requested_cases,
                loose_bottles=requested_loose_bottles,
                bottle_deposit=deposit_per_container,
                containers_per_case=containers_per_case,
                case_deposit=case_deposit_amount,
            )
            if has_unit_breakdown
            else deposit_per_container * Decimal(quantity)
        ).quantize(Decimal("0.01"))
        requested_amount_for_product = sum(
            line["amount"] for line in normalized_lines
            if line["product"].id == product_id and line["containerTypeId"] == container_type_id
        ) + line_amount
        if requested_for_product > available_quantity or requested_amount_for_product > remaining_balance:
            raise ValueError("Requested deposit refund exceeds the verified available empties")

        requested_by_product_container[pair] = requested_for_product
        normalized_lines.append({
            "product": product,
            "containerTypeId": container_type_id,
            "quantity": quantity,
            "requestedCases": requested_cases,
            "requestedLooseBottles": requested_loose_bottles,
            "containersPerCase": containers_per_case,
            "depositPerContainer": deposit_per_container,
            "caseDepositAmount": case_deposit_amount,
            "amount": line_amount,
        })
        applied_credit += line_amount

    if applied_credit > maximum_order_credit:
        raise ValueError("Requested deposit refund exceeds this order's amount due")
    if client_amount is not None:
        expected_amount = Decimal(str(client_amount or 0)).quantize(Decimal("0.01"))
        if expected_amount != applied_credit:
            raise ValueError("Deposit refund amount does not match the selected empties")

    for line in normalized_lines:
        claim = OrderDepositRefundClaim.objects.filter(
            order=order,
            product=line["product"],
            container_type_id=line["containerTypeId"],
            status=OrderDepositRefundClaim.ClaimStatus.PENDING,
        ).first()
        if claim is None:
            OrderDepositRefundClaim.objects.create(
                order=order,
                product=line["product"],
                product_name=str(line["product"].name or "Product"),
                container_type_id=line["containerTypeId"],
                requested_quantity=line["quantity"],
                requested_cases=line["requestedCases"],
                requested_loose_bottles=line["requestedLooseBottles"],
                containers_per_case=line["containersPerCase"],
                deposit_per_container=line["depositPerContainer"],
                case_deposit_amount=line["caseDepositAmount"],
                requested_amount=line["amount"],
            )
        else:
            # A later refund request for the same order extends its pending pickup.
            claim.requested_quantity += line["quantity"]
            claim.requested_cases += line["requestedCases"]
            claim.requested_loose_bottles += line["requestedLooseBottles"]
            claim.containers_per_case = line["containersPerCase"]
            claim.case_deposit_amount = line["caseDepositAmount"]
            claim.requested_amount += line["amount"]
            claim.save(update_fields=[
                "requested_quantity",
                "requested_cases",
                "requested_loose_bottles",
                "containers_per_case",
                "case_deposit_amount",
                "requested_amount",
                "updated_at",
            ])

    return applied_credit


def _create_order_from_checkout_payload(
    *,
    customer: Customer,
    body: dict[str, Any],
    normalized_items: list[dict[str, Any]],
    subtotal: float,
    shipping_cost: float = 0,
    discount: float,
    total_amount: float,
    selected_warehouse_id: str | None,
    shipping_latitude: Any,
    shipping_longitude: Any,
    payment_status: str,
    performed_by: str | None,
    discount_breakdown: dict[str, Any] | None = None,
) -> Order:
    # Shipping fees are not part of the system; retain the argument only for the
    # existing checkout call contract while keeping it out of Transaction.
    del shipping_cost
    pr_number = _generate_next_purchase_workflow_number("purchase_request_number", "PR")

    order = Order.objects.create(
        order_number=pr_number,
        request_id=str(body.get("requestId") or "").strip() or None,
        # Customer submissions start as Purchase Requests without a PO number until approved.
        purchase_order_number=None,
        purchase_request_number=pr_number,
        customer=customer,
        request_status=PurchaseRequestStatus.PENDING_APPROVAL,
        # Fix: checkout cannot bypass purchase-request approval or delivery steps.
        status=OrderStatus.PENDING,
        priority=body.get("priority") or "normal",
        subtotal=0,
        discount=discount,
        discount_type=str((discount_breakdown or {}).get("type") or DISCOUNT_NO),
        discount_name=str((discount_breakdown or {}).get("name") or "No Discount"),
        discount_percent_applied=float((discount_breakdown or {}).get("percent") or 0),
        discount_per_case_applied=float((discount_breakdown or {}).get("perCaseDiscount") or 0),
        discount_cases_affected=max(0, _int((discount_breakdown or {}).get("casesAffected"), 0)),
        discount_applied_by_name=(discount_breakdown or {}).get("appliedByName"),
        discount_status=str((discount_breakdown or {}).get("status") or DISCOUNT_REMOVED),
        total_amount=0,
        payment_status=payment_status,
        warehouse_id=selected_warehouse_id,
    )

    allocation_policy = _resolve_allocation_policy(body)
    from .rgb.services import get_customer_bottle_balances
    available_empties_by_product_container = {
        (str(product_row.get("productId")), str(balance_row.get("containerTypeId"))): max(
            0, _int(product_row.get("bottlesAvailable"), 0)
        )
        for balance_row in get_customer_bottle_balances(customer)
        for product_row in balance_row.get("productBalances", [])
    }

    def reserve_product_empties(product_id: Any, container_type_id: Any, requested: Any) -> int:
        """Reserve automatic checkout credit from only the matching product balance."""
        quantity = max(0, _int(requested, 0))
        if quantity <= 0:
            return 0
        key = (str(product_id or ""), str(container_type_id or ""))
        available = available_empties_by_product_container.get(key, 0)
        if quantity > available:
            raise ValueError("Requested empty-container credit exceeds this product's available empties")
        available_empties_by_product_container[key] = available - quantity
        return quantity

    total_net_deposit = 0.0
    for item in normalized_items:
        if str(item.get("itemType") or "").strip().upper() == OrderItemType.MIXED_CASE:
            order_item = OrderItem.objects.create(
                order=order,
                product=None,
                product_name="Mixed Case",
                product_sku="MIXED-CASE",
                product_unit=PRODUCT_UNIT_MIXED_CASE,
                item_type=OrderItemType.MIXED_CASE,
                case_capacity=_int(item.get("caseCapacity"), 0),
                quantity=_int(item.get("quantity"), 0),
                unit_price=float(item.get("unitPrice") or 0),
                total_price=float(item.get("totalPrice") or 0),
                product_subtotal=item.get("totalPrice") or 0,
                notes=item.get("notes"),
            )
            bottle_deposit_charged = 0.0
            bottle_deposit_refunded = 0.0
            physical_case_deposit: float | None = None
            for component in item.get("components") or []:
                product = component.get("product")
                if product is None:
                    raise ValueError("Mixed Case component product is unavailable")
                packaging = (
                    ProductPackaging.objects.filter(product=product, is_active=True)
                    .select_related("container_type")
                    .order_by("-is_primary", "created_at")
                    .first()
                )
                deposit_per_unit = float(packaging.deposit_amount or 0) if packaging and packaging.is_returnable else 0.0
                if packaging and packaging.is_returnable and physical_case_deposit is None:
                    physical_case_deposit = float(packaging.case_deposit_amount or 0)
                total_base_units = max(0, _int(component.get("totalBaseUnits"), 0))
                requested_empty_covered = min(
                    total_base_units,
                    max(0, _int(component.get("emptyReturnedQuantity"), 0)),
                )
                empty_covered = reserve_product_empties(
                    product.id,
                    packaging.container_type_id if packaging and packaging.is_returnable else None,
                    requested_empty_covered,
                )
                component_deposit = max(0.0, (total_base_units - empty_covered) * deposit_per_unit)
                bottle_deposit_charged += total_base_units * deposit_per_unit
                bottle_deposit_refunded += empty_covered * deposit_per_unit
                MixedCaseComponent.objects.create(
                    order_item=order_item,
                    product=product,
                    product_name=product.name,
                    product_sku=product.sku,
                    base_unit_label=component.get("baseUnitLabel") or "bottle",
                    quantity_per_case=_int(component.get("quantityPerCase"), 0),
                    case_count=_int(component.get("caseCount"), 0),
                    total_base_units=total_base_units,
                    unit_price=component.get("unitPrice") or 0,
                    component_subtotal=component.get("componentSubtotal") or 0,
                    product_category=product.category,
                    packaging_type_snapshot=("RETURNABLE" if packaging and packaging.is_returnable else "NON_RETURNABLE"),
                    container_type_id=(packaging.container_type_id if packaging else None),
                    container_type_name=(packaging.container_type.name if packaging else None),
                    deposit_per_unit=deposit_per_unit,
                    deposit_total=component_deposit,
                    empty_covered_quantity=empty_covered,
                )
            case_capacity = max(1, _int(item.get("caseCapacity"), 1))
            case_count = max(0, _int(item.get("quantity"), 0))
            order_item.full_quantity = case_capacity * case_count
            order_item.empty_returned_quantity = sum(
                max(0, _int(component.get("emptyReturnedQuantity"), 0))
                for component in (item.get("components") or [])
            )
            covered_cases = min(case_count, order_item.empty_returned_quantity // case_capacity)
            physical_case_amount = physical_case_deposit or 0.0
            order_item.deposit_charged = bottle_deposit_charged + (case_count * physical_case_amount)
            order_item.deposit_refunded = bottle_deposit_refunded + (covered_cases * physical_case_amount)
            item_deposit = max(0.0, float(order_item.deposit_charged) - float(order_item.deposit_refunded))
            order_item.is_returnable_item = order_item.deposit_charged > 0
            order_item.net_deposit = item_deposit
            order_item.deposit_total = item_deposit
            order_item.save(update_fields=[
                "is_returnable_item",
                "full_quantity",
                "empty_returned_quantity",
                "deposit_charged",
                "deposit_refunded",
                "net_deposit",
                "deposit_total",
            ])
            # Keep the policy on the item so submission-time reservation can
            # allocate its component stock consistently.
            order_item.notes = f"{order_item.notes or ''}\nAllocationPolicy={allocation_policy}".strip()
            order_item.save(update_fields=["notes"])
            total_net_deposit += item_deposit
            continue

        pid = str(item.get("productId") or "").strip()
        prod = Product.objects.filter(id=pid).first()
        if not prod:
            raise ValueError(f"Product not found: {pid}")

        qty = _int(item.get("quantity"), 0)
        unit = float(item.get("unitPrice") or prod.price)
        line_total = float(item.get("totalPrice") or unit * qty)
        pkg = (
            ProductPackaging.objects.filter(product=prod, is_active=True)
            .select_related("container_type")
            .order_by("-is_primary", "created_at")
            .first()
        )
        is_returnable = bool(pkg and pkg.is_returnable and _is_returnable_product(prod))
        empty_returned = reserve_product_empties(
            prod.id,
            pkg.container_type_id if (pkg and is_returnable) else None,
            item.get("emptyReturnedQuantity"),
        )
        containers_per_case = max(1, int(pkg.containers_per_case or 1)) if pkg else 1
        is_case = str(prod.unit or "").strip().lower() == "case"
        full_units = qty * containers_per_case if is_case else qty
        deposit_per_unit = float(pkg.deposit_amount or 0) if is_returnable else 0.0
        case_deposit = float(pkg.case_deposit_amount or 0) if is_returnable else 0.0
        # Fix: the case value is additional to every bottle deposit in the case.
        full_case_deposit_amount = float(full_case_deposit(deposit_per_unit, containers_per_case, case_deposit))
        deposit_charged = (qty * full_case_deposit_amount) if is_case else (qty * deposit_per_unit)
        deposit_refunded = ((empty_returned // containers_per_case) * full_case_deposit_amount) if is_case else (empty_returned * deposit_per_unit)
        net_deposit = max(0.0, deposit_charged - deposit_refunded)
        # Fix: standard returnable-item deposits are part of the amount payable.
        total_net_deposit += net_deposit

        order_item = OrderItem.objects.create(
            order=order,
            product=prod,
            product_name=str(prod.name or "").strip() or None,
            product_sku=str(prod.sku or "").strip() or None,
            product_unit=_normalize_product_unit(prod.unit),
            quantity=qty,
            unit_price=unit,
            total_price=line_total,
            is_returnable_item=is_returnable,
            full_quantity=full_units,
            empty_returned_quantity=empty_returned,
            deposit_per_unit=deposit_per_unit,
            deposit_charged=deposit_charged,
            deposit_refunded=deposit_refunded,
            net_deposit=net_deposit,
            deposit_total=net_deposit,
            container_type_id=pkg.container_type_id if (pkg and is_returnable) else None,
            container_type_name=pkg.container_type.name if (pkg and is_returnable and pkg.container_type) else None,
            notes=item.get("notes"),
        )

        policy_note = f"AllocationPolicy={allocation_policy}"
        # Keep the requested allocation policy for submission-time reservation.
        order_item.notes = f"{order_item.notes or ''}\n{policy_note}".strip()
        order_item.save(update_fields=["notes"])

    order.subtotal = subtotal
    # A refund request identifies the product and empty count. The value reduces
    # this order now, while the claim reserves those empties for driver collection.
    applied_deposit_credit = _create_deposit_refund_claims(
        order=order,
        customer=customer,
        raw_refund_lines=body.get("depositRefundLines"),
        maximum_order_credit=Decimal(str(total_amount + total_net_deposit)),
        client_amount=body.get("depositCreditAmount"),
    )
    order.total_amount = max(0.0, total_amount + total_net_deposit - float(applied_deposit_credit))
    order.shipping_name = body.get("shippingName") or customer.name
    order.shipping_phone = body.get("shippingPhone") or customer.phone or ""
    order.shipping_address = _strip_default_country_suffix(body.get("shippingAddress") or customer.address or "")
    order.shipping_city = body.get("shippingCity") or customer.city or ""
    order.shipping_province = body.get("shippingProvince") or customer.province or ""
    order.shipping_zip_code = body.get("shippingZipCode") or customer.zip_code or ""
    order.shipping_country = DEFAULT_COUNTRY
    order.shipping_latitude = shipping_latitude
    order.shipping_longitude = shipping_longitude
    order.notes = body.get("notes")
    order.save(
        update_fields=[
            "subtotal",
            "discount_type",
            "discount_name",
            "discount_percent_applied",
            "discount_per_case_applied",
            "discount_cases_affected",
            "discount_applied_by_name",
            "discount_status",
            "warehouse_id",
            "total_amount",
            "shipping_name",
            "shipping_phone",
            "shipping_address",
            "shipping_city",
            "shipping_province",
            "shipping_zip_code",
            "shipping_country",
            "shipping_latitude",
            "shipping_longitude",
            "notes",
            "updated_at",
        ]
    )
    OrderTimeline.objects.create(order=order, delivery_date=datetime.fromisoformat(body["deliveryDate"]) if body.get("deliveryDate") else None)
    return order
