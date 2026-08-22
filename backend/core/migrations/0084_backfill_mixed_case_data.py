import hashlib
import re

from django.db import migrations
from django.db.models import Sum


ALLOCATION_RE = re.compile(r"(?P<batch>[A-Za-z0-9._-]+)\s+x(?P<quantity>\d+)")


def _normalized_text(value):
    return " ".join(str(value or "").strip().lower().split())


def _product_profile_parts(product):
    units_per_case = int(product.quantity_per_unit or 0)
    category = str(product.category or "").strip()
    sizes = product.sizes if isinstance(product.sizes, list) else []
    sizes = [str(value).strip() for value in sizes if str(value).strip()]
    if units_per_case <= 0 or not category or not sizes:
        return None
    container_size = ", ".join(sorted(dict.fromkeys(sizes), key=str.lower))
    compatibility_key = "|".join(
        [_normalized_text(category), _normalized_text(container_size), str(units_per_case)]
    )
    return category, container_size, units_per_case, compatibility_key


def _active_reserved_cases(InventoryTransaction, order_item_id):
    rows = InventoryTransaction.objects.filter(
        reference_type="order_item_reserve",
        reference_id=order_item_id,
    ).values("type", "quantity")
    balance = 0
    for row in rows:
        quantity = int(row.get("quantity") or 0)
        tx_type = str(row.get("type") or "").strip().upper()
        if tx_type == "RESERVE":
            balance += quantity
        elif tx_type in {"UNRESERVE", "RESERVE_CONSUMED"}:
            balance -= quantity
    return balance


def _parsed_batch_allocations(notes):
    text = str(notes or "")
    marker = "Reserved using"
    marker_index = text.rfind(marker)
    if marker_index < 0:
        return []
    allocation_text = text[marker_index:].splitlines()[0]
    return [
        (match.group("batch"), int(match.group("quantity")))
        for match in ALLOCATION_RE.finditer(allocation_text)
    ]


