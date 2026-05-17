import hashlib
import hmac
import json
import logging
import math
import requests
import re
import secrets
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any

from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from django.db import IntegrityError, connection, transaction
from django.db.models import F, Max, Prefetch, Q, Sum
from django.conf import settings
from django.core.mail import send_mail
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.forms.models import model_to_dict
from django.http import HttpRequest, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from .auth import TOKEN_NAME, create_token, decode_token, extract_token, hash_password, verify_password
from .models import (
    Customer,
    DriverSpareStock,
    Feedback,
    Inventory,
    InventoryTransaction,
    LocationLog,
    Notification,
    Order,
    OrderItem,
    OrderStatus,
    OrderTimeline,
    WarehouseStage,
    Product,
    Replacement,
    ReplacementStatus,
    RoleType,
    StockBatch,
    Trip,
    TripDropPoint,
    TripStatus,
    User,
    Vehicle,
    VehicleStatus,
    Warehouse,
)


logger = logging.getLogger(__name__)
_order_legacy_checklist_columns_checked = False

PRODUCT_UNIT_CASE = "case"
PRODUCT_UNIT_PACK_BUNDLE = "pack(bundle)"
ALLOWED_PRODUCT_UNITS = {PRODUCT_UNIT_CASE, PRODUCT_UNIT_PACK_BUNDLE}
SPARE_PRODUCTS_REFERENCE_TYPE = "order_spare_products_auto_load"
SPARE_PRODUCTS_RETURN_REFERENCE_TYPE = "order_spare_products_unused_return"
REPLACEMENT_MODE_SPARE_PRODUCTS_IMMEDIATE = "SPARE_PRODUCTS_IMMEDIATE"
REPLACEMENT_MODE_SPARE_PRODUCTS_PARTIAL = "SPARE_PRODUCTS_PARTIAL"
SPARE_PRODUCT_POLICY_BY_UNIT = {
    PRODUCT_UNIT_CASE: {
        "minPercent": 8,
        "maxPercent": 12,
        "recommendedPercent": 10,
    },
    PRODUCT_UNIT_PACK_BUNDLE: {
        "minPercent": 3,
        "maxPercent": 5,
        "recommendedPercent": 4,
    },
}

HIDDEN_SAMPLE_WORDS = ("test", "demo", "sample", "dummy", "placeholder", "fake")
HIDDEN_SAMPLE_EMAIL_DOMAINS = ("@example.com", "@test.com", "@demo.com")
PASSWORD_POLICY_ERROR = "Password must be at least 8 characters and include uppercase, lowercase, number, and special character, with no spaces."
DISCOUNT_NO = "NO_DISCOUNT"
DISCOUNT_OTHER = "OTHER"
DISCOUNT_ACTIVE = "ACTIVE"
DISCOUNT_CANCELLED = "CANCELLED"
DISCOUNT_REMOVED = "REMOVED"
DISCOUNT_PRESET_PERCENT: dict[str, float] = {
    DISCOUNT_NO: 0.0,
    "DISCOUNT_5": 5.0,
    "DISCOUNT_10": 10.0,
    "DISCOUNT_15": 15.0,
    "DISCOUNT_20": 20.0,
    "DISCOUNT_25": 25.0,
}
DISCOUNT_PRESET_LABEL: dict[str, str] = {
    DISCOUNT_NO: "No Discount",
    "DISCOUNT_5": "5% Discount - courtesy discount",
    "DISCOUNT_10": "10% Discount - regular customer discount",
    "DISCOUNT_15": "15% Discount - loyal customer discount",
    "DISCOUNT_20": "20% Discount - bulk order discount",
    "DISCOUNT_25": "25% Discount - maximum recommended discount",
    DISCOUNT_OTHER: "Other (Manual)",
}


def _hide_sample_data() -> bool:
    # Local/dev and portal operations should include seeded/demo records by default.
    return False


def _sample_text_query(*fields: str) -> Q:
    query = Q()
    for field in fields:
        for word in HIDDEN_SAMPLE_WORDS:
            query |= Q(**{f"{field}__icontains": word})
    return query


def _sample_email_query(*fields: str) -> Q:
    query = Q()
    for field in fields:
        for domain in HIDDEN_SAMPLE_EMAIL_DOMAINS:
            query |= Q(**{f"{field}__iendswith": domain})
    return query


def _real_users(qs):
    if not _hide_sample_data():
        return qs
    return qs.exclude(
        _sample_text_query("name")
        | _sample_text_query("email")
        | _sample_email_query("email")
        | Q(email__in=["driver@logistics.com", "warehouse@logistics.com"])
    )


def _real_customers(qs):
    if not _hide_sample_data():
        return qs
    return qs.exclude(
        _sample_text_query("name", "email", "address", "city")
        | _sample_email_query("email")
        | Q(email="customer@example.com")
    )


def _real_products(qs):
    if not _hide_sample_data():
        return qs
    return qs.exclude(_sample_text_query("name", "sku"))


def _real_warehouses(qs):
    if not _hide_sample_data():
        return qs
    return qs.exclude(_sample_text_query("name", "code", "address", "city"))


def _real_vehicles(qs):
    if not _hide_sample_data():
        return qs
    return qs.exclude(_sample_text_query("license_plate"))


def _real_drivers(qs):
    if not _hide_sample_data():
        return qs
    return qs.exclude(_sample_text_query("license_number", "name", "email") | _sample_email_query("email"))


def _real_orders(qs):
    if not _hide_sample_data():
        return qs
    return qs.exclude(
        _sample_text_query(
            "order_number",
            "customer__name",
            "customer__email",
            "shipping_name",
            "shipping_address",
            "shipping_city",
        )
        | _sample_email_query("customer__email")
    )


def _real_trips(qs):
    if not _hide_sample_data():
        return qs
    return qs.exclude(
        _sample_text_query("trip_number", "notes", "driver__license_number", "driver__name", "driver__email")
        | _sample_email_query("driver__email")
        | _sample_text_query(
            "drop_points__order__order_number",
            "drop_points__order__customer__name",
            "drop_points__order__customer__email",
            "drop_points__order__shipping_name",
            "drop_points__order__shipping_address",
        )
        | _sample_email_query("drop_points__order__customer__email")
    ).distinct()


def _serialize_driver_vehicle_link(vehicle: Vehicle) -> dict[str, Any]:
    driver_payload = _serialize_model(vehicle.driver, exclude={"password"}) if getattr(vehicle, "driver", None) else None
    if driver_payload:
        driver_payload["user"] = _serialize_model(vehicle.driver, exclude={"password"})
    return {
        "id": f"veh-assignment-{vehicle.id}",
        "isActive": bool(vehicle.driver_id),
        "assignedAt": vehicle.updated_at.isoformat() if vehicle.driver_id and vehicle.updated_at else None,
        "driverId": vehicle.driver_id,
        "vehicleId": vehicle.id,
        "vehicle": _serialize_model(vehicle),
        "driver": driver_payload,
    }


def _assign_vehicle_to_driver(driver: User, vehicle: Vehicle | None) -> None:
    if not vehicle:
        Vehicle.objects.filter(driver=driver).update(driver=None)
        return

    Vehicle.objects.filter(driver=driver).exclude(id=vehicle.id).update(driver=None)
    vehicle.driver = driver
    vehicle.save(update_fields=["driver", "updated_at"])


def _camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def _json_body(request: HttpRequest) -> dict[str, Any]:
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return {}


def _ok(data: dict[str, Any], status: int = 200) -> JsonResponse:
    return JsonResponse(data, status=status)


def _err(message: str, status: int = 400) -> JsonResponse:
    return JsonResponse({"success": False, "error": message}, status=status)


