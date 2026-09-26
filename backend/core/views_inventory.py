"""Warehouse inventory, empty-case and stock transaction endpoints."""

import re
from datetime import datetime
from decimal import Decimal
from typing import Any

from django.db import transaction
from django.db.models import OuterRef, Prefetch, Q, Subquery
from django.http import HttpRequest, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from . import views_api as legacy
from .api_constants import _PHYSICAL_STOCK_IN_TYPES, _PHYSICAL_STOCK_OUT_TYPES
from .api_utils import error as _err, json_body as _json_body, ok as _ok, to_int as _int
from .beverage_categories import category_spec
from .mixed_case import serialize_mixed_component
from .models import (
    Customer,
    Inventory,
    InventoryQuantityUnit,
    InventoryReservation,
    InventoryTransaction,
    MixedCaseComponent,
    Product,
    ProductPackaging,
    ReservationStatus,
    StockBatch,
    User,
    Warehouse,
)


# Helpers owned by sibling modules. Routing them through views_api keeps
# a single resolution point, so tests that patch there still apply.


def _get_allowed_warehouse_ids_for_staff(user_id: str) -> set[str]:
    return legacy._get_allowed_warehouse_ids_for_staff(user_id)


def _is_inventory_overstocked_flagged_by_stockin(inventory: Inventory) -> bool:
    return legacy._is_inventory_overstocked_flagged_by_stockin(inventory)


def _is_inventory_overstocked_for_restock_block(inventory: Inventory, incoming_restock_qty: int=0) -> bool:
    return legacy._is_inventory_overstocked_for_restock_block(inventory, incoming_restock_qty)


def _pagination(request: HttpRequest) -> tuple[int, int, int]:
    return legacy._pagination(request)


def _real_products(qs):
    return legacy._real_products(qs)


def _real_warehouses(qs):
    return legacy._real_warehouses(qs)


def _require_staff(request: HttpRequest) -> tuple[dict[str, Any] | None, JsonResponse | None]:
    return legacy._require_staff(request)


def _require_warehouse_operator(request: HttpRequest) -> tuple[dict[str, Any] | None, JsonResponse | None]:
    return legacy._require_warehouse_operator(request)


def _serialize_model(obj: Any, include: dict[str, Any] | None=None, exclude: set[str] | None=None) -> dict[str, Any]:
    return legacy._serialize_model(obj, include, exclude)


def _stockin_would_flag_overstock(inventory: Inventory, stockin_qty: int) -> bool:
    return legacy._stockin_would_flag_overstock(inventory, stockin_qty)


def _warehouse_capacity_error(warehouse: Warehouse, *, incoming_cases: int=0, proposed_capacity: int | None=None) -> str | None:
    return legacy._warehouse_capacity_error(warehouse, incoming_cases=incoming_cases, proposed_capacity=proposed_capacity)


