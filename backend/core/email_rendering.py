"""Email body composition: product lines, addresses, branding and layout."""

import os
from typing import Any

from . import views_api as legacy
from .api_utils import to_int as _int
from .email_templates import EmailBody, ProductLine, format_quantity, render_html, render_text
from .models import Order, OrderItem, OrderItemType, Product, Replacement, Trip


# Helpers owned by sibling modules. Routing them through views_api keeps
# a single resolution point, so tests that patch there still apply.


def _extract_replacement_meta(notes: Any) -> dict[str, Any]:
    return legacy._extract_replacement_meta(notes)


def _get_structured_replacement_lines(meta: dict[str, Any]) -> list[dict[str, Any]]:
    return legacy._get_structured_replacement_lines(meta)


def _send_transactional_email(*, subject: str, message: str, recipients: list[str], order: Order | None=None, html_message: str | None=None) -> None:
    return legacy._send_transactional_email(subject=subject, message=message, recipients=recipients, order=order, html_message=html_message)


def _email_public_url(path: Any) -> str:
    value = str(path or "").strip()
    if not value:
        return ""
    if value.startswith(("https://", "http://")):
        low = value.lower()
        if any(h in low for h in ("127.0.0.1", "localhost", "0.0.0.0", "192.168.")):
            return ""
        return value

    public_base = str(os.getenv("EMAIL_PUBLIC_BASE_URL") or "").strip().rstrip("/")
    if public_base:
        low_base = public_base.lower()
        if not any(h in low_base for h in ("127.0.0.1", "localhost", "0.0.0.0", "192.168.")):
            return f"{public_base}/{value.lstrip('/')}"

    origin = str(os.getenv("DJANGO_API_ORIGIN") or "").strip().rstrip("/")
    if origin:
        low_origin = origin.lower()
        # Local development origins are not reachable by external email clients (Gmail/Yahoo/etc.)
        if any(h in low_origin for h in ("127.0.0.1", "localhost", "0.0.0.0", "192.168.")):
            return ""
        return f"{origin}/{value.lstrip('/')}"
    return ""


def _email_logo_src() -> str:
    return _email_public_url("/email-assets/ann-anns-logo.png")


def _render_email_parts(body: EmailBody, *, heading: str, preheader: str = "") -> tuple[str, str]:
    """Return the (plain text, HTML) pair for one message."""
    text = render_text(body, heading=heading)
    html = render_html(body, heading=heading, preheader=preheader or heading, logo_src=_email_logo_src())
    return text, html


def _get_product_size_label(product: Any) -> str:
    """Return a human-readable size string from a Product's sizes JSONField."""
    sizes = getattr(product, "sizes", None)
    if isinstance(sizes, list):
        parts = [str(s).strip() for s in sizes if str(s).strip()]
        if parts:
            return ", ".join(parts)
    return ""


def _order_product_lines(order: Order | None) -> list[ProductLine]:
    """Read the products of a transaction straight off its saved order items.

    Every product email is built from this, so what the recipient reads is always
    the record itself rather than a summary written at the call site.
    """
    if order is None or not hasattr(order, "items"):
        return []
    lines: list[ProductLine] = []
    for item in order.items.select_related("product").prefetch_related("mixed_case_components__product").all():
        product = getattr(item, "product", None)
        name = str(getattr(item, "product_name", "") or getattr(product, "name", "") or "Product").strip()
        category = str(getattr(item, "product_category", "") or getattr(product, "category", "") or "").strip()
        size = _get_product_size_label(product)
        unit = str(getattr(item, "product_unit", "") or getattr(product, "unit", "") or "case").strip()

        if str(getattr(item, "item_type", "") or "").upper() == OrderItemType.MIXED_CASE:
            # A mixed case is stored as one line named "Mixed Case", which tells the
            # recipient nothing. List what is actually inside it instead.
            components = list(item.mixed_case_components.all())
            case_count = max(1, _int(getattr(item, "quantity", 0), 0))
            for component in components:
                component_product = getattr(component, "product", None)
                lines.append(
                    ProductLine(
                        name=f"{str(getattr(component, 'product_name', '') or getattr(component_product, 'name', '') or 'Product').strip()} (in mixed case)",
                        category=str(
                            getattr(component, "product_category", "")
                            or getattr(component_product, "category", "")
                            or ""
                        ).strip(),
                        size=_get_product_size_label(component_product),
                        quantity=format_quantity(
                            getattr(component, "total_base_units", 0),
                            str(getattr(component, "base_unit_label", "") or "unit"),
                        ),
                    )
                )
            if components:
                lines.append(
                    ProductLine(
                        name=name or "Mixed Case",
                        category=category,
                        size=size,
                        quantity=format_quantity(case_count, "mixed case"),
                    )
                )
                continue
            unit = "mixed case"

        lines.append(
            ProductLine(
                name=name,
                category=category,
                size=size,
                quantity=format_quantity(getattr(item, "quantity", 0), unit),
            )
        )
    return lines


