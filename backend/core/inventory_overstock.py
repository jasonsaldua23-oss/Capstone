"""Overstock: more sellable stock than recent sales will clear in time.

A product is overstocked when, at its recent sales rate, its sellable stock
would last longer than OVERSTOCK_COVER_DAYS, when some of it would expire
before it sells (orders take the earliest expiry first), or when stock has sat
through the whole sales window without selling at all. It is a warning only:
stock-in stays open, because the delivery is already in the warehouse.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Any, Iterable

from django.db.models import Q, Sum
from django.utils import timezone

from .api_utils import to_int as _int
from .mixed_case import available_base_units, units_per_case
from .models import Inventory, InventoryQuantityUnit, InventoryReservation, InventoryTransaction, ReservationStatus, StockBatch

OVERSTOCK_COVER_DAYS = 60
SALES_WINDOW_DAYS = 30
# A daily rate from a few days of history is noise, so newer stock is not judged.
MIN_HISTORY_DAYS = 7

REASON_SLOW_SALES = "SLOW_SALES"
REASON_EXPIRY = "EXPIRY"
REASON_NO_SALES = "NO_SALES"

# Stock that left to customers, net of retail sales that were reversed. Disposals,
# batch corrections and transfers are not demand.
_SALES_OUT_REFERENCE_TYPES = ("order_item", "mixed_case_component", "retail_sale")
_SALES_RETURN_REFERENCE_TYPES = ("retail_sale_reversal",)


def _sales_since(since: datetime) -> Q:
    return Q(created_at__gte=since) & (
        Q(type="OUT", reference_type__in=_SALES_OUT_REFERENCE_TYPES)
        | Q(type="IN", reference_type__in=_SALES_RETURN_REFERENCE_TYPES)
    )


def _net_sales_units(rows: Iterable[dict[str, Any]], per_case: int) -> int:
    units = 0
    for row in rows:
        quantity = max(0, _int(row.get("total"), 0))
        if row.get("quantity_unit") == InventoryQuantityUnit.CASE:
            quantity *= per_case
        units += quantity if row.get("type") == "OUT" else -quantity
    return max(0, units)


def _attach_recent_sales_units(inventories: list[Inventory], now: datetime | None = None) -> None:
    """Load a page of rows' recent sales in one query instead of one per product."""
    if not inventories:
        return
    since = (now or timezone.now()) - timedelta(days=SALES_WINDOW_DAYS)
    rows_by_key: dict[tuple[str, str], list[dict[str, Any]]] = {}
    totals = (
        InventoryTransaction.objects.filter(_sales_since(since))
        .filter(
            warehouse_id__in={item.warehouse_id for item in inventories},
            product_id__in={item.product_id for item in inventories},
        )
        .order_by()
        .values("warehouse_id", "product_id", "type", "quantity_unit")
        .annotate(total=Sum("quantity"))
    )
    for row in totals:
        rows_by_key.setdefault((row["warehouse_id"], row["product_id"]), []).append(row)
    for item in inventories:
        rows = rows_by_key.get((item.warehouse_id, item.product_id), [])
        item._recent_sales_units = _net_sales_units(rows, units_per_case(item.product))


def _recent_sales_units(inventory: Inventory, now: datetime) -> int:
    if hasattr(inventory, "_recent_sales_units"):
        return inventory._recent_sales_units
    rows = (
        InventoryTransaction.objects.filter(_sales_since(now - timedelta(days=SALES_WINDOW_DAYS)))
        .filter(warehouse_id=inventory.warehouse_id, product_id=inventory.product_id)
        .order_by()
        .values("type", "quantity_unit")
        .annotate(total=Sum("quantity"))
    )
    return _net_sales_units(rows, units_per_case(inventory.product))


def _sellable_batches(inventory: Inventory, now: datetime) -> list[tuple[StockBatch, int]]:
    """Unreserved units per sellable batch, in the earliest-expiry-first order orders use."""
    per_case = units_per_case(inventory.product)
    prefetched_batches = getattr(inventory, "_availability_batches", None)
    batches = list(prefetched_batches) if prefetched_batches is not None else list(
        StockBatch.objects.filter(inventory=inventory)
    )
    prefetched_reservations = getattr(inventory, "_active_reservations", None)
    reservations = list(prefetched_reservations) if prefetched_reservations is not None else list(
        InventoryReservation.objects.filter(inventory=inventory, status=ReservationStatus.RESERVED)
    )
    reserved_by_batch: dict[str, int] = {}
    for reservation in reservations:
        if reservation.stock_batch_id:
            reserved_by_batch[reservation.stock_batch_id] = reserved_by_batch.get(reservation.stock_batch_id, 0) + max(
                0, _int(reservation.quantity_base_units, 0)
            )
    sellable = []
    for batch in batches:
        # Same eligibility as the allocator: expired or held batches cannot sell.
        if str(batch.status or "").strip().upper() != "HEALTHY":
            continue
        if batch.expiry_date is not None and batch.expiry_date <= now:
            continue
        units = max(0, _int(batch.quantity, 0)) * per_case + max(0, _int(batch.loose_units, 0))
        remaining = units - reserved_by_batch.get(batch.id, 0)
        if remaining > 0:
            sellable.append((batch, remaining))
    sellable.sort(key=lambda entry: (entry[0].expiry_date is None, entry[0].expiry_date or entry[0].receipt_date, entry[0].created_at))
    return sellable


def _expires_before_selling(batches: list[tuple[StockBatch, int]], daily_units: float, now: datetime) -> bool:
    sold_through = 0
    for batch, units in batches:
        sold_through += units
        if batch.expiry_date is None:
            continue
        days_left = (batch.expiry_date - now).total_seconds() / 86400
        if sold_through / daily_units > days_left:
            return True
    return False


def _inventory_overstock_status(inventory: Inventory, now: datetime | None = None) -> dict[str, Any]:
    """Return {"overstocked", "reason", "coverDays"}; coverDays is None without a sales rate."""
    now = now or timezone.now()
    status: dict[str, Any] = {"overstocked": False, "reason": None, "coverDays": None}
    sellable_units = available_base_units(inventory)
    if sellable_units <= 0:
        return status
    batches = _sellable_batches(inventory, now)
    sold_units = _recent_sales_units(inventory, now)
    if sold_units <= 0:
        # Zero sales only means dead stock once that stock has sat through the whole window.
        oldest = min((batch.created_at for batch, _ in batches), default=None)
        if oldest is not None and now - oldest >= timedelta(days=SALES_WINDOW_DAYS):
            status.update(overstocked=True, reason=REASON_NO_SALES)
        return status
    history_start = max(now - timedelta(days=SALES_WINDOW_DAYS), inventory.created_at or now)
    history_days = (now - history_start).total_seconds() / 86400
    if history_days < MIN_HISTORY_DAYS:
        return status
    daily_units = sold_units / history_days
    cover_days = math.floor(sellable_units / daily_units)
    status["coverDays"] = cover_days
    if cover_days > OVERSTOCK_COVER_DAYS:
        status.update(overstocked=True, reason=REASON_SLOW_SALES)
    elif _expires_before_selling(batches, daily_units, now):
        status.update(overstocked=True, reason=REASON_EXPIRY)
    return status
