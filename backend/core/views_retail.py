"""Retail POS API endpoints extracted from the legacy API controller."""

from datetime import date
from typing import Any

from django.core import signing
from django.db import IntegrityError
from django.db.models import Prefetch, Q
from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from .api_utils import error as _err, json_body as _json_body, ok as _ok
from .models import (
    Customer,
    Inventory,
    InventoryTransaction,
    Order,
    Product,
    RoleType,
    SalesChannel,
    User,
    Warehouse,
)
from .retail_pos import (
    cancel_retail_sale,
    create_retail_sale,
    quote_retail_cart,
    serialize_retail_product,
    serialize_retail_quote,
    serialize_retail_sale,
)
# Transitional imports preserve the controller's existing authorization, sample-data,
# and pagination behavior while Retail POS moves behind its own module boundary.
from . import views_api as legacy


# Resolved through views_api so tests that patch these keep applying here.
def _require_staff(request: HttpRequest):
    return legacy._require_staff(request)


def _pagination(request: HttpRequest) -> tuple[int, int, int]:
    return legacy._pagination(request)


def _real_products(queryset):
    return legacy._real_products(queryset)


def _get_allowed_warehouse_ids_for_staff(user_id: str) -> set[str]:
    return legacy._get_allowed_warehouse_ids_for_staff(user_id)

RETAIL_QUOTE_SIGNING_SALT = "retail-pos-quote"
RETAIL_QUOTE_MAX_AGE_SECONDS = 600


def _require_retail_warehouse(request: HttpRequest) -> tuple[dict[str, Any] | None, Warehouse | None, JsonResponse | None]:
    """Restrict Retail sales to active warehouse staff and administrators."""
    payload, error = _require_staff(request)
    if error:
        return None, None, error
    role = str(payload.get("role") or "").strip().upper()
    if role not in (RoleType.WAREHOUSE_STAFF, RoleType.ADMIN, RoleType.SUPER_ADMIN):
        return None, None, _err("Retail is available only to warehouse staff and administrators", 403)
    staff_id = str(payload.get("userId") or "").strip()
    if role in (RoleType.ADMIN, RoleType.SUPER_ADMIN):
        requested_id = str(request.GET.get("warehouseId") or "").strip()
        if request.method != "GET":
            requested_id = str(_json_body(request).get("warehouseId") or requested_id).strip()
        warehouse = Warehouse.objects.filter(id=requested_id).first() if requested_id else None
        if warehouse is None:
            warehouse = Warehouse.objects.first()
        return payload, warehouse, None
    if not User.objects.filter(id=staff_id, role=RoleType.WAREHOUSE_STAFF, is_active=True).exists():
        return None, None, _err("Warehouse staff account is unavailable", 403)
    allowed_ids = _get_allowed_warehouse_ids_for_staff(staff_id)
    requested_id = str(request.GET.get("warehouseId") or "").strip()
    if request.method != "GET":
        requested_id = str(_json_body(request).get("warehouseId") or requested_id).strip()
    if requested_id and requested_id not in allowed_ids:
        return None, None, _err("You are not assigned to the selected warehouse", 403)
    warehouse_id = requested_id or next(iter(sorted(allowed_ids)), "")
    warehouse = Warehouse.objects.filter(id=warehouse_id).first()
    if warehouse is None:
        return None, None, _err("No warehouse is assigned to this staff account", 403)
    return payload, warehouse, None


def _retail_error(exc: ValueError) -> JsonResponse:
    message = str(exc)
    conflict_markers = ("insufficient", "changed", "unavailable", "refresh")
    status = 409 if any(marker in message.lower() for marker in conflict_markers) else 400
    return _err(message, status)


