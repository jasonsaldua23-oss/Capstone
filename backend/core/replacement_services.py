"""Replacement metadata, outstanding quantities and scheduled replacement orders."""

import json
import math
import re
from datetime import date, datetime, time
from typing import Any

from django.db import transaction
from django.utils import timezone

from . import views_api as legacy
from .api_utils import to_int as _int
from .models import (
    Order,
    OrderItem,
    OrderStatus,
    OrderTimeline,
    Product,
    Replacement,
    ReplacementLine,
    ReplacementStatus,
)


# Helpers owned by sibling modules. Routing them through views_api keeps
# a single resolution point, so tests that patch there still apply.


def _get_product_size_label(product: Any) -> str:
    return legacy._get_product_size_label(product)


def _normalize_order_status(value: Any) -> str:
    return legacy._normalize_order_status(value)


def _normalize_product_unit(raw: Any) -> str:
    return legacy._normalize_product_unit(raw)


def _normalize_replacement_status(value: Any, replacement_mode: Any=None) -> str:
    return legacy._normalize_replacement_status(value, replacement_mode)


def _serialize_replacement(entry: Replacement, *, warehouse_cache: dict[str, Any] | None=None, order_cache: dict[str, Any] | None=None) -> dict[str, Any]:
    return legacy._serialize_replacement(entry, warehouse_cache=warehouse_cache, order_cache=order_cache)


def _extract_replacement_meta(notes: Any) -> dict[str, Any]:
    raw_notes = str(notes or "")
    marker = "Meta:"
    marker_index = raw_notes.rfind(marker)
    if marker_index < 0:
        return {}
    payload_raw = raw_notes[marker_index + len(marker):].strip()
    if not payload_raw:
        return {}
    decoder = json.JSONDecoder()
    try:
        payload, _ = decoder.raw_decode(payload_raw)
        if isinstance(payload, dict):
            return payload
    except (TypeError, ValueError):
        pass
    return {}


def _upsert_replacement_meta(notes: Any, updates: dict[str, Any]) -> str:
    raw_notes = str(notes or "").strip()
    marker = "Meta:"
    marker_index = raw_notes.rfind(marker)
    prefix = raw_notes[:marker_index].rstrip() if marker_index >= 0 else raw_notes
    meta = _extract_replacement_meta(raw_notes)
    meta.update({k: v for k, v in updates.items() if v is not None})
    if not meta:
        return prefix
    if prefix:
        return f"{prefix}\nMeta: {json.dumps(meta)}"
    return f"Meta: {json.dumps(meta)}"


def _append_replacement_note_line(notes: Any, line: str) -> str:
    trimmed_line = str(line or "").strip()
    if not trimmed_line:
        return str(notes or "").strip()
    raw_notes = str(notes or "").strip()
    marker = "Meta:"
    marker_index = raw_notes.rfind(marker)
    prefix = raw_notes[:marker_index].rstrip() if marker_index >= 0 else raw_notes
    meta = _extract_replacement_meta(raw_notes)
    updated_prefix = f"{prefix}\n{trimmed_line}".strip() if prefix else trimmed_line
    if not meta:
        return updated_prefix
    return f"{updated_prefix}\nMeta: {json.dumps(meta)}"


def _get_structured_replacement_lines(meta: dict[str, Any]) -> list[dict[str, Any]]:
    raw_lines = meta.get("replacementLines")
    if isinstance(raw_lines, list) and raw_lines:
        return [line for line in raw_lines if isinstance(line, dict)]
    raw_items = meta.get("replacementItems")
    if isinstance(raw_items, list) and raw_items:
        return [line for line in raw_items if isinstance(line, dict)]
    return []


