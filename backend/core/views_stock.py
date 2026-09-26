"""Stock batch intake endpoints."""

import secrets
from datetime import datetime
from typing import Any

from django.db import transaction
from django.db.models import Q, Sum
from django.http import HttpRequest, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from . import views_api as legacy
from .api_utils import error as _err, json_body as _json_body, ok as _ok, to_int as _int
from .models import (
    Inventory,
    InventoryQuantityUnit,
    InventoryTransaction,
    Product,
    ReservationStatus,
    StockBatch,
    Warehouse,
)
from .product_weights import resolve_product_weight


# Helpers owned by sibling modules. Routing them through views_api keeps
# a single resolution point, so tests that patch there still apply.


def _create_staff_notifications(*, title: str, message: str, notification_type: str='INVENTORY', reference_type: str | None=None, reference_id: str | None=None) -> None:
    return legacy._create_staff_notifications(title=title, message=message, notification_type=notification_type, reference_type=reference_type, reference_id=reference_id)


def _get_allowed_warehouse_ids_for_staff(user_id: str) -> set[str]:
    return legacy._get_allowed_warehouse_ids_for_staff(user_id)


def _has_duplicate_product_identity(*, name: Any, sizes: Any, category: Any, exclude_product_id: str | None=None) -> bool:
    return legacy._has_duplicate_product_identity(name=name, sizes=sizes, category=category, exclude_product_id=exclude_product_id)


def _is_inventory_overstocked_for_restock_block(inventory: Inventory, incoming_restock_qty: int=0) -> bool:
    return legacy._is_inventory_overstocked_for_restock_block(inventory, incoming_restock_qty)


def _normalize_product_unit(raw: Any) -> str:
    return legacy._normalize_product_unit(raw)


def _pagination(request: HttpRequest) -> tuple[int, int, int]:
    return legacy._pagination(request)


def _payload(request: HttpRequest) -> dict[str, Any] | None:
    return legacy._payload(request)


def _persist_stock_batch_quantity(batch: StockBatch) -> None:
    return legacy._persist_stock_batch_quantity(batch)


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


def _validate_stock_expiry(value: Any) -> tuple[datetime | None, str | None]:
    return legacy._validate_stock_expiry(value)


def _warehouse_capacity_error(warehouse: Warehouse, *, incoming_cases: int=0, proposed_capacity: int | None=None) -> str | None:
    return legacy._warehouse_capacity_error(warehouse, incoming_cases=incoming_cases, proposed_capacity=proposed_capacity)


