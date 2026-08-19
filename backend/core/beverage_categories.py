"""Authoritative beverage category packaging rules.

Product rows keep their existing order-format field (case/pack) for compatibility.
Physical packaging and loose-unit terminology are always derived from category.
"""

from __future__ import annotations

from typing import Any


CATEGORY_SPECS: dict[str, dict[str, Any]] = {
    "Carbonated (Glass)": {
        "packagingType": "Glass Bottle",
        "looseUnit": "Glass Bottle",
        "compatibilityKey": "GLASS_BOTTLE",
        "depositAllowed": True,
        "depositExempt": False,
    },
    "Carbonated (PET/PLASTIC)": {
        "packagingType": "PET/Plastic Bottle",
        "looseUnit": "PET/Plastic Bottle",
        "compatibilityKey": "PET_PLASTIC_BOTTLE",
        "depositAllowed": False,
        "depositExempt": False,
    },
    "Carbonated (Cans)": {
        "packagingType": "Can",
        "looseUnit": "Can",
        "compatibilityKey": "CAN",
        "depositAllowed": False,
        "depositExempt": False,
    },
    "Energy Drinks (Glass)": {
        "packagingType": "Glass Bottle",
        "looseUnit": "Glass Bottle",
        "compatibilityKey": "GLASS_BOTTLE",
        "depositAllowed": True,
        "depositExempt": False,
    },
    "Energy Drinks": {
        "packagingType": "PET/Plastic Bottle",
        "looseUnit": "PET/Plastic Bottle",
        "compatibilityKey": "PET_PLASTIC_BOTTLE",
        "depositAllowed": False,
        "depositExempt": False,
    },
    "Sport Drinks": {
        "packagingType": "PET/Plastic Bottle",
        "looseUnit": "PET/Plastic Bottle",
        "compatibilityKey": "PET_PLASTIC_BOTTLE",
        "depositAllowed": False,
        "depositExempt": False,
    },
    "Alcohol": {
        "packagingType": "Glass Bottle",
        "looseUnit": "Glass Bottle",
        "compatibilityKey": "GLASS_BOTTLE",
        "depositAllowed": False,
        "depositExempt": True,
    },
}

# Accept legacy values already stored without a space before the material suffix.
_CATEGORY_ALIASES = {
    "carbonated(glass)": "Carbonated (Glass)",
    "carbonated(pet/plastic)": "Carbonated (PET/PLASTIC)",
    "carbonated(cans)": "Carbonated (Cans)",
    "energy drinks(glass)": "Energy Drinks (Glass)",
}


def canonical_category(value: Any) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if raw in CATEGORY_SPECS:
        return raw
    alias = _CATEGORY_ALIASES.get(raw.casefold())
    if alias:
        return alias
    for category in CATEGORY_SPECS:
        if category.casefold() == raw.casefold():
            return category
    return None


def category_spec(value: Any) -> dict[str, Any] | None:
    category = canonical_category(value)
    if category is None:
        return None
    return {"category": category, **CATEGORY_SPECS[category]}


def require_category_spec(value: Any) -> dict[str, Any]:
    spec = category_spec(value)
    if spec is None:
        allowed = ", ".join(CATEGORY_SPECS)
        raise ValueError(f"Category must be one of: {allowed}")
    return spec


def pluralize_loose_unit(label: str, quantity: int | float) -> str:
    if quantity == 1:
        return label
    return "Cans" if label == "Can" else f"{label}s"