def _normalize_serialized_replacement_lines(
    entry: Replacement,
    order: Order | None,
    meta: dict[str, Any],
    *,
    normalized_status: str,
    delivered_linked_replacement_order: bool,
) -> list[dict[str, Any]]:
    source_lines = _get_structured_replacement_lines(meta)
    if not source_lines:
        return []

    order_items_by_id: dict[str, OrderItem] = {}
    order_items_by_product_id: dict[str, OrderItem] = {}
    if order is not None:
        for item in OrderItem.objects.select_related("product").filter(order_id=order.id):
            item_id = str(getattr(item, "id", "") or "").strip()
            if item_id:
                order_items_by_id[item_id] = item
            product_id = str(getattr(item, "product_id", "") or "").strip()
            if product_id and product_id not in order_items_by_product_id:
                order_items_by_product_id[product_id] = item

    product_cache: dict[str, Product | None] = {}
    replacement_mode = str(getattr(entry, "replacement_mode", "") or meta.get("replacementMode") or "").strip().upper()
    hide_replaced_quantity = (
        replacement_mode == "CUSTOMER_SUBMITTED"
        and normalized_status not in {ReplacementStatus.COMPLETED, ReplacementStatus.RESOLVED_ON_DELIVERY}
    )

    normalized_lines: list[dict[str, Any]] = []
    for source_line in source_lines:
        original_order_item_id = str(
            source_line.get("originalOrderItemId")
            or source_line.get("orderItemId")
            or ""
        ).strip()
        original_item = order_items_by_id.get(original_order_item_id) if original_order_item_id else None

        original_product_id = str(
            source_line.get("originalProductId")
            or getattr(original_item, "product_id", "")
            or ""
        ).strip()
        if original_item is None and original_product_id:
            original_item = order_items_by_product_id.get(original_product_id)

        original_product = getattr(original_item, "product", None)

        replacement_product_id = str(
            source_line.get("replacementProductId")
            or original_product_id
            or getattr(original_item, "product_id", "")
            or ""
        ).strip()
        replacement_product = None
        if replacement_product_id:
            if replacement_product_id not in product_cache:
                product_cache[replacement_product_id] = Product.objects.filter(id=replacement_product_id).first()
            replacement_product = product_cache[replacement_product_id]

        quantity_to_replace = max(
            0,
            _int(source_line.get("quantityToReplace"), _int(source_line.get("damagedQuantity"), 0)),
        )
        quantity_replaced = max(
            0,
            _int(source_line.get("quantityReplaced"), _int(source_line.get("replacedQuantity"), 0)),
        )
        if hide_replaced_quantity:
            quantity_replaced = 0
        if delivered_linked_replacement_order and quantity_to_replace > quantity_replaced:
            quantity_replaced = quantity_to_replace
        remaining_quantity = max(quantity_to_replace - quantity_replaced, 0)

        quantity_per_case = max(
            1,
            _int(
                source_line.get("quantityPerCase"),
                _int(
                    source_line.get("qtyPerUnit"),
                    _int(getattr(replacement_product or original_product, "quantity_per_unit", 0), 1),
                ),
            ),
        )
        quantity_to_replace_cases = max(
            0,
            _int(
                source_line.get("quantityToReplaceCases"),
                _int(source_line.get("quantityToReplaceUnits"), 0),
            ),
        )
        quantity_to_replace_bottles = max(0, _int(source_line.get("quantityToReplaceBottles"), 0))
        quantity_replaced_cases = max(
            0,
            _int(
                source_line.get("quantityReplacedCases"),
                _int(source_line.get("quantityReplacedUnits"), 0),
            ),
        )
        quantity_replaced_bottles = max(0, _int(source_line.get("quantityReplacedBottles"), 0))
        line_input_mode = str(
            source_line.get("lineInputMode")
            or source_line.get("replacementInputMode")
            or ""
        ).strip().lower()

        recorded_source_unit = str(getattr(original_item, "product_unit", "") or "").strip()
        serialized_source_unit = str(
            source_line.get("originalProductUnit") or source_line.get("productUnit") or ""
        ).strip()
        source_unit_evidence = recorded_source_unit or serialized_source_unit
        source_product_unit = _normalize_product_unit(
            source_unit_evidence
            or getattr(original_product, "unit", None)
        )
        # A customer explicitly submits each replacement line as cases or bottles.
        # Preserve that mode; use the source unit only for older records that lack it.
        if str(source_line.get("mixedCaseComponentId") or "").strip():
            authoritative_input_mode = "bottle"
        elif line_input_mode in {"case", "bottle"}:
            authoritative_input_mode = line_input_mode
        elif source_unit_evidence:
            authoritative_input_mode = "bottle" if "bottle" in source_unit_evidence.lower() else "case"
        else:
            authoritative_input_mode = "bottle" if "bottle" in str(source_product_unit or "").lower() else "case"
        if line_input_mode and line_input_mode != authoritative_input_mode:
            # Fix legacy claims whose client-selected mode contradicted the
            # delivered item's selling unit (for example, a case saved as one bottle).
            if authoritative_input_mode == "case":
                requested_packages = quantity_to_replace_cases or quantity_to_replace_bottles or quantity_to_replace
                replaced_packages = quantity_replaced_cases or quantity_replaced_bottles or quantity_replaced
                quantity_to_replace_cases = requested_packages
                quantity_replaced_cases = replaced_packages
                quantity_to_replace_bottles = 0
                quantity_replaced_bottles = 0
                quantity_to_replace = requested_packages * quantity_per_case
                quantity_replaced = replaced_packages * quantity_per_case
            else:
                requested_bottles = quantity_to_replace_bottles or quantity_to_replace_cases or quantity_to_replace
                replaced_bottles = quantity_replaced_bottles or quantity_replaced_cases or quantity_replaced
                quantity_to_replace_bottles = requested_bottles
                quantity_replaced_bottles = replaced_bottles
                quantity_to_replace_cases = 0
                quantity_replaced_cases = 0
                quantity_to_replace = requested_bottles
                quantity_replaced = replaced_bottles
            line_input_mode = authoritative_input_mode
            remaining_quantity = max(quantity_to_replace - quantity_replaced, 0)

        if line_input_mode == "bottle":
            if quantity_to_replace_bottles <= 0 and quantity_to_replace > 0:
                quantity_to_replace_bottles = quantity_to_replace
            if quantity_replaced_bottles <= 0 and quantity_replaced > 0:
                quantity_replaced_bottles = quantity_replaced
        else:
            if (
                quantity_to_replace_cases <= 0
                and quantity_to_replace > 0
                and quantity_per_case > 0
                and quantity_to_replace % quantity_per_case == 0
            ):
                quantity_to_replace_cases = quantity_to_replace // quantity_per_case
            if (
                quantity_replaced_cases <= 0
                and quantity_replaced > 0
                and quantity_per_case > 0
                and quantity_replaced % quantity_per_case == 0
            ):
                quantity_replaced_cases = quantity_replaced // quantity_per_case

        original_product_name = str(
            source_line.get("originalProductName")
            or source_line.get("productName")
            or getattr(original_product, "name", "")
            or getattr(original_item, "product_name", "")
            or ""
        ).strip() or None
        original_product_sku = str(
            source_line.get("originalProductSku")
            or getattr(original_product, "sku", "")
            or getattr(original_item, "product_sku", "")
            or ""
        ).strip() or None
        original_product_size = str(
            source_line.get("originalProductSize")
            or _get_product_size_label(original_product)
            or ""
        ).strip() or None
        replacement_product_name = str(
            source_line.get("replacementProductName")
            or getattr(replacement_product, "name", "")
            or original_product_name
            or ""
        ).strip() or None
        replacement_product_sku = str(
            source_line.get("replacementProductSku")
            or getattr(replacement_product, "sku", "")
            or original_product_sku
            or ""
        ).strip() or None
        replacement_product_size = str(
            source_line.get("replacementProductSize")
            or _get_product_size_label(replacement_product)
            or original_product_size
            or ""
        ).strip() or None
        original_product_unit = str(
            source_line.get("originalProductUnit")
            or source_line.get("productUnit")
            or getattr(original_item, "product_unit", "")
            or getattr(original_product, "unit", "")
            or ""
        ).strip() or None
        replacement_product_unit = str(
            source_line.get("replacementProductUnit")
            or getattr(replacement_product, "unit", "")
            or original_product_unit
            or ""
        ).strip() or None

        normalized_line = dict(source_line)
        normalized_line.update(
            {
                "originalOrderItemId": str(getattr(original_item, "id", "") or original_order_item_id or "").strip() or None,
                "originalProductId": original_product_id or None,
                "originalProductName": original_product_name,
                "originalProductSku": original_product_sku,
                "originalProductSize": original_product_size,
                # Fix: replacement screens need the authoritative selling unit
                # so saved bottle equivalents are displayed as cases when applicable.
                "originalProductUnit": original_product_unit,
                "replacementProductId": replacement_product_id or None,
                "replacementProductName": replacement_product_name,
                "replacementProductSku": replacement_product_sku,
                "replacementProductSize": replacement_product_size,
                "replacementProductUnit": replacement_product_unit,
                "productUnit": replacement_product_unit or original_product_unit,
                "quantityToReplace": quantity_to_replace,
                "quantityReplaced": quantity_replaced,
                "remainingQuantity": remaining_quantity,
                "quantityPerCase": quantity_per_case,
                "qtyPerUnit": quantity_per_case,
            }
        )
        if line_input_mode:
            normalized_line["lineInputMode"] = line_input_mode
            normalized_line["replacementInputMode"] = line_input_mode
        # Do not leak the contradictory legacy count back to clients. A line
        # has one display unit: cases or bottles, determined above from its source item.
        if line_input_mode == "case":
            normalized_line.pop("quantityToReplaceBottles", None)
            normalized_line.pop("quantityReplacedBottles", None)
        elif line_input_mode == "bottle":
            normalized_line.pop("quantityToReplaceCases", None)
            normalized_line.pop("quantityToReplaceUnits", None)
            normalized_line.pop("quantityReplacedCases", None)
            normalized_line.pop("quantityReplacedUnits", None)
        if quantity_to_replace_cases > 0:
            normalized_line["quantityToReplaceCases"] = quantity_to_replace_cases
            normalized_line["quantityToReplaceUnits"] = quantity_to_replace_cases
        if quantity_to_replace_bottles > 0:
            normalized_line["quantityToReplaceBottles"] = quantity_to_replace_bottles
        if quantity_replaced_cases > 0:
            normalized_line["quantityReplacedCases"] = quantity_replaced_cases
            normalized_line["quantityReplacedUnits"] = quantity_replaced_cases
        if quantity_replaced_bottles > 0:
            normalized_line["quantityReplacedBottles"] = quantity_replaced_bottles
        normalized_lines.append(normalized_line)

    return normalized_lines