@csrf_exempt
@require_http_methods(["GET", "POST"])
def inventory_collection(request: HttpRequest) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        # Fix: load each row's latest stock-in in the page query instead of a
        # separate database round trip per product when reports load all stock.
        latest_stockin = InventoryTransaction.objects.filter(
            warehouse_id=OuterRef("warehouse_id"), product_id=OuterRef("product_id"),
            type="IN", reference_type="stock_batch",
        ).order_by("-created_at").values("quantity")[:1]
        qs = (
            Inventory.objects.select_related("warehouse", "product").prefetch_related(
                Prefetch("batches", to_attr="_availability_batches"),
                Prefetch("reservations", queryset=InventoryReservation.objects.filter(status=ReservationStatus.RESERVED), to_attr="_active_reservations"),
            )
            .annotate(_latest_stockin_quantity=Subquery(latest_stockin))
            .filter(product__in=_real_products(Product.objects.all()))
            .filter(product__is_active=True)
            .filter(warehouse__in=_real_warehouses(Warehouse.objects.all()))
            .order_by("-updated_at")
        )

        staff_role = str(staff.get("role") or "").strip().upper()
        staff_user_id = str(staff.get("userId") or "").strip()
        allowed_warehouse_ids: set[str] | None = None
        if staff_role == "WAREHOUSE_STAFF" and staff_user_id:
            allowed_warehouse_ids = set(
                _get_allowed_warehouse_ids_for_staff(staff_user_id)
            )
            if not allowed_warehouse_ids:
                return _ok(
                    {
                        "success": True,
                        "inventory": [],
                        "total": 0,
                        "page": page,
                        "pageSize": size,
                        "totalPages": 0,
                    }
                )
            qs = qs.filter(warehouse_id__in=list(allowed_warehouse_ids))

        requested_warehouse_id = str(request.GET.get("warehouseId") or "").strip()
        if requested_warehouse_id:
            if allowed_warehouse_ids is not None and requested_warehouse_id not in allowed_warehouse_ids:
                return _err("Forbidden", 403)
            qs = qs.filter(warehouse_id=requested_warehouse_id)
        total = qs.count()
        rows = list(qs[off : off + size])
        # Current container deposits live on ProductPackaging; fetch the page's
        # packagings in one query so the edit form can show what is stored today.
        deposits_by_product = {
            pkg.product_id: pkg
            for pkg in ProductPackaging.objects.filter(
                product_id__in=[item.product_id for item in rows if item.product_id],
                is_active=True,
            )
        }
        data = []
        for item in rows:
            row = _serialize_model(
                item,
                include={"warehouse": lambda o: _serialize_model(o.warehouse), "product": lambda o: _serialize_model(o.product)},
            )
            pkg = deposits_by_product.get(item.product_id)
            if isinstance(row.get("product"), dict):
                row["product"]["depositAmount"] = float(pkg.deposit_amount or 0) if pkg else 0.0
                row["product"]["caseDepositAmount"] = float(pkg.case_deposit_amount or 0) if pkg else 0.0
            # Added: expose sellable stock separately from physical inventory, which retains expired batches.
            from .mixed_case import available_base_units, allocatable_standard_cases
            row["sellableBaseUnits"] = available_base_units(item)
            row["sellableCases"] = allocatable_standard_cases(item)
            row["overstockedFlag"] = _is_inventory_overstocked_flagged_by_stockin(item)
            data.append(row)
        return _ok({"success": True, "inventory": data, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    # Admin inventory access is monitoring-only; stock changes belong to warehouse staff.
    staff, err = _require_warehouse_operator(request)
    if err:
        return err
    body = _json_body(request)
    warehouse_id = str(body.get("warehouseId", "")).strip()
    product_id = str(body.get("productId", "")).strip()
    qty = _int(body.get("quantity"), 0)
    loose_bottles = max(0, _int(body.get("looseBottles"), 0))
    if not warehouse_id or not product_id:
        return _err("warehouseId and productId are required")
    try:
        warehouse = Warehouse.objects.get(id=warehouse_id)
        product = Product.objects.get(id=product_id)
    except (Warehouse.DoesNotExist, Product.DoesNotExist):
        return _err("Warehouse or Product not found", 404)
    capacity_error = _warehouse_capacity_error(warehouse, incoming_cases=qty)
    if capacity_error:
        return _err(capacity_error, 400)
    item, created = Inventory.objects.get_or_create(
        warehouse=warehouse,
        product=product,
        defaults={"quantity": qty, "reserved_quantity": 0, "threshold": max(1, int(qty * 0.15)), "last_restocked_at": timezone.now()},
    )
    previous_stock = 0 if created else max(0, _int(item.quantity, 0))
    if not created and _is_inventory_overstocked_for_restock_block(item, qty):
        return _err("Cannot add stock: product is currently flagged as overstocked (latest stock-in is >= 10x threshold).", 400)
    if not created:
        item.quantity += qty
        item.loose_bottles = max(0, _int(getattr(item, "loose_bottles", 0), 0) + loose_bottles)
    else:
        item.loose_bottles = loose_bottles
    should_update_threshold = not _stockin_would_flag_overstock(item, qty)
    if should_update_threshold:
        item.threshold = max(1, int(item.quantity * 0.15))
    item.last_restocked_at = timezone.now()
    update_fields = ["quantity", "loose_bottles", "last_restocked_at", "updated_at"]
    if should_update_threshold:
        update_fields.insert(2, "threshold")
    item.save(update_fields=update_fields)
    InventoryTransaction.objects.create(
        warehouse=warehouse,
        product=product,
        type=str(body.get("type") or "IN"),
        quantity=qty,
        quantity_unit=InventoryQuantityUnit.CASE,
        stock_unit_label="Case",
        previous_stock=previous_stock,
        updated_stock=item.quantity,
        reference_type=body.get("referenceType"),
        reference_id=body.get("referenceId"),
        performed_by=str(staff.get("userId") or "").strip() or None,
        notes=body.get("notes"),
    )
    return _ok({"success": True, "inventory": _serialize_model(item, include={"warehouse": lambda o: _serialize_model(o.warehouse), "product": lambda o: _serialize_model(o.product)})}, 201)


@csrf_exempt
@require_http_methods(["PUT"])
def inventory_detail(request: HttpRequest, inventory_id: str) -> JsonResponse:
    staff, err = _require_warehouse_operator(request)
    if err:
        return err
    try:
        item = Inventory.objects.select_related("warehouse", "product").get(id=inventory_id)
    except Inventory.DoesNotExist:
        return _err("Inventory not found", 404)

    staff_role = str(staff.get("role") or "").strip().upper()
    staff_user_id = str(staff.get("userId") or "").strip()
    # Every sibling inventory endpoint scopes warehouse staff to the warehouses
    # they manage; without the same guard here a staff account could edit stock
    # in a warehouse it cannot even read.
    if staff_role == "WAREHOUSE_STAFF" and staff_user_id:
        allowed_warehouse_ids = _get_allowed_warehouse_ids_for_staff(staff_user_id)
        if str(item.warehouse_id or "").strip() not in allowed_warehouse_ids:
            return _err("Forbidden", 403)

    body = _json_body(request)
    requested_warehouse_id = str(body.get("warehouseId") or "").strip()
    if requested_warehouse_id and requested_warehouse_id != str(item.warehouse_id):
        return _err("Inventory belongs to a different warehouse", 400)
    previous_quantity = max(0, _int(item.quantity, 0))
    if "quantity" in body:
        next_quantity = _int(body.get("quantity"), item.quantity)
        added_cases = next_quantity - previous_quantity
        capacity_error = _warehouse_capacity_error(item.warehouse, incoming_cases=added_cases)
        if capacity_error:
            return _err(capacity_error, 400)
    # Threshold is intentionally excluded from manual edits.
    # It is recalculated only after restock operations.
    mapping = [("quantity", "quantity"), ("reservedQuantity", "reserved_quantity"), ("looseBottles", "loose_bottles")]
    for key, attr in mapping:
        if key in body:
            setattr(item, attr, _int(body.get(key), getattr(item, attr)))
    item.save()

    # A manual correction moves real stock, so it belongs in the ledger like any
    # other movement. Without this row the quantity silently changes and the
    # warehouse transaction history shows no trace of who changed it or why.
    quantity_delta = max(0, _int(item.quantity, 0)) - previous_quantity
    if quantity_delta:
        InventoryTransaction.objects.create(
            warehouse=item.warehouse,
            product=item.product,
            type="IN" if quantity_delta > 0 else "OUT",
            quantity=abs(quantity_delta),
            quantity_unit=InventoryQuantityUnit.CASE,
            stock_unit_label="Case",
            previous_stock=previous_quantity,
            updated_stock=max(0, _int(item.quantity, 0)),
            reference_type="inventory_manual_edit",
            reference_id=item.id,
            performed_by=staff_user_id or None,
            notes=str(body.get("notes") or "").strip() or "Manual inventory quantity adjustment",
        )

    return _ok({"success": True, "inventory": _serialize_model(item, include={"warehouse": lambda o: _serialize_model(o.warehouse), "product": lambda o: _serialize_model(o.product)})})


@require_GET
def empty_case_inventory(request: HttpRequest) -> JsonResponse:
    """Return current product-specific empty stock, excluding customer reservations and history rows."""
    staff, err = _require_staff(request)
    if err:
        return err

    qs = (
        Inventory.objects.select_related("warehouse", "product")
        .filter(product__packaging_options__is_active=True, product__packaging_options__is_returnable=True)
        .filter(product__in=_real_products(Product.objects.all()))
        .filter(warehouse__in=_real_warehouses(Warehouse.objects.all()))
        .distinct()
        .order_by("product__name", "warehouse__name")
    )
    staff_role = str(staff.get("role") or "").strip().upper()
    staff_user_id = str(staff.get("userId") or "").strip()
    allowed_warehouse_ids: set[str] | None = None
    if staff_role == "WAREHOUSE_STAFF" and staff_user_id:
        allowed_warehouse_ids = _get_allowed_warehouse_ids_for_staff(staff_user_id)
        if not allowed_warehouse_ids:
            return _ok({"success": True, "emptyCaseInventory": []})
        qs = qs.filter(warehouse_id__in=allowed_warehouse_ids)

    requested_warehouse_id = str(request.GET.get("warehouseId") or "").strip()
    if requested_warehouse_id:
        if allowed_warehouse_ids is not None and requested_warehouse_id not in allowed_warehouse_ids:
            return _err("Forbidden", 403)
        qs = qs.filter(warehouse_id=requested_warehouse_id)

    from .deposit_lifecycle import get_product_empty_case_balance

    rows: list[dict[str, Any]] = []
    for inventory in qs:
        balance = get_product_empty_case_balance(inventory)
        # Only available empties can be returned by warehouse staff.
        if balance["availableBottles"] <= 0:
            continue
        rows.append({
            "inventoryId": inventory.id,
            "warehouseId": inventory.warehouse_id,
            "warehouseName": inventory.warehouse.name,
            "productId": inventory.product_id,
            "productName": inventory.product.name,
            "productSku": inventory.product.sku,
            "productImage": inventory.product.image_url,
            **balance,
        })
    return _ok({"success": True, "emptyCaseInventory": rows})


@csrf_exempt
@require_http_methods(["POST"])
def record_returned_empty_containers(request: HttpRequest) -> JsonResponse:
    """Deduct warehouse empties manually, independently of stock-in and customer returns."""
    from .deposit_lifecycle import get_product_empty_case_balance

    staff, err = _require_warehouse_operator(request)
    if err:
        return err
    body = _json_body(request)
    inventory_id = str(body.get("inventoryId") or "").strip()
    container_unit = str(body.get("containerUnit") or "").strip().upper()
    try:
        quantity = Decimal(str(body.get("quantity")))
        if not quantity.is_finite() or quantity <= 0 or quantity != quantity.to_integral_value():
            raise ValueError()
        quantity = int(quantity)
    except (ValueError, ArithmeticError):
        return _err("Quantity must be a positive whole number", 400)
    if not inventory_id or container_unit not in {"CASE", "BOTTLE"}:
        return _err("inventoryId and containerUnit (CASE or BOTTLE) are required", 400)
    with transaction.atomic():
        # Fix: lock inventory to prevent concurrent returns exceeding the available balance.
        inventory = Inventory.objects.select_for_update().select_related("warehouse", "product").filter(id=inventory_id).first()
        if not inventory:
            return _err("Inventory not found", 404)
        allowed_warehouse_ids = set(_get_allowed_warehouse_ids_for_staff(str(staff.get("userId") or "")))
        if inventory.warehouse_id not in allowed_warehouse_ids:
            return _err("Forbidden: inventory is outside your assigned warehouse scope", 403)
        balance = get_product_empty_case_balance(inventory)
        if not balance["containersPerCase"]:
            return _err("This product does not use returnable containers", 400)
        returned_bottles = quantity * balance["containersPerCase"] if container_unit == "CASE" else quantity
        if returned_bottles > balance["availableBottles"]:
            return _err("Returned quantity exceeds available empty stock", 400)
        # Fix: record an outgoing movement without updating customer balances or deposits.
        InventoryTransaction.objects.create(
            warehouse=inventory.warehouse, product=inventory.product,
            type="CONSUME_EMPTY", quantity=returned_bottles,
            quantity_unit=InventoryQuantityUnit.BASE_UNIT, stock_unit_label="Empty bottle",
            previous_stock=balance["availableBottles"], updated_stock=balance["availableBottles"] - returned_bottles,
            reference_type="manual_empty_return", reference_id=inventory.id,
            performed_by=str(staff.get("name") or "Warehouse staff"),
            notes=f"Warehouse return: {quantity} {container_unit.lower()}(s). {str(body.get('remarks') or '').strip()}",
        )
    return _ok({"success": True, "returnedBottles": returned_bottles, "message": "Empty stock returned"}, 201)


def _serialize_inventory_transactions_with_stock_changes(rows: list[InventoryTransaction]) -> list[dict[str, Any]]:
    """Serialize transactions and reconstruct missing snapshots for legacy physical movements."""
    data = [
        _serialize_model(
            row,
            include={
                "warehouse": lambda obj: _serialize_model(obj.warehouse),
                "product": lambda obj: _serialize_model(obj.product),
            },
        )
        for row in rows
    ]
    # Fix: the history table reads these flat fields; without them the SKU,
    # warehouse code and staff name never rendered.
    actor_ids = {str(row.performed_by).strip() for row in rows if str(row.performed_by or "").strip()}
    actor_names: dict[str, str] = {}
    if actor_ids:
        actor_names.update({str(uid): str(name or "").strip() for uid, name in User.objects.filter(id__in=actor_ids).values_list("id", "name")})
        actor_names.update({str(cid): str(name or "").strip() for cid, name in Customer.objects.filter(id__in=actor_ids - set(actor_names)).values_list("id", "name")})
    for payload, row in zip(data, rows):
        product = row.product
        warehouse = row.warehouse
        payload["productName"] = str(getattr(product, "name", "") or "").strip() or None
        payload["productSku"] = str(getattr(product, "sku", "") or "").strip() or None
        payload["productCategory"] = str(getattr(product, "category", "") or "").strip() or None
        payload["warehouseName"] = str(getattr(warehouse, "name", "") or "").strip() or None
        payload["warehouseCode"] = str(getattr(warehouse, "code", "") or "").strip() or None
        performed_by = str(row.performed_by or "").strip()
        # Older rows stored the staff name itself rather than a user id.
        payload["performedByName"] = (actor_names.get(performed_by) or performed_by) or None
        label = str(row.stock_unit_label or "").strip()
        if str(row.quantity_unit or "").upper() == InventoryQuantityUnit.BASE_UNIT and label.lower() in {"", "base unit", "bottle"}:
            # Fix: loose rows showed "3 Base units" (or "Bottles" for cans); use the
            # product category's loose unit, as every other loose movement does.
            spec = category_spec(getattr(product, "category", None))
            if spec:
                payload["stockUnitLabel"] = spec["looseUnit"]
    mixed_component_ids = {str(row.mixed_case_component_id) for row in rows if row.mixed_case_component_id}
    if mixed_component_ids:
        components_by_id = {
            str(component.id): component
            for component in MixedCaseComponent.objects.filter(id__in=mixed_component_ids).select_related("product", "order_item__order")
        }
        sibling_components_by_item_id: dict[str, list[dict[str, Any]]] = {}
        # Fix: fetch all siblings once. setdefault evaluated a fresh database query
        # for every component, even when that order item was already in the map.
        order_item_ids = {component.order_item_id for component in components_by_id.values()}
        for sibling in MixedCaseComponent.objects.filter(order_item_id__in=order_item_ids).select_related("product"):
            sibling_components_by_item_id.setdefault(str(sibling.order_item_id), []).append(
                serialize_mixed_component(sibling)
            )
        for payload, row in zip(data, rows):
            component = components_by_id.get(str(row.mixed_case_component_id or ""))
            if component is not None:
                # Transaction history needs the full mixed-case composition, not
                # only the component whose stock movement is on this row.
                order_item = component.order_item
                payload["mixedCase"] = {
                    "orderItemId": component.order_item_id,
                    "components": sibling_components_by_item_id[str(component.order_item_id)],
                    # Fix: the details dialog showed N/A for these and the component id as the order.
                    "componentId": component.id,
                    "orderNumber": str(getattr(getattr(order_item, "order", None), "order_number", "") or "").strip() or None,
                    "caseCapacity": row.case_capacity_snapshot if row.case_capacity_snapshot is not None else getattr(order_item, "case_capacity", None),
                    "caseCount": row.case_count_snapshot if row.case_count_snapshot is not None else getattr(order_item, "quantity", None),
                }
    target_ids = {
        row.id
        for row in rows
        if (row.previous_stock is None or row.updated_stock is None)
        and str(row.type or "").upper() in (_PHYSICAL_STOCK_IN_TYPES | _PHYSICAL_STOCK_OUT_TYPES)
    }
    if not target_ids:
        return data

    group_keys = {(row.warehouse_id, row.product_id) for row in rows if row.id in target_ids and row.warehouse_id}
    warehouse_ids = {warehouse_id for warehouse_id, _ in group_keys}
    product_ids = {product_id for _, product_id in group_keys}
    inventories = Inventory.objects.select_related("product").filter(
        warehouse_id__in=warehouse_ids,
        product_id__in=product_ids,
    )
    states: dict[tuple[str, str, str], int] = {}
    for inventory in inventories:
        pair = (inventory.warehouse_id, inventory.product_id)
        if pair not in group_keys:
            continue
        states[(*pair, InventoryQuantityUnit.CASE)] = max(0, _int(inventory.quantity, 0))
        per_case = max(1, _int(getattr(inventory.product, "quantity_per_unit", 0), 1))
        states[(*pair, InventoryQuantityUnit.BASE_UNIT)] = (
            max(0, _int(inventory.quantity, 0)) * per_case
            + max(0, _int(inventory.loose_bottles, 0))
        )

    inferred: dict[str, tuple[int, int]] = {}
    timeline = (
        InventoryTransaction.objects.filter(
            warehouse_id__in=warehouse_ids,
            product_id__in=product_ids,
            type__in=sorted(_PHYSICAL_STOCK_IN_TYPES | _PHYSICAL_STOCK_OUT_TYPES),
        )
        .order_by("-created_at", "-id")
    )
    for transaction_row in timeline:
        pair = (transaction_row.warehouse_id, transaction_row.product_id)
        if pair not in group_keys:
            continue
        unit = str(transaction_row.quantity_unit or InventoryQuantityUnit.CASE).upper()
        if unit not in {InventoryQuantityUnit.CASE, InventoryQuantityUnit.BASE_UNIT}:
            unit = InventoryQuantityUnit.CASE
        state_key = (*pair, unit)
        if state_key not in states:
            continue

        quantity = max(0, _int(transaction_row.quantity, 0))
        movement = quantity if str(transaction_row.type or "").upper() in _PHYSICAL_STOCK_IN_TYPES else -quantity
        if transaction_row.previous_stock is not None and transaction_row.updated_stock is not None:
            previous = _int(transaction_row.previous_stock, 0)
            updated = _int(transaction_row.updated_stock, 0)
        elif transaction_row.previous_stock is not None:
            previous = _int(transaction_row.previous_stock, 0)
            updated = previous + movement
        elif transaction_row.updated_stock is not None:
            updated = _int(transaction_row.updated_stock, 0)
            previous = updated - movement
        else:
            # Walk backward from current inventory, reversing each physical movement.
            updated = states[state_key]
            previous = updated - movement

        inferred[transaction_row.id] = (max(0, previous), max(0, updated))
        states[state_key] = max(0, previous)

    for payload in data:
        values = inferred.get(str(payload.get("id") or ""))
        if not values:
            continue
        if payload.get("previousStock") is None:
            payload["previousStock"] = values[0]
        if payload.get("updatedStock") is None:
            payload["updatedStock"] = values[1]
    return data

# Physical stock movements, as the transaction-history screens define them:
# what actually entered or left the warehouse. Reservations, their consumption
# and internal transfers are bookkeeping and are not listed there.
_STOCK_MOVEMENT_IN_TYPES = ["IN", "STOCK_IN", "RETURN"]
_STOCK_MOVEMENT_OUT_TYPES = ["OUT", "STOCK_OUT"]
_STOCK_MOVEMENT_TYPES = _STOCK_MOVEMENT_IN_TYPES + _STOCK_MOVEMENT_OUT_TYPES
_TRANSACTION_TYPE_ALIASES = {
    "IN": _STOCK_MOVEMENT_IN_TYPES,
    "STOCK_IN": _STOCK_MOVEMENT_IN_TYPES,
    "OUT": _STOCK_MOVEMENT_OUT_TYPES,
    "STOCK_OUT": _STOCK_MOVEMENT_OUT_TYPES,
}



@require_GET
def inventory_transactions_list(request: HttpRequest) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    page, size, off = _pagination(request)
    qs = (
        InventoryTransaction.objects.select_related("warehouse", "product")
        .filter(product__in=_real_products(Product.objects.all()))
        .filter(warehouse__in=_real_warehouses(Warehouse.objects.all()))
        # Internal loose-bottle reconciliation is not a user-facing stock-in/out movement.
        .exclude(reference_type="replacement_bottle_remainder")
        # Fix: consuming a reservation is bookkeeping, not a second stock-out.
        .exclude(type="RESERVE_CONSUMED")
    )
    staff_role = str(staff.get("role") or "").strip().upper()
    staff_user_id = str(staff.get("userId") or "").strip()
    allowed_warehouse_ids: set[str] | None = None
    if staff_role == "WAREHOUSE_STAFF" and staff_user_id:
        allowed_warehouse_ids = set(
            _get_allowed_warehouse_ids_for_staff(staff_user_id)
        )
        if not allowed_warehouse_ids:
            return _ok({"success": True, "transactions": [], "total": 0, "page": page, "pageSize": size, "totalPages": 0})
        qs = qs.filter(warehouse_id__in=list(allowed_warehouse_ids))

    tx_type = str(request.GET.get("type") or "").strip().upper()
    if tx_type and tx_type != "ALL":
        # "IN"/"OUT" name a direction on this screen, not one stored value: a
        # RETURN is stock coming in. Match the aliases the screen groups under
        # each heading so its own filter and the server agree.
        qs = qs.filter(type__in=_TRANSACTION_TYPE_ALIASES.get(tx_type, [tx_type]))

    # The stock-in/out screens page these rows, so the rows they hide must be
    # excluded before the count: paginating over reservations and then dropping
    # them client-side is what left "Showing 1-20 of 672" above two rows.
    if str(request.GET.get("stockMovementsOnly") or "").strip().lower() in {"1", "true", "yes"}:
        qs = qs.filter(type__in=_STOCK_MOVEMENT_TYPES)

    # Filter return history before pagination, retaining the staff warehouse scope above.
    reference_type = str(request.GET.get("referenceType") or "").strip()
    if reference_type:
        qs = qs.filter(reference_type=reference_type)
    warehouse_id = str(request.GET.get("warehouseId") or "").strip()
    if warehouse_id:
        if allowed_warehouse_ids is not None and warehouse_id not in allowed_warehouse_ids:
            return _err("Forbidden: warehouse is outside your assigned scope", 403)
        qs = qs.filter(warehouse_id=warehouse_id)

    search = str(request.GET.get("search") or "").strip()
    if search:
        # Fix: the screen offers staff search, but performed_by usually holds a user id.
        matching_staff_ids = list(User.objects.filter(name__icontains=search).values_list("id", flat=True)[:200])
        qs = qs.filter(
            Q(product__name__icontains=search)
            | Q(product__sku__icontains=search)
            | Q(notes__icontains=search)
            | Q(id__icontains=search)
            | Q(reference_id__icontains=search)
            | Q(performed_by__icontains=search)
            | Q(performed_by__in=matching_staff_ids)
        )

    date_from_raw = str(request.GET.get("dateFrom") or "").strip()
    if date_from_raw:
        try:
            date_from = datetime.fromisoformat(date_from_raw).date()
        except ValueError:
            return _err("Invalid dateFrom. Use YYYY-MM-DD", 400)
        qs = qs.filter(created_at__date__gte=date_from)

    date_to_raw = str(request.GET.get("dateTo") or "").strip()
    if date_to_raw:
        try:
            date_to = datetime.fromisoformat(date_to_raw).date()
        except ValueError:
            return _err("Invalid dateTo. Use YYYY-MM-DD", 400)
        qs = qs.filter(created_at__date__lte=date_to)

    if date_from_raw and date_to_raw and date_from > date_to:
        return _err("dateFrom cannot be later than dateTo", 400)

    # Fix: a tie-breaker keeps equal timestamps from repeating or skipping rows across pages.
    qs = qs.order_by("-created_at", "-id")
    total = qs.count()
    rows = list(qs[off : off + size])
    data = _serialize_inventory_transactions_with_stock_changes(rows)
    return _ok({"success": True, "transactions": data, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})


@csrf_exempt
@require_http_methods(["POST"])
def resolve_expired_stock(request: HttpRequest) -> JsonResponse:
    """Record a confirmed physical supplier return or disposal without deleting batch history."""
    staff, err = _require_warehouse_operator(request)
    if err:
        return err
    body = _json_body(request)
    batch_id = str(body.get("batchId") or "").strip()
    action = str(body.get("action") or "").strip()
    unit = str(body.get("unit") or "CASE").strip()
    reason = str(body.get("reason") or "").strip()
    request_id = str(body.get("requestId") or "").strip()
    if action not in {"SUPPLIER_RETURN", "DISPOSAL"}:
        return _err("Invalid expired-stock action", 400)
    if unit not in {"CASE", "BASE_UNIT"}:
        return _err("Invalid expired-stock unit", 400)
    if not reason:
        return _err("Disposal reason or reference is required", 400)
    if len(reason) > 500:
        return _err("Disposal reason must be 500 characters or fewer", 400)
    if not request_id or len(request_id) > 100:
        return _err("A valid requestId is required", 400)
    try:
        quantity = Decimal(str(body.get("quantity")))
        if not quantity.is_finite() or quantity <= 0 or quantity != quantity.to_integral_value():
            raise ValueError()
        # Guard the conversion before an intentionally huge submitted number can
        # become an expensive integer allocation; real inventory is lower than this.
        if quantity.adjusted() > 9:
            return _err("Quantity is too large", 400)
        quantity = int(quantity)
    except (ValueError, ArithmeticError):
        return _err("Quantity must be a positive whole number", 400)
    source = StockBatch.objects.filter(id=batch_id).first()
    if not source:
        return _err("Stock batch not found", 404)
    if source.inventory.warehouse_id not in set(_get_allowed_warehouse_ids_for_staff(str(staff.get("userId") or ""))):
        return _err("Forbidden", 403)
    with transaction.atomic():
        # Lock in the same inventory-then-batch order as allocation; serialize retries and removals.
        inventory = Inventory.objects.select_for_update().get(id=source.inventory_id)
        batch = StockBatch.objects.select_for_update().get(id=batch_id)
        previous = InventoryTransaction.objects.filter(reference_type="expired_stock", reference_id=request_id).first()
        if previous:
            if previous.product_id != inventory.product_id or previous.warehouse_id != inventory.warehouse_id or previous.notes != f"{action}; Batch={batch.id} ({batch.batch_number}); {reason}" or previous.quantity != quantity or previous.quantity_unit != unit:
                return _err("Request ID was already used for another action", 409)
            return _ok({"success": True, "message": "Action already recorded"})
        if not batch.expiry_date or batch.expiry_date > timezone.now():
            return _err("Only expired batches can be returned or disposed through this action", 400)
        if batch.reservations.filter(status=ReservationStatus.RESERVED).exists():
            return _err("Release or reassign this batch's active order reservations before removing stock", 400)
        batch_field = "quantity" if unit == "CASE" else "loose_units"
        inventory_field = "quantity" if unit == "CASE" else "loose_bottles"
        stock_before = int(getattr(inventory, inventory_field) or 0)
        batch_available = int(getattr(batch, batch_field) or 0)
        unit_label = "cases" if unit == "CASE" else "loose bottles"
        if batch_available <= 0:
            return _err(f"No {unit_label} remain in this batch", 400)
        if quantity > batch_available:
            return _err(f"Quantity exceeds the {batch_available} {unit_label} remaining in this batch", 400)
        if quantity > stock_before:
            return _err("Quantity exceeds the remaining physical stock", 400)
        setattr(batch, batch_field, int(getattr(batch, batch_field)) - quantity)
        setattr(inventory, inventory_field, stock_before - quantity)
        # Keep the source batch and receipt history even after its final units leave.
        batch.status = "DEPLETED" if batch.quantity == 0 and batch.loose_units == 0 else batch.status
        batch.save(update_fields=[batch_field, "status", "updated_at"])
        inventory.save(update_fields=[inventory_field, "updated_at"])
        # Snapshot the listed value at disposal time. The system has no product
        # cost field, so this is explicitly a listed-price stock-loss value.
        case_price = Decimal(str(getattr(inventory.product, "case_price", None) or inventory.product.price or 0))
        per_case = max(1, _int(getattr(inventory.product, "quantity_per_unit", 0), 1))
        listed_unit_price = (
            case_price
            if unit == "CASE"
            else Decimal(str(getattr(inventory.product, "retail_unit_price", None) or (case_price / per_case)))
        )
        loss_unit_price = listed_unit_price.quantize(Decimal("0.01"))
        loss_amount = (loss_unit_price * quantity).quantize(Decimal("0.01"))
        InventoryTransaction.objects.create(
            warehouse_id=inventory.warehouse_id, product_id=inventory.product_id,
            type="OUT", quantity=quantity, quantity_unit=unit,
            stock_unit_label="Case" if unit == "CASE" else "Base unit",
            previous_stock=stock_before, updated_stock=stock_before - quantity,
            reference_type="expired_stock", reference_id=request_id,
            performed_by=str(staff.get("name") or staff.get("userId") or "Warehouse staff"),
            notes=f"{action}; Batch={batch.id} ({batch.batch_number}); {reason}",
            loss_unit_price=loss_unit_price if action == "DISPOSAL" else Decimal("0.00"),
            loss_amount=loss_amount if action == "DISPOSAL" else Decimal("0.00"),
        )
    return _ok({"success": True, "message": "Expired stock action recorded"}, 201)


@require_GET
def disposed_stock_history(request: HttpRequest) -> JsonResponse:
    """List warehouse-scoped disposal records with their retained batch details."""
    staff, err = _require_staff(request)
    if err:
        return err
    page, size, off = _pagination(request)
    qs = (
        InventoryTransaction.objects.select_related("warehouse", "product")
        .filter(reference_type="expired_stock", notes__startswith="DISPOSAL;")
        .order_by("-created_at", "-id")
    )
    staff_role = str(staff.get("role") or "").strip().upper()
    staff_user_id = str(staff.get("userId") or "").strip()
    if staff_role == "WAREHOUSE_STAFF" and staff_user_id:
        allowed_warehouse_ids = _get_allowed_warehouse_ids_for_staff(staff_user_id)
        if not allowed_warehouse_ids:
            return _ok({"success": True, "disposals": [], "total": 0, "page": page, "pageSize": size, "totalPages": 0})
        qs = qs.filter(warehouse_id__in=allowed_warehouse_ids)

    total = qs.count()
    rows = list(qs[off : off + size])
    # Existing disposal ledger rows store the batch ID in their immutable notes.
    # Batches are retained after disposal, allowing their expiry details to remain visible.
    batch_id_by_transaction: dict[str, str] = {}
    for row in rows:
        match = re.search(r"(?:^|;\s*)Batch=([^\s;]+)\s*\(", str(row.notes or ""))
        if match:
            batch_id_by_transaction[row.id] = match.group(1)
    batches = {
        batch.id: batch
        for batch in StockBatch.objects.filter(id__in=set(batch_id_by_transaction.values())).select_related("inventory__product")
    }
    disposals = []
    for row in rows:
        batch = batches.get(batch_id_by_transaction.get(row.id, ""))
        batch_number_match = re.search(r"Batch=[^\s;]+\s*\(([^)]+)\)", str(row.notes or ""))
        reason_parts = str(row.notes or "").split("; ", 2)
        disposals.append({
            "id": row.id,
            "disposedAt": row.created_at,
            "batchId": batch.id if batch else batch_id_by_transaction.get(row.id),
            "batchNumber": batch.batch_number if batch else (batch_number_match.group(1) if batch_number_match else "Unavailable batch"),
            "product": _serialize_model(row.product),
            "warehouse": _serialize_model(row.warehouse),
            "quantity": row.quantity,
            "quantityUnit": row.quantity_unit,
            "expiryDate": batch.expiry_date if batch else None,
            "manufacturedDate": batch.receipt_date if batch else None,
            "reason": reason_parts[2] if len(reason_parts) == 3 else "",
            "performedBy": row.performed_by,
            "lossUnitPrice": row.loss_unit_price,
            "lossAmount": row.loss_amount,
            "lossBasis": "LISTED_PRICE",
        })
    return _ok({"success": True, "disposals": disposals, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