def forwards(apps, schema_editor):
    # The backfill reconstructs reservations from several legacy tables. Hold a
    # short transactional lock so checkout/delivery/cancellation cannot change
    # those rows between validation and creation.
    schema_editor.execute(
        'LOCK TABLE "Product", "Inventory", "InventoryTransaction", '
        '"Order", "OrderItem", "StockBatch" IN ACCESS EXCLUSIVE MODE'
    )
    Product = apps.get_model("core", "Product")
    PackagingProfile = apps.get_model("core", "PackagingProfile")
    Inventory = apps.get_model("core", "Inventory")
    InventoryTransaction = apps.get_model("core", "InventoryTransaction")
    InventoryReservation = apps.get_model("core", "InventoryReservation")
    OrderItem = apps.get_model("core", "OrderItem")
    Order = apps.get_model("core", "Order")
    StockBatch = apps.get_model("core", "StockBatch")

    profile_by_key = {}
    for product in Product.objects.all().order_by("id"):
        parts = _product_profile_parts(product)
        if not parts:
            continue
        category, container_size, units_per_case, compatibility_key = parts
        profile = profile_by_key.get(compatibility_key)
        if profile is None:
            code_hash = hashlib.sha256(compatibility_key.encode("utf-8")).hexdigest()[:12].upper()
            profile, _ = PackagingProfile.objects.get_or_create(
                code=f"PKG-{code_hash}",
                defaults={
                    "name": f"{category} · {container_size} · {units_per_case} units",
                    "container_type": category,
                    "container_size": container_size,
                    "standard_units_per_case": units_per_case,
                    "allowed_mixed_case_capacities": [units_per_case],
                    "compatibility_key": compatibility_key,
                    "base_unit_label": "unit",
                    "is_active": True,
                },
            )
            profile_by_key[compatibility_key] = profile
        product.packaging_profile_id = profile.id
        product.save(update_fields=["packaging_profile"])

    expected_reserved_by_inventory = {}
    for inventory in Inventory.objects.select_related("product").all():
        units_per_case = int(getattr(inventory.product, "quantity_per_unit", 0) or 0)
        reserved_cases = int(inventory.reserved_quantity or 0)
        if reserved_cases < 0:
            raise RuntimeError(f"Cannot backfill inventory {inventory.id}: reserved cases are negative.")
        if reserved_cases > 0 and units_per_case <= 0:
            raise RuntimeError(
                f"Cannot backfill inventory {inventory.id}: reserved cases exist but units per case is missing."
            )
        reserved_base_units = reserved_cases * units_per_case
        inventory.reserved_base_units = reserved_base_units
        inventory.save(update_fields=["reserved_base_units"])
        expected_reserved_by_inventory[inventory.id] = reserved_base_units

    order_map = {
        row["id"]: row
        for row in Order.objects.all().values("id", "status", "warehouse_id")
    }
    reserved_cases_by_batch = {}
    for order_item in OrderItem.objects.select_related("product").all().order_by("created_at", "id"):
        active_reserved_cases = _active_reserved_cases(InventoryTransaction, order_item.id)
        if active_reserved_cases < 0:
            raise RuntimeError(
                f"Cannot backfill order item {order_item.id}: reservation transaction balance is negative."
            )
        if active_reserved_cases <= 0:
            continue
        if active_reserved_cases != int(order_item.quantity or 0):
            raise RuntimeError(
                f"Cannot backfill order item {order_item.id}: active reservation is "
                f"{active_reserved_cases} case(s), but the item quantity is {int(order_item.quantity or 0)}."
            )
        parent_order = order_map.get(order_item.order_id) or {}
        order_status = str(parent_order.get("status") or "").strip().upper()
        if order_status in {"CANCELLED", "REJECTED", "DELIVERED"}:
            raise RuntimeError(
                f"Cannot backfill order item {order_item.id}: terminal order has an active reservation."
            )
        product = order_item.product
        if product is None:
            raise RuntimeError(f"Cannot backfill order item {order_item.id}: product is missing.")
        units_per_case = int(product.quantity_per_unit or 0)
        if units_per_case <= 0:
            raise RuntimeError(f"Cannot backfill order item {order_item.id}: units per case is missing.")
        allocations = _parsed_batch_allocations(order_item.notes)
        if sum(quantity for _, quantity in allocations) != active_reserved_cases:
            raise RuntimeError(
                f"Cannot backfill order item {order_item.id}: recorded batch allocations do not match "
                f"the active reservation of {active_reserved_cases} case(s)."
            )
        for batch_number, case_quantity in allocations:
            batch = StockBatch.objects.select_related("inventory").filter(
                batch_number=batch_number,
                inventory__product_id=product.id,
                inventory__warehouse_id=parent_order.get("warehouse_id"),
            ).first()
            if batch is None:
                raise RuntimeError(
                    f"Cannot backfill order item {order_item.id}: batch {batch_number} was not found."
                )
            batch_reserved_cases = reserved_cases_by_batch.get(batch.id, 0) + case_quantity
            if batch_reserved_cases > int(batch.quantity or 0):
                raise RuntimeError(
                    f"Cannot backfill batch {batch_number}: reconstructed reservations exceed batch stock."
                )
            reserved_cases_by_batch[batch.id] = batch_reserved_cases
            InventoryReservation.objects.create(
                order_item_id=order_item.id,
                inventory_id=batch.inventory_id,
                stock_batch_id=batch.id,
                product_id=product.id,
                quantity_base_units=case_quantity * units_per_case,
                standard_case_quantity=case_quantity,
                allocation_policy="FIFO" if "AllocationPolicy=FIFO" in str(order_item.notes or "") else "FEFO",
                status="RESERVED",
            )

    actual_reserved = {
        row["inventory_id"]: int(row["total"] or 0)
        for row in InventoryReservation.objects.filter(status="RESERVED")
        .values("inventory_id")
        .annotate(total=Sum("quantity_base_units"))
    }
    for inventory_id, expected in expected_reserved_by_inventory.items():
        actual = actual_reserved.get(inventory_id, 0)
        if actual != expected:
            raise RuntimeError(
                f"Cannot complete reservation backfill for inventory {inventory_id}: "
                f"expected {expected} base units but reconstructed {actual}."
            )


class Migration(migrations.Migration):
    dependencies = [("core", "0083_mixed_case_schema")]

    # Reversing after live Mixed Case traffic would delete normalized reservations
    # and packaging data. Recovery must use the pre-migration backup instead.
    operations = [migrations.RunPython(forwards)]