def _replacement_has_outstanding_quantity(replacement: Replacement) -> bool:
    serialized = _serialize_replacement(replacement)
    lines_raw = serialized.get("replacementLines") or serialized.get("replacementItems") or []
    lines: list[dict[str, Any]] = [line for line in lines_raw if isinstance(line, dict)]

    total_qty_to_replace = 0
    total_qty_replaced = 0
    for line in lines:
        qty_to_replace = max(0, _int(line.get("quantityToReplace"), 0))
        qty_replaced = max(0, _int(line.get("quantityReplaced"), 0))
        total_qty_to_replace += qty_to_replace
        total_qty_replaced += qty_replaced
    if total_qty_to_replace > 0:
        return total_qty_replaced < total_qty_to_replace

    qty_to_replace = max(
        0,
        _int(
            serialized.get("quantityToReplace"),
            _int(serialized.get("damagedQuantity"), 0),
        ),
    )
    qty_replaced = max(
        0,
        _int(
            serialized.get("quantityReplaced"),
            _int(serialized.get("replacementQuantity"), 0),
        ),
    )
    return qty_to_replace > qty_replaced


def _replacement_line_source_lines(replacement: Replacement) -> list[dict[str, Any]]:
    """Build scheduler line dicts from relational ReplacementLine rows.

    Quantities on these rows are base units (usually bottles), which is the same
    unit the scheduler's quantityToReplace/quantityReplaced pair already speaks,
    so the existing bottles-to-order-quantity conversion applies unchanged. Only
    lines with outstanding units are scheduled, so a fully replaced line is not
    re-ordered.
    """
    lines: list[dict[str, Any]] = []
    rows = (
        ReplacementLine.objects.select_related("product", "mixed_case_component")
        .filter(replacement=replacement)
        .order_by("id")
    )
    for row in rows:
        product_id = str(getattr(row, "product_id", "") or "").strip()
        if not product_id:
            continue
        requested = max(0, _int(row.requested_base_units, 0))
        replaced = max(0, _int(row.replaced_base_units, 0))
        if requested - replaced <= 0:
            continue
        base_unit = str(getattr(row, "base_unit_label", "") or "").strip().lower()
        lines.append({
            "replacementProductId": product_id,
            "replacementProductName": row.product_name,
            "quantityToReplace": requested,
            "quantityReplaced": replaced,
            "lineInputMode": "bottle" if "bottle" in base_unit else "",
        })
    return lines


