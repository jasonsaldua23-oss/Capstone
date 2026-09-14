"""Inventory status transition detection shared by every stock mutation path."""

from __future__ import annotations

from dataclasses import dataclass

from django.db import transaction
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from .models import Inventory


@dataclass(frozen=True)
class _InventoryStockSnapshot:
    quantity: int
    loose_bottles: int
    reserved_quantity: int
    reserved_base_units: int
    threshold: int
    units_per_case: int


def _snapshot(inventory: Inventory) -> _InventoryStockSnapshot:
    product = getattr(inventory, "product", None)
    units_per_case = max(1, int(getattr(product, "quantity_per_unit", 0) or 1))
    return _InventoryStockSnapshot(
        quantity=max(0, int(inventory.quantity or 0)),
        loose_bottles=max(0, int(inventory.loose_bottles or 0)),
        reserved_quantity=max(0, int(inventory.reserved_quantity or 0)),
        reserved_base_units=max(0, int(inventory.reserved_base_units or 0)),
        threshold=max(0, int(inventory.threshold or 0)),
        units_per_case=units_per_case,
    )


def _available_cases(stock: _InventoryStockSnapshot) -> int:
    """Match the portal's case-level availability calculation."""
    complete_loose_cases = stock.loose_bottles // stock.units_per_case
    available_physical_cases = max(
        0,
        stock.quantity + complete_loose_cases - stock.reserved_quantity,
    )
    available_base_units = max(
        0,
        (stock.quantity * stock.units_per_case) + stock.loose_bottles - stock.reserved_base_units,
    )
    return min(available_physical_cases, available_base_units // stock.units_per_case)


@receiver(pre_save, sender=Inventory)
def _capture_previous_inventory_stock(sender, instance: Inventory, **kwargs) -> None:
    if instance._state.adding:
        instance._stock_alert_previous = None
        return
    previous = sender.objects.select_related("product").filter(pk=instance.pk).first()
    instance._stock_alert_previous = _snapshot(previous) if previous else None


@receiver(post_save, sender=Inventory)
def _schedule_inventory_stock_alert(sender, instance: Inventory, created: bool, **kwargs) -> None:
    previous = getattr(instance, "_stock_alert_previous", None)
    if created or previous is None:
        return

    current = _snapshot(instance)
    previous_available = _available_cases(previous)
    current_available = _available_cases(current)

    # Added: alert once on each downward boundary instead of on every low-stock save.
    if previous_available > 0 and current_available == 0:
        status = "out_of_stock"
    elif current.threshold > 0 and previous_available > current.threshold >= current_available:
        status = "restock"
    else:
        return

    inventory_id = str(instance.pk)

    def deliver_after_commit() -> None:
        inventory = sender.objects.select_related("warehouse", "product").filter(pk=inventory_id).first()
        if inventory is None:
            return
        # Import lazily to reuse the application's existing email and push transports
        # without introducing a models/views import cycle during Django startup.
        from .views_api import _send_inventory_stock_alert

        _send_inventory_stock_alert(
            inventory=inventory,
            status=status,
            available_qty=current_available,
            reason="an inventory stock movement",
        )

    transaction.on_commit(deliver_after_commit)
