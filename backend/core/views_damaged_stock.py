"""Damaged stock: recorded in the warehouse, held out of sellable stock, then resolved.

Warehouse staff record damage against a stock batch, as whole cases or as broken
bottles (opening a case when the loose bottles run out). The units leave the
batch and the inventory at once, so nothing damaged is reserved or sold. The
record then ends one of three ways: disposed (a loss at listed price, reported
with the expired-stock disposals), returned to the supplier, or put back into the
same batch when it turns out to be sellable.

Damaged items customers report come through replacement claims, which keep their
own workflow; ``damaged_stock_customer_reports`` lists them read-only so the
Inventory module shows every damaged product in one place. Administrators read
both; only warehouse staff change stock, as for every other stock movement.
"""

from __future__ import annotations

import math
import re
from decimal import Decimal
from typing import Any

from django.db import IntegrityError, transaction
from django.db.models import Count, Q, Sum
from django.http import HttpRequest, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from . import views_api as legacy
from . import views_media as media
from .api_utils import error as _err, json_body as _json_body, ok as _ok
from .mixed_case import units_per_case
from .models import (
    Customer,
    DamagedStock,
    Inventory,
    InventoryQuantityUnit,
    InventoryReservation,
    InventoryTransaction,
    ReplacementLine,
    ReservationStatus,
    RoleType,
    StockBatch,
    User,
)

PHOTO_FOLDER = "damaged-stock-photos"
DESCRIPTION_MAX_LENGTH = 1000
NOTES_MAX_LENGTH = 1000
REQUEST_ID_MAX_LENGTH = 120
# Far beyond any real batch; stops a typo becoming a huge integer write.
MAX_QUANTITY = 1_000_000
RECORDED = "damaged_stock"
RESTOCKED = "damaged_stock_restocked"
_NUMBER_ATTEMPTS = 5

ACTIONS = {
    "DISPOSE": DamagedStock.Status.DISPOSED,
    "RETURN_TO_SUPPLIER": DamagedStock.Status.RETURNED_TO_SUPPLIER,
    "RESTOCK": DamagedStock.Status.RESTOCKED,
}