def _create_scheduled_replacement_order(
    replacement: Replacement,
    *,
    scheduled_date: date,
    staff_user_id: str | None,
) -> Order:
    # Serialize concurrent scheduling of the same replacement: the loser waits
    # here, then re-reads the notes below and returns the winner's order rather
    # than creating a second one.
    caller_replacement = replacement
    with transaction.atomic():
        locked = Replacement.objects.select_for_update().filter(id=replacement.id).first()
        if locked is not None:
            replacement = locked
        replacement_order = _create_scheduled_replacement_order_locked(
            replacement,
            scheduled_date=scheduled_date,
            staff_user_id=staff_user_id,
        )
        # Keep the caller's instance current because the view saves it again.
        caller_replacement.notes = replacement.notes
        caller_replacement.delivery_transaction_id = replacement.delivery_transaction_id
        return replacement_order


def _create_scheduled_replacement_order_locked(
    replacement: Replacement,
    *,
    scheduled_date: date,
    staff_user_id: str | None,
) -> Order:
    meta = _extract_replacement_meta(replacement.notes)
    existing_order_id = str(replacement.delivery_transaction_id or meta.get("replacementOrderId") or "").strip()
    if existing_order_id:
        existing_order = Order.objects.filter(id=existing_order_id).first()
        if existing_order:
            return existing_order

    source_order = (
        Order.objects.select_related("customer")
        .prefetch_related("items__product")
        .filter(id=replacement.order_id)
        .first()
    )
    if not source_order:
        raise ValueError("Source order for replacement was not found")

    source_items = list(source_order.items.select_related("product").all())
    source_lines = []
    if isinstance(meta.get("replacementLines"), list) and meta.get("replacementLines"):
        source_lines = _normalize_serialized_replacement_lines(
            replacement,
            source_order,
            meta,
            normalized_status=_normalize_replacement_status(replacement.status),
            delivered_linked_replacement_order=False,
        )
    elif isinstance(meta.get("replacementItems"), list) and meta.get("replacementItems"):
        source_lines = _normalize_serialized_replacement_lines(
            replacement,
            source_order,
            meta,
            normalized_status=_normalize_replacement_status(replacement.status),
            delivered_linked_replacement_order=False,
        )
    elif replacement.replacement_product_id and replacement.replacement_quantity:
        source_lines = [{
            "replacementProductId": replacement.replacement_product_id,
            "quantityReplaced": replacement.replacement_quantity,
            "quantityToReplace": replacement.replacement_quantity,
        }]
    elif replacement.replacement_quantity and source_items:
        # Legacy records may not have structured replacement lines/product linkage.
        # Fall back to the first source order item so scheduling can still proceed.
        fallback_product_id = str(getattr(source_items[0], "product_id", "") or "").strip()
        if fallback_product_id:
            source_lines = [{
                "replacementProductId": fallback_product_id,
                "quantityReplaced": replacement.replacement_quantity,
                "quantityToReplace": replacement.replacement_quantity,
            }]
    if not source_lines:
        # Replacements captured as ReplacementLine rows carry no notes metadata
        # and no legacy scalar quantity, so fall back to the relational rows.
        source_lines = _replacement_line_source_lines(replacement)
    if not source_lines:
        raise ValueError("No replacement items available to schedule")

    replacement_order = Order.objects.create(
        # The delivery belongs to this replacement case and uses its number.
        order_number=replacement.replacement_number,
        customer=source_order.customer,
        status=OrderStatus.CONFIRMED,
        priority="high",
        subtotal=0,
        discount=0,
        total_amount=0,
        payment_status="pending",
        warehouse_id=source_order.warehouse_id,
        shipping_name=source_order.shipping_name,
        shipping_phone=source_order.shipping_phone,
        shipping_address=source_order.shipping_address,
        shipping_city=source_order.shipping_city,
        shipping_province=source_order.shipping_province,
        shipping_zip_code=source_order.shipping_zip_code,
        shipping_country=source_order.shipping_country or "Philippines",
        shipping_latitude=source_order.shipping_latitude,
        shipping_longitude=source_order.shipping_longitude,
        notes=f"Replacement delivery for {replacement.replacement_number} (source {source_order.order_number})",
    )

    subtotal = 0.0
    notes_text = str(getattr(replacement, "description", "") or "") + " " + str(getattr(replacement, "notes", "") or "")
    notes_lower = notes_text.lower()

    for line in source_lines:
        raw_qty_to_replace = _int(line.get("quantityToReplace"), _int(line.get("quantity"), 0))
        raw_qty_replaced = _int(line.get("quantityReplaced"), 0)
        remaining_qty_bottles = max(raw_qty_to_replace - raw_qty_replaced, 0)
        use_remaining_only = raw_qty_to_replace > 0 and raw_qty_replaced > 0 and remaining_qty_bottles > 0
        raw_qty = remaining_qty_bottles if use_remaining_only else _int(line.get("quantity"), raw_qty_to_replace or raw_qty_replaced)
        qty_bottles = max(raw_qty, 0)
        replacement_cases = max(0, _int(line.get("replacementCases"), 0))
        replacement_bottles = max(0, _int(line.get("replacementBottles"), 0))
        line_input_mode = str(
            line.get("lineInputMode") or line.get("replacementInputMode") or ""
        ).strip().lower()
        # Structured line metadata takes precedence over free-form notes, which
        # keeps bottle replacements priced and returned as bottle quantities.
        by_case = line_input_mode == "case" or bool(re.search(r"\bby\s*case\b", notes_lower))
        by_bottle = line_input_mode == "bottle" or bool(re.search(r"\bby\s*bottle\b", notes_lower))
        product_id = str(
            line.get("replacementProductId")
            or line.get("productId")
            or line.get("originalProductId")
            or ""
        ).strip()
        product = Product.objects.filter(id=product_id).first() if product_id else None

        matched_source_item = None
        if not product:
            source_name = str(line.get("replacementProductName") or line.get("originalProductName") or "").strip().lower()
            matched_source_item = next(
                (item for item in source_items if str(getattr(item.product, "name", "") or "").strip().lower() == source_name),
                None,
            )
            if matched_source_item:
                product = matched_source_item.product
        if not product and source_items:
            # Last-resort mapping for legacy/blank replacement rows.
            matched_source_item = source_items[0]
            product = matched_source_item.product
        if not product:
            continue
        if not matched_source_item:
            matched_source_item = next((item for item in source_items if getattr(item, "product_id", None) == product.id), None)

        quantity_per_case = max(
            1,
            _int(
                line.get("quantityPerCase"),
                _int(
                    getattr(product, "quantity_per_unit", 0),
                    _int(
                        getattr(matched_source_item, "quantity_per_case", 0) if matched_source_item else 0,
                        _int(
                            getattr(getattr(matched_source_item, "product", None), "quantity_per_unit", 0)
                            if matched_source_item else 0,
                            1,
                        ),
                    ),
                ),
            ),
        )

        effective_unit = _normalize_product_unit(
            line.get("productUnit")
            or line.get("replacementProductUnit")
            or line.get("originalProductUnit")
            or getattr(product, "unit", None)
        )
        is_bottle_unit = "bottle" in str(effective_unit or "").strip().lower()

        def _bottles_to_order_qty(bottles: int) -> int:
            if bottles <= 0:
                return 0
            if is_bottle_unit:
                return bottles
            return int(math.ceil(bottles / max(1, quantity_per_case)))

        if use_remaining_only:
            qty = _bottles_to_order_qty(qty_bottles)
        elif replacement_cases > 0:
            qty = replacement_cases
        elif replacement_bottles > 0:
            qty = _bottles_to_order_qty(replacement_bottles)
        elif by_case and not by_bottle:
            qty = _bottles_to_order_qty(qty_bottles)
        else:
            qty = _bottles_to_order_qty(qty_bottles)
        if qty <= 0:
            continue

        unit_price = float(
            line.get("unitPrice")
            or line.get("price")
            or (matched_source_item.unit_price if matched_source_item else getattr(product, "price", 0))
            or 0
        )
        if by_bottle and not is_bottle_unit:
            # The physical order still carries the required case, but this
            # replacement charges only the requested bottles at their case-derived price.
            line_total = (unit_price / quantity_per_case) * qty_bottles
        else:
            line_total = unit_price * qty
        subtotal += line_total
        OrderItem.objects.create(
            order=replacement_order,
            product=product,
            product_name=str(getattr(product, "name", "") or "").strip() or None,
            product_sku=str(getattr(product, "sku", "") or "").strip() or None,
            product_unit=_normalize_product_unit(getattr(product, "unit", None)),
            quantity=qty,
            unit_price=unit_price,
            total_price=line_total,
            notes=(
                f"Replacement line from {replacement.replacement_number}\n"
                f"ReplacementUnitMode={'BOTTLE' if by_bottle else 'UNIT'}\n"
                f"ReplacementRequestedBottles={max(qty_bottles, 0)}"
            ),
        )

    if replacement_order.items.count() == 0:
        replacement_order.delete()
        raise ValueError("No valid replacement items found to schedule")

    replacement_order.subtotal = subtotal
    replacement_order.total_amount = subtotal
    replacement_order.save(update_fields=["subtotal", "total_amount", "updated_at"])

    scheduled_start = timezone.make_aware(datetime.combine(scheduled_date, time(hour=9, minute=0)))
    OrderTimeline.objects.update_or_create(
        order=replacement_order,
        defaults={
            "confirmed_at": timezone.now(),
            "delivery_date": scheduled_start,
        },
    )

    replacement.notes = _upsert_replacement_meta(
        replacement.notes,
        {
            "replacementOrderId": replacement_order.id,
            "replacementOrderNumber": replacement_order.order_number,
            "scheduledDeliveryDate": scheduled_date.isoformat(),
            "scheduledBy": staff_user_id,
        },
    )
    # A replacement shipment belongs directly to its replacement request.
    replacement.delivery_transaction = replacement_order
    replacement.save(update_fields=["delivery_transaction", "notes", "updated_at"])
    return replacement_order


