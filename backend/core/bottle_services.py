"""Returnable-container product rules shared by catalog and bottle APIs."""

from decimal import Decimal
from typing import Any

from .beverage_categories import category_spec
from .models import ContainerType, Product, ProductPackaging


def coerce_deposit_amount(value: Any) -> tuple[float | None, str | None]:
    """Parse an optional, non-negative whole-peso deposit amount."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None, None
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return None, "Deposit amounts must be numbers."
    if amount != amount or amount in (float("inf"), float("-inf")):
        return None, "Deposit amounts must be numbers."
    if amount < 0:
        return None, "Deposit amounts cannot be negative."
    if not amount.is_integer():
        return None, "Deposit amounts must be whole numbers."
    return int(amount), None


def is_returnable_product(product: Product) -> bool:
    if not product:
        return False
    product_spec = category_spec(product.category)
    # An explicit non-glass category overrides stale returnable configuration.
    if product_spec and not product_spec["depositAllowed"]:
        return False
    if product.packaging_type == "RETURNABLE":
        return True
    category = str(product.category or "").strip().lower()
    if any(key in category for key in ["(glass)", "glass", "returnable"]):
        if not any(key in category for key in ["pet", "plastic", "can"]):
            return True
    return ProductPackaging.objects.filter(product=product, is_returnable=True, is_active=True).exists()


def get_or_create_product_packaging(product: Product) -> tuple[ProductPackaging, ContainerType]:
    """Ensure a returnable glass product has active packaging and container records."""
    is_1l = any("1l" in str(size).lower() or "1 liter" in str(size).lower() for size in (product.sizes or []))
    container_code = "RGB-GLASS-1L" if is_1l else "RGB-GLASS-330"
    container_name = "1L Returnable Glass Bottle" if is_1l else "330ml Returnable Glass Bottle"
    deposit_amount = Decimal("6.00") if is_1l else Decimal("2.00")
    case_deposit_amount = Decimal("52.00") if is_1l else Decimal("42.00")
    containers_per_case = 12 if is_1l else (product.quantity_per_unit or 24)

    container_type, _ = ContainerType.objects.get_or_create(
        code=container_code,
        defaults={
            "name": container_name,
            "category": ContainerType.Category.BOTTLE,
            "material": ContainerType.Material.GLASS,
            "deposit_amount": deposit_amount,
            "is_returnable": True,
            "is_active": True,
        },
    )
    packaging = ProductPackaging.objects.filter(product=product, is_active=True).select_related("container_type").first()
    if not packaging:
        packaging, _ = ProductPackaging.objects.get_or_create(
            product=product,
            container_type=container_type,
            defaults={
                "containers_per_case": containers_per_case,
                "units_per_container": 1,
                "is_primary": True,
                "is_returnable": True,
                "deposit_amount": deposit_amount,
                "case_deposit_amount": case_deposit_amount,
                "is_active": True,
            },
        )
    if not packaging.is_returnable or not packaging.is_active:
        packaging.is_returnable = True
        packaging.is_active = True
        packaging.save(update_fields=["is_returnable", "is_active"])
    if product.packaging_type != "RETURNABLE":
        product.packaging_type = "RETURNABLE"
        product.save(update_fields=["packaging_type"])
    return packaging, packaging.container_type