def _retail_sale_queryset(warehouse: Warehouse | None = None):
    # Fix: Order stores warehouse_id as a scalar field, so Django cannot follow
    # a nonexistent "warehouse" relation with select_related().
    qs = (
        Order.objects.select_related("customer", "retail_sale", "retail_sale__created_by_user")
        .prefetch_related(
            "items__product",
            "items__mixed_case_components__product",
            "bottle_returns",
            Prefetch(
                "items__inventory_transactions",
                queryset=InventoryTransaction.objects.filter(type="OUT", reference_type="retail_sale")
                .order_by("created_at", "id"),
                to_attr="_retail_out_transactions",
            ),
        )
        .filter(sales_channel=SalesChannel.RETAIL_POS)
    )
    if warehouse is not None:
        qs = qs.filter(warehouse_id=warehouse.id)
    return qs


@require_GET
def retail_products(request: HttpRequest) -> JsonResponse:
    _payload_data, warehouse, error = _require_retail_warehouse(request)
    if error:
        return error
    if warehouse is None:
        warehouse = Warehouse.objects.first()
        if warehouse is None:
            return _err("No warehouse registered", 404)
    page, size, offset = _pagination(request)
    size = min(size, 100)
    products = _real_products(Product.objects.filter(is_active=True))
    search = str(request.GET.get("search") or "").strip()
    if search:
        products = products.filter(Q(name__icontains=search) | Q(sku__icontains=search))
    total = products.count()
    rows = list(products[offset : offset + size])
    inventories = {
        inv.product_id: inv
        for inv in Inventory.objects.filter(
            warehouse_id=warehouse.id, product_id__in=[product.id for product in rows]
        )
    }
    return _ok({
        "success": True,
        "products": [serialize_retail_product(product, inventories.get(product.id)) for product in rows],
        "total": total,
        "page": page,
        "pageSize": size,
        "totalPages": (total + size - 1) // size,
    })


