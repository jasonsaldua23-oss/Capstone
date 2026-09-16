"""Customer empty-container API endpoints."""

from decimal import Decimal
from typing import Any

from django.db import transaction
from django.db.models import Sum
from django.http import HttpRequest, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from . import views_api as legacy
from .api_utils import error as _err, json_body as _json_body, ok as _ok, to_int as _int
from .bottle_services import (
    get_or_create_product_packaging as _get_or_create_product_packaging,
    is_returnable_product as _is_returnable_product,
)
from .deposit_math import deposit_for_case_and_bottles, full_case_deposit
from .models import (
    Customer,
    CustomerBottleBalance,
    DepositTransaction,
    MixedCaseComponent,
    OrderItem,
    OrderItemType,
    Product,
)


# These serializers and normalizers remain shared with existing order responses.
def _require_auth(request: HttpRequest) -> dict[str, Any] | None:
    return legacy._require_auth(request)


def _normalize_product_unit(value: Any) -> str:
    return legacy._normalize_product_unit(value)


def _customer_payload(customer: Customer) -> dict[str, Any]:
    return legacy._customer_payload(customer)


@require_GET
def customer_empty_bottles_eligible(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p or p.get("type") != "customer":
        return _err("Unauthorized", 401)
    customer_id = p.get("userId")
    customer = Customer.objects.filter(id=customer_id, is_active=True).first()
    if not customer:
        return _err("Customer not found", 404)

    # Find all returnable products purchased by this customer across non-cancelled orders
    order_items = (
        OrderItem.objects.filter(order__customer=customer)
        .exclude(order__status__in=["CANCELLED", "REJECTED"])
        .select_related("product", "order")
        .prefetch_related("mixed_case_components__product")
    )

    # Group purchased containers by product. Mixed-case components have no product
    # on the parent order item, so include each component's actual bottle quantity.
    purchased_bottles_by_product: dict[str, int] = {}
    mixed_component_product_ids: set[str] = set()
    standard_product_ids: set[str] = set()
    for item in order_items:
        if item.item_type == OrderItemType.MIXED_CASE:
            for component in item.mixed_case_components.select_related("product").all():
                product = component.product
                if not product or not product.is_active or not _is_returnable_product(product):
                    continue
                purchased_bottles_by_product[product.id] = (
                    purchased_bottles_by_product.get(product.id, 0)
                    + max(0, _int(component.total_base_units, 0))
                )
                mixed_component_product_ids.add(str(product.id))
            continue
        prod = item.product
        if not prod or not prod.is_active or not _is_returnable_product(prod):
            continue
        pkg, _ = _get_or_create_product_packaging(prod)
        containers_per_case = pkg.containers_per_case or (prod.quantity_per_unit or 24)
        item_unit = str(getattr(item, "product_unit", "") or getattr(item, "unit", "") or getattr(prod, "unit", "") or "").strip().lower()
        quantity_bottles = item.quantity * containers_per_case if item_unit == "case" else item.quantity
        purchased_bottles_by_product[prod.id] = purchased_bottles_by_product.get(prod.id, 0) + max(0, quantity_bottles)
        standard_product_ids.add(str(prod.id))

    recorded_by_product = {
        str(row["reference_id"]): max(0, _int(row["total"], 0))
        for row in DepositTransaction.objects.filter(
            customer=customer,
            type=DepositTransaction.TransactionType.ADJUSTMENT,
            reference_type="product",
            reference_id__in=list(purchased_bottles_by_product.keys()),
            reason__startswith="Customer declared ",
        ).values("reference_id").annotate(total=Sum("container_count"))
    }
    eligible_items = []
    for prod_id, total_bottles_ordered in purchased_bottles_by_product.items():
        product = Product.objects.filter(id=prod_id).first()
        if not product or not _is_returnable_product(product):
            continue

        pkg, container_type = _get_or_create_product_packaging(product)
        containers_per_case = pkg.containers_per_case or (product.quantity_per_unit or 24)
        case_deposit = float(pkg.case_deposit_amount or 42.0)
        unit_deposit = float(pkg.deposit_amount or 2.0)
        full_case_deposit_amount = float(full_case_deposit(unit_deposit, containers_per_case, case_deposit))

        # Mixed-case components can share one container balance. Cap each product
        # by its own declaration history so recording one component does not hide another.
        currently_held_bottles = recorded_by_product.get(str(prod_id), 0)
        available_bottles = max(0, total_bottles_ordered - currently_held_bottles)
        available_cases, available_loose_bottles = divmod(available_bottles, max(1, containers_per_case))
        if available_bottles > 0:
            eligible_items.append({
                "productId": product.id,
                "productName": product.name,
                # Mixed-case components are individual bottles, even when the
                # catalog product is normally sold as a full case.
                "unit": (
                    "bottle"
                    if str(prod_id) in mixed_component_product_ids and str(prod_id) not in standard_product_ids
                    else _normalize_product_unit(getattr(product, "unit", None))
                ),
                "imageUrl": product.image_url,
                "category": product.category,
                "containerTypeId": container_type.id,
                "containerTypeName": container_type.name,
                "containersPerCase": containers_per_case,
                "unitDeposit": unit_deposit,
                # This endpoint exposes the refundable value of one complete case.
                "caseDeposit": full_case_deposit_amount,
                "totalCasesOrdered": total_bottles_ordered // max(1, containers_per_case),
                "totalBottlesOrdered": total_bottles_ordered,
                "currentlyHeldCases": currently_held_bottles // max(1, containers_per_case),
                "currentlyHeldBottles": currently_held_bottles,
                "availableCasesToReturn": available_cases,
                "availableLooseBottlesToReturn": available_loose_bottles,
                "availableBottlesToReturn": available_bottles,
            })

    return _ok({"success": True, "eligibleItems": eligible_items})


@csrf_exempt
@require_http_methods(["POST"])
def customer_record_empty_bottles(request: HttpRequest) -> JsonResponse:
    from .models import DepositTransaction

    p = _require_auth(request)
    if not p or p.get("type") != "customer":
        return _err("Unauthorized", 401)
    customer_id = p.get("userId")
    customer = Customer.objects.filter(id=customer_id, is_active=True).first()
    if not customer:
        return _err("Customer not found", 404)

    body = _json_body(request)
    product_id = str(body.get("productId") or "").strip()
    cases = max(0, _int(body.get("cases"), 0))
    loose_bottles = max(0, _int(body.get("bottles"), 0))
    if not product_id:
        return _err("Product is required", 400)
    if cases <= 0 and loose_bottles <= 0:
        return _err("Record at least one case or loose bottle", 400)

    product = Product.objects.filter(id=product_id, is_active=True).first()
    if not product or not _is_returnable_product(product):
        return _err("Product is not a returnable glass item", 400)

    pkg, container_type = _get_or_create_product_packaging(product)
    containers_per_case = pkg.containers_per_case or (product.quantity_per_unit or 24)
    case_deposit = Decimal(str(pkg.case_deposit_amount or "42.00"))
    unit_deposit = Decimal(str(pkg.deposit_amount or container_type.deposit_amount or "0.00"))
    if loose_bottles >= containers_per_case:
        return _err(f"Loose bottles must be fewer than {containers_per_case}; record a full case instead.", 400)

    order_items = (
        OrderItem.objects.filter(order__customer=customer, product=product)
        .exclude(order__status__in=["CANCELLED", "REJECTED"])
    )
    total_bottles_ordered = sum(
        item.quantity * containers_per_case
        if str(getattr(item, "product_unit", "") or getattr(item, "unit", "") or getattr(product, "unit", "") or "").strip().lower() == "case"
        else item.quantity
        for item in order_items
    )
    total_bottles_ordered += sum(
        max(0, _int(component.total_base_units, 0))
        for component in MixedCaseComponent.objects.filter(
            order_item__order__customer=customer,
            product=product,
        ).exclude(order_item__order__status__in=["CANCELLED", "REJECTED"])
    )
    if total_bottles_ordered <= 0:
        return _err(f"You have no purchase history for {product.name}. Empty bottles can only be recorded for products you purchased.", 400)

    with transaction.atomic():
        balance, _ = CustomerBottleBalance.objects.select_for_update().get_or_create(
            customer=customer,
            container_type=container_type,
            defaults={
                "bottles_outstanding": 0,
                "deposit_balance": Decimal("0.00"),
                "bottles_returned_total": 0,
                "bottles_sold_total": total_bottles_ordered,
            }
        )

        already_recorded = max(0, _int(
            DepositTransaction.objects.filter(
                customer=customer,
                type=DepositTransaction.TransactionType.ADJUSTMENT,
                reference_type="product",
                reference_id=product.id,
                reason__startswith="Customer declared ",
            ).aggregate(total=Sum("container_count"))["total"],
            0,
        ))
        available_bottles = max(0, total_bottles_ordered - already_recorded)
        added_bottles = (cases * containers_per_case) + loose_bottles
        if added_bottles > available_bottles:
            return _err(
                f"You can only record up to {available_bottles} bottle(s) based on your purchase history of {product.name}.",
                400
            )

        # Fix: empty-case credit mirrors the full deposit originally charged.
        added_deposit = deposit_for_case_and_bottles(
            cases=cases,
            loose_bottles=loose_bottles,
            bottle_deposit=unit_deposit,
            containers_per_case=containers_per_case,
            case_deposit=case_deposit,
        )

        balance_before = balance.deposit_balance
        balance.bottles_outstanding += added_bottles
        balance.deposit_balance += added_deposit
        balance.last_return_at = timezone.now()
        balance.save()

        DepositTransaction.objects.create(
            customer=customer,
            type=DepositTransaction.TransactionType.ADJUSTMENT,
            amount=added_deposit,
            balance_before=balance_before,
            balance_after=balance.deposit_balance,
            container_type=container_type,
            container_count=added_bottles,
            reason=f"Customer declared {cases} empty case(s) and {loose_bottles} loose bottle(s) of {product.name}",
            # Fix: preserve the exact product behind this container-level balance.
            reference_type="product",
            reference_id=product.id,
            performed_by=customer.name or "Customer",
        )

    updated_customer = Customer.objects.get(id=customer.id)
    return _ok({
        "success": True,
        "message": f"Successfully recorded {cases} case(s) and {loose_bottles} loose bottle(s) of {product.name}.",
        "user": _customer_payload(updated_customer),
    })


@require_GET
def bottle_returns_collection(_request: HttpRequest) -> JsonResponse:
    return _ok({"success": True, "returns": []})