def _int(v: Any, default: int) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _to_float_or_none(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def _parse_iso_datetime(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = f"{raw[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def _validate_password_strength(password: str) -> str | None:
    if len(password) < 8:
        return PASSWORD_POLICY_ERROR
    if any(char.isspace() for char in password):
        return PASSWORD_POLICY_ERROR
    if not re.search(r"[A-Z]", password):
        return PASSWORD_POLICY_ERROR
    if not re.search(r"[a-z]", password):
        return PASSWORD_POLICY_ERROR
    if not re.search(r"\d", password):
        return PASSWORD_POLICY_ERROR
    if not re.search(r"[^A-Za-z0-9\s]", password):
        return PASSWORD_POLICY_ERROR
    return None


def _normalize_order_items_for_checkout(raw_items: Any) -> tuple[list[dict[str, Any]], float]:
    if not isinstance(raw_items, list) or not raw_items:
        raise ValueError("items are required")

    normalized_items: list[dict[str, Any]] = []
    subtotal = 0.0
    for item in raw_items:
        pid = str((item or {}).get("productId") or "").strip()
        if not pid:
            continue
        prod = Product.objects.filter(id=pid).first()
        if not prod:
            raise ValueError(f"Product not found: {pid}")

        qty = _int((item or {}).get("quantity"), 0)
        if qty <= 0:
            raise ValueError(f"Quantity must be greater than zero for product {prod.sku}")

        unit = float((item or {}).get("unitPrice") or prod.price)
        line_total = float((item or {}).get("totalPrice") or unit * qty)
        subtotal += unit * qty
        normalized_items.append(
            {
                "productId": pid,
                "quantity": qty,
                "unitPrice": unit,
                "totalPrice": line_total,
                "notes": (item or {}).get("notes"),
            }
        )

    if not normalized_items:
        raise ValueError("items are required")
    return normalized_items, subtotal


def _compute_order_totals(body: dict[str, Any], subtotal: float) -> tuple[float, float, float, float]:
    shipping_cost = float(body.get("shippingCost") or 0)
    discount = float(body.get("discount") or 0)
    tax = float(body.get("tax") if body.get("tax") is not None else 0)
    total = float(body.get("totalAmount") if body.get("totalAmount") is not None else subtotal + tax + shipping_cost - discount)
    return tax, shipping_cost, discount, total


def _build_discount_breakdown_for_customer(*, customer: Customer, subtotal: float, total_cases: int) -> dict[str, Any]:
    option = str(getattr(customer, "discount_option", DISCOUNT_NO) or DISCOUNT_NO).strip().upper()
    status = str(getattr(customer, "discount_status", DISCOUNT_REMOVED) or DISCOUNT_REMOVED).strip().upper()
    if status in {DISCOUNT_CANCELLED, DISCOUNT_REMOVED}:
        option = DISCOUNT_NO

    percent = 0.0
    amount_per_case = 0.0
    discount_type = "PERCENTAGE"
    if option in DISCOUNT_PRESET_PERCENT:
        percent = float(DISCOUNT_PRESET_PERCENT[option])
    elif option == DISCOUNT_OTHER:
        # Custom discounts are percentage-based so they always scale with product prices.
        percent = max(0.0, float(getattr(customer, "discount_percent", 0) or 0))
    else:
        option = DISCOUNT_NO

    per_case_discount = 0.0
    if option != DISCOUNT_NO and total_cases > 0:
        average_case_price = subtotal / max(1, total_cases)
        per_case_discount = average_case_price * (percent / 100.0)

    total_discount = per_case_discount * max(0, total_cases)
    total_discount = min(total_discount, max(0.0, subtotal))

    return {
        "option": option,
        "status": status if option != DISCOUNT_NO else DISCOUNT_REMOVED,
        "name": DISCOUNT_PRESET_LABEL.get(option, "No Discount"),
        "type": discount_type if option != DISCOUNT_NO else DISCOUNT_NO,
        "percent": percent if option != DISCOUNT_NO else 0.0,
        "amountPerCase": 0.0,
        "perCaseDiscount": per_case_discount if option != DISCOUNT_NO else 0.0,
        "casesAffected": max(0, total_cases),
        "totalDiscount": max(0.0, total_discount),
        "appliedByName": str(getattr(customer, "discount_applied_by_name", "") or "").strip() or None,
    }


def _create_order_from_checkout_payload(
    *,
    customer: Customer,
    body: dict[str, Any],
    normalized_items: list[dict[str, Any]],
    subtotal: float,
    tax: float,
    shipping_cost: float,
    discount: float,
    total_amount: float,
    selected_warehouse_id: str | None,
    shipping_latitude: Any,
    shipping_longitude: Any,
    payment_status: str,
    performed_by: str | None,
    discount_breakdown: dict[str, Any] | None = None,
) -> Order:
    _ensure_order_legacy_checklist_columns_defaults()

    year = timezone.now().year
    sequence = Order.objects.filter(created_at__year=year).count() + 1
    order_number = f"ORD-{year}-{str(sequence).zfill(4)}"
    while Order.objects.filter(order_number=order_number).exists():
        sequence += 1
        order_number = f"ORD-{year}-{str(sequence).zfill(4)}"

    order = Order.objects.create(
        order_number=order_number,
        customer=customer,
        status=_normalize_order_status(body.get("status") or OrderStatus.PENDING),
        priority=body.get("priority") or "normal",
        subtotal=0,
        tax=0,
        shipping_cost=shipping_cost,
        discount=discount,
        discount_type=str((discount_breakdown or {}).get("type") or DISCOUNT_NO),
        discount_name=str((discount_breakdown or {}).get("name") or "No Discount"),
        discount_percent_applied=float((discount_breakdown or {}).get("percent") or 0),
        discount_amount_per_case_applied=float((discount_breakdown or {}).get("amountPerCase") or 0),
        discount_per_case_applied=float((discount_breakdown or {}).get("perCaseDiscount") or 0),
        discount_cases_affected=max(0, _int((discount_breakdown or {}).get("casesAffected"), 0)),
        discount_applied_by_name=(discount_breakdown or {}).get("appliedByName"),
        discount_status=str((discount_breakdown or {}).get("status") or DISCOUNT_REMOVED),
        total_amount=0,
        payment_status=payment_status,
        warehouse_id=selected_warehouse_id,
    )

    allocation_policy = _resolve_allocation_policy(body)
    warehouses_used_for_reservation: set[str] = set()
    for item in normalized_items:
        pid = str(item.get("productId") or "").strip()
        prod = Product.objects.filter(id=pid).first()
        if not prod:
            raise ValueError(f"Product not found: {pid}")

        qty = _int(item.get("quantity"), 0)
        unit = float(item.get("unitPrice") or prod.price)
        line_total = float(item.get("totalPrice") or unit * qty)
        order_item = OrderItem.objects.create(
            order=order,
            product=prod,
            product_name=str(prod.name or "").strip() or None,
            product_sku=str(prod.sku or "").strip() or None,
            product_unit=_normalize_product_unit(prod.unit),
            quantity=qty,
            unit_price=unit,
            total_price=line_total,
            notes=item.get("notes"),
        )

        requested_warehouse_id = str(order.warehouse_id or "").strip() or None
        used_fallback_warehouse = False
        try:
            allocations = _reserve_inventory_for_order_item(
                product=prod,
                requested_qty=qty,
                order=order,
                order_item=order_item,
                warehouse_id=requested_warehouse_id,
                allocation_policy=allocation_policy,
                performed_by=performed_by,
            )
        except ValueError:
            if not requested_warehouse_id:
                raise
            used_fallback_warehouse = True
            allocations = _reserve_inventory_for_order_item(
                product=prod,
                requested_qty=qty,
                order=order,
                order_item=order_item,
                warehouse_id=None,
                allocation_policy=allocation_policy,
                performed_by=performed_by,
            )

        for row in allocations:
            used_wh = str(row.get("warehouseId") or "").strip()
            if used_wh:
                warehouses_used_for_reservation.add(used_wh)
        allocation_note = f"Reserved using {allocation_policy}: " + ", ".join([f"{row['batchNumber']} x{row['quantity']}" for row in allocations])
        policy_note = f"AllocationPolicy={allocation_policy}"
        fallback_note = "WarehouseFallback=TRUE" if used_fallback_warehouse else ""
        order_item.notes = f"{order_item.notes or ''}\n{policy_note}\n{fallback_note}\n{allocation_note}".strip()
        order_item.save(update_fields=["notes"])

    if len(warehouses_used_for_reservation) == 1:
        order.warehouse_id = next(iter(warehouses_used_for_reservation))
    elif len(warehouses_used_for_reservation) > 1:
        order.warehouse_id = None

    order.subtotal = subtotal
    order.tax = tax
    order.total_amount = total_amount
    order.shipping_name = body.get("shippingName") or customer.name
    order.shipping_phone = body.get("shippingPhone") or customer.phone or ""
    order.shipping_address = _strip_default_country_suffix(body.get("shippingAddress") or customer.address or "")
    order.shipping_city = body.get("shippingCity") or customer.city or ""
    order.shipping_province = body.get("shippingProvince") or customer.province or ""
    order.shipping_zip_code = body.get("shippingZipCode") or customer.zip_code or ""
    order.shipping_country = DEFAULT_COUNTRY
    order.shipping_latitude = shipping_latitude
    order.shipping_longitude = shipping_longitude
    order.notes = body.get("notes")
    order.special_instructions = body.get("specialInstructions")
    order.save(
        update_fields=[
            "subtotal",
            "tax",
            "discount_type",
            "discount_name",
            "discount_percent_applied",
            "discount_amount_per_case_applied",
            "discount_per_case_applied",
            "discount_cases_affected",
            "discount_applied_by_name",
            "discount_status",
            "warehouse_id",
            "total_amount",
            "shipping_name",
            "shipping_phone",
            "shipping_address",
            "shipping_city",
            "shipping_province",
            "shipping_zip_code",
            "shipping_country",
            "shipping_latitude",
            "shipping_longitude",
            "notes",
            "special_instructions",
            "updated_at",
        ]
    )
    OrderTimeline.objects.create(order=order, delivery_date=datetime.fromisoformat(body["deliveryDate"]) if body.get("deliveryDate") else None)
    return order


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


def _generate_next_replacement_order_number() -> str:
    year = timezone.now().year
    sequence = Order.objects.filter(order_number__startswith=f"RPL-{year}-").count() + 1
    order_number = f"RPL-{year}-{str(sequence).zfill(4)}"
    while Order.objects.filter(order_number=order_number).exists():
        sequence += 1
        order_number = f"RPL-{year}-{str(sequence).zfill(4)}"
    return order_number


def _create_scheduled_replacement_order(
    replacement: Replacement,
    *,
    scheduled_date: date,
    staff_user_id: str | None,
) -> Order:
    meta = _extract_replacement_meta(replacement.notes)
    existing_order_id = str(meta.get("replacementOrderId") or "").strip()
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
        source_lines = meta.get("replacementLines")
    elif isinstance(meta.get("replacementItems"), list) and meta.get("replacementItems"):
        source_lines = meta.get("replacementItems")
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
        raise ValueError("No replacement items available to schedule")

    replacement_order = Order.objects.create(
        order_number=_generate_next_replacement_order_number(),
        customer=source_order.customer,
        status=OrderStatus.CONFIRMED,
        priority="high",
        subtotal=0,
        tax=0,
        shipping_cost=0,
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
    use_remaining_only = _normalize_replacement_mode(getattr(replacement, "replacement_mode", None)) == REPLACEMENT_MODE_SPARE_PRODUCTS_PARTIAL

    for line in source_lines:
        if use_remaining_only:
            raw_qty = _int(
                line.get("remainingQuantity"),
                max(
                    _int(line.get("quantityToReplace"), _int(line.get("quantity"), 0))
                    - _int(line.get("quantityReplaced"), 0),
                    0,
                ),
            )
        else:
            raw_qty = _int(line.get("quantityReplaced"), _int(line.get("quantityToReplace"), _int(line.get("quantity"), 0)))
        qty_bottles = max(raw_qty, 0)
        replacement_cases = max(0, _int(line.get("replacementCases"), 0))
        replacement_bottles = max(0, _int(line.get("replacementBottles"), 0))
        by_case = bool(re.search(r"\bby\s*case\b", notes_lower))
        by_bottle = bool(re.search(r"\bby\s*bottle\b", notes_lower))
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
            notes=f"Replacement line from {replacement.replacement_number}",
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
    replacement.save(update_fields=["notes", "updated_at"])
    return replacement_order


def _ensure_order_legacy_checklist_columns_defaults() -> None:
    global _order_legacy_checklist_columns_checked
    if _order_legacy_checklist_columns_checked:
        return

    # Legacy deployments may still have old checklist columns as NOT NULL without defaults.
    # Ensure they can accept new inserts from the current Order model.
    if connection.vendor != "postgresql":
        _order_legacy_checklist_columns_checked = True
        return

    table_name = Order._meta.db_table
    legacy_columns = [
        "checklist_items_verified",
        "checklist_packaging_verified",
        "checklist_spare_products_verified",
        "checklist_vehicle_assigned",
        "checklist_driver_assigned",
    ]

    with connection.cursor() as cursor:
        for column_name in legacy_columns:
            cursor.execute(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE lower(table_name) = lower(%s)
                  AND lower(column_name) = lower(%s)
                LIMIT 1
                """,
                [table_name, column_name],
            )
            exists = cursor.fetchone() is not None
            if not exists:
                continue

            cursor.execute(f'UPDATE "{table_name}" SET "{column_name}" = FALSE WHERE "{column_name}" IS NULL')
            cursor.execute(f'ALTER TABLE "{table_name}" ALTER COLUMN "{column_name}" SET DEFAULT FALSE')

    _order_legacy_checklist_columns_checked = True


NEGROS_OCCIDENTAL_BOUNDS = {
    # Strict Silay + Talisay service area (no map buffer).
    "min_lat": 10.64,
    "max_lat": 10.92,
    "min_lng": 122.88,
    "max_lng": 123.06,
}

DEFAULT_COUNTRY = "Philippines"


def _is_within_negros_occidental(lat: float, lng: float) -> bool:
    return (
        NEGROS_OCCIDENTAL_BOUNDS["min_lat"] <= lat <= NEGROS_OCCIDENTAL_BOUNDS["max_lat"]
        and NEGROS_OCCIDENTAL_BOUNDS["min_lng"] <= lng <= NEGROS_OCCIDENTAL_BOUNDS["max_lng"]
    )


def _normalize_province(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = text.replace(".", " ").replace("-", " ")
    text = " ".join(text.split())
    return text


def _normalize_city(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = text.replace(".", " ").replace("-", " ")
    text = " ".join(text.split())
    return text


def _strip_default_country_suffix(address: Any) -> str:
    text = str(address or "").strip()
    if not text:
        return ""
    tokens = [token.strip() for token in text.split(",") if token.strip()]
    if not tokens:
        return text
    country_tokens = {"philippines", "republic of the philippines"}
    while tokens and tokens[-1].lower() in country_tokens:
        tokens.pop()
    return ", ".join(tokens) if tokens else ""


def _ensure_negros_occidental_address(
    *,
    latitude: Any,
    longitude: Any,
    city: Any = None,
    province: Any,
    require_coordinates: bool = False,
) -> str | None:
    lat = _to_float_or_none(latitude)
    lng = _to_float_or_none(longitude)
    normalized_province = _normalize_province(province)
    normalized_city = _normalize_city(city)
    allowed_cities = {"silay", "silay city", "talisay", "talisay city"}

    if lat is None or lng is None:
        if require_coordinates:
            return "Pinned location is required and must be within Silay or Talisay, Negros Occidental, Philippines"
        if normalized_city and normalized_city not in allowed_cities:
            return "Address city must be Silay or Talisay"
        if normalized_province and normalized_province != "negros occidental":
            return "Address province must be Negros Occidental"
        return None

    if not _is_within_negros_occidental(lat, lng):
        return "Pinned location must be within Silay or Talisay, Negros Occidental, Philippines"
    if normalized_city and normalized_city not in allowed_cities:
        return "Address city must be Silay or Talisay"
    if normalized_province and normalized_province != "negros occidental":
        return "Address province must be Negros Occidental"
    return None


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_km = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return radius_km * c


def _compute_order_distances(
    orders: list[dict[str, Any]],
    start_latitude: float | None = None,
    start_longitude: float | None = None,
) -> tuple[list[dict[str, Any]], float]:
    previous_lat = _to_float_or_none(start_latitude)
    previous_lng = _to_float_or_none(start_longitude)
    total_distance_km = 0.0
    enriched_orders: list[dict[str, Any]] = []

    for raw_order in orders:
        order_row = dict(raw_order or {})
        order_lat = _to_float_or_none(order_row.get("latitude") or order_row.get("shippingLatitude"))
        order_lng = _to_float_or_none(order_row.get("longitude") or order_row.get("shippingLongitude"))

        if order_lat is None or order_lng is None:
            order_row["distanceKm"] = None
            enriched_orders.append(order_row)
            continue

        if previous_lat is not None and previous_lng is not None:
            segment_distance_km = _haversine_km(previous_lat, previous_lng, order_lat, order_lng)
            order_row["distanceKm"] = round(segment_distance_km, 2)
            total_distance_km += segment_distance_km
        else:
            order_row["distanceKm"] = 0.0

        previous_lat = order_lat
        previous_lng = order_lng
        enriched_orders.append(order_row)

    return enriched_orders, round(total_distance_km, 2)


def _pagination(request: HttpRequest) -> tuple[int, int, int]:
    page = max(1, _int(request.GET.get("page", "1"), 1))
    size = max(1, min(_int(request.GET.get("pageSize", request.GET.get("limit", "20")), 20), 1000))
    return page, size, (page - 1) * size


_ORDER_STATUS_ALIASES: dict[str, str] = {
    "PROCESSING": OrderStatus.PREPARING,
    "PACKED": OrderStatus.PREPARING,
    "DISPATCHED": OrderStatus.OUT_FOR_DELIVERY,
    "READY_FOR_PICKUP": OrderStatus.PREPARING,
    "IN_TRANSIT": OrderStatus.OUT_FOR_DELIVERY,
    "UNAPPROVED": OrderStatus.PENDING,
    "FAILED_DELIVERY": OrderStatus.CANCELLED,
    "REJECTED": OrderStatus.REJECTED,
}


def _normalize_order_status(value: Any) -> str:
    raw = str(value or "").strip().upper()
    if not raw:
        return raw
    if raw in {
        OrderStatus.PENDING,
        OrderStatus.CONFIRMED,
        OrderStatus.PREPARING,
        OrderStatus.RESCHEDULED,
        OrderStatus.OUT_FOR_DELIVERY,
        OrderStatus.DELIVERED,
        OrderStatus.REJECTED,
        OrderStatus.CANCELLED,
    }:
        return raw
    return _ORDER_STATUS_ALIASES.get(raw, raw)


def _normalize_replacement_status(value: Any, replacement_mode: Any = None) -> str:
    raw = str(value or "").strip().upper()
    mode = str(replacement_mode or "").strip().upper()
    if not raw:
        return raw
    if raw in {
        ReplacementStatus.PENDING,
        ReplacementStatus.UNDER_REVIEW,
        ReplacementStatus.APPROVED,
        ReplacementStatus.REJECTED,
        ReplacementStatus.REPORTED,
        ReplacementStatus.IN_PROGRESS,
        ReplacementStatus.NEEDS_FOLLOW_UP,
        ReplacementStatus.COMPLETED,
    }:
        return raw
    if raw == ReplacementStatus.RESOLVED_ON_DELIVERY:
        return ReplacementStatus.COMPLETED
    if raw == "REQUESTED":
        return ReplacementStatus.REPORTED
    if raw in {"APPROVED", "PICKED_UP", "IN_TRANSIT", "RECEIVED"}:
        return ReplacementStatus.IN_PROGRESS
    if raw == "UNDER REVIEW":
        return ReplacementStatus.UNDER_REVIEW
    if raw == "PENDING_REVIEW":
        return ReplacementStatus.PENDING
    if raw == "REJECTED":
        return ReplacementStatus.REJECTED
    if raw == "PROCESSED":
        return ReplacementStatus.COMPLETED
    return raw


def _normalize_replacement_mode(value: Any) -> str:
    raw = str(value or "").strip().upper()
    if raw == "SPARE_STOCK_IMMEDIATE":
        return REPLACEMENT_MODE_SPARE_PRODUCTS_IMMEDIATE
    if raw == "SPARE_STOCK_PARTIAL":
        return REPLACEMENT_MODE_SPARE_PRODUCTS_PARTIAL
    return raw


def _is_linked_replacement_order_delivered(entry: Replacement) -> bool:
    meta = _extract_replacement_meta(getattr(entry, "notes", ""))
    replacement_order_id = str(meta.get("replacementOrderId") or "").strip()
    replacement_order_number = str(meta.get("replacementOrderNumber") or "").strip()
    replacement_order = None
    if replacement_order_id:
        replacement_order = Order.objects.filter(id=replacement_order_id).only("status", "order_number").first()
    elif replacement_order_number:
        replacement_order = Order.objects.filter(order_number=replacement_order_number).only("status", "order_number").first()
    if not replacement_order:
        return False
    return _normalize_order_status(getattr(replacement_order, "status", None)) == OrderStatus.DELIVERED


def _is_replacement_closed(entry: Replacement) -> bool:
    if _is_linked_replacement_order_delivered(entry):
        return True
    normalized = _normalize_replacement_status(entry.status, entry.replacement_mode)
    return normalized in {ReplacementStatus.RESOLVED_ON_DELIVERY, ReplacementStatus.COMPLETED}


def _serialize_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _serialize_model(obj: Any, include: dict[str, Any] | None = None, exclude: set[str] | None = None) -> dict[str, Any]:
    include = include or {}
    exclude = exclude or set()
    raw = model_to_dict(obj)
    raw["id"] = getattr(obj, "id", raw.get("id"))
    out: dict[str, Any] = {}
    for key, val in raw.items():
        if key in exclude:
            continue
        out[_camel(key)] = _serialize_value(val)
    if isinstance(obj, Product):
        try:
            out["unit"] = _normalize_product_unit(raw.get("unit"))
        except ValueError:
            out["unit"] = PRODUCT_UNIT_CASE
        out["quantityPerCase"] = _int(raw.get("quantity_per_unit"), 0)
    if isinstance(obj, Inventory):
        quantity_per_case = _int(getattr(getattr(obj, "product", None), "quantity_per_unit", 0), 0)
        case_count = max(0, _int(raw.get("quantity"), 0))
        loose_bottles = max(0, _int(raw.get("loose_bottles"), 0))
        out["quantityPerCase"] = quantity_per_case
        out["looseBottles"] = loose_bottles
        out["totalBottles"] = (case_count * quantity_per_case) + loose_bottles if quantity_per_case > 0 else case_count + loose_bottles
    for key, fn in include.items():
        out[key] = fn(obj)
    return out


def _trip_status_rank(value: Any) -> int:
    normalized = str(value or "").strip().upper()
    if normalized == TripStatus.IN_PROGRESS:
        return 0
    if normalized == TripStatus.PLANNED:
        return 1
    if normalized == TripStatus.COMPLETED:
        return 2
    return 3


def _select_trip_for_order(order_id: str, require_driver: bool = False) -> Trip | None:
    trip_qs = _real_trips(
        Trip.objects.filter(drop_points__order_id=order_id).select_related("driver", "vehicle").order_by("-updated_at")
    )
    if require_driver:
        trip_qs = trip_qs.filter(driver__isnull=False)

    best_trip: Trip | None = None
    best_rank = 99
    for candidate in trip_qs:
        candidate_rank = _trip_status_rank(getattr(candidate, "status", ""))
        if best_trip is None or candidate_rank < best_rank:
            best_trip = candidate
            best_rank = candidate_rank
            if best_rank == 0:
                break
    return best_trip


def _calculate_order_weight(order: Order) -> float:
    """Calculate total weight of an order in kg based on order items and their product weights."""
    total_weight = 0.0
    for item in order.items.select_related("product").all():
        product = getattr(item, "product", None)
        product_weight = float(getattr(product, "weight", 0) or 0)
        item_quantity = int(item.quantity or 0)
        total_weight += product_weight * item_quantity
    return total_weight


def _get_vehicle_capacity_usage(vehicle_id: str) -> float:
    """Get current weight usage for a vehicle across all active trips (80% of capacity used)."""
    from django.db.models import Sum, Case, When, FloatField, Q

    # Get all active trips for this vehicle
    active_trips = Trip.objects.filter(
        vehicle_id=vehicle_id,
        status__in=["PLANNED", "IN_TRANSIT", "READY_TO_LOAD"]
    ).prefetch_related("drop_points__order__items__product").all()

    total_weight = 0.0
    for trip in active_trips:
        for drop_point in trip.drop_points.all():
            if drop_point.order:
                total_weight += _calculate_order_weight(drop_point.order)

    return total_weight


def _build_assigned_trip_map(order_ids: list[str], require_driver: bool = True) -> dict[str, Trip]:
    normalized_order_ids = [str(order_id or "").strip() for order_id in order_ids if str(order_id or "").strip()]
    if not normalized_order_ids:
        return {}

    trip_qs = _real_trips(
        Trip.objects.filter(drop_points__order_id__in=normalized_order_ids).select_related("driver", "vehicle")
    ).order_by("-updated_at").prefetch_related(
        Prefetch(
            "drop_points",
            queryset=TripDropPoint.objects.filter(order_id__in=normalized_order_ids).only("id", "trip_id", "order_id"),
        )
    )

    if require_driver:
        trip_qs = trip_qs.filter(driver__isnull=False)

    best_by_order_id: dict[str, Trip] = {}
    best_rank_by_order_id: dict[str, int] = {}
    best_updated_ts_by_order_id: dict[str, float] = {}
    for trip in trip_qs:
        rank = _trip_status_rank(getattr(trip, "status", ""))
        updated_ts = trip.updated_at.timestamp() if getattr(trip, "updated_at", None) else 0.0
        for drop_point in trip.drop_points.all():
            order_id = str(getattr(drop_point, "order_id", "") or "").strip()
            if not order_id:
                continue
            current_rank = best_rank_by_order_id.get(order_id)
            current_updated_ts = best_updated_ts_by_order_id.get(order_id, 0.0)
            if current_rank is None or rank < current_rank or (rank == current_rank and updated_ts > current_updated_ts):
                best_by_order_id[order_id] = trip
                best_rank_by_order_id[order_id] = rank
                best_updated_ts_by_order_id[order_id] = updated_ts

    return best_by_order_id


def _generate_next_trip_number() -> str:
    current_year = timezone.now().year
    prefix = f"TRP-{current_year}-"
    max_sequence = 0
    for trip_number in Trip.objects.filter(trip_number__startswith=prefix).values_list("trip_number", flat=True):
        raw = str(trip_number or "").strip()
        if not raw.startswith(prefix):
            continue
        suffix = raw[len(prefix):]
        if suffix.isdigit():
            max_sequence = max(max_sequence, int(suffix))
    return f"{prefix}{str(max_sequence + 1).zfill(4)}"





def _payload(request: HttpRequest) -> dict[str, Any] | None:
    token = extract_token(request)
    if not token:
        return None
    return decode_token(token)


def _require_auth(request: HttpRequest) -> dict[str, Any] | None:
    return _payload(request)


def _require_staff(request: HttpRequest) -> tuple[dict[str, Any] | None, JsonResponse | None]:
    p = _payload(request)
    if not p:
        return None, _err("Unauthorized", 401)
    if p.get("type") != "staff":
        return None, _err("Forbidden", 403)
    return p, None


def _create_staff_notifications(
    *,
    title: str,
    message: str,
    notification_type: str = "INVENTORY",
    reference_type: str | None = None,
    reference_id: str | None = None,
) -> None:
    recipients = list(
        User.objects.filter(
            role__in=[RoleType.SUPER_ADMIN, RoleType.ADMIN, RoleType.WAREHOUSE_STAFF],
            is_active=True,
        ).only("id")
    )
    if not recipients:
        return

    Notification.objects.bulk_create(
        [
            Notification(
                user=user,
                title=title,
                message=message,
                type=notification_type,
                reference_type=reference_type,
                reference_id=reference_id,
                is_read=False,
            )
            for user in recipients
        ]
    )


def _create_customer_notification(
    *,
    customer: Customer | None,
    title: str,
    message: str,
    notification_type: str = "REPLACEMENT",
    reference_type: str | None = None,
    reference_id: str | None = None,
) -> None:
    if not customer:
        return
    Notification.objects.create(
        customer=customer,
        title=title,
        message=message,
        type=notification_type,
        reference_type=reference_type,
        reference_id=reference_id,
        is_read=False,
    )


def _set_auth_cookie(response: JsonResponse, token: str, remember_me: bool = False) -> None:
    cookie_kwargs = {
        "httponly": True,
        "secure": False,
        "samesite": "Lax",
        "path": "/",
    }
    if remember_me:
        cookie_kwargs["max_age"] = 60 * 60 * 24 * 30
    response.set_cookie(TOKEN_NAME, token, **cookie_kwargs)


def _user_payload(user: User) -> dict[str, Any]:
    return {
        "userId": user.id,
        "email": user.email,
        "name": user.name,
        "avatar": user.avatar,
        "role": user.role,
        "type": "staff",
    }


def _customer_payload(customer: Customer) -> dict[str, Any]:
    return {
        "userId": customer.id,
        "email": customer.email,
        "name": customer.name,
        "avatar": customer.avatar,
        "role": "CUSTOMER",
        "type": "customer",
    }


def _serialize_order(
    order: Order,
    include_items: bool = True,
    include_progress: bool = False,
    *,
    warehouse_lookup: dict[str, Warehouse] | None = None,
    assigned_trip: Trip | None = None,
) -> dict[str, Any]:
    data = _serialize_model(order)
    data["status"] = _normalize_order_status(data.get("status"))
    checklist_quantity_verified = bool(getattr(order, "checklist_quantity_verified", False))
    data["checklistQuantityVerified"] = checklist_quantity_verified
    # Backward-compatible fields kept for older clients; all mirror quantity checklist.
    data["checklistItemsVerified"] = checklist_quantity_verified
    data["checklistPackagingVerified"] = checklist_quantity_verified
    data["checklistSpareProductsVerified"] = checklist_quantity_verified
    data["checklistVehicleAssigned"] = checklist_quantity_verified
    data["checklistDriverAssigned"] = checklist_quantity_verified
    data["customer"] = _serialize_model(order.customer, exclude={"password"})
    warehouse = None
    warehouse_id = str(getattr(order, "warehouse_id", "") or "").strip()
    if warehouse_id:
        warehouse = (warehouse_lookup or {}).get(warehouse_id)
        if warehouse is None:
            warehouse = Warehouse.objects.filter(id=warehouse_id).first()
    data["warehouseName"] = str(getattr(warehouse, "name", "") or "").strip() or None
    data["warehouseCode"] = str(getattr(warehouse, "code", "") or "").strip() or None
    data["warehouseCity"] = str(getattr(warehouse, "city", "") or "").strip() or None
    data["warehouseProvince"] = str(getattr(warehouse, "province", "") or "").strip() or None
    timeline = getattr(order, "timeline", None)
    data["logistics"] = None
    data["timeline"] = _serialize_model(timeline) if timeline else None

    # Keep backward-compatible top-level shipping/timeline fields expected by portal UIs.
    shipping_latitude = order.shipping_latitude if order.shipping_latitude is not None else order.customer.latitude
    shipping_longitude = order.shipping_longitude if order.shipping_longitude is not None else order.customer.longitude
    data["shippingName"] = order.shipping_name
    data["shippingPhone"] = order.shipping_phone
    data["shippingAddress"] = _strip_default_country_suffix(order.shipping_address)
    data["shippingCity"] = order.shipping_city
    data["shippingProvince"] = order.shipping_province
    data["shippingZipCode"] = order.shipping_zip_code
    data["shippingCountry"] = DEFAULT_COUNTRY
    data["shippingLatitude"] = shipping_latitude
    data["shippingLongitude"] = shipping_longitude
    data["discountDetails"] = {
        "name": getattr(order, "discount_name", None),
        "type": getattr(order, "discount_type", DISCOUNT_NO),
        "status": getattr(order, "discount_status", DISCOUNT_REMOVED),
        "percent": float(getattr(order, "discount_percent_applied", 0) or 0),
        "amountPerCase": float(getattr(order, "discount_amount_per_case_applied", 0) or 0),
        "perCaseDiscount": float(getattr(order, "discount_per_case_applied", 0) or 0),
        "casesAffected": max(0, _int(getattr(order, "discount_cases_affected", 0), 0)),
        "totalDiscount": float(getattr(order, "discount", 0) or 0),
        "appliedByName": getattr(order, "discount_applied_by_name", None),
    }

    if timeline:
        data["deliveryDate"] = timeline.delivery_date.isoformat() if timeline.delivery_date else None
        data["deliveredAt"] = timeline.delivered_at.isoformat() if timeline.delivered_at else None
    else:
        data["deliveryDate"] = None
        data["deliveredAt"] = None

    if include_items:
        items = []
        for item in order.items.select_related("product").all():
            row = _serialize_order_item_with_spare_products(item, include_full_product=True)
            items.append(row)
        data["items"] = items

    data["scheduledReplacement"] = _get_scheduled_replacement_payload(order)

    if assigned_trip is None:
        assigned_trip = _select_trip_for_order(order.id, require_driver=True)
    assigned_driver = getattr(assigned_trip, "driver", None)
    assigned_driver_name = ""
    if assigned_driver:
        assigned_driver_name = str(getattr(getattr(assigned_driver, "user", None), "name", "") or getattr(assigned_driver, "name", "") or "").strip()
    data["isDriverAssigned"] = bool(assigned_driver)
    data["assignedDriverName"] = assigned_driver_name or None
    data["assignedTripId"] = getattr(assigned_trip, "id", None)
    data["pod"] = {
        "recipientName": getattr(order, "pod_recipient_name", None),
        "deliveryPhoto": getattr(order, "pod_photo_url", None),
        "submittedAt": order.pod_submitted_at.isoformat() if getattr(order, "pod_submitted_at", None) else None,
    }
    if include_progress:
        progress_trip = _select_trip_for_order(order.id, require_driver=False)
        if progress_trip:
            progress_trip = Trip.objects.select_related("driver", "vehicle").prefetch_related("drop_points__order").filter(id=progress_trip.id).first()
        progress_drop_point = None
        if progress_trip:
            progress_drop_point = next(
                (dp for dp in progress_trip.drop_points.all() if str(getattr(dp, "order_id", "")) == str(order.id)),
                None,
            )
        data["progress"] = {
            "trip": _serialize_trip(progress_trip, include_points=True) if progress_trip else None,
            "dropPoint": _serialize_model(progress_drop_point) if progress_drop_point else None,
            "pod": {
                "recipientName": getattr(progress_drop_point, "recipient_name", None) if progress_drop_point else None,
                "deliveryPhoto": getattr(progress_drop_point, "delivery_photo", None) if progress_drop_point else None,
                "actualArrival": progress_drop_point.actual_arrival.isoformat() if progress_drop_point and progress_drop_point.actual_arrival else None,
                "actualDeparture": progress_drop_point.actual_departure.isoformat() if progress_drop_point and progress_drop_point.actual_departure else None,
                "failureReason": getattr(progress_drop_point, "failure_reason", None) if progress_drop_point else None,
                "failureNotes": getattr(progress_drop_point, "failure_notes", None) if progress_drop_point else None,
                "notes": getattr(progress_drop_point, "notes", None) if progress_drop_point else None,
            },
        }
    return data


def _serialize_replacement(entry: Replacement) -> dict[str, Any]:
    data = _serialize_model(entry)
    meta = _extract_replacement_meta(getattr(entry, "notes", ""))
    order = getattr(entry, "order", None)
    warehouse_id = str(getattr(order, "warehouse_id", "") or "").strip() or None
    if not warehouse_id:
        trip_id = str(getattr(entry, "trip_id", "") or "").strip() or str(meta.get("tripId") or "").strip()
        if trip_id:
            source_trip = Trip.objects.filter(id=trip_id).only("warehouse_id").first()
            warehouse_id = str(getattr(source_trip, "warehouse_id", "") or "").strip() or None
    warehouse = Warehouse.objects.filter(id=warehouse_id).first() if warehouse_id else None
    order_customer = getattr(order, "customer", None)
    customer = order_customer
    if not customer and entry.customer_id:
        customer = Customer.objects.filter(id=entry.customer_id).first()
    customer_name = next(
        (
            str(value).strip()
            for value in (
                getattr(customer, "name", None),
                getattr(order, "shipping_name", None),
                getattr(customer, "email", None),
                entry.customer_id,
            )
            if str(value or "").strip()
        ),
        None,
    )
    data["orderId"] = entry.order_id
    data["orderNumber"] = getattr(order, "order_number", None)
    data["warehouseId"] = warehouse_id
    data["warehouseName"] = str(getattr(warehouse, "name", "") or "").strip() or None
    data["warehouseCode"] = str(getattr(warehouse, "code", "") or "").strip() or None
    data["warehouseCity"] = str(getattr(warehouse, "city", "") or "").strip() or None
    data["warehouseProvince"] = str(getattr(warehouse, "province", "") or "").strip() or None
    data["customerName"] = customer_name
    data["customer"] = _serialize_model(customer, exclude={"password"}) if customer else None
    data["order"] = {
        "id": getattr(order, "id", None),
        "orderNumber": getattr(order, "order_number", None),
        "customer": data["customer"],
        "shippingName": getattr(order, "shipping_name", None),
        "warehouseId": warehouse_id,
        "warehouseName": data.get("warehouseName"),
        "warehouseCode": data.get("warehouseCode"),
        "warehouseCity": data.get("warehouseCity"),
        "warehouseProvince": data.get("warehouseProvince"),
    } if order else None
    data["replacementMode"] = _normalize_replacement_mode(data.get("replacementMode"))
    data["scheduledDeliveryDate"] = str(meta.get("scheduledDeliveryDate") or "").strip() or None
    data["replacementOrderId"] = str(meta.get("replacementOrderId") or "").strip() or None
    data["replacementOrderNumber"] = str(meta.get("replacementOrderNumber") or "").strip() or None
    normalized_status = _normalize_replacement_status(data.get("status"), data.get("replacementMode"))
    delivered_linked_replacement_order = _is_linked_replacement_order_delivered(entry)
    if delivered_linked_replacement_order:
        normalized_status = ReplacementStatus.COMPLETED
        # Once linked replacement order is delivered, this replacement must no longer
        # be treated as scheduled/in-progress by downstream UIs.
        data["scheduledDeliveryDate"] = None
        data["replacementOrderId"] = None
        data["replacementOrderNumber"] = None
    data["workflowStatus"] = normalized_status
    is_partial_follow_up = (
        data["replacementMode"] == REPLACEMENT_MODE_SPARE_PRODUCTS_PARTIAL
        and normalized_status == ReplacementStatus.NEEDS_FOLLOW_UP
    )
    # For partial replacements, keep NEEDS_FOLLOW_UP as warehouse-stage workflow,
    # while exposing a completed primary status to client-facing status views.
    data["warehouseStage"] = "NEEDS_FOLLOW_UP" if is_partial_follow_up else None
    data["status"] = ReplacementStatus.COMPLETED if is_partial_follow_up else normalized_status
    original_item = None
    if entry.original_order_item_id:
        original_item = OrderItem.objects.select_related("product").filter(id=entry.original_order_item_id).first()
    if original_item is None and order is not None:
        original_item = (
            OrderItem.objects.select_related("product")
            .filter(order_id=order.id)
            .order_by("created_at", "id")
            .first()
        )
    replacement_product = None
    if entry.replacement_product_id:
        replacement_product = Product.objects.filter(id=entry.replacement_product_id).first()
    quantity_replaced = _int(meta.get("quantityReplaced"), _int(entry.replacement_quantity, 0))
    quantity_to_replace = _int(
        meta.get("quantityToReplace", meta.get("damagedQuantity", meta.get("totalDamagedQuantity"))),
        quantity_replaced,
    )
    replacement_mode = str(data.get("replacementMode") or "").strip().upper()
    if (
        replacement_mode == "CUSTOMER_SUBMITTED"
        and normalized_status not in {ReplacementStatus.COMPLETED, ReplacementStatus.RESOLVED_ON_DELIVERY}
    ):
        # Customer-submitted requests should not show replaced quantity/loss before approval/completion.
        quantity_replaced = 0
    if delivered_linked_replacement_order and quantity_to_replace > quantity_replaced:
        quantity_replaced = quantity_to_replace
    remaining_quantity = max(quantity_to_replace - quantity_replaced, 0)
    if original_item:
        data["originalOrderItem"] = {
            "id": original_item.id,
            "quantity": original_item.quantity,
            "product": _serialize_model(original_item.product) if original_item.product_id else None,
        }
        original_product_name = str(getattr(original_item.product, "name", "") or getattr(original_item, "product_name", "") or "").strip() or None
        original_product_sku = str(getattr(original_item.product, "sku", "") or getattr(original_item, "product_sku", "") or "").strip() or None
        original_product_sizes = getattr(original_item.product, "sizes", None) if getattr(original_item, "product", None) else None
        original_product_size = ", ".join([str(x).strip() for x in (original_product_sizes or []) if str(x).strip()]) if isinstance(original_product_sizes, list) else None
        data["originalProductName"] = original_product_name
        data["originalProductSku"] = original_product_sku
        data["originalProductSize"] = original_product_size
        data["originalQuantity"] = original_item.quantity
        data["quantityToReplace"] = quantity_to_replace
        data["quantityReplaced"] = quantity_replaced
        data["remainingQuantity"] = remaining_quantity
        replacement_product_name = str(getattr(replacement_product, "name", "") or "").strip() or original_product_name
        replacement_product_sku = str(getattr(replacement_product, "sku", "") or "").strip() or original_product_sku
        replacement_product_sizes = getattr(replacement_product, "sizes", None) if replacement_product else original_product_sizes
        replacement_product_size = ", ".join([str(x).strip() for x in (replacement_product_sizes or []) if str(x).strip()]) if isinstance(replacement_product_sizes, list) else original_product_size
        replacement_lines = [
            {
                "originalOrderItemId": original_item.id,
                "originalProductName": original_product_name,
                "originalProductSku": original_product_sku,
                "originalProductSize": original_product_size,
                "replacementProductName": replacement_product_name,
                "replacementProductSku": replacement_product_sku,
                "replacementProductSize": replacement_product_size,
                "quantityToReplace": quantity_to_replace,
                "quantityReplaced": quantity_replaced,
                "remainingQuantity": remaining_quantity,
            }
        ]
        # `replacementLines` is the canonical key; keep `replacementItems` for compatibility.
        data["replacementLines"] = replacement_lines
        data["replacementItems"] = replacement_lines
    else:
        # Last-resort fallback for legacy records where original item linkage is missing.
        data["quantityToReplace"] = quantity_to_replace
        data["quantityReplaced"] = quantity_replaced
        data["remainingQuantity"] = remaining_quantity
    if replacement_product:
        data["replacementProduct"] = _serialize_model(replacement_product)
        data["replacementProductName"] = replacement_product.name
        data["replacementProductSku"] = replacement_product.sku
        replacement_sizes = getattr(replacement_product, "sizes", None)
        data["replacementProductSize"] = ", ".join([str(x).strip() for x in (replacement_sizes or []) if str(x).strip()]) if isinstance(replacement_sizes, list) else None
    elif data.get("originalProductName") and not data.get("replacementProductName"):
        data["replacementProductName"] = data.get("originalProductName")
        data["replacementProductSku"] = data.get("originalProductSku")
        data["replacementProductSize"] = data.get("originalProductSize")
    damage_photo_urls: list[str] = []
    raw_damage_photo_urls = str(getattr(entry, "damage_photo_urls", "") or "").strip()
    if raw_damage_photo_urls:
        try:
            parsed_urls = json.loads(raw_damage_photo_urls)
            if isinstance(parsed_urls, list):
                damage_photo_urls = [str(url).strip() for url in parsed_urls if str(url).strip()]
        except (TypeError, ValueError):
            damage_photo_urls = []
    if not damage_photo_urls:
        meta_damage_photos = meta.get("damagePhotos") if isinstance(meta.get("damagePhotos"), list) else []
        damage_photo_urls = [str(url).strip() for url in meta_damage_photos if str(url).strip()]
    if not damage_photo_urls and str(getattr(entry, "damage_photo_url", "") or "").strip():
        damage_photo_urls = [str(getattr(entry, "damage_photo_url", "")).strip()]
    data["damagePhotoUrls"] = damage_photo_urls
    if damage_photo_urls and not data.get("damagePhotoUrl"):
        data["damagePhotoUrl"] = damage_photo_urls[0]
    return data


def _get_scheduled_replacement_payload(order: Order) -> dict[str, Any] | None:
    order_number_upper = str(getattr(order, "order_number", "") or "").strip().upper()
    if not order_number_upper.startswith("RPL-"):
        return None
    replacement = (
        Replacement.objects.filter(
            Q(notes__icontains=f'"replacementOrderId": "{order.id}"')
            | Q(notes__icontains=f'"replacementOrderNumber": "{getattr(order, "order_number", "")}"')
        )
        .order_by("-created_at")
        .first()
    )
    if not replacement:
        return None

    replacement_payload = _serialize_replacement(replacement)
    replacement_lines_raw = replacement_payload.get("replacementLines") or replacement_payload.get("replacementItems") or []
    replacement_lines = [line for line in replacement_lines_raw if isinstance(line, dict)]
    total_qty_to_replace = 0
    total_qty_replaced = 0
    for line in replacement_lines:
        total_qty_to_replace += max(0, _int(line.get("quantityToReplace"), 0))
        total_qty_replaced += max(0, _int(line.get("quantityReplaced"), 0))
    notes_text = f'{str(getattr(replacement, "description", "") or "")} {str(getattr(replacement, "notes", "") or "")}'.lower()
    by_bottle = bool(re.search(r"\bby\s*bottle\b", notes_text))
    first_line = replacement_lines[0] if replacement_lines else {}
    qty_per_unit = max(
        1,
        _int(
            first_line.get("quantityPerCase"),
            _int(
                first_line.get("qtyPerUnit"),
                _int(first_line.get("quantityPerUnit"), 1),
            ),
        ),
    )
    return {
        "replacementId": replacement_payload.get("id"),
        "replacementNumber": replacement_payload.get("replacementNumber"),
        "quantityToReplace": total_qty_to_replace,
        "quantityReplaced": total_qty_replaced,
        "quantityRemaining": max(total_qty_to_replace - total_qty_replaced, 0),
        "unitMode": "BOTTLE" if by_bottle else "UNIT",
        "qtyPerUnit": qty_per_unit,
    }


def _serialize_trip(trip: Trip, include_points: bool = True) -> dict[str, Any]:
    data = _serialize_model(trip)
    data["driver"] = _serialize_model(trip.driver, exclude={"password"}) if getattr(trip, "driver", None) else None
    data["vehicle"] = _serialize_model(trip.vehicle)
    warehouse_lat = None
    warehouse_lng = None
    if trip.warehouse_id:
        warehouse = Warehouse.objects.filter(id=trip.warehouse_id).first()
        if warehouse:
            data["warehouse"] = _serialize_model(warehouse)
            warehouse_lat = _to_float_or_none(getattr(warehouse, "latitude", None))
            warehouse_lng = _to_float_or_none(getattr(warehouse, "longitude", None))
    data["warehouseLatitude"] = warehouse_lat
    data["warehouseLongitude"] = warehouse_lng
    trip_schedule_candidates: list[str] = []
    if include_points:
        drop_points: list[dict[str, Any]] = []
        prefetched_drop_points = getattr(trip, "_prefetched_objects_cache", {}).get("drop_points")
        if prefetched_drop_points is not None:
            drop_point_rows = sorted(prefetched_drop_points, key=lambda point: point.sequence)
        else:
            drop_point_rows = trip.drop_points.select_related(
                "order",
                "order__customer",
                "order__timeline",
            ).prefetch_related(
                "order__items__product",
            ).order_by("sequence")

        for dp in drop_point_rows:
            row = _serialize_model(dp)
            row["address"] = _strip_default_country_suffix(row.get("address"))
            if dp.order_id and dp.order:
                if getattr(dp.order, "timeline", None) and dp.order.timeline.delivery_date:
                    trip_schedule_candidates.append(dp.order.timeline.delivery_date.isoformat())
                order_items = list(dp.order.items.all())
                try:
                    order_returns = list(dp.order.replacements.all())
                except Exception:
                    order_returns = []
                order_warehouse_id = str(getattr(dp.order, "warehouse_id", "") or "").strip() or None
                order_warehouse = Warehouse.objects.filter(id=order_warehouse_id).first() if order_warehouse_id else None
                row["orderStatus"] = _normalize_order_status(dp.order.status)
                row["orderNumber"] = dp.order.order_number
                row["order"] = {
                    "id": dp.order.id,
                    "orderNumber": dp.order.order_number,
                    "deliveryDate": dp.order.timeline.delivery_date.isoformat() if getattr(dp.order, "timeline", None) and dp.order.timeline.delivery_date else None,
                    "warehouseId": order_warehouse_id,
                    "warehouseName": str(getattr(order_warehouse, "name", "") or "").strip() or None,
                    "warehouseCode": str(getattr(order_warehouse, "code", "") or "").strip() or None,
                    "warehouseAddress": _strip_default_country_suffix(str(getattr(order_warehouse, "address", "") or "").strip()) or None,
                    "warehouseCity": str(getattr(order_warehouse, "city", "") or "").strip() or None,
                    "warehouseProvince": str(getattr(order_warehouse, "province", "") or "").strip() or None,
                    "warehouseStage": str(dp.order.warehouse_stage or WarehouseStage.READY_TO_LOAD),
                    "loadedAt": dp.order.loaded_at.isoformat() if dp.order.loaded_at else None,
                    "status": _normalize_order_status(dp.order.status),
                    "checklistQuantityVerified": bool(dp.order.checklist_quantity_verified),
                    # Backward-compatible mirrors for older portal clients.
                    "checklistItemsVerified": bool(dp.order.checklist_quantity_verified),
                    "checklistPackagingVerified": bool(dp.order.checklist_quantity_verified),
                    "checklistSpareProductsVerified": bool(dp.order.checklist_quantity_verified),
                    "checklistVehicleAssigned": bool(dp.order.checklist_quantity_verified),
                    "checklistDriverAssigned": bool(dp.order.checklist_quantity_verified),
                    "isDriverAssigned": bool(trip.driver_id),
                    "assignedDriverName": str(getattr(getattr(trip.driver, "user", None), "name", "") or "").strip() or None,
                    "totalAmount": dp.order.total_amount,
                    "scheduledReplacement": _get_scheduled_replacement_payload(dp.order),
                    "items": [
                        _serialize_order_item_with_spare_products(item, include_full_product=False)
                        for item in order_items
                    ],
                    "replacements": [
                        {
                            **_serialize_replacement(entry),
                            "remainingQuantity": max(
                                _int(
                                    next((item.quantity for item in order_items if item.id == entry.original_order_item_id), 0),
                                    0,
                                )
                                - _int(entry.replacement_quantity, 0),
                                0,
                            ),
                            "isClosed": _is_replacement_closed(entry),
                        }
                        for entry in order_returns
                        if not dp.order_id
                        or not str(entry.drop_point_id or "").strip()
                        or str(entry.drop_point_id or "") == str(dp.id)
                    ],
                }

                # Backfill coordinates for old trips where TripDropPoint lat/lng were saved as null.
                if _to_float_or_none(row.get("latitude")) is None or _to_float_or_none(row.get("longitude")) is None:
                    fallback_lat = _to_float_or_none(
                        getattr(dp.order, "shipping_latitude", None) or getattr(dp.order.customer, "latitude", None)
                    )
                    fallback_lng = _to_float_or_none(
                        getattr(dp.order, "shipping_longitude", None) or getattr(dp.order.customer, "longitude", None)
                    )
                    if fallback_lat is not None and fallback_lng is not None:
                        row["latitude"] = fallback_lat
                        row["longitude"] = fallback_lng
            drop_points.append(row)
        data["dropPoints"] = drop_points
    else:
        schedule_rows = trip.drop_points.select_related("order__timeline").all()
        for dp in schedule_rows:
            if dp.order_id and getattr(dp, "order", None) and getattr(dp.order, "timeline", None) and dp.order.timeline.delivery_date:
                trip_schedule_candidates.append(dp.order.timeline.delivery_date.isoformat())
    data["tripSchedule"] = min(trip_schedule_candidates) if trip_schedule_candidates else None
    return data


def _warehouse_checklist_complete(order: Order) -> bool:
    return bool(order.checklist_quantity_verified)


def _resolve_quantity_checklist(checklist: dict[str, Any]) -> bool | None:
    if "quantityVerified" in checklist:
        return bool(checklist.get("quantityVerified"))

    legacy_keys = (
        "itemsVerified",
        "packagingVerified",
        "spareProductsVerified",
        "vehicleAssigned",
        "driverAssigned",
    )
    provided_values = [bool(checklist.get(key)) for key in legacy_keys if key in checklist]
    if provided_values:
        return all(provided_values)
    return None


def _normalize_allocation_policy(raw: Any) -> str:
    value = str(raw or "").strip().upper()
    if value == "FIFO":
        return "FIFO"
    return "FEFO"


def _resolve_allocation_policy(body: dict[str, Any]) -> str:
    # Per-order override is supported, but FEFO remains the default for beverage inventory.
    requested = body.get("allocationPolicy")
    if requested:
        return _normalize_allocation_policy(requested)
    configured = getattr(settings, "INVENTORY_ALLOCATION_POLICY", "FEFO")
    return _normalize_allocation_policy(configured)


def _normalize_product_unit(raw: Any) -> str:
    value = str(raw or "").strip().lower()
    if not value:
        return PRODUCT_UNIT_CASE
    if value in {"piece", "pieces", PRODUCT_UNIT_CASE}:
        return PRODUCT_UNIT_CASE
    if value in {"pack", "bundle", "pack(bundle)", "pack (bundle)"}:
        return PRODUCT_UNIT_PACK_BUNDLE
    raise ValueError("unit must be either 'case' or 'pack(bundle)'")


def _round_half_up(value: float) -> int:
    return max(0, int(math.floor(max(value, 0) + 0.5)))


def _spare_product_policy(raw_unit: Any) -> dict[str, Any]:
    unit = _normalize_product_unit(raw_unit)
    policy = SPARE_PRODUCT_POLICY_BY_UNIT.get(unit, SPARE_PRODUCT_POLICY_BY_UNIT[PRODUCT_UNIT_CASE])
    return {"unit": unit, **policy}


def _spare_product_quantities(quantity: Any, raw_unit: Any) -> dict[str, Any]:
    ordered_qty = max(_int(quantity, 0), 0)
    policy = _spare_product_policy(raw_unit)
    min_quantity = _round_half_up(ordered_qty * float(policy["minPercent"]) / 100.0)
    recommended_quantity = _round_half_up(ordered_qty * float(policy["recommendedPercent"]) / 100.0)
    max_quantity = _round_half_up(ordered_qty * float(policy["maxPercent"]) / 100.0)

    # Always provision at least 1 spare item when an order line has quantity.
    if ordered_qty > 0:
        min_quantity = max(min_quantity, 1)
        recommended_quantity = max(recommended_quantity, 1)
        max_quantity = max(max_quantity, 1)

    if max_quantity < min_quantity:
        max_quantity = min_quantity
    recommended_quantity = max(min_quantity, min(recommended_quantity, max_quantity))
    return {
        "unit": policy["unit"],
        "minPercent": int(policy["minPercent"]),
        "maxPercent": int(policy["maxPercent"]),
        "recommendedPercent": int(policy["recommendedPercent"]),
        "minQuantity": min_quantity,
        "recommendedQuantity": recommended_quantity,
        "maxQuantity": max_quantity,
        "totalLoadQuantity": ordered_qty + recommended_quantity,
    }


def _serialize_order_item_with_spare_products(item: OrderItem, *, include_full_product: bool = True) -> dict[str, Any]:
    row = _serialize_model(item)
    product = getattr(item, "product", None)
    quantity_per_case = _int(getattr(product, "quantity_per_unit", 0), 0)
    snapshot_name = str(getattr(item, "product_name", "") or "").strip()
    snapshot_sku = str(getattr(item, "product_sku", "") or "").strip()
    snapshot_unit = _normalize_product_unit(getattr(item, "product_unit", None))
    product_size_label = _get_product_size_label(product) if product else ""
    product_sizes = list(getattr(product, "sizes", []) or []) if product else []
    row["quantityPerCase"] = quantity_per_case
    if include_full_product:
        if product:
            row["product"] = _serialize_model(product)
            row["product"]["quantityPerCase"] = quantity_per_case
            row["product"]["sizeLabel"] = product_size_label or None
            row["product"]["size"] = product_size_label or None
            row["product"]["sizes"] = product_sizes
        else:
            row["product"] = {
                "id": None,
                "sku": snapshot_sku or None,
                "name": snapshot_name or "Product",
                "unit": snapshot_unit,
                "quantityPerCase": 0,
                "sizeLabel": None,
                "size": None,
                "sizes": [],
                "isActive": False,
            }
    else:
        row["product"] = (
            {
                "id": product.id,
                "sku": product.sku,
                "name": product.name,
                "unit": _normalize_product_unit(product.unit),
                "quantityPerCase": quantity_per_case,
                "sizeLabel": product_size_label or None,
                "size": product_size_label or None,
                "sizes": product_sizes,
            }
            if product
            else {
                "id": None,
                "sku": snapshot_sku or None,
                "name": snapshot_name or "Product",
                "unit": snapshot_unit,
                "quantityPerCase": 0,
                "sizeLabel": None,
                "size": None,
                "sizes": [],
            }
        )
    row["spareProducts"] = _spare_product_quantities(item.quantity, getattr(product, "unit", None) or snapshot_unit)
    return row


def _allocate_driver_spare_products_for_loaded_order(order: Order, driver: User | None) -> None:
    if not driver:
        return

    for item in order.items.select_related("product").all():
        product = getattr(item, "product", None)
        if not product:
            continue
        spare_products = _spare_product_quantities(item.quantity, product.unit)
        recommended_qty = _int(spare_products.get("recommendedQuantity"), 0)
        if recommended_qty <= 0:
            continue
        if InventoryTransaction.objects.filter(
            driver=driver,
            product=product,
            reference_type=SPARE_PRODUCTS_REFERENCE_TYPE,
            reference_id=item.id,
        ).exists():
            continue

        allocation_policy = _extract_allocation_policy_from_notes(item.notes)
        spare_allocations = _allocate_inventory_for_spare_products(
            product=product,
            requested_qty=recommended_qty,
            order=order,
            order_item=item,
            warehouse_id=str(order.warehouse_id or "").strip() or None,
            allocation_policy=allocation_policy,
            performed_by=str(getattr(driver, "user_id", "") or "") or None,
        )
        allocated_qty = sum(max(0, _int(row.get("quantity"), 0)) for row in spare_allocations)
        if allocated_qty <= 0:
            logger.warning("Unable to allocate spare products for order %s item %s", order.id, item.id)
            continue

        stock, _ = DriverSpareStock.objects.get_or_create(
            driver=driver,
            product=product,
            defaults={"on_hand_quantity": 0, "minimum_required_quantity": 0},
        )
        stock.on_hand_quantity = _int(stock.on_hand_quantity, 0) + allocated_qty
        stock.minimum_required_quantity = max(_int(stock.minimum_required_quantity, 0), allocated_qty)
        stock.save(update_fields=["on_hand_quantity", "minimum_required_quantity", "updated_at"])

        InventoryTransaction.objects.create(
            driver=driver,
            product=product,
            type="IN",
            quantity=allocated_qty,
            reference_type=SPARE_PRODUCTS_REFERENCE_TYPE,
            reference_id=item.id,
            notes=(
                f"Auto-loaded spare products for {order.order_number}: "
                f"{allocated_qty} ({spare_products['recommendedPercent']}% of ordered qty {max(_int(item.quantity, 0), 0)}); "
                + "allocated "
                + ", ".join([f"{row['batchNumber']} x{row['quantity']}" for row in spare_allocations])
            ),
        )


def _allocate_inventory_for_spare_products(
    *,
    product: Product,
    requested_qty: int,
    order: Order,
    order_item: OrderItem,
    warehouse_id: str | None,
    allocation_policy: str,
    performed_by: str | None,
) -> list[dict[str, Any]]:
    if requested_qty <= 0:
        return []

    inventory_qs = Inventory.objects.select_related("warehouse").filter(product=product)
    if warehouse_id:
        inventory_qs = inventory_qs.filter(warehouse_id=warehouse_id)

    inventories = list(inventory_qs)
    if not inventories:
        return []

    inventory_by_id = {inv.id: inv for inv in inventories}
    batches = list(
        StockBatch.objects.select_related("inventory")
        .filter(inventory_id__in=list(inventory_by_id.keys()), quantity__gt=0)
    )
    if not batches:
        return []

    ordered_batches = _sorted_batches_for_policy(batches, allocation_policy)
    remaining = requested_qty
    allocation_rows: list[dict[str, Any]] = []

    for batch in ordered_batches:
        if remaining <= 0:
            break
        if batch.quantity <= 0:
            continue

        take_qty = min(batch.quantity, remaining)
        if take_qty <= 0:
            continue

        inventory = inventory_by_id.get(batch.inventory_id)
        if not inventory:
            continue

        batch.quantity -= take_qty
        _persist_stock_batch_quantity(batch)

        previous_qty = max(0, int(inventory.quantity or 0))
        inventory.quantity = max(0, previous_qty - take_qty)
        inventory.save(update_fields=["quantity", "updated_at"])
        _email_low_stock_if_needed(
            inventory=inventory,
            previous_qty=previous_qty,
            reason=f"Spare products auto-load for order {order.order_number}",
        )

        InventoryTransaction.objects.create(
            warehouse=inventory.warehouse,
            product=product,
            type="OUT",
            quantity=take_qty,
            reference_type=SPARE_PRODUCTS_REFERENCE_TYPE,
            reference_id=order_item.id,
            notes=f"Spare products loaded for {order.order_number}; batch {batch.batch_number}",
            performed_by=performed_by,
        )

        allocation_rows.append(
            {
                "batchNumber": batch.batch_number,
                "quantity": take_qty,
                "warehouseId": inventory.warehouse_id,
            }
        )
        remaining -= take_qty

    if remaining > 0:
        logger.warning(
            "Spare products partially allocated for order %s item %s: requested=%s allocated=%s",
            order.id,
            order_item.id,
            requested_qty,
            requested_qty - remaining,
        )

    return allocation_rows


def _return_unused_spare_products_for_delivered_order(
    *,
    order: Order,
    trip: Trip | None,
    performed_by: str | None,
) -> None:
    driver = getattr(trip, "driver", None)
    if not driver:
        return

    for order_item in order.items.select_related("product").all():
        product = getattr(order_item, "product", None)
        if not product:
            continue

        if InventoryTransaction.objects.filter(
            driver=driver,
            product=product,
            type="OUT",
            reference_type=SPARE_PRODUCTS_RETURN_REFERENCE_TYPE,
            reference_id=order_item.id,
        ).exists():
            continue

        loaded_qty = (
            InventoryTransaction.objects.filter(
                driver=driver,
                product=product,
                type="IN",
                reference_type=SPARE_PRODUCTS_REFERENCE_TYPE,
                reference_id=order_item.id,
            ).aggregate(total=Sum("quantity")).get("total")
            or 0
        )
        loaded_qty = max(0, _int(loaded_qty, 0))
        if loaded_qty <= 0:
            continue

        used_qty = (
            Replacement.objects.filter(
                order_id=order.id,
                original_order_item_id=order_item.id,
                replacement_product_id=product.id,
            ).aggregate(total=Sum("replacement_quantity")).get("total")
            or 0
        )
        used_qty = max(0, _int(used_qty, 0))
        unused_qty = max(0, loaded_qty - used_qty)
        if unused_qty <= 0:
            continue

        source_row = (
            InventoryTransaction.objects.filter(
                product=product,
                reference_type=SPARE_PRODUCTS_REFERENCE_TYPE,
                reference_id=order_item.id,
                type="OUT",
            )
            .order_by("-created_at")
            .values("warehouse_id")
            .first()
        )
        target_warehouse_id = str(order.warehouse_id or "").strip() or str((source_row or {}).get("warehouse_id") or "").strip()
        if not target_warehouse_id:
            continue

        inventory = Inventory.objects.select_related("warehouse").filter(warehouse_id=target_warehouse_id, product=product).first()
        if not inventory:
            warehouse = Warehouse.objects.filter(id=target_warehouse_id).first()
            if not warehouse:
                continue
            inventory = Inventory.objects.create(
                warehouse=warehouse,
                product=product,
                quantity=0,
                reserved_quantity=0,
                threshold=10,
            )

        driver_stock = DriverSpareStock.objects.filter(driver=driver, product=product).first()
        if not driver_stock:
            continue
        transferable_qty = min(unused_qty, max(0, _int(driver_stock.on_hand_quantity, 0)))
        if transferable_qty <= 0:
            continue

        with transaction.atomic():
            driver_stock.on_hand_quantity = max(0, _int(driver_stock.on_hand_quantity, 0) - transferable_qty)
            driver_stock.save(update_fields=["on_hand_quantity", "updated_at"])
            InventoryTransaction.objects.create(
                driver=driver,
                product=product,
                type="OUT",
                quantity=transferable_qty,
                reference_type=SPARE_PRODUCTS_RETURN_REFERENCE_TYPE,
                reference_id=order_item.id,
                notes=f"Unused spare products returned to inventory for {order.order_number}",
            )

            inventory.quantity = max(0, _int(inventory.quantity, 0) + transferable_qty)
            inventory.reserved_quantity = max(0, _int(inventory.reserved_quantity, 0) - transferable_qty)
            inventory.save(update_fields=["quantity", "reserved_quantity", "updated_at"])
            InventoryTransaction.objects.create(
                warehouse=inventory.warehouse,
                product=product,
                type="UNRESERVE",
                quantity=transferable_qty,
                reference_type=SPARE_PRODUCTS_RETURN_REFERENCE_TYPE,
                reference_id=order_item.id,
                notes=f"Unused spare products released back to batch for {order.order_number}",
                performed_by=performed_by,
            )

            # Return spare quantities back to the same inventory batches they were taken from.
            load_out_transactions = list(
                InventoryTransaction.objects.filter(
                    product=product,
                    reference_type=SPARE_PRODUCTS_REFERENCE_TYPE,
                    reference_id=order_item.id,
                    type="OUT",
                    warehouse=inventory.warehouse,
                ).order_by("-created_at")
            )

            batch_limits: list[tuple[str, int]] = []
            for tx in load_out_transactions:
                note = str(getattr(tx, "notes", "") or "")
                match = re.search(r"batch\s+([A-Za-z0-9\-]+)", note, re.IGNORECASE)
                if not match:
                    continue
                batch_number = str(match.group(1) or "").strip()
                if not batch_number:
                    continue
                tx_qty = max(0, _int(getattr(tx, "quantity", 0), 0))
                if tx_qty <= 0:
                    continue
                batch_limits.append((batch_number, tx_qty))

            remaining_to_restore = transferable_qty
            for batch_number, max_qty in batch_limits:
                if remaining_to_restore <= 0:
                    break
                stock_batch = StockBatch.objects.filter(batch_number=batch_number, inventory=inventory).first()
                if not stock_batch:
                    continue
                restore_qty = min(remaining_to_restore, max_qty)
                if restore_qty <= 0:
                    continue
                stock_batch.quantity = max(0, _int(stock_batch.quantity, 0) + restore_qty)
                stock_batch.status = "ACTIVE"
                stock_batch.save(update_fields=["quantity", "status", "updated_at"])
                remaining_to_restore -= restore_qty

            # Never create a new "SPARE-RET" batch. If there is remainder due to missing
            # source-batch linkage, place it in an existing batch of the same inventory.
            if remaining_to_restore > 0:
                fallback_batch = (
                    StockBatch.objects.filter(inventory=inventory)
                    .order_by("receipt_date", "created_at")
                    .first()
                )
                if fallback_batch:
                    fallback_batch.quantity = max(0, _int(fallback_batch.quantity, 0) + remaining_to_restore)
                    fallback_batch.status = "ACTIVE"
                    fallback_batch.save(update_fields=["quantity", "status", "updated_at"])
                else:
                    logger.warning(
                        "Unable to map %s returned spare qty to existing batch for order_item=%s warehouse=%s product=%s",
                        remaining_to_restore,
                        order_item.id,
                        inventory.warehouse_id,
                        product.id,
                    )


def _sorted_batches_for_policy(batches: list[StockBatch], policy: str) -> list[StockBatch]:
    if policy == "FIFO":
        return sorted(
            batches,
            key=lambda b: (
                b.receipt_date or timezone.now(),
                b.created_at or timezone.now(),
                b.id,
            ),
        )

    # FEFO: nearest expiry first; if expiry is missing, fall back after dated batches.
    return sorted(
        batches,
        key=lambda b: (
            b.expiry_date is None,
            b.expiry_date or b.receipt_date or timezone.now(),
            b.receipt_date or timezone.now(),
            b.created_at or timezone.now(),
            b.id,
        ),
    )


def _persist_stock_batch_quantity(batch: StockBatch) -> None:
    """
    Delete depleted stock batches so empty entries are removed from inventory views.
    """
    if _int(getattr(batch, "quantity", 0), 0) <= 0:
        batch.delete()
        return
    batch.status = "ACTIVE"
    batch.save(update_fields=["quantity", "status", "updated_at"])


def _extract_allocation_policy_from_notes(notes: Any) -> str:
    text = str(notes or "")
    marker = "AllocationPolicy="
    idx = text.rfind(marker)
    if idx < 0:
        return "FEFO"
    raw = text[idx + len(marker) :].splitlines()[0].strip()
    return _normalize_allocation_policy(raw)


def _reserve_inventory_for_order_item(
    *,
    product: Product,
    requested_qty: int,
    order: Order,
    order_item: OrderItem,
    warehouse_id: str | None,
    allocation_policy: str,
    performed_by: str | None,
) -> list[dict[str, Any]]:
    if requested_qty <= 0:
        raise ValueError(f"Quantity for product {product.sku} must be greater than zero")

    inventory_qs = Inventory.objects.select_related("warehouse").filter(product=product)
    if warehouse_id:
        inventory_qs = inventory_qs.filter(warehouse_id=warehouse_id)

    inventories = list(inventory_qs)
    if not inventories:
        raise ValueError(f"No inventory found for product {product.sku}")

    inventory_by_id = {inv.id: inv for inv in inventories}
    batches = list(
        StockBatch.objects.select_related("inventory")
        .filter(inventory_id__in=list(inventory_by_id.keys()), quantity__gt=0)
    )
    if not batches:
        raise ValueError(f"No available stock batches for product {product.sku}")

    ordered_batches = _sorted_batches_for_policy(batches, allocation_policy)
    remaining = requested_qty
    allocation_by_inventory: dict[str, int] = {}
    allocation_rows: list[dict[str, Any]] = []

    for batch in ordered_batches:
        if remaining <= 0:
            break
        if batch.quantity <= 0:
            continue

        take_qty = min(batch.quantity, remaining)
        if take_qty <= 0:
            continue

        inventory = inventory_by_id.get(batch.inventory_id)
        if not inventory:
            continue

        allocation_by_inventory[inventory.id] = allocation_by_inventory.get(inventory.id, 0) + take_qty
        allocation_rows.append(
            {
                "batchNumber": batch.batch_number,
                "quantity": take_qty,
                "warehouseId": inventory.warehouse_id,
            }
        )
        remaining -= take_qty

    if remaining > 0:
        raise ValueError(f"Insufficient stock for product {product.sku}. Missing quantity: {remaining}")

    for inventory_id, qty in allocation_by_inventory.items():
        inventory = inventory_by_id.get(inventory_id)
        if not inventory:
            continue
        inventory.reserved_quantity = max(0, int(inventory.reserved_quantity or 0) + qty)
        inventory.save(update_fields=["reserved_quantity", "updated_at"])
        InventoryTransaction.objects.create(
            warehouse=inventory.warehouse,
            product=product,
            type="RESERVE",
            quantity=qty,
            reference_type="order_item_reserve",
            reference_id=order_item.id,
            notes=f"{allocation_policy} reserve for order {order.order_number}",
            performed_by=performed_by,
        )

    return allocation_rows


def _select_best_warehouse_for_order_items(
    *,
    items: list[dict[str, Any]],
    shipping_latitude: Any,
    shipping_longitude: Any,
) -> str | None:
    requested_by_product: dict[str, int] = {}
    for item in items:
        product_id = str(item.get("productId") or "").strip()
        if not product_id:
            continue
        qty = _int(item.get("quantity"), 0)
        if qty <= 0:
            continue
        requested_by_product[product_id] = requested_by_product.get(product_id, 0) + qty

    if not requested_by_product:
        return None

    inventory_rows = list(
        Inventory.objects.select_related("warehouse")
        .filter(
            product_id__in=list(requested_by_product.keys()),
            warehouse__in=_real_warehouses(Warehouse.objects.all()),
        )
        .values(
            "warehouse_id",
            "product_id",
            "quantity",
            "reserved_quantity",
            "warehouse__latitude",
            "warehouse__longitude",
        )
    )
    if not inventory_rows:
        return None

    available_by_warehouse: dict[str, dict[str, int]] = {}
    warehouse_coords: dict[str, tuple[float | None, float | None]] = {}
    for row in inventory_rows:
        warehouse_id = str(row.get("warehouse_id") or "").strip()
        product_id = str(row.get("product_id") or "").strip()
        if not warehouse_id or not product_id:
            continue
        available_qty = max(0, _int(row.get("quantity"), 0) - _int(row.get("reserved_quantity"), 0))
        available_by_warehouse.setdefault(warehouse_id, {})
        available_by_warehouse[warehouse_id][product_id] = available_by_warehouse[warehouse_id].get(product_id, 0) + available_qty
        if warehouse_id not in warehouse_coords:
            warehouse_coords[warehouse_id] = (
                _to_float_or_none(row.get("warehouse__latitude")),
                _to_float_or_none(row.get("warehouse__longitude")),
            )

    candidate_warehouse_ids: list[str] = []
    for warehouse_id in sorted(available_by_warehouse.keys()):
        product_stock = available_by_warehouse.get(warehouse_id, {})
        can_fulfill_all = True
        for product_id, required_qty in requested_by_product.items():
            if product_stock.get(product_id, 0) < required_qty:
                can_fulfill_all = False
                break
        if can_fulfill_all:
            candidate_warehouse_ids.append(warehouse_id)

    if not candidate_warehouse_ids:
        return None

    ship_lat = _to_float_or_none(shipping_latitude)
    ship_lng = _to_float_or_none(shipping_longitude)
    if ship_lat is None or ship_lng is None:
        return candidate_warehouse_ids[0]

    best_with_distance: tuple[float, str] | None = None
    for warehouse_id in candidate_warehouse_ids:
        wh_lat, wh_lng = warehouse_coords.get(warehouse_id, (None, None))
        if wh_lat is None or wh_lng is None:
            continue
        distance_km = _haversine_km(ship_lat, ship_lng, wh_lat, wh_lng)
        if best_with_distance is None or distance_km < best_with_distance[0]:
            best_with_distance = (distance_km, warehouse_id)

    if best_with_distance is not None:
        return best_with_distance[1]
    return candidate_warehouse_ids[0]


def _adjust_reserved_for_order_item(
    *,
    order_item: OrderItem,
    operation: str,
    performed_by: str | None,
    consume_qty: int | None = None,
) -> None:
    reserve_rows = list(
        InventoryTransaction.objects.filter(
            reference_type="order_item_reserve",
            reference_id=order_item.id,
        ).values("warehouse_id", "product_id", "type", "quantity")
    )

    if not reserve_rows:
        return

    balances: dict[tuple[str, str], int] = {}
    for row in reserve_rows:
        key = (str(row.get("warehouse_id") or ""), str(row.get("product_id") or ""))
        if not key[0] or not key[1]:
            continue
        qty = _int(row.get("quantity"), 0)
        row_type = str(row.get("type") or "").upper()
        if row_type == "RESERVE":
            balances[key] = balances.get(key, 0) + qty
        elif row_type in {"UNRESERVE", "RESERVE_CONSUMED"}:
            balances[key] = balances.get(key, 0) - qty

    if operation == "consume":
        remaining = max(0, int(consume_qty or 0))
        for (warehouse_id, product_id), balance in balances.items():
            if remaining <= 0:
                break
            if balance <= 0:
                continue
            qty = min(balance, remaining)
            inv = Inventory.objects.filter(warehouse_id=warehouse_id, product_id=product_id).first()
            if not inv:
                continue
            inv.reserved_quantity = max(0, int(inv.reserved_quantity or 0) - qty)
            inv.save(update_fields=["reserved_quantity", "updated_at"])
            InventoryTransaction.objects.create(
                warehouse=inv.warehouse,
                product=order_item.product,
                type="RESERVE_CONSUMED",
                quantity=qty,
                reference_type="order_item_reserve",
                reference_id=order_item.id,
                notes="Reserved quantity consumed on delivery",
                performed_by=performed_by,
            )
            remaining -= qty
        return

    # operation == "release"
    for (warehouse_id, product_id), balance in balances.items():
        if balance <= 0:
            continue
        inv = Inventory.objects.filter(warehouse_id=warehouse_id, product_id=product_id).first()
        if not inv:
            continue
        inv.reserved_quantity = max(0, int(inv.reserved_quantity or 0) - balance)
        inv.save(update_fields=["reserved_quantity", "updated_at"])
        InventoryTransaction.objects.create(
            warehouse=inv.warehouse,
            product=order_item.product,
            type="UNRESERVE",
            quantity=balance,
            reference_type="order_item_reserve",
            reference_id=order_item.id,
            notes="Reserved quantity released on cancellation",
            performed_by=performed_by,
        )


def _finalize_order_inventory_on_delivery(order: Order, performed_by: str | None) -> None:
    items = list(order.items.select_related("product").all())
    for order_item in items:
        policy = _extract_allocation_policy_from_notes(order_item.notes)
        allocations = _allocate_inventory_for_order_item(
            product=order_item.product,
            requested_qty=max(0, int(order_item.quantity or 0)),
            order=order,
            order_item=order_item,
            warehouse_id=str(order.warehouse_id or "").strip() or None,
            allocation_policy=policy,
            performed_by=performed_by,
        )
        _adjust_reserved_for_order_item(
            order_item=order_item,
            operation="consume",
            performed_by=performed_by,
            consume_qty=max(0, int(order_item.quantity or 0)),
        )
        allocation_note = f"Delivered allocation ({policy}): " + ", ".join(
            [f"{row['batchNumber']} x{row['quantity']}" for row in allocations]
        )
        order_item.notes = f"{order_item.notes or ''}\n{allocation_note}".strip()
        order_item.save(update_fields=["notes"])


def _release_order_reservations(order: Order, performed_by: str | None) -> None:
    items = list(order.items.select_related("product").all())
    for order_item in items:
        _adjust_reserved_for_order_item(
            order_item=order_item,
            operation="release",
            performed_by=performed_by,
        )


def _mark_order_delivered(order: Order, performed_by: str | None, delivered_at: datetime | None = None) -> None:
    if _normalize_order_status(order.status) == OrderStatus.DELIVERED:
        timeline, _ = OrderTimeline.objects.get_or_create(order=order)
        if not timeline.delivered_at:
            timeline.delivered_at = delivered_at or timezone.now()
            timeline.save(update_fields=["delivered_at", "updated_at"])
        return

    if _normalize_order_status(order.status) in {OrderStatus.CANCELLED, OrderStatus.REJECTED}:
        raise ValueError("Cancelled/rejected orders cannot be marked as delivered")

    _finalize_order_inventory_on_delivery(order, performed_by)
    _reconcile_replacement_bottle_remainder_on_delivery(order, performed_by)
    order.status = OrderStatus.DELIVERED
    order.save(update_fields=["status", "updated_at"])

    timeline, _ = OrderTimeline.objects.get_or_create(order=order)
    if not timeline.shipped_at:
        timeline.shipped_at = getattr(order, "warehouse_dispatched_at", None) or timezone.now()
    if not timeline.delivered_at:
        timeline.delivered_at = delivered_at or timezone.now()
    timeline.save(update_fields=["shipped_at", "delivered_at", "updated_at"])


def _reconcile_replacement_bottle_remainder_on_delivery(order: Order, performed_by: str | None) -> None:
    order_number = str(getattr(order, "order_number", "") or "").strip().upper()
    if not order_number.startswith("RPL-"):
        return
    scheduled = _get_scheduled_replacement_payload(order)
    if not scheduled:
        return
    if str(scheduled.get("unitMode") or "").strip().upper() != "BOTTLE":
        return
    if InventoryTransaction.objects.filter(
        reference_type="replacement_bottle_remainder",
        reference_id=order.id,
    ).exists():
        return

    order_items = list(order.items.select_related("product").all())
    if len(order_items) != 1:
        return
    order_item = order_items[0]
    product = getattr(order_item, "product", None)
    if not product:
        return
    product_unit = _normalize_product_unit(getattr(product, "unit", None))
    if product_unit == "bottle":
        return

    qty_per_case = max(1, _int(getattr(product, "quantity_per_unit", 0), 1))
    delivered_case_qty = max(0, _int(getattr(order_item, "quantity", 0), 0))
    delivered_bottle_equivalent = delivered_case_qty * qty_per_case
    expected_bottles = max(0, _int(scheduled.get("quantityToReplace"), 0))
    remainder_bottles = max(0, delivered_bottle_equivalent - expected_bottles)
    if remainder_bottles <= 0:
        return

    warehouse_id = str(getattr(order, "warehouse_id", "") or "").strip() or None
    inventory = Inventory.objects.filter(product=product, warehouse_id=warehouse_id).first() if warehouse_id else None
    if not inventory:
        inventory = Inventory.objects.filter(product=product).first()
    if not inventory:
        return

    inventory.loose_bottles = max(0, _int(getattr(inventory, "loose_bottles", 0), 0) + remainder_bottles)
    inventory.save(update_fields=["loose_bottles", "updated_at"])
    InventoryTransaction.objects.create(
        warehouse=getattr(inventory, "warehouse", None),
        product=product,
        type="IN",
        quantity=remainder_bottles,
        reference_type="replacement_bottle_remainder",
        reference_id=order.id,
        notes=(
            f"RPL bottle reconciliation for {order.order_number}: "
            f"expected {expected_bottles}, deducted {delivered_bottle_equivalent}, "
            f"returned remainder {remainder_bottles} as loose bottles"
        ),
        performed_by=performed_by,
    )


def _reconcile_delivered_order_from_completed_drop_point(order: Order, performed_by: str | None = None) -> bool:
    if _normalize_order_status(order.status) in {OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.REJECTED}:
        return False

    completed_drop_point = (
        TripDropPoint.objects.filter(order_id=order.id, status__in=["COMPLETED", "DELIVERED"])
        .order_by("-actual_departure", "-updated_at")
        .first()
    )
    if not completed_drop_point:
        return False

    _mark_order_delivered(order, performed_by, completed_drop_point.actual_departure or timezone.now())
    return True


def _allocate_inventory_for_order_item(
    *,
    product: Product,
    requested_qty: int,
    order: Order,
    order_item: OrderItem,
    warehouse_id: str | None,
    allocation_policy: str,
    performed_by: str | None,
) -> list[dict[str, Any]]:
    if requested_qty <= 0:
        raise ValueError(f"Quantity for product {product.sku} must be greater than zero")

    inventory_qs = Inventory.objects.select_related("warehouse").filter(product=product)
    if warehouse_id:
        inventory_qs = inventory_qs.filter(warehouse_id=warehouse_id)

    inventories = list(inventory_qs)
    if not inventories:
        raise ValueError(f"No inventory found for product {product.sku}")

    inventory_by_id = {inv.id: inv for inv in inventories}
    batches = list(
        StockBatch.objects.select_related("inventory")
        .filter(inventory_id__in=list(inventory_by_id.keys()), quantity__gt=0)
    )
    if not batches:
        raise ValueError(f"No available stock batches for product {product.sku}")

    ordered_batches = _sorted_batches_for_policy(batches, allocation_policy)
    remaining = requested_qty
    allocation_rows: list[dict[str, Any]] = []

    for batch in ordered_batches:
        if remaining <= 0:
            break
        if batch.quantity <= 0:
            continue

        take_qty = min(batch.quantity, remaining)
        if take_qty <= 0:
            continue

        inventory = inventory_by_id.get(batch.inventory_id)
        if not inventory:
            continue

        batch.quantity -= take_qty
        _persist_stock_batch_quantity(batch)

        previous_qty = max(0, int(inventory.quantity or 0))
        inventory.quantity = max(0, previous_qty - take_qty)
        inventory.save(update_fields=["quantity", "updated_at"])
        _email_low_stock_if_needed(
            inventory=inventory,
            previous_qty=previous_qty,
            reason=f"Order allocation for {order.order_number}",
        )

        InventoryTransaction.objects.create(
            warehouse=inventory.warehouse,
            product=product,
            type="OUT",
            quantity=take_qty,
            reference_type="order_item",
            reference_id=order_item.id,
            notes=f"{allocation_policy} allocation for order {order.order_number}; batch {batch.batch_number}",
            performed_by=performed_by,
        )

        allocation_rows.append(
            {
                "batchNumber": batch.batch_number,
                "quantity": take_qty,
                "warehouseId": inventory.warehouse_id,
            }
        )
        remaining -= take_qty

    if remaining > 0:
        raise ValueError(f"Insufficient stock for product {product.sku}. Missing quantity: {remaining}")

    return allocation_rows


OTP_EXPIRY_MINUTES = 10

EMAIL_VERIFICATION_TOKEN_HOURS = 1


def _normalize_email(value: Any) -> str:
    return str(value or "").strip().lower()


def _is_gmail_email(email: str) -> bool:
    return bool(email and email.endswith("@gmail.com") and "@" in email and email.count("@") == 1)


def _staff_email_conflict_message(email: str, role: str, exclude_user_id: str | None = None) -> str | None:
    normalized_email = _normalize_email(email)
    if not normalized_email:
        return None

    qs = User.objects.filter(email=normalized_email, role=str(role or "").strip())
    if exclude_user_id:
        qs = qs.exclude(id=exclude_user_id)
    if qs.exists():
        return "Email already exists for this role"
    return None


def _email_exists_for_account(email: str, account_type: str, role_id: str | None = None) -> bool:
    normalized_email = _normalize_email(email)
    if not normalized_email:
        return False
    if account_type == "customer":
        return Customer.objects.filter(email=normalized_email).exists()
    if account_type == "staff" and role_id:
        return User.objects.filter(email=normalized_email, role=role_id).exists()
    if account_type == "staff":
        return User.objects.filter(email=normalized_email).exists()
    return False


def _verify_google_token(credential: str) -> dict[str, Any]:
    client_id = getattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "")
    if not client_id:
        raise ValueError("Google OAuth is not configured")
    # Allow small server/client clock drift to avoid false "Token used too early" failures.
    return google_id_token.verify_oauth2_token(
        credential,
        google_requests.Request(),
        client_id,
        clock_skew_in_seconds=300,
    )


def _otp_mail_ready() -> bool:
    has_brevo = bool(getattr(settings, "BREVO_API_KEY", "") and getattr(settings, "OTP_FROM_EMAIL", ""))
    has_gmail = bool(getattr(settings, "OTP_GMAIL_USER", "") and getattr(settings, "OTP_GMAIL_APP_PASSWORD", ""))
    return bool(has_brevo or has_gmail)


def _send_via_brevo(*, subject: str, message: str, recipient: str) -> bool:
    api_key = str(getattr(settings, "BREVO_API_KEY", "") or "").strip()
    from_email = str(getattr(settings, "OTP_FROM_EMAIL", "") or "").strip()
    from_name = str(getattr(settings, "OTP_FROM_NAME", "Ann Ann's Beverages Trading") or "Ann Ann's Beverages Trading").strip()
    if not api_key or not from_email:
        return False

    response = requests.post(
        "https://api.brevo.com/v3/smtp/email",
        headers={
            "accept": "application/json",
            "content-type": "application/json",
            "api-key": api_key,
        },
        json={
            "sender": {"name": from_name, "email": from_email},
            "to": [{"email": recipient}],
            "subject": subject,
            "textContent": message,
        },
        timeout=20,
    )
    response.raise_for_status()
    return True


def _get_reset_account(account_type: str, email: str) -> User | Customer | None:
    if account_type == "staff":
        return User.objects.filter(email=email, is_active=True).first()
    if account_type == "customer":
        return Customer.objects.filter(email=email, is_active=True).first()
    return None


def _send_reset_otp_email(email: str, otp_code: str) -> None:
    subject = "Ann Ann's Beverages Trading - Password Reset OTP"
    message = (
        "Use this OTP to reset your account password.\n\n"
        f"OTP: {otp_code}\n"
        f"Expires in {OTP_EXPIRY_MINUTES} minutes.\n\n"
        "If you did not request this, you can ignore this email."
    )
    brevo_key = str(getattr(settings, "BREVO_API_KEY", "") or "").strip()
    if brevo_key:
        try:
            _send_via_brevo(subject=subject, message=message, recipient=email)
            return
        except Exception:
            logger.exception("Brevo OTP send failed for password reset; falling back to SMTP")
    send_mail(
        subject=subject,
        message=message,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[email],
        fail_silently=False,
    )


def _send_email_verification_otp(email: str, otp_code: str) -> None:
    subject = "Ann Ann's Beverages Trading - Email Verification Code"
    message = (
        "Use this code to verify that your Gmail address is active and can receive mail.\n\n"
        f"Verification code: {otp_code}\n"
        f"Expires in {OTP_EXPIRY_MINUTES} minutes.\n\n"
        "If you did not request this, you can ignore this email."
    )
    brevo_key = str(getattr(settings, "BREVO_API_KEY", "") or "").strip()
    if brevo_key:
        try:
            _send_via_brevo(subject=subject, message=message, recipient=email)
            return
        except Exception:
            logger.exception("Brevo OTP send failed for email verification; falling back to SMTP")
    send_mail(
        subject=subject,
        message=message,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[email],
        fail_silently=False,
    )


def _send_transactional_email(*, subject: str, message: str, recipients: list[str]) -> None:
    cleaned = [str(x or "").strip().lower() for x in recipients if str(x or "").strip()]
    if not cleaned:
        return
    try:
        brevo_key = str(getattr(settings, "BREVO_API_KEY", "") or "").strip()
        if brevo_key:
            for recipient in cleaned:
                try:
                    _send_via_brevo(subject=subject, message=message, recipient=recipient)
                except Exception:
                    logger.exception("Brevo transactional send failed for %s; falling back to SMTP", recipient)
                    send_mail(
                        subject=subject,
                        message=message,
                        from_email=settings.DEFAULT_FROM_EMAIL,
                        recipient_list=[recipient],
                        fail_silently=False,
                    )
            return

        send_mail(
            subject=subject,
            message=message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=cleaned,
            fail_silently=False,
        )
    except Exception:
        logger.exception("Failed to send transactional email: subject=%s recipients=%s", subject, cleaned)


def _warehouse_staff_emails() -> list[str]:
    rows = User.objects.filter(role=RoleType.WAREHOUSE_STAFF, is_active=True).values_list("email", flat=True)
    out: list[str] = []
    for email in rows:
        value = _normalize_email(email)
        if value:
            out.append(value)
    return sorted(set(out))


def _ops_staff_emails() -> list[str]:
    rows = User.objects.filter(
        role__in=[RoleType.SUPER_ADMIN, RoleType.ADMIN, RoleType.WAREHOUSE_STAFF],
        is_active=True,
    ).values_list("email", flat=True)
    out: list[str] = []
    for email in rows:
        value = _normalize_email(email)
        if value:
            out.append(value)
    return sorted(set(out))


def _get_product_size_label(product: Any) -> str:
    """Return a human-readable size string from a Product's sizes JSONField."""
    sizes = getattr(product, "sizes", None)
    if isinstance(sizes, list):
        parts = [str(s).strip() for s in sizes if str(s).strip()]
        if parts:
            return ", ".join(parts)
    return ""


def _email_new_order_to_warehouse_staff(order: Order) -> None:
    recipients = _warehouse_staff_emails()
    if not recipients:
        return
    customer_name = str(getattr(order.customer, "name", "") or "Customer").strip()
    order_items = list(order.items.select_related("product").all())
    item_lines: list[str] = []
    for item in order_items:
        product = getattr(item, "product", None)
        product_name = (
            str(getattr(product, "name", "") or "").strip()
            or str(getattr(item, "product_name", "") or "").strip()
            or "Product"
        )
        size_label = _get_product_size_label(product)
        display_name = f"{product_name} ({size_label})" if size_label else product_name
        quantity = _int(getattr(item, "quantity", 0), 0)
        unit_price = float(getattr(item, "unit_price", 0) or 0)
        line_total = float(getattr(item, "total_price", 0) or (quantity * unit_price))
        item_lines.append(f"- {display_name}: qty {quantity}, unit PHP {unit_price:.2f}, total PHP {line_total:.2f}")

    items_block = "\n".join(item_lines) if item_lines else "- No order items found"
    shipping_address_parts = [
        str(getattr(order, "shipping_address", "") or "").strip(),
        str(getattr(order, "shipping_city", "") or "").strip(),
        str(getattr(order, "shipping_province", "") or "").strip(),
    ]
    shipping_address = ", ".join([part for part in shipping_address_parts if part]) or "N/A"
    shipping_phone = str(getattr(order, "shipping_phone", "") or "").strip() or "N/A"
    subject = f"New order received: {order.order_number}"
    message = (
        f"A new order has been created.\n\n"
        f"Order Number: {order.order_number}\n"
        f"Customer: {customer_name}\n"
        f"Status: {order.status}\n"
        f"Total Amount: PHP {float(order.total_amount or 0):.2f}\n\n"
        f"Delivery Address: {shipping_address}\n"
        f"Customer Contact: {shipping_phone}\n\n"
        f"Ordered Products:\n"
        f"{items_block}\n"
    )
    _send_transactional_email(subject=subject, message=message, recipients=recipients)


def _email_new_staff_credentials(user: User, plain_password: str) -> None:
    recipient = _normalize_email(getattr(user, "email", ""))
    if not recipient:
        return
    role_value = str(getattr(user, "role", "") or "").strip().upper()
    if role_value not in {RoleType.WAREHOUSE_STAFF, RoleType.DRIVER}:
        return
    if not _is_gmail_email(recipient):
        return
    role_label = str(getattr(user, "role", "") or "STAFF").replace("_", " ").title()
    subject = "Your account has been created"
    message = (
        f"Hello {str(getattr(user, 'name', '') or 'User').strip()},\n\n"
        f"An administrator created your {role_label} account.\n\n"
        f"Login Email: {recipient}\n"
        f"Temporary Password: {plain_password}\n\n"
        f"Please log in and change your password immediately."
    )
    _send_transactional_email(subject=subject, message=message, recipients=[recipient])


def _email_order_out_for_delivery_to_customer(order: Order) -> None:
    customer_email = _normalize_email(getattr(order.customer, "email", ""))
    if not customer_email:
        return
    customer_name = str(getattr(order.customer, "name", "") or "Customer").strip()
    order_items = list(order.items.select_related("product").all())
    item_lines: list[str] = []
    for item in order_items:
        product_name = (
            str(getattr(getattr(item, "product", None), "name", "") or "").strip()
            or str(getattr(item, "product_name", "") or "").strip()
            or "Product"
        )
        quantity = max(0, _int(getattr(item, "quantity", 0), 0))
        unit_price = float(getattr(item, "unit_price", 0) or 0)
        line_total = float(getattr(item, "total_price", 0) or (quantity * unit_price))
        size_label = _get_product_size_label(getattr(item, "product", None))
        display_name = f"{product_name} ({size_label})" if size_label else product_name
        item_lines.append(f"- {display_name}: qty {quantity}, subtotal PHP {line_total:.2f}")

    products_text = "\n".join(item_lines) if item_lines else "- No product details available"
    total_amount = float(getattr(order, "total_amount", 0) or 0)

    assigned_driver_name = "To be assigned"
    assigned_driver_phone = "Not available"
    linked_drop_point = (
        TripDropPoint.objects.select_related("trip__driver")
        .filter(order_id=order.id)
        .order_by("-created_at")
        .first()
    )
    if linked_drop_point and getattr(linked_drop_point, "trip", None) and getattr(linked_drop_point.trip, "driver", None):
        driver = linked_drop_point.trip.driver
        assigned_driver_name = str(getattr(driver, "name", "") or "").strip() or assigned_driver_name
        assigned_driver_phone = str(getattr(driver, "phone", "") or "").strip() or assigned_driver_phone

    subject = f"Your order is out for delivery: {order.order_number}"
    message = (
        f"Hi {customer_name},\n\n"
        f"Good news. Your order is now out for delivery.\n\n"
        f"Order Number: {order.order_number}\n"
        f"Products:\n{products_text}\n"
        f"Total Price: PHP {total_amount:.2f}\n\n"
        f"Assigned Driver: {assigned_driver_name}\n"
        f"Contact Info: {assigned_driver_phone}\n\n"
        f"Please prepare the payment amount and be ready to receive your order.\n\n"
        f"Thank you for ordering with us."
    )
    _send_transactional_email(subject=subject, message=message, recipients=[customer_email])


def _email_order_confirmed_to_customer(order: Order) -> None:
    customer_email = _normalize_email(getattr(order.customer, "email", ""))
    if not customer_email:
        return
    customer_name = str(getattr(order.customer, "name", "") or "Customer").strip()
    order_items = list(order.items.select_related("product").all())
    item_lines: list[str] = []
    for item in order_items:
        product = getattr(item, "product", None)
        product_name = (
            str(getattr(product, "name", "") or "").strip()
            or str(getattr(item, "product_name", "") or "").strip()
            or "Product"
        )
        size_label = _get_product_size_label(product)
        display_name = f"{product_name} ({size_label})" if size_label else product_name
        quantity = max(0, _int(getattr(item, "quantity", 0), 0))
        line_total = float(getattr(item, "total_price", 0) or 0)
        item_lines.append(f"- {display_name}: qty {quantity}, subtotal PHP {line_total:.2f}")
    products_text = "\n".join(item_lines) if item_lines else "- No product details available"

    shipping_address_parts = [
        str(getattr(order, "shipping_address", "") or "").strip(),
        str(getattr(order, "shipping_city", "") or "").strip(),
        str(getattr(order, "shipping_province", "") or "").strip(),
    ]
    shipping_address = ", ".join([part for part in shipping_address_parts if part]) or "N/A"
    total_amount = float(getattr(order, "total_amount", 0) or 0)

    subject = f"Your order is confirmed: {order.order_number}"
    message = (
        f"Hi {customer_name},\n\n"
        f"Your order has been confirmed by our warehouse team.\n\n"
        f"Order Number: {order.order_number}\n"
        f"Products:\n{products_text}\n"
        f"Total Price: PHP {total_amount:.2f}\n"
        f"Delivery Address: {shipping_address}\n\n"
        f"We are now preparing your order for dispatch.\n\n"
        f"Thank you for ordering with us."
    )
    _send_transactional_email(subject=subject, message=message, recipients=[customer_email])


def _email_order_rejected_to_customer(order: Order, rejection_reason: str) -> None:
    customer_email = _normalize_email(getattr(order.customer, "email", ""))
    if not customer_email:
        return

    item_lines: list[str] = []
    order_items = list(order.items.select_related("product").all()) if hasattr(order, "items") else []
    for item in order_items:
        product = getattr(item, "product", None)
        product_name = str(getattr(product, "name", "") or "Product").strip() or "Product"
        size_label = _get_product_size_label(product)
        display_name = f"{product_name} ({size_label})" if size_label else product_name
        quantity = int(getattr(item, "quantity", 0) or 0)
        unit_price = float(getattr(item, "unit_price", 0) or 0)
        subtotal = float(quantity * unit_price)
        item_lines.append(f"- {display_name} x{quantity} ({subtotal:,.2f})")

    subject = f"Order Rejected: {order.order_number}"
    message = (
        f"Your order request has been rejected.\n\n"
        f"Order Number: {order.order_number}\n"
        f"Customer: {getattr(order, 'shipping_name', '') or getattr(getattr(order, 'customer', None), 'name', '') or 'N/A'}\n"
        f"Reason: {rejection_reason or 'No reason provided'}\n\n"
        f"Order Details:\n"
        f"{chr(10).join(item_lines) if item_lines else '- No items found'}\n\n"
        f"Total Amount: {float(getattr(order, 'total_amount', 0) or 0):,.2f}\n"
        f"Date: {timezone.localtime(getattr(order, 'created_at', timezone.now())).strftime('%Y-%m-%d %I:%M %p')}\n\n"
        f"If you need help, please contact support."
    )
    _send_transactional_email(subject=subject, message=message, recipients=[customer_email])


def _email_low_stock_if_needed(*, inventory: Inventory, previous_qty: int, reason: str) -> None:
    current_qty = max(0, _int(getattr(inventory, "quantity", 0), 0))
    threshold = max(0, _int(getattr(inventory, "threshold", 0), 0))
    if threshold <= 0:
        return
    if previous_qty <= threshold or current_qty > threshold:
        return

    recipients = _warehouse_staff_emails()
    if not recipients:
        return
    warehouse_name = str(getattr(getattr(inventory, "warehouse", None), "name", "") or "Warehouse").strip()
    product = getattr(inventory, "product", None)
    product_name = str(getattr(product, "name", "") or "Product").strip()
    sku = str(getattr(product, "sku", "") or "").strip()
    size_label = _get_product_size_label(product)
    size_text = f" [{size_label}]" if size_label else ""
    sku_text = f" ({sku})" if sku else ""
    subject = f"Low stock alert: {product_name}{size_text}{sku_text}"
    message = (
        f"Stock level needs restocking.\n\n"
        f"Warehouse: {warehouse_name}\n"
        f"Product: {product_name}{size_text}{sku_text}\n"
        f"Current Quantity: {current_qty}\n"
        f"Threshold: {threshold}\n"
        f"Trigger: {reason}\n"
    )
    _send_transactional_email(subject=subject, message=message, recipients=recipients)


def _is_inventory_overstocked_for_restock_block(inventory: Inventory) -> bool:
    """
    Overstock guard for stock-in:
    - available >= threshold * 3
    - condition has persisted for at least 7 days
    """
    threshold = max(0, _int(getattr(inventory, "threshold", 0), 0))
    if threshold <= 0:
        return False
    available = max(
        0,
        _int(getattr(inventory, "quantity", 0), 0) - _int(getattr(inventory, "reserved_quantity", 0), 0),
    )
    if available < (threshold * 3):
        return False

    reference_ts = (
        getattr(inventory, "last_restocked_at", None)
        or getattr(inventory, "updated_at", None)
        or getattr(inventory, "created_at", None)
    )
    if not reference_ts:
        return False

    try:
        sustained_until = reference_ts + timedelta(days=7)
    except Exception:
        return False
    return timezone.now() >= sustained_until


def _otp_secret() -> str:
    return str(getattr(settings, "OTP_SECRET_KEY", "") or settings.SECRET_KEY or "otp-fallback-secret")


def _otp_bucket(value: datetime) -> int:
    timestamp = int(value.timestamp())
    return timestamp // 60


def _stateless_otp_for_bucket(email: str, account_type: str, purpose: str, bucket: int) -> str:
    payload = f"{email}|{account_type}|{purpose}|{bucket}"
    digest = hmac.new(_otp_secret().encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{int(digest[:12], 16) % 1000000:06d}"


def _is_valid_stateless_otp(otp_code: str, email: str, account_type: str, purpose: str, now: datetime | None = None) -> bool:
    candidate = str(otp_code or "").strip()
    if not candidate:
        return False
    current = now or timezone.now()
    for minute_offset in range(0, OTP_EXPIRY_MINUTES + 1):
        bucket = _otp_bucket(current - timedelta(minutes=minute_offset))
        expected = _stateless_otp_for_bucket(email, account_type, purpose, bucket)
        if hmac.compare_digest(candidate, expected):
            return True
    return False


def _issue_email_verification_token(email: str, account_type: str) -> str:
    return create_token(
        {
            "type": "email_verification",
            "email": email,
            "accountType": account_type,
        },
        exp_hours=EMAIL_VERIFICATION_TOKEN_HOURS,
    )


def _is_email_verification_token_valid(token: str, email: str, account_type: str) -> bool:
    payload = decode_token(str(token or "").strip())
    if not payload:
        return False
    if str(payload.get("type") or "") != "email_verification":
        return False
    token_email = _normalize_email(payload.get("email"))
    token_account_type = str(payload.get("accountType") or "").strip().lower()
    return token_email == email and token_account_type == account_type


@csrf_exempt
@require_http_methods(["POST"])
def auth_email_verification_request(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    email = _normalize_email(body.get("email"))
    account_type = str(body.get("accountType", "staff")).strip().lower()
    role_id = str(body.get("roleId", "")).strip() or None

    if not email:
        return _err("Email is required")
    if not _is_gmail_email(email):
        return _err("Only Gmail addresses are allowed")
    if account_type not in {"staff", "customer"}:
        return _err("accountType must be 'staff' or 'customer'")
    if account_type == "staff":
        if not role_id:
            return _err("Role is required before verifying a staff email")
        if role_id not in {x for x, _ in RoleType.choices}:
            return _err("Role not found", 404)
    if _email_exists_for_account(email, account_type, role_id):
        return _err("Email already exists for this account type", 409)
    if not _otp_mail_ready():
        return _err("Verification email service is not configured", 500)

    now = timezone.now()
    code = _stateless_otp_for_bucket(email, account_type, "email_verification", _otp_bucket(now))
    try:
        _send_email_verification_otp(email, code)
    except Exception:
        logger.exception("Failed to send email verification OTP to %s", email)
        return _err("Unable to send verification email right now", 500)

    return _ok({"success": True, "message": "Verification code sent."})


@csrf_exempt
@require_http_methods(["POST"])
def auth_email_verification_request_existing(request: HttpRequest) -> JsonResponse:
    """Send OTP to an email that already belongs to the authenticated staff user (old-email confirmation)."""
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    if p.get("type") != "staff":
        return _err("Forbidden", 403)

    body = _json_body(request)
    email = _normalize_email(body.get("email"))
    account_type = "staff"

    if not email:
        return _err("Email is required")
    if not _is_gmail_email(email):
        return _err("Only Gmail addresses are allowed")

    # Must match the authenticated user's current email
    current_email = _normalize_email(p.get("email"))
    if email != current_email:
        return _err("Email does not match your current account email", 400)

    if not _otp_mail_ready():
        return _err("Verification email service is not configured", 500)

    now = timezone.now()
    code = _stateless_otp_for_bucket(email, account_type, "old_email_confirm", _otp_bucket(now))
    try:
        _send_email_verification_otp(email, code)
    except Exception:
        logger.exception("Failed to send old-email confirmation OTP to %s", email)
        return _err("Unable to send verification email right now", 500)

    return _ok({"success": True, "message": "Verification code sent to your current email."})


@csrf_exempt
@require_http_methods(["POST"])
def auth_email_verification_confirm_existing(request: HttpRequest) -> JsonResponse:
    """Verify OTP sent to the old (current) email before allowing a new-email change."""
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    if p.get("type") != "staff":
        return _err("Forbidden", 403)

    body = _json_body(request)
    email = _normalize_email(body.get("email"))
    otp_code = str(body.get("otp", "")).strip()
    account_type = "staff"

    if not email:
        return _err("Email is required")
    if not _is_gmail_email(email):
        return _err("Only Gmail addresses are allowed")
    if not otp_code:
        return _err("Verification code is required")

    current_email = _normalize_email(p.get("email"))
    if email != current_email:
        return _err("Email does not match your current account email", 400)

    now = timezone.now()
    if not _is_valid_stateless_otp(otp_code, email, account_type, "old_email_confirm", now):
        return _err("Invalid or expired verification code", 400)

    verification_token = _issue_email_verification_token(email + ":old_confirmed", account_type)
    return _ok({"success": True, "message": "Old email verified", "verificationToken": verification_token})


@csrf_exempt
@require_http_methods(["POST"])
def auth_email_verification_confirm(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    email = _normalize_email(body.get("email"))
    account_type = str(body.get("accountType", "staff")).strip().lower()
    otp_code = str(body.get("otp", "")).strip()

    if not email:
        return _err("Email is required")
    if not _is_gmail_email(email):
        return _err("Only Gmail addresses are allowed")
    if account_type not in {"staff", "customer"}:
        return _err("accountType must be 'staff' or 'customer'")
    if not otp_code:
        return _err("Verification code is required")

    now = timezone.now()
    if not _is_valid_stateless_otp(otp_code, email, account_type, "email_verification", now):
        return _err("Invalid or expired verification code", 400)
    verification_token = _issue_email_verification_token(email, account_type)
    return _ok({"success": True, "message": "Email verified successfully", "verificationToken": verification_token})


@require_GET
def api_root(_request: HttpRequest) -> JsonResponse:
    return _ok({"success": True, "message": "Django Logistics API", "version": "1.0"})


@require_GET
def health(_request: HttpRequest) -> JsonResponse:
    return _ok({"success": True, "service": "django-backend", "status": "ok"})


@csrf_exempt
@require_http_methods(["POST"])
def auth_login(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    email = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", ""))
    portal = str(body.get("portal", "")).strip().lower()
    remember_me = bool(body.get("rememberMe", False))
    if not email or not password:
        return _err("Email and password are required")
    role_scope = {
        "admin": {"SUPER_ADMIN", "ADMIN"},
        "driver": {"DRIVER"},
        "warehouse": {"WAREHOUSE_STAFF"},
    }.get(portal)
    users_qs = User.objects.filter(email=email)
    if role_scope:
        users_qs = users_qs.filter(role__in=role_scope)
    user = users_qs.first()
    if not user:
        return _err("Invalid email or password", 401)
    if not user.is_active or not verify_password(password, user.password):
        return _err("Invalid email or password", 401)
    user.last_login_at = timezone.now()
    user.save(update_fields=["last_login_at", "updated_at"])
    payload = _user_payload(user)
    token = create_token(payload, 24 * 30 if remember_me else 24)
    resp = _ok({"success": True, "user": payload, "token": token, "message": "Login successful"})
    _set_auth_cookie(resp, token, remember_me)
    return resp


@csrf_exempt
@require_http_methods(["POST"])
def auth_customer_login(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    email = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", ""))
    remember_me = bool(body.get("rememberMe", False))
    if not email or not password:
        return _err("Email and password are required")
    try:
        customer = Customer.objects.get(email=email)
    except Customer.DoesNotExist:
        return _err("Invalid email or password", 401)
    if not customer.is_active or not verify_password(password, customer.password):
        return _err("Invalid email or password", 401)
    payload = _customer_payload(customer)
    token = create_token(payload, 24 * 30 if remember_me else 24)
    resp = _ok({"success": True, "user": payload, "token": token, "message": "Login successful"})
    _set_auth_cookie(resp, token, remember_me)
    return resp


@csrf_exempt
@require_http_methods(["POST"])
def auth_customer_google(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    credential = str(body.get("credential") or body.get("idToken") or "").strip()
    remember_me = bool(body.get("rememberMe", False))
    if not credential:
        return _err("Google credential is required")

    if not getattr(settings, "GOOGLE_OAUTH_CLIENT_ID", ""):
        return _err("Google OAuth is not configured on the server", 500)

    try:
        claims = _verify_google_token(credential)
    except ValueError as exc:
        logger.warning("Invalid Google credential during customer auth: %s", str(exc))
        return _err(f"Invalid Google credential: {str(exc)}", 401)
    except Exception:
        logger.exception("Google customer token verification failed")
        return _err("Google authentication service is temporarily unavailable", 503)

    email = _normalize_email(claims.get("email"))
    if not email:
        return _err("Google account email is unavailable")
    if not bool(claims.get("email_verified")):
        return _err("Google email is not verified", 401)
    if not _is_gmail_email(email):
        return _err("Only Gmail addresses are allowed (example@gmail.com)")

    name = str(claims.get("name") or "").strip() or email.split("@")[0]
    avatar = str(claims.get("picture") or "").strip() or None

    with transaction.atomic():
        customer = Customer.objects.filter(email=email).first()
        created = False

        if customer and not customer.is_active:
            return _err("Account is deactivated", 403)

        if not customer:
            customer = Customer.objects.create(
                email=email,
                password=hash_password(secrets.token_urlsafe(32)),
                name=name,
                avatar=avatar,
            )
            created = True
        else:
            changed_fields: list[str] = []
            if avatar and customer.avatar != avatar:
                customer.avatar = avatar
                changed_fields.append("avatar")
            if changed_fields:
                changed_fields.append("updated_at")
                customer.save(update_fields=changed_fields)

    payload = _customer_payload(customer)
    token = create_token(payload, 24 * 30 if remember_me else 24)
    resp = _ok(
        {
            "success": True,
            "user": payload,
            "token": token,
            "message": "Registration successful" if created else "Login successful",
            "created": created,
        },
        201 if created else 200,
    )
    _set_auth_cookie(resp, token, remember_me)
    return resp


@csrf_exempt
@require_http_methods(["POST"])
def auth_staff_google(request: HttpRequest) -> JsonResponse:
    return _err("Google sign-in is disabled for warehouse staff and drivers", 403)


@csrf_exempt
@require_http_methods(["POST"])
def auth_register(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    name = str(body.get("name", "")).strip()
    email = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", ""))
    email_verification_token = str(body.get("emailVerificationToken", "")).strip()
    if not name or not email or not password:
        return _err("Name, email and password are required")
    password_error = _validate_password_strength(password)
    if password_error:
        return _err(password_error)
    if not _is_gmail_email(email):
        return _err("Only Gmail addresses are allowed (example@gmail.com)")
    if Customer.objects.filter(email=email).exists():
        return _err("Email is already registered", 409)
    if not _is_email_verification_token_valid(email_verification_token, email, "customer"):
        return _err("Please verify your email address before registration", 400)
    address_error = _ensure_negros_occidental_address(
        latitude=body.get("latitude"),
        longitude=body.get("longitude"),
        city=body.get("city"),
        province=body.get("province"),
        require_coordinates=False,
    )
    if address_error:
        return _err(address_error, 400)
    customer = Customer.objects.create(
        email=email,
        password=hash_password(password),
        name=name,
        phone=body.get("phone"),
        address=body.get("address"),
        city=body.get("city"),
        province=body.get("province"),
        zip_code=body.get("zipCode"),
        latitude=body.get("latitude"),
        longitude=body.get("longitude"),
    )
    payload = _customer_payload(customer)
    token = create_token(payload)
    resp = _ok({"success": True, "user": payload, "token": token, "message": "Registration successful"}, 201)
    _set_auth_cookie(resp, token)
    return resp


@require_GET
def auth_me(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    if p.get("type") == "staff" and not User.objects.filter(id=p.get("userId"), is_active=True).exists():
        return _err("Unauthorized", 401)
    if p.get("type") == "customer" and not Customer.objects.filter(id=p.get("userId"), is_active=True).exists():
        return _err("Unauthorized", 401)
    return _ok({"success": True, "user": p})


@csrf_exempt
@require_http_methods(["POST"])
def auth_logout(_request: HttpRequest) -> JsonResponse:
    resp = _ok({"success": True, "message": "Logout successful"})
    resp.delete_cookie(TOKEN_NAME, path="/")
    return resp


@csrf_exempt
@require_http_methods(["POST"])
def auth_password_reset_request_otp(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    email = _normalize_email(body.get("email"))
    account_type = str(body.get("accountType", "")).strip().lower()

    if not email:
        return _err("Email is required")
    try:
        validate_email(email)
    except ValidationError:
        return _err("Please enter a valid email address")
    if account_type not in {"staff", "customer"}:
        return _err("accountType must be 'staff' or 'customer'")
    if not _otp_mail_ready():
        return _err("OTP email service is not configured", 500)

    account = _get_reset_account(account_type, email)
    if not account:
        return _err("Not registered", 404)

    now = timezone.now()
    code = _stateless_otp_for_bucket(email, account_type, "password_reset", _otp_bucket(now))
    try:
        _send_reset_otp_email(email, code)
    except Exception:
        logger.exception("Failed to send password reset OTP to %s", email)
        return _err("Unable to send OTP email right now", 500)

    return _ok({"success": True, "message": "OTP sent successfully."})


@csrf_exempt
@require_http_methods(["POST"])
def auth_password_reset_reset(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    email = _normalize_email(body.get("email"))
    account_type = str(body.get("accountType", "")).strip().lower()
    otp_code = str(body.get("otp", "")).strip()
    new_password = str(body.get("newPassword", "")).strip()

    if not email:
        return _err("Email is required")
    if account_type not in {"staff", "customer"}:
        return _err("accountType must be 'staff' or 'customer'")
    if not otp_code:
        return _err("OTP is required")
    password_error = _validate_password_strength(new_password)
    if password_error:
        return _err(password_error)

    now = timezone.now()
    if not _is_valid_stateless_otp(otp_code, email, account_type, "password_reset", now):
        return _err("Invalid or expired OTP", 400)

    if account_type == "staff":
        account = User.objects.filter(email=email, is_active=True).first()
    else:
        account = Customer.objects.filter(email=email, is_active=True).first()
    if not account:
        return _err("Not registered", 404)

    account.password = hash_password(new_password)
    account.save(update_fields=["password", "updated_at"])

    return _ok({"success": True, "message": "Password reset successful. Please log in."})


@require_GET
def roles_list(request: HttpRequest) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    roles = [{"id": value, "name": value, "description": label} for value, label in RoleType.choices]
    return _ok({"success": True, "roles": roles})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def users_collection(request: HttpRequest) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = User.objects.all().order_by("-created_at")
        s = str(request.GET.get("search", "")).strip()
        if s:
            qs = qs.filter(Q(name__icontains=s) | Q(email__icontains=s))
        total = qs.count()
        rows = list(qs[off : off + size])
        users = [_serialize_model(u, exclude={"password"}) for u in rows]
        return _ok({"success": True, "users": users, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})

    body = _json_body(request)
    email = str(body.get("email", "")).strip().lower()
    name = str(body.get("name", "")).strip()
    password = str(body.get("password", "")).strip()
    role_id = str(body.get("roleId", "")).strip()
    email_verification_token = str(body.get("emailVerificationToken", "")).strip()
    if not email or not name or not password or not role_id:
        return _err("name, email, password and roleId are required")
    password_error = _validate_password_strength(password)
    if password_error:
        return _err(password_error)
    if not _is_gmail_email(email):
        return _err("Only Gmail addresses are allowed for staff/driver accounts")
    if role_id not in {x for x, _ in RoleType.choices}:
        return _err("Role not found", 404)
    role = role_id
    existing_message = _staff_email_conflict_message(email, role_id)
    if existing_message:
        return _err(existing_message, 409)
    if not _is_email_verification_token_valid(email_verification_token, email, "staff"):
        return _err("Please verify this Gmail address before creating the user", 400)
    user = User.objects.create(
        email=email,
        password=hash_password(password),
        name=name,
        phone=body.get("phone"),
        avatar=body.get("avatar"),
        role=role,
        is_active=bool(body.get("isActive", True)),
    )
    warnings: list[str] = []
    try:
        _email_new_staff_credentials(user, password)
    except Exception:
        logger.exception("Failed to send new staff credentials email for user=%s", user.id)
        warnings.append("credentials_email_failed")
    actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
    try:
        _create_staff_notifications(
            title="User added",
            message=f"{actor_name} added user {user.name} ({user.email}) with role {user.role}.",
            notification_type="USER",
            reference_type="user",
            reference_id=user.id,
        )
    except Exception:
        logger.exception("Failed to create staff notifications for new user=%s", user.id)
        warnings.append("staff_notification_failed")
    payload: dict[str, Any] = {"success": True, "user": _serialize_model(user, exclude={"password"})}
    if warnings:
        payload["warnings"] = warnings
    return _ok(payload, 201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
def user_detail(request: HttpRequest, user_id: str) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return _err("User not found", 404)
    if request.method == "GET":
        return _ok({"success": True, "user": _serialize_model(user, exclude={"password"})})
    if request.method == "DELETE":
        actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
        deleted_name = str(user.name or "User").strip() or "User"
        deleted_email = str(user.email or "").strip()
        user.delete()
        _create_staff_notifications(
            title="User deleted",
            message=f"{actor_name} deleted user {deleted_name}{f' ({deleted_email})' if deleted_email else ''}.",
            notification_type="USER",
            reference_type="user",
            reference_id=user_id,
        )
        return _ok({"success": True})
    body = _json_body(request)
    current_email = str(user.email or "").strip().lower()
    requested_email_raw = body.get("email", None)
    requested_email = current_email
    email_change_requested = False
    if requested_email_raw is not None:
        requested_email = str(requested_email_raw).strip().lower()
        email_change_requested = requested_email != current_email

    password_change_requested = bool(body.get("password"))
    if email_change_requested or password_change_requested:
        email_verification_token = str(body.get("emailVerificationToken", "")).strip()
        old_email_verification_token = str(body.get("oldEmailVerificationToken", "")).strip()
        verification_email = requested_email if email_change_requested else current_email
        if email_change_requested:
            # Require old-email confirmation token first
            if not _is_email_verification_token_valid(old_email_verification_token, current_email + ":old_confirmed", "staff"):
                return _err("Please verify your current (old) email address first", 400)
            # Then require new-email verification token
            if not _is_email_verification_token_valid(email_verification_token, requested_email, "staff"):
                return _err("Please verify your new email address before saving", 400)
        else:
            if not _is_email_verification_token_valid(email_verification_token, verification_email, "staff"):
                return _err("Please verify OTP before changing email or password", 400)

    for key, attr in [("name", "name"), ("phone", "phone"), ("avatar", "avatar")]:
        if key in body:
            setattr(user, attr, body.get(key))
    if "email" in body:
        next_email = requested_email
        if not next_email:
            return _err("Email is required")
        if next_email != current_email and not _is_gmail_email(next_email):
            return _err("Only Gmail addresses are allowed for staff/driver accounts")
        user.email = next_email
    if "isActive" in body:
        user.is_active = bool(body.get("isActive"))
    if body.get("password"):
        password_error = _validate_password_strength(str(body["password"]))
        if password_error:
            return _err(password_error)
        user.password = hash_password(str(body["password"]))
    if body.get("roleId"):
        role_value = str(body["roleId"])
        if role_value not in {x for x, _ in RoleType.choices}:
            return _err("Role not found", 404)
        user.role = role_value
    existing_message = _staff_email_conflict_message(user.email, user.role, exclude_user_id=user.id)
    if existing_message:
        return _err(existing_message, 409)
    user.save()
    return _ok({"success": True, "user": _serialize_model(user, exclude={"password"})})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def customers_collection(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = _real_customers(Customer.objects.all()).order_by("-created_at")
        s = str(request.GET.get("search", "")).strip()
        if s:
            qs = qs.filter(Q(name__icontains=s) | Q(email__icontains=s) | Q(phone__icontains=s))
        total = qs.count()
        rows = list(qs[off : off + size])
        return _ok({"success": True, "customers": [_serialize_model(c, exclude={"password"}) for c in rows], "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    _, err = _require_staff(request)
    if err:
        return err
    body = _json_body(request)
    email = str(body.get("email", "")).strip().lower()
    name = str(body.get("name", "")).strip()
    password = str(body.get("password", "")).strip()
    if not email or not name or not password:
        return _err("name, email and password are required")
    password_error = _validate_password_strength(password)
    if password_error:
        return _err(password_error)
    if not _is_gmail_email(email):
        return _err("Only Gmail addresses are allowed for customer accounts")
    if Customer.objects.filter(email=email).exists():
        return _err("Email already exists for customer accounts", 409)
    address_error = _ensure_negros_occidental_address(
        latitude=body.get("latitude"),
        longitude=body.get("longitude"),
        city=body.get("city"),
        province=body.get("province"),
        require_coordinates=False,
    )
    if address_error:
        return _err(address_error, 400)
    c = Customer.objects.create(
        email=email,
        password=hash_password(password),
        name=name,
        phone=body.get("phone"),
        avatar=body.get("avatar"),
        address=_strip_default_country_suffix(body.get("address")),
        city=body.get("city"),
        province=body.get("province"),
        zip_code=body.get("zipCode"),
        country=DEFAULT_COUNTRY,
        latitude=body.get("latitude"),
        longitude=body.get("longitude"),
        is_active=bool(body.get("isActive", True)),
    )
    return _ok({"success": True, "customer": _serialize_model(c, exclude={"password"})}, 201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
def customer_detail(request: HttpRequest, customer_id: str) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    try:
        c = Customer.objects.get(id=customer_id)
    except Customer.DoesNotExist:
        return _err("Customer not found", 404)
    if request.method == "GET":
        if p.get("type") == "customer" and p.get("userId") != c.id:
            return _err("Forbidden", 403)
        return _ok({"success": True, "customer": _serialize_model(c, exclude={"password"})})
    if p.get("type") != "staff" and p.get("userId") != c.id:
        return _err("Forbidden", 403)
    if request.method == "DELETE":
        c.delete()
        return _ok({"success": True})
    body = _json_body(request)
    discount_keys = {
        "discountOption",
        "discountStatus",
        "discountPercent",
        "discountAmountPerCase",
    }
    if p.get("type") == "staff" and any(key in body for key in discount_keys):
        staff_role = str(p.get("role") or "").strip().upper()
        option = str(body.get("discountOption") or getattr(c, "discount_option", DISCOUNT_NO)).strip().upper()
        status = str(body.get("discountStatus") or getattr(c, "discount_status", DISCOUNT_REMOVED)).strip().upper()
        percent = float(body.get("discountPercent") if body.get("discountPercent") is not None else getattr(c, "discount_percent", 0) or 0)
        amount_per_case = float(body.get("discountAmountPerCase") if body.get("discountAmountPerCase") is not None else getattr(c, "discount_amount_per_case", 0) or 0)

        if option not in set(DISCOUNT_PRESET_PERCENT.keys()) | {DISCOUNT_OTHER}:
            return _err("Invalid discount option", 400)
        if status not in {DISCOUNT_ACTIVE, DISCOUNT_CANCELLED, DISCOUNT_REMOVED}:
            return _err("Invalid discount status", 400)

        if option in DISCOUNT_PRESET_PERCENT:
            percent = float(DISCOUNT_PRESET_PERCENT[option])
            amount_per_case = 0.0
        elif option == DISCOUNT_OTHER:
            percent = max(0.0, percent)
            if percent <= 0:
                return _err("For Other discount, set a custom percent", 400)
            if percent > 25 and staff_role != RoleType.SUPER_ADMIN:
                return _err("Only owner can apply custom discount above 25%", 403)
            amount_per_case = 0.0

        c.discount_option = option
        c.discount_status = status
        c.discount_percent = percent
        c.discount_amount_per_case = amount_per_case
        c.discount_applied_by_user_id = str(p.get("userId") or "").strip() or None
        c.discount_applied_by_name = str(p.get("name") or "").strip() or None
        c.discount_updated_at = timezone.now()

    mapping = [("name", "name"), ("phone", "phone"), ("avatar", "avatar"), ("address", "address"), ("city", "city"), ("province", "province"), ("zipCode", "zip_code"), ("latitude", "latitude"), ("longitude", "longitude")]
    for key, attr in mapping:
        if key in body:
            if key == "address":
                setattr(c, attr, _strip_default_country_suffix(body.get(key)))
            else:
                setattr(c, attr, body.get(key))
    c.country = DEFAULT_COUNTRY
    if any(key in body for key in {"address", "city", "province", "zipCode", "latitude", "longitude"}):
        address_error = _ensure_negros_occidental_address(
            latitude=c.latitude,
            longitude=c.longitude,
            city=c.city,
            province=c.province,
            require_coordinates=False,
        )
        if address_error:
            return _err(address_error, 400)
    if "isActive" in body and p.get("type") == "staff":
        c.is_active = bool(body.get("isActive"))
    if body.get("password"):
        password_error = _validate_password_strength(str(body["password"]))
        if password_error:
            return _err(password_error)
        c.password = hash_password(str(body["password"]))
    c.save()
    return _ok({"success": True, "customer": _serialize_model(c, exclude={"password"})})


@require_GET
def categories_list(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    return _ok({"success": True, "categories": []})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def warehouses_collection(request: HttpRequest) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = _real_warehouses(Warehouse.objects.all()).order_by("name")
        role = str(staff.get("role") or "").strip().upper()
        user_id = str(staff.get("userId") or "").strip()
        if role == "WAREHOUSE_STAFF" and user_id:
            qs = qs.filter(manager_id=user_id)
        total = qs.count()
        rows = list(qs[off : off + size])
        return _ok({"success": True, "warehouses": [_serialize_model(x) for x in rows], "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    body = _json_body(request)
    required = ["name", "code", "address", "city", "province", "zipCode", "capacity"]
    for f in required:
        if not body.get(f):
            return _err(f"{f} is required")
    capacity_value = _int(body.get("capacity"), 0)
    if capacity_value <= 0:
        return _err("capacity must be greater than 0", 400)
    address_error = _ensure_negros_occidental_address(
        latitude=body.get("latitude"),
        longitude=body.get("longitude"),
        city=body.get("city"),
        province=body.get("province"),
        require_coordinates=False,
    )
    if address_error:
        return _err(address_error, 400)
    w = Warehouse.objects.create(
        name=body["name"],
        code=body["code"],
        address=_strip_default_country_suffix(body["address"]),
        city=body["city"],
        province=body["province"],
        zip_code=body["zipCode"],
        country=DEFAULT_COUNTRY,
        latitude=body.get("latitude"),
        longitude=body.get("longitude"),
        capacity=capacity_value,
        manager_id=body.get("managerId"),
        is_active=bool(body.get("isActive", True)),
    )
    actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
    _create_staff_notifications(
        title="Warehouse added",
        message=f"{actor_name} added warehouse {w.name} ({w.code}).",
        notification_type="WAREHOUSE",
        reference_type="warehouse",
        reference_id=w.id,
    )
    return _ok({"success": True, "warehouse": _serialize_model(w)}, 201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
def warehouse_detail(request: HttpRequest, warehouse_id: str) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    try:
        w = Warehouse.objects.get(id=warehouse_id)
    except Warehouse.DoesNotExist:
        return _err("Warehouse not found", 404)
    if request.method == "GET":
        return _ok({"success": True, "warehouse": _serialize_model(w)})
    if request.method == "DELETE":
        w.is_active = False
        w.save(update_fields=["is_active", "updated_at"])
        actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
        _create_staff_notifications(
            title="Warehouse deactivated",
            message=f"{actor_name} deactivated warehouse {w.name} ({w.code}).",
            notification_type="WAREHOUSE",
            reference_type="warehouse",
            reference_id=w.id,
        )
        return _ok({"success": True})
    body = _json_body(request)
    if "capacity" in body:
        raw_capacity = body.get("capacity")
        if raw_capacity in (None, ""):
            return _err("capacity is required", 400)
        capacity_value = _int(raw_capacity, 0)
        if capacity_value <= 0:
            return _err("capacity must be greater than 0", 400)
        body["capacity"] = capacity_value
    mapping = [("name", "name"), ("code", "code"), ("address", "address"), ("city", "city"), ("province", "province"), ("zipCode", "zip_code"), ("latitude", "latitude"), ("longitude", "longitude"), ("capacity", "capacity"), ("managerId", "manager_id")]
    for key, attr in mapping:
        if key in body:
            if key == "address":
                setattr(w, attr, _strip_default_country_suffix(body.get(key)))
            else:
                setattr(w, attr, body.get(key))
    w.country = DEFAULT_COUNTRY
    if any(key in body for key in {"address", "city", "province", "zipCode", "latitude", "longitude"}):
        address_error = _ensure_negros_occidental_address(
            latitude=w.latitude,
            longitude=w.longitude,
            city=w.city,
            province=w.province,
            require_coordinates=False,
        )
        if address_error:
            return _err(address_error, 400)
    if "isActive" in body:
        w.is_active = bool(body.get("isActive"))
    w.save()
    return _ok({"success": True, "warehouse": _serialize_model(w)})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def products_collection(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = _real_products(Product.objects.all()).order_by("name")
        s = str(request.GET.get("search", "")).strip()
        if s:
            qs = qs.filter(Q(name__icontains=s) | Q(sku__icontains=s))
        total = qs.count()
        rows = list(qs[off : off + size])
        product_ids = [x.id for x in rows]
        inventory_rows = list(
            Inventory.objects.filter(product_id__in=product_ids)
            .filter(product__in=_real_products(Product.objects.all()))
            .filter(warehouse__in=_real_warehouses(Warehouse.objects.all()))
            .values(
                "product_id", "quantity", "reserved_quantity"
            )
        )
        inventory_by_product: dict[str, list[dict[str, int]]] = {}
        for inv in inventory_rows:
            pid = str(inv.get("product_id") or "")
            if not pid:
                continue
            inventory_by_product.setdefault(pid, []).append(
                {
                    "quantity": _int(inv.get("quantity"), 0),
                    "reservedQuantity": _int(inv.get("reserved_quantity"), 0),
                }
            )

        products_out = []
        for product in rows:
            row = _serialize_model(product)
            inventory_entries = inventory_by_product.get(product.id, [])
            available_quantity = sum(
                max(0, _int(item.get("quantity"), 0) - _int(item.get("reservedQuantity"), 0))
                for item in inventory_entries
            )
            row["inventory"] = inventory_entries
            row["availableQuantity"] = available_quantity
            products_out.append(row)

        return _ok({"success": True, "products": products_out, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    _, err = _require_staff(request)
    if err:
        return err
    body = _json_body(request)
    if not body.get("sku") or not body.get("name"):
        return _err("sku and name are required")

    warehouse_id = str(body.get("warehouseId") or "").strip()
    if not warehouse_id:
        return _err("warehouseId is required", 400)

    warehouse = Warehouse.objects.filter(id=warehouse_id).first()
    if not warehouse:
        return _err("Warehouse not found", 404)

    try:
        product_unit = _normalize_product_unit(body.get("unit"))
    except ValueError as exc:
        return _err(str(exc), 400)
    initial_quantity = _int(body.get("availableQuantity"), _int(body.get("initialQuantity"), 0))
    if initial_quantity < 0:
        return _err("availableQuantity must be a non-negative integer", 400)

    try:
        with transaction.atomic():
            prod = Product.objects.create(
                sku=str(body["sku"]).strip(),
                name=str(body["name"]).strip(),
                image_url=body.get("imageUrl"),
                unit=product_unit,
                weight=body.get("weight"),
                price=float(body.get("price") or 0),
                sizes=body.get("sizes") or [],
                quantity_per_unit=body.get("quantityPerCase", body.get("quantityPerUnit")),
                is_active=bool(body.get("isActive", True)),
            )

            # Create inventory record for the selected warehouse
            Inventory.objects.create(
                warehouse=warehouse,
                product=prod,
                quantity=initial_quantity,
                reserved_quantity=0,
                threshold=max(1, int(initial_quantity * 0.15)) if initial_quantity > 0 else 0,
                last_restocked_at=timezone.now(),
            )
            actor_name = str(p.get("name") or "Staff").strip() or "Staff"
            _create_staff_notifications(
                title="New product registered",
                message=f"{actor_name} registered {prod.name} ({prod.sku}) in {warehouse.name} with available quantity {initial_quantity}.",
                reference_type="product",
                reference_id=prod.id,
            )

        return _ok({"success": True, "product": _serialize_model(prod)}, 201)
    except Exception as e:
        return _err(str(e), 500)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
def product_detail(request: HttpRequest, product_id: str) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    try:
        prod = Product.objects.get(id=product_id)
    except Product.DoesNotExist:
        return _err("Product not found", 404)
    if request.method == "GET":
        return _ok({"success": True, "product": _serialize_model(prod)})
    _, err = _require_staff(request)
    if err:
        return err
    if request.method == "DELETE":
        actor_name = str(p.get("name") or "Staff").strip() or "Staff"
        product_name = str(prod.name or "Product").strip() or "Product"
        product_sku = str(prod.sku or "").strip()
        has_order_history = OrderItem.objects.filter(product_id=prod.id).exists()
        if has_order_history:
            if prod.is_active:
                prod.is_active = False
                prod.save(update_fields=["is_active", "updated_at"])
            _create_staff_notifications(
                title="Product archived",
                message=(
                    f"{actor_name} archived {product_name}{f' ({product_sku})' if product_sku else ''} "
                    "to preserve past order history."
                ),
                reference_type="product",
                reference_id=product_id,
            )
            return _ok({"success": True, "archived": True, "preservedOrderHistory": True})
        prod.delete()
        _create_staff_notifications(
            title="Product deleted",
            message=f"{actor_name} deleted {product_name}{f' ({product_sku})' if product_sku else ''}.",
            reference_type="product",
            reference_id=product_id,
        )
        return _ok({"success": True})
    previous_name = str(prod.name or "").strip()
    previous_sku = str(prod.sku or "").strip()
    body = _json_body(request)
    if "unit" in body:
        try:
            prod.unit = _normalize_product_unit(body.get("unit"))
        except ValueError as exc:
            return _err(str(exc), 400)
    if "quantityPerCase" in body or "quantityPerUnit" in body:
        prod.quantity_per_unit = _int(body.get("quantityPerCase", body.get("quantityPerUnit")), 0) or None
    mapping = [("sku", "sku"), ("name", "name"), ("imageUrl", "image_url"), ("weight", "weight"), ("price", "price")]
    for key, attr in mapping:
        if key in body:
            setattr(prod, attr, body.get(key))
    if "isActive" in body:
        prod.is_active = bool(body.get("isActive"))
    prod.save()
    actor_name = str(p.get("name") or "Staff").strip() or "Staff"
    _create_staff_notifications(
        title="Product updated",
        message=(
            f"{actor_name} updated {previous_name or 'product'}"
            f"{f' ({previous_sku})' if previous_sku else ''}."
        ),
        reference_type="product",
        reference_id=prod.id,
    )
    return _ok({"success": True, "product": _serialize_model(prod)})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def inventory_collection(request: HttpRequest) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = (
            Inventory.objects.select_related("warehouse", "product")
            .filter(product__in=_real_products(Product.objects.all()))
            .filter(warehouse__in=_real_warehouses(Warehouse.objects.all()))
            .order_by("-updated_at")
        )

        staff_role = str(staff.get("role") or "").strip().upper()
        staff_user_id = str(staff.get("userId") or "").strip()
        allowed_warehouse_ids: set[str] | None = None
        if staff_role == "WAREHOUSE_STAFF" and staff_user_id:
            allowed_warehouse_ids = set(
                Warehouse.objects.filter(manager_id=staff_user_id).values_list("id", flat=True)
            )
            if not allowed_warehouse_ids:
                return _ok(
                    {
                        "success": True,
                        "inventory": [],
                        "total": 0,
                        "page": page,
                        "pageSize": size,
                        "totalPages": 0,
                    }
                )
            qs = qs.filter(warehouse_id__in=list(allowed_warehouse_ids))

        requested_warehouse_id = str(request.GET.get("warehouseId") or "").strip()
        if requested_warehouse_id:
            if allowed_warehouse_ids is not None and requested_warehouse_id not in allowed_warehouse_ids:
                return _err("Forbidden", 403)
            qs = qs.filter(warehouse_id=requested_warehouse_id)
        total = qs.count()
        rows = list(qs[off : off + size])
        data = [_serialize_model(x, include={"warehouse": lambda o: _serialize_model(o.warehouse), "product": lambda o: _serialize_model(o.product)}) for x in rows]
        return _ok({"success": True, "inventory": data, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    body = _json_body(request)
    warehouse_id = str(body.get("warehouseId", "")).strip()
    product_id = str(body.get("productId", "")).strip()
    qty = _int(body.get("quantity"), 0)
    loose_bottles = max(0, _int(body.get("looseBottles"), 0))
    if not warehouse_id or not product_id:
        return _err("warehouseId and productId are required")
    try:
        warehouse = Warehouse.objects.get(id=warehouse_id)
        product = Product.objects.get(id=product_id)
    except (Warehouse.DoesNotExist, Product.DoesNotExist):
        return _err("Warehouse or Product not found", 404)
    item, created = Inventory.objects.get_or_create(
        warehouse=warehouse,
        product=product,
        defaults={"quantity": qty, "reserved_quantity": 0, "threshold": max(1, int(qty * 0.15)), "last_restocked_at": timezone.now()},
    )
    if not created and _is_inventory_overstocked_for_restock_block(item):
        return _err("Cannot add stock: product is overstocked (>= 3x threshold for 7+ days).", 400)
    if not created:
        item.quantity += qty
        item.loose_bottles = max(0, _int(getattr(item, "loose_bottles", 0), 0) + loose_bottles)
    else:
        item.loose_bottles = loose_bottles
    item.threshold = max(1, int(item.quantity * 0.15))
    item.last_restocked_at = timezone.now()
    item.save(update_fields=["quantity", "loose_bottles", "threshold", "last_restocked_at", "updated_at"])
    InventoryTransaction.objects.create(
        warehouse=warehouse,
        product=product,
        type=str(body.get("type") or "IN"),
        quantity=qty,
        reference_type=body.get("referenceType"),
        reference_id=body.get("referenceId"),
        notes=body.get("notes"),
        performed_by=(_payload(request) or {}).get("userId"),
    )
    return _ok({"success": True, "inventory": _serialize_model(item, include={"warehouse": lambda o: _serialize_model(o.warehouse), "product": lambda o: _serialize_model(o.product)})}, 201)


@csrf_exempt
@require_http_methods(["PUT"])
def inventory_detail(request: HttpRequest, inventory_id: str) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    try:
        item = Inventory.objects.select_related("warehouse", "product").get(id=inventory_id)
    except Inventory.DoesNotExist:
        return _err("Inventory not found", 404)
    body = _json_body(request)
    # Threshold is intentionally excluded from manual edits.
    # It is recalculated only after restock operations.
    mapping = [("quantity", "quantity"), ("reservedQuantity", "reserved_quantity"), ("looseBottles", "loose_bottles")]
    for key, attr in mapping:
        if key in body:
            setattr(item, attr, _int(body.get(key), getattr(item, attr)))
    item.save()
    return _ok({"success": True, "inventory": _serialize_model(item, include={"warehouse": lambda o: _serialize_model(o.warehouse), "product": lambda o: _serialize_model(o.product)})})


@require_GET
def inventory_transactions_list(request: HttpRequest) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    page, size, off = _pagination(request)
    qs = (
        InventoryTransaction.objects.select_related("warehouse", "product")
        .filter(product__in=_real_products(Product.objects.all()))
        .filter(warehouse__in=_real_warehouses(Warehouse.objects.all()))
    )
    staff_role = str(staff.get("role") or "").strip().upper()
    staff_user_id = str(staff.get("userId") or "").strip()
    allowed_warehouse_ids: set[str] | None = None
    if staff_role == "WAREHOUSE_STAFF" and staff_user_id:
        allowed_warehouse_ids = set(
            Warehouse.objects.filter(manager_id=staff_user_id).values_list("id", flat=True)
        )
        if not allowed_warehouse_ids:
            return _ok({"success": True, "transactions": [], "total": 0, "page": page, "pageSize": size, "totalPages": 0})
        qs = qs.filter(warehouse_id__in=list(allowed_warehouse_ids))

    tx_type = str(request.GET.get("type") or "").strip().upper()
    if tx_type and tx_type != "ALL":
        qs = qs.filter(type__iexact=tx_type)

    date_from_raw = str(request.GET.get("dateFrom") or "").strip()
    if date_from_raw:
        try:
            date_from = datetime.fromisoformat(date_from_raw).date()
        except ValueError:
            return _err("Invalid dateFrom. Use YYYY-MM-DD", 400)
        qs = qs.filter(created_at__date__gte=date_from)

    date_to_raw = str(request.GET.get("dateTo") or "").strip()
    if date_to_raw:
        try:
            date_to = datetime.fromisoformat(date_to_raw).date()
        except ValueError:
            return _err("Invalid dateTo. Use YYYY-MM-DD", 400)
        qs = qs.filter(created_at__date__lte=date_to)

    if date_from_raw and date_to_raw and date_from > date_to:
        return _err("dateFrom cannot be later than dateTo", 400)

    qs = qs.order_by("-created_at")
    total = qs.count()
    rows = list(qs[off : off + size])
    data = [_serialize_model(x, include={"warehouse": lambda o: _serialize_model(o.warehouse), "product": lambda o: _serialize_model(o.product)}) for x in rows]
    return _ok({"success": True, "transactions": data, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def stock_batches_collection(request: HttpRequest) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = (
            StockBatch.objects.select_related("inventory", "inventory__warehouse", "inventory__product")
            .filter(inventory__product__in=_real_products(Product.objects.all()))
            .filter(inventory__warehouse__in=_real_warehouses(Warehouse.objects.all()))
            .filter(quantity__gt=0)
            .order_by("-created_at")
        )
        staff_role = str(staff.get("role") or "").strip().upper()
        staff_user_id = str(staff.get("userId") or "").strip()
        allowed_warehouse_ids: set[str] | None = None
        if staff_role == "WAREHOUSE_STAFF" and staff_user_id:
            allowed_warehouse_ids = set(
                Warehouse.objects.filter(manager_id=staff_user_id).values_list("id", flat=True)
            )
            if not allowed_warehouse_ids:
                return _ok({"success": True, "stockBatches": [], "total": 0, "page": page, "pageSize": size, "totalPages": 0})
            qs = qs.filter(inventory__warehouse_id__in=list(allowed_warehouse_ids))
        total = qs.count()
        rows = list(qs[off : off + size])
        data = [_serialize_model(x, include={"inventory": lambda o: _serialize_model(o.inventory, include={"warehouse": lambda i: _serialize_model(i.warehouse), "product": lambda i: _serialize_model(i.product)})}) for x in rows]
        return _ok({"success": True, "stockBatches": data, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    body = _json_body(request)
    qty = _int(body.get("quantity"), 0)
    if qty <= 0:
        return _err("quantity must be > 0")

    manufactured_raw = str(body.get("manufacturedDate") or body.get("manufactured_date") or "").strip()
    manufactured_date = None
    if manufactured_raw:
        try:
            manufactured_date = datetime.fromisoformat(manufactured_raw.replace("Z", "+00:00"))
        except ValueError:
            return _err("Invalid manufacturedDate", 400)

    expiry_raw = str(body.get("expiryDate") or body.get("expiry_date") or "").strip()
    expiry_date = None
    if expiry_raw:
        try:
            expiry_date = datetime.fromisoformat(expiry_raw.replace("Z", "+00:00"))
        except ValueError:
            return _err("Invalid expiryDate", 400)

    created_by = (_payload(request) or {}).get("userId")

    try:
        with transaction.atomic():
            inv = None
            inventory_id = str(body.get("inventoryId") or "").strip()

            if inventory_id:
                inv = Inventory.objects.select_related("warehouse", "product").filter(id=inventory_id).first()
                if not inv:
                    return _err("Inventory not found", 404)
            else:
                warehouse_id = str(body.get("warehouseId") or "").strip()
                product_id = str(body.get("productId") or "").strip()
                is_new_product = bool(body.get("isNewProduct"))

                if not warehouse_id:
                    return _err("warehouseId is required", 400)

                warehouse = Warehouse.objects.filter(id=warehouse_id).first()
                if not warehouse:
                    return _err("Warehouse not found", 404)

                product = None
                if is_new_product and not product_id:
                    name = str(body.get("productName") or "").strip()
                    if not name:
                        return _err("productName is required", 400)

                    sku = str(body.get("sku") or "").strip()
                    if not sku:
                        sku = f"SKU-{int(timezone.now().timestamp())}-{secrets.token_hex(2).upper()}"

                    if Product.objects.filter(sku=sku).exists():
                        sku = f"{sku}-{secrets.token_hex(1).upper()}"

                    try:
                        product_unit = _normalize_product_unit(body.get("unit"))
                    except ValueError as exc:
                        return _err(str(exc), 400)

                    product = Product.objects.create(
                        sku=sku,
                        name=name,
                        image_url=body.get("imageUrl"),
                        unit=product_unit,
                        price=float(body.get("price") or 0),
                        is_active=True,
                    )
                else:
                    if not product_id:
                        return _err("productId is required", 400)
                    product = Product.objects.filter(id=product_id).first()
                    if not product:
                        return _err("Product not found", 404)

                inv, created = Inventory.objects.select_related("warehouse", "product").get_or_create(
                    warehouse=warehouse,
                    product=product,
                    defaults={
                        "quantity": 0,
                        "reserved_quantity": 0,
                        "threshold": max(1, int(qty * 0.15)),
                        "last_restocked_at": timezone.now(),
                    },
                )
                if not created and _is_inventory_overstocked_for_restock_block(inv):
                    return _err("Cannot add stock: product is overstocked (>= 3x threshold for 7+ days).", 400)

            batch = StockBatch.objects.create(
                batch_number=str(body.get("batchNumber") or f"BATCH-{int(timezone.now().timestamp())}"),
                inventory=inv,
                quantity=qty,
                receipt_date=manufactured_date or timezone.now(),
                expiry_date=expiry_date,
                location_label=body.get("locationLabel"),
                status=body.get("status") or "ACTIVE",
                created_by=created_by,
            )

            inv.quantity += qty
            inv.threshold = max(1, int(inv.quantity * 0.15))
            inv.last_restocked_at = timezone.now()
            inv.save(update_fields=["quantity", "threshold", "last_restocked_at", "updated_at"])

            InventoryTransaction.objects.create(
                warehouse=inv.warehouse,
                product=inv.product,
                type="IN",
                quantity=qty,
                reference_type="stock_batch",
                reference_id=batch.id,
                notes="Stock batch added",
                performed_by=created_by,
            )
            actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
            _create_staff_notifications(
                title="Stock batch added",
                message=f"{actor_name} added batch {batch.batch_number} for {inv.product.name} (+{qty}) in {inv.warehouse.name}.",
                reference_type="stock_batch",
                reference_id=batch.id,
            )

            return _ok({"success": True, "stockBatch": _serialize_model(batch)}, 201)
    except Exception as e:
        return _err(str(e), 500)


@csrf_exempt
@require_http_methods(["POST"])
def stock_batches_bulk_collection(request: HttpRequest) -> JsonResponse:
    """Bulk add multiple stock batches in a single atomic transaction"""
    staff, err = _require_staff(request)
    if err:
        return err

    body = _json_body(request)
    warehouse_id = str(body.get("warehouseId") or "").strip()
    batches = body.get("batches") or []

    if not warehouse_id:
        return _err("warehouseId is required", 400)
    if not isinstance(batches, list) or len(batches) == 0:
        return _err("batches must be a non-empty array", 400)

    warehouse = Warehouse.objects.filter(id=warehouse_id).first()
    if not warehouse:
        return _err("Warehouse not found", 404)

    # Validate all batches before creating any
    validated_batches = []
    for idx, batch_item in enumerate(batches):
        if not isinstance(batch_item, dict):
            return _err(f"Batch {idx} is not a dictionary", 400)

        product_id = str(batch_item.get("productId") or "").strip()
        qty = _int(batch_item.get("quantity"), 0)
        manufactured_raw = str(batch_item.get("manufacturedDate") or "").strip()
        manufactured_date = None
        if manufactured_raw:
            try:
                manufactured_date = datetime.fromisoformat(manufactured_raw.replace("Z", "+00:00"))
            except ValueError:
                return _err(f"Batch {idx}: Invalid manufacturedDate format", 400)

        expiry_raw = str(batch_item.get("expiryDate") or "").strip()

        if not product_id:
            return _err(f"Batch {idx}: productId is required", 400)
        if qty <= 0:
            return _err(f"Batch {idx}: quantity must be > 0", 400)

        product = Product.objects.filter(id=product_id).first()
        if not product:
            return _err(f"Batch {idx}: Product not found", 404)

        expiry_date = None
        if expiry_raw:
            try:
                expiry_date = datetime.fromisoformat(expiry_raw.replace("Z", "+00:00"))
            except ValueError:
                return _err(f"Batch {idx}: Invalid expiryDate format", 400)

        validated_batches.append({
            "index": idx,
            "product_id": product_id,
            "product": product,
            "quantity": qty,
            "manufactured_date": manufactured_date,
            "expiry_date": expiry_date,
            "batch_number": str(batch_item.get("batchNumber") or f"BATCH-{int(timezone.now().timestamp())}-{idx}"),
            "location_label": batch_item.get("locationLabel"),
            "status": batch_item.get("status") or "ACTIVE",
        })

    created_by = (_payload(request) or {}).get("userId")

    try:
        with transaction.atomic():
            created_stock_batches = []

            for batch_data in validated_batches:
                product_id = batch_data["product_id"]
                product = batch_data["product"]
                qty = batch_data["quantity"]
                expiry_date = batch_data["expiry_date"]

                # Get or create inventory
                inv, created = Inventory.objects.select_related("warehouse", "product").get_or_create(
                    warehouse=warehouse,
                    product=product,
                    defaults={
                        "quantity": 0,
                        "reserved_quantity": 0,
                        "threshold": max(1, int(qty * 0.15)),
                        "last_restocked_at": timezone.now(),
                    },
                )
                if not created and _is_inventory_overstocked_for_restock_block(inv):
                    return _err(
                        f"Batch {batch_data['index']}: cannot add stock for overstocked product (>= 3x threshold for 7+ days).",
                        400,
                    )

                # Create stock batch
                batch = StockBatch.objects.create(
                    batch_number=batch_data["batch_number"],
                    inventory=inv,
                    quantity=qty,
                    receipt_date=batch_data.get("manufactured_date") or timezone.now(),
                    expiry_date=expiry_date,
                    location_label=batch_data["location_label"],
                    status=batch_data["status"],
                    created_by=created_by,
                )

                # Update inventory quantity
                inv.quantity += qty
                inv.threshold = max(1, int(inv.quantity * 0.15))
                inv.last_restocked_at = timezone.now()
                inv.save(update_fields=["quantity", "threshold", "last_restocked_at", "updated_at"])

                # Create inventory transaction
                InventoryTransaction.objects.create(
                    warehouse=inv.warehouse,
                    product=inv.product,
                    type="IN",
                    quantity=qty,
                    reference_type="stock_batch",
                    reference_id=batch.id,
                    notes="Bulk stock batch added",
                    performed_by=created_by,
                )

                created_stock_batches.append(batch)

            serialized_batches = [_serialize_model(b, include={"inventory": lambda o: _serialize_model(o.inventory, include={"warehouse": lambda i: _serialize_model(i.warehouse), "product": lambda i: _serialize_model(i.product)})}) for b in created_stock_batches]
            actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
            _create_staff_notifications(
                title="Bulk stock import completed",
                message=f"{actor_name} added {len(created_stock_batches)} stock batches in {warehouse.name}.",
                reference_type="stock_batch",
                reference_id=warehouse.id,
            )

            return _ok({
                "success": True,
                "created": len(created_stock_batches),
                "failed": 0,
                "stockBatches": serialized_batches,
                "errors": []
            }, 201)
    except Exception as e:
        return _err(str(e), 500)



@csrf_exempt
@require_http_methods(["GET", "POST", "PATCH"])
def vehicles_collection(request: HttpRequest) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = _real_vehicles(Vehicle.objects.select_related("driver").all()).order_by("-created_at")
        if request.GET.get("status"):
            qs = qs.filter(status=request.GET.get("status"))
        total = qs.count()
        rows = list(qs[off : off + size])
        vehicles_data = []
        for vehicle in rows:
            row = _serialize_model(vehicle)
            row["drivers"] = [_serialize_driver_vehicle_link(vehicle)] if vehicle.driver_id else []
            vehicles_data.append(row)
        return _ok({"success": True, "vehicles": vehicles_data, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    body = _json_body(request)
    if request.method == "POST":
        if not body.get("licensePlate") or not body.get("type"):
            return _err("licensePlate and type are required")
        v = Vehicle.objects.create(
            license_plate=body["licensePlate"],
            type=body["type"],
            capacity=body.get("capacity"),
            status=body.get("status") or VehicleStatus.AVAILABLE,
            is_active=bool(body.get("isActive", True)),
        )
        driver_id = str(body.get("driverId") or "").strip()
        if driver_id:
            driver = User.objects.filter(id=driver_id, role="DRIVER").first()
            if not driver:
                return _err("Driver not found", 404)
            _assign_vehicle_to_driver(driver, v)
        actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
        _create_staff_notifications(
            title="Vehicle added",
            message=f"{actor_name} added vehicle {v.license_plate} ({v.type}).",
            notification_type="TRANSPORT",
            reference_type="vehicle",
            reference_id=v.id,
        )
        return _ok({"success": True, "vehicle": _serialize_model(v)}, 201)
    vehicle_id = str(body.get("id", "")).strip()
    if not vehicle_id:
        return _err("id is required")
    try:
        v = Vehicle.objects.get(id=vehicle_id)
    except Vehicle.DoesNotExist:
        return _err("Vehicle not found", 404)
    mapping = [("licensePlate", "license_plate"), ("type", "type"), ("capacity", "capacity"), ("status", "status")]
    for key, attr in mapping:
        if key in body:
            setattr(v, attr, body.get(key))
    if "driverId" in body:
        driver_id = str(body.get("driverId") or "").strip()
        if driver_id:
            driver = User.objects.filter(id=driver_id, role="DRIVER").first()
            if not driver:
                return _err("Driver not found", 404)
            _assign_vehicle_to_driver(driver, v)
        else:
            v.driver = None
    if "isActive" in body:
        v.is_active = bool(body.get("isActive"))
    v.save()
    return _ok({"success": True, "vehicle": _serialize_model(v)})


@csrf_exempt
@require_http_methods(["DELETE"])
def vehicle_detail(request: HttpRequest, vehicle_id: str) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    try:
        v = Vehicle.objects.get(id=vehicle_id)
    except Vehicle.DoesNotExist:
        return _err("Vehicle not found", 404)
    actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
    plate = str(v.license_plate or "").strip()
    v.delete()
    _create_staff_notifications(
        title="Vehicle deleted",
        message=f"{actor_name} deleted vehicle {plate or vehicle_id}.",
        notification_type="TRANSPORT",
        reference_type="vehicle",
        reference_id=vehicle_id,
    )
    return _ok({"success": True})


@csrf_exempt
@require_http_methods(["GET", "POST", "PUT"])
def drivers_collection(request: HttpRequest) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        show_sample = str(request.GET.get("includeSample") or request.GET.get("showSample") or "").strip().lower() in {"1", "true", "yes", "on"}
        base_qs = User.objects.prefetch_related("assigned_vehicles").filter(role="DRIVER")
        qs = (base_qs if show_sample else _real_drivers(base_qs)).order_by("-created_at")
        if request.GET.get("active") == "true":
            qs = qs.filter(is_active=True)
        total = qs.count()
        rows = list(qs[off : off + size])
        data = []
        for driver in rows:
            row = _serialize_model(driver, exclude={"password"})
            row["phone"] = driver.phone
            row["user"] = _serialize_model(driver, exclude={"password"})
            vehicles = list(driver.assigned_vehicles.all())
            row["vehicles"] = [_serialize_driver_vehicle_link(vehicle) for vehicle in vehicles]
            data.append(row)
        return _ok({"success": True, "drivers": data, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    body = _json_body(request)
    if request.method == "POST":
        user_id = str(body.get("userId", "")).strip()
        if not user_id:
            return _err("userId is required")
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return _err("User not found", 404)
        if user.role == "DRIVER":
            return _err("User already assigned as driver", 409)
        user.role = "DRIVER"
        user.license_number = body.get("licenseNumber") or f"DRV-{int(timezone.now().timestamp())}"
        user.license_type = body.get("licenseType") or "B"
        user.license_expiry = datetime.fromisoformat(body["licenseExpiry"]) if body.get("licenseExpiry") else timezone.now() + timedelta(days=365)
        user.emergency_contact = body.get("emergencyContact")
        user.is_active = bool(body.get("isActive", True))
        user.save()
        actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
        _create_staff_notifications(
            title="Driver added",
            message=f"{actor_name} added driver {user.name} ({user.email}).",
            notification_type="TRANSPORT",
            reference_type="driver",
            reference_id=user.id,
        )
        driver_payload = _serialize_model(user, exclude={"password"})
        driver_payload["user"] = _serialize_model(user, exclude={"password"})
        return _ok({"success": True, "driver": driver_payload}, 201)
    driver_id = str(body.get("id", "")).strip()
    if not driver_id:
        return _err("id is required")
    try:
        d = User.objects.get(id=driver_id, role="DRIVER")
    except User.DoesNotExist:
        return _err("Driver not found", 404)
    mapping = [
        ("licenseNumber", "license_number"),
        ("licenseType", "license_type"),
        ("emergencyContact", "emergency_contact"),
        ("rating", "rating"),
        ("totalDeliveries", "total_deliveries"),
    ]
    for key, attr in mapping:
        if key in body:
            setattr(d, attr, body.get(key))
    if "licenseExpiry" in body and body.get("licenseExpiry"):
        d.license_expiry = datetime.fromisoformat(body["licenseExpiry"])
    if "vehicleId" in body:
        vehicle_id = str(body.get("vehicleId") or "").strip()
        if vehicle_id:
            vehicle = Vehicle.objects.filter(id=vehicle_id).first()
            if not vehicle:
                return _err("Vehicle not found", 404)
            _assign_vehicle_to_driver(d, vehicle)
        else:
            _assign_vehicle_to_driver(d, None)
    if "isActive" in body:
        d.is_active = bool(body.get("isActive"))
    d.save()
    if "phone" in body:
        d.phone = body.get("phone")
        d.save(update_fields=["phone", "updated_at"])
    driver_payload = _serialize_model(d, exclude={"password"})
    driver_payload["user"] = _serialize_model(d, exclude={"password"})
    return _ok({"success": True, "driver": driver_payload})


@require_GET
def dashboard_stats(request: HttpRequest) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    today = timezone.now().date()
    orders = _real_orders(Order.objects.all())
    trips = _real_trips(Trip.objects.all())
    inventory = (
        Inventory.objects.filter(product__in=_real_products(Product.objects.all()))
        .filter(warehouse__in=_real_warehouses(Warehouse.objects.all()))
    )
    customers = _real_customers(Customer.objects.all())
    drivers = _real_drivers(User.objects.filter(role="DRIVER"))
    feedback_qs = Feedback.objects.filter(customer__in=customers)
    ratings_qs = feedback_qs.exclude(rating__isnull=True)
    avg_rating = float(ratings_qs.aggregate(avg=Sum("rating")).get("avg") or 0)
    rating_count = ratings_qs.count()
    if rating_count > 0:
        avg_rating = avg_rating / rating_count

    pending_replacements = Replacement.objects.filter(
        status__in=[
            ReplacementStatus.REPORTED,
            ReplacementStatus.IN_PROGRESS,
            ReplacementStatus.NEEDS_FOLLOW_UP,
        ]
    ).count()

    pending_orders = orders.filter(status=OrderStatus.PENDING).count()
    processing_orders = orders.filter(status=OrderStatus.PREPARING).count()
    in_transit_orders = orders.filter(status=OrderStatus.OUT_FOR_DELIVERY).count()
    delivered_orders = orders.filter(status=OrderStatus.DELIVERED).count()
    cancelled_orders = orders.filter(status__in=[OrderStatus.CANCELLED, OrderStatus.REJECTED]).count()
    loaded_orders = orders.filter(warehouse_stage=WarehouseStage.LOADED).count()
    total_orders = orders.count()
    total_revenue = float(orders.filter(status=OrderStatus.DELIVERED).aggregate(total=Sum("total_amount")).get("total") or 0)
    active_drivers = drivers.filter(is_active=True).count()
    available_drivers = active_drivers
    low_stock_items = inventory.filter(quantity__lte=F("threshold") + F("reserved_quantity")).count()
    total_customers = customers.count()
    total_vehicles = Vehicle.objects.count()

    stats = {
        # Current frontend contract
        "totalOrders": total_orders,
        "pendingOrders": pending_orders,
        "processingOrders": processing_orders,
        "loadedOrders": loaded_orders,
        "inTransitOrders": in_transit_orders,
        "deliveredOrders": delivered_orders,
        "failedOrders": cancelled_orders,
        "completedOrders": delivered_orders,
        "totalRevenue": total_revenue,
        "totalCustomers": total_customers,
        "activeDrivers": active_drivers,
        "availableDrivers": available_drivers,
        "activeTrips": trips.filter(status=TripStatus.IN_PROGRESS).count(),
        "totalVehicles": total_vehicles,
        "lowStockItems": low_stock_items,
        "pendingReturns": pending_replacements,
        "avgRating": round(avg_rating, 2),
        # Backward-compatible aliases
        "ordersTotal": total_orders,
        "ordersToday": orders.filter(created_at__date=today).count(),
        "lowStockCount": low_stock_items,
        "customersTotal": total_customers,
        "driversTotal": drivers.count(),
        "revenueTotal": total_revenue,
    }
    return _ok({"success": True, "stats": stats})


@csrf_exempt
@require_http_methods(["GET", "POST", "PATCH"])
def feedback_collection(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = (
            Feedback.objects.select_related("customer", "order")
            .filter(customer__in=_real_customers(Customer.objects.all()))
            .filter(Q(order__isnull=True) | Q(order__in=_real_orders(Order.objects.all())))
            .order_by("-created_at")
        )
        if p.get("type") == "customer":
            requester_id = str(p.get("userId") or "").strip()
            customer_scope_q = Q(customer_id=requester_id)
            qs = qs.filter(customer_scope_q)
        total = qs.count()
        rows = list(qs[off : off + size])
        data = [
            _serialize_model(
                x,
                include={
                    "customer": lambda o: _serialize_model(o.customer, exclude={"password"}),
                    "order": lambda o: _serialize_model(o.order) if o.order else None,
                },
            )
            for x in rows
        ]
        for row in data:
            order_obj = row.get("order")
            if isinstance(order_obj, dict):
                row["orderNumber"] = order_obj.get("orderNumber") or order_obj.get("order_number")
        return _ok({
            "success": True,
            "feedback": data,
            "feedbacks": data,
            "total": total,
            "page": page,
            "pageSize": size,
            "totalPages": (total + size - 1) // size,
        })
    if request.method == "POST":
        body = _json_body(request)
        customer_ref = str(p.get("userId") or "").strip() if p.get("type") == "customer" else str(body.get("customerId") or "").strip()
        if not customer_ref:
            return _err("customerId is required")
        customer = (
            Customer.objects.filter(id=customer_ref).first()
        )
        if not customer:
            return _err("Customer not found", 404)
        order = None
        if body.get("orderId"):
            order = Order.objects.filter(id=str(body["orderId"])).first()
        if p.get("type") == "customer" and order and str(order.customer_id or "") != str(customer.id):
            return _err("Forbidden", 403)
        if order and Feedback.objects.filter(order_id=order.id, customer_id=customer.id).exists():
            return _err("Feedback already submitted for this order", 409)
        f = Feedback.objects.create(
            customer=customer,
            order=order,
            type=body.get("type") or "SUGGESTION",
            subject=str(body.get("subject") or "General Feedback"),
            message=str(body.get("message") or ""),
            rating=body.get("rating"),
        )
        return _ok({"success": True, "feedback": _serialize_model(f)}, 201)
    _, err = _require_staff(request)
    if err:
        return err
    body = _json_body(request)
    feedback_id = str(body.get("id", "")).strip()
    if not feedback_id:
        return _err("id is required")
    try:
        f = Feedback.objects.get(id=feedback_id)
    except Feedback.DoesNotExist:
        return _err("Feedback not found", 404)
    f.save()
    return _ok({"success": True})


@csrf_exempt
@require_http_methods(["GET", "PATCH", "DELETE"])
def notifications_collection(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    scoped_qs = Notification.objects.all()
    if p.get("type") == "staff":
        scoped_qs = scoped_qs.filter(user_id=p.get("userId"))
    else:
        scoped_qs = scoped_qs.filter(customer_id=p.get("userId"))

    if request.method == "GET":
        qs = scoped_qs.order_by("-created_at")
        limit = max(1, min(_int(request.GET.get("limit", "100"), 100), 500))
        rows = list(qs[:limit])
        unread_count = scoped_qs.filter(is_read=False).count()
        return _ok({"success": True, "notifications": [_serialize_model(x) for x in rows], "unreadCount": unread_count})
    if request.method == "DELETE":
        deleted_count, _ = scoped_qs.delete()
        return _ok({"success": True, "deleted": deleted_count, "unreadCount": 0})
    body = _json_body(request)

    if body.get("markAll") is True:
        qs = scoped_qs.filter(is_read=False)
        updated_count = qs.count()
        qs.update(is_read=True, read_at=timezone.now())
        return _ok({"success": True, "updated": updated_count, "unreadCount": 0})

    ids = body.get("ids") or []
    if not isinstance(ids, list) or not ids:
        return _err("ids is required")
    qs = scoped_qs.filter(id__in=ids)
    qs.update(is_read=True, read_at=timezone.now())
    unread_count = scoped_qs.filter(is_read=False).count()
    return _ok({"success": True, "updated": qs.count(), "unreadCount": unread_count})


@csrf_exempt
@require_http_methods(["GET", "POST", "PATCH"])
def orders_collection(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    if request.method == "GET":
        page, size, off = _pagination(request)
        include_replacements = str(request.GET.get("includeReplacements") or "").strip().lower() == "true"
        include_orders = request.GET.get("includeOrders", "true") != "false"
        include_items = str(request.GET.get("includeItems", "full") or "full").strip().lower()
        updated_after = _parse_iso_datetime(request.GET.get("updatedAfter"))
        sort = str(request.GET.get("sort") or "").strip().lower()
        where = Q()
        if p.get("type") == "customer":
            where &= Q(customer_id=p.get("userId"))
        elif p.get("type") == "staff":
            staff_role = str(p.get("role") or "").strip().upper()
            staff_user_id = str(p.get("userId") or "").strip()
            if staff_role == "WAREHOUSE_STAFF" and staff_user_id:
                allowed_warehouse_ids = set(
                    Warehouse.objects.filter(manager_id=staff_user_id).values_list("id", flat=True)
                )
                if not allowed_warehouse_ids:
                    return _ok({
                        "success": True,
                        "orders": [],
                        "replacements": [],
                        "total": 0,
                        "page": page,
                        "pageSize": size,
                        "totalPages": 0 if include_orders else 0,
                    })
                where &= Q(warehouse_id__in=list(allowed_warehouse_ids))
        if request.GET.get("status"):
            where &= Q(status=_normalize_order_status(request.GET.get("status")))
        if updated_after:
            where &= Q(updated_at__gt=updated_after)
        s = str(request.GET.get("search", "")).strip()
        if s:
            where &= Q(order_number__icontains=s) | Q(customer__name__icontains=s)
        orders_qs = Order.objects.select_related("customer", "timeline").filter(where)
        if include_items != "none":
            orders_qs = orders_qs.prefetch_related("items__product")
        order_by_field = "-updated_at" if sort in {"updated", "updated_at"} else "-created_at"
        oqs = _real_orders(orders_qs).order_by(order_by_field)
        total = oqs.count() if include_orders else 0
        orders = list(oqs[off : off + size]) if include_orders else []
        order_ids = [str(getattr(order, "id", "") or "").strip() for order in orders]
        warehouse_ids = {str(getattr(order, "warehouse_id", "") or "").strip() for order in orders if str(getattr(order, "warehouse_id", "") or "").strip()}
        warehouse_lookup = {warehouse.id: warehouse for warehouse in Warehouse.objects.filter(id__in=warehouse_ids)} if warehouse_ids else {}
        assigned_trip_map = _build_assigned_trip_map(order_ids, require_driver=True)
        out = []
        for o in orders:
            try:
                if _reconcile_delivered_order_from_completed_drop_point(o, p.get("userId")):
                    o.refresh_from_db()
            except ValueError as e:
                logger.warning("Unable to reconcile delivered order %s: %s", o.id, e)
            row = _serialize_order(
                o,
                include_items=include_items != "none",
                warehouse_lookup=warehouse_lookup,
                assigned_trip=assigned_trip_map.get(str(getattr(o, "id", "") or "").strip()),
            )
            if include_items == "preview" and "items" in row:
                row["itemCount"] = len(row["items"])
                row["items"] = row["items"][:2]
            if include_items == "none":
                row.pop("items", None)
            out.append(row)
        replacements_out = []
        if include_replacements:
            replacements_qs = Replacement.objects.select_related("order", "order__customer").filter(
                order__in=oqs,
                order__customer__in=_real_customers(Customer.objects.all()),
            ).order_by("-created_at")
            replacements_out = [_serialize_replacement(r) for r in replacements_qs[:size]]
        return _ok({
            "success": True,
            "orders": out,
            "replacements": replacements_out,
            "total": total,
            "page": page,
            "pageSize": size,
            "totalPages": (total + size - 1) // size if include_orders else 0,
        })
    if request.method == "POST":
        body = _json_body(request)
        customer_id = str(body.get("customerId") or (p.get("userId") if p.get("type") == "customer" else "") or "").strip()
        if not customer_id:
            return _err("customerId is required")
        try:
            customer = Customer.objects.get(id=customer_id)
        except Customer.DoesNotExist:
            return _err("Customer not found", 404)
        items = body.get("items") or []
        if not isinstance(items, list) or not items:
            return _err("items are required")
        selected_warehouse_id = str(body.get("warehouseId") or "").strip() or None
        if p.get("type") == "customer" and not selected_warehouse_id:
            shipping_latitude = body.get("shippingLatitude") if body.get("shippingLatitude") is not None else customer.latitude
            shipping_longitude = body.get("shippingLongitude") if body.get("shippingLongitude") is not None else customer.longitude
            selected_warehouse_id = _select_best_warehouse_for_order_items(
                items=items,
                shipping_latitude=shipping_latitude,
                shipping_longitude=shipping_longitude,
            )
        shipping_latitude = body.get("shippingLatitude") if body.get("shippingLatitude") is not None else customer.latitude
        shipping_longitude = body.get("shippingLongitude") if body.get("shippingLongitude") is not None else customer.longitude
        shipping_city = body.get("shippingCity") if body.get("shippingCity") is not None else customer.city
        shipping_province = body.get("shippingProvince") if body.get("shippingProvince") is not None else customer.province
        address_error = _ensure_negros_occidental_address(
            latitude=shipping_latitude,
            longitude=shipping_longitude,
            city=shipping_city,
            province=shipping_province,
            require_coordinates=True,
        )
        if address_error:
            return _err(address_error, 400)
        try:
            normalized_items, subtotal = _normalize_order_items_for_checkout(items)
            total_cases = sum(max(0, _int(item.get("quantity"), 0)) for item in normalized_items)
            discount_breakdown = _build_discount_breakdown_for_customer(
                customer=customer,
                subtotal=subtotal,
                total_cases=total_cases,
            )
            tax = float(body.get("tax") if body.get("tax") is not None else 0)
            shipping_cost = float(body.get("shippingCost") or 0)
            discount = float(discount_breakdown.get("totalDiscount") or 0)
            total = float(subtotal + tax + shipping_cost - discount)
            with transaction.atomic():
                order = _create_order_from_checkout_payload(
                    customer=customer,
                    body=body,
                    normalized_items=normalized_items,
                    subtotal=subtotal,
                    tax=tax,
                    shipping_cost=shipping_cost,
                    discount=discount,
                    total_amount=total,
                    selected_warehouse_id=selected_warehouse_id,
                    shipping_latitude=shipping_latitude,
                    shipping_longitude=shipping_longitude,
                    payment_status=body.get("paymentStatus") or "pending",
                    performed_by=(p or {}).get("userId"),
                    discount_breakdown=discount_breakdown,
                )
        except ValueError as e:
            return _err(str(e), 400)
        except IntegrityError:
            logger.exception("Order create integrity error")
            return _err("Unable to create order right now. Please try again.", 409)
        order = Order.objects.select_related("customer", "timeline").prefetch_related("items__product").get(id=order.id)
        _email_new_order_to_warehouse_staff(order)
        if p.get("type") == "staff":
            actor_name = str(p.get("name") or "Staff").strip() or "Staff"
            _create_staff_notifications(
                title="Order created",
                message=f"{actor_name} created order {order.order_number}.",
                notification_type="ORDER",
                reference_type="order",
                reference_id=order.id,
            )
        return _ok({"success": True, "order": _serialize_order(order)}, 201)
    staff, err = _require_staff(request)
    if err:
        return err
    body = _json_body(request)
    if body.get("scope") != "replacement":
        return _err("Invalid patch scope")
    return_id = str(body.get("replacementId") or "")
    status = str(body.get("status") or "")
    if not return_id or not status:
        return _err("replacementId and status are required")
    try:
        r = Replacement.objects.select_related("order").get(id=return_id)
    except Replacement.DoesNotExist:
        return _err("Replacement record not found", 404)
    normalized_status = _normalize_replacement_status(status, r.replacement_mode)
    allowed_statuses = {
        ReplacementStatus.PENDING,
        ReplacementStatus.UNDER_REVIEW,
        ReplacementStatus.APPROVED,
        ReplacementStatus.REJECTED,
        ReplacementStatus.REPORTED,
        ReplacementStatus.IN_PROGRESS,
        ReplacementStatus.RESOLVED_ON_DELIVERY,
        ReplacementStatus.NEEDS_FOLLOW_UP,
        ReplacementStatus.COMPLETED,
    }
    if normalized_status not in allowed_statuses:
        return _err("Invalid replacement status", 400)

    replacement_delivery_date_raw = str(body.get("replacementDeliveryDate") or "").strip()
    replacement_delivery_date = None
    if replacement_delivery_date_raw:
        try:
            replacement_delivery_date = datetime.fromisoformat(replacement_delivery_date_raw).date()
        except ValueError:
            return _err("Invalid replacementDeliveryDate. Expected YYYY-MM-DD", 400)

    create_replacement_order = bool(body.get("createReplacementOrder"))
    manual_schedule_confirmed = bool(body.get("manualScheduleConfirmed"))
    staff_role = str(staff.get("role") or "").strip().upper()
    is_admin_role = staff_role in {RoleType.ADMIN, RoleType.SUPER_ADMIN}
    is_warehouse_role = staff_role == RoleType.WAREHOUSE_STAFF

    current_status_normalized = str(_normalize_replacement_status(getattr(r, "status", None), r.replacement_mode) or "").upper()
    is_driver_partial_follow_up = (
        str(getattr(r, "replacement_mode", "") or "").strip().upper() == REPLACEMENT_MODE_SPARE_PRODUCTS_PARTIAL
        and current_status_normalized == ReplacementStatus.NEEDS_FOLLOW_UP
    )
    allowed_schedule_targets = {ReplacementStatus.APPROVED, ReplacementStatus.IN_PROGRESS}
    if is_driver_partial_follow_up:
        allowed_schedule_targets.add(ReplacementStatus.NEEDS_FOLLOW_UP)
    if create_replacement_order and normalized_status not in allowed_schedule_targets:
        return _err("Replacement is not eligible for scheduling delivery", 400)
    if create_replacement_order and not replacement_delivery_date:
        return _err("replacementDeliveryDate is required when createReplacementOrder is true", 400)
    if create_replacement_order and not manual_schedule_confirmed:
        return _err("Manual schedule confirmation is required", 400)
    if create_replacement_order and not is_warehouse_role:
        return _err("Only warehouse staff can schedule replacement deliveries", 403)
    if not create_replacement_order and not is_admin_role:
        return _err("Only admin can set replacement UNDER_REVIEW, APPROVED, or REJECTED", 403)
    if is_admin_role and normalized_status not in {ReplacementStatus.UNDER_REVIEW, ReplacementStatus.APPROVED, ReplacementStatus.REJECTED}:
        return _err("Admin can only set replacement to UNDER_REVIEW, APPROVED, or REJECTED here", 400)
    if create_replacement_order and current_status_normalized not in allowed_schedule_targets:
        return _err("Replacement is not eligible for warehouse scheduling yet", 400)
    if normalized_status in {ReplacementStatus.RESOLVED_ON_DELIVERY, ReplacementStatus.COMPLETED}:
        if _replacement_has_outstanding_quantity(r):
            return _err(
                "Replacement cannot be marked completed while there are still products to replace",
                400,
            )

    r.status = normalized_status
    status_notes = str(body.get("notes") or "").strip()
    if normalized_status == ReplacementStatus.REJECTED and not status_notes:
        return _err("Rejection reason is required in notes", 400)
    if normalized_status == ReplacementStatus.IN_PROGRESS:
        r.pickup_completed = timezone.now()
    if normalized_status in {ReplacementStatus.RESOLVED_ON_DELIVERY, ReplacementStatus.COMPLETED}:
        r.processed_at = timezone.now()
        r.processed_by = staff.get("userId")
    if create_replacement_order and replacement_delivery_date:
        replacement_order = _create_scheduled_replacement_order(
            r,
            scheduled_date=replacement_delivery_date,
            staff_user_id=str(staff.get("userId") or "").strip() or None,
        )
        r.status = ReplacementStatus.IN_PROGRESS
        if normalized_status == ReplacementStatus.APPROVED and not status_notes:
            status_notes = "Replacement approved and scheduled for delivery"
        _create_staff_notifications(
            title="Replacement delivery scheduled",
            message=(
                f"{str(staff.get('name') or 'Staff').strip() or 'Staff'} scheduled {r.replacement_number} "
                f"as order {replacement_order.order_number} for {replacement_delivery_date.isoformat()}."
            ),
            notification_type="REPLACEMENT",
            reference_type="order",
            reference_id=replacement_order.id,
        )
    final_status = str(r.status or normalized_status)
    r.notes = _append_replacement_note_line(
        r.notes,
        f"{final_status}{f': {status_notes}' if status_notes else ''}",
    )
    r.save()
    actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
    serialized_replacement = _serialize_replacement(r)
    replacement_lines = serialized_replacement.get("replacementLines") or serialized_replacement.get("replacementItems") or []
    product_names: list[str] = []
    for line in replacement_lines[:3]:
        if not isinstance(line, dict):
            continue
        name = str(line.get("originalProductName") or line.get("replacementProductName") or "").strip()
        if name:
            product_names.append(name)
    replacement_product_hint = ", ".join(product_names) if product_names else "N/A"
    replacement_reason = str(getattr(r, "reason", "") or "").strip() or "N/A"
    _create_staff_notifications(
        title="Replacement updated",
        message=(
            f"{actor_name} changed replacement {r.replacement_number} to {final_status}. "
            f"Reason: {replacement_reason}. Product Ref: {replacement_product_hint}."
        ),
        notification_type="REPLACEMENT",
        reference_type="replacement",
        reference_id=r.id,
    )
    _send_transactional_email(
        subject=f"Replacement Update: {r.replacement_number} - {final_status}",
        message=(
            f"Replacement status update\n\n"
            f"Replacement: {r.replacement_number}\n"
            f"Order: {getattr(getattr(r, 'order', None), 'order_number', 'N/A')}\n"
            f"Updated by: {actor_name} ({staff_role})\n"
            f"Status: {final_status}\n"
            f"Product(s): {replacement_product_hint}\n"
            f"Reason: {replacement_reason}\n"
            f"{f'Scheduled delivery date: {replacement_delivery_date.isoformat()}\\n' if replacement_delivery_date else ''}"
            f"{f'Notes: {status_notes}\\n' if status_notes else ''}"
        ),
        recipients=_ops_staff_emails(),
    )
    customer_obj = getattr(getattr(r, "order", None), "customer", None)
    _create_customer_notification(
        customer=customer_obj,
        title="Replacement status updated",
        message=(
            f"Replacement {r.replacement_number} is now {final_status}. "
            f"Reason: {replacement_reason}. "
            f"{f'Scheduled delivery date: {replacement_delivery_date.isoformat()}. ' if replacement_delivery_date else ''}"
        ),
        notification_type="REPLACEMENT",
        reference_type="replacement",
        reference_id=r.id,
    )
    customer_email = _normalize_email(getattr(getattr(r, "order", None), "customer", None).email if getattr(r, "order", None) and getattr(r.order, "customer", None) else None)
    if customer_email:
        _send_transactional_email(
            subject=f"Replacement Request Update: {r.replacement_number}",
            message=(
                f"Your replacement request status has been updated.\n\n"
                f"Replacement: {r.replacement_number}\n"
                f"Order: {getattr(getattr(r, 'order', None), 'order_number', 'N/A')}\n"
                f"New status: {normalized_status}\n"
                f"{f'Reason: {status_notes}\\n' if status_notes else ''}"
            ),
            recipients=[customer_email],
        )
    return _ok({"success": True, "replacement": _serialize_replacement(r), "message": "Replacement status updated"})


@require_GET
def order_detail(request: HttpRequest, order_id: str) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    try:
        o = Order.objects.select_related("customer", "timeline").prefetch_related("items__product").get(id=order_id)
    except Order.DoesNotExist:
        return _err("Order not found", 404)
    if p.get("type") == "customer" and p.get("userId") != o.customer_id:
        return _err("Forbidden", 403)
    try:
        if _reconcile_delivered_order_from_completed_drop_point(o, p.get("userId")):
            o = Order.objects.select_related("customer", "timeline").prefetch_related("items__product").get(id=order_id)
    except ValueError as e:
        logger.warning("Unable to reconcile delivered order %s: %s", o.id, e)
    return _ok({"success": True, "order": _serialize_order(o, include_progress=True)})


@csrf_exempt
@require_http_methods(["PATCH"])
def order_status_update(request: HttpRequest, order_id: str) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    body = _json_body(request)
    status = body.get("status")
    rejection_reason = str(body.get("reason") or "").strip()
    if not status:
        return _err("status is required")
    next_status = _normalize_order_status(status)
    allowed_statuses = {
        OrderStatus.PENDING,
        OrderStatus.CONFIRMED,
        OrderStatus.PREPARING,
        OrderStatus.RESCHEDULED,
        OrderStatus.OUT_FOR_DELIVERY,
        OrderStatus.DELIVERED,
        OrderStatus.REJECTED,
        OrderStatus.CANCELLED,
    }
    if next_status not in allowed_statuses:
        return _err("Invalid status", 400)
    try:
        o = Order.objects.get(id=order_id)
    except Order.DoesNotExist:
        return _err("Order not found", 404)

    current_status = _normalize_order_status(o.status)

    if current_status == next_status:
        current = Order.objects.select_related("customer", "timeline").get(id=o.id)
        return _ok({"success": True, "order": _serialize_order(current, include_items=False)})

    if current_status == OrderStatus.DELIVERED and next_status != OrderStatus.DELIVERED:
        return _err("Delivered orders cannot be moved to another status", 400)

    allowed_transitions = {
        OrderStatus.PENDING: {OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.REJECTED, OrderStatus.CANCELLED},
        OrderStatus.CONFIRMED: {OrderStatus.PREPARING, OrderStatus.REJECTED, OrderStatus.CANCELLED},
        OrderStatus.PREPARING: {OrderStatus.OUT_FOR_DELIVERY, OrderStatus.REJECTED, OrderStatus.CANCELLED},
        OrderStatus.RESCHEDULED: {OrderStatus.PREPARING, OrderStatus.OUT_FOR_DELIVERY, OrderStatus.REJECTED, OrderStatus.CANCELLED},
        OrderStatus.OUT_FOR_DELIVERY: {OrderStatus.DELIVERED, OrderStatus.REJECTED, OrderStatus.CANCELLED},
        OrderStatus.DELIVERED: set(),
        OrderStatus.REJECTED: set(),
        OrderStatus.CANCELLED: set(),
    }
    if next_status not in allowed_transitions.get(current_status, set()):
        return _err(f"Invalid transition from {current_status} to {next_status}", 400)

    if next_status == OrderStatus.OUT_FOR_DELIVERY:
        return _err("OUT_FOR_DELIVERY is set automatically when the trip starts", 400)

    try:
        with transaction.atomic():
            if next_status == OrderStatus.DELIVERED:
                _finalize_order_inventory_on_delivery(o, staff.get("userId"))
            elif next_status in {OrderStatus.CANCELLED, OrderStatus.REJECTED}:
                _release_order_reservations(o, staff.get("userId"))

            o.status = next_status
            if rejection_reason:
                existing_notes = str(getattr(o, "notes", "") or "").strip()
                note_line = f"Order Rejected: {rejection_reason}"
                o.notes = f"{existing_notes}\n{note_line}".strip() if existing_notes else note_line
                o.save(update_fields=["status", "notes", "updated_at"])
            else:
                o.save(update_fields=["status", "updated_at"])

            timeline, _ = OrderTimeline.objects.get_or_create(order=o)
            now = timezone.now()
            status_map = {
                "CONFIRMED": "confirmed_at",
                "PREPARING": "processed_at",
                "OUT_FOR_DELIVERY": "shipped_at",
                "DELIVERED": "delivered_at",
                "REJECTED": "cancelled_at",
                "CANCELLED": "cancelled_at",
            }
            field = status_map.get(o.status)
            if field:
                setattr(timeline, field, now)
                timeline.save()
    except ValueError as e:
        return _err(str(e), 400)

    updated = Order.objects.select_related("customer", "timeline").get(id=o.id)
    actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
    _create_staff_notifications(
        title="Order status updated",
        message=f"{actor_name} changed order {updated.order_number} status to {next_status}.",
        notification_type="ORDER",
        reference_type="order",
        reference_id=updated.id,
    )

    if str(staff.get("role") or "").strip().upper() == RoleType.WAREHOUSE_STAFF and next_status == OrderStatus.CONFIRMED:
        _email_order_confirmed_to_customer(updated)
    # Rejection flow from portal actions carries a reason; notify customer by email with order details.
    if rejection_reason and next_status == OrderStatus.REJECTED:
        updated_for_mail = Order.objects.select_related("customer", "timeline").prefetch_related("items__product").get(id=updated.id)
        _email_order_rejected_to_customer(updated_for_mail, rejection_reason)

    return _ok({"success": True, "order": _serialize_order(updated, include_items=False)})


@csrf_exempt
@require_http_methods(["PATCH"])
def order_warehouse_stage_update(request: HttpRequest, order_id: str) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    body = _json_body(request)

    stage = str(body.get("warehouseStage") or "").strip().upper()
    valid_stages = {WarehouseStage.READY_TO_LOAD, WarehouseStage.LOADED, WarehouseStage.DISPATCHED}
    if stage not in valid_stages:
        return _err("warehouseStage is required and must be READY_TO_LOAD, LOADED, or DISPATCHED")

    try:
        order = Order.objects.get(id=order_id)
    except Order.DoesNotExist:
        return _err("Order not found", 404)

    assigned_trip_for_loaded_stage = None
    if staff.get("role") == "DRIVER":
        assigned_trip_for_loaded_stage = (
            Trip.objects.select_related("driver")
            .filter(drop_points__order_id=order.id, driver_id=staff.get("userId"))
            .order_by("-updated_at")
            .first()
        )
        if stage != WarehouseStage.LOADED:
            return _err("Drivers can only mark assigned orders as LOADED", 403)
        if not assigned_trip_for_loaded_stage:
            return _err("This order is not assigned to you", 403)

    current_stage = str(order.warehouse_stage or WarehouseStage.READY_TO_LOAD)
    stage_rank = {
        WarehouseStage.READY_TO_LOAD: 1,
        WarehouseStage.LOADED: 2,
        WarehouseStage.DISPATCHED: 3,
    }
    if stage_rank.get(stage, 0) < stage_rank.get(current_stage, 0):
        return _err("Warehouse stage cannot move backward", 400)

    if stage == WarehouseStage.DISPATCHED:
        return _err("DISPATCHED is set automatically when the trip starts", 400)

    checklist = body.get("checklist") if isinstance(body.get("checklist"), dict) else {}
    resolved_checklist = _resolve_quantity_checklist(checklist)
    if resolved_checklist is not None:
        order.checklist_quantity_verified = resolved_checklist

    if "shortLoadQty" in body:
        order.exception_short_load_qty = max(0, _int(body.get("shortLoadQty"), 0))
    if "damagedOnLoadingQty" in body:
        order.exception_damaged_on_loading_qty = max(0, _int(body.get("damagedOnLoadingQty"), 0))
    if "holdReason" in body:
        order.exception_hold_reason = str(body.get("holdReason") or "").strip() or None
    if "exceptionNotes" in body:
        order.exception_notes = str(body.get("exceptionNotes") or "").strip() or None

    signoff_name = str(body.get("signoffName") or "").strip()

    if stage == WarehouseStage.LOADED:
        if not assigned_trip_for_loaded_stage:
            assigned_trip_for_loaded_stage = (
                Trip.objects.select_related("driver")
                .filter(drop_points__order_id=order.id, driver__isnull=False)
                .order_by("-updated_at")
                .first()
            )
        if not assigned_trip_for_loaded_stage:
            return _err("Order must be assigned to a driver before LOADED", 400)
        if not _warehouse_checklist_complete(order):
            return _err("Quantity checklist must be completed before LOADED", 400)

    if stage == WarehouseStage.DISPATCHED:
        if not _warehouse_checklist_complete(order):
            return _err("Quantity checklist is required before DISPATCHED", 400)
        if str(order.exception_hold_reason or "").strip():
            return _err("Order has hold reason and cannot be dispatched", 400)
        if not signoff_name and not str(order.dispatch_signed_off_by or "").strip():
            return _err("signoffName is required before DISPATCHED", 400)
        if signoff_name:
            order.dispatch_signed_off_by = signoff_name
        order.dispatch_signed_off_user_id = staff.get("userId")
        order.dispatch_signed_off_at = timezone.now()

    now = timezone.now()
    order.warehouse_stage = stage
    if stage == WarehouseStage.READY_TO_LOAD and not order.ready_to_load_at:
        order.ready_to_load_at = now
    if stage == WarehouseStage.LOADED and not order.loaded_at:
        order.loaded_at = now
    if stage == WarehouseStage.DISPATCHED and not order.warehouse_dispatched_at:
        order.warehouse_dispatched_at = now

    if stage == WarehouseStage.LOADED and _normalize_order_status(order.status) in {OrderStatus.PREPARING, OrderStatus.CONFIRMED}:
        order.status = OrderStatus.PREPARING
    if stage == WarehouseStage.DISPATCHED:
        previous_status = _normalize_order_status(order.status)
        order.status = OrderStatus.OUT_FOR_DELIVERY

    with transaction.atomic():
        order.save()
        if stage == WarehouseStage.LOADED and current_stage != WarehouseStage.LOADED:
            _allocate_driver_spare_products_for_loaded_order(
                order,
                getattr(assigned_trip_for_loaded_stage, "driver", None),
            )

    if stage == WarehouseStage.DISPATCHED:
        timeline, _ = OrderTimeline.objects.get_or_create(order=order)
        if not timeline.shipped_at:
            timeline.shipped_at = now
            timeline.save(update_fields=["shipped_at", "updated_at"])
        if previous_status != OrderStatus.OUT_FOR_DELIVERY:
            refreshed_for_email = Order.objects.select_related("customer").filter(id=order.id).first()
            if refreshed_for_email:
                _email_order_out_for_delivery_to_customer(refreshed_for_email)

    serialized_order = _serialize_order(
        Order.objects.select_related("customer", "timeline").get(id=order.id),
        include_items=False,
    )
    actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
    _create_staff_notifications(
        title="Warehouse stage updated",
        message=f"{actor_name} moved order {order.order_number} to warehouse stage {stage}.",
        notification_type="ORDER",
        reference_type="order",
        reference_id=order.id,
    )
    return _ok({"success": True, "order": serialized_order, "message": f"Warehouse stage moved to {stage}"})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def trips_collection(request: HttpRequest) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = (
            Trip.objects.select_related("driver", "vehicle").prefetch_related("drop_points__order").all()
        ).order_by("-created_at")
        tracking_date_raw = str(request.GET.get("trackingDate") or "").strip()
        include_tracking = str(request.GET.get("includeTracking") or "").strip().lower() in {"1", "true", "yes"}
        staff_role = str(staff.get("role") or "").strip().upper()
        staff_user_id = str(staff.get("userId") or "").strip()
        allowed_warehouse_ids: set[str] | None = None
        if staff_role == "WAREHOUSE_STAFF" and staff_user_id:
            allowed_warehouse_ids = set(
                Warehouse.objects.filter(manager_id=staff_user_id).values_list("id", flat=True)
            )
            if not allowed_warehouse_ids:
                return _ok({"success": True, "trips": [], "total": 0, "page": page, "pageSize": size, "totalPages": 0})
            qs = qs.filter(warehouse_id__in=list(allowed_warehouse_ids))
        requested_warehouse_id = str(request.GET.get("warehouseId") or "").strip()
        if requested_warehouse_id:
            if allowed_warehouse_ids is not None and requested_warehouse_id not in allowed_warehouse_ids:
                return _err("Forbidden", 403)
            qs = qs.filter(warehouse_id=requested_warehouse_id)

        tracking_date = None
        if tracking_date_raw:
            try:
                tracking_date = datetime.fromisoformat(tracking_date_raw).date()
            except ValueError:
                return _err("Invalid trackingDate. Expected YYYY-MM-DD")

        if request.GET.get("status"):
            qs = qs.filter(status=request.GET.get("status"))
        if tracking_date:
            qs = qs.filter(
                Q(planned_start_at__date=tracking_date)
                | Q(actual_start_at__date=tracking_date)
                | Q(created_at__date=tracking_date)
                | Q(drop_points__actual_arrival__date=tracking_date)
                | Q(drop_points__actual_departure__date=tracking_date)
                | Q(drop_points__order__timeline__delivery_date__date=tracking_date)
                | Q(location_logs__recorded_at__date=tracking_date)
            ).distinct()
        total = qs.count()
        rows = list(qs[off : off + size])
        serialized_rows = [_serialize_trip(t) for t in rows]

        if include_tracking and serialized_rows:
            trip_ids = [row.get("id") for row in serialized_rows if row.get("id")]
            latest_logs_qs = (
                LocationLog.objects.filter(trip_id__in=trip_ids)
                .order_by("trip_id", "-recorded_at", "-id")
            )

            logs_by_trip: dict[str, list[dict[str, Any]]] = {}
            latest_log_by_trip: dict[str, dict[str, Any]] = {}
            for log in latest_logs_qs:
                if not log.trip_id:
                    continue
                if log.trip_id in latest_log_by_trip:
                    continue
                row = _serialize_model(log)
                latest_log_by_trip[log.trip_id] = row
                logs_by_trip[log.trip_id] = [row]

            for trip_row in serialized_rows:
                trip_id = trip_row.get("id")
                if not trip_id:
                    continue
                trip_row["locationLogs"] = logs_by_trip.get(trip_id, [])
                trip_row["latestLocation"] = latest_log_by_trip.get(trip_id)

        return _ok(
            {
                "success": True,
                "trips": serialized_rows,
                "total": total,
                "page": page,
                "pageSize": size,
                "totalPages": (total + size - 1) // size,
            }
        )
    body = _json_body(request)
    try:
        driver = User.objects.get(id=str(body.get("driverId", "")), role="DRIVER")
        vehicle = Vehicle.objects.get(id=str(body.get("vehicleId", "")))
    except (User.DoesNotExist, Vehicle.DoesNotExist):
        return _err("Driver or vehicle not found", 404)
    requested_order_ids = [str(oid) for oid in (body.get("orderIds") or []) if str(oid).strip()]
    active_assigned_order_ids = set(
        TripDropPoint.objects.filter(
            order_id__in=requested_order_ids,
            status__in=["PENDING", "ARRIVED", "IN_TRANSIT", "IN_PROGRESS"],
        ).values_list("order_id", flat=True)
    )
    if active_assigned_order_ids:
        assigned_orders = list(
            Order.objects.filter(id__in=active_assigned_order_ids).values_list("order_number", flat=True)
        )
        return _err(
            f"Order(s) already assigned to a trip: {', '.join(assigned_orders or sorted(active_assigned_order_ids))}",
            400,
        )

    # Validate vehicle capacity (80% limit)
    vehicle_capacity = float(vehicle.capacity or 0)
    if vehicle_capacity > 0:
        max_capacity_allowed = vehicle_capacity * 0.8  # 80% of capacity
        current_vehicle_usage = _get_vehicle_capacity_usage(vehicle.id)

        # Calculate weight of new orders being assigned
        new_orders_weight = 0.0
        orders_to_assign = Order.objects.filter(id__in=requested_order_ids).prefetch_related("items__product").all()
        for order in orders_to_assign:
            new_orders_weight += _calculate_order_weight(order)

        total_weight_after_assignment = current_vehicle_usage + new_orders_weight

        if total_weight_after_assignment > max_capacity_allowed:
            return _err(
                "Exceed the maximum order weight allowed",
                400,
            )

    planned_start_at = None
    planned_start_raw = str(body.get("plannedStartAt") or "").strip()
    if planned_start_raw:
        try:
            planned_start_at = datetime.fromisoformat(planned_start_raw.replace("Z", "+00:00"))
        except ValueError:
            return _err("Invalid plannedStartAt. Expected ISO date/time (e.g. YYYY-MM-DD)", 400)

    trip = None
    for _ in range(5):
        try:
            with transaction.atomic():
                trip = Trip.objects.create(
                    trip_number=_generate_next_trip_number(),
                    driver=driver,
                    vehicle=vehicle,
                    warehouse_id=body.get("warehouseId"),
                    status=body.get("status") or TripStatus.PLANNED,
                    planned_start_at=planned_start_at,
                    notes=body.get("notes"),
                )
                seq = 1
                for oid in requested_order_ids:
                    order = Order.objects.filter(id=str(oid)).first()
                    if not order:
                        continue
                    drop_latitude = _to_float_or_none(order.shipping_latitude or getattr(order.customer, "latitude", None))
                    drop_longitude = _to_float_or_none(order.shipping_longitude or getattr(order.customer, "longitude", None))
                    TripDropPoint.objects.create(
                        trip=trip,
                        order=order,
                        sequence=seq,
                        location_name=(order.shipping_name or f"Order {order.order_number}"),
                        address=_strip_default_country_suffix(order.shipping_address or "Address"),
                        city=(order.shipping_city or "City"),
                        province=(order.shipping_province or "Province"),
                        zip_code=(order.shipping_zip_code or "00000"),
                        latitude=drop_latitude,
                        longitude=drop_longitude,
                        contact_name=(order.shipping_name or None),
                        contact_phone=(order.shipping_phone or None),
                    )
                    seq += 1
            break
        except IntegrityError:
            trip = None
            continue

    if not trip:
        return _err("Failed to create trip number. Please try again.", 409)

    trip.total_drop_points = trip.drop_points.count()
    trip.save(update_fields=["total_drop_points", "updated_at"])
    trip = Trip.objects.select_related("driver", "vehicle").prefetch_related("drop_points__order").get(id=trip.id)
    actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
    _create_staff_notifications(
        title="Trip created",
        message=f"{actor_name} created trip {trip.trip_number} for driver {driver.name}.",
        notification_type="TRIP",
        reference_type="trip",
        reference_id=trip.id,
    )
    return _ok({"success": True, "trip": _serialize_trip(trip)}, 201)


@csrf_exempt
@require_http_methods(["DELETE", "PATCH"])
def trip_detail(request: HttpRequest, trip_id: str) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err

    trip = Trip.objects.filter(id=trip_id).first()
    if not trip:
        return _err("Trip not found", 404)

    if request.method == "PATCH":
        if str(trip.status or "").upper() != TripStatus.PLANNED:
            return _err("Only planned trips can be edited", 409)
        body = _json_body(request)
        add_order_ids = [str(oid).strip() for oid in (body.get("addOrderIds") or []) if str(oid).strip()]
        remove_drop_point_ids = [str(did).strip() for did in (body.get("removeDropPointIds") or []) if str(did).strip()]

        if not add_order_ids and not remove_drop_point_ids:
            return _err("No trip changes provided", 400)

        terminal_drop_point_statuses = {"COMPLETED", "FAILED", "SKIPPED", "CANCELLED"}

        with transaction.atomic():
            if remove_drop_point_ids:
                drop_points_to_remove = list(
                    TripDropPoint.objects.select_for_update().filter(trip_id=trip.id, id__in=remove_drop_point_ids)
                )
                found_ids = {str(dp.id) for dp in drop_points_to_remove}
                missing_ids = [dpid for dpid in remove_drop_point_ids if dpid not in found_ids]
                if missing_ids:
                    return _err("Some drop points were not found in this trip", 404)
                blocked = [
                    dp for dp in drop_points_to_remove if str(dp.status or "").upper() in terminal_drop_point_statuses
                ]
                if blocked:
                    return _err("Completed/terminal drop points cannot be removed", 409)
                TripDropPoint.objects.filter(id__in=[dp.id for dp in drop_points_to_remove]).delete()

            if add_order_ids:
                existing_order_ids_on_trip = set(
                    TripDropPoint.objects.filter(trip_id=trip.id).values_list("order_id", flat=True)
                )
                duplicate_on_trip = [oid for oid in add_order_ids if oid in existing_order_ids_on_trip]
                if duplicate_on_trip:
                    return _err("Some orders are already in this trip", 409)

                active_assigned_order_ids = set(
                    TripDropPoint.objects.filter(
                        order_id__in=add_order_ids,
                        status__in=["PENDING", "ARRIVED", "IN_TRANSIT", "IN_PROGRESS"],
                    )
                    .exclude(trip_id=trip.id)
                    .values_list("order_id", flat=True)
                )
                if active_assigned_order_ids:
                    assigned_orders = list(
                        Order.objects.filter(id__in=active_assigned_order_ids).values_list("order_number", flat=True)
                    )
                    return _err(
                        f"Order(s) already assigned to another trip: {', '.join(assigned_orders or sorted(active_assigned_order_ids))}",
                        400,
                    )

                orders_map = {
                    str(order.id): order
                    for order in Order.objects.select_related("customer").filter(id__in=add_order_ids)
                }
                missing_order_ids = [oid for oid in add_order_ids if oid not in orders_map]
                if missing_order_ids:
                    return _err("Some orders were not found", 404)

                max_sequence = (
                    TripDropPoint.objects.filter(trip_id=trip.id).aggregate(max_seq=Max("sequence")).get("max_seq") or 0
                )
                next_sequence = int(max_sequence)
                for order_id in add_order_ids:
                    order = orders_map.get(order_id)
                    if not order:
                        continue
                    next_sequence += 1
                    drop_latitude = _to_float_or_none(order.shipping_latitude or getattr(order.customer, "latitude", None))
                    drop_longitude = _to_float_or_none(order.shipping_longitude or getattr(order.customer, "longitude", None))
                    TripDropPoint.objects.create(
                        trip=trip,
                        order=order,
                        sequence=next_sequence,
                        status="PENDING",
                        location_name=(order.shipping_name or f"Order {order.order_number}"),
                        address=_strip_default_country_suffix(order.shipping_address or "Address"),
                        city=(order.shipping_city or "City"),
                        province=(order.shipping_province or "Province"),
                        zip_code=(order.shipping_zip_code or "00000"),
                        latitude=drop_latitude,
                        longitude=drop_longitude,
                        contact_name=(order.shipping_name or None),
                        contact_phone=(order.shipping_phone or None),
                    )

            reordered_drop_points = list(TripDropPoint.objects.filter(trip_id=trip.id).order_by("sequence", "id"))
            for idx, point in enumerate(reordered_drop_points, start=1):
                if point.sequence != idx:
                    point.sequence = idx
            if reordered_drop_points:
                TripDropPoint.objects.bulk_update(reordered_drop_points, ["sequence"])

            total_drop_points = TripDropPoint.objects.filter(trip_id=trip.id).count()
            completed_drop_points = TripDropPoint.objects.filter(
                trip_id=trip.id,
                status__in=list(terminal_drop_point_statuses),
            ).count()
            trip.total_drop_points = total_drop_points
            trip.completed_drop_points = completed_drop_points
            trip.save(update_fields=["total_drop_points", "completed_drop_points", "updated_at"])

        actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
        _create_staff_notifications(
            title="Trip updated",
            message=(
                f"{actor_name} updated trip {trip.trip_number}: "
                f"+{len(add_order_ids)} added, -{len(remove_drop_point_ids)} removed."
            ),
            notification_type="TRIP",
            reference_type="trip",
            reference_id=trip.id,
        )
        trip = Trip.objects.select_related("driver", "vehicle").prefetch_related("drop_points__order").get(id=trip.id)
        return _ok({"success": True, "trip": _serialize_trip(trip)})

    if str(trip.status or "").upper() != TripStatus.PLANNED:
        return _err("Only planned trips can be deleted", 409)

    trip_number = trip.trip_number
    trip.delete()
    actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
    _create_staff_notifications(
        title="Trip deleted",
        message=f"{actor_name} deleted trip {trip_number}.",
        notification_type="TRIP",
        reference_type="trip",
        reference_id=trip_id,
    )
    return _ok({"success": True, "message": f"Trip {trip_number} deleted"})


@require_GET
def driver_trips(request: HttpRequest) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    if p.get("role") != "DRIVER":
        return _err("Forbidden", 403)
    d = User.objects.filter(id=p.get("userId"), role="DRIVER").first()
    if not d:
        return _err("Driver profile not found", 404)
    drop_points_prefetch = Prefetch(
        "drop_points",
        queryset=TripDropPoint.objects.select_related(
            "order",
            "order__customer",
            "order__timeline",
        ).prefetch_related(
            "order__items__product",
        ).order_by("sequence"),
    )
    page, size, off = _pagination(request)
    qs = (
        Trip.objects.select_related("driver", "vehicle")
        .prefetch_related(drop_points_prefetch)
        .filter(driver=d)
        .order_by("-updated_at")
    )
    total = qs.count()
    rows = list(qs[off : off + size])

    trip_ids = [trip.id for trip in rows]
    latest_log_by_trip: dict[str, LocationLog] = {}
    if trip_ids:
        logs = LocationLog.objects.filter(trip_id__in=trip_ids).order_by("trip_id", "-recorded_at")
        for log in logs:
            if not log.trip_id:
                continue
            if log.trip_id not in latest_log_by_trip:
                latest_log_by_trip[log.trip_id] = log

    payload_rows: list[dict[str, Any]] = []
    for trip in rows:
        row = _serialize_trip(trip)
        latest_log = latest_log_by_trip.get(trip.id)
        row["latestLocation"] = (
            {
                "latitude": float(latest_log.latitude),
                "longitude": float(latest_log.longitude),
                "accuracy": float(latest_log.accuracy) if latest_log.accuracy is not None else None,
                "heading": float(latest_log.heading) if latest_log.heading is not None else None,
                "recordedAt": latest_log.recorded_at.isoformat() if latest_log.recorded_at else None,
            }
            if latest_log
            else None
        )
        payload_rows.append(row)

    return _ok(
        {
            "success": True,
            "trips": payload_rows,
            "total": total,
            "page": page,
            "pageSize": size,
            "totalPages": (total + size - 1) // size,
        }
    )


@csrf_exempt
@require_http_methods(["GET", "POST"])
def customer_orders(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p or p.get("type") != "customer":
        return _err("Unauthorized", 401)
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = _real_orders(
            Order.objects.select_related("customer", "timeline")
            .prefetch_related("items__product")
            .filter(customer_id=p.get("userId"))
        ).order_by("-created_at")
        total = qs.count()
        rows = list(qs[off : off + size])
        return _ok({"success": True, "orders": [_serialize_order(x) for x in rows], "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    body = _json_body(request)
    body["customerId"] = p.get("userId")
    request._body = json.dumps(body).encode("utf-8")
    return orders_collection(request)


@csrf_exempt
@require_http_methods(["PATCH"])
def customer_order_cancel(request: HttpRequest, order_id: str) -> JsonResponse:
    p = _require_auth(request)
    if not p or p.get("type") != "customer":
        return _err("Unauthorized", 401)
    try:
        o = Order.objects.get(id=order_id, customer_id=p.get("userId"))
    except Order.DoesNotExist:
        return _err("Order not found", 404)
    if o.status in {OrderStatus.PREPARING, OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.REJECTED}:
        return _err("Order cannot be cancelled", 400)

    with transaction.atomic():
        _release_order_reservations(o, p.get("userId"))
        o.status = OrderStatus.CANCELLED
        o.save(update_fields=["status", "updated_at"])
        timeline, _ = OrderTimeline.objects.get_or_create(order=o)
        timeline.cancelled_at = timezone.now()
        timeline.save()

    return _ok({"success": True, "order": _serialize_order(o, include_items=False)})


@require_GET
def replacements_collection(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    page, size, off = _pagination(request)
    qs = Replacement.objects.select_related("order", "order__customer")

    if p.get("type") == "customer":
        qs = qs.filter(order__in=_real_orders(Order.objects.all()))
        qs = qs.filter(customer_id=p.get("userId"))
    elif p.get("type") == "staff":
        staff_role = str(p.get("role") or "").strip().upper()
        staff_user_id = str(p.get("userId") or "").strip()
        allowed_warehouse_ids: set[str] | None = None
        if staff_role == "WAREHOUSE_STAFF" and staff_user_id:
            allowed_warehouse_ids = set(
                Warehouse.objects.filter(manager_id=staff_user_id).values_list("id", flat=True)
            )
            if not allowed_warehouse_ids:
                return _ok({"success": True, "replacements": [], "total": 0, "page": page, "pageSize": size, "totalPages": 0})
            qs = qs.filter(order__warehouse_id__in=list(allowed_warehouse_ids))
    else:
        return _err("Forbidden", 403)

    warehouse_id = str(request.GET.get("warehouseId") or "").strip()
    if warehouse_id:
        if p.get("type") == "staff":
            staff_role = str(p.get("role") or "").strip().upper()
            if staff_role == "WAREHOUSE_STAFF":
                allowed_warehouse_ids = set(
                    Warehouse.objects.filter(manager_id=str(p.get("userId") or "").strip()).values_list("id", flat=True)
                )
                if warehouse_id not in allowed_warehouse_ids:
                    return _err("Forbidden", 403)
        qs = qs.filter(order__warehouse_id=warehouse_id)

    order_id = str(request.GET.get("orderId") or "").strip()
    if order_id:
        qs = qs.filter(order_id=order_id)

    status = str(request.GET.get("status") or "").strip().upper()
    if status:
        qs = qs.filter(status=status)

    q = str(request.GET.get("search") or "").strip()
    if q:
        qs = qs.filter(
            Q(replacement_number__icontains=q)
            | Q(order__order_number__icontains=q)
            | Q(order__customer__name__icontains=q)
            | Q(reason__icontains=q)
        )

    qs = qs.order_by("-created_at")
    total = qs.count()
    rows = list(qs[off : off + size])
    return _ok(
        {
            "success": True,
            "replacements": [_serialize_replacement(x) for x in rows],
            "total": total,
            "page": page,
            "pageSize": size,
            "totalPages": (total + size - 1) // size,
        }
    )


@csrf_exempt
@require_http_methods(["GET", "POST"])
def customer_replacements(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p or p.get("type") != "customer":
        return _err("Unauthorized", 401)
    if request.method == "GET":
        return replacements_collection(request)

    body = _json_body(request)
    order_id = str(body.get("orderId") or "").strip()
    if not order_id:
        return _err("orderId is required", 400)
    order = (
        Order.objects.select_related("customer")
        .prefetch_related("items__product")
        .filter(id=order_id, customer_id=p.get("userId"))
        .first()
    )
    if not order:
        return _err("Order not found", 404)

    normalized_order_status = _normalize_order_status(getattr(order, "status", None))
    if normalized_order_status != OrderStatus.DELIVERED:
        return _err("Replacement request is only allowed for delivered orders", 400)

    number_damaged_items = max(0, _int(body.get("numberDamagedItems"), 0))
    if number_damaged_items <= 0:
        return _err("numberDamagedItems must be greater than zero", 400)
    damage_type = str(body.get("damageType") or body.get("reason") or "").strip()
    if not damage_type:
        return _err("reason/type of damage is required", 400)
    evidence_list_raw = body.get("evidence") if isinstance(body.get("evidence"), list) else []
    evidence_list = [str(item).strip() for item in evidence_list_raw if str(item).strip()]
    primary_evidence = str(body.get("evidencePrimary") or body.get("damagePhoto") or "").strip()
    if primary_evidence and primary_evidence not in evidence_list:
        evidence_list.insert(0, primary_evidence)
    if not evidence_list:
        return _err("At least one evidence file is required", 400)

    count = Replacement.objects.count() + 1
    now = timezone.now()
    meta = {
        "submittedBy": "CUSTOMER",
        "submittedAt": now.isoformat(),
        "numberDamagedItems": number_damaged_items,
        "damageType": damage_type,
        "evidence": evidence_list,
        "statusTimeline": [
            {"status": ReplacementStatus.PENDING, "at": now.isoformat(), "by": str(order.customer_id)},
        ],
    }
    replacement = Replacement.objects.create(
        replacement_number=f"RET-{timezone.now().year}-{str(count).zfill(4)}",
        order=order,
        customer_id=order.customer_id,
        reason=damage_type,
        description=str(body.get("description") or "Customer replacement request").strip() or "Customer replacement request",
        status=ReplacementStatus.PENDING,
        requested_by="CUSTOMER",
        replacement_mode="CUSTOMER_SUBMITTED",
        replacement_quantity=number_damaged_items,
        damage_photo_url=evidence_list[0],
        damage_photo_urls=json.dumps(evidence_list),
        notes=f"Customer-submitted replacement request\nMeta: {json.dumps(meta)}",
    )
    customer_name = str(getattr(order.customer, "name", "") or "Customer").strip()
    product_name_match = re.search(r"\[([^\]]+)\]", str(replacement.description or ""))
    product_hint = str(product_name_match.group(1) if product_name_match else "").strip() or "N/A"
    description_hint = str(replacement.description or "").strip() or "N/A"
    _create_staff_notifications(
        title="New replacement request",
        message=(
            f"{customer_name} submitted replacement request {replacement.replacement_number} for order {order.order_number}. "
            f"Product: {product_hint}. Reason: {damage_type}. Details: {description_hint}."
        ),
        notification_type="REPLACEMENT",
        reference_type="replacement",
        reference_id=replacement.id,
    )
    _create_customer_notification(
        customer=order.customer,
        title="Replacement request submitted",
        message=(
            f"Replacement request {replacement.replacement_number} was submitted. "
            f"Product: {product_hint}. Reason: {damage_type}. "
            "You will be notified once admin reviews and approves/rejects it."
        ),
        notification_type="REPLACEMENT",
        reference_type="replacement",
        reference_id=replacement.id,
    )
    _send_transactional_email(
        subject=f"New Replacement Request: {replacement.replacement_number}",
        message=(
            f"A customer submitted a replacement request.\n\n"
            f"Replacement: {replacement.replacement_number}\n"
            f"Order: {order.order_number}\n"
            f"Customer: {customer_name}\n"
            f"Product: {product_hint}\n"
            f"Damaged items: {number_damaged_items}\n"
            f"Damage type: {damage_type}\n"
            f"Details: {description_hint}\n"
        ),
        recipients=_ops_staff_emails(),
    )
    return _ok({"success": True, "replacement": _serialize_replacement(replacement)}, 201)


@require_GET
def customer_tracking(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p or p.get("type") != "customer":
        return _err("Unauthorized", 401)
    orders = list(
        _real_orders(Order.objects.select_related("customer").filter(customer_id=p.get("userId")))
        .order_by("-updated_at")[:100]
    )
    order_ids = [o.id for o in orders]

    latest_drop_point_by_order: dict[str, TripDropPoint] = {}
    trip_ids: set[str] = set()
    if order_ids:
        drop_points = (
            TripDropPoint.objects.select_related("trip__driver", "trip__vehicle")
            .filter(order_id__in=order_ids)
            .order_by("order_id", "-trip__updated_at", "-updated_at")
        )
        for drop_point in drop_points:
            if not drop_point.order_id:
                continue
            if drop_point.order_id in latest_drop_point_by_order:
                continue
            latest_drop_point_by_order[drop_point.order_id] = drop_point
            if drop_point.trip_id:
                trip_ids.add(drop_point.trip_id)

    latest_log_by_trip: dict[str, LocationLog] = {}
    if trip_ids:
        logs = LocationLog.objects.filter(trip_id__in=list(trip_ids)).order_by("trip_id", "-recorded_at")
        for log in logs:
            if not log.trip_id:
                continue
            if log.trip_id not in latest_log_by_trip:
                latest_log_by_trip[log.trip_id] = log

    tracking: list[dict[str, Any]] = []
    for o in orders:
        drop_point = latest_drop_point_by_order.get(o.id)
        trip = drop_point.trip if drop_point else None
        latest_log = latest_log_by_trip.get(trip.id) if trip else None
        normalized_order_status = _normalize_order_status(o.status)

        driver_lat = _to_float_or_none(getattr(latest_log, "latitude", None))
        driver_lng = _to_float_or_none(getattr(latest_log, "longitude", None))
        drop_lat = _to_float_or_none(getattr(drop_point, "latitude", None))
        drop_lng = _to_float_or_none(getattr(drop_point, "longitude", None))
        shipping_lat = _to_float_or_none(o.shipping_latitude or getattr(o.customer, "latitude", None))
        shipping_lng = _to_float_or_none(o.shipping_longitude or getattr(o.customer, "longitude", None))

        if driver_lat is not None and driver_lng is not None:
            latitude = driver_lat
            longitude = driver_lng
            source = "driver_gps"
        elif drop_lat is not None and drop_lng is not None:
            latitude = drop_lat
            longitude = drop_lng
            source = "trip_stop"
        elif shipping_lat is not None and shipping_lng is not None:
            latitude = shipping_lat
            longitude = shipping_lng
            source = "shipping_address"
        else:
            latitude = None
            longitude = None
            source = "unavailable"

        route_points = []
        if latest_log:
            log_lat = _to_float_or_none(getattr(latest_log, "latitude", None))
            log_lng = _to_float_or_none(getattr(latest_log, "longitude", None))
            if log_lat is not None and log_lng is not None:
                route_points.append(
                    {
                        "latitude": float(log_lat),
                        "longitude": float(log_lng),
                        "recordedAt": latest_log.recorded_at.isoformat() if latest_log.recorded_at else None,
                    }
                )

        driver_name = None
        driver_phone = None
        driver_avatar = None
        trip_number = None
        if trip:
            trip_number = trip.trip_number
            if getattr(trip, "driver", None):
                driver_name = getattr(trip.driver, "name", None) or getattr(getattr(trip.driver, "user", None), "name", None)
                driver_phone = getattr(trip.driver, "phone", None) or getattr(getattr(trip.driver, "user", None), "phone", None)
                driver_avatar = getattr(getattr(trip.driver, "user", None), "avatar", None)

        eta_minutes: int | None = None
        eta_arrival_at: str | None = None
        destination_lat = drop_lat if drop_lat is not None else shipping_lat
        destination_lng = drop_lng if drop_lng is not None else shipping_lng
        if (
            normalized_order_status == OrderStatus.OUT_FOR_DELIVERY
            and driver_lat is not None
            and driver_lng is not None
            and destination_lat is not None
            and destination_lng is not None
        ):
            remaining_distance_km = _haversine_km(float(driver_lat), float(driver_lng), float(destination_lat), float(destination_lng))
            speed_kph = 24.0
            speed_kph = min(max(float(speed_kph), 10.0), 70.0)
            computed_eta = int(math.ceil((remaining_distance_km / speed_kph) * 60)) if remaining_distance_km > 0 else 1
            eta_minutes = max(1, computed_eta)
            eta_arrival_at = (timezone.now() + timedelta(minutes=eta_minutes)).isoformat()

        tracking.append(
            {
                "orderId": o.id,
                "orderNumber": o.order_number,
                "status": normalized_order_status,
                "orderStatus": normalized_order_status,
                "updatedAt": (
                    latest_log.recorded_at.isoformat()
                    if latest_log and latest_log.recorded_at
                    else (o.updated_at.isoformat() if o.updated_at else None)
                ),
                "tripNumber": trip_number,
                "driverName": driver_name,
                "driverPhone": driver_phone,
                "driverAvatar": driver_avatar,
                "latitude": latitude,
                "longitude": longitude,
                "source": source,
                "destinationLatitude": drop_lat if drop_lat is not None else shipping_lat,
                "destinationLongitude": drop_lng if drop_lng is not None else shipping_lng,
                "etaMinutes": eta_minutes,
                "etaArrivalAt": eta_arrival_at,
                "recipientName": getattr(drop_point, "recipient_name", None),
                "deliveryPhoto": getattr(drop_point, "delivery_photo", None),
                "deliveredMessage": "Your order has been delivered." if normalized_order_status == OrderStatus.DELIVERED else None,
                "routePoints": route_points,
                "trip": _serialize_trip(trip, include_points=False) if trip else None,
            }
        )
    return _ok({"success": True, "tracking": tracking})


@csrf_exempt
@require_http_methods(["POST"])
def driver_location(request: HttpRequest) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    if p.get("role") != "DRIVER":
        return _err("Forbidden", 403)
    d = User.objects.filter(id=p.get("userId"), role="DRIVER").first()
    if not d:
        return _err("Driver not found", 404)
    body = _json_body(request)
    lat = _to_float_or_none(body.get("latitude"))
    lng = _to_float_or_none(body.get("longitude"))
    if lat is None or lng is None:
        return _err("Invalid coordinates")
    accuracy = _to_float_or_none(body.get("accuracy"))
    heading = _to_float_or_none(body.get("heading"))
    altitude = _to_float_or_none(body.get("altitude"))
    requested_trip_id = str(body.get("tripId") or "").strip()
    active_statuses = {"IN_PROGRESS", "IN_TRANSIT", "OUT_FOR_DELIVERY"}
    active_trip = Trip.objects.filter(driver_id=d.id, status__in=list(active_statuses)).order_by("-updated_at").first()
    trip_id = None
    trip_resolution = "none"
    if requested_trip_id:
        requested_trip = Trip.objects.filter(id=requested_trip_id, driver_id=d.id).first()
        # Always attach to the explicitly requested trip when it belongs to this driver.
        # This prevents logs from being saved without trip linkage during status transitions.
        if requested_trip:
            trip_id = requested_trip.id
            trip_resolution = "requested_trip_matched_driver"
        elif active_trip:
            trip_id = active_trip.id
            trip_resolution = "fallback_active_trip"
    else:
        trip_id = active_trip.id if active_trip else None
        trip_resolution = "auto_active_trip" if trip_id else "none"
    with transaction.atomic():
        log = (
            LocationLog.objects.select_for_update()
            .filter(driver_id=d.id)
            .order_by("-recorded_at", "-id")
            .first()
        )
        now = timezone.now()
        if log:
            log.trip_id = trip_id
            log.latitude = lat
            log.longitude = lng
            log.heading = heading
            log.altitude = altitude
            log.accuracy = accuracy
            log.battery = body.get("battery")
            log.recorded_at = now
            log.save(
                update_fields=[
                    "trip_id",
                    "latitude",
                    "longitude",
                    "heading",
                    "altitude",
                    "accuracy",
                    "battery",
                    "recorded_at",
                ]
            )
        else:
            log = LocationLog.objects.create(
                driver_id=d.id,
                trip_id=trip_id,
                latitude=lat,
                longitude=lng,
                heading=heading,
                altitude=altitude,
                accuracy=accuracy,
                battery=body.get("battery"),
                recorded_at=now,
            )

        # Keep latest-only location state per driver (no history).
        LocationLog.objects.filter(driver_id=d.id).exclude(id=log.id).delete()
    return _ok({
        "success": True,
        "locationLogId": log.id,
        "tripIdUsed": trip_id,
        "tripIdRequested": requested_trip_id or None,
        "tripResolution": trip_resolution,
    })


@csrf_exempt
@require_http_methods(["GET", "PUT"])
def driver_profile(request: HttpRequest) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    if p.get("role") != "DRIVER":
        return _err("Forbidden", 403)
    d = User.objects.filter(id=p.get("userId"), role="DRIVER").first()
    if not d:
        return _err("Driver profile not found", 404)
    if request.method == "GET":
        row = _serialize_model(d, exclude={"password"})
        row["phone"] = d.phone
        row["user"] = _serialize_model(d, exclude={"password"})
        return _ok({"success": True, "driver": row})
    body = _json_body(request)
    for key, attr in [
        ("emergencyContact", "emergency_contact"),
        ("licenseNumber", "license_number"),
        ("licenseType", "license_type"),
        ("licensePhotoUrl", "license_photo_url"),
    ]:
        if key in body:
            setattr(d, attr, body.get(key))
    if "licenseExpiry" in body and body.get("licenseExpiry"):
        d.license_expiry = datetime.fromisoformat(str(body["licenseExpiry"]).replace("Z", "+00:00"))
    d.save()
    for key, attr in [("name", "name"), ("phone", "phone"), ("avatar", "avatar")]:
        if key in body:
            setattr(d, attr, body.get(key))
    d.save()
    row = _serialize_model(d, exclude={"password"})
    row["phone"] = d.phone
    row["user"] = _serialize_model(d, exclude={"password"})
    return _ok({"success": True, "driver": row})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def driver_spare_products(request: HttpRequest) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    if p.get("role") != "DRIVER":
        return _err("Forbidden", 403)
    d = User.objects.filter(id=p.get("userId"), role="DRIVER").first()
    if not d:
        return _err("Driver not found", 404)
    if request.method == "GET":
        rows = (
            DriverSpareStock.objects.select_related("product")
            .filter(driver_id=d.id, product__in=_real_products(Product.objects.all()))
            .order_by("product__name")
        )
        data = []
        for x in rows:
            row = _serialize_model(x, include={"product": lambda o: _serialize_model(o.product)})
            row["quantity"] = _int(getattr(x, "on_hand_quantity", 0), 0)
            row["minQuantity"] = _int(getattr(x, "minimum_required_quantity", 0), 0)
            data.append(row)
        return _ok({"success": True, "spareProducts": data})
    body = _json_body(request)
    pid = str(body.get("productId") or "")
    qty = _int(body.get("quantity"), 0)
    if not pid or qty == 0:
        return _err("productId and non-zero quantity are required")
    prod = Product.objects.filter(id=pid).first()
    if not prod:
        return _err("Product not found", 404)
    stock, _ = DriverSpareStock.objects.get_or_create(driver_id=d.id, product=prod, defaults={"on_hand_quantity": 0, "minimum_required_quantity": 0})
    stock.on_hand_quantity += qty
    if "minQuantity" in body:
        stock.minimum_required_quantity = _int(body.get("minQuantity"), stock.minimum_required_quantity)
    stock.save()
    InventoryTransaction.objects.create(driver_id=d.id, product=prod, type=body.get("type") or ("IN" if qty > 0 else "OUT"), quantity=qty, reference_type=body.get("referenceType"), reference_id=body.get("referenceId"), notes=body.get("notes"))
    serialized = _serialize_model(stock)
    serialized["quantity"] = _int(getattr(stock, "on_hand_quantity", 0), 0)
    serialized["minQuantity"] = _int(getattr(stock, "minimum_required_quantity", 0), 0)
    return _ok({"success": True, "spareProducts": serialized})


@csrf_exempt
@require_http_methods(["POST"])
def driver_replacements_from_spare_products(request: HttpRequest) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    if p.get("role") != "DRIVER":
        return _err("Forbidden", 403)
    d = User.objects.filter(id=p.get("userId"), role="DRIVER").first()
    if not d:
        return _err("Driver not found", 404)
    body = _json_body(request)
    pickup_address_error = _ensure_negros_occidental_address(
        latitude=None,
        longitude=None,
        city=body.get("pickupCity"),
        province=body.get("pickupProvince"),
        require_coordinates=False,
    )
    if pickup_address_error:
        return _err(pickup_address_error, 400)
    outcome = str(body.get("outcome") or "RESOLVED").strip().upper()
    if outcome not in {"RESOLVED", "PARTIALLY_REPLACED"}:
        return _err("outcome is required and must be RESOLVED or PARTIALLY_REPLACED")
    resolved_on_delivery = outcome == "RESOLVED"

    follow_up_return_id = str(body.get("followUpReturnId") or "").strip()
    follow_up_return = None
    if follow_up_return_id:
        follow_up_return = Replacement.objects.select_related("order").filter(id=follow_up_return_id).first()

    damage_photo = str(body.get("damagePhoto") or "").strip() or None
    damage_photos_raw = body.get("damagePhotos") if isinstance(body.get("damagePhotos"), list) else []
    damage_photos = [str(x).strip() for x in damage_photos_raw if str(x).strip()]
    if damage_photo and damage_photo not in damage_photos:
        damage_photos.insert(0, damage_photo)
    if not damage_photos:
        return _err("At least one damage photo is required", 400)

    def _resolve_inventory_rows_for_replacement(product: Product, order: Order | None) -> list[Inventory]:
        inventory_qs = Inventory.objects.select_related("warehouse").filter(product=product, quantity__gt=0)
        preferred_warehouse_id = str(getattr(order, "warehouse_id", "") or "").strip() if order else ""
        rows = list(inventory_qs)
        if preferred_warehouse_id:
            rows.sort(
                key=lambda inv: (
                    0 if str(getattr(inv, "warehouse_id", "") or "").strip() == preferred_warehouse_id else 1,
                    -_int(getattr(inv, "quantity", 0), 0),
                    str(getattr(inv, "id", "")),
                )
            )
        else:
            rows.sort(
                key=lambda inv: (
                    -_int(getattr(inv, "quantity", 0), 0),
                    str(getattr(inv, "id", "")),
                )
            )
        return rows

    def _deduct_from_inventory(
        *,
        product: Product,
        order: Order | None,
        required_qty: int,
        reference_id: str,
    ) -> tuple[int, list[tuple[str, int]]]:
        remaining = max(0, _int(required_qty, 0))
        if remaining <= 0:
            return 0, []

        normalized_unit = _normalize_product_unit(getattr(product, "unit", None))
        quantity_per_case = max(1, _int(getattr(product, "quantity_per_unit", 0), 1))
        used_total = 0
        allocations: list[tuple[str, int]] = []
        inventory_rows = _resolve_inventory_rows_for_replacement(product, order)
        for inv in inventory_rows:
            if remaining <= 0:
                break
            available_cases = max(0, _int(getattr(inv, "quantity", 0), 0))
            available_loose_bottles = max(0, _int(getattr(inv, "loose_bottles", 0), 0))
            if normalized_unit == PRODUCT_UNIT_BOTTLE:
                available_total = available_cases
            else:
                available_total = (available_cases * quantity_per_case) + available_loose_bottles
            if available_total <= 0:
                continue

            take_qty = min(available_total, remaining)
            if take_qty <= 0:
                continue

            if normalized_unit == PRODUCT_UNIT_BOTTLE:
                inv.quantity = max(0, available_cases - take_qty)
                inv.save(update_fields=["quantity", "updated_at"])
            else:
                bottles_to_take = take_qty
                # Consume loose bottles first.
                consume_loose = min(available_loose_bottles, bottles_to_take)
                available_loose_bottles -= consume_loose
                bottles_to_take -= consume_loose
                # Then consume full cases as needed.
                if bottles_to_take > 0:
                    cases_needed = math.ceil(bottles_to_take / max(1, quantity_per_case))
                    cases_used = min(available_cases, cases_needed)
                    available_cases -= cases_used
                    bottles_from_cases = cases_used * quantity_per_case
                    # If we opened extra bottles from the last case, put remainder back as loose bottles.
                    extra_bottles = max(bottles_from_cases - bottles_to_take, 0)
                    available_loose_bottles += extra_bottles
                inv.quantity = max(0, available_cases)
                inv.loose_bottles = max(0, available_loose_bottles)
                inv.save(update_fields=["quantity", "loose_bottles", "updated_at"])

            InventoryTransaction.objects.create(
                warehouse=inv.warehouse,
                product=product,
                type="OUT",
                quantity=take_qty,
                reference_type="replacement",
                reference_id=reference_id,
                notes="Replacement quantity deducted from warehouse inventory",
                performed_by=p.get("userId"),
            )
            used_total += take_qty
            remaining -= take_qty
            allocations.append((str(inv.warehouse_id or ""), take_qty))
        return used_total, allocations

    replacement_lines_raw = body.get("items") if isinstance(body.get("items"), list) else []
    if replacement_lines_raw and not follow_up_return:
        order_id = str(body.get("orderId") or "").strip()
        order = Order.objects.filter(id=order_id).first()
        if not order:
            return _err("orderId is required")
        if str(getattr(order, "order_number", "") or "").strip().upper().startswith("RPL-"):
            return _err("You cannot request replacement for a replacement order", 400)
        replacement_lines: list[dict[str, Any]] = []
        has_partial_line = False
        for index, raw_line in enumerate(replacement_lines_raw, start=1):
            if not isinstance(raw_line, dict):
                return _err(f"Replacement item {index} is invalid", 400)
            order_item_id = str(raw_line.get("orderItemId") or "").strip()
            order_item = OrderItem.objects.select_related("order", "product").filter(id=order_item_id, order_id=order.id).first()
            if not order_item:
                return _err(f"Replacement item {index} was not found on this order", 400)
            quantity_per_case = max(1, _int(
                raw_line.get("quantityPerCase"),
                _int(getattr(order_item.product, "quantity_per_unit", 0), 1),
            ))
            replacement_cases = max(0, _int(raw_line.get("replacementCases"), 0))
            replacement_bottles = max(0, _int(raw_line.get("replacementBottles"), 0))
            line_total_bottles = (replacement_cases * quantity_per_case) + replacement_bottles
            fallback_line_qty = _int(raw_line.get("quantityToReplace", raw_line.get("quantity")), 0)
            quantity_to_replace = line_total_bottles if line_total_bottles > 0 else fallback_line_qty
            if quantity_to_replace <= 0:
                return _err(f"Replacement item {index} quantity to replace must be greater than zero", 400)
            ordered_cases = _int(order_item.quantity, 0)
            max_ordered_bottles = ordered_cases * quantity_per_case
            if quantity_to_replace > max_ordered_bottles:
                return _err(f"Replacement item {index} bottle quantity cannot exceed ordered case quantity", 400)
            quantity_replaced = quantity_to_replace if resolved_on_delivery else _int(raw_line.get("quantityReplaced", raw_line.get("partiallyReplacedQuantity")), 0)
            if quantity_replaced < 0:
                return _err(f"Replacement item {index} quantity replaced cannot be negative", 400)
            if quantity_replaced > quantity_to_replace:
                return _err(f"Replacement item {index} quantity replaced cannot exceed quantity to replace", 400)
            if outcome == "PARTIALLY_REPLACED" and quantity_replaced < quantity_to_replace:
                has_partial_line = True
            if resolved_on_delivery and quantity_replaced <= 0:
                return _err(f"Replacement item {index} quantity replaced must be greater than zero", 400)
            stock = DriverSpareStock.objects.filter(driver_id=d.id, product=order_item.product).first()
            available_units = _int(getattr(stock, "on_hand_quantity", 0), 0)
            available_spare_bottles = max(0, available_units * quantity_per_case)
            if resolved_on_delivery and quantity_to_replace > available_spare_bottles:
                return _err(
                    f"Replacement item {index} quantity to replace cannot exceed replacement stock ({available_spare_bottles}) in RESOLVED mode",
                    400,
                )
            if outcome == "PARTIALLY_REPLACED" and quantity_replaced > available_spare_bottles:
                return _err(
                    f"Replacement item {index} quantity replaced cannot exceed replacement stock ({available_spare_bottles}) in PARTIALLY_REPLACED mode",
                    400,
                )
            inventory_rows = _resolve_inventory_rows_for_replacement(order_item.product, order)
            product_unit = _normalize_product_unit(getattr(order_item.product, "unit", None))
            available_inventory_qty = 0
            for inv in inventory_rows:
                cases_qty = max(0, _int(getattr(inv, "quantity", 0), 0))
                loose_qty = max(0, _int(getattr(inv, "loose_bottles", 0), 0))
                if product_unit == PRODUCT_UNIT_BOTTLE:
                    available_inventory_qty += cases_qty
                else:
                    available_inventory_qty += (cases_qty * quantity_per_case) + loose_qty
            if quantity_replaced > (available_spare_bottles + available_inventory_qty):
                return _err(
                    f"Insufficient replacement stock for {order_item.product.name}. "
                    f"Needed {quantity_replaced}, available spare {available_spare_bottles}, inventory {available_inventory_qty}",
                    400,
                )
            replacement_lines.append({
                "orderItem": order_item,
                "product": order_item.product,
                "stock": stock,
                "availableQty": available_units,
                "availableSpareBottles": available_spare_bottles,
                "availableInventoryQty": available_inventory_qty,
                "quantityToReplace": quantity_to_replace,
                "quantityReplaced": quantity_replaced,
                "replacementCases": replacement_cases,
                "replacementBottles": replacement_bottles,
                "quantityPerCase": quantity_per_case,
            })
        if not replacement_lines:
            return _err("At least one replacement item is required", 400)
        if outcome == "PARTIALLY_REPLACED" and not has_partial_line:
            return _err(
                "PARTIALLY_REPLACED requires at least one item with quantity replaced less than quantity to replace",
                400,
            )

        replacement_status = ReplacementStatus.RESOLVED_ON_DELIVERY if resolved_on_delivery else ReplacementStatus.NEEDS_FOLLOW_UP
        replacement_mode = (
            REPLACEMENT_MODE_SPARE_PRODUCTS_IMMEDIATE
            if resolved_on_delivery
            else REPLACEMENT_MODE_SPARE_PRODUCTS_PARTIAL
        )
        created_returns = []
        with transaction.atomic():
            count = Replacement.objects.count() + 1
            for offset, line in enumerate(replacement_lines):
                quantity_to_replace = line["quantityToReplace"]
                quantity_replaced = line["quantityReplaced"]
                replacement_cases = line["replacementCases"]
                replacement_bottles = line["replacementBottles"]
                quantity_per_case = line["quantityPerCase"]
                product = line["product"]
                order_item = line["orderItem"]
                remaining_qty_to_deduct = quantity_replaced
                deducted_from_spare = 0
                deducted_from_inventory = 0
                if quantity_replaced > 0:
                    stock = line["stock"]
                    spare_available_units = max(0, _int(getattr(stock, "on_hand_quantity", 0), 0))
                    if spare_available_units > 0:
                        units_needed = math.ceil(max(0, remaining_qty_to_deduct) / max(1, quantity_per_case))
                        units_from_spare = min(spare_available_units, units_needed)
                        deducted_from_spare = min(remaining_qty_to_deduct, units_from_spare * quantity_per_case)
                        stock.on_hand_quantity = max(0, spare_available_units - units_from_spare)
                        stock.save(update_fields=["on_hand_quantity", "updated_at"])
                        InventoryTransaction.objects.create(
                            driver_id=d.id,
                            product=product,
                            type="OUT",
                            quantity=units_from_spare,
                            reference_type="replacement",
                            reference_id=order.id,
                            notes=f"Driver replacement from replacement stock ({deducted_from_spare} bottles, {units_from_spare} units)",
                        )
                        remaining_qty_to_deduct -= deducted_from_spare

                    if remaining_qty_to_deduct > 0:
                        deducted_from_inventory, _ = _deduct_from_inventory(
                            product=product,
                            order=order,
                            required_qty=remaining_qty_to_deduct,
                            reference_id=order.id,
                        )
                        remaining_qty_to_deduct -= deducted_from_inventory
                    if remaining_qty_to_deduct > 0:
                        return _err(f"Insufficient replacement stock for {product.name}", 400)
                meta = {
                    "outcome": outcome,
                    "damagePhotos": damage_photos,
                    "reportedAt": timezone.now().isoformat(),
                    "tripId": str(body.get("tripId") or "").strip() or None,
                    "dropPointId": str(body.get("dropPointId") or "").strip() or None,
                    "quantityToReplace": quantity_to_replace,
                    "quantityReplaced": quantity_replaced,
                    "replacementCases": replacement_cases,
                    "replacementBottles": replacement_bottles,
                    "quantityPerCase": quantity_per_case,
                    "remainingQuantity": max(quantity_to_replace - quantity_replaced, 0),
                    "stockSource": {
                        "spareQuantity": deducted_from_spare,
                        "inventoryQuantity": deducted_from_inventory,
                    },
                    "replacementLines": [{
                        "originalOrderItemId": order_item.id,
                        "originalProductName": product.name,
                        "originalProductSku": product.sku,
                        "replacementProductName": product.name,
                        "replacementProductSku": product.sku,
                        "quantityToReplace": quantity_to_replace,
                        "quantityReplaced": quantity_replaced,
                        "replacementCases": replacement_cases,
                        "replacementBottles": replacement_bottles,
                        "quantityPerCase": quantity_per_case,
                        "remainingQuantity": max(quantity_to_replace - quantity_replaced, 0),
                    }],
                }
                created_returns.append(Replacement.objects.create(
                    replacement_number=f"RET-{timezone.now().year}-{str(count + offset).zfill(4)}",
                    order=order,
                    customer_id=order.customer_id,
                    reason=str(body.get("reason") or "Damaged item"),
                    description=body.get("description") or ("Replacement fulfilled by driver replacement stock" if resolved_on_delivery else "Partial replacement from driver replacement stock; follow-up required"),
                    status=replacement_status,
                    requested_by="DRIVER",
                    replacement_mode=replacement_mode,
                    original_order_item_id=order_item.id,
                    replacement_product_id=product.id,
                    replacement_quantity=quantity_replaced,
                    trip_id=str(body.get("tripId") or "").strip() or None,
                    drop_point_id=str(body.get("dropPointId") or "").strip() or None,
                    pickup_address=_strip_default_country_suffix(body.get("pickupAddress") or ""),
                    pickup_city=body.get("pickupCity") or "",
                    pickup_province=body.get("pickupProvince") or "",
                    pickup_zip_code=body.get("pickupZipCode") or "",
                    damage_photo_url=damage_photos[0],
                    damage_photo_urls=json.dumps(damage_photos),
                    processed_at=timezone.now() if resolved_on_delivery else None,
                    processed_by=p.get("userId") if resolved_on_delivery else None,
                    notes=f"{'Immediate replacement completed by driver' if resolved_on_delivery else 'Partial replacement reported by driver'}\nMeta: {json.dumps(meta)}",
                ))
            if outcome == "PARTIALLY_REPLACED":
                for created in created_returns:
                    serialized_created = _serialize_replacement(created)
                    remaining_qty = max(_int(serialized_created.get("remainingQuantity"), 0), 0)
                    if remaining_qty <= 0:
                        continue
                    created.notes = _append_replacement_note_line(
                        created.notes,
                        (
                            f"Remaining quantity ({remaining_qty}) is ready for warehouse scheduling. "
                            "No admin approval required."
                        ),
                    )
                    created.save(update_fields=["notes", "updated_at"])
        serialized_returns = [_serialize_replacement(entry) for entry in created_returns]
        remaining_spare_products = sum(
            max(_int(line["availableSpareBottles"], 0) - _int(line["quantityReplaced"], 0), 0)
            for line in replacement_lines
        )
        return _ok({
            "success": True,
            "replacement": serialized_returns[0] if serialized_returns else None,
            "replacements": serialized_returns,
            "remainingSpareProducts": remaining_spare_products,
            "remainingReplacementQty": sum(_int(row.get("remainingQuantity"), 0) for row in serialized_returns),
        })

    order_item = None
    order_item_id = str(body.get("orderItemId") or "").strip()
    if order_item_id:
        order_item = OrderItem.objects.select_related("order", "product").filter(id=order_item_id).first()

    order = order_item.order if order_item else Order.objects.filter(id=str(body.get("orderId") or "")).first()
    product = order_item.product if order_item else Product.objects.filter(id=str(body.get("productId") or "")).first()
    qty = _int(body.get("quantity"), 0)
    if not order:
        return _err("orderItemId or orderId is required")
    if resolved_on_delivery and not product:
        return _err("product is required for RESOLVED outcome")
    if qty < 0:
        return _err("quantity cannot be negative")
    if outcome == "RESOLVED" and qty <= 0:
        return _err("quantity must be greater than zero for RESOLVED outcome")
    if order_item and qty > _int(order_item.quantity, 0):
        return _err("quantity cannot exceed ordered quantity")
    quantity_replaced = qty
    if outcome == "PARTIALLY_REPLACED":
        quantity_replaced = _int(body.get("partiallyReplacedQuantity"), 0)
        if quantity_replaced <= 0:
            return _err("partiallyReplacedQuantity must be greater than zero", 400)
        if quantity_replaced > qty:
            return _err("partiallyReplacedQuantity cannot exceed quantity to replace", 400)
        if quantity_replaced >= qty:
            return _err("partiallyReplacedQuantity must be less than quantity to replace in PARTIALLY_REPLACED mode", 400)

    if follow_up_return:
        if not order:
            order = follow_up_return.order
        if not product and follow_up_return.replacement_product_id:
            product = Product.objects.filter(id=follow_up_return.replacement_product_id).first()
        if follow_up_return.order_id != getattr(order, "id", None):
            return _err("followUpReturnId does not match the selected order", 400)
        if follow_up_return.drop_point_id and follow_up_return.drop_point_id != str(body.get("dropPointId") or "").strip():
            return _err("followUpReturnId does not match the selected drop point", 400)
        if _is_replacement_closed(follow_up_return):
            return _err("Replacement is already closed", 400)
        if outcome != "RESOLVED":
            return _err("Follow-up replacement can only be submitted as RESOLVED", 400)
        if not order_item and follow_up_return.original_order_item_id:
            order_item = OrderItem.objects.select_related("order", "product").filter(id=follow_up_return.original_order_item_id).first()
        follow_up_meta: dict[str, Any] = {}
        follow_up_notes = str(follow_up_return.notes or "")
        marker_index = follow_up_notes.rfind("Meta:")
        if marker_index >= 0:
            try:
                parsed_follow_up_meta = json.loads(follow_up_notes[marker_index + len("Meta:"):].strip())
                if isinstance(parsed_follow_up_meta, dict):
                    follow_up_meta = parsed_follow_up_meta
            except (TypeError, ValueError):
                follow_up_meta = {}
        follow_up_quantity_to_replace = _int(
            follow_up_meta.get("quantityToReplace", follow_up_meta.get("damagedQuantity")),
            _int(order_item.quantity, 0) if order_item else _int(follow_up_return.replacement_quantity, 0),
        )
        db_previously_replaced_qty = _int(getattr(follow_up_return, "replacement_quantity", 0), 0)
        meta_previously_replaced_qty = _int(follow_up_meta.get("quantityReplaced"), 0)
        previously_replaced_qty = (
            db_previously_replaced_qty
            if db_previously_replaced_qty > 0
            else max(meta_previously_replaced_qty, 0)
        )
        remaining_to_replace = max(follow_up_quantity_to_replace - previously_replaced_qty, 0)
        if order_item and qty > remaining_to_replace:
            return _err("quantity cannot exceed the remaining quantity to replace", 400)
        quantity_replaced = qty
        if (previously_replaced_qty + quantity_replaced) < follow_up_quantity_to_replace:
            return _err(
                "Follow-up replacement cannot be marked resolved while there are still products to replace",
                400,
            )
    else:
        follow_up_quantity_to_replace = qty

    stock = DriverSpareStock.objects.filter(driver_id=d.id, product=product).first() if product else None
    quantity_per_case_for_stock = max(1, _int(
        getattr(order_item.product, "quantity_per_unit", 0) if order_item and getattr(order_item, "product", None) else 0,
        _int(getattr(product, "quantity_per_unit", 0) if product else 0, 1),
    ))
    available_units = _int(getattr(stock, "on_hand_quantity", 0), 0)
    available_spare_bottles = max(0, available_units * quantity_per_case_for_stock)
    available_inventory_qty = 0
    if product:
        inventory_rows = _resolve_inventory_rows_for_replacement(product, order)
        normalized_product_unit = _normalize_product_unit(getattr(product, "unit", None))
        available_inventory_qty = 0
        for inv in inventory_rows:
            cases_qty = max(0, _int(getattr(inv, "quantity", 0), 0))
            loose_qty = max(0, _int(getattr(inv, "loose_bottles", 0), 0))
            if normalized_product_unit == PRODUCT_UNIT_BOTTLE:
                available_inventory_qty += cases_qty
            else:
                available_inventory_qty += (cases_qty * quantity_per_case_for_stock) + loose_qty
    if follow_up_return:
        if quantity_replaced > available_inventory_qty:
            return _err("Insufficient inventory stock for follow-up replacement quantity", 400)
    elif outcome == "PARTIALLY_REPLACED" and quantity_replaced > available_spare_bottles:
        return _err(
            f"partiallyReplacedQuantity cannot exceed replacement stock ({available_spare_bottles}) in PARTIALLY_REPLACED mode",
            400,
        )
    elif quantity_replaced > (available_spare_bottles + available_inventory_qty):
        return _err(
            f"Insufficient replacement stock for selected replacement quantity. "
            f"Needed {quantity_replaced}, available spare {available_spare_bottles}, inventory {available_inventory_qty}",
            400,
        )
    replacement_status = ReplacementStatus.RESOLVED_ON_DELIVERY if resolved_on_delivery else ReplacementStatus.NEEDS_FOLLOW_UP
    replacement_mode = (
        REPLACEMENT_MODE_SPARE_PRODUCTS_IMMEDIATE
        if resolved_on_delivery
        else REPLACEMENT_MODE_SPARE_PRODUCTS_PARTIAL
    )

    meta = {
        "outcome": outcome,
        "damagePhotos": damage_photos,
        "reportedAt": timezone.now().isoformat(),
        "tripId": str(body.get("tripId") or "").strip() or None,
        "dropPointId": str(body.get("dropPointId") or "").strip() or None,
        "quantityToReplace": follow_up_quantity_to_replace,
        "quantityReplaced": (previously_replaced_qty + quantity_replaced) if follow_up_return else quantity_replaced,
        "remainingQuantity": max(
            follow_up_quantity_to_replace - ((previously_replaced_qty + quantity_replaced) if follow_up_return else quantity_replaced),
            0,
        ),
    }

    with transaction.atomic():
        deducted_from_spare = 0
        deducted_from_inventory = 0
        if quantity_replaced > 0:
            if follow_up_return:
                deducted_from_inventory, _ = _deduct_from_inventory(
                    product=product,
                    order=order,
                    required_qty=quantity_replaced,
                    reference_id=order.id,
                )
                if deducted_from_inventory < quantity_replaced:
                    return _err("Insufficient inventory stock for follow-up replacement quantity", 400)
            else:
                spare_available_units = max(0, _int(getattr(stock, "on_hand_quantity", 0), 0))
                if spare_available_units > 0:
                    units_needed = math.ceil(max(0, quantity_replaced) / max(1, quantity_per_case_for_stock))
                    units_from_spare = min(spare_available_units, units_needed)
                    deducted_from_spare = min(quantity_replaced, units_from_spare * quantity_per_case_for_stock)
                    stock.on_hand_quantity = max(0, spare_available_units - units_from_spare)
                    stock.save(update_fields=["on_hand_quantity", "updated_at"])
                    InventoryTransaction.objects.create(
                        driver_id=d.id,
                        product=product,
                        type="OUT",
                        quantity=units_from_spare,
                        reference_type="replacement",
                        reference_id=order.id,
                        notes=f"Driver replacement from replacement stock ({deducted_from_spare} bottles, {units_from_spare} units)",
                    )
                remaining_for_inventory = quantity_replaced - deducted_from_spare
                if remaining_for_inventory > 0:
                    deducted_from_inventory, _ = _deduct_from_inventory(
                        product=product,
                        order=order,
                        required_qty=remaining_for_inventory,
                        reference_id=order.id,
                    )
                    if deducted_from_inventory < remaining_for_inventory:
                        return _err("Insufficient inventory stock for replacement fallback quantity", 400)
        if follow_up_return:
            meta["stockSource"] = {"spareQuantity": 0, "inventoryQuantity": quantity_replaced}
            follow_up_return.status = ReplacementStatus.COMPLETED
            follow_up_return.replacement_mode = follow_up_return.replacement_mode or replacement_mode
            follow_up_return.replacement_quantity = previously_replaced_qty + quantity_replaced
            follow_up_return.damage_photo_url = damage_photos[0]
            follow_up_return.damage_photo_urls = json.dumps(damage_photos)
            follow_up_return.processed_at = timezone.now()
            follow_up_return.processed_by = p.get("userId")
            follow_up_return.notes = (
                f"{follow_up_return.notes or ''}\nFollow-up replacement completed by driver\nMeta: {json.dumps(meta)}"
            ).strip()
            follow_up_return.save()
            r = follow_up_return
        else:
            meta["stockSource"] = {
                "spareQuantity": deducted_from_spare,
                "inventoryQuantity": deducted_from_inventory,
            }
            count = Replacement.objects.count() + 1
            r = Replacement.objects.create(
                replacement_number=f"RET-{timezone.now().year}-{str(count).zfill(4)}",
                order=order,
                customer_id=order.customer_id,
                reason=str(body.get("reason") or "Damaged item"),
                description=body.get("description") or ("Replacement fulfilled by driver replacement stock" if resolved_on_delivery else "Partial replacement from driver replacement stock; follow-up required"),
                status=replacement_status,
                requested_by="DRIVER",
                replacement_mode=replacement_mode,
                original_order_item_id=order_item.id if order_item else (body.get("orderItemId") or ""),
                replacement_product_id=product.id if product else None,
                replacement_quantity=quantity_replaced,
                trip_id=str(body.get("tripId") or "").strip() or None,
                drop_point_id=str(body.get("dropPointId") or "").strip() or None,
                pickup_address=_strip_default_country_suffix(body.get("pickupAddress") or ""),
                pickup_city=body.get("pickupCity") or "",
                pickup_province=body.get("pickupProvince") or "",
                pickup_zip_code=body.get("pickupZipCode") or "",
                damage_photo_url=damage_photos[0],
                damage_photo_urls=json.dumps(damage_photos),
                processed_at=timezone.now() if resolved_on_delivery else None,
                processed_by=p.get("userId") if resolved_on_delivery else None,
                notes=f"{'Immediate replacement completed by driver' if resolved_on_delivery else 'Partial replacement reported by driver'}\nMeta: {json.dumps(meta)}",
            )
            if outcome == "PARTIALLY_REPLACED":
                serialized_created = _serialize_replacement(r)
                remaining_qty = max(_int(serialized_created.get("remainingQuantity"), 0), 0)
                if remaining_qty > 0:
                    r.notes = _append_replacement_note_line(
                        r.notes,
                        (
                            f"Remaining quantity ({remaining_qty}) is ready for warehouse scheduling. "
                            "No admin approval required."
                        ),
                    )
                    r.save(update_fields=["notes", "updated_at"])
    serialized_return = _serialize_replacement(r)
    remaining_qty = _int(serialized_return.get("remainingQuantity"), max(qty - quantity_replaced, 0))
    remaining_spare_products = max(available_spare_bottles - (0 if follow_up_return else deducted_from_spare), 0)
    return _ok({
        "success": True,
        "replacement": serialized_return,
        "remainingSpareProducts": remaining_spare_products,
        "remainingReplacementQty": remaining_qty,
    })


@csrf_exempt
@require_http_methods(["GET", "POST"])
def trips_route_plan(request: HttpRequest) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        warehouse_id = str(request.GET.get("warehouseId") or "").strip()
        route_date_raw = str(request.GET.get("date") or "").strip()
        route_date = None
        if route_date_raw:
            try:
                route_date = datetime.fromisoformat(route_date_raw).date()
            except ValueError:
                return _err("Invalid date. Expected YYYY-MM-DD", 400)

        oqs = _real_orders(
            Order.objects.select_related("customer", "timeline")
            .prefetch_related("items__product")
            .filter(status__in=[OrderStatus.PREPARING, OrderStatus.CONFIRMED])
        ).order_by("created_at")

        active_route_order_ids = TripDropPoint.objects.filter(
            status__in=["PENDING", "ARRIVED", "IN_TRANSIT", "IN_PROGRESS"]
        ).values_list("order_id", flat=True)
        oqs = oqs.exclude(id__in=active_route_order_ids)

        if route_date:
            oqs = oqs.filter(
                Q(timeline__delivery_date__date=route_date)
                | (Q(timeline__isnull=True) & Q(created_at__date=route_date))
                | (Q(timeline__delivery_date__isnull=True) & Q(created_at__date=route_date))
            )

        if warehouse_id:
            oqs = oqs.filter(
                Q(warehouse_id=warehouse_id) | Q(warehouse_id__isnull=True) | Q(warehouse_id="")
            )

        warehouse_start_lat = None
        warehouse_start_lng = None
        if warehouse_id:
            warehouse = _real_warehouses(Warehouse.objects.filter(id=warehouse_id)).only("id", "latitude", "longitude").first()
            if warehouse:
                warehouse_start_lat = _to_float_or_none(getattr(warehouse, "latitude", None))
                warehouse_start_lng = _to_float_or_none(getattr(warehouse, "longitude", None))

        orders = []
        grouped_by_city: dict[str, list[dict[str, Any]]] = {}
        for o in oqs[:300]:
            city = str((o.shipping_city or None) or "Unknown").strip() or "Unknown"
            latitude = _to_float_or_none((o.shipping_latitude or None) or o.customer.latitude)
            longitude = _to_float_or_none((o.shipping_longitude or None) or o.customer.longitude)
            address = str((o.shipping_address or None) or "").strip()
            products_preview = ", ".join(
                [
                    f"{item.product.name} x{item.quantity}"
                    for item in o.items.select_related("product").all()[:3]
                    if item.product
                ]
            )

            order_row = {
                "id": o.id,
                "orderId": o.id,
                "orderNumber": o.order_number,
                "isScheduledReplacement": str(o.order_number or "").strip().upper().startswith("RPL-"),
                "customerName": o.customer.name,
                "address": address,
                "shippingAddress": address,
                "city": city,
                "province": o.shipping_province,
                "zipCode": o.shipping_zip_code,
                "latitude": latitude,
                "longitude": longitude,
                "shippingLatitude": latitude,
                "shippingLongitude": longitude,
                "products": products_preview,
                "sequence": len(grouped_by_city.get(city, [])) + 1,
                "distanceKm": None,
                "status": o.status,
            }
            orders.append(order_row)
            grouped_by_city.setdefault(city, []).append(order_row)

        route_plans = []
        for city in sorted(grouped_by_city.keys(), key=lambda value: value.lower()):
            city_orders = grouped_by_city[city]
            enriched_orders, city_total_distance_km = _compute_order_distances(
                city_orders,
                warehouse_start_lat,
                warehouse_start_lng,
            )

            route_plans.append(
                {
                    "city": city,
                    "orderCount": len(city_orders),
                    "totalDistanceKm": round(city_total_distance_km, 2),
                    "orders": enriched_orders,
                }
            )

        drivers = [
            _serialize_model(x, exclude={"password"})
            for x in _real_drivers(User.objects.filter(role="DRIVER", is_active=True))[:200]
        ]
        vehicles = [
            _serialize_model(x)
            for x in _real_vehicles(Vehicle.objects.filter(status=VehicleStatus.AVAILABLE, is_active=True))[:200]
        ]
        return _ok({"success": True, "drivers": drivers, "vehicles": vehicles, "orders": orders, "routePlans": route_plans})
    body = _json_body(request)
    return _ok({"success": True, "routePlan": body, "message": "Route plan accepted"})


@csrf_exempt
@require_http_methods(["POST"])
def trip_start(request: HttpRequest, trip_id: str) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    t = Trip.objects.prefetch_related("drop_points__order").filter(id=trip_id).first()
    if not t:
        return _err("Trip not found", 404)
    if p.get("role") == "DRIVER" and p.get("userId") != t.driver_id:
        return _err("Forbidden", 403)

    # Drivers can only start a trip when all assigned delivery orders are loaded.
    not_loaded_order_numbers: list[str] = []
    for drop_point in t.drop_points.all():
        if not drop_point.order_id or not drop_point.order:
            continue
        stage = str(drop_point.order.warehouse_stage or "").upper()
        if stage not in {WarehouseStage.LOADED, WarehouseStage.DISPATCHED}:
            not_loaded_order_numbers.append(str(drop_point.order.order_number or drop_point.order_id))

    if not_loaded_order_numbers:
        preview = ", ".join(not_loaded_order_numbers[:5])
        if len(not_loaded_order_numbers) > 5:
            preview += f", +{len(not_loaded_order_numbers) - 5} more"
        return _err(f"Trip cannot be started. Orders not loaded yet: {preview}", 400)

    now = timezone.now()
    with transaction.atomic():
        t.status = TripStatus.IN_PROGRESS
        t.actual_start_at = now
        t.save(update_fields=["status", "actual_start_at", "updated_at"])

        for drop_point in t.drop_points.all():
            if not drop_point.order_id or not drop_point.order:
                continue
            order = drop_point.order
            changed_fields: list[str] = []
            previous_status = _normalize_order_status(order.status)
            if str(order.warehouse_stage or "").upper() != WarehouseStage.DISPATCHED:
                order.warehouse_stage = WarehouseStage.DISPATCHED
                changed_fields.append("warehouse_stage")
            if not order.warehouse_dispatched_at:
                order.warehouse_dispatched_at = now
                changed_fields.append("warehouse_dispatched_at")
            if _normalize_order_status(order.status) != OrderStatus.OUT_FOR_DELIVERY:
                order.status = OrderStatus.OUT_FOR_DELIVERY
                changed_fields.append("status")
            if changed_fields:
                changed_fields.append("updated_at")
                order.save(update_fields=changed_fields)
                if previous_status != OrderStatus.OUT_FOR_DELIVERY:
                    refreshed_for_email = Order.objects.select_related("customer").filter(id=order.id).first()
                    if refreshed_for_email:
                        _email_order_out_for_delivery_to_customer(refreshed_for_email)

            timeline, _ = OrderTimeline.objects.get_or_create(order=order)
            if not timeline.shipped_at:
                timeline.shipped_at = now
                timeline.save(update_fields=["shipped_at", "updated_at"])
    actor_name = str(p.get("name") or "Staff").strip() or "Staff"
    _create_staff_notifications(
        title="Trip started",
        message=f"{actor_name} started trip {t.trip_number}.",
        notification_type="TRIP",
        reference_type="trip",
        reference_id=t.id,
    )
    return _ok({"success": True, "trip": _serialize_model(t)})


@csrf_exempt
@require_http_methods(["PATCH"])
def trip_drop_point_update(request: HttpRequest, trip_id: str, drop_point_id: str) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    dp = TripDropPoint.objects.select_related("trip").filter(id=drop_point_id, trip_id=trip_id).first()
    if not dp:
        return _err("Drop point not found", 404)
    if p.get("role") == "DRIVER" and p.get("userId") != dp.trip.driver_id:
        return _err("Forbidden", 403)
    body = _json_body(request)
    requeued_to_route_pool = False
    requested_status = str(body.get("status") or "").strip().upper()
    next_status = requested_status
    reschedule_window = str(body.get("rescheduleWindow") or "").strip().lower()
    reschedule_requested = bool(body.get("rescheduleRequested")) or bool(reschedule_window)
    defer_within_trip_today = next_status == "FAILED" and reschedule_requested and reschedule_window == "today"
    if defer_within_trip_today:
        next_status = "PENDING"
    rescheduled_delivery_at: datetime | None = None
    if requested_status == "FAILED" and reschedule_requested:
        reschedule_date_raw = str(body.get("rescheduleDate") or "").strip()
        if reschedule_date_raw:
            parsed_delivery_dt: datetime | None = None
            try:
                parsed_delivery_dt = datetime.fromisoformat(reschedule_date_raw.replace("Z", "+00:00"))
            except ValueError:
                try:
                    parsed_delivery_dt = datetime.fromisoformat(f"{reschedule_date_raw}T09:00:00")
                except ValueError:
                    return _err("Invalid rescheduleDate. Expected ISO date or datetime", 400)
            if parsed_delivery_dt is not None:
                if timezone.is_naive(parsed_delivery_dt):
                    parsed_delivery_dt = timezone.make_aware(parsed_delivery_dt, timezone.get_current_timezone())
                rescheduled_delivery_at = parsed_delivery_dt
        elif reschedule_window == "today":
            rescheduled_delivery_at = timezone.now()
        elif reschedule_window == "tomorrow":
            rescheduled_delivery_at = timezone.now() + timedelta(days=1)
    if next_status == "COMPLETED" and dp.order_id:
        open_replacements = []
        for entry in Replacement.objects.filter(order_id=dp.order_id, drop_point_id=dp.id):
            mode = str(getattr(entry, "replacement_mode", "") or "").strip().upper()
            status = str(getattr(entry, "status", "") or "").strip().upper()
            is_scheduled_follow_up = (
                mode == REPLACEMENT_MODE_SPARE_PRODUCTS_PARTIAL
                and status in {ReplacementStatus.NEEDS_FOLLOW_UP, ReplacementStatus.IN_PROGRESS}
            )
            if not _is_replacement_closed(entry) and not is_scheduled_follow_up:
                open_replacements.append(entry)
        if open_replacements:
            return _err("Drop point cannot be completed while a replacement follow-up is still open", 400)
    dp.status = next_status
    mapping = [("recipientName", "recipient_name"), ("deliveryPhoto", "delivery_photo"), ("failureReason", "failure_reason"), ("failureNotes", "failure_notes"), ("notes", "notes")]
    for key, attr in mapping:
        if key in body:
            setattr(dp, attr, body.get(key))
    now = timezone.now()
    if next_status == "ARRIVED":
        dp.actual_arrival = now
    if next_status in {"COMPLETED", "FAILED", "SKIPPED", "CANCELLED"}:
        dp.actual_departure = now
    dp.save()

    delivered_order = None
    if next_status == "COMPLETED" and dp.order_id:
        delivered_order = Order.objects.select_related("timeline").filter(id=dp.order_id).first()
        if delivered_order:
            delivered_order.pod_recipient_name = str(getattr(dp, "recipient_name", "") or "").strip() or None
            delivered_order.pod_photo_url = str(getattr(dp, "delivery_photo", "") or "").strip() or None
            delivered_order.pod_submitted_at = now
            delivered_order.save(update_fields=["pod_recipient_name", "pod_photo_url", "pod_submitted_at", "updated_at"])
            try:
                with transaction.atomic():
                    _mark_order_delivered(delivered_order, str(p.get("userId") or "").strip() or None, now)
                    _return_unused_spare_products_for_delivered_order(
                        order=delivered_order,
                        trip=Trip.objects.select_related("driver").filter(id=dp.trip_id).first(),
                        performed_by=str(p.get("userId") or "").strip() or None,
                    )
            except ValueError as e:
                return _err(str(e), 400)
    
    release_inventory = body.get("releaseInventory")
    if isinstance(release_inventory, str):
        normalized_release_inventory = release_inventory.strip().lower()
        parsed_release_inventory = normalized_release_inventory in {"1", "true", "yes", "y", "on"}
    elif release_inventory is None:
        parsed_release_inventory = True
    else:
        parsed_release_inventory = bool(release_inventory)
    should_release_inventory = next_status in {"SKIPPED", "CANCELLED"} or parsed_release_inventory

    # If drop point is marked as FAILED/SKIPPED/CANCELLED, optionally return items back to inventory
    if next_status in {"FAILED", "SKIPPED", "CANCELLED"} and should_release_inventory and dp.order_id:
        order = Order.objects.prefetch_related("items").filter(id=dp.order_id).first()
        if order:
            user_id = str(p.get("userId") or "").strip() or None
            for order_item in order.items.all():
                _adjust_reserved_for_order_item(
                    order_item=order_item,
                    operation="release",
                    performed_by=user_id,
                )

    if next_status in {"FAILED", "SKIPPED", "CANCELLED"} and dp.order_id:
        order = Order.objects.select_related("timeline").filter(id=dp.order_id).first()
        if order:
            timeline = getattr(order, "timeline", None)
            if next_status == "FAILED" and reschedule_requested:
                order.status = OrderStatus.RESCHEDULED
                order.warehouse_stage = WarehouseStage.READY_TO_LOAD
                order.loaded_at = None
                order.warehouse_dispatched_at = None
                update_fields = ["status", "warehouse_stage", "loaded_at", "warehouse_dispatched_at", "updated_at"]
                if not order.ready_to_load_at:
                    order.ready_to_load_at = now
                    update_fields.append("ready_to_load_at")
                order.save(update_fields=update_fields)

                if timeline:
                    timeline.delivery_date = rescheduled_delivery_at
                    timeline.save(update_fields=["delivery_date", "updated_at"])
                elif rescheduled_delivery_at is not None:
                    OrderTimeline.objects.create(order=order, delivery_date=rescheduled_delivery_at)
                requeued_to_route_pool = True
            else:
                order.status = OrderStatus.CANCELLED
                order.save(update_fields=["status", "updated_at"])
                if timeline:
                    if not timeline.cancelled_at:
                        timeline.cancelled_at = now
                    timeline.save(update_fields=["cancelled_at", "updated_at"])
                else:
                    OrderTimeline.objects.create(order=order, cancelled_at=now)
    
    t = dp.trip
    if defer_within_trip_today:
        with transaction.atomic():
            ordered_drop_points = list(t.drop_points.order_by("sequence", "id"))
            reordered_drop_points = [point for point in ordered_drop_points if point.id != dp.id]
            reordered_drop_points.append(next((point for point in ordered_drop_points if point.id == dp.id), dp))

            for idx, point in enumerate(reordered_drop_points, start=1):
                point.sequence = -idx
            TripDropPoint.objects.bulk_update(reordered_drop_points, ["sequence"])

            for idx, point in enumerate(reordered_drop_points, start=1):
                point.sequence = idx
            TripDropPoint.objects.bulk_update(reordered_drop_points, ["sequence"])

            dp.sequence = len(reordered_drop_points)

    terminal_drop_point_statuses = ["COMPLETED", "FAILED", "SKIPPED", "CANCELLED"]
    actual_total_drop_points = t.drop_points.count()
    effective_total_drop_points = max(_int(t.total_drop_points, 0), actual_total_drop_points)

    t.total_drop_points = effective_total_drop_points
    t.completed_drop_points = t.drop_points.filter(status__in=terminal_drop_point_statuses).count()

    all_drop_points_terminal = effective_total_drop_points > 0 and t.completed_drop_points >= effective_total_drop_points
    if all_drop_points_terminal:
        t.status = TripStatus.COMPLETED
        t.actual_end_at = now
    else:
        t.status = TripStatus.IN_PROGRESS if t.actual_start_at else TripStatus.PLANNED
        t.actual_end_at = None

    t.save(update_fields=["total_drop_points", "completed_drop_points", "status", "actual_end_at", "updated_at"])
    dp.refresh_from_db()
    order_payload = None
    if delivered_order:
        order_payload = _serialize_order(
            Order.objects.select_related("customer", "timeline").prefetch_related("items__product").get(id=delivered_order.id),
            include_items=False,
        )
    return _ok({"success": True, "dropPoint": _serialize_model(dp), "order": order_payload, "requeuedToRoutePool": requeued_to_route_pool})


@csrf_exempt
@require_http_methods(["PATCH"])
def trip_stop_update(request: HttpRequest, trip_id: str, stop_id: str) -> JsonResponse:
    return trip_drop_point_update(request, trip_id, stop_id)


def _handle_image_upload(request: HttpRequest, folder: str, prefix: str) -> JsonResponse:
    file_obj = request.FILES.get("file")
    if not file_obj:
        return _err("Image file is required")
    if not str(file_obj.content_type or "").lower().startswith("image/"):
        return _err("Only image files are allowed")
    media_root = Path(__file__).resolve().parents[1] / "media" / "uploads" / folder
    media_root.mkdir(parents=True, exist_ok=True)
    ext = (Path(file_obj.name).suffix or ".png").lower()
    name = f"{prefix}-{int(timezone.now().timestamp() * 1000)}{ext}"
    target = media_root / name
    with target.open("wb") as f:
        for chunk in file_obj.chunks():
            f.write(chunk)
    return _ok({"success": True, "imageUrl": f"/uploads/{folder}/{name}"})


def _handle_evidence_upload(request: HttpRequest, folder: str, prefix: str) -> JsonResponse:
    file_obj = request.FILES.get("file")
    if not file_obj:
        return _err("Evidence file is required")
    content_type = str(file_obj.content_type or "").lower()
    if not (content_type.startswith("image/") or content_type.startswith("video/")):
        return _err("Only image or video files are allowed")
    media_root = Path(__file__).resolve().parents[1] / "media" / "uploads" / folder
    media_root.mkdir(parents=True, exist_ok=True)
    ext = (Path(file_obj.name).suffix or ".bin").lower()
    name = f"{prefix}-{int(timezone.now().timestamp() * 1000)}{ext}"
    target = media_root / name
    with target.open("wb") as f:
        for chunk in file_obj.chunks():
            f.write(chunk)
    return _ok({"success": True, "fileUrl": f"/uploads/{folder}/{name}"})


@csrf_exempt
@require_http_methods(["POST"])
def upload_product_image(request: HttpRequest) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    return _handle_image_upload(request, "products", "product")


@csrf_exempt
@require_http_methods(["POST"])
def upload_pod_image(request: HttpRequest) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    if p.get("role") != "DRIVER":
        return _err("Forbidden", 403)
    return _handle_image_upload(request, "pods", "pod")


@csrf_exempt
@require_http_methods(["POST"])
def upload_damage_image(request: HttpRequest) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    if p.get("role") != "DRIVER":
        return _err("Forbidden", 403)
    return _handle_image_upload(request, "damages", "damage")


@csrf_exempt
@require_http_methods(["POST"])
def upload_driver_license_image(request: HttpRequest) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    if p.get("role") != "DRIVER":
        return _err("Forbidden", 403)
    return _handle_image_upload(request, "licenses", "license")


@csrf_exempt
@require_http_methods(["POST"])
def upload_customer_avatar(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    return _handle_image_upload(request, "customers", "customer")


@csrf_exempt
@require_http_methods(["POST"])
def upload_replacement_evidence(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p or p.get("type") != "customer":
        return _err("Unauthorized", 401)
    return _handle_evidence_upload(request, "replacement-evidence", "replacement-evidence")


def ensure_demo_accounts() -> None:
    User.objects.get_or_create(email="admin@logistics.com", defaults={"name": "Admin User", "password": hash_password("admin123"), "phone": "+1-555-0100", "role": "SUPER_ADMIN", "is_active": True})
    driver_user, _ = User.objects.get_or_create(email="driver@logistics.com", defaults={"name": "Demo Driver", "password": hash_password("driver123"), "phone": "+1-555-0103", "role": "DRIVER", "is_active": True})
    User.objects.get_or_create(email="warehouse@logistics.com", defaults={"name": "Warehouse Staff", "password": hash_password("admin123"), "phone": "+1-555-0102", "role": "WAREHOUSE_STAFF", "is_active": True})
    Customer.objects.get_or_create(email="customer@example.com", defaults={"name": "Demo Customer", "password": hash_password("customer123"), "phone": "+1-555-0104", "is_active": True})
    User.objects.filter(id=driver_user.id, role="DRIVER").update(
        license_number=f"DEMO-DRIVER-{driver_user.id[-6:].upper()}",
        license_type="B",
        license_expiry=timezone.now() + timedelta(days=1500),
        hired_at=timezone.now(),
    )







