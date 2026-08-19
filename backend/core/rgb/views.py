from __future__ import annotations

import json
import logging
from typing import Any

from django.db import transaction
from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from ..auth import decode_token, extract_token
from ..models import (
    BottleReturn,
    ContainerType,
    Customer,
    CustomerBottleBalance,
    CustomerDepositLedger,
    DepositTransaction,
    Order,
    OrderItem,
    Product,
    ProductPackaging,
    TripDropPoint,
)
from .services import (
    calculate_deposit_for_order_item,
    get_container_types_serialized,
    get_customer_bottle_balances,
    get_deposit_ledger_transactions,
    get_or_create_deposit_ledger,
    get_product_packaging_serialized,
    process_bottle_return,
    process_order_deposits,
    reverse_order_deposits,
    serialize_bottle_return,
)

logger = logging.getLogger(__name__)


def _json_body(request: HttpRequest) -> dict[str, Any]:
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return {}


def _ok(data: dict[str, Any], status: int = 200) -> JsonResponse:
    return JsonResponse(data, status=status)


def _err(message: str, status: int = 400) -> JsonResponse:
    return JsonResponse({"success": False, "error": message}, status=status)


def _resolve_customer(request: HttpRequest) -> tuple[Customer | None, JsonResponse | None]:
    """Resolve the authenticated customer from the request token."""
    token = extract_token(request)
    if not token:
        return None, _err("Authentication required", 401)
    payload = decode_token(token)
    if not payload:
        return None, _err("Invalid or expired token", 401)
    customer_id = str(payload.get("userId") or payload.get("id") or "").strip()
    if not customer_id:
        return None, _err("Customer ID not found in token", 401)
    customer = Customer.objects.filter(id=customer_id, is_active=True).first()
    if not customer:
        return None, _err("Customer not found", 404)
    return customer, None


# ==================== Container Types ====================


@csrf_exempt
@require_GET
def list_container_types(request: HttpRequest) -> JsonResponse:
    """GET /api/rgb/container-types"""
    types = get_container_types_serialized()
    return _ok({"success": True, "containerTypes": types})


# ==================== Product Packaging ====================


@csrf_exempt
@require_GET
def product_packaging(request: HttpRequest, product_id: str) -> JsonResponse:
    """GET /api/rgb/products/{product_id}/packaging"""
    packaging = get_product_packaging_serialized(product_id)
    return _ok({"success": True, "packaging": packaging})


# ==================== Deposit Calculation ====================


@csrf_exempt
@require_http_methods(["POST"])
def calculate_deposit(request: HttpRequest) -> JsonResponse:
    """POST /api/rgb/calculate-deposit
    Body: { productId, fullQuantity, emptyReturnedQuantity }
    """
    body = _json_body(request)
    product_id = str(body.get("productId") or "").strip()
    full_qty = int(body.get("fullQuantity") or 0)
    empty_returned = int(body.get("emptyReturnedQuantity") or 0)

    if not product_id:
        return _err("productId is required")
    if full_qty <= 0:
        return _err("fullQuantity must be greater than zero")

    product = Product.objects.filter(id=product_id, is_active=True).first()
    if not product:
        return _err("Product not found", 404)

    result = calculate_deposit_for_order_item(product, full_qty, empty_returned)
    return _ok({"success": True, **result})


# ==================== Customer Bottle Balance ====================


@csrf_exempt
@require_GET
def customer_bottle_balances(request: HttpRequest) -> JsonResponse:
    """GET /api/rgb/customer/balances"""
    customer, error = _resolve_customer(request)
    if error:
        return error

    balances = get_customer_bottle_balances(customer)
    return _ok({"success": True, "balances": balances})