def _replacement_product_lines(replacement: Replacement | None) -> list[ProductLine]:
    """Read the products of a replacement request off its saved lines."""
    if replacement is None:
        return []
    meta = _extract_replacement_meta(getattr(replacement, "notes", ""))
    structured_lines = _get_structured_replacement_lines(meta)
    if structured_lines:
        # Replacement quantities are accounted for as base containers. Convert
        # case-mode lines back to their selling unit for customer-facing emails.
        formatted_lines: list[ProductLine] = []
        for row in structured_lines:
            product_id = str(row.get("replacementProductId") or row.get("originalProductId") or "").strip()
            product = Product.objects.filter(id=product_id).first() if product_id else None
            input_mode = str(row.get("lineInputMode") or row.get("replacementInputMode") or "").strip().lower()
            requested_base_units = max(0, _int(row.get("quantityToReplace"), 0))
            if input_mode == "case":
                quantity_per_case = max(
                    1,
                    _int(row.get("quantityPerCase"), _int(getattr(product, "quantity_per_unit", 0), 1)),
                )
                quantity = max(
                    0,
                    _int(row.get("quantityToReplaceCases"), _int(row.get("quantityToReplaceUnits"), 0)),
                )
                if quantity <= 0 and requested_base_units % quantity_per_case == 0:
                    quantity = requested_base_units // quantity_per_case
                unit = str(row.get("replacementProductUnit") or getattr(product, "unit", "") or "case").strip()
            else:
                quantity = max(0, _int(row.get("quantityToReplaceBottles"), requested_base_units))
                # Customer-facing replacement quantities use the requested package:
                # a bottle-mode line is always expressed in bottles.
                unit = "bottle"
            formatted_lines.append(
                ProductLine(
                    name=str(row.get("replacementProductName") or row.get("originalProductName") or getattr(product, "name", "") or "Product").strip(),
                    category=str(getattr(product, "category", "") or "").strip(),
                    size=str(row.get("replacementProductSize") or row.get("originalProductSize") or _get_product_size_label(product) or "").strip(),
                    quantity=format_quantity(quantity, unit),
                )
            )
        return formatted_lines
    lines: list[ProductLine] = []
    try:
        rows = list(replacement.lines.select_related("product").all())
    except Exception:
        rows = []
    for row in rows:
        product = getattr(row, "product", None)
        lines.append(
            ProductLine(
                name=str(getattr(row, "product_name", "") or getattr(product, "name", "") or "Product").strip(),
                category=str(getattr(product, "category", "") or "").strip(),
                size=_get_product_size_label(product),
                quantity=format_quantity(
                    getattr(row, "requested_base_units", 0),
                    str(getattr(row, "base_unit_label", "") or "unit"),
                ),
            )
        )
    if lines:
        return lines

    # Older single-product claims carry the product on the replacement itself.
    product = Product.objects.filter(id=str(getattr(replacement, "replacement_product_id", "") or "")).first()
    if product is None:
        return []
    return [
        ProductLine(
            name=str(getattr(product, "name", "") or "Product").strip(),
            category=str(getattr(product, "category", "") or "").strip(),
            size=_get_product_size_label(product),
            quantity=format_quantity(getattr(replacement, "replacement_quantity", 0), str(getattr(product, "unit", "") or "unit")),
        )
    ]


