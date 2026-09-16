"""Product catalogue endpoints."""

import logging
import re
import secrets
from decimal import Decimal
from typing import Any

from django.db import IntegrityError, transaction
from django.db.models import Prefetch, Q, Sum
from django.http import HttpRequest, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from . import views_api as legacy
from .api_utils import (
    error as _err,
    is_whole_number as _is_whole_number,
    json_body as _json_body,
    ok as _ok,
    to_int as _int,
)
from .beverage_categories import category_spec
from .bottle_services import (
    coerce_deposit_amount as _coerce_deposit_amount,
    get_or_create_product_packaging as _get_or_create_product_packaging,
    is_returnable_product as _is_returnable_product,
)
from .models import (
    Inventory,
    InventoryQuantityUnit,
    InventoryReservation,
    InventoryTransaction,
    OrderItem,
    Product,
    ProductPackaging,
    ReservationStatus,
    StockBatch,
    Warehouse,
)
from .product_weights import resolve_product_weight

logger = logging.getLogger(__name__)


# Helpers owned by sibling modules. Routing them through views_api keeps
# a single resolution point, so tests that patch there still apply.


def _create_staff_notifications(*, title: str, message: str, notification_type: str='INVENTORY', reference_type: str | None=None, reference_id: str | None=None) -> None:
    return legacy._create_staff_notifications(title=title, message=message, notification_type=notification_type, reference_type=reference_type, reference_id=reference_id)


def _get_allowed_warehouse_ids_for_staff(user_id: str) -> set[str]:
    return legacy._get_allowed_warehouse_ids_for_staff(user_id)


def _normalize_product_unit(raw: Any) -> str:
    return legacy._normalize_product_unit(raw)


def _pagination(request: HttpRequest) -> tuple[int, int, int]:
    return legacy._pagination(request)


def _real_products(qs):
    return legacy._real_products(qs)


def _real_warehouses(qs):
    return legacy._real_warehouses(qs)


def _require_auth(request: HttpRequest) -> dict[str, Any] | None:
    return legacy._require_auth(request)


def _require_warehouse_operator(request: HttpRequest) -> tuple[dict[str, Any] | None, JsonResponse | None]:
    return legacy._require_warehouse_operator(request)


def _serialize_model(obj: Any, include: dict[str, Any] | None=None, exclude: set[str] | None=None) -> dict[str, Any]:
    return legacy._serialize_model(obj, include, exclude)


def _warehouse_capacity_error(warehouse: Warehouse, *, incoming_cases: int=0, proposed_capacity: int | None=None) -> str | None:
    return legacy._warehouse_capacity_error(warehouse, incoming_cases=incoming_cases, proposed_capacity=proposed_capacity)


def _has_duplicate_product_identity(
    *,
    name: Any,
    sizes: Any,
    category: Any,
    exclude_product_id: str | None = None,
) -> bool:
    """Match product variants by normalized name, category, and overlapping size."""
    normalize = lambda value: " ".join(str(value or "").split()).casefold()
    candidate_name = normalize(name)
    candidate_category = normalize(category)
    candidate_sizes = {
        normalize(value) for value in (sizes if isinstance(sizes, list) else []) if normalize(value)
    }
    if not candidate_name:
        return False

    # Archived variants still reserve their identity so restoring them cannot create duplicates.
    products = Product.objects.all().only("id", "name", "category", "sizes")
    if exclude_product_id:
        products = products.exclude(id=exclude_product_id)
    for product in products:
        if normalize(product.name) != candidate_name or normalize(product.category) != candidate_category:
            continue
        existing_sizes = {
            normalize(value) for value in (product.sizes if isinstance(product.sizes, list) else []) if normalize(value)
        }
        # Products with no recorded size also conflict with the same empty-size identity.
        if candidate_sizes.intersection(existing_sizes) or (not candidate_sizes and not existing_sizes):
            return True
    return False


