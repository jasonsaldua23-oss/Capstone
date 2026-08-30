"""Authoritative product order-unit weight calculation.

Weights are stored in kilograms for the complete case/pack.  The calculation
uses the selected container size and quantity so every product registered by
the application has a usable load weight.
"""

from __future__ import annotations

import math
import re
from typing import Any

from .beverage_categories import category_spec


# Returnable glass containers include the established bottle weight as well as
# their contents. These values preserve the weights already used by the UI.
RETURNABLE_GLASS_UNIT_WEIGHT_KG: dict[str, float] = {
    "8oz": 0.45,
    "12oz": 0.68,
    "1l": 1.55,
}

# Existing registration choices use rounded beverage weights per container.
STANDARD_UNIT_WEIGHT_KG: dict[str, float] = {
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


def normalize_product_size(value: Any) -> str | None:
    """Normalize current and legacy size labels to a calculation key."""
    raw = str(value or "").strip().lower()
    if not raw:
        return None

    compact = re.sub(r"\s+", "", raw)
    match = re.match(r"^(\d+(?:\.\d+)?)(ml|millilit(?:er|re)s?|l|lit(?:er|re)s?|oz|g)", compact)
    if not match:
        return None

    amount = float(match.group(1))
    unit = match.group(2)
    if unit.startswith("millilit") or unit == "ml":
        suffix = "ml"
    elif unit.startswith("lit") or unit == "l":
        suffix = "l"
    else:
        suffix = unit
    formatted_amount = str(int(amount)) if amount.is_integer() else f"{amount:g}"
    return f"{formatted_amount}{suffix}"


def _first_size(sizes: Any) -> Any:
    if isinstance(sizes, (list, tuple)):
        return sizes[0] if sizes else None
    return sizes


def _is_returnable_glass(category: Any, packaging_type: Any = None) -> bool:
    raw_category = str(category or "").strip()
    if raw_category:
        # Category is the authoritative physical-packaging source. The stored
        # packaging flag is retained only as a fallback for legacy blank rows.
        spec = category_spec(raw_category) or {}
        return bool(spec.get("depositAllowed"))
    return str(packaging_type or "").strip().upper() == "RETURNABLE"


def calculate_product_weight(
    *,
    sizes: Any,
    quantity_per_unit: Any,
    category: Any = None,
    packaging_type: Any = None,
) -> float | None:
    """Return the calculated case/pack weight in kg, or ``None`` if incomplete."""
    try:
        quantity = int(quantity_per_unit)
    except (TypeError, ValueError):
        return None
    if quantity <= 0:
        return None

    size_key = normalize_product_size(_first_size(sizes))
    if not size_key:
        return None

    unit_weight = None
    if _is_returnable_glass(category, packaging_type):
        unit_weight = RETURNABLE_GLASS_UNIT_WEIGHT_KG.get(size_key)
    if unit_weight is None:
        unit_weight = STANDARD_UNIT_WEIGHT_KG.get(size_key)
    if unit_weight is None or not math.isfinite(unit_weight) or unit_weight <= 0:
        return None
    return round(unit_weight * quantity, 2)


def resolve_product_weight(
    *,
    sizes: Any,
    quantity_per_unit: Any,
    category: Any = None,
    packaging_type: Any = None,
    supplied_weight: Any = None,
) -> float | None:
    """Prefer metadata-derived weight, with a positive explicit value as fallback."""
    calculated = calculate_product_weight(
        sizes=sizes,
        quantity_per_unit=quantity_per_unit,
        category=category,
        packaging_type=packaging_type,
    )
    if calculated is not None:
        return calculated
    try:
        supplied = float(supplied_weight)
    except (TypeError, ValueError):
        return None
    return round(supplied, 2) if math.isfinite(supplied) and supplied > 0 else None
