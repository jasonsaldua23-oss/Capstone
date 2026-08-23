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
        "packagingType": "Plastic Bottle",
        "looseUnit": "Plastic Bottle",
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
        "packagingType": "Plastic Bottle",
        "looseUnit": "Plastic Bottle",
        "compatibilityKey": "PET_PLASTIC_BOTTLE",
        "depositAllowed": False,
        "depositExempt": False,
    },
    "Sport Drinks": {
        "packagingType": "Plastic Bottle",
        "looseUnit": "Plastic Bottle",
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
    "Water": {
        "packagingType": "Plastic Bottle",
        "looseUnit": "Plastic Bottle",
        "compatibilityKey": "PET_PLASTIC_BOTTLE",
        "depositAllowed": False,
        "depositExempt": True,
    },
}

# Accept legacy and alternative beverage category values stored in database
_CATEGORY_ALIASES = {
    "carbonated(glass)": "Carbonated (Glass)",
    "carbonated(pet/plastic)": "Carbonated (PET/PLASTIC)",
    "carbonated(cans)": "Carbonated (Cans)",
    "energy drinks(glass)": "Energy Drinks (Glass)",
    "beer & liquor": "Alcohol",
    "beer and liquor": "Alcohol",
    "beer": "Alcohol",
    "beers": "Alcohol",
    "liquor": "Alcohol",
    "wine": "Alcohol",
    "spirits": "Alcohol",
    "juices": "Water",
    "juice": "Water",
    "fruit juice": "Water",
    "soft drinks": "Carbonated (PET/PLASTIC)",
    "soft drink": "Carbonated (PET/PLASTIC)",
    "soda": "Carbonated (PET/PLASTIC)",
    "carbonated": "Carbonated (PET/PLASTIC)",
    "energy drink": "Energy Drinks",
    "sport drink": "Sport Drinks",
    "sports drink": "Sport Drinks",
    "sports drinks": "Sport Drinks",
    "water": "Water",
    "mineral water": "Water",
    "purified water": "Water",
}


def canonical_category(value: Any) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return "Carbonated (PET/PLASTIC)"
    if raw in CATEGORY_SPECS:
        return raw
    low = raw.casefold()
    alias = _CATEGORY_ALIASES.get(low)
    if alias:
        return alias
    for category in CATEGORY_SPECS:
        if category.casefold() == low:
            return category
    # Keyword-based fuzzy fallback for non-standard categories
    if "glass" in low:
        return "Energy Drinks (Glass)" if "energy" in low else "Carbonated (Glass)"
    if "can" in low:
        return "Carbonated (Cans)"
    if any(term in low for term in ("beer", "alcohol", "liquor", "wine", "spirit")):
        return "Alcohol"
    if "energy" in low:
        return "Energy Drinks"
    if "sport" in low:
        return "Sport Drinks"
    if any(term in low for term in ("water", "juice")):
        return "Water"
    if any(term in low for term in ("soft", "soda", "carbonat", "pet", "plastic")):
        return "Carbonated (PET/PLASTIC)"
    return "Carbonated (PET/PLASTIC)"


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