@csrf_exempt
@require_GET
def customer_deposit_ledger(request: HttpRequest) -> JsonResponse:
    """GET /api/rgb/customer/ledger"""
    customer, error = _resolve_customer(request)
    if error:
        return error

    ledger = get_or_create_deposit_ledger(customer)
    transactions = get_deposit_ledger_transactions(customer)
    return _ok({
        "success": True,
        "ledger": {
            "balance": float(ledger.balance),
            "currency": ledger.currency,
            "lastTransactionAt": ledger.last_transaction_at.isoformat() if ledger.last_transaction_at else None,
        },
        "transactions": transactions,
    })


# ==================== Bottle Returns ====================


@csrf_exempt
@require_http_methods(["POST"])
def create_bottle_return(request: HttpRequest) -> JsonResponse:
    """POST /api/rgb/bottle-returns
    Body: {
        orderId (optional),
        tripId (optional),
        dropPointId (optional),
        lines: [{ containerTypeId, quantityClaimed, quantityGradedReusable, quantityGradedDamaged, quantityRejected, notes }],
        receivedBy (optional)
    }
    """
    customer, error = _resolve_customer(request)
    if error:
        return error

    body = _json_body(request)
    order_id = str(body.get("orderId") or "").strip()
    trip_id = str(body.get("tripId") or "").strip()
    drop_point_id = str(body.get("dropPointId") or "").strip()
    lines = body.get("lines") or []
    received_by = str(body.get("receivedBy") or "").strip() or None

    if not lines:
        return _err("At least one return line is required")

    order = None
    if order_id:
        order = Order.objects.filter(id=order_id, customer=customer).first()
        if not order:
            return _err("Order not found", 404)

    drop_point = None
    if drop_point_id:
        drop_point = TripDropPoint.objects.filter(id=drop_point_id).first()

    try:
        bottle_return = process_bottle_return(
            customer=customer,
            order=order,
            trip_id=trip_id,
            drop_point=drop_point,
            lines=lines,
            received_by=received_by,
            performed_by=customer.name,
        )
    except ValueError as e:
        return _err(str(e))

    # Update drop point if provided
    if drop_point:
        drop_point.empties_collected = True
        drop_point.bottle_return_id = bottle_return.id
        drop_point.save(update_fields=["empties_collected", "bottle_return_id", "updated_at"])

    return _ok({
        "success": True,
        "bottleReturn": serialize_bottle_return(bottle_return),
    }, status=201)


@csrf_exempt
@require_GET
def list_bottle_returns(request: HttpRequest) -> JsonResponse:
    """GET /api/rgb/bottle-returns"""
    customer, error = _resolve_customer(request)
    if error:
        return error

    returns = BottleReturn.objects.filter(customer=customer).order_by("-created_at")
    return _ok({
        "success": True,
        "bottleReturns": [serialize_bottle_return(br) for br in returns],
    })


@csrf_exempt
@require_GET
def get_bottle_return(request: HttpRequest, return_id: str) -> JsonResponse:
    """GET /api/rgb/bottle-returns/{return_id}"""
    customer, error = _resolve_customer(request)
    if error:
        return error

    bottle_return = BottleReturn.objects.filter(id=return_id, customer=customer).first()
    if not bottle_return:
        return _err("Bottle return not found", 404)

    return _ok({"success": True, "bottleReturn": serialize_bottle_return(bottle_return)})


# ==================== Admin Endpoints ====================


@csrf_exempt
@require_http_methods(["POST"])
def admin_create_container_type(request: HttpRequest) -> JsonResponse:
    """POST /api/rgb/admin/container-types"""
    body = _json_body(request)
    code = str(body.get("code") or "").strip()
    name = str(body.get("name") or "").strip()
    category = str(body.get("category") or "BOTTLE").strip().upper()
    material = str(body.get("material") or "GLASS").strip().upper()
    deposit_amount = float(body.get("depositAmount") or 0)
    is_returnable = bool(body.get("isReturnable", True))

    if not code or not name:
        return _err("code and name are required")

    if ContainerType.objects.filter(code=code).exists():
        return _err(f"Container type with code '{code}' already exists", 409)

    container_type = ContainerType.objects.create(
        code=code,
        name=name,
        category=category,
        material=material,
        volume_ml=body.get("volumeMl"),
        capacity_units=body.get("capacityUnits"),
        deposit_amount=deposit_amount,
        is_returnable=is_returnable,
        expected_lifespan_cycles=body.get("expectedLifespanCycles"),
    )

    return _ok({
        "success": True,
        "containerType": {
            "id": container_type.id,
            "code": container_type.code,
            "name": container_type.name,
            "category": container_type.category,
            "material": container_type.material,
            "depositAmount": float(container_type.deposit_amount),
            "isReturnable": container_type.is_returnable,
        },
    }, status=201)