def _reschedule_replacement_delivery(
    replacement: Replacement,
    *,
    scheduled_date: date,
    staff_user_id: str | None,
) -> Order:
    """Move an already-scheduled replacement delivery to a new date.

    Scheduling creates the replacement order once and then hands the same order
    back on every later call, so a date that has come and gone is corrected by
    moving that order's delivery timeline instead of scheduling a second one.
    """
    caller_replacement = replacement
    with transaction.atomic():
        locked = Replacement.objects.select_for_update().filter(id=replacement.id).first()
        if locked is not None:
            replacement = locked
        meta = _extract_replacement_meta(replacement.notes)
        replacement_order_id = str(replacement.delivery_transaction_id or meta.get("replacementOrderId") or "").strip()
        replacement_order_number = str(meta.get("replacementOrderNumber") or "").strip()
        replacement_order = None
        if replacement_order_id:
            replacement_order = Order.objects.filter(id=replacement_order_id).first()
        if replacement_order is None and replacement_order_number:
            replacement_order = Order.objects.filter(order_number=replacement_order_number).first()
        if replacement_order is None:
            raise ValueError("This replacement has no scheduled delivery to move")

        order_status = _normalize_order_status(getattr(replacement_order, "status", None))
        if order_status in {OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.REJECTED}:
            raise ValueError("This replacement delivery is already closed and cannot be rescheduled")
        if order_status == OrderStatus.OUT_FOR_DELIVERY:
            raise ValueError("This replacement delivery is already out for delivery and cannot be rescheduled")

        scheduled_start = timezone.make_aware(datetime.combine(scheduled_date, time(hour=9, minute=0)))
        timeline, created = OrderTimeline.objects.get_or_create(
            order=replacement_order,
            defaults={"confirmed_at": timezone.now(), "delivery_date": scheduled_start},
        )
        if not created:
            # Only the delivery date moves; the original confirmation stays put.
            timeline.delivery_date = scheduled_start
            timeline.save(update_fields=["delivery_date", "updated_at"])

        replacement.notes = _upsert_replacement_meta(
            replacement.notes,
            {
                "scheduledDeliveryDate": scheduled_date.isoformat(),
                "rescheduledBy": staff_user_id,
                "rescheduledAt": timezone.now().isoformat(),
            },
        )
        replacement.save(update_fields=["notes", "updated_at"])
        # Prevent the view's later save from restoring pre-reschedule metadata.
        caller_replacement.notes = replacement.notes
        caller_replacement.delivery_transaction_id = replacement.delivery_transaction_id
        return replacement_order


