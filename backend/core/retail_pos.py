from __future__ import annotations

import hashlib
import json
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .beverage_categories import require_category_spec
from .mixed_case import (
    available_base_units,
    consume_order_reservations,
    inventory_base_units,
    release_order_reservations,
    reserve_base_unit_order_item,
    reserve_order_item,
    units_per_case,
)
from .models import (
    BottleReturn,
    BottleReturnLine,
    ContainerType,
    Customer,
    CustomerBottleBalance,
    CustomerDepositLedger,
    DepositTransaction,
    Inventory,
    InventoryQuantityUnit,
    InventoryReservation,
    InventoryTransaction,
    MixedCaseComponent,
    Order,
    OrderItem,
    OrderItemType,
    OrderStatus,
    Product,
    ProductPackaging,
    ReservationStatus,
    RetailFulfillmentType,
    RetailPickupStatus,
    RetailSaleMode,
    RetailTransactionStatus,
    SalesChannel,
    StockBatch,
    User,
    Warehouse,
)

MONEY = Decimal("0.01")


def money(value: Any) -> Decimal:
    """Parse and round authoritative POS money to Philippine centavos."""
    try:
        parsed = Decimal(str(value if value not in (None, "") else 0))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError("Invalid monetary amount") from exc
    if not parsed.is_finite():
        raise ValueError("Invalid monetary amount")
    return parsed.quantize(MONEY, rounding=ROUND_HALF_UP)