def _generated_product_sku(product: Product) -> str:
    """Build an identity SKU whose stable suffix belongs only to this product."""
    def part(value: Any, fallback: str, length: int) -> str:
        normalized = re.sub(r"[^A-Z0-9]", "", str(value or fallback).upper())[:length]
        return normalized or fallback

    size = str((product.sizes or [""])[0] or "")
    suffix = part(product.id, secrets.token_hex(3).upper(), 25)[-5:]
    candidate = f"{part(product.name, 'PRD', 4)}-{part(product.unit, 'UNT', 3)}-{part(size, 'SIZE', 4)}-{suffix}"
    if not Product.objects.exclude(id=product.id).filter(sku=candidate).exists():
        return candidate
    return f"{candidate}-{secrets.token_hex(2).upper()}"


@csrf_exempt
@require_http_methods(["GET", "POST"])
def products_collection(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    if request.method == "GET":
        page, size, off = _pagination(request)
        show_archived = str(request.GET.get("archived") or "").strip().lower() in {"1", "true", "yes"}
        # Archived products use the same serializer but remain separate from the active catalog.
        qs = _real_products(Product.objects.filter(is_active=not show_archived)).order_by("name")
        s = str(request.GET.get("search", "")).strip()
        if s:
            qs = qs.filter(Q(name__icontains=s) | Q(sku__icontains=s))
        total = qs.count()
        rows = list(qs[off : off + size])
        product_ids = [x.id for x in rows]
        inventory_rows = list(
            Inventory.objects.filter(product_id__in=product_ids)
            .filter(product__in=_real_products(Product.objects.all()))
            .filter(warehouse__in=_real_warehouses(Warehouse.objects.all()))
            .select_related("product").prefetch_related(
                Prefetch("batches", to_attr="_availability_batches"),
                Prefetch("reservations", queryset=InventoryReservation.objects.filter(status=ReservationStatus.RESERVED), to_attr="_active_reservations"),
            )
        )
        inventory_by_product: dict[str, list[dict[str, int]]] = {}
        from .mixed_case import available_base_units, allocatable_standard_cases
        for inv in inventory_rows:
            pid = str(inv.product_id or "")
            if not pid:
                continue
            inventory_by_product.setdefault(pid, []).append(
                {
                    "quantity": int(inv.quantity or 0),
                    "reservedQuantity": int(inv.reserved_quantity or 0),
                    "sellableCases": allocatable_standard_cases(inv),
                    "sellableBaseUnits": available_base_units(inv),
                }
            )

        packagings = list(
            ProductPackaging.objects.filter(product_id__in=product_ids, is_active=True)
            .select_related("container_type")
        )
        packaging_by_product: dict[str, ProductPackaging] = {p.product_id: p for p in packagings}

        products_out = []
        for product in rows:
            row = _serialize_model(product)
            inventory_entries = inventory_by_product.get(product.id, [])
            available_quantity = sum(
                item["sellableCases"] for item in inventory_entries
            )
            row["inventory"] = inventory_entries
            # Fix: catalog availability uses the same expiry rules as reservation.
            row["availableQuantity"] = available_quantity
            row["availableBaseUnits"] = sum(item["sellableBaseUnits"] for item in inventory_entries)

            qty_per_unit = max(1, int(product.quantity_per_unit or 1)) if product.quantity_per_unit else 1
            if product.price and product.price > 0:
                row["baseUnitPrice"] = round(float(product.price) / qty_per_unit, 2)
            elif hasattr(product, "retail_unit_price") and product.retail_unit_price:
                row["baseUnitPrice"] = float(product.retail_unit_price)
            else:
                row["baseUnitPrice"] = 0.0

            pkg = packaging_by_product.get(product.id)
            if pkg:
                row["packagingType"] = "RETURNABLE" if pkg.is_returnable else "NON_RETURNABLE"
                row["containerTypeId"] = pkg.container_type_id
                row["containerTypeName"] = pkg.container_type.name if pkg.container_type else None
                row["containersPerCase"] = pkg.containers_per_case
                row["depositAmount"] = float(pkg.deposit_amount)
                row["caseDepositAmount"] = float(pkg.case_deposit_amount)
            elif _is_returnable_product(product):
                pkg_obj, ct_obj = _get_or_create_product_packaging(product)
                row["packagingType"] = "RETURNABLE"
                row["containerTypeId"] = ct_obj.id
                row["containerTypeName"] = ct_obj.name
                row["containersPerCase"] = pkg_obj.containers_per_case
                row["depositAmount"] = float(pkg_obj.deposit_amount)
                row["caseDepositAmount"] = float(pkg_obj.case_deposit_amount)

            products_out.append(row)

        return _ok({"success": True, "products": products_out, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    # Product registration is a warehouse operation; admins monitor the catalog.
    _, err = _require_warehouse_operator(request)
    if err:
        return err
    body = _json_body(request)
    if not body.get("sku") or not body.get("name"):
        return _err("sku and name are required")

    warehouse_id = str(body.get("warehouseId") or "").strip()
    if not warehouse_id:
        return _err("warehouseId is required", 400)

    warehouse = Warehouse.objects.filter(id=warehouse_id).first()
    if not warehouse:
        return _err("Warehouse not found", 404)

    try:
        product_unit = _normalize_product_unit(body.get("unit"))
    except ValueError as exc:
        return _err(str(exc), 400)
    raw_sizes = body.get("sizes")
    normalized_sizes = [str(value).strip() for value in raw_sizes] if isinstance(raw_sizes, list) else []
    normalized_sizes = [value for value in normalized_sizes if value]
    category_value = str(body.get("category") or "").strip() or None
    # Reject duplicate catalog variants before creating inventory for them.
    if _has_duplicate_product_identity(
        name=body.get("name"), sizes=normalized_sizes, category=category_value
    ):
        return _err("A product with the same name, size, and category already exists.", 409)
    quantity_per_unit = _int(body.get("quantityPerCase", body.get("quantityPerUnit")), 0)
    if quantity_per_unit <= 0:
        return _err("quantityPerUnit must be a positive integer", 400)
    # Fix: the server derives the complete case/pack weight so clients cannot
    # create a product whose load weight is missing or zero.
    product_weight = resolve_product_weight(
        sizes=normalized_sizes,
        quantity_per_unit=quantity_per_unit,
        category=category_value,
        supplied_weight=body.get("weight"),
    )
    if product_weight is None:
        return _err("A valid product size and quantity are required to calculate weight", 400)
    raw_initial_quantity = (
        body.get("availableQuantity")
        if "availableQuantity" in body
        else body.get("initialQuantity", 0)
    )
    # Fix: int(1.5) silently becomes 1, which records stock that was never supplied.
    if not _is_whole_number(raw_initial_quantity):
        return _err("availableQuantity must be a non-negative integer", 400)
    initial_quantity = _int(raw_initial_quantity, 0)
    if initial_quantity < 0:
        return _err("availableQuantity must be a non-negative integer", 400)

    # Fix: validate deposits before creating any product or inventory records.
    deposit_allowed = bool((category_spec(category_value) or {}).get("depositAllowed"))
    raw_bottle_deposit = body.get("bottleDeposit") if "bottleDeposit" in body else body.get("depositAmount")
    raw_case_deposit = body.get("caseDeposit") if "caseDeposit" in body else body.get("caseDepositAmount")
    bottle_deposit, bottle_error = _coerce_deposit_amount(raw_bottle_deposit) if deposit_allowed else (None, None)
    if bottle_error:
        return _err(bottle_error, 400)
    case_deposit, case_error = _coerce_deposit_amount(raw_case_deposit) if deposit_allowed else (None, None)
    if case_error:
        return _err(case_error, 400)

    try:
        with transaction.atomic():
            # Added: lock the warehouse while checking its shared capacity so
            # simultaneous stock-ins cannot both claim the same remaining space.
            warehouse = Warehouse.objects.select_for_update().get(id=warehouse.id)
            capacity_error = _warehouse_capacity_error(warehouse, incoming_cases=initial_quantity)
            if capacity_error:
                return _err(capacity_error, 400)
            prod = Product.objects.create(
                sku=str(body["sku"]).strip(),
                name=str(body["name"]).strip(),
                image_url=body.get("imageUrl"),
                unit=product_unit,
                weight=product_weight,
                price=float(body.get("price") or 0),
                category=category_value,
                sizes=normalized_sizes,
                quantity_per_unit=quantity_per_unit,
                is_active=bool(body.get("isActive", True)),
            )

            # Opening stock must have a source batch so availability, FEFO, and
            # later stock-out history all agree on the same physical quantity.
            inventory = Inventory.objects.create(
                warehouse=warehouse,
                product=prod,
                quantity=initial_quantity,
                reserved_quantity=0,
                threshold=max(1, int(initial_quantity * 0.15)) if initial_quantity > 0 else 0,
                last_restocked_at=timezone.now(),
            )
            if initial_quantity > 0:
                opening_batch = StockBatch.objects.create(
                    batch_number=f"OPENING-{prod.id}",
                    inventory=inventory,
                    quantity=initial_quantity,
                    receipt_date=timezone.now(),
                    status="ACTIVE",
                )
                InventoryTransaction.objects.create(
                    warehouse=warehouse,
                    product=prod,
                    type="IN",
                    quantity=initial_quantity,
                    quantity_unit=InventoryQuantityUnit.CASE,
                    stock_unit_label="Case",
                    previous_stock=0,
                    updated_stock=initial_quantity,
                    reference_type="stock_batch",
                    reference_id=opening_batch.id,
                    notes="Opening stock recorded when the product was registered",
                )
            actor_name = str(p.get("name") or "Staff").strip() or "Staff"
            _create_staff_notifications(
                title="New product registered",
                message=f"{actor_name} registered {prod.name} ({prod.sku}) in {warehouse.name} with available quantity {initial_quantity}.",
                reference_type="product",
                reference_id=prod.id,
            )

            # Create or update packaging / deposit if specified.
            # Container deposits only exist for returnable (glass) categories, so
            # ignore any amounts sent for a category that does not allow them.
            bottle_deposit = bottle_deposit or 0
            case_deposit = case_deposit or 0
            if bottle_deposit > 0 or case_deposit > 0 or _is_returnable_product(prod):
                pkg_obj, ct_obj = _get_or_create_product_packaging(prod)
                if bottle_deposit > 0:
                    pkg_obj.deposit_amount = Decimal(str(round(bottle_deposit, 2)))
                    ct_obj.deposit_amount = Decimal(str(round(bottle_deposit, 2)))
                    ct_obj.save(update_fields=["deposit_amount"])
                if case_deposit > 0:
                    pkg_obj.case_deposit_amount = Decimal(str(round(case_deposit, 2)))
                pkg_obj.save(update_fields=["deposit_amount", "case_deposit_amount"])

        return _ok({"success": True, "product": _serialize_model(prod)}, 201)
    except Exception as e:
        return _err(str(e), 500)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
def product_detail(request: HttpRequest, product_id: str) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    try:
        prod = Product.objects.get(id=product_id)
    except Product.DoesNotExist:
        return _err("Product not found", 404)
    if request.method == "GET":
        return _ok({"success": True, "product": _serialize_model(prod)})
    # Product edits, archiving, and restoration are limited to warehouse staff.
    _, err = _require_warehouse_operator(request)
    if err:
        return err
    if request.method == "DELETE":
        actor_name = str(p.get("name") or "Staff").strip() or "Staff"
        product_name = str(prod.name or "Product").strip() or "Product"
        product_sku = str(prod.sku or "").strip()
        inventory_rows = Inventory.objects.filter(product_id=prod.id).values(
            "warehouse__name",
            "quantity",
            "loose_bottles",
            "reserved_quantity",
        )
        total_cases = 0
        total_loose = 0
        total_reserved = 0
        for row in inventory_rows:
            total_cases += max(0, _int(row.get("quantity"), 0))
            total_loose += max(0, _int(row.get("loose_bottles"), 0))
            total_reserved += max(0, _int(row.get("reserved_quantity"), 0))
        active_reservation_units = max(0, _int(
            InventoryReservation.objects.filter(
                product_id=prod.id,
                status=ReservationStatus.RESERVED,
            ).aggregate(total=Sum("quantity_base_units")).get("total"),
            0,
        ))
        if total_cases > 0 or total_loose > 0 or total_reserved > 0 or active_reservation_units > 0:
            return _err(
                (
                    "Cannot archive product while stock or an order reservation still exists. "
                    f"Remaining: {total_cases} case(s), {total_loose} loose bottle(s), "
                    f"{max(total_reserved, active_reservation_units)} reserved."
                ),
                409,
            )
        # Archive zero-stock products so protected transaction and packaging records
        # remain available for audit history while active catalog queries hide them.
        try:
            with transaction.atomic():
                linked_order_items = OrderItem.objects.filter(product_id=prod.id)
                for item in linked_order_items:
                    updates: list[str] = []
                    if not str(getattr(item, "product_name", "") or "").strip():
                        item.product_name = product_name
                        updates.append("product_name")
                    if not str(getattr(item, "product_sku", "") or "").strip():
                        item.product_sku = product_sku or None
                        updates.append("product_sku")
                    if not str(getattr(item, "product_unit", "") or "").strip():
                        item.product_unit = _normalize_product_unit(getattr(prod, "unit", None))
                        updates.append("product_unit")
                    if updates:
                        item.save(update_fields=updates)
                prod.is_active = False
                prod.save(update_fields=["is_active", "updated_at"])
        except IntegrityError as exc:
            logger.exception("Product archive integrity error for product %s", product_id)
            return _err(f"Archive blocked by a system constraint: {str(exc)}", 409)
        except Exception as exc:
            logger.exception("Unexpected product archive error for product %s", product_id)
            return _err(f"Failed to archive product: {str(exc)}", 500)
        _create_staff_notifications(
            title="Product archived",
            message=f"{actor_name} archived {product_name}{f' ({product_sku})' if product_sku else ''}.",
            reference_type="product",
            reference_id=product_id,
        )
        return _ok({"success": True, "product": _serialize_model(prod)})
    previous_name = str(prod.name or "").strip()
    previous_sku = str(prod.sku or "").strip()
    previous_identity = (
        previous_name.casefold(),
        str(prod.unit or "").strip().casefold(),
        tuple(str(value or "").strip().casefold() for value in (prod.sizes or [])),
    )
    body = _json_body(request)
    requested_warehouse_id = str(body.get("warehouseId") or "").strip()
    if requested_warehouse_id:
        # Products are global catalog records, but a supplied warehouse context
        # must be real and belong to the acting warehouse operator.
        if not Warehouse.objects.filter(id=requested_warehouse_id).exists():
            return _err("Warehouse not found", 400)
        allowed_warehouse_ids = _get_allowed_warehouse_ids_for_staff(str(p.get("userId") or ""))
        if requested_warehouse_id not in allowed_warehouse_ids:
            return _err("Access denied for this warehouse", 403)
    if "unit" in body:
        try:
            prod.unit = _normalize_product_unit(body.get("unit"))
        except ValueError as exc:
            return _err(str(exc), 400)
    if "quantityPerCase" in body or "quantityPerUnit" in body:
        prod.quantity_per_unit = _int(body.get("quantityPerCase", body.get("quantityPerUnit")), 0) or None
    mapping = [("name", "name"), ("imageUrl", "image_url"), ("price", "price")]
    for key, attr in mapping:
        if key in body:
            setattr(prod, attr, body.get(key))
    if "category" in body:
        prod.category = str(body.get("category") or "").strip() or None
    if "sizes" in body:
        raw_sizes = body.get("sizes")
        if not isinstance(raw_sizes, list):
            return _err("sizes must be an array", 400)
        prod.sizes = [str(value).strip() for value in raw_sizes if str(value).strip()]
    current_identity = (
        str(prod.name or "").strip().casefold(),
        str(prod.unit or "").strip().casefold(),
        tuple(str(value or "").strip().casefold() for value in (prod.sizes or [])),
    )
    if current_identity != previous_identity:
        # Fix: identity edits regenerate the SKU so it remains aligned with the
        # product name, order format, and size shown throughout inventory.
        prod.sku = _generated_product_sku(prod)
    elif "sku" in body:
        prod.sku = str(body.get("sku") or "").strip()
    # Exclude the current row so unchanged edits remain valid, while changing a
    # product into another existing name/size/category combination is rejected.
    if _has_duplicate_product_identity(
        name=prod.name,
        sizes=prod.sizes,
        category=prod.category,
        exclude_product_id=prod.id,
    ):
        return _err("A product with the same name, size, and category already exists.", 409)
    weight_inputs = {"sizes", "quantityPerCase", "quantityPerUnit", "category", "weight"}
    if weight_inputs.intersection(body):
        # Fix: editing size/category/quantity must update the stored load weight
        # using the same authoritative calculation as product registration.
        product_weight = resolve_product_weight(
            sizes=prod.sizes,
            quantity_per_unit=prod.quantity_per_unit,
            category=prod.category,
            packaging_type=prod.packaging_type,
            supplied_weight=body.get("weight", prod.weight),
        )
        if product_weight is None:
            return _err("A valid product size and quantity are required to calculate weight", 400)
        prod.weight = product_weight
    if "isActive" in body:
        prod.is_active = bool(body.get("isActive"))
    prod.save()

    # Deposits are evaluated against the category the product now has, so moving a
    # product off a returnable (glass) category clears any deposit it carried.
    if "bottleDeposit" in body or "caseDeposit" in body:
        bottle_deposit, bottle_error = _coerce_deposit_amount(body.get("bottleDeposit"))
        if bottle_error:
            return _err(bottle_error, 400)
        case_deposit, case_error = _coerce_deposit_amount(body.get("caseDeposit"))
        if case_error:
            return _err(case_error, 400)
        deposit_allowed = bool((category_spec(prod.category) or {}).get("depositAllowed"))
        if not deposit_allowed:
            # Zero the stored amounts rather than tearing down packaging records,
            # which historical orders and bottle balances still reference.
            ProductPackaging.objects.filter(product=prod, is_active=True).update(
                deposit_amount=Decimal("0.00"), case_deposit_amount=Decimal("0.00")
            )
        elif bottle_deposit is not None or case_deposit is not None:
            pkg_obj, ct_obj = _get_or_create_product_packaging(prod)
            updated_fields: list[str] = []
            if bottle_deposit is not None:
                pkg_obj.deposit_amount = Decimal(str(bottle_deposit))
                ct_obj.deposit_amount = Decimal(str(bottle_deposit))
                ct_obj.save(update_fields=["deposit_amount"])
                updated_fields.append("deposit_amount")
            if case_deposit is not None:
                pkg_obj.case_deposit_amount = Decimal(str(case_deposit))
                updated_fields.append("case_deposit_amount")
            if updated_fields:
                pkg_obj.save(update_fields=updated_fields)

    actor_name = str(p.get("name") or "Staff").strip() or "Staff"
    restored = "isActive" in body and bool(body.get("isActive"))
    _create_staff_notifications(
        title="Product restored" if restored else "Product updated",
        message=(
            f"{actor_name} {'restored' if restored else 'updated'} {previous_name or 'product'}"
            f"{f' ({previous_sku})' if previous_sku else ''}."
        ),
        reference_type="product",
        reference_id=prod.id,
    )
    return _ok({"success": True, "product": _serialize_model(prod)})