@csrf_exempt
@require_http_methods(["GET", "POST", "PUT"])
def stock_batches_collection(request: HttpRequest) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = (
            StockBatch.objects.select_related("inventory", "inventory__warehouse", "inventory__product")
            .filter(inventory__product__in=_real_products(Product.objects.all()))
            .filter(inventory__product__is_active=True)
            .filter(inventory__warehouse__in=_real_warehouses(Warehouse.objects.all()))
            .filter(Q(quantity__gt=0) | Q(loose_units__gt=0))
            .order_by("-created_at")
        )
        staff_role = str(staff.get("role") or "").strip().upper()
        staff_user_id = str(staff.get("userId") or "").strip()
        allowed_warehouse_ids: set[str] | None = None
        if staff_role == "WAREHOUSE_STAFF" and staff_user_id:
            allowed_warehouse_ids = set(
                _get_allowed_warehouse_ids_for_staff(staff_user_id)
            )
            if not allowed_warehouse_ids:
                return _ok({"success": True, "stockBatches": [], "total": 0, "page": page, "pageSize": size, "totalPages": 0})
            qs = qs.filter(inventory__warehouse_id__in=list(allowed_warehouse_ids))
        # Fix: warehouse insights request only this facility's batches, before pagination.
        warehouse_id = str(request.GET.get("warehouseId") or "").strip()
        if warehouse_id:
            if allowed_warehouse_ids is not None and warehouse_id not in allowed_warehouse_ids:
                return _err("Forbidden: warehouse is outside your assigned scope", 403)
            qs = qs.filter(inventory__warehouse_id=warehouse_id)
        total = qs.count()
        rows = list(qs[off : off + size])
        data = [_serialize_model(x, include={"inventory": lambda o: _serialize_model(o.inventory, include={"warehouse": lambda i: _serialize_model(i.warehouse), "product": lambda i: _serialize_model(i.product)})}) for x in rows]
        return _ok({"success": True, "stockBatches": data, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    # Batches are warehouse inventory operations, not admin monitoring actions.
    staff, err = _require_warehouse_operator(request)
    if err:
        return err
    body = _json_body(request)
    if request.method == "PUT":
        batch_id = str(body.get("batchId") or body.get("id") or "").strip()
        if not batch_id:
            return _err("batchId is required", 400)
        quantity = _int(body.get("quantity"), -1)
        if quantity < 0:
            return _err("quantity must be a non-negative number", 400)

        batch = (
            StockBatch.objects.select_related("inventory", "inventory__warehouse", "inventory__product")
            .filter(id=batch_id)
            .first()
        )
        if not batch:
            return _err("Stock batch not found", 404)

        staff_role = str(staff.get("role") or "").strip().upper()
        staff_user_id = str(staff.get("userId") or "").strip()
        if staff_role == "WAREHOUSE_STAFF" and staff_user_id:
            allowed_warehouse_ids = _get_allowed_warehouse_ids_for_staff(staff_user_id)
            if not allowed_warehouse_ids or str(getattr(batch.inventory, "warehouse_id", "") or "").strip() not in allowed_warehouse_ids:
                return _err("Access denied for this warehouse", 403)

        inv = batch.inventory
        inventory_quantity_before = max(0, _int(getattr(inv, "quantity", 0), 0))
        previous_qty = max(0, _int(getattr(batch, "quantity", 0), 0))
        next_qty = max(0, quantity)
        delta = next_qty - previous_qty
        if delta and batch.reservations.filter(status=ReservationStatus.RESERVED).exists():
            # A reserved batch is an allocation anchor until its order releases
            # or consumes it, so a manual edit cannot invalidate that promise.
            return _err("Release or reassign this batch's active order reservations before changing quantity", 409)

        # Added: warehouse staff can update batch dates independently of quantity.
        manufactured_date = batch.receipt_date
        if "manufacturedDate" in body or "manufactured_date" in body:
            manufactured_raw = str(body.get("manufacturedDate") or body.get("manufactured_date") or "").strip()
            if not manufactured_raw:
                return _err("manufacturedDate is required", 400)
            try:
                manufactured_date = datetime.fromisoformat(manufactured_raw.replace("Z", "+00:00"))
                if timezone.is_naive(manufactured_date):
                    manufactured_date = timezone.make_aware(manufactured_date)
            except ValueError:
                return _err("Invalid manufacturedDate", 400)

        expiry_date = batch.expiry_date
        if "expiryDate" in body or "expiry_date" in body:
            expiry_raw = str(body.get("expiryDate") or body.get("expiry_date") or "").strip()
            if expiry_raw:
                expiry_date, expiry_error = _validate_stock_expiry(expiry_raw)
                if expiry_error:
                    return _err(expiry_error, 400)
            else:
                expiry_date = None

        dates_changed = manufactured_date != batch.receipt_date or expiry_date != batch.expiry_date
        if delta == 0 and not dates_changed:
            return _ok(
                {
                    "success": True,
                    "stockBatch": _serialize_model(batch, include={"inventory": lambda o: _serialize_model(o.inventory)}),
                    "message": "Stock batch unchanged",
                }
            )

        if delta > 0 and _is_inventory_overstocked_for_restock_block(inv, delta):
            return _err("Cannot increase stock batch quantity: product is overstocked.", 400)

        with transaction.atomic():
            if delta > 0:
                # Added: serialize warehouse-wide capacity checks with stock changes.
                locked_warehouse = Warehouse.objects.select_for_update().get(id=inv.warehouse_id)
                capacity_error = _warehouse_capacity_error(locked_warehouse, incoming_cases=delta)
                if capacity_error:
                    return _err(capacity_error, 400)
            if delta != 0:
                # Returned containers are recorded separately by warehouse staff.
                # Updating a stock batch must not infer or consume empty containers.
                batch.quantity = next_qty
                _persist_stock_batch_quantity(batch)

            # Save date-only edits too; quantity persistence deliberately uses a narrow update_fields list.
            if next_qty > 0 and dates_changed:
                batch.receipt_date = manufactured_date
                batch.expiry_date = expiry_date
                batch.save(update_fields=["receipt_date", "expiry_date", "updated_at"])

            if delta != 0:
                refreshed_inventory = Inventory.objects.select_for_update().filter(id=inv.id).first()
                if not refreshed_inventory:
                    return _err("Inventory not found", 404)
                recalculated_total = (
                    StockBatch.objects.filter(inventory_id=refreshed_inventory.id, quantity__gt=0)
                    .aggregate(total=Sum("quantity"))
                    .get("total")
                )
                inv.quantity = max(0, _int(recalculated_total, 0))
                # Fix: reducing a batch is a stock deduction and must preserve the
                # threshold established by the latest accepted restock.
                should_update_threshold = delta > 0 and not _stockin_would_flag_overstock(inv, next_qty)
                if should_update_threshold:
                    inv.threshold = max(1, int(inv.quantity * 0.15))
                update_fields = ["quantity", "updated_at"]
                if should_update_threshold:
                    update_fields.insert(1, "threshold")
                inv.save(update_fields=update_fields)
                # Keep the original stock-in immutable and record this physical
                # correction as a separate ledger event for audit history.
                InventoryTransaction.objects.create(
                    warehouse=inv.warehouse,
                    product=inv.product,
                    type="IN" if delta > 0 else "OUT",
                    quantity=abs(delta),
                    quantity_unit=InventoryQuantityUnit.CASE,
                    stock_unit_label="Case",
                    previous_stock=inventory_quantity_before,
                    updated_stock=inv.quantity,
                    reference_type="stock_batch_adjustment",
                    reference_id=batch_id,
                    performed_by=str(staff.get("userId") or "").strip() or None,
                    notes="Stock batch quantity adjusted",
                )

        updated_batch = (
            StockBatch.objects.select_related("inventory", "inventory__warehouse", "inventory__product")
            .filter(id=batch_id)
            .first()
        )
        return _ok(
            {
                "success": True,
                "stockBatch": _serialize_model(updated_batch, include={"inventory": lambda o: _serialize_model(o.inventory)}) if updated_batch else None,
                "message": "Stock batch updated",
            }
        )

    qty = _int(body.get("quantity"), 0)
    if qty <= 0:
        return _err("quantity must be > 0")

    manufactured_raw = str(body.get("manufacturedDate") or body.get("manufactured_date") or "").strip()
    manufactured_date = None
    if manufactured_raw:
        try:
            manufactured_date = datetime.fromisoformat(manufactured_raw.replace("Z", "+00:00"))
        except ValueError:
            return _err("Invalid manufacturedDate", 400)

    expiry_raw = str(body.get("expiryDate") or body.get("expiry_date") or "").strip()
    if not expiry_raw:
        return _err("expiryDate is required", 400)
    expiry_date, expiry_error = _validate_stock_expiry(expiry_raw)
    if expiry_error:
        return _err(expiry_error, 400)

    created_by = (_payload(request) or {}).get("userId")

    try:
        with transaction.atomic():
            inv = None
            inventory_id = str(body.get("inventoryId") or "").strip()

            if inventory_id:
                inv = Inventory.objects.select_related("warehouse", "product").filter(id=inventory_id).first()
                if not inv:
                    return _err("Inventory not found", 404)
            else:
                warehouse_id = str(body.get("warehouseId") or "").strip()
                product_id = str(body.get("productId") or "").strip()
                is_new_product = bool(body.get("isNewProduct"))

                if not warehouse_id:
                    return _err("warehouseId is required", 400)

                warehouse = Warehouse.objects.filter(id=warehouse_id).first()
                if not warehouse:
                    return _err("Warehouse not found", 404)

                product = None
                if is_new_product and not product_id:
                    name = str(body.get("productName") or "").strip()
                    if not name:
                        return _err("productName is required", 400)

                    sku = str(body.get("sku") or "").strip()
                    if not sku:
                        sku = f"SKU-{int(timezone.now().timestamp())}-{secrets.token_hex(2).upper()}"

                    if Product.objects.filter(sku=sku).exists():
                        sku = f"{sku}-{secrets.token_hex(1).upper()}"

                    try:
                        product_unit = _normalize_product_unit(body.get("unit"))
                    except ValueError as exc:
                        return _err(str(exc), 400)

                    raw_sizes = body.get("sizes")
                    normalized_sizes = [str(value).strip() for value in raw_sizes] if isinstance(raw_sizes, list) else []
                    normalized_sizes = [value for value in normalized_sizes if value]
                    quantity_per_unit = _int(body.get("quantityPerCase", body.get("quantityPerUnit")), 0)
                    category_value = str(body.get("category") or "").strip() or None
                    if _has_duplicate_product_identity(
                        name=name, sizes=normalized_sizes, category=category_value
                    ):
                        return _err("A product with the same name, size, and category already exists.", 409)
                    product_weight = resolve_product_weight(
                        sizes=normalized_sizes,
                        quantity_per_unit=quantity_per_unit,
                        category=category_value,
                        supplied_weight=body.get("weight"),
                    )
                    if product_weight is None:
                        return _err(
                            "A valid product size and quantity are required to calculate weight",
                            400,
                        )

                    product = Product.objects.create(
                        sku=sku,
                        name=name,
                        image_url=body.get("imageUrl"),
                        unit=product_unit,
                        weight=product_weight,
                        price=float(body.get("price") or 0),
                        category=category_value,
                        sizes=normalized_sizes,
                        quantity_per_unit=quantity_per_unit,
                        is_active=True,
                    )
                else:
                    if not product_id:
                        return _err("productId is required", 400)
                    product = Product.objects.filter(id=product_id).first()
                    if not product:
                        return _err("Product not found", 404)

                inv, created = Inventory.objects.select_related("warehouse", "product").get_or_create(
                    warehouse=warehouse,
                    product=product,
                    defaults={
                        "quantity": 0,
                        "reserved_quantity": 0,
                        "threshold": max(1, int(qty * 0.15)),
                        "last_restocked_at": timezone.now(),
                    },
                )
                if not created and _is_inventory_overstocked_for_restock_block(inv, qty):
                    return _err("Cannot add stock: product is currently flagged as overstocked (latest stock-in is >= 10x threshold).", 400)

            locked_warehouse = Warehouse.objects.select_for_update().get(id=inv.warehouse_id)
            capacity_error = _warehouse_capacity_error(locked_warehouse, incoming_cases=qty)
            if capacity_error:
                # Raising keeps newly-created product/inventory rows inside this
                # transaction from being committed after a rejected stock-in.
                raise ValueError(capacity_error)

            batch = StockBatch.objects.create(
                batch_number=str(body.get("batchNumber") or f"BATCH-{int(timezone.now().timestamp())}"),
                inventory=inv,
                quantity=qty,
                receipt_date=manufactured_date or timezone.now(),
                expiry_date=expiry_date,
                location_label=body.get("locationLabel"),
                status=body.get("status") or "ACTIVE",
                created_by=created_by,
            )

            previous_stock = max(0, _int(inv.quantity, 0))
            inv.quantity += qty
            should_update_threshold = not _stockin_would_flag_overstock(inv, qty)
            if should_update_threshold:
                inv.threshold = max(1, int(inv.quantity * 0.15))
            inv.last_restocked_at = timezone.now()
            update_fields = ["quantity", "last_restocked_at", "updated_at"]
            if should_update_threshold:
                update_fields.insert(1, "threshold")
            inv.save(update_fields=update_fields)

            InventoryTransaction.objects.create(
                warehouse=inv.warehouse,
                product=inv.product,
                type="IN",
                quantity=qty,
                quantity_unit=InventoryQuantityUnit.CASE,
                stock_unit_label="Case",
                previous_stock=previous_stock,
                updated_stock=inv.quantity,
                reference_type="stock_batch",
                reference_id=batch.id,
                notes="Stock batch added",
            )
            # This stock-in does not change empty-container balances.
            actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
            _create_staff_notifications(
                title="Stock batch added",
                message=f"{actor_name} added batch {batch.batch_number} for {inv.product.name} (+{qty}) in {inv.warehouse.name}.",
                reference_type="stock_batch",
                reference_id=batch.id,
            )

            return _ok({"success": True, "stockBatch": _serialize_model(batch)}, 201)
    except ValueError as e:
        return _err(str(e), 400)
    except Exception as e:
        return _err(str(e), 500)


@csrf_exempt
@require_http_methods(["POST"])
def stock_batches_bulk_collection(request: HttpRequest) -> JsonResponse:
    """Bulk add multiple stock batches in a single atomic transaction"""
    staff, err = _require_warehouse_operator(request)
    if err:
        return err

    body = _json_body(request)
    warehouse_id = str(body.get("warehouseId") or "").strip()
    batches = body.get("batches") or []

    if not warehouse_id:
        return _err("warehouseId is required", 400)
    if not isinstance(batches, list) or len(batches) == 0:
        return _err("batches must be a non-empty array", 400)

    warehouse = Warehouse.objects.filter(id=warehouse_id).first()
    if not warehouse:
        return _err("Warehouse not found", 404)

    # Validate all batches before creating any
    validated_batches = []
    seen_product_ids: set[str] = set()
    for idx, batch_item in enumerate(batches):
        if not isinstance(batch_item, dict):
            return _err(f"Batch {idx} is not a dictionary", 400)

        product_id = str(batch_item.get("productId") or "").strip()
        qty = _int(batch_item.get("quantity"), 0)
        manufactured_raw = str(batch_item.get("manufacturedDate") or "").strip()
        manufactured_date = None
        if manufactured_raw:
            try:
                manufactured_date = datetime.fromisoformat(manufactured_raw.replace("Z", "+00:00"))
            except ValueError:
                return _err(f"Batch {idx}: Invalid manufacturedDate format", 400)

        expiry_raw = str(batch_item.get("expiryDate") or "").strip()

        if not product_id:
            return _err(f"Batch {idx}: productId is required", 400)
        if product_id in seen_product_ids:
            return _err(f"Batch {idx}: product is already included in this stock submission", 400)
        seen_product_ids.add(product_id)
        if qty <= 0:
            return _err(f"Batch {idx}: quantity must be > 0", 400)

        product = Product.objects.filter(id=product_id).first()
        if not product:
            return _err(f"Batch {idx}: Product not found", 404)

        if not expiry_raw:
            return _err(f"Batch {idx}: expiryDate is required", 400)
        expiry_date, expiry_error = _validate_stock_expiry(expiry_raw)
        if expiry_error:
            return _err(f"Batch {idx}: {expiry_error}", 400)

        validated_batches.append({
            "index": idx,
            "product_id": product_id,
            "product": product,
            "quantity": qty,
            "manufactured_date": manufactured_date,
            "expiry_date": expiry_date,
            "batch_number": str(batch_item.get("batchNumber") or f"BATCH-{int(timezone.now().timestamp())}-{idx}"),
            "location_label": batch_item.get("locationLabel"),
            "status": batch_item.get("status") or "ACTIVE",
        })

    created_by = (_payload(request) or {}).get("userId")

    try:
        with transaction.atomic():
            # Added: one lock protects the combined capacity of the entire bulk request.
            warehouse = Warehouse.objects.select_for_update().get(id=warehouse.id)
            created_stock_batches = []
            newly_created_count = 0
            reused_count = 0

            for batch_data in validated_batches:
                product_id = batch_data["product_id"]
                product = batch_data["product"]
                qty = batch_data["quantity"]
                expiry_date = batch_data["expiry_date"]

                # Add Stock only accepts products already registered in this warehouse inventory.
                inv = (
                    Inventory.objects.select_for_update()
                    .select_related("warehouse", "product")
                    .filter(warehouse=warehouse, product=product)
                    .first()
                )
                if not inv:
                    return _err(
                        f"Batch {batch_data['index']}: selected product is not registered in this warehouse inventory.",
                        400,
                    )

                # A retried request reuses its original batch and must not add quantity twice.
                existing_batch = (
                    StockBatch.objects.select_related("inventory")
                    .filter(batch_number=batch_data["batch_number"])
                    .first()
                )
                if existing_batch:
                    same_submission = (
                        existing_batch.inventory_id == inv.id
                        and _int(existing_batch.quantity, 0) == qty
                    )
                    if not same_submission:
                        return _err(f"Batch {batch_data['index']}: batch number is already in use", 409)
                    created_stock_batches.append(existing_batch)
                    reused_count += 1
                    continue

                if _is_inventory_overstocked_for_restock_block(inv, qty):
                    return _err(
                        f"Batch {batch_data['index']}: cannot add stock for product currently flagged as overstocked (latest stock-in is >= 10x threshold).",
                        400,
                    )

                capacity_error = _warehouse_capacity_error(warehouse, incoming_cases=qty)
                if capacity_error:
                    raise ValueError(f"Batch {batch_data['index']}: {capacity_error}")

                # Create stock batch
                batch = StockBatch.objects.create(
                    batch_number=batch_data["batch_number"],
                    inventory=inv,
                    quantity=qty,
                    receipt_date=batch_data.get("manufactured_date") or timezone.now(),
                    expiry_date=expiry_date,
                    location_label=batch_data["location_label"],
                    status=batch_data["status"],
                    created_by=created_by,
                )
                newly_created_count += 1

                # Update inventory quantity
                previous_stock = max(0, _int(inv.quantity, 0))
                inv.quantity += qty
                should_update_threshold = not _stockin_would_flag_overstock(inv, qty)
                if should_update_threshold:
                    inv.threshold = max(1, int(inv.quantity * 0.15))
                inv.last_restocked_at = timezone.now()
                update_fields = ["quantity", "last_restocked_at", "updated_at"]
                if should_update_threshold:
                    update_fields.insert(1, "threshold")
                inv.save(update_fields=update_fields)

                # Create inventory transaction
                InventoryTransaction.objects.create(
                    warehouse=inv.warehouse,
                    product=inv.product,
                    type="IN",
                    quantity=qty,
                    quantity_unit=InventoryQuantityUnit.CASE,
                    stock_unit_label="Case",
                    previous_stock=previous_stock,
                    updated_stock=inv.quantity,
                    reference_type="stock_batch",
                    reference_id=batch.id,
                    notes="Bulk stock batch added",
                )
                # Returnable stock may reuse delivered empties. The helper consumes
                # only the cases actually available and leaves the rest as new stock.
                from .deposit_lifecycle import record_stockin_empty_consumption
                record_stockin_empty_consumption(inv, batch, qty)

                created_stock_batches.append(batch)

            serialized_batches = [_serialize_model(b, include={"inventory": lambda o: _serialize_model(o.inventory, include={"warehouse": lambda i: _serialize_model(i.warehouse), "product": lambda i: _serialize_model(i.product)})}) for b in created_stock_batches]
            if newly_created_count > 0:
                actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
                _create_staff_notifications(
                    # Changed: keep the customer-facing action name as "Stock In".
                    title="Stock In completed",
                    message=f"{actor_name} completed Stock In for {newly_created_count} batches in {warehouse.name}.",
                    reference_type="stock_batch",
                    reference_id=warehouse.id,
                )

            return _ok({
                "success": True,
                "created": len(created_stock_batches),
                "reused": reused_count,
                "failed": 0,
                "stockBatches": serialized_batches,
                "errors": []
            }, 201)
    except ValueError as e:
        return _err(str(e), 400)
    except Exception as e:
        return _err(str(e), 500)
