import math
import re

from django.db import migrations


RETURNABLE_GLASS_UNIT_WEIGHT_KG = {
    "8oz": 0.45,
    "12oz": 0.68,
    "1l": 1.55,
}

STANDARD_UNIT_WEIGHT_KG = {
    "7oz": 0.20,
    "8oz": 0.23,
    "12oz": 0.34,
    "195ml": 0.20,
    "237ml": 0.24,
    "240ml": 0.24,
    "250ml": 0.25,
    "290ml": 0.29,
    "300ml": 0.30,
    "320ml": 0.32,
    "330ml": 0.33,
    "350ml": 0.35,
    "355ml": 0.36,
    "450ml": 0.45,
    "500ml": 0.50,
    "600ml": 0.60,
    "900ml": 0.90,
    "1l": 1.00,
    "1.5l": 1.50,
    "2l": 2.00,
    "320g": 0.32,
    "640g": 0.64,
}


def _normalize_size(value):
    compact = re.sub(r"\s+", "", str(value or "").strip().lower())
    match = re.match(r"^(\d+(?:\.\d+)?)(ml|millilit(?:er|re)s?|l|lit(?:er|re)s?|oz|g)", compact)
    if not match:
        return None
    amount = float(match.group(1))
    raw_unit = match.group(2)
    if raw_unit == "ml" or raw_unit.startswith("millilit"):
        unit = "ml"
    elif raw_unit == "l" or raw_unit.startswith("lit"):
        unit = "l"
    else:
        unit = raw_unit
    amount_text = str(int(amount)) if amount.is_integer() else f"{amount:g}"
    return f"{amount_text}{unit}"


def backfill_product_weights(apps, schema_editor):
    Product = apps.get_model("core", "Product")
    unresolved = []

    for product in Product.objects.all().iterator():
        if product.weight is not None and math.isfinite(product.weight) and product.weight > 0:
            continue
        sizes = product.sizes or []
        size = sizes[0] if isinstance(sizes, list) and sizes else sizes
        size_key = _normalize_size(size)
        quantity = int(product.quantity_per_unit or 0)
        category = str(product.category or "").strip().casefold()
        is_returnable = (
            "glass" in category and "alcohol" not in category
            if category
            else product.packaging_type == "RETURNABLE"
        )

        unit_weight = RETURNABLE_GLASS_UNIT_WEIGHT_KG.get(size_key) if is_returnable else None
        unit_weight = unit_weight or STANDARD_UNIT_WEIGHT_KG.get(size_key)
        if not size_key or quantity <= 0 or not unit_weight:
            unresolved.append(product.sku)
            continue

        # Backfill the complete case/pack weight used by trip capacity checks.
        product.weight = round(unit_weight * quantity, 2)
        product.save(update_fields=["weight"])

    if unresolved:
        raise RuntimeError(
            "Cannot backfill product weight for: " + ", ".join(sorted(unresolved))
        )


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0104_add_replacement_cancelled_status"),
    ]

    operations = [
        migrations.RunPython(backfill_product_weights, migrations.RunPython.noop),
    ]
