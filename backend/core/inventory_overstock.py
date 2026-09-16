"""Overstock detection rules guarding stock-in and restock."""

from .api_utils import to_int as _int
from .models import Inventory, InventoryTransaction


def _is_inventory_overstocked_flagged_by_stockin(inventory: Inventory) -> bool:
    threshold = max(0, _int(getattr(inventory, "threshold", 0), 0))
    if threshold <= 0:
        return False
    available_quantity = max(
        0,
        _int(getattr(inventory, "quantity", 0), 0)
        - _int(getattr(inventory, "reserved_quantity", 0), 0),
    )
    # Fix: reserved stock is not available excess stock and must not keep an item overstocked.
    if available_quantity < (threshold * 10):
        return False
    latest_stockin = (
        InventoryTransaction.objects.filter(
            warehouse_id=getattr(inventory, "warehouse_id", None),
            product_id=getattr(inventory, "product_id", None),
            type="IN",
            reference_type="stock_batch",
        )
        .order_by("-created_at")
        .only("quantity")
        .first()
    )
    if not latest_stockin:
        return False
    return max(0, _int(getattr(latest_stockin, "quantity", 0), 0)) >= (threshold * 10)


def _is_inventory_overstocked_for_restock_block(inventory: Inventory, incoming_restock_qty: int = 0) -> bool:
    """
    Overstock guard for stock-in:
    - block only when product is currently flagged overstocked
    - latest stock-in and current available quantity must both be >= 10x threshold
    """
    return _is_inventory_overstocked_flagged_by_stockin(inventory)


def _stockin_would_flag_overstock(inventory: Inventory, stockin_qty: int) -> bool:
    threshold = max(0, _int(getattr(inventory, "threshold", 0), 0))
    if threshold <= 0:
        return False
    return max(0, _int(stockin_qty, 0)) >= (threshold * 10)