def _trip_product_lines(trip: Trip | None) -> list[ProductLine]:
    """Combine the products across every delivery stop on a trip."""
    if trip is None:
        return []
    totals: dict[tuple[str, str, str, str], int] = {}
    order_ids = [str(point.order_id) for point in trip.drop_points.all() if point.order_id]
    if not order_ids:
        return []
    items = (
        OrderItem.objects.select_related("product")
        .prefetch_related("mixed_case_components__product")
        .filter(order_id__in=order_ids)
    )
    for item in items:
        product = getattr(item, "product", None)
        unit = str(getattr(item, "product_unit", "") or getattr(product, "unit", "") or "case").strip()
        if str(getattr(item, "item_type", "") or "").upper() == OrderItemType.MIXED_CASE:
            # The driver loads the bottles inside the mixed case, not a product
            # called "Mixed Case", so the components are what the list must show.
            components = list(item.mixed_case_components.all())
            for component in components:
                component_product = getattr(component, "product", None)
                component_key = (
                    f"{str(getattr(component, 'product_name', '') or getattr(component_product, 'name', '') or 'Product').strip()} (in mixed case)",
                    str(getattr(component, "product_category", "") or getattr(component_product, "category", "") or "").strip(),
                    _get_product_size_label(component_product),
                    str(getattr(component, "base_unit_label", "") or "unit").strip(),
                )
                totals[component_key] = totals.get(component_key, 0) + max(
                    0, _int(getattr(component, "total_base_units", 0), 0)
                )
            if components:
                continue
            unit = "mixed case"
        key = (
            str(getattr(item, "product_name", "") or getattr(product, "name", "") or "Product").strip(),
            str(getattr(item, "product_category", "") or getattr(product, "category", "") or "").strip(),
            _get_product_size_label(product),
            unit,
        )
        totals[key] = totals.get(key, 0) + max(0, _int(getattr(item, "quantity", 0), 0))
    return [
        ProductLine(name=name, category=category, size=size, quantity=format_quantity(quantity, unit))
        for (name, category, size, unit), quantity in sorted(totals.items())
    ]


def _order_delivery_address(order: Order | None) -> str:
    """Join the address parts, skipping any the street address already spells out.

    Saved addresses often already end in the city and province, and repeating them
    produces "Silay, Negros Occidental, Silay, Negros Occidental" in the email.
    """
    parts = [
        str(getattr(order, "shipping_address", "") or "").strip(),
        str(getattr(order, "shipping_city", "") or "").strip(),
        str(getattr(order, "shipping_province", "") or "").strip(),
    ]
    joined: list[str] = []
    for part in parts:
        if not part:
            continue
        if any(part.casefold() in existing.casefold() for existing in joined):
            continue
        joined.append(part)
    return ", ".join(joined)


def _order_reference_details(order: Order, *, include_amount: bool = True) -> list[tuple[str, str]]:
    """Reference rows shared by the purchase-request and order emails."""
    details: list[tuple[str, str]] = []
    pr_number = str(getattr(order, "purchase_request_number", "") or "").strip()
    po_number = str(getattr(order, "purchase_order_number", "") or "").strip()
    order_number = str(getattr(order, "order_number", "") or "").strip()
    if pr_number:
        details.append(("Purchase Request No.", pr_number))
    if po_number:
        details.append(("Purchase Order No.", po_number))
    if order_number and order_number not in {pr_number, po_number}:
        details.append(("Order No.", order_number))
    if include_amount:
        details.append(("Total amount", f"PHP {float(getattr(order, 'total_amount', 0) or 0):,.2f}"))
    return details


def _send_structured_email(
    *,
    subject: str,
    heading: str,
    body: EmailBody,
    recipients: list[str],
    preheader: str = "",
) -> None:
    text, html = _render_email_parts(body, heading=heading, preheader=preheader)
    _send_transactional_email(subject=subject, message=text, recipients=recipients, html_message=html)