@csrf_exempt
@require_http_methods(["POST"])
def retail_quote(request: HttpRequest) -> JsonResponse:
    _payload_data, warehouse, error = _require_retail_warehouse(request)
    if error:
        return error
    if warehouse is None:
        return _err("warehouseId is required for retail quotes", 400)
    body = _json_body(request)
    if str(body.get("customerType") or "WALK_IN").strip().upper() == "EXISTING":
        customer_id = str(body.get("customerId") or "").strip()
        if not Customer.objects.filter(id=customer_id, is_active=True).exists():
            return _err("The selected customer is unavailable; refresh or use Walk-in Customer", 409)
    try:
        quote = quote_retail_cart(warehouse=warehouse, payload=body)
    except ValueError as exc:
        return _retail_error(exc)
    quote_token = signing.dumps(
        {"fingerprint": quote["fingerprint"], "warehouseId": warehouse.id},
        salt=RETAIL_QUOTE_SIGNING_SALT,
        compress=True,
    )
    return _ok({"success": True, "quote": serialize_retail_quote(quote), "quoteToken": quote_token})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def retail_sales_collection(request: HttpRequest) -> JsonResponse:
    payload_data, warehouse, error = _require_retail_warehouse(request)
    if error:
        return error
    if request.method == "POST":
        if warehouse is None:
            return _err("warehouseId is required to create a retail sale", 400)
        body = _json_body(request)
        request_id = str(body.get("idempotencyKey") or "").strip()
        if not request_id:
            return _err("idempotencyKey is required")
        existing_sale = _retail_sale_queryset(warehouse).filter(retail_sale__retail_request_id=request_id).first()
        if existing_sale is not None:
            return _ok({"success": True, "sale": serialize_retail_sale(existing_sale), "created": False})
        quote_token = str(body.get("quoteToken") or "").strip()
        if not quote_token:
            return _err("quoteToken is required")
        try:
            signed_quote = signing.loads(
                quote_token,
                salt=RETAIL_QUOTE_SIGNING_SALT,
                max_age=RETAIL_QUOTE_MAX_AGE_SECONDS,
            )
        except signing.BadSignature:
            return _err("Quote expired or invalid; refresh the quote", 409)
        if str(signed_quote.get("warehouseId") or "") != warehouse.id:
            return _err("Quote belongs to a different warehouse; refresh the quote", 409)
        staff = User.objects.filter(id=payload_data.get("userId"), is_active=True).first()
        if staff is None:
            return _err("Staff account is unavailable", 403)
        try:
            sale, created = create_retail_sale(
                warehouse=warehouse,
                staff=staff,
                payload=body,
                expected_fingerprint=str(signed_quote.get("fingerprint") or ""),
            )
        except IntegrityError:
            existing = Order.objects.filter(
                retail_sale__retail_request_id=str(body.get("idempotencyKey") or "").strip(),
                sales_channel=SalesChannel.RETAIL_POS,
                warehouse_id=warehouse.id,
            ).first()
            if existing is None:
                return _err("The retail sale could not be saved", 409)
            sale, created = existing, False
        except ValueError as exc:
            return _retail_error(exc)
        sale = _retail_sale_queryset(warehouse).get(id=sale.id)
        return _ok({"success": True, "sale": serialize_retail_sale(sale), "created": created}, 201 if created else 200)

    page, size, offset = _pagination(request)
    queryset = _retail_sale_queryset(warehouse)
    search = str(request.GET.get("search") or "").strip()
    if search:
        queryset = queryset.filter(
            Q(retail_sale__retail_transaction_number__icontains=search)
            | Q(customer__name__icontains=search)
            | Q(retail_sale__walk_in_name__icontains=search)
            | Q(retail_sale__walk_in_contact__icontains=search)
        )
    field_filters = {
        "transactionStatus": "retail_sale__retail_status",
    }
    for query_name, model_name in field_filters.items():
        value = str(request.GET.get(query_name) or "").strip().upper()
        if value:
            queryset = queryset.filter(**{model_name: value})
    for query_name, lookup in (("dateFrom", "created_at__date__gte"), ("dateTo", "created_at__date__lte")):
        value = str(request.GET.get(query_name) or "").strip()
        if value:
            try:
                parsed_date = date.fromisoformat(value)
            except ValueError:
                return _err(f"{query_name} must use YYYY-MM-DD")
            queryset = queryset.filter(**{lookup: parsed_date})
    queryset = queryset.order_by("-created_at")
    total = queryset.count()
    rows = list(queryset[offset : offset + size])
    return _ok({
        "success": True,
        "sales": [serialize_retail_sale(row) for row in rows],
        "total": total,
        "page": page,
        "pageSize": size,
        "totalPages": (total + size - 1) // size,
    })


@require_GET
def retail_sale_detail(request: HttpRequest, sale_id: str) -> JsonResponse:
    _payload_data, warehouse, error = _require_retail_warehouse(request)
    if error:
        return error
    sale = _retail_sale_queryset(warehouse).filter(id=sale_id).first()
    if sale is None:
        return _err("Retail transaction not found", 404)
    return _ok({"success": True, "sale": serialize_retail_sale(sale)})


@csrf_exempt
@require_http_methods(["POST"])
def retail_sale_cancel(request: HttpRequest, sale_id: str) -> JsonResponse:
    payload_data, warehouse, error = _require_retail_warehouse(request)
    if error:
        return error
    sale = _retail_sale_queryset(warehouse).filter(id=sale_id).first()
    if sale is None:
        return _err("Retail transaction not found", 404)
    staff = User.objects.filter(id=payload_data.get("userId"), is_active=True).first()
    if staff is None:
        return _err("Staff account is unavailable", 403)
    body = _json_body(request)
    try:
        sale = cancel_retail_sale(
            order=sale,
            staff=staff,
            reason=str(body.get("reason") or "").strip(),
            empties_restored_to_customer=bool(body.get("emptiesRestoredToCustomer")),
        )
    except ValueError as exc:
        return _retail_error(exc)
    sale = _retail_sale_queryset(warehouse).get(id=sale.id)
    return _ok({"success": True, "sale": serialize_retail_sale(sale)})