@csrf_exempt
@require_http_methods(["POST"])
def admin_create_product_packaging(request: HttpRequest) -> JsonResponse:
    """POST /api/rgb/admin/product-packaging"""
    body = _json_body(request)
    product_id = str(body.get("productId") or "").strip()
    container_type_id = str(body.get("containerTypeId") or "").strip()
    deposit_amount = float(body.get("depositAmount") or 0)
    case_deposit_amount = float(body.get("caseDepositAmount") or 0)
    is_returnable = bool(body.get("isReturnable", True))
    is_primary = bool(body.get("isPrimary", False))

    if not product_id or not container_type_id:
        return _err("productId and containerTypeId are required")

    product = Product.objects.filter(id=product_id).first()
    if not product:
        return _err("Product not found", 404)

    container_type = ContainerType.objects.filter(id=container_type_id).first()
    if not container_type:
        return _err("Container type not found", 404)

    if ProductPackaging.objects.filter(product=product, container_type=container_type).exists():
        return _err("This product already has this container type assigned", 409)

    packaging = ProductPackaging.objects.create(
        product=product,
        container_type=container_type,
        deposit_amount=deposit_amount,
        case_deposit_amount=case_deposit_amount,
        is_returnable=is_returnable,
        is_primary=is_primary,
        units_per_container=int(body.get("unitsPerContainer", 1)),
        containers_per_case=int(body.get("containersPerCase", 24)),
    )

    # Update product packaging_type if returnable
    if is_returnable and product.packaging_type == Product.PackagingType.NON_RETURNABLE:
        product.packaging_type = Product.PackagingType.RETURNABLE
        product.save(update_fields=["packaging_type", "updated_at"])

    return _ok({
        "success": True,
        "packaging": {
            "id": packaging.id,
            "productId": packaging.product_id,
            "containerTypeId": packaging.container_type_id,
            "depositAmount": float(packaging.deposit_amount),
            "caseDepositAmount": float(packaging.case_deposit_amount),
            "isReturnable": packaging.is_returnable,
            "isPrimary": packaging.is_primary,
        },
    }, status=201)


@csrf_exempt
@require_GET
def admin_list_bottle_returns(request: HttpRequest) -> JsonResponse:
    """GET /api/rgb/admin/bottle-returns"""
    returns = BottleReturn.objects.select_related("customer").order_by("-created_at")[:100]
    return _ok({
        "success": True,
        "bottleReturns": [serialize_bottle_return(br) for br in returns],
    })


@csrf_exempt
@require_GET
def admin_customer_balances(request: HttpRequest, customer_id: str) -> JsonResponse:
    """GET /api/rgb/admin/customers/{customer_id}/balances"""
    customer = Customer.objects.filter(id=customer_id).first()
    if not customer:
        return _err("Customer not found", 404)

    balances = get_customer_bottle_balances(customer)
    ledger = get_or_create_deposit_ledger(customer)
    transactions = get_deposit_ledger_transactions(customer, limit=100)

    return _ok({
        "success": True,
        "customerId": customer.id,
        "customerName": customer.name,
        "ledger": {
            "balance": float(ledger.balance),
            "currency": ledger.currency,
        },
        "balances": balances,
        "transactions": transactions,
    })