class _Refusal(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message, self.status = message, status


def _iso(value) -> str | None:
    return value.isoformat() if value else None


def _name(user: User | None) -> str | None:
    return (str(user.name or "").strip() or None) if user else None


def _plural(count: int, word: str) -> str:
    return f"{count} {word}{'' if count == 1 else 's'}"


def _quantity_label(cases: int, loose: int) -> str:
    parts = [_plural(cases, "case")] if cases else []
    if loose:
        parts.append(_plural(loose, "bottle"))
    return " and ".join(parts) or "nothing"


def _account(request: HttpRequest) -> tuple[User | None, JsonResponse | None]:
    """The signed-in staff account, with its role read from the database."""
    payload, error = legacy._require_staff(request)
    if error is not None:
        return None, error
    user = User.objects.filter(id=str(payload.get("userId") or "").strip(), is_active=True).first()
    if user is None:
        return None, _err("Unauthorized", 401)
    return user, None


def _role(user: User) -> str:
    return str(user.role or "").upper()


def _allowed_warehouse_ids(user: User) -> set[str]:
    return {str(value) for value in legacy._get_allowed_warehouse_ids_for_staff(str(user.id))}


def _reader(request: HttpRequest) -> tuple[User | None, set[str] | None, JsonResponse | None]:
    """Admins read every warehouse; warehouse staff their own. Returns None ids for all."""
    user, error = _account(request)
    if error is not None:
        return None, None, error
    if _role(user) == RoleType.ADMIN:
        return user, None, None
    if _role(user) == RoleType.WAREHOUSE_STAFF:
        return user, _allowed_warehouse_ids(user), None
    return None, None, _err("Forbidden", 403)


def _operator(request: HttpRequest) -> tuple[User | None, set[str], JsonResponse | None]:
    user, error = _account(request)
    if error is not None:
        return None, set(), error
    if _role(user) != RoleType.WAREHOUSE_STAFF:
        return None, set(), _err("Only warehouse staff can record or resolve damaged stock", 403)
    return user, _allowed_warehouse_ids(user), None


def _records():
    return DamagedStock.objects.select_related("warehouse", "product", "stock_batch", "recorded_by", "resolved_by")


def serialize_record(record: DamagedStock, *, can_manage: bool = False) -> dict[str, Any]:
    product = record.product
    pending = record.status == DamagedStock.Status.PENDING
    return {
        "id": record.id,
        "recordNumber": record.record_number,
        "warehouseId": record.warehouse_id,
        "warehouseName": record.warehouse.name,
        "productId": record.product_id,
        "productName": product.name,
        "productSku": product.sku,
        "productSizes": [str(size).strip() for size in (product.sizes or []) if str(size).strip()],
        "batchId": record.stock_batch_id,
        "batchNumber": record.batch_number or (record.stock_batch.batch_number if record.stock_batch else None),
        "batchExpiryDate": _iso(record.stock_batch.expiry_date) if record.stock_batch else None,
        "cases": record.cases,
        "looseUnits": record.loose_units,
        "unitsPerCase": record.units_per_case,
        "casesOpened": record.cases_opened,
        "quantityLabel": _quantity_label(record.cases, record.loose_units),
        "cause": record.cause,
        "causeLabel": record.get_cause_display(),
        "description": record.description,
        "photoUrl": record.photo_url or None,
        "status": record.status,
        "statusLabel": record.get_status_display(),
        "recordedBy": _name(record.recorded_by),
        "recordedAt": _iso(record.created_at),
        "resolvedBy": _name(record.resolved_by),
        "resolvedAt": _iso(record.resolved_at),
        "resolutionNotes": record.resolution_notes or None,
        "lossAmount": float(record.loss_amount) if record.loss_amount is not None else None,
        "canManage": bool(can_manage and pending),
    }


def _photo_prefix(user_id: str) -> str:
    return f"damaged-stock-{user_id}"


def _is_own_photo_url(url: str, user_id: str) -> bool:
    # The uploader's id is in the file name, so a record can only attach a photo its
    # author uploaded. Attaching someone else's URL would grant read access to it.
    pattern = rf"/api/media/{PHOTO_FOLDER}/{re.escape(_photo_prefix(user_id))}-[0-9a-f]{{32}}\.[a-z0-9]{{1,5}}"
    return bool(re.fullmatch(pattern, url))


def _whole_number(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= MAX_QUANTITY:
        return None
    return value


def _next_record_number() -> str:
    prefix = f"DMG-{timezone.localdate().year}-"
    numbers = DamagedStock.objects.filter(record_number__startswith=prefix).values_list("record_number", flat=True)
    sequence = max((int(number[len(prefix):]) for number in numbers if number[len(prefix):].isdigit()), default=0)
    return f"{prefix}{sequence + 1:04d}"


def _movement(record: DamagedStock, inventory: Inventory, *, kind: str, unit: str, quantity: int,
              before: int, after: int, reference_type: str, note: str, actor: User) -> None:
    InventoryTransaction.objects.create(
        warehouse_id=inventory.warehouse_id,
        product_id=inventory.product_id,
        type=kind,
        quantity=quantity,
        quantity_unit=unit,
        stock_unit_label="Case" if unit == InventoryQuantityUnit.CASE else "Bottle",
        previous_stock=before,
        updated_stock=after,
        case_capacity_snapshot=record.units_per_case,
        reference_type=reference_type,
        reference_id=record.id,
        performed_by=_name(actor) or str(actor.id),
        notes=f"{record.record_number}: {note}",
    )


def _reserved(**scope) -> tuple[int, int]:
    """Cases and bottles promised to orders not delivered yet, counted from the reservations.

    The rows, not Inventory's reserved counters: those can include reservations made
    before reserved_base_units was kept in step (see inventory_allocation).
    """
    totals = InventoryReservation.objects.filter(status=ReservationStatus.RESERVED, **scope).aggregate(
        cases=Sum("standard_case_quantity"), units=Sum("quantity_base_units")
    )
    return int(totals["cases"] or 0), int(totals["units"] or 0)


def _set_aside(record: DamagedStock, inventory: Inventory, batch: StockBatch, actor: User) -> None:
    """Take the damaged units out of the batch and the inventory, one movement per change."""
    per_case = record.units_per_case
    cause = record.get_cause_display().lower()
    if record.cases:
        before = inventory.quantity
        inventory.quantity -= record.cases
        batch.quantity -= record.cases
        _movement(record, inventory, kind="OUT", unit=InventoryQuantityUnit.CASE, quantity=record.cases,
                  before=before, after=inventory.quantity, reference_type=RECORDED, actor=actor,
                  note=f"damaged stock set aside ({cause}); batch {record.batch_number}")
    if record.cases_opened:
        before = inventory.quantity
        inventory.quantity -= record.cases_opened
        batch.quantity -= record.cases_opened
        _movement(record, inventory, kind="OUT", unit=InventoryQuantityUnit.CASE, quantity=record.cases_opened,
                  before=before, after=inventory.quantity, reference_type=RECORDED, actor=actor,
                  note=f"case opened to set aside damaged bottles; batch {record.batch_number}")
        bottles = record.cases_opened * per_case
        before = inventory.loose_bottles
        inventory.loose_bottles += bottles
        batch.loose_units += bottles
        _movement(record, inventory, kind="IN", unit=InventoryQuantityUnit.BASE_UNIT, quantity=bottles,
                  before=before, after=inventory.loose_bottles, reference_type=RECORDED, actor=actor,
                  note=f"bottles from the opened case; batch {record.batch_number}")
    if record.loose_units:
        before = inventory.loose_bottles
        inventory.loose_bottles -= record.loose_units
        batch.loose_units -= record.loose_units
        _movement(record, inventory, kind="OUT", unit=InventoryQuantityUnit.BASE_UNIT, quantity=record.loose_units,
                  before=before, after=inventory.loose_bottles, reference_type=RECORDED, actor=actor,
                  note=f"damaged bottles set aside ({cause}); batch {record.batch_number}")
    if batch.quantity == 0 and batch.loose_units == 0:
        batch.status = "DEPLETED"
    batch.save(update_fields=["quantity", "loose_units", "status", "updated_at"])
    inventory.save(update_fields=["quantity", "loose_bottles", "updated_at"])


def _check_free_stock(inventory: Inventory, batch: StockBatch, cases: int, loose: int, per_case: int) -> int:
    """Refuse damage the batch cannot cover without touching reserved stock; returns cases to open."""
    take_loose = min(max(0, batch.loose_units), loose)
    cases_to_open = math.ceil((loose - take_loose) / per_case) if loose > take_loose else 0
    if cases + cases_to_open > batch.quantity:
        raise _Refusal(
            f"Batch {batch.batch_number} holds {_quantity_label(batch.quantity, batch.loose_units)}; "
            "record no more than that.", 409,
        )
    if cases + cases_to_open > inventory.quantity or take_loose > inventory.loose_bottles:
        raise _Refusal("The inventory count for this product is lower than its batch. Recount the stock first.", 409)

    cases_after = batch.quantity - cases - cases_to_open
    loose_after = batch.loose_units + cases_to_open * per_case - loose
    reserved_cases, reserved_units = _reserved(stock_batch=batch)
    # Reservations without a batch draw on the product's stock as a whole.
    all_reserved_cases, all_reserved_units = _reserved(inventory=inventory)
    inventory_cases_after = inventory.quantity - cases - cases_to_open
    inventory_units_after = inventory_cases_after * per_case + inventory.loose_bottles + cases_to_open * per_case - loose
    if (
        cases_after < reserved_cases
        or cases_after * per_case + loose_after < reserved_units
        or inventory_cases_after < all_reserved_cases
        or inventory_units_after < all_reserved_units
    ):
        free_units = max(0, batch.quantity * per_case + batch.loose_units - reserved_units)
        free_cases, free_loose = divmod(free_units, per_case)
        raise _Refusal(
            f"That would use stock reserved for orders. Only {_quantity_label(free_cases, free_loose)} "
            f"of batch {batch.batch_number} are free.", 409,
        )
    return cases_to_open


def _record(request: HttpRequest) -> JsonResponse:
    user, allowed, error = _operator(request)
    if error is not None:
        return error
    body = _json_body(request)
    if not isinstance(body, dict):
        return _err("A damaged stock object is required", 400)
    request_id = str(body.get("requestId") or "").strip()
    if not request_id or len(request_id) > REQUEST_ID_MAX_LENGTH:
        return _err(f"A requestId of 1 to {REQUEST_ID_MAX_LENGTH} characters is required", 400)
    cases, loose = _whole_number(body.get("cases", 0)), _whole_number(body.get("looseUnits", 0))
    if cases is None or loose is None:
        return _err("Enter whole numbers of cases and bottles", 400)
    if cases + loose == 0:
        return _err("Enter how many cases or bottles are damaged", 400)
    cause = body.get("cause")
    if cause not in DamagedStock.Cause.values:
        return _err("Choose what caused the damage", 400)
    description = body.get("description")
    if not isinstance(description, str) or not description.strip():
        return _err("Describe the damage", 400)
    description = description.strip()
    if len(description) > DESCRIPTION_MAX_LENGTH:
        return _err(f"The description must be {DESCRIPTION_MAX_LENGTH} characters or fewer", 400)
    photo_url = body.get("photoUrl") or ""
    if not isinstance(photo_url, str) or (photo_url and not _is_own_photo_url(photo_url, user.id)):
        return _err("Attach a photo uploaded from this account", 400)

    source = StockBatch.objects.select_related("inventory").filter(id=str(body.get("batchId") or "").strip()).first()
    if source is None:
        return _err("Stock batch not found", 404)
    if str(source.inventory.warehouse_id) not in allowed:
        return _err("This batch is outside your assigned warehouse", 403)

    def replay(previous: DamagedStock) -> JsonResponse:
        if (previous.stock_batch_id, previous.cases, previous.loose_units, previous.cause, previous.description) != (
            source.id, cases, loose, cause, description,
        ):
            return _err("This requestId was already used for another damaged stock record", 409)
        return _ok({"success": True, "record": serialize_record(_records().get(id=previous.id), can_manage=True)})

    record = None
    try:
        for attempt in range(_NUMBER_ATTEMPTS):
            try:
                with transaction.atomic():
                    # Same lock order as allocation: the inventory row, then the batch.
                    inventory = Inventory.objects.select_for_update(of=("self",)).select_related("product").get(id=source.inventory_id)
                    batch = StockBatch.objects.select_for_update().get(id=source.id)
                    previous = DamagedStock.objects.filter(warehouse_id=inventory.warehouse_id, request_id=request_id).first()
                    if previous is not None:
                        return replay(previous)
                    per_case = units_per_case(inventory.product)
                    cases_to_open = _check_free_stock(inventory, batch, cases, loose, per_case)
                    record = DamagedStock.objects.create(
                        record_number=_next_record_number(),
                        request_id=request_id,
                        warehouse_id=inventory.warehouse_id,
                        inventory=inventory,
                        product_id=inventory.product_id,
                        stock_batch=batch,
                        batch_number=batch.batch_number,
                        cases=cases,
                        loose_units=loose,
                        units_per_case=per_case,
                        cases_opened=cases_to_open,
                        cause=cause,
                        description=description,
                        photo_url=photo_url,
                        recorded_by=user,
                    )
                    _set_aside(record, inventory, batch, user)
                break
            except IntegrityError:
                # Another recording took this number, or this very request, a moment ago.
                previous = DamagedStock.objects.filter(warehouse_id=source.inventory.warehouse_id, request_id=request_id).first()
                if previous is not None:
                    return replay(previous)
                if attempt == _NUMBER_ATTEMPTS - 1:
                    return _err("The damaged stock could not be recorded. Please try again.", 503)
    except _Refusal as refusal:
        return _err(refusal.message, refusal.status)

    record = _records().get(id=record.id)
    # Administrators watch stock losses; the warehouse that recorded it already knows.
    legacy._create_admin_notifications(
        title="Damaged stock recorded",
        message=(
            f"{_name(user) or 'Warehouse staff'} set aside {_quantity_label(record.cases, record.loose_units)} "
            f"of {record.product.name} (batch {record.batch_number}) at {record.warehouse.name}: "
            f"{record.get_cause_display().lower()}."
        ),
        notification_type="INVENTORY",
        reference_type="damaged_stock",
        reference_id=record.id,
    )
    return _ok({"success": True, "record": serialize_record(record, can_manage=True)}, 201)


def _list(request: HttpRequest) -> JsonResponse:
    user, allowed, error = _reader(request)
    if error is not None:
        return error
    queryset = _records()
    if allowed is not None:
        queryset = queryset.filter(warehouse_id__in=allowed)
    summary_rows = queryset.values("status").annotate(count=Count("id"), loss=Sum("loss_amount"))
    summary = {status: 0 for status in DamagedStock.Status.values}
    loss_total = Decimal("0.00")
    for row in summary_rows:
        summary[row["status"]] = row["count"]
        loss_total += row["loss"] or Decimal("0.00")

    status = str(request.GET.get("status") or "all").strip().upper()
    if status != "ALL":
        if status not in DamagedStock.Status.values:
            return _err("Invalid status", 400)
        queryset = queryset.filter(status=status)
    search = str(request.GET.get("search") or "").strip()
    if search:
        queryset = queryset.filter(
            Q(record_number__icontains=search) | Q(batch_number__icontains=search)
            | Q(product__name__icontains=search) | Q(product__sku__icontains=search)
        )
    page, size, offset = legacy._pagination(request)
    queryset = queryset.order_by("-created_at", "-id")
    total = queryset.count()
    rows = list(queryset[offset : offset + size])
    managing = _role(user) == RoleType.WAREHOUSE_STAFF
    return _ok({
        "success": True,
        "records": [serialize_record(row, can_manage=managing and str(row.warehouse_id) in (allowed or set())) for row in rows],
        "summary": {
            "pending": summary[DamagedStock.Status.PENDING],
            "disposed": summary[DamagedStock.Status.DISPOSED],
            "returnedToSupplier": summary[DamagedStock.Status.RETURNED_TO_SUPPLIER],
            "restocked": summary[DamagedStock.Status.RESTOCKED],
            "lossAmount": float(loss_total),
        },
        "total": total,
        "page": page,
        "pageSize": size,
        "totalPages": (total + size - 1) // size,
    })


@csrf_exempt
@require_http_methods(["GET", "POST"])
def damaged_stock_collection(request: HttpRequest) -> JsonResponse:
    return _list(request) if request.method == "GET" else _record(request)


@csrf_exempt
@require_http_methods(["POST"])
def damaged_stock_photo(request: HttpRequest) -> JsonResponse:
    """Store the one photo a record may carry; the record then references its URL."""
    user, _, error = _operator(request)
    if error is not None:
        return error
    return media._handle_image_upload(request, PHOTO_FOLDER, _photo_prefix(user.id))


def _put_back(record: DamagedStock, actor: User) -> None:
    if record.stock_batch_id is None:
        raise _Refusal("The original batch no longer exists. Dispose of it or return it to the supplier instead.", 409)
    inventory = Inventory.objects.select_for_update().get(id=record.inventory_id)
    batch = StockBatch.objects.select_for_update().get(id=record.stock_batch_id)
    if record.cases:
        before = inventory.quantity
        inventory.quantity += record.cases
        batch.quantity += record.cases
        _movement(record, inventory, kind="IN", unit=InventoryQuantityUnit.CASE, quantity=record.cases,
                  before=before, after=inventory.quantity, reference_type=RESTOCKED, actor=actor,
                  note=f"found sellable and put back; batch {record.batch_number}")
    if record.loose_units:
        before = inventory.loose_bottles
        inventory.loose_bottles += record.loose_units
        batch.loose_units += record.loose_units
        _movement(record, inventory, kind="IN", unit=InventoryQuantityUnit.BASE_UNIT, quantity=record.loose_units,
                  before=before, after=inventory.loose_bottles, reference_type=RESTOCKED, actor=actor,
                  note=f"bottles found sellable and put back; batch {record.batch_number}")
    if str(batch.status or "").upper() == "DEPLETED" and (batch.quantity or batch.loose_units):
        batch.status = "HEALTHY"
    batch.save(update_fields=["quantity", "loose_units", "status", "updated_at"])
    inventory.save(update_fields=["quantity", "loose_bottles", "updated_at"])


def _write_off(record: DamagedStock) -> None:
    product = record.product
    case_price = Decimal(str(product.case_price or product.price or 0))
    unit_price = Decimal(str(product.retail_unit_price)) if product.retail_unit_price else case_price / max(1, record.units_per_case)
    record.loss_case_price = case_price.quantize(Decimal("0.01"))
    record.loss_unit_price = unit_price.quantize(Decimal("0.01"))
    record.loss_amount = (record.loss_case_price * record.cases + record.loss_unit_price * record.loose_units).quantize(Decimal("0.01"))


@csrf_exempt
@require_http_methods(["PATCH"])
def damaged_stock_detail(request: HttpRequest, record_id: str) -> JsonResponse:
    """Dispose of it, return it to the supplier, or put it back into its batch."""
    user, allowed, error = _operator(request)
    if error is not None:
        return error
    record = DamagedStock.objects.filter(id=record_id).first()
    if record is None:
        return _err("Damaged stock record not found", 404)
    if str(record.warehouse_id) not in allowed:
        return _err("This record is outside your assigned warehouse", 403)
    body = _json_body(request)
    if not isinstance(body, dict):
        return _err("An action object is required", 400)
    action = body.get("action")
    if action not in ACTIONS:
        return _err("Choose DISPOSE, RETURN_TO_SUPPLIER or RESTOCK", 400)
    notes = body.get("notes", "")
    if not isinstance(notes, str) or len(notes.strip()) > NOTES_MAX_LENGTH:
        return _err(f"Notes must be {NOTES_MAX_LENGTH} characters or fewer", 400)
    notes = notes.strip()
    target = ACTIONS[action]

    try:
        with transaction.atomic():
            locked = DamagedStock.objects.select_for_update(of=("self",)).select_related("product").get(id=record.id)
            if locked.status != DamagedStock.Status.PENDING:
                if locked.status == target and locked.resolution_notes == notes:
                    # A retried request: the same outcome is already recorded.
                    return _ok({"success": True, "record": serialize_record(_records().get(id=locked.id))})
                raise _Refusal(f"This damaged stock is already {locked.get_status_display().lower()}", 409)
            if target == DamagedStock.Status.RESTOCKED:
                _put_back(locked, user)
            if target == DamagedStock.Status.DISPOSED:
                _write_off(locked)
            locked.status = target
            locked.resolved_by = user
            locked.resolved_at = timezone.now()
            locked.resolution_notes = notes
            locked.save(update_fields=[
                "status", "resolved_by", "resolved_at", "resolution_notes",
                "loss_case_price", "loss_unit_price", "loss_amount", "updated_at",
            ])
    except _Refusal as refusal:
        return _err(refusal.message, refusal.status)
    return _ok({"success": True, "record": serialize_record(_records().get(id=record.id))})


def disposed_damaged_rows(allowed_warehouse_ids: set[str] | None) -> list[dict[str, Any]]:
    """Disposed damaged stock in the shape of the expired-stock disposal history.

    One row per unit, because a history row carries a single quantity and unit.
    """
    queryset = _records().filter(status=DamagedStock.Status.DISPOSED)
    if allowed_warehouse_ids is not None:
        queryset = queryset.filter(warehouse_id__in=allowed_warehouse_ids)
    rows = []
    for record in queryset:
        batch = record.stock_batch
        base = {
            "disposedAt": record.resolved_at or record.updated_at,
            "batchId": record.stock_batch_id,
            "batchNumber": record.batch_number or "Unavailable batch",
            "product": legacy._serialize_model(record.product),
            "warehouse": legacy._serialize_model(record.warehouse),
            "expiryDate": batch.expiry_date if batch else None,
            "manufacturedDate": batch.receipt_date if batch else None,
            "reason": f"Damaged ({record.record_number}): {record.get_cause_display()}. {record.description}",
            "performedBy": _name(record.resolved_by),
            "lossBasis": "LISTED_PRICE",
            "source": "DAMAGED_STOCK",
        }
        for unit, quantity, price in (
            ("CASE", record.cases, record.loss_case_price),
            ("BASE_UNIT", record.loose_units, record.loss_unit_price),
        ):
            if quantity:
                loss = (price * quantity).quantize(Decimal("0.01")) if price is not None else None
                rows.append({**base, "id": f"{record.id}:{unit}", "quantity": quantity, "quantityUnit": unit,
                             "lossUnitPrice": price, "lossAmount": loss})
    return rows


@require_GET
def damaged_stock_customer_reports(request: HttpRequest) -> JsonResponse:
    """Damaged items customers reported in replacement claims, read-only.

    The claims keep their own workflow in Replacements; this lists their lines so
    the Inventory module shows every damaged product, with the claim's status.
    """
    _, allowed, error = _reader(request)
    if error is not None:
        return error
    lines = (
        ReplacementLine.objects.select_related("replacement", "replacement__order", "product")
        .order_by("-replacement__created_at", "id")
    )
    if allowed is not None:
        # Both paths are to-one, so the OR cannot repeat a line.
        lines = lines.filter(
            Q(replacement__order__warehouse_id__in=allowed)
            | Q(replacement__delivery_transaction__warehouse_id__in=allowed)
        )
    page, size, offset = legacy._pagination(request)
    total = lines.count()
    rows = list(lines[offset : offset + size])
    customer_names = dict(
        Customer.objects.filter(id__in={row.replacement.customer_id for row in rows}).values_list("id", "name")
    )
    reports = []
    for line in rows:
        replacement = line.replacement
        product = line.product
        reports.append({
            "id": line.id,
            "replacementId": replacement.id,
            "replacementNumber": replacement.replacement_number,
            "orderNumber": replacement.order.order_number if replacement.order_id else None,
            "customerName": customer_names.get(replacement.customer_id),
            "productName": line.product_name or (product.name if product else "Product"),
            "productSku": line.product_sku or (product.sku if product else None),
            "productSizes": [str(size).strip() for size in ((product.sizes if product else None) or []) if str(size).strip()],
            "quantity": line.requested_base_units,
            "replacedQuantity": line.replaced_base_units,
            "unitLabel": line.base_unit_label or "unit",
            "reason": line.reason,
            "description": line.description or None,
            "status": legacy._normalize_replacement_status(replacement.status, replacement.replacement_mode),
            "reportedAt": _iso(replacement.created_at),
        })
    return _ok({
        "success": True,
        "reports": reports,
        "total": total,
        "page": page,
        "pageSize": size,
        "totalPages": (total + size - 1) // size,
    })