def _is_linked_replacement_order_delivered(entry: Replacement, *, order_cache: dict[str, Any] | None = None) -> bool:
    meta = _extract_replacement_meta(getattr(entry, "notes", ""))
    replacement_order_id = str(entry.delivery_transaction_id or meta.get("replacementOrderId") or "").strip()
    replacement_order_number = str(meta.get("replacementOrderNumber") or "").strip()
    replacement_order = None
    if replacement_order_id:
        if order_cache is not None and replacement_order_id in order_cache:
            replacement_order = order_cache.get(replacement_order_id)
        else:
            replacement_order = Order.objects.filter(id=replacement_order_id).only("status", "order_number").first()
    elif replacement_order_number:
        if order_cache is not None and replacement_order_number in order_cache:
            replacement_order = order_cache.get(replacement_order_number)
        else:
            replacement_order = Order.objects.filter(order_number=replacement_order_number).only("status", "order_number").first()
    if not replacement_order:
        return False
    return _normalize_order_status(getattr(replacement_order, "status", None)) == OrderStatus.DELIVERED


def _is_replacement_closed(entry: Replacement, *, order_cache: dict[str, Any] | None = None) -> bool:
    meta = _extract_replacement_meta(getattr(entry, "notes", ""))
    replacement_order_id = str(entry.delivery_transaction_id or meta.get("replacementOrderId") or "").strip()
    replacement_order_number = str(meta.get("replacementOrderNumber") or "").strip()
    replacement_order = None
    if replacement_order_id:
        replacement_order = order_cache.get(replacement_order_id) if order_cache is not None else None
        if replacement_order is None:
            replacement_order = Order.objects.filter(id=replacement_order_id).only("status").first()
    elif replacement_order_number:
        replacement_order = order_cache.get(replacement_order_number) if order_cache is not None else None
        if replacement_order is None:
            replacement_order = Order.objects.filter(order_number=replacement_order_number).only("status").first()
    if replacement_order and _normalize_order_status(replacement_order.status) in {
        OrderStatus.DELIVERED,
        OrderStatus.CANCELLED,
        OrderStatus.REJECTED,
    }:
        return True
    normalized = _normalize_replacement_status(entry.status, entry.replacement_mode)
    return normalized in {
        ReplacementStatus.CANCELLED,
        ReplacementStatus.RESOLVED_ON_DELIVERY,
        ReplacementStatus.COMPLETED,
    }