def positive_int(value: Any, label: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{label} must be a positive whole number")
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be a positive whole number") from exc
    if str(value).strip() != str(parsed) or parsed <= 0:
        raise ValueError(f"{label} must be a positive whole number")
    return parsed


def nonnegative_int(value: Any, label: str) -> int:
    if value in (None, ""):
        return 0
    if isinstance(value, bool):
        raise ValueError(f"{label} must be a non-negative whole number")
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be a non-negative whole number") from exc
    if str(value).strip() != str(parsed) or parsed < 0:
        raise ValueError(f"{label} must be a non-negative whole number")
    return parsed


def calculate_deposit_amount(
    *,
    mode: str,
    eligible_units: int,
    empty_units: int,
    unit_deposit: Decimal,
    case_deposit: Decimal = Decimal("0"),
    case_count: int = 0,
    case_capacity: int = 0,
) -> Decimal:
    """Charge only uncovered containers, preserving an explicit case deposit."""
    eligible = nonnegative_int(eligible_units, "Eligible bottle quantity")
    empties = nonnegative_int(empty_units, "Empty bottles provided")
    if empties > eligible:
        raise ValueError(f"Empty bottles provided cannot exceed {eligible}")
    if eligible == 0:
        return Decimal("0.00")

    uncovered = eligible - empties
    normalized_mode = str(mode or "").strip().upper()
    registered_case_deposit = money(case_deposit)
    if normalized_mode == RetailSaleMode.CASE and registered_case_deposit > 0:
        cases = positive_int(case_count, "Case quantity")
        capacity = positive_int(case_capacity, "Case capacity")
        if cases * capacity != eligible:
            raise ValueError("Eligible bottle quantity does not match the case quantity and capacity")
        # Approved D-2: prorate the registered case deposit by uncovered bottles.
        return money((registered_case_deposit * Decimal(cases) * Decimal(uncovered)) / Decimal(eligible))

    return money(money(unit_deposit) * Decimal(uncovered))


def calculate_payment_summary(
    product_total: Decimal,
    deposit_total: Decimal,
    amount_paid: Decimal,
) -> dict[str, Decimal | str]:
    product = money(product_total)
    deposit = money(deposit_total)
    paid = money(amount_paid)
    grand_total = money(product + deposit)
    if paid < 0:
        raise ValueError("Amount paid cannot be negative")
    if paid > grand_total:
        raise ValueError("Amount paid cannot exceed the grand total")
    remaining = money(grand_total - paid)
    if paid == 0:
        status = "UNPAID"
    elif remaining == 0:
        status = "PAID"
    else:
        status = "PARTIALLY_PAID"
    return {
        "productTotal": product,
        "deposit": deposit,
        "grandTotal": grand_total,
        "amountPaid": paid,
        "remainingBalance": remaining,
        "paymentStatus": status,
    }


def _primary_packaging(product: Product) -> ProductPackaging | None:
    return (
        ProductPackaging.objects.select_related("container_type")
        .filter(product=product, is_active=True)
        .order_by("-is_primary", "created_at", "id")
        .first()
    )


def _price_for(product: Product, mode: str) -> Decimal:
    if mode == RetailSaleMode.LOOSE:
        if product.retail_unit_price is not None:
            return money(product.retail_unit_price)
        qty = units_per_case(product)
        if qty > 0:
            return money((product.case_price if product.case_price is not None else Decimal(str(product.price or 0))) / Decimal(qty))
        raise ValueError(f"Retail unit price is not configured for {product.name}")
    if mode == RetailSaleMode.CASE:
        return money(product.case_price if product.case_price is not None else product.price)
    raise ValueError(f"Unsupported sale mode: {mode}")


def _deposit_configuration(product: Product) -> tuple[ProductPackaging | None, Decimal, Decimal, bool]:
    category = require_category_spec(product.category)
    if category["depositExempt"]:
        return None, Decimal("0.00"), Decimal("0.00"), False
    packaging = _primary_packaging(product)
    eligible = bool(
        packaging
        and packaging.is_returnable
        and packaging.container_type.is_returnable
    )
    if not eligible or packaging is None:
        return packaging, Decimal("0.00"), Decimal("0.00"), False
    return packaging, money(packaging.deposit_amount), money(packaging.case_deposit_amount), True


def _product_version(product: Product, packaging: ProductPackaging | None) -> str:
    parts = [product.id, product.updated_at.isoformat()]
    if packaging:
        parts.extend([packaging.id, packaging.updated_at.isoformat()])
    return ":".join(parts)


def _quote_standard_line(raw: dict[str, Any], product: Product) -> dict[str, Any]:
    mode = str(raw.get("mode") or "").strip().upper()
    if mode not in {RetailSaleMode.LOOSE, RetailSaleMode.CASE}:
        raise ValueError("Standard retail items must use LOOSE or CASE mode")
    quantity = positive_int(raw.get("quantity"), f"Quantity for {product.name}")
    category = require_category_spec(product.category)
    capacity = positive_int(product.quantity_per_unit, f"Case capacity for {product.name}")
    eligible_units = quantity if mode == RetailSaleMode.LOOSE else quantity * capacity
    empties = nonnegative_int(raw.get("emptyBottlesProvided"), f"Empty bottles for {product.name}")
    price = _price_for(product, mode)
    product_subtotal = money(price * Decimal(quantity))
    packaging, unit_deposit, case_deposit, deposit_eligible = _deposit_configuration(product)
    deposit = (
        calculate_deposit_amount(
            mode=mode,
            eligible_units=eligible_units,
            empty_units=empties,
            unit_deposit=unit_deposit,
            case_deposit=case_deposit,
            case_count=quantity if mode == RetailSaleMode.CASE else 0,
            case_capacity=capacity if mode == RetailSaleMode.CASE else 0,
        )
        if deposit_eligible
        else Decimal("0.00")
    )
    if not deposit_eligible and empties:
        raise ValueError(f"{product.name} does not accept empty bottles for deposit coverage")
    return {
        "mode": mode,
        "product": product,
        "productId": product.id,
        "productName": product.name,
        "productSku": product.sku,
        "productImageUrl": product.image_url,
        "category": category["category"],
        "packagingType": category["packagingType"],
        "looseUnit": category["looseUnit"],
        "quantity": quantity,
        "caseCapacity": capacity,
        "eligibleUnits": eligible_units,
        "emptyBottlesProvided": empties,
        "unitPrice": price,
        "productSubtotal": product_subtotal,
        "deposit": deposit,
        "depositPerUnit": unit_deposit,
        "caseDeposit": case_deposit,
        "depositEligible": deposit_eligible,
        "depositExempt": bool(category["depositExempt"]),
        "packaging": packaging,
        "configurationVersion": _product_version(product, packaging),
    }


def _quote_mixed_line(raw: dict[str, Any], products: dict[str, Product]) -> dict[str, Any]:
    case_count = positive_int(raw.get("quantity"), "Mixed Case quantity")
    case_capacity = positive_int(raw.get("caseCapacity"), "Mixed Case capacity")
    raw_components = raw.get("components")
    if not isinstance(raw_components, list) or len(raw_components) < 2:
        raise ValueError("A Mixed Case must contain at least two different products")

    seen: set[str] = set()
    compatibility_keys: set[str] = set()
    total_units = 0
    product_subtotal = Decimal("0.00")
    deposit_total = Decimal("0.00")
    empties_total = 0
    components: list[dict[str, Any]] = []
    for raw_component in raw_components:
        if not isinstance(raw_component, dict):
            raise ValueError("Every Mixed Case component must be an object")
        product_id = str(raw_component.get("productId") or "").strip()
        if not product_id or product_id in seen:
            raise ValueError("Each Mixed Case product must appear exactly once")
        seen.add(product_id)
        product = products.get(product_id)
        if product is None:
            raise ValueError(f"Active Mixed Case product not found: {product_id}")
        category = require_category_spec(product.category)
        if (
            category["category"] != "Carbonated (Glass)"
            or category["depositExempt"]
            or str(product.unit or "").strip().lower() != "case"
        ):
            raise ValueError(f"{product.name} is not an eligible case-based Glass Bottle product")
        if case_capacity != units_per_case(product):
            raise ValueError(f"Capacity {case_capacity} does not match {product.name}'s case quantity")

        quantity_units = positive_int(raw_component.get("quantityBaseUnits"), f"Mixed Case quantity for {product.name}")
        empties = nonnegative_int(raw_component.get("emptyBottlesProvided"), f"Empty bottles for {product.name}")
        if empties > quantity_units:
            raise ValueError(f"Empty bottles provided cannot exceed {quantity_units} for {product.name}")
        price = _price_for(product, RetailSaleMode.LOOSE)
        component_subtotal = money(price * Decimal(quantity_units))
        packaging, unit_deposit, _case_deposit, deposit_eligible = _deposit_configuration(product)
        component_deposit = (
            calculate_deposit_amount(
                mode=RetailSaleMode.MIXED_CASE,
                eligible_units=quantity_units,
                empty_units=empties,
                unit_deposit=unit_deposit,
            )
            if deposit_eligible
            else Decimal("0.00")
        )
        compatibility_keys.add(category["compatibilityKey"])
        total_units += quantity_units
        empties_total += empties
        product_subtotal += component_subtotal
        deposit_total += component_deposit
        components.append(
            {
                "product": product,
                "productId": product.id,
                "productName": product.name,
                "productSku": product.sku,
                "productImageUrl": product.image_url,
                "category": category["category"],
                "packagingType": category["packagingType"],
                "looseUnit": category["looseUnit"],
                "quantityBaseUnits": quantity_units,
                "quantityPerCase": quantity_units // case_count if quantity_units % case_count == 0 else 0,
                "emptyBottlesProvided": empties,
                "unitPrice": price,
                "productSubtotal": component_subtotal,
                "deposit": component_deposit,
                "depositPerUnit": unit_deposit,
                "depositEligible": deposit_eligible,
                "packaging": packaging,
                "configurationVersion": _product_version(product, packaging),
            }
        )

    expected_units = case_capacity * case_count
    if total_units != expected_units:
        raise ValueError(f"Mixed Case components must total exactly {expected_units} bottles; received {total_units}")
    if len(compatibility_keys) != 1:
        raise ValueError("These products use different packaging types and cannot be combined in the same case")
    if any(component["quantityPerCase"] <= 0 for component in components):
        raise ValueError("Each Mixed Case component quantity must divide evenly across the selected cases")
    return {
        "mode": RetailSaleMode.MIXED_CASE,
        "product": None,
        "productId": None,
        "productName": f"Mixed Case — {case_capacity} Glass Bottles",
        "productSku": None,
        "productImageUrl": None,
        "category": "Mixed Case",
        "packagingType": "Glass Bottle",
        "looseUnit": "Glass Bottle",
        "quantity": case_count,
        "caseCapacity": case_capacity,
        "eligibleUnits": total_units,
        "emptyBottlesProvided": empties_total,
        "unitPrice": money(product_subtotal / Decimal(case_count)),
        "productSubtotal": money(product_subtotal),
        "deposit": money(deposit_total),
        "depositPerUnit": Decimal("0.00"),
        "caseDeposit": Decimal("0.00"),
        "depositEligible": any(component["depositEligible"] for component in components),
        "depositExempt": False,
        "packaging": None,
        "components": components,
        "configurationVersion": "|".join(component["configurationVersion"] for component in components),
    }


def quote_retail_cart(*, warehouse: Warehouse, payload: dict[str, Any]) -> dict[str, Any]:
    raw_items = payload.get("items")
    if not isinstance(raw_items, list) or not raw_items:
        raise ValueError("At least one retail item is required")

    product_ids: set[str] = set()
    for raw in raw_items:
        if not isinstance(raw, dict):
            raise ValueError("Every retail item must be an object")
        if str(raw.get("mode") or "").strip().upper() == RetailSaleMode.MIXED_CASE:
            components = raw.get("components") or []
            product_ids.update(str(row.get("productId") or "").strip() for row in components if isinstance(row, dict))
        else:
            product_ids.add(str(raw.get("productId") or "").strip())
    product_ids.discard("")
    products = {
        product.id: product
        for product in Product.objects.filter(id__in=product_ids, is_active=True)
    }

    lines: list[dict[str, Any]] = []
    requested_by_product: dict[str, int] = {}
    for raw in raw_items:
        mode = str(raw.get("mode") or "").strip().upper()
        if mode == RetailSaleMode.MIXED_CASE:
            line = _quote_mixed_line(raw, products)
            for component in line["components"]:
                product_id = component["productId"]
                requested_by_product[product_id] = requested_by_product.get(product_id, 0) + component["quantityBaseUnits"]
        else:
            product_id = str(raw.get("productId") or "").strip()
            product = products.get(product_id)
            if product is None:
                raise ValueError(f"Active product not found: {product_id or 'missing product id'}")
            line = _quote_standard_line(raw, product)
            requested_by_product[product_id] = requested_by_product.get(product_id, 0) + line["eligibleUnits"]
        lines.append(line)

    inventories = {
        inventory.product_id: inventory
        for inventory in Inventory.objects.select_related("product")
        .filter(warehouse=warehouse, product_id__in=requested_by_product)
    }
    for product_id, requested in requested_by_product.items():
        inventory = inventories.get(product_id)
        product = products[product_id]
        available = available_base_units(inventory, product) if inventory else 0
        if available < requested:
            raise ValueError(f"Insufficient available inventory for {product.name}: requested {requested}, available {available}")

    product_total = money(sum((line["productSubtotal"] for line in lines), Decimal("0")))
    deposit_total = money(sum((line["deposit"] for line in lines), Decimal("0")))
    payment = calculate_payment_summary(product_total, deposit_total, money(payload.get("amountPaid", 0)))
    fingerprint_rows = [
        {
            "mode": line["mode"],
            "productId": line["productId"],
            "quantity": line["quantity"],
            "caseCapacity": line["caseCapacity"],
            "empties": line["emptyBottlesProvided"],
            "productSubtotal": str(line["productSubtotal"]),
            "deposit": str(line["deposit"]),
            "version": line["configurationVersion"],
            "components": [
                {
                    "productId": component["productId"],
                    "quantity": component["quantityBaseUnits"],
                    "empties": component["emptyBottlesProvided"],
                    "subtotal": str(component["productSubtotal"]),
                    "deposit": str(component["deposit"]),
                    "version": component["configurationVersion"],
                }
                for component in line.get("components", [])
            ],
        }
        for line in lines
    ]
    fingerprint = hashlib.sha256(
        json.dumps({"warehouseId": warehouse.id, "items": fingerprint_rows}, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return {
        "warehouse": warehouse,
        "lines": lines,
        "payment": payment,
        "fingerprint": fingerprint,
        "totalEmptyBottlesProvided": sum(line["emptyBottlesProvided"] for line in lines),
    }


def _money_text(value: Any) -> str:
    return f"{money(value):.2f}"


def serialize_retail_quote(quote: dict[str, Any]) -> dict[str, Any]:
    def component_payload(component: dict[str, Any]) -> dict[str, Any]:
        return {
            "productId": component["productId"],
            "productName": component["productName"],
            "productSku": component["productSku"],
            "productImageUrl": component["productImageUrl"],
            "category": component["category"],
            "packagingType": component["packagingType"],
            "looseUnit": component["looseUnit"],
            "quantityBaseUnits": component["quantityBaseUnits"],
            "quantityPerCase": component["quantityPerCase"],
            "emptyBottlesProvided": component["emptyBottlesProvided"],
            "unitPrice": _money_text(component["unitPrice"]),
            "productSubtotal": _money_text(component["productSubtotal"]),
            "deposit": _money_text(component["deposit"]),
            "depositPerUnit": _money_text(component["depositPerUnit"]),
        }

    lines = [
        {
            "mode": line["mode"],
            "productId": line["productId"],
            "productName": line["productName"],
            "productSku": line["productSku"],
            "productImageUrl": line["productImageUrl"],
            "category": line["category"],
            "packagingType": line["packagingType"],
            "looseUnit": line["looseUnit"],
            "quantity": line["quantity"],
            "caseCapacity": line["caseCapacity"],
            "eligibleUnits": line["eligibleUnits"],
            "emptyBottlesProvided": line["emptyBottlesProvided"],
            "unitPrice": _money_text(line["unitPrice"]),
            "productSubtotal": _money_text(line["productSubtotal"]),
            "deposit": _money_text(line["deposit"]),
            "depositPerUnit": _money_text(line["depositPerUnit"]),
            "caseDeposit": _money_text(line["caseDeposit"]),
            "depositEligible": line["depositEligible"],
            "depositExempt": line["depositExempt"],
            "components": [component_payload(component) for component in line.get("components", [])],
        }
        for line in quote["lines"]
    ]
    payment = quote["payment"]
    return {
        "warehouse": {"id": quote["warehouse"].id, "name": quote["warehouse"].name, "code": quote["warehouse"].code},
        "items": lines,
        "productTotal": _money_text(payment["productTotal"]),
        "emptyBottlesProvided": quote["totalEmptyBottlesProvided"],
        "deposit": _money_text(payment["deposit"]),
        "grandTotal": _money_text(payment["grandTotal"]),
        "amountPaid": _money_text(payment["amountPaid"]),
        "remainingBalance": _money_text(payment["remainingBalance"]),
        "paymentStatus": payment["paymentStatus"],
        "fingerprint": quote["fingerprint"],
    }


def serialize_retail_product(product: Product, inventory: Inventory | None) -> dict[str, Any]:
    category = require_category_spec(product.category)
    packaging, unit_deposit, case_deposit, deposit_eligible = _deposit_configuration(product)
    capacity = max(0, int(product.quantity_per_unit or 0))
    available = available_base_units(inventory, product) if inventory else 0
    has_unit_price = product.retail_unit_price is not None or capacity > 0
    mixed_eligible = bool(
        category["category"] == "Carbonated (Glass)"
        and not category["depositExempt"]
        and str(product.unit or "").strip().lower() == "case"
        and capacity > 0
        and has_unit_price
    )
    modes: list[str] = []
    if has_unit_price:
        modes.append(RetailSaleMode.LOOSE)
    if capacity > 0:
        modes.append(RetailSaleMode.CASE)
    if mixed_eligible:
        modes.append(RetailSaleMode.MIXED_CASE)

    effective_unit_price = (
        product.retail_unit_price
        if product.retail_unit_price is not None
        else ((product.case_price if product.case_price is not None else Decimal(str(product.price or 0))) / Decimal(capacity) if capacity > 0 else None)
    )
    return {
        "id": product.id,
        "sku": product.sku,
        "name": product.name,
        "imageUrl": product.image_url,
        "category": category["category"],
        "packagingType": category["packagingType"],
        "looseUnit": category["looseUnit"],
        "sizes": product.sizes,
        "retailUnitPrice": _money_text(effective_unit_price) if effective_unit_price is not None else None,
        "casePrice": _money_text(product.case_price if product.case_price is not None else product.price),
        "caseQuantity": capacity,
        "depositPerUnit": _money_text(unit_deposit),
        "caseDeposit": _money_text(case_deposit),
        "depositEligible": deposit_eligible,
        "depositExempt": bool(category["depositExempt"]),
        "containerTypeId": packaging.container_type_id if packaging else None,
        "containerTypeName": packaging.container_type.name if packaging else None,
        "availableBaseUnits": available,
        "availableCases": available // capacity if capacity else 0,
        "supportedModes": modes,
        "mixedCaseCapacities": [capacity] if mixed_eligible else [],
    }


def _next_retail_number() -> str:
    year = timezone.now().year
    # New retail receipts use the dedicated RCP prefix; existing POS receipts remain unchanged.
    prefix = f"RCP-{year}-"
    sequence = Order.objects.filter(retail_transaction_number__startswith=prefix).count() + 1
    candidate = f"{prefix}{sequence:04d}"
    while Order.objects.filter(Q(retail_transaction_number=candidate) | Q(order_number=candidate)).exists():
        sequence += 1
        candidate = f"{prefix}{sequence:04d}"
    return candidate


def _resolve_retail_customer(payload: dict[str, Any]) -> tuple[Customer | None, dict[str, str | None]]:
    customer_type = str(payload.get("customerType") or "WALK_IN").strip().upper()
    if customer_type == "EXISTING":
        customer_id = str(payload.get("customerId") or "").strip()
        customer = Customer.objects.filter(id=customer_id, is_active=True).first()
        if customer is None:
            raise ValueError("The selected customer is unavailable; refresh or use Walk-in Customer")
        return customer, {"name": None, "contact": None, "notes": None}
    if customer_type != "WALK_IN":
        raise ValueError("customerType must be EXISTING or WALK_IN")
    walk_in = payload.get("walkIn") if isinstance(payload.get("walkIn"), dict) else {}
    return None, {
        "name": str(walk_in.get("name") or "").strip() or None,
        "contact": str(walk_in.get("contactNumber") or "").strip() or None,
        "notes": str(walk_in.get("notes") or "").strip() or None,
    }


def _get_or_create_locked_ledger(customer: Customer) -> CustomerDepositLedger:
    ledger = CustomerDepositLedger.objects.select_for_update().filter(customer=customer).first()
    if ledger:
        return ledger
    return CustomerDepositLedger.objects.create(customer=customer, balance=Decimal("0.00"), currency="PHP")


def _get_or_create_locked_balance(customer: Customer, container_type: ContainerType) -> CustomerBottleBalance:
    balance = (
        CustomerBottleBalance.objects.select_for_update()
        .filter(customer=customer, container_type=container_type)
        .first()
    )
    if balance:
        return balance
    return CustomerBottleBalance.objects.create(customer=customer, container_type=container_type)


def _next_return_number() -> str:
    year = timezone.now().year
    prefix = f"RTR-{year}-"
    sequence = BottleReturn.objects.filter(return_number__startswith=prefix).count() + 1
    candidate = f"{prefix}{sequence:04d}"
    while BottleReturn.objects.filter(return_number=candidate).exists():
        sequence += 1
        candidate = f"{prefix}{sequence:04d}"
    return candidate


def _retail_deposit_allocations(order: Order) -> list[dict[str, Any]]:
    allocations: list[dict[str, Any]] = []
    items = order.items.select_related("product").prefetch_related("mixed_case_components__product")
    for item in items:
        if item.sale_mode == RetailSaleMode.MIXED_CASE:
            for component in item.mixed_case_components.all():
                if not component.container_type_id:
                    continue
                allocations.append(
                    {
                        "orderItem": item,
                        "containerTypeId": component.container_type_id,
                        "eligibleUnits": component.total_base_units,
                        "emptyUnits": component.empty_covered_quantity,
                        "deposit": money(component.deposit_total),
                    }
                )
            continue
        if item.container_type_id:
            allocations.append(
                {
                    "orderItem": item,
                    "containerTypeId": item.container_type_id,
                    "eligibleUnits": item.full_quantity,
                    "emptyUnits": item.empty_covered_quantity,
                    "deposit": money(item.deposit_total),
                }
            )
    return allocations


def _record_retail_deposits_and_returns(order: Order, performed_by: str) -> BottleReturn | None:
    allocations = _retail_deposit_allocations(order)
    if not allocations:
        return None
    customer = order.customer
    ledger = _get_or_create_locked_ledger(customer) if customer else None
    container_types = {
        row.id: row
        for row in ContainerType.objects.filter(id__in={allocation["containerTypeId"] for allocation in allocations})
    }
    return_totals: dict[str, int] = {}
    for allocation in allocations:
        container_type = container_types.get(allocation["containerTypeId"])
        if container_type is None:
            raise ValueError("Configured deposit container type is unavailable")
        eligible = max(0, int(allocation["eligibleUnits"]))
        empties = max(0, int(allocation["emptyUnits"]))
        uncovered = max(0, eligible - empties)
        deposit = money(allocation["deposit"])
        if empties:
            return_totals[container_type.id] = return_totals.get(container_type.id, 0) + empties

        balance_before = money(ledger.balance) if ledger else Decimal("0.00")
        balance_after = money(balance_before + deposit) if ledger else Decimal("0.00")
        if ledger and deposit:
            ledger.balance = balance_after
            ledger.last_transaction_at = timezone.now()
            ledger.save(update_fields=["balance", "last_transaction_at", "updated_at"])
        if deposit:
            DepositTransaction.objects.create(
                customer=customer,
                ledger=ledger,
                type=DepositTransaction.TransactionType.CHARGE,
                amount=deposit,
                balance_before=balance_before,
                balance_after=balance_after,
                order=order,
                order_item=allocation["orderItem"],
                container_type=container_type,
                container_count=uncovered,
                reason=f"Retail deposit for {uncovered} uncovered {container_type.name}(s) — {order.retail_transaction_number}",
                reference_type="retail_sale",
                reference_id=order.id,
                performed_by=performed_by,
            )
        if customer:
            balance = _get_or_create_locked_balance(customer, container_type)
            balance.bottles_outstanding = max(0, balance.bottles_outstanding + uncovered)
            balance.bottles_sold_total += eligible
            balance.bottles_returned_total += empties
            if empties:
                balance.last_return_at = timezone.now()
            balance.deposit_balance = money(balance.deposit_balance + deposit)
            balance.save(
                update_fields=[
                    "bottles_outstanding",
                    "bottles_sold_total",
                    "bottles_returned_total",
                    "last_return_at",
                    "deposit_balance",
                    "updated_at",
                ]
            )

    if not return_totals:
        return None
    bottle_return = BottleReturn.objects.create(
        return_number=_next_return_number(),
        customer=customer,
        order=order,
        status=BottleReturn.ReturnStatus.ACCEPTED,
        received_by=performed_by,
        received_at=timezone.now(),
        notes="Empty bottles accepted during Retail checkout",
    )
    BottleReturnLine.objects.bulk_create(
        [
            BottleReturnLine(
                bottle_return=bottle_return,
                container_type=container_types[container_type_id],
                quantity_claimed=quantity,
                quantity_graded_reusable=quantity,
                quantity_graded_damaged=0,
                quantity_rejected=0,
                deposit_refund_amount=Decimal("0.00"),
                notes="Applied directly as deposit coverage for the related retail sale",
            )
            for container_type_id, quantity in return_totals.items()
        ]
    )
    return bottle_return


@transaction.atomic
def create_retail_sale(
    *,
    warehouse: Warehouse,
    staff: User,
    payload: dict[str, Any],
    expected_fingerprint: str,
) -> tuple[Order, bool]:
    """Finalize a POS sale once; every stock and deposit effect is atomic."""
    request_id = str(payload.get("idempotencyKey") or "").strip()
    if not request_id:
        raise ValueError("idempotencyKey is required")
    existing = Order.objects.filter(retail_request_id=request_id, sales_channel=SalesChannel.RETAIL_POS).first()
    if existing:
        return existing, False

    customer, walk_in = _resolve_retail_customer(payload)
    fulfillment = str(payload.get("fulfillmentType") or RetailFulfillmentType.IMMEDIATE).strip().upper()
    if fulfillment not in {RetailFulfillmentType.IMMEDIATE, RetailFulfillmentType.CUSTOMER_PICKUP}:
        fulfillment = RetailFulfillmentType.IMMEDIATE
    quote = quote_retail_cart(warehouse=warehouse, payload=payload)
    if not expected_fingerprint or quote["fingerprint"] != expected_fingerprint:
        raise ValueError("Product, pricing, packaging, deposit, or inventory configuration changed; refresh the quote")

    number = _next_retail_number()
    payment = quote["payment"]
    immediate = fulfillment == RetailFulfillmentType.IMMEDIATE
    order = Order.objects.create(
        order_number=number,
        retail_transaction_number=number,
        retail_request_id=request_id,
        customer=customer,
        status=OrderStatus.DELIVERED if immediate else OrderStatus.PENDING,
        priority="normal",
        subtotal=float(payment["productTotal"]),
        tax=0,
        shipping_cost=0,
        discount=0,
        total_amount=float(payment["grandTotal"]),
        payment_status=str(payment["paymentStatus"]),
        amount_paid=payment["amountPaid"],
        remaining_balance=payment["remainingBalance"],
        warehouse_id=warehouse.id,
        sales_channel=SalesChannel.RETAIL_POS,
        fulfillment_type=fulfillment,
        pickup_status=(RetailPickupStatus.NOT_APPLICABLE if immediate else RetailPickupStatus.PENDING_PICKUP),
        retail_status=(RetailTransactionStatus.COMPLETED if immediate else RetailTransactionStatus.RESERVED),
        walk_in_name=walk_in["name"],
        walk_in_contact=walk_in["contact"],
        walk_in_notes=walk_in["notes"],
        notes=walk_in["notes"],
        created_by_user=staff,
        created_by_name=staff.name,
    )

    order_items: list[OrderItem] = []
    for line in quote["lines"]:
        product = line["product"]
        packaging = line["packaging"]
        mixed = line["mode"] == RetailSaleMode.MIXED_CASE
        item = OrderItem.objects.create(
            order=order,
            product=product,
            product_name=line["productName"],
            product_sku=line["productSku"],
            product_unit=("mixed_case" if mixed else str(product.unit or "case")),
            item_type=(OrderItemType.MIXED_CASE if mixed else OrderItemType.STANDARD_CASE),
            sale_mode=line["mode"],
            case_capacity=line["caseCapacity"],
            quantity=line["quantity"],
            unit_price=float(line["unitPrice"]),
            total_price=float(line["productSubtotal"]),
            product_subtotal=line["productSubtotal"],
            product_category=line["category"],
            packaging_type_snapshot=line["packagingType"],
            container_type_id=(packaging.container_type_id if packaging else None),
            container_type_name=(packaging.container_type.name if packaging else line["packagingType"]),
            is_returnable_item=bool(line["depositEligible"]),
            full_quantity=line["eligibleUnits"],
            empty_returned_quantity=line["emptyBottlesProvided"],
            empty_covered_quantity=line["emptyBottlesProvided"],
            deposit_per_unit=line["depositPerUnit"],
            deposit_charged=line["deposit"],
            deposit_refunded=0,
            net_deposit=line["deposit"],
            deposit_total=line["deposit"],
            notes="Retail sale",
        )
        for component in line.get("components", []):
            component_packaging = component["packaging"]
            MixedCaseComponent.objects.create(
                order_item=item,
                product=component["product"],
                product_name=component["productName"],
                product_sku=component["productSku"],
                base_unit_label=component["looseUnit"],
                quantity_per_case=component["quantityPerCase"],
                case_count=line["quantity"],
                total_base_units=component["quantityBaseUnits"],
                unit_price=component["unitPrice"],
                component_subtotal=component["productSubtotal"],
                product_category=component["category"],
                packaging_type_snapshot=component["packagingType"],
                container_type_id=(component_packaging.container_type_id if component_packaging else None),
                container_type_name=(component_packaging.container_type.name if component_packaging else component["packagingType"]),
                deposit_per_unit=component["depositPerUnit"],
                deposit_total=component["deposit"],
                empty_covered_quantity=component["emptyBottlesProvided"],
            )
        order_items.append(item)

    for item in order_items:
        if item.sale_mode == RetailSaleMode.LOOSE:
            if item.product is None:
                raise ValueError("Loose retail item is missing its product")
            reserve_base_unit_order_item(item, item.product, item.full_quantity, "FEFO", staff.name)
        else:
            reserve_order_item(item, "FEFO", staff.name)

    _record_retail_deposits_and_returns(order, staff.name)
    if immediate:
        consume_order_reservations(order, staff.name)
    return order, True


def serialize_retail_sale(order: Order) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for item in order.items.all().order_by("created_at", "id"):
        item_sizes = []
        if item.product and isinstance(item.product.sizes, list) and item.product.sizes:
            item_sizes = [str(s).strip() for s in item.product.sizes if str(s).strip()]
        elif item.product and item.product.packaging_profile and item.product.packaging_profile.container_size:
            item_sizes = [str(item.product.packaging_profile.container_size).strip()]

        components = []
        for component in item.mixed_case_components.all().order_by("created_at", "id"):
            comp_sizes = []
            if component.product and isinstance(component.product.sizes, list) and component.product.sizes:
                comp_sizes = [str(s).strip() for s in component.product.sizes if str(s).strip()]
            elif component.product and component.product.packaging_profile and component.product.packaging_profile.container_size:
                comp_sizes = [str(component.product.packaging_profile.container_size).strip()]

            components.append(
                {
                    "id": component.id,
                    "productId": component.product_id,
                    "productName": component.product_name,
                    "productSku": component.product_sku,
                    "category": component.product_category,
                    "packagingType": component.packaging_type_snapshot,
                    "looseUnit": component.base_unit_label,
                    "quantityPerCase": component.quantity_per_case,
                    "caseCount": component.case_count,
                    "quantityBaseUnits": component.total_base_units,
                    "unitPrice": _money_text(component.unit_price),
                    "productSubtotal": _money_text(component.component_subtotal),
                    "emptyBottlesProvided": component.empty_covered_quantity,
                    "depositPerUnit": _money_text(component.deposit_per_unit),
                    "deposit": _money_text(component.deposit_total),
                    "imageUrl": component.product.image_url if component.product else None,
                    "sizes": comp_sizes,
                }
            )
        items.append(
            {
                "id": item.id,
                "mode": item.sale_mode,
                "productId": item.product_id,
                "productName": item.product_name,
                "productSku": item.product_sku,
                "category": item.product_category,
                "packagingType": item.packaging_type_snapshot,
                "quantity": item.quantity,
                "caseCapacity": item.case_capacity,
                "eligibleUnits": item.full_quantity,
                "unitPrice": _money_text(item.unit_price),
                "productSubtotal": _money_text(item.product_subtotal),
                "emptyBottlesProvided": item.empty_covered_quantity,
                "depositPerUnit": _money_text(item.deposit_per_unit),
                "deposit": _money_text(item.deposit_total),
                "imageUrl": item.product.image_url if item.product else None,
                "sizes": item_sizes,
                "components": components,
            }
        )
    bottle_returns = [
        {
            "id": row.id,
            "returnNumber": row.return_number,
            "status": row.status,
            "receivedBy": row.received_by,
            "receivedAt": row.received_at.isoformat() if row.received_at else None,
        }
        for row in order.bottle_returns.all().order_by("created_at", "id")
    ]
    customer_name = order.customer.name if order.customer else (order.walk_in_name or "Walk-in Customer")
    warehouse = Warehouse.objects.filter(id=order.warehouse_id).first() if order.warehouse_id else None
    warehouse_name = warehouse.name if warehouse else None
    warehouse_code = warehouse.code if warehouse else None
    return {
        "id": order.id,
        "transactionNumber": order.retail_transaction_number or order.order_number,
        "orderNumber": order.order_number,
        "date": order.created_at.isoformat(),
        "createdAt": order.created_at.isoformat(),
        "customer": (
            {"type": "EXISTING", "id": order.customer_id, "name": customer_name, "contactNumber": order.customer.phone}
            if order.customer
            else {"type": "WALK_IN", "id": None, "name": customer_name, "contactNumber": order.walk_in_contact}
        ),
        "customerType": "EXISTING" if order.customer else "WALK_IN",
        "customerName": customer_name,
        "walkInName": order.walk_in_name,
        "walkInContact": order.walk_in_contact,
        "walkInNotes": order.walk_in_notes,
        "customerPhone": order.customer.phone if order.customer else order.walk_in_contact,
        "warehouseId": order.warehouse_id,
        "warehouseName": warehouse_name,
        "warehouseCode": warehouse_code,
        "staff": {"id": order.created_by_user_id, "name": order.created_by_name},
        "items": items,
        "productTotal": _money_text(order.subtotal),
        "subtotal": _money_text(order.subtotal),
        "emptyBottlesProvided": sum(item.empty_covered_quantity for item in order.items.all()),
        "deposit": _money_text(money(order.total_amount) - money(order.subtotal)),
        "depositTotal": _money_text(money(order.total_amount) - money(order.subtotal)),
        "grandTotal": _money_text(order.total_amount),
        "totalAmount": _money_text(order.total_amount),
        "amountPaid": _money_text(order.amount_paid),
        "remainingBalance": _money_text(order.remaining_balance),
        "paymentStatus": order.payment_status,
        "fulfillmentType": order.fulfillment_type,
        "pickupStatus": order.pickup_status,
        "transactionStatus": order.retail_status,
        "bottleReturns": bottle_returns,
        "cancelledAt": order.cancelled_at.isoformat() if order.cancelled_at else None,
        "cancelledBy": order.cancelled_by_name,
        "cancellationReason": order.cancellation_reason,
    }


@transaction.atomic
def update_retail_payment(order: Order, amount_paid: Any, staff: User) -> Order:
    locked = Order.objects.select_for_update().get(id=order.id, sales_channel=SalesChannel.RETAIL_POS)
    if locked.retail_status == RetailTransactionStatus.CANCELLED:
        raise ValueError("Cancelled retail transactions cannot be paid")
    deposit = money(locked.total_amount) - money(locked.subtotal)
    payment = calculate_payment_summary(money(locked.subtotal), deposit, money(amount_paid))
    locked.amount_paid = payment["amountPaid"]
    locked.remaining_balance = payment["remainingBalance"]
    locked.payment_status = str(payment["paymentStatus"])
    locked.notes = f"{locked.notes or ''}\nPayment updated by {staff.name} at {timezone.now().isoformat()}".strip()
    locked.save(update_fields=["amount_paid", "remaining_balance", "payment_status", "notes", "updated_at"])
    return locked


@transaction.atomic
def update_retail_pickup_status(order: Order, next_status: str, staff: User) -> Order:
    locked = Order.objects.select_for_update().get(id=order.id, sales_channel=SalesChannel.RETAIL_POS)
    if locked.fulfillment_type != RetailFulfillmentType.CUSTOMER_PICKUP:
        raise ValueError("Pickup status applies only to Customer Pickup transactions")
    requested = str(next_status or "").strip().upper()
    if requested == locked.pickup_status:
        return locked
    allowed = {
        RetailPickupStatus.PENDING_PICKUP: {RetailPickupStatus.READY_FOR_PICKUP},
        RetailPickupStatus.READY_FOR_PICKUP: {RetailPickupStatus.PICKED_UP_COMPLETED},
        RetailPickupStatus.PICKED_UP_COMPLETED: set(),
        RetailPickupStatus.CANCELLED: set(),
    }
    if requested not in allowed.get(locked.pickup_status, set()):
        raise ValueError(f"Invalid pickup transition from {locked.pickup_status} to {requested}")
    if requested == RetailPickupStatus.PICKED_UP_COMPLETED:
        consume_order_reservations(locked, staff.name)
        locked.retail_status = RetailTransactionStatus.COMPLETED
        locked.status = OrderStatus.DELIVERED
    locked.pickup_status = requested
    locked.save(update_fields=["pickup_status", "retail_status", "status", "updated_at"])
    return locked


def _restock_consumed_retail_inventory(order: Order, performed_by: str) -> None:
    reservations = list(
        InventoryReservation.objects.select_for_update(of=("self",))
        .select_related("inventory__product", "inventory__warehouse", "stock_batch", "order_item")
        .filter(order_item__order=order, status=ReservationStatus.CONSUMED)
        .order_by("inventory_id", "stock_batch_id", "id")
    )
    for reservation in reservations:
        inventory = Inventory.objects.select_for_update().get(id=reservation.inventory_id)
        product = inventory.product
        standard_cases = max(0, int(reservation.standard_case_quantity or 0))
        quantity_units = max(0, int(reservation.quantity_base_units or 0))
        before = inventory.quantity if standard_cases else inventory_base_units(inventory, product)
        batch = None
        if reservation.stock_batch_id:
            batch = StockBatch.objects.select_for_update().get(id=reservation.stock_batch_id)
        if standard_cases:
            inventory.quantity += standard_cases
            if batch:
                batch.quantity += standard_cases
        else:
            # Opened cases are returned as traceable loose stock; no stock is lost.
            inventory.loose_bottles += quantity_units
            if batch:
                batch.loose_units += quantity_units
        inventory.save(update_fields=["quantity", "loose_bottles", "updated_at"])
        if batch:
            batch.status = "ACTIVE"
            batch.save(update_fields=["quantity", "loose_units", "status", "updated_at"])
        after = inventory.quantity if standard_cases else inventory_base_units(inventory, product)
        InventoryTransaction.objects.create(
            warehouse=inventory.warehouse,
            product=product,
            type="IN",
            quantity=standard_cases if standard_cases else quantity_units,
            quantity_unit=InventoryQuantityUnit.CASE if standard_cases else InventoryQuantityUnit.BASE_UNIT,
            stock_unit_label=("Case" if standard_cases else require_category_spec(product.category)["looseUnit"]),
            previous_stock=before,
            updated_stock=after,
            reference_type="retail_sale_reversal",
            reference_id=order.id,
            order_item_id=reservation.order_item_id,
            mixed_case_component_id=reservation.mixed_case_component_id,
            case_capacity_snapshot=reservation.order_item.case_capacity,
            case_count_snapshot=reservation.order_item.quantity,
            notes=f"Retail sale cancellation restock for {order.retail_transaction_number}",
        )


def _reverse_retail_deposit_and_returns(order: Order, performed_by: str) -> None:
    customer = order.customer
    ledger = _get_or_create_locked_ledger(customer) if customer else None
    originals = list(
        DepositTransaction.objects.select_for_update(of=("self",))
        .filter(order=order, type=DepositTransaction.TransactionType.CHARGE, reference_type="retail_sale")
        .select_related("container_type")
    )
    for original in originals:
        amount = money(original.amount)
        before = money(ledger.balance) if ledger else Decimal("0.00")
        after = money(before - amount) if ledger else Decimal("0.00")
        if ledger:
            ledger.balance = after
            ledger.last_transaction_at = timezone.now()
            ledger.save(update_fields=["balance", "last_transaction_at", "updated_at"])
        DepositTransaction.objects.create(
            customer=customer,
            ledger=ledger,
            type=DepositTransaction.TransactionType.ADJUSTMENT,
            amount=-amount,
            balance_before=before,
            balance_after=after,
            order=order,
            order_item=original.order_item,
            container_type=original.container_type,
            container_count=original.container_count,
            reason=f"Retail cancellation reversal — {order.retail_transaction_number}",
            reference_type="retail_sale_cancellation",
            reference_id=order.id,
            performed_by=performed_by,
        )

    if customer:
        for allocation in _retail_deposit_allocations(order):
            balance = (
                CustomerBottleBalance.objects.select_for_update()
                .filter(customer=customer, container_type_id=allocation["containerTypeId"])
                .first()
            )
            if not balance:
                continue
            eligible = max(0, int(allocation["eligibleUnits"]))
            empties = max(0, int(allocation["emptyUnits"]))
            uncovered = max(0, eligible - empties)
            balance.bottles_outstanding = max(0, balance.bottles_outstanding - uncovered)
            balance.bottles_sold_total = max(0, balance.bottles_sold_total - eligible)
            balance.bottles_returned_total = max(0, balance.bottles_returned_total - empties)
            balance.deposit_balance = money(max(Decimal("0.00"), money(balance.deposit_balance) - money(allocation["deposit"])))
            balance.save(update_fields=["bottles_outstanding", "bottles_sold_total", "bottles_returned_total", "deposit_balance", "updated_at"])
    original_returns = list(order.bottle_returns.select_for_update().all())
    if original_returns:
        # Preserve accepted-return records and append a separate compensating audit entry.
        BottleReturn.objects.create(
            return_number=_next_return_number(),
            customer=customer,
            order=order,
            status=BottleReturn.ReturnStatus.REJECTED,
            received_by=performed_by,
            received_at=timezone.now(),
            notes="Retail cancellation reversal for return(s): "
            + ", ".join(row.return_number for row in original_returns),
        )


@transaction.atomic
def cancel_retail_sale(
    order: Order,
    staff: User,
    reason: str,
    *,
    empties_restored_to_customer: bool,
) -> Order:
    locked = Order.objects.select_for_update().get(id=order.id, sales_channel=SalesChannel.RETAIL_POS)
    if locked.retail_status == RetailTransactionStatus.CANCELLED:
        return locked
    returned_count = sum(locked.items.values_list("empty_covered_quantity", flat=True))
    if returned_count > 0 and not empties_restored_to_customer:
        raise ValueError("Confirm that accepted empties were physically restored or corrected before cancellation")
    if InventoryReservation.objects.filter(order_item__order=locked, status=ReservationStatus.RESERVED).exists():
        release_order_reservations(locked, staff.name)
    if InventoryReservation.objects.filter(order_item__order=locked, status=ReservationStatus.CONSUMED).exists():
        _restock_consumed_retail_inventory(locked, staff.name)
    _reverse_retail_deposit_and_returns(locked, staff.name)
    locked.status = OrderStatus.CANCELLED
    locked.retail_status = RetailTransactionStatus.CANCELLED
    locked.pickup_status = RetailPickupStatus.CANCELLED if locked.fulfillment_type == RetailFulfillmentType.CUSTOMER_PICKUP else RetailPickupStatus.NOT_APPLICABLE
    locked.cancelled_by_user_id = staff.id
    locked.cancelled_by_name = staff.name
    locked.cancellation_reason = str(reason or "").strip() or "Retail transaction cancelled"
    locked.cancelled_at = timezone.now()
    locked.save(
        update_fields=[
            "status",
            "retail_status",
            "pickup_status",
            "cancelled_by_user_id",
            "cancelled_by_name",
            "cancellation_reason",
            "cancelled_at",
            "updated_at",
        ]
    )
    return locked
