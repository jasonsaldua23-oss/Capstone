import hashlib
import hmac
import json
import logging
import math
import re
import secrets
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import requests
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from django.db import transaction
from django.db.models import Prefetch, Q, Sum
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
    Driver,
    DriverSpareStock,
    DriverVehicle,
    Feedback,
    Inventory,
    InventoryTransaction,
    LocationLog,
    Notification,
    Order,
    OrderItem,
    OrderLogistics,
    OrderStatus,
    PaymentCheckoutDraft,
    PasswordResetOTP,
    OrderTimeline,
    WarehouseStage,
    Product,
    ProductCategory,
    Replacement,
    ReplacementStatus,
    Role,
    SavedRouteDraft,
    SpareStockTransaction,
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


def _hide_sample_data() -> bool:
    return str(getattr(settings, "SHOW_SAMPLE_DATA", "") or "").strip().lower() not in {"1", "true", "yes", "on"}


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
    return qs.exclude(_sample_text_query("name", "sku", "description"))


def _real_warehouses(qs):
    if not _hide_sample_data():
        return qs
    return qs.exclude(_sample_text_query("name", "code", "address", "city"))


def _real_vehicles(qs):
    if not _hide_sample_data():
        return qs
    return qs.exclude(_sample_text_query("license_plate", "color"))


def _real_drivers(qs):
    if not _hide_sample_data():
        return qs
    return qs.exclude(_sample_text_query("license_number", "user__name", "user__email") | _sample_email_query("user__email"))


def _real_orders(qs):
    if not _hide_sample_data():
        return qs
    return qs.exclude(
        _sample_text_query(
            "order_number",
            "customer__name",
            "customer__email",
            "logistics__shipping_name",
            "logistics__shipping_address",
            "logistics__shipping_city",
        )
        | _sample_email_query("customer__email")
    )


def _real_trips(qs):
    if not _hide_sample_data():
        return qs
    return qs.exclude(
        _sample_text_query("trip_number", "notes", "driver__license_number", "driver__user__name", "driver__user__email")
        | _sample_email_query("driver__user__email")
        | _sample_text_query(
            "drop_points__order__order_number",
            "drop_points__order__customer__name",
            "drop_points__order__customer__email",
            "drop_points__order__logistics__shipping_name",
            "drop_points__order__logistics__shipping_address",
        )
        | _sample_email_query("drop_points__order__customer__email")
    ).distinct()


def _serialize_driver_vehicle_link(link: DriverVehicle) -> dict[str, Any]:
    return {
        "id": link.id,
        "isActive": bool(link.is_active),
        "assignedAt": link.assigned_at.isoformat() if link.assigned_at else None,
        "driverId": link.driver_id,
        "vehicleId": link.vehicle_id,
        "vehicle": _serialize_model(link.vehicle) if getattr(link, "vehicle", None) else None,
        "driver": _serialize_model(link.driver, include={"user": lambda o: _serialize_model(o.user, exclude={"password"})}) if getattr(link, "driver", None) else None,
    }


def _assign_vehicle_to_driver(driver: Driver, vehicle: Vehicle | None) -> None:
    DriverVehicle.objects.filter(driver=driver, is_active=True).update(is_active=False)

    if not vehicle:
        return

    DriverVehicle.objects.filter(vehicle=vehicle, is_active=True).exclude(driver=driver).update(is_active=False)

    existing = DriverVehicle.objects.filter(driver=driver, vehicle=vehicle).order_by("-assigned_at").first()
    if existing:
        existing.is_active = True
        existing.assigned_at = timezone.now()
        existing.save(update_fields=["is_active", "assigned_at"])
        return

    DriverVehicle.objects.create(driver=driver, vehicle=vehicle, is_active=True)


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
    if not re.search(r"[^A-Za-z0-9]", password):
        return PASSWORD_POLICY_ERROR
    return None


def _normalize_payment_method(value: Any) -> str:
    raw = str(value or "").strip().upper().replace("-", "_").replace(" ", "_")
    if raw in {"GCASH", "MAYA", "CARD"}:
        return raw
    if raw in {"BANK_TRANSFER", "ONLINE_PAYMENT"}:
        return "CARD"
    if raw == "PAYMONGO":
        return "CARD"
    if raw == "COD":
        return "COD"
    return "COD"


def _is_paymongo_payment_method(value: Any) -> bool:
    return _normalize_payment_method(value) in {"CARD", "GCASH", "MAYA"}


def _is_truthy(value: Any) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


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
    normalized_payment_method: str,
    selected_warehouse_id: str | None,
    shipping_latitude: Any,
    shipping_longitude: Any,
    payment_status: str,
    performed_by: str | None,
) -> Order:
    count = Order.objects.count() + 1
    order = Order.objects.create(
        order_number=f"ORD-{timezone.now().year}-{str(count).zfill(4)}",
        customer=customer,
        status=_normalize_order_status(body.get("status") or OrderStatus.PENDING),
        priority=body.get("priority") or "normal",
        subtotal=0,
        tax=0,
        shipping_cost=shipping_cost,
        discount=discount,
        total_amount=0,
        payment_status=payment_status,
        payment_method=normalized_payment_method,
        warehouse_id=selected_warehouse_id,
    )

    allocation_policy = _resolve_allocation_policy(body)
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
            quantity=qty,
            unit_price=unit,
            total_price=line_total,
            notes=item.get("notes"),
        )

        allocations = _reserve_inventory_for_order_item(
            product=prod,
            requested_qty=qty,
            order=order,
            order_item=order_item,
            warehouse_id=str(order.warehouse_id or "").strip() or None,
            allocation_policy=allocation_policy,
            performed_by=performed_by,
        )
        allocation_note = f"Reserved using {allocation_policy}: " + ", ".join([f"{row['batchNumber']} x{row['quantity']}" for row in allocations])
        policy_note = f"AllocationPolicy={allocation_policy}"
        order_item.notes = f"{order_item.notes or ''}\n{policy_note}\n{allocation_note}".strip()
        order_item.save(update_fields=["notes"])

    order.subtotal = subtotal
    order.tax = tax
    order.total_amount = total_amount
    order.save(update_fields=["subtotal", "tax", "total_amount", "updated_at"])
    OrderLogistics.objects.create(
        order=order,
        shipping_name=body.get("shippingName") or customer.name,
        shipping_phone=body.get("shippingPhone") or customer.phone or "",
        shipping_address=_strip_default_country_suffix(body.get("shippingAddress") or customer.address or ""),
        shipping_city=body.get("shippingCity") or customer.city or "",
        shipping_province=body.get("shippingProvince") or customer.province or "",
        shipping_zip_code=body.get("shippingZipCode") or customer.zip_code or "",
        shipping_country=DEFAULT_COUNTRY,
        shipping_latitude=shipping_latitude,
        shipping_longitude=shipping_longitude,
        notes=body.get("notes"),
        special_instructions=body.get("specialInstructions"),
    )
    OrderTimeline.objects.create(order=order, delivery_date=datetime.fromisoformat(body["deliveryDate"]) if body.get("deliveryDate") else None)
    return order


def _create_paymongo_checkout_session(
    order: Order,
    request: HttpRequest,
    selected_method: str | None = None,
    *,
    metadata_override: dict[str, Any] | None = None,
    redirect_reference_id: str | None = None,
) -> str:
    secret_key = str(getattr(settings, "PAYMONGO_SECRET_KEY", "") or "").strip()
    if not secret_key:
        raise ValueError("PAYMONGO_SECRET_KEY is not configured")

    origin = str(request.headers.get("origin") or "").strip()
    if not origin:
        referer = str(request.headers.get("referer") or "").strip()
        if referer:
            try:
                from urllib.parse import urlsplit

                parsed = urlsplit(referer)
                if parsed.scheme and parsed.netloc:
                    origin = f"{parsed.scheme}://{parsed.netloc}"
            except Exception:
                origin = ""

    success_url = str(getattr(settings, "PAYMONGO_SUCCESS_URL", "") or "").strip()
    cancel_url = str(getattr(settings, "PAYMONGO_CANCEL_URL", "") or "").strip()
    reference_id = str(redirect_reference_id or order.id or "").strip()
    if not success_url:
        base = origin or "http://localhost:3000"
        success_url = f"{base}/?payment=success&orderId={reference_id}"
    if not cancel_url:
        base = origin or "http://localhost:3000"
        cancel_url = f"{base}/?payment=cancelled&orderId={reference_id}"

    requested = _normalize_payment_method(selected_method)
    method_map = {"CARD": ["card"], "GCASH": ["gcash"], "MAYA": ["paymaya"]}
    payment_method_types: list[str]
    if requested in method_map:
        payment_method_types = method_map[requested]
    else:
        configured_types = str(getattr(settings, "PAYMONGO_PAYMENT_METHOD_TYPES", "") or "").strip()
        if configured_types:
            allowed = {"card", "gcash", "paymaya"}
            payment_method_types = [item.strip().lower() for item in configured_types.split(",") if item.strip().lower() in allowed]
            if not payment_method_types:
                payment_method_types = ["gcash", "paymaya", "card"]
        else:
            payment_method_types = ["gcash", "paymaya", "card"]

    amount_centavos = max(100, int(round(float(order.total_amount or 0) * 100)))
    customer = getattr(order, "customer", None)
    try:
        logistics = getattr(order, "logistics", None)
    except Exception:
        logistics = None
    billing_name = str(
        (getattr(logistics, "shipping_name", "") if logistics else "")
        or (getattr(customer, "name", "") if customer else "")
        or ""
    ).strip()
    billing_email = str((getattr(customer, "email", "") if customer else "") or "").strip()
    billing_phone = str(
        (getattr(logistics, "shipping_phone", "") if logistics else "")
        or (getattr(customer, "phone", "") if customer else "")
        or ""
    ).strip()
    billing: dict[str, Any] | None = None
    if billing_name or billing_email or billing_phone:
        billing = {
            "name": billing_name or None,
            "email": billing_email or None,
            "phone": billing_phone or None,
        }

    payload = {
        "data": {
            "attributes": {
                "billing": billing,
                "send_email_receipt": False,
                "show_description": True,
                "show_line_items": True,
                "description": f"Payment for order {order.order_number}",
                "line_items": [
                    {
                        "currency": "PHP",
                        "amount": amount_centavos,
                        "name": f"Order {order.order_number}",
                        "quantity": 1,
                    }
                ],
                "payment_method_types": payment_method_types,
                "success_url": success_url,
                "cancel_url": cancel_url,
                "metadata": metadata_override
                or {
                    "order_id": order.id,
                    "order_number": order.order_number,
                    "customer_id": order.customer_id,
                },
            }
        }
    }

    response = requests.post(
        "https://api.paymongo.com/v1/checkout_sessions",
        auth=(secret_key, ""),
        json=payload,
        timeout=20,
    )
    data = response.json() if response.content else {}
    if response.status_code >= 400:
        detail = data.get("errors") if isinstance(data, dict) else None
        raise ValueError(f"Unable to initialize PayMongo checkout: {detail or response.text}")

    checkout_url = (
        ((data or {}).get("data") or {}).get("attributes", {}).get("checkout_url")
        if isinstance(data, dict)
        else None
    )
    if not checkout_url:
        raise ValueError("Unable to initialize PayMongo checkout: missing checkout URL")
    return str(checkout_url)


def _extract_paymongo_metadata(payload: Any) -> dict[str, Any]:
    queue: list[Any] = [payload]
    while queue:
        current = queue.pop(0)
        if isinstance(current, dict):
            metadata = current.get("metadata")
            if isinstance(metadata, dict) and (
                metadata.get("order_id")
                or metadata.get("orderId")
                or metadata.get("order_number")
                or metadata.get("draft_id")
                or metadata.get("draftId")
            ):
                return metadata
            queue.extend(current.values())
        elif isinstance(current, list):
            queue.extend(current)
    return {}


def _parse_paymongo_signature_header(value: Any) -> dict[str, str]:
    parts: dict[str, str] = {}
    for chunk in str(value or "").split(","):
        item = chunk.strip()
        if not item or "=" not in item:
            continue
        key, raw = item.split("=", 1)
        parts[key.strip().lower()] = raw.strip()
    return parts


def _verify_paymongo_webhook_signature(request: HttpRequest) -> bool:
    secret = str(getattr(settings, "PAYMONGO_WEBHOOK_SECRET", "") or "").strip()
    # Keep local/dev setups working when the webhook secret is not configured.
    if not secret:
        return True

    signature_header = request.headers.get("Paymongo-Signature", "")
    parsed = _parse_paymongo_signature_header(signature_header)
    timestamp = parsed.get("t", "")
    if not timestamp:
        return False

    expected_signatures = [sig for sig in (parsed.get("te", ""), parsed.get("li", "")) if sig]
    if not expected_signatures:
        return False

    signed_payload = timestamp.encode("utf-8") + b"." + bytes(request.body or b"")
    computed = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(computed, expected) for expected in expected_signatures)


NEGROS_OCCIDENTAL_BOUNDS = {
    "min_lat": 9.18,
    "max_lat": 11.05,
    "min_lng": 122.22,
    "max_lng": 123.35,
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
    province: Any,
    require_coordinates: bool = False,
) -> str | None:
    lat = _to_float_or_none(latitude)
    lng = _to_float_or_none(longitude)
    normalized_province = _normalize_province(province)

    if lat is None or lng is None:
        if require_coordinates:
            return "Pinned location is required and must be within Negros Occidental, Philippines"
        if normalized_province and normalized_province != "negros occidental":
            return "Address province must be Negros Occidental"
        return None

    if not _is_within_negros_occidental(lat, lng):
        return "Pinned location must be within Negros Occidental, Philippines"
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
}


def _normalize_order_status(value: Any) -> str:
    raw = str(value or "").strip().upper()
    if not raw:
        return raw
    if raw in {
        OrderStatus.PENDING,
        OrderStatus.CONFIRMED,
        OrderStatus.PREPARING,
        OrderStatus.OUT_FOR_DELIVERY,
        OrderStatus.DELIVERED,
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
        ReplacementStatus.REPORTED,
        ReplacementStatus.IN_PROGRESS,
        ReplacementStatus.RESOLVED_ON_DELIVERY,
        ReplacementStatus.NEEDS_FOLLOW_UP,
        ReplacementStatus.COMPLETED,
    }:
        return raw
    if raw == "REQUESTED":
        return ReplacementStatus.REPORTED
    if raw in {"APPROVED", "PICKED_UP", "IN_TRANSIT", "RECEIVED"}:
        return ReplacementStatus.IN_PROGRESS
    if raw == "REJECTED":
        return ReplacementStatus.NEEDS_FOLLOW_UP
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


def _is_replacement_closed(entry: Replacement) -> bool:
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
        Trip.objects.filter(drop_points__order_id=order_id).select_related("driver__user", "vehicle").order_by("-updated_at")
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
        "role": user.role.name,
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


def _serialize_order(order: Order, include_items: bool = True, include_progress: bool = False) -> dict[str, Any]:
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
        warehouse = Warehouse.objects.filter(id=warehouse_id).first()
    data["warehouseName"] = str(getattr(warehouse, "name", "") or "").strip() or None
    data["warehouseCode"] = str(getattr(warehouse, "code", "") or "").strip() or None
    data["warehouseCity"] = str(getattr(warehouse, "city", "") or "").strip() or None
    data["warehouseProvince"] = str(getattr(warehouse, "province", "") or "").strip() or None
    logistics = getattr(order, "logistics", None)
    timeline = getattr(order, "timeline", None)
    data["logistics"] = _serialize_model(logistics) if logistics else None
    data["timeline"] = _serialize_model(timeline) if timeline else None

    # Keep backward-compatible top-level shipping/timeline fields expected by portal UIs.
    if logistics:
        shipping_latitude = logistics.shipping_latitude if logistics.shipping_latitude is not None else order.customer.latitude
        shipping_longitude = logistics.shipping_longitude if logistics.shipping_longitude is not None else order.customer.longitude
        data["shippingName"] = logistics.shipping_name
        data["shippingPhone"] = logistics.shipping_phone
        data["shippingAddress"] = _strip_default_country_suffix(logistics.shipping_address)
        data["shippingCity"] = logistics.shipping_city
        data["shippingProvince"] = logistics.shipping_province
        data["shippingZipCode"] = logistics.shipping_zip_code
        data["shippingCountry"] = DEFAULT_COUNTRY
        data["shippingLatitude"] = shipping_latitude
        data["shippingLongitude"] = shipping_longitude
    else:
        data["shippingName"] = None
        data["shippingPhone"] = None
        data["shippingAddress"] = None
        data["shippingCity"] = None
        data["shippingProvince"] = None
        data["shippingZipCode"] = None
        data["shippingCountry"] = DEFAULT_COUNTRY
        data["shippingLatitude"] = order.customer.latitude
        data["shippingLongitude"] = order.customer.longitude

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

    assigned_trip = _select_trip_for_order(order.id, require_driver=True)
    assigned_driver = getattr(assigned_trip, "driver", None)
    assigned_driver_name = ""
    if assigned_driver:
        assigned_driver_name = str(getattr(getattr(assigned_driver, "user", None), "name", "") or getattr(assigned_driver, "name", "") or "").strip()
    data["isDriverAssigned"] = bool(assigned_driver)
    data["assignedDriverName"] = assigned_driver_name or None
    data["assignedTripId"] = getattr(assigned_trip, "id", None)
    if include_progress:
        progress_trip = _select_trip_for_order(order.id, require_driver=False)
        if progress_trip:
            progress_trip = Trip.objects.select_related("driver__user", "vehicle").prefetch_related("drop_points__order").filter(id=progress_trip.id).first()
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
                "recipientSignature": getattr(progress_drop_point, "recipient_signature", None) if progress_drop_point else None,
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
    meta: dict[str, Any] = {}
    notes = str(getattr(entry, "notes", "") or "")
    marker = "Meta:"
    marker_index = notes.rfind(marker)
    if marker_index >= 0:
        try:
            parsed_meta = json.loads(notes[marker_index + len(marker):].strip())
            if isinstance(parsed_meta, dict):
                meta = parsed_meta
        except (TypeError, ValueError):
            meta = {}
    order = getattr(entry, "order", None)
    warehouse_id = str(getattr(order, "warehouse_id", "") or "").strip() or None
    if not warehouse_id:
        trip_id = str(getattr(entry, "trip_id", "") or "").strip() or str(meta.get("tripId") or "").strip()
        if trip_id:
            source_trip = Trip.objects.filter(id=trip_id).only("warehouse_id").first()
            warehouse_id = str(getattr(source_trip, "warehouse_id", "") or "").strip() or None
    warehouse = Warehouse.objects.filter(id=warehouse_id).first() if warehouse_id else None
    order_customer = getattr(order, "customer", None)
    order_logistics = getattr(order, "logistics", None)
    customer = order_customer
    if not customer and entry.customer_id:
        customer = Customer.objects.filter(id=entry.customer_id).first()
    customer_name = next(
        (
            str(value).strip()
            for value in (
                getattr(customer, "name", None),
                getattr(order_logistics, "shipping_name", None),
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
        "shippingName": getattr(order_logistics, "shipping_name", None),
        "warehouseId": warehouse_id,
        "warehouseName": data.get("warehouseName"),
        "warehouseCode": data.get("warehouseCode"),
        "warehouseCity": data.get("warehouseCity"),
        "warehouseProvince": data.get("warehouseProvince"),
    } if order else None
    data["replacementMode"] = _normalize_replacement_mode(data.get("replacementMode"))
    data["status"] = _normalize_replacement_status(data.get("status"), data.get("replacementMode"))
    original_item = None
    if entry.original_order_item_id:
        original_item = OrderItem.objects.select_related("product").filter(id=entry.original_order_item_id).first()
    replacement_product = None
    if entry.replacement_product_id:
        replacement_product = Product.objects.filter(id=entry.replacement_product_id).first()
    if original_item:
        quantity_replaced = _int(meta.get("quantityReplaced"), _int(entry.replacement_quantity, 0))
        quantity_to_replace = _int(
            meta.get("quantityToReplace", meta.get("damagedQuantity", meta.get("totalDamagedQuantity"))),
            quantity_replaced,
        )
        remaining_quantity = max(quantity_to_replace - quantity_replaced, 0)
        data["originalOrderItem"] = {
            "id": original_item.id,
            "quantity": original_item.quantity,
            "product": _serialize_model(original_item.product) if original_item.product_id else None,
        }
        data["originalProductName"] = getattr(original_item.product, "name", None)
        data["originalProductSku"] = getattr(original_item.product, "sku", None)
        data["originalQuantity"] = original_item.quantity
        data["quantityToReplace"] = quantity_to_replace
        data["quantityReplaced"] = quantity_replaced
        data["remainingQuantity"] = remaining_quantity
        replacement_lines = [
            {
                "originalOrderItemId": original_item.id,
                "originalProductName": getattr(original_item.product, "name", None),
                "originalProductSku": getattr(original_item.product, "sku", None),
                "replacementProductName": getattr(replacement_product, "name", None),
                "replacementProductSku": getattr(replacement_product, "sku", None),
                "quantityToReplace": quantity_to_replace,
                "quantityReplaced": quantity_replaced,
                "remainingQuantity": remaining_quantity,
            }
        ]
        # `replacementLines` is the canonical key; keep `replacementItems` for compatibility.
        data["replacementLines"] = replacement_lines
        data["replacementItems"] = replacement_lines
    if replacement_product:
        data["replacementProduct"] = _serialize_model(replacement_product)
        data["replacementProductName"] = replacement_product.name
        data["replacementProductSku"] = replacement_product.sku
    return data


def _serialize_trip(trip: Trip, include_points: bool = True) -> dict[str, Any]:
    data = _serialize_model(trip)
    data["driver"] = _serialize_model(trip.driver, include={"user": lambda d: _serialize_model(d.user, exclude={"password"})})
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
    if include_points:
        drop_points: list[dict[str, Any]] = []
        prefetched_drop_points = getattr(trip, "_prefetched_objects_cache", {}).get("drop_points")
        if prefetched_drop_points is not None:
            drop_point_rows = sorted(prefetched_drop_points, key=lambda point: point.sequence)
        else:
            drop_point_rows = trip.drop_points.select_related(
                "order",
                "order__customer",
                "order__logistics",
                "order__timeline",
            ).prefetch_related(
                "order__items__product",
            ).order_by("sequence")

        for dp in drop_point_rows:
            row = _serialize_model(dp)
            row["address"] = _strip_default_country_suffix(row.get("address"))
            if dp.order_id and dp.order:
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
                    logistics = getattr(dp.order, "logistics", None)
                    fallback_lat = _to_float_or_none(
                        (logistics.shipping_latitude if logistics else None) or getattr(dp.order.customer, "latitude", None)
                    )
                    fallback_lng = _to_float_or_none(
                        (logistics.shipping_longitude if logistics else None) or getattr(dp.order.customer, "longitude", None)
                    )
                    if fallback_lat is not None and fallback_lng is not None:
                        row["latitude"] = fallback_lat
                        row["longitude"] = fallback_lng
            drop_points.append(row)
        data["dropPoints"] = drop_points
    return data


def _serialize_saved_route(route: SavedRouteDraft) -> dict[str, Any]:
    return {
        "id": route.id,
        "date": route.date.isoformat() if route.date else None,
        "warehouseId": route.warehouse_id,
        "warehouseName": route.warehouse_name,
        "city": route.city,
        "totalDistanceKm": float(route.total_distance_km or 0),
        "orderIds": [str(x) for x in (route.order_ids or [])],
        "orders": route.orders_json or [],
        "createdByUserId": route.created_by_user_id,
        "createdAt": route.created_at.isoformat() if route.created_at else None,
        "updatedAt": route.updated_at.isoformat() if route.updated_at else None,
    }


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
    if include_full_product:
        row["product"] = _serialize_model(product) if product else None
    else:
        row["product"] = (
            {
                "id": product.id,
                "sku": product.sku,
                "name": product.name,
                "unit": _normalize_product_unit(product.unit),
            }
            if product
            else None
        )
    row["spareProducts"] = _spare_product_quantities(item.quantity, getattr(product, "unit", None))
    return row


def _allocate_driver_spare_products_for_loaded_order(order: Order, driver: Driver | None) -> None:
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
        if SpareStockTransaction.objects.filter(
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
            defaults={"quantity": 0, "min_quantity": 0},
        )
        stock.quantity = _int(stock.quantity, 0) + allocated_qty
        stock.min_quantity = max(_int(stock.min_quantity, 0), allocated_qty)
        stock.save(update_fields=["quantity", "min_quantity", "updated_at"])

        SpareStockTransaction.objects.create(
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
        if batch.quantity <= 0:
            batch.status = "DEPLETED"
        batch.save(update_fields=["quantity", "status", "updated_at"])

        inventory.quantity = max(0, int(inventory.quantity or 0) - take_qty)
        inventory.save(update_fields=["quantity", "updated_at"])

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

        if SpareStockTransaction.objects.filter(
            driver=driver,
            product=product,
            type="OUT",
            reference_type=SPARE_PRODUCTS_RETURN_REFERENCE_TYPE,
            reference_id=order_item.id,
        ).exists():
            continue

        loaded_qty = (
            SpareStockTransaction.objects.filter(
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
                min_stock=10,
                max_stock=100,
                reorder_point=20,
            )

        driver_stock = DriverSpareStock.objects.filter(driver=driver, product=product).first()
        if not driver_stock:
            continue
        transferable_qty = min(unused_qty, max(0, _int(driver_stock.quantity, 0)))
        if transferable_qty <= 0:
            continue

        with transaction.atomic():
            driver_stock.quantity = max(0, _int(driver_stock.quantity, 0) - transferable_qty)
            driver_stock.save(update_fields=["quantity", "updated_at"])
            SpareStockTransaction.objects.create(
                driver=driver,
                product=product,
                type="OUT",
                quantity=transferable_qty,
                reference_type=SPARE_PRODUCTS_RETURN_REFERENCE_TYPE,
                reference_id=order_item.id,
                notes=f"Unused spare products returned to inventory for {order.order_number}",
            )

            inventory.quantity = max(0, _int(inventory.quantity, 0) + transferable_qty)
            inventory.save(update_fields=["quantity", "updated_at"])
            InventoryTransaction.objects.create(
                warehouse=inventory.warehouse,
                product=product,
                type="IN",
                quantity=transferable_qty,
                reference_type=SPARE_PRODUCTS_RETURN_REFERENCE_TYPE,
                reference_id=order_item.id,
                notes=f"Unused spare products returned from driver for {order.order_number}",
                performed_by=performed_by,
            )

            return_batch_number = f"SPARE-RET-{order_item.id[-12:].upper()}"
            stock_batch = StockBatch.objects.filter(batch_number=return_batch_number).first()
            if stock_batch:
                stock_batch.quantity = max(0, _int(stock_batch.quantity, 0) + transferable_qty)
                stock_batch.status = "ACTIVE"
                stock_batch.inventory = inventory
                stock_batch.save(update_fields=["quantity", "status", "inventory", "updated_at"])
            else:
                StockBatch.objects.create(
                    batch_number=return_batch_number,
                    inventory=inventory,
                    quantity=transferable_qty,
                    receipt_date=timezone.now(),
                    location_label="SPARE-RETURN",
                    status="ACTIVE",
                    created_by=performed_by,
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

    if _normalize_order_status(order.status) == OrderStatus.CANCELLED:
        raise ValueError("Cancelled orders cannot be marked as delivered")

    _finalize_order_inventory_on_delivery(order, performed_by)
    order.status = OrderStatus.DELIVERED
    order.save(update_fields=["status", "updated_at"])

    timeline, _ = OrderTimeline.objects.get_or_create(order=order)
    if not timeline.shipped_at:
        timeline.shipped_at = getattr(order, "warehouse_dispatched_at", None) or timezone.now()
    if not timeline.delivered_at:
        timeline.delivered_at = delivered_at or timezone.now()
    timeline.save(update_fields=["shipped_at", "delivered_at", "updated_at"])


def _reconcile_delivered_order_from_completed_drop_point(order: Order, performed_by: str | None = None) -> bool:
    if _normalize_order_status(order.status) in {OrderStatus.DELIVERED, OrderStatus.CANCELLED}:
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
        if batch.quantity <= 0:
            batch.status = "DEPLETED"
        batch.save(update_fields=["quantity", "status", "updated_at"])

        inventory.quantity = max(0, int(inventory.quantity) - take_qty)
        inventory.save(update_fields=["quantity", "updated_at"])

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
OTP_MAX_ATTEMPTS = 5


def _normalize_email(value: Any) -> str:
    return str(value or "").strip().lower()


def _is_gmail_email(email: str) -> bool:
    return bool(email and email.endswith("@gmail.com") and "@" in email and email.count("@") == 1)


def _staff_email_conflict_message(email: str, role: Role, exclude_user_id: str | None = None) -> str | None:
    normalized_email = _normalize_email(email)
    if not normalized_email:
        return None

    qs = User.objects.filter(email=normalized_email, role=role)
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
        return User.objects.filter(email=normalized_email, role_id=role_id).exists()
    if account_type == "staff":
        return User.objects.filter(email=normalized_email).exists()
    return False


def _verify_google_token(credential: str) -> dict[str, Any]:
    client_id = getattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "")
    if not client_id:
        raise ValueError("Google OAuth is not configured")
    return google_id_token.verify_oauth2_token(credential, google_requests.Request(), client_id)


def _otp_mail_ready() -> bool:
    return bool(getattr(settings, "OTP_GMAIL_USER", "") and getattr(settings, "OTP_GMAIL_APP_PASSWORD", ""))


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
    send_mail(
        subject=subject,
        message=message,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[email],
        fail_silently=False,
    )


def _latest_verified_otp(email: str, account_type: str):
    return (
        PasswordResetOTP.objects.filter(
            email=email,
            account_type=account_type,
            consumed_at__isnull=False,
            verified_at__isnull=False,
        )
        .order_by("-verified_at", "-created_at")
        .first()
    )


def _has_recent_verified_email(email: str, account_type: str) -> bool:
    otp = _latest_verified_otp(email, account_type)
    if not otp:
        return False
    return bool(otp.verified_at and otp.verified_at >= timezone.now() - timedelta(minutes=OTP_EXPIRY_MINUTES))


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
        if not Role.objects.filter(id=role_id).exists():
            return _err("Role not found", 404)
    if _email_exists_for_account(email, account_type, role_id):
        return _err("Email already exists for this account type", 409)
    if not _otp_mail_ready():
        return _err("Verification email service is not configured", 500)

    now = timezone.now()
    code = f"{secrets.randbelow(1000000):06d}"
    PasswordResetOTP.objects.filter(email=email, account_type=account_type, consumed_at__isnull=True).update(consumed_at=now)
    otp = PasswordResetOTP.objects.create(
        email=email,
        account_type=account_type,
        otp_hash=hash_password(code),
        expires_at=now + timedelta(minutes=OTP_EXPIRY_MINUTES),
    )
    try:
        _send_email_verification_otp(email, code)
    except Exception:
        otp.consumed_at = now
        otp.save(update_fields=["consumed_at", "updated_at"])
        return _err("Unable to send verification email right now", 500)

    return _ok({"success": True, "message": "Verification code sent."})


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
    otp = (
        PasswordResetOTP.objects.filter(
            email=email,
            account_type=account_type,
            consumed_at__isnull=True,
        )
        .order_by("-created_at")
        .first()
    )
    if not otp or otp.expires_at < now:
        return _err("Invalid or expired verification code", 400)
    if otp.attempt_count >= OTP_MAX_ATTEMPTS:
        return _err("Too many invalid verification attempts. Request a new code.", 429)
    if not verify_password(otp_code, otp.otp_hash):
        otp.attempt_count += 1
        otp.save(update_fields=["attempt_count", "updated_at"])
        return _err("Invalid or expired verification code", 400)

    otp.verified_at = now
    otp.consumed_at = now
    otp.save(update_fields=["verified_at", "consumed_at", "updated_at"])
    PasswordResetOTP.objects.filter(email=email, account_type=account_type, consumed_at__isnull=True).update(consumed_at=now)
    return _ok({"success": True, "message": "Email verified successfully"})


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
    users_qs = User.objects.select_related("role").filter(email=email)
    if role_scope:
        users_qs = users_qs.filter(role__name__in=role_scope)
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
    except ValueError:
        return _err("Invalid Google credential", 401)
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
    body = _json_body(request)
    credential = str(body.get("credential") or body.get("idToken") or "").strip()
    portal = str(body.get("portal") or "").strip().lower()
    remember_me = bool(body.get("rememberMe", False))

    if not credential or portal not in {"driver", "warehouse"}:
        return _err("Invalid credentials", 401)

    if not getattr(settings, "GOOGLE_OAUTH_CLIENT_ID", ""):
        return _err("Google OAuth is not configured on the server", 500)

    try:
        claims = _verify_google_token(credential)
    except ValueError:
        return _err("Invalid credentials", 401)
    except Exception:
        logger.exception("Google staff token verification failed")
        return _err("Google authentication service is temporarily unavailable", 503)

    email = _normalize_email(claims.get("email"))
    if not email or not bool(claims.get("email_verified")):
        return _err("Invalid credentials", 401)
    if not _is_gmail_email(email):
        return _err("Invalid credentials", 401)

    expected_roles = {"driver": {"DRIVER"}, "warehouse": {"WAREHOUSE_STAFF"}}
    user = (
        User.objects.select_related("role")
        .filter(email=email, is_active=True, role__name__in=expected_roles[portal])
        .first()
    )
    if not user:
        return _err("Invalid credentials", 401)

    user.last_login_at = timezone.now()
    user.save(update_fields=["last_login_at", "updated_at"])
    payload = _user_payload(user)
    if portal == "warehouse" and user.role.name != "WAREHOUSE_STAFF":
        return _err("Invalid credentials", 401)
    if portal == "driver" and user.role.name != "DRIVER":
        return _err("Invalid credentials", 401)

    token = create_token(payload, 24 * 30 if remember_me else 24)
    resp = _ok({"success": True, "user": payload, "token": token, "message": "Login successful"})
    _set_auth_cookie(resp, token, remember_me)
    return resp


@csrf_exempt
@require_http_methods(["POST"])
def auth_register(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    name = str(body.get("name", "")).strip()
    email = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", ""))
    if not name or not email or not password:
        return _err("Name, email and password are required")
    password_error = _validate_password_strength(password)
    if password_error:
        return _err(password_error)
    if not _is_gmail_email(email):
        return _err("Only Gmail addresses are allowed (example@gmail.com)")
    if Customer.objects.filter(email=email).exists():
        return _err("Email is already registered", 409)
    address_error = _ensure_negros_occidental_address(
        latitude=body.get("latitude"),
        longitude=body.get("longitude"),
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
        return _err("Account not found for this email", 404)

    now = timezone.now()
    code = f"{secrets.randbelow(1000000):06d}"
    PasswordResetOTP.objects.filter(email=email, account_type=account_type, consumed_at__isnull=True).update(consumed_at=now)
    otp = PasswordResetOTP.objects.create(
        email=email,
        account_type=account_type,
        otp_hash=hash_password(code),
        expires_at=now + timedelta(minutes=OTP_EXPIRY_MINUTES),
    )
    try:
        _send_reset_otp_email(email, code)
    except Exception:
        otp.consumed_at = now
        otp.save(update_fields=["consumed_at", "updated_at"])
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
    otp = (
        PasswordResetOTP.objects.filter(
            email=email,
            account_type=account_type,
            consumed_at__isnull=True,
        )
        .order_by("-created_at")
        .first()
    )
    if not otp or otp.expires_at < now:
        return _err("Invalid or expired OTP", 400)
    if otp.attempt_count >= OTP_MAX_ATTEMPTS:
        return _err("Too many invalid OTP attempts. Request a new code.", 429)
    if not verify_password(otp_code, otp.otp_hash):
        otp.attempt_count += 1
        otp.save(update_fields=["attempt_count", "updated_at"])
        return _err("Invalid or expired OTP", 400)

    if account_type == "staff":
        account = User.objects.filter(email=email, is_active=True).first()
    else:
        account = Customer.objects.filter(email=email, is_active=True).first()
    if not account:
        return _err("Invalid account", 404)

    account.password = hash_password(new_password)
    account.save(update_fields=["password", "updated_at"])

    otp.verified_at = now
    otp.consumed_at = now
    otp.save(update_fields=["verified_at", "consumed_at", "updated_at"])
    PasswordResetOTP.objects.filter(email=email, account_type=account_type, consumed_at__isnull=True).update(consumed_at=now)

    return _ok({"success": True, "message": "Password reset successful. Please log in."})


@require_GET
def roles_list(request: HttpRequest) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    roles = Role.objects.all().order_by("name")
    return _ok({"success": True, "roles": [_serialize_model(r) for r in roles]})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def users_collection(request: HttpRequest) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = _real_users(User.objects.select_related("role").all()).order_by("-created_at")
        s = str(request.GET.get("search", "")).strip()
        if s:
            qs = qs.filter(Q(name__icontains=s) | Q(email__icontains=s))
        total = qs.count()
        rows = list(qs[off : off + size])
        users = [_serialize_model(u, include={"role": lambda x: _serialize_model(x.role)}, exclude={"password"}) for u in rows]
        return _ok({"success": True, "users": users, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})

    body = _json_body(request)
    email = str(body.get("email", "")).strip().lower()
    name = str(body.get("name", "")).strip()
    password = str(body.get("password", "")).strip()
    role_id = str(body.get("roleId", "")).strip()
    if not email or not name or not password or not role_id:
        return _err("name, email, password and roleId are required")
    password_error = _validate_password_strength(password)
    if password_error:
        return _err(password_error)
    if not _is_gmail_email(email):
        return _err("Only Gmail addresses are allowed for staff/driver accounts")
    try:
        role = Role.objects.get(id=role_id)
    except Role.DoesNotExist:
        return _err("Role not found", 404)
    existing_message = _staff_email_conflict_message(email, role)
    if existing_message:
        return _err(existing_message, 409)
    if not _has_recent_verified_email(email, "staff"):
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
    return _ok({"success": True, "user": _serialize_model(user, include={"role": lambda x: _serialize_model(x.role)}, exclude={"password"})}, 201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
def user_detail(request: HttpRequest, user_id: str) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    try:
        user = User.objects.select_related("role").get(id=user_id)
    except User.DoesNotExist:
        return _err("User not found", 404)
    if request.method == "GET":
        return _ok({"success": True, "user": _serialize_model(user, include={"role": lambda x: _serialize_model(x.role)}, exclude={"password"})})
    if request.method == "DELETE":
        user.delete()
        return _ok({"success": True})
    body = _json_body(request)
    for key, attr in [("name", "name"), ("phone", "phone"), ("avatar", "avatar")]:
        if key in body:
            setattr(user, attr, body.get(key))
    if "isActive" in body:
        user.is_active = bool(body.get("isActive"))
    if body.get("password"):
        password_error = _validate_password_strength(str(body["password"]))
        if password_error:
            return _err(password_error)
        user.password = hash_password(str(body["password"]))
    if body.get("roleId"):
        try:
            user.role = Role.objects.get(id=str(body["roleId"]))
        except Role.DoesNotExist:
            return _err("Role not found", 404)
    existing_message = _staff_email_conflict_message(user.email, user.role, exclude_user_id=user.id)
    if existing_message:
        return _err(existing_message, 409)
    user.save()
    return _ok({"success": True, "user": _serialize_model(user, include={"role": lambda x: _serialize_model(x.role)}, exclude={"password"})})


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
    rows = ProductCategory.objects.filter(is_active=True).order_by("name")
    return _ok({"success": True, "categories": [_serialize_model(r) for r in rows]})


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
    required = ["name", "code", "address", "city", "province", "zipCode"]
    for f in required:
        if not body.get(f):
            return _err(f"{f} is required")
    address_error = _ensure_negros_occidental_address(
        latitude=body.get("latitude"),
        longitude=body.get("longitude"),
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
        capacity=_int(body.get("capacity"), 1000),
        manager_id=body.get("managerId"),
        is_active=bool(body.get("isActive", True)),
    )
    return _ok({"success": True, "warehouse": _serialize_model(w)}, 201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
def warehouse_detail(request: HttpRequest, warehouse_id: str) -> JsonResponse:
    _, err = _require_staff(request)
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
        return _ok({"success": True})
    body = _json_body(request)
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
        qs = _real_products(Product.objects.select_related("category").all()).order_by("name")
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
            row = _serialize_model(
                product,
                include={"category": (lambda o: _serialize_model(o.category) if o.category else None)},
            )
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
    category = None
    if body.get("categoryId"):
        try:
            category = ProductCategory.objects.get(id=str(body["categoryId"]))
        except ProductCategory.DoesNotExist:
            return _err("Category not found", 404)
    try:
        product_unit = _normalize_product_unit(body.get("unit"))
    except ValueError as exc:
        return _err(str(exc), 400)
    prod = Product.objects.create(
        sku=str(body["sku"]).strip(),
        name=str(body["name"]).strip(),
        image_url=body.get("imageUrl"),
        description=body.get("description"),
        category=category,
        unit=product_unit,
        weight=body.get("weight"),
        dimensions=body.get("dimensions"),
        price=float(body.get("price") or 0),
        is_active=bool(body.get("isActive", True)),
    )
    return _ok({"success": True, "product": _serialize_model(prod, include={"category": (lambda o: _serialize_model(o.category) if o.category else None)})}, 201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
def product_detail(request: HttpRequest, product_id: str) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    try:
        prod = Product.objects.select_related("category").get(id=product_id)
    except Product.DoesNotExist:
        return _err("Product not found", 404)
    if request.method == "GET":
        return _ok({"success": True, "product": _serialize_model(prod, include={"category": (lambda o: _serialize_model(o.category) if o.category else None)})})
    _, err = _require_staff(request)
    if err:
        return err
    if request.method == "DELETE":
        prod.delete()
        return _ok({"success": True})
    body = _json_body(request)
    if "unit" in body:
        try:
            prod.unit = _normalize_product_unit(body.get("unit"))
        except ValueError as exc:
            return _err(str(exc), 400)
    mapping = [("sku", "sku"), ("name", "name"), ("imageUrl", "image_url"), ("description", "description"), ("weight", "weight"), ("dimensions", "dimensions"), ("price", "price")]
    for key, attr in mapping:
        if key in body:
            setattr(prod, attr, body.get(key))
    if "isActive" in body:
        prod.is_active = bool(body.get("isActive"))
    if "categoryId" in body:
        if body.get("categoryId"):
            try:
                prod.category = ProductCategory.objects.get(id=str(body["categoryId"]))
            except ProductCategory.DoesNotExist:
                return _err("Category not found", 404)
        else:
            prod.category = None
    prod.save()
    return _ok({"success": True, "product": _serialize_model(prod, include={"category": (lambda o: _serialize_model(o.category) if o.category else None)})})


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
        defaults={"quantity": qty, "reserved_quantity": 0, "min_stock": _int(body.get("minStock"), 10), "max_stock": _int(body.get("maxStock"), 100), "reorder_point": _int(body.get("reorderPoint"), 20), "last_restocked_at": timezone.now()},
    )
    if not created:
        item.quantity += qty
        item.last_restocked_at = timezone.now()
        item.save()
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
    _, err = _require_staff(request)
    if err:
        return err
    try:
        item = Inventory.objects.select_related("warehouse", "product").get(id=inventory_id)
    except Inventory.DoesNotExist:
        return _err("Inventory not found", 404)
    body = _json_body(request)
    mapping = [("quantity", "quantity"), ("reservedQuantity", "reserved_quantity"), ("minStock", "min_stock"), ("maxStock", "max_stock"), ("reorderPoint", "reorder_point")]
    for key, attr in mapping:
        if key in body:
            setattr(item, attr, _int(body.get(key), getattr(item, attr)))
    item.save()
    return _ok({"success": True, "inventory": _serialize_model(item, include={"warehouse": lambda o: _serialize_model(o.warehouse), "product": lambda o: _serialize_model(o.product)})})


@require_GET
def inventory_transactions_list(request: HttpRequest) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    page, size, off = _pagination(request)
    qs = (
        InventoryTransaction.objects.select_related("warehouse", "product")
        .filter(product__in=_real_products(Product.objects.all()))
        .filter(warehouse__in=_real_warehouses(Warehouse.objects.all()))
    )

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
    _, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = (
            StockBatch.objects.select_related("inventory", "inventory__warehouse", "inventory__product")
            .filter(inventory__product__in=_real_products(Product.objects.all()))
            .filter(inventory__warehouse__in=_real_warehouses(Warehouse.objects.all()))
            .order_by("-created_at")
        )
        total = qs.count()
        rows = list(qs[off : off + size])
        data = [_serialize_model(x, include={"inventory": lambda o: _serialize_model(o.inventory, include={"warehouse": lambda i: _serialize_model(i.warehouse), "product": lambda i: _serialize_model(i.product)})}) for x in rows]
        return _ok({"success": True, "stockBatches": data, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    body = _json_body(request)
    qty = _int(body.get("quantity"), 0)
    if qty <= 0:
        return _err("quantity must be > 0")

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
                        description=body.get("description"),
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

                threshold = _int(body.get("threshold"), 10)
                inv, created = Inventory.objects.select_related("warehouse", "product").get_or_create(
                    warehouse=warehouse,
                    product=product,
                    defaults={
                        "quantity": 0,
                        "reserved_quantity": 0,
                        "min_stock": max(0, threshold),
                        "max_stock": max(100, threshold * 5 if threshold > 0 else 100),
                        "reorder_point": max(20, threshold * 2 if threshold > 0 else 20),
                        "last_restocked_at": timezone.now(),
                    },
                )

                if not created and "threshold" in body and threshold >= 0:
                    inv.min_stock = threshold

            batch = StockBatch.objects.create(
                batch_number=str(body.get("batchNumber") or f"BATCH-{int(timezone.now().timestamp())}"),
                inventory=inv,
                quantity=qty,
                receipt_date=timezone.now(),
                expiry_date=expiry_date,
                location_label=body.get("locationLabel"),
                status=body.get("status") or "ACTIVE",
                created_by=created_by,
            )

            inv.quantity += qty
            inv.last_restocked_at = timezone.now()
            inv.save(update_fields=["quantity", "min_stock", "last_restocked_at", "updated_at"])

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

            return _ok({"success": True, "stockBatch": _serialize_model(batch)}, 201)
    except Exception as e:
        return _err(str(e), 500)


@csrf_exempt
@require_http_methods(["GET", "POST", "PATCH"])
def vehicles_collection(request: HttpRequest) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = _real_vehicles(Vehicle.objects.prefetch_related("drivers__driver__user").all()).order_by("-created_at")
        if request.GET.get("status"):
            qs = qs.filter(status=request.GET.get("status"))
        total = qs.count()
        rows = list(qs[off : off + size])
        vehicles_data = []
        for vehicle in rows:
            row = _serialize_model(vehicle)
            links = [link for link in vehicle.drivers.all() if link.is_active]
            row["drivers"] = [_serialize_driver_vehicle_link(link) for link in links]
            vehicles_data.append(row)
        return _ok({"success": True, "vehicles": vehicles_data, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    body = _json_body(request)
    if request.method == "POST":
        if not body.get("licensePlate") or not body.get("type"):
            return _err("licensePlate and type are required")
        v = Vehicle.objects.create(
            license_plate=body["licensePlate"],
            type=body["type"],
            color=body.get("color"),
            capacity=body.get("capacity"),
            volume=body.get("volume"),
            status=body.get("status") or VehicleStatus.AVAILABLE,
            mileage=body.get("mileage") or 0,
            is_active=bool(body.get("isActive", True)),
        )
        driver_id = str(body.get("driverId") or "").strip()
        if driver_id:
            driver = Driver.objects.filter(id=driver_id).first()
            if not driver:
                return _err("Driver not found", 404)
            _assign_vehicle_to_driver(driver, v)
        return _ok({"success": True, "vehicle": _serialize_model(v)}, 201)
    vehicle_id = str(body.get("id", "")).strip()
    if not vehicle_id:
        return _err("id is required")
    try:
        v = Vehicle.objects.get(id=vehicle_id)
    except Vehicle.DoesNotExist:
        return _err("Vehicle not found", 404)
    mapping = [("licensePlate", "license_plate"), ("type", "type"), ("color", "color"), ("capacity", "capacity"), ("volume", "volume"), ("status", "status"), ("mileage", "mileage")]
    for key, attr in mapping:
        if key in body:
            setattr(v, attr, body.get(key))
    if "driverId" in body:
        driver_id = str(body.get("driverId") or "").strip()
        if driver_id:
            driver = Driver.objects.filter(id=driver_id).first()
            if not driver:
                return _err("Driver not found", 404)
            _assign_vehicle_to_driver(driver, v)
        else:
            DriverVehicle.objects.filter(vehicle=v, is_active=True).update(is_active=False)
    if "isActive" in body:
        v.is_active = bool(body.get("isActive"))
    v.save()
    return _ok({"success": True, "vehicle": _serialize_model(v)})


@csrf_exempt
@require_http_methods(["DELETE"])
def vehicle_detail(request: HttpRequest, vehicle_id: str) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    try:
        v = Vehicle.objects.get(id=vehicle_id)
    except Vehicle.DoesNotExist:
        return _err("Vehicle not found", 404)
    v.delete()
    return _ok({"success": True})


@csrf_exempt
@require_http_methods(["GET", "POST", "PUT"])
def drivers_collection(request: HttpRequest) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        show_sample = str(request.GET.get("includeSample") or request.GET.get("showSample") or "").strip().lower() in {"1", "true", "yes", "on"}
        driver_users = User.objects.select_related("role").filter(role__name="DRIVER")
        if not show_sample:
            driver_users = _real_users(driver_users)
        for user in driver_users:
            if not hasattr(user, "driver"):
                Driver.objects.create(
                    user=user,
                    license_number=f"DRV-{user.id[:12]}",
                    license_type="B",
                    license_expiry=timezone.now() + timedelta(days=365),
                    phone=user.phone,
                    is_active=bool(user.is_active),
                )

        base_qs = Driver.objects.select_related("user").prefetch_related("vehicles__vehicle").all()
        qs = (base_qs if show_sample else _real_drivers(base_qs)).order_by("-created_at")
        if request.GET.get("active") == "true":
            qs = qs.filter(is_active=True)
        total = qs.count()
        rows = list(qs[off : off + size])
        data = []
        for driver in rows:
            row = _serialize_model(driver, include={"user": lambda o: _serialize_model(o.user, exclude={"password"})})
            links = [link for link in driver.vehicles.all() if link.is_active]
            row["vehicles"] = [_serialize_driver_vehicle_link(link) for link in links]
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
        if hasattr(user, "driver"):
            return _err("User already assigned as driver", 409)
        d = Driver.objects.create(
            user=user,
            license_number=body.get("licenseNumber") or f"DRV-{int(timezone.now().timestamp())}",
            license_type=body.get("licenseType") or "B",
            license_expiry=datetime.fromisoformat(body["licenseExpiry"]) if body.get("licenseExpiry") else timezone.now() + timedelta(days=365),
            license_photo=body.get("licensePhoto"),
            phone=body.get("phone") or user.phone,
            emergency_contact=body.get("emergencyContact"),
            is_active=bool(body.get("isActive", True)),
        )
        return _ok({"success": True, "driver": _serialize_model(d, include={"user": lambda o: _serialize_model(o.user, exclude={"password"})})}, 201)
    driver_id = str(body.get("id", "")).strip()
    if not driver_id:
        return _err("id is required")
    try:
        d = Driver.objects.select_related("user").get(id=driver_id)
    except Driver.DoesNotExist:
        return _err("Driver not found", 404)
    mapping = [
        ("licenseNumber", "license_number"),
        ("licenseType", "license_type"),
        ("licensePhoto", "license_photo"),
        ("phone", "phone"),
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
    return _ok({"success": True, "driver": _serialize_model(d, include={"user": lambda o: _serialize_model(o.user, exclude={"password"})})})


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
    drivers = _real_drivers(Driver.objects.select_related("user").all())
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
    cancelled_orders = orders.filter(status=OrderStatus.CANCELLED).count()
    loaded_orders = orders.filter(warehouse_stage=WarehouseStage.LOADED).count()
    total_orders = orders.count()
    total_revenue = float(orders.filter(status=OrderStatus.DELIVERED).aggregate(total=Sum("total_amount")).get("total") or 0)
    active_drivers = drivers.filter(is_active=True, user__is_active=True).count()
    available_drivers = active_drivers
    low_stock_items = inventory.filter(quantity__lte=10).count()
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
            qs = qs.filter(customer_id=p.get("userId"))
        total = qs.count()
        rows = list(qs[off : off + size])
        data = [_serialize_model(x, include={"customer": lambda o: _serialize_model(o.customer, exclude={"password"})}) for x in rows]
        return _ok({"success": True, "feedback": data, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    if request.method == "POST":
        body = _json_body(request)
        customer_id = p.get("userId") if p.get("type") == "customer" else str(body.get("customerId") or "")
        if not customer_id:
            return _err("customerId is required")
        try:
            customer = Customer.objects.get(id=customer_id)
        except Customer.DoesNotExist:
            return _err("Customer not found", 404)
        order = None
        if body.get("orderId"):
            order = Order.objects.filter(id=str(body["orderId"])).first()
        f = Feedback.objects.create(
            customer=customer,
            order=order,
            type=body.get("type") or "SUGGESTION",
            subject=str(body.get("subject") or "General Feedback"),
            message=str(body.get("message") or ""),
            rating=body.get("rating"),
            status="OPEN",
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
    if "status" in body:
        f.status = body.get("status")
    if "response" in body:
        f.response = body.get("response")
        f.responded_at = timezone.now()
        f.responded_by = (_payload(request) or {}).get("userId")
    f.save()
    return _ok({"success": True})


@csrf_exempt
@require_http_methods(["GET", "PATCH"])
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
        include_items = request.GET.get("includeItems", "full")
        where = Q()
        if p.get("type") == "customer":
            where &= Q(customer_id=p.get("userId"))
        if request.GET.get("status"):
            where &= Q(status=_normalize_order_status(request.GET.get("status")))
        s = str(request.GET.get("search", "")).strip()
        if s:
            where &= Q(order_number__icontains=s) | Q(customer__name__icontains=s)
        oqs = _real_orders(
            Order.objects.select_related("customer", "logistics", "timeline")
            .prefetch_related("items__product")
            .filter(where)
        ).order_by("-created_at")
        total = oqs.count() if include_orders else 0
        orders = list(oqs[off : off + size]) if include_orders else []
        out = []
        for o in orders:
            try:
                if _reconcile_delivered_order_from_completed_drop_point(o, p.get("userId")):
                    o.refresh_from_db()
            except ValueError as e:
                logger.warning("Unable to reconcile delivered order %s: %s", o.id, e)
            row = _serialize_order(o, include_items=include_items != "none")
            if include_items == "preview" and "items" in row:
                row["itemCount"] = len(row["items"])
                row["items"] = row["items"][:2]
            if include_items == "none":
                row.pop("items", None)
            out.append(row)
        replacements_out = []
        if include_replacements:
            replacements_qs = Replacement.objects.select_related("order", "order__customer", "order__logistics").filter(
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
        shipping_province = body.get("shippingProvince") if body.get("shippingProvince") is not None else customer.province
        address_error = _ensure_negros_occidental_address(
            latitude=shipping_latitude,
            longitude=shipping_longitude,
            province=shipping_province,
            require_coordinates=True,
        )
        if address_error:
            return _err(address_error, 400)
        try:
            checkout_url: str | None = None
            normalized_payment_method = _normalize_payment_method(body.get("paymentMethod"))
            normalized_items, subtotal = _normalize_order_items_for_checkout(items)
            tax, shipping_cost, discount, total = _compute_order_totals(body, subtotal)

            if _is_paymongo_payment_method(normalized_payment_method):
                if not _is_truthy(getattr(settings, "PAYMONGO_ENABLE_CHECKOUT", "")):
                    return _err("Online payment is not available right now", 400)

                draft_payload = dict(body)
                draft_payload["customerId"] = customer.id
                draft_payload["warehouseId"] = selected_warehouse_id
                draft_payload["items"] = normalized_items
                draft_payload["shippingLatitude"] = shipping_latitude
                draft_payload["shippingLongitude"] = shipping_longitude
                draft_payload["paymentMethod"] = normalized_payment_method
                draft_payload["tax"] = tax
                draft_payload["shippingCost"] = shipping_cost
                draft_payload["discount"] = discount
                draft_payload["totalAmount"] = total

                with transaction.atomic():
                    draft = PaymentCheckoutDraft.objects.create(
                        customer=customer,
                        payment_method=normalized_payment_method,
                        payload=draft_payload,
                        subtotal=subtotal,
                        tax=tax,
                        shipping_cost=shipping_cost,
                        discount=discount,
                        total_amount=total,
                        status="PENDING",
                    )

                    checkout_order = Order(
                        id=draft.id,
                        order_number=f"ORD-PENDING-{str(draft.id)[-8:].upper()}",
                        customer=customer,
                        subtotal=subtotal,
                        tax=tax,
                        shipping_cost=shipping_cost,
                        discount=discount,
                        total_amount=total,
                        payment_method=normalized_payment_method,
                    )
                    checkout_url = _create_paymongo_checkout_session(
                        checkout_order,
                        request,
                        normalized_payment_method,
                        metadata_override={
                            "draft_id": draft.id,
                            "customer_id": customer.id,
                            "payment_method": normalized_payment_method,
                        },
                        redirect_reference_id=draft.id,
                    )
                    draft.checkout_url = checkout_url
                    draft.save(update_fields=["checkout_url", "updated_at"])

                return _ok(
                    {
                        "success": True,
                        "pendingPayment": True,
                        "paymentMethod": normalized_payment_method,
                        "checkoutUrl": checkout_url,
                        "paymentGateway": "PAYMONGO",
                        "draftId": draft.id,
                    },
                    201,
                )

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
                    normalized_payment_method=normalized_payment_method,
                    selected_warehouse_id=selected_warehouse_id,
                    shipping_latitude=shipping_latitude,
                    shipping_longitude=shipping_longitude,
                    payment_status=body.get("paymentStatus") or "pending",
                    performed_by=(p or {}).get("userId"),
                )
        except ValueError as e:
            return _err(str(e), 400)
        except requests.RequestException:
            return _err("Unable to connect to PayMongo right now", 502)
        order = Order.objects.select_related("customer", "logistics", "timeline").prefetch_related("items__product").get(id=order.id)
        response_payload: dict[str, Any] = {"success": True, "order": _serialize_order(order)}
        if checkout_url:
            response_payload["checkoutUrl"] = checkout_url
            response_payload["paymentGateway"] = "PAYMONGO"
        return _ok(response_payload, 201)
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
        ReplacementStatus.REPORTED,
        ReplacementStatus.IN_PROGRESS,
        ReplacementStatus.RESOLVED_ON_DELIVERY,
        ReplacementStatus.NEEDS_FOLLOW_UP,
        ReplacementStatus.COMPLETED,
    }
    if normalized_status not in allowed_statuses:
        return _err("Invalid replacement status", 400)

    r.status = normalized_status
    if normalized_status == ReplacementStatus.IN_PROGRESS:
        r.pickup_completed = timezone.now()
    if normalized_status in {ReplacementStatus.RESOLVED_ON_DELIVERY, ReplacementStatus.COMPLETED}:
        r.processed_at = timezone.now()
        r.processed_by = staff.get("userId")
    r.notes = f"{r.notes or ''}\n{normalized_status}".strip()
    r.save()
    return _ok({"success": True, "replacement": _serialize_replacement(r), "message": "Replacement status updated"})


@require_GET
def order_detail(request: HttpRequest, order_id: str) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    try:
        o = Order.objects.select_related("customer", "logistics", "timeline").prefetch_related("items__product").get(id=order_id)
    except Order.DoesNotExist:
        return _err("Order not found", 404)
    if p.get("type") == "customer" and p.get("userId") != o.customer_id:
        return _err("Forbidden", 403)
    try:
        if _reconcile_delivered_order_from_completed_drop_point(o, p.get("userId")):
            o = Order.objects.select_related("customer", "logistics", "timeline").prefetch_related("items__product").get(id=order_id)
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
    if not status:
        return _err("status is required")
    next_status = _normalize_order_status(status)
    allowed_statuses = {
        OrderStatus.PENDING,
        OrderStatus.CONFIRMED,
        OrderStatus.PREPARING,
        OrderStatus.OUT_FOR_DELIVERY,
        OrderStatus.DELIVERED,
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
        current = Order.objects.select_related("customer", "logistics", "timeline").prefetch_related("items__product").get(id=o.id)
        return _ok({"success": True, "order": _serialize_order(current, include_items=False)})

    if current_status == OrderStatus.DELIVERED and next_status != OrderStatus.DELIVERED:
        return _err("Delivered orders cannot be moved to another status", 400)

    allowed_transitions = {
        OrderStatus.PENDING: {OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.CANCELLED},
        OrderStatus.CONFIRMED: {OrderStatus.PREPARING, OrderStatus.CANCELLED},
        OrderStatus.PREPARING: {OrderStatus.OUT_FOR_DELIVERY, OrderStatus.CANCELLED},
        OrderStatus.OUT_FOR_DELIVERY: {OrderStatus.DELIVERED, OrderStatus.CANCELLED},
        OrderStatus.DELIVERED: set(),
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
            elif next_status == OrderStatus.CANCELLED:
                _release_order_reservations(o, staff.get("userId"))

            o.status = next_status
            o.save(update_fields=["status", "updated_at"])

            timeline, _ = OrderTimeline.objects.get_or_create(order=o)
            now = timezone.now()
            status_map = {
                "CONFIRMED": "confirmed_at",
                "PREPARING": "processed_at",
                "OUT_FOR_DELIVERY": "shipped_at",
                "DELIVERED": "delivered_at",
                "CANCELLED": "cancelled_at",
            }
            field = status_map.get(o.status)
            if field:
                setattr(timeline, field, now)
                timeline.save()
    except ValueError as e:
        return _err(str(e), 400)

    updated = Order.objects.select_related("customer", "logistics", "timeline").prefetch_related("items__product").get(id=o.id)
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
            Trip.objects.select_related("driver__user")
            .filter(drop_points__order_id=order.id, driver__user_id=staff.get("userId"))
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
                Trip.objects.select_related("driver__user")
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

    serialized_order = _serialize_order(
        Order.objects.select_related("customer", "logistics", "timeline").prefetch_related("items__product").get(id=order.id),
        include_items=False,
    )
    return _ok({"success": True, "order": serialized_order, "message": f"Warehouse stage moved to {stage}"})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def trips_collection(request: HttpRequest) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = _real_trips(
            Trip.objects.select_related("driver__user", "vehicle").prefetch_related("drop_points__order").all()
        ).order_by("-created_at")
        tracking_date_raw = str(request.GET.get("trackingDate") or "").strip()
        include_tracking = str(request.GET.get("includeTracking") or "").strip().lower() in {"1", "true", "yes"}

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
                | Q(location_logs__recorded_at__date=tracking_date)
            ).distinct()
        total = qs.count()
        rows = list(qs[off : off + size])
        serialized_rows = [_serialize_trip(t) for t in rows]

        if include_tracking and serialized_rows:
            trip_ids = [row.get("id") for row in serialized_rows if row.get("id")]
            logs_qs = LocationLog.objects.filter(trip_id__in=trip_ids)
            if tracking_date:
                logs_qs = logs_qs.filter(recorded_at__date=tracking_date)
            logs_qs = logs_qs.order_by("recorded_at")

            logs_by_trip: dict[str, list[dict[str, Any]]] = {}
            latest_log_by_trip: dict[str, dict[str, Any]] = {}
            for log in logs_qs:
                if not log.trip_id:
                    continue
                row = _serialize_model(log)
                logs_by_trip.setdefault(log.trip_id, []).append(row)
                latest_log_by_trip[log.trip_id] = row

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
        driver = Driver.objects.select_related("user").get(id=str(body.get("driverId", "")))
        vehicle = Vehicle.objects.get(id=str(body.get("vehicleId", "")))
    except (Driver.DoesNotExist, Vehicle.DoesNotExist):
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

    count = Trip.objects.count() + 1
    trip = Trip.objects.create(trip_number=f"TRP-{timezone.now().year}-{str(count).zfill(4)}", driver=driver, vehicle=vehicle, warehouse_id=body.get("warehouseId"), status=body.get("status") or TripStatus.PLANNED, planned_start_at=datetime.fromisoformat(body["plannedStartAt"]) if body.get("plannedStartAt") else None, notes=body.get("notes"))
    seq = 1
    for oid in requested_order_ids:
        order = Order.objects.filter(id=str(oid)).first()
        if not order:
            continue
        log = OrderLogistics.objects.filter(order=order).first()
        drop_latitude = _to_float_or_none((log.shipping_latitude if log else None) or getattr(order.customer, "latitude", None))
        drop_longitude = _to_float_or_none((log.shipping_longitude if log else None) or getattr(order.customer, "longitude", None))
        TripDropPoint.objects.create(
            trip=trip,
            order=order,
            sequence=seq,
            location_name=(log.shipping_name if log else f"Order {order.order_number}"),
            address=_strip_default_country_suffix(log.shipping_address if log else "Address"),
            city=(log.shipping_city if log else "City"),
            province=(log.shipping_province if log else "Province"),
            zip_code=(log.shipping_zip_code if log else "00000"),
            latitude=drop_latitude,
            longitude=drop_longitude,
            contact_name=(log.shipping_name if log else None),
            contact_phone=(log.shipping_phone if log else None),
        )
        seq += 1
    trip.total_drop_points = trip.drop_points.count()
    trip.save(update_fields=["total_drop_points", "updated_at"])
    trip = Trip.objects.select_related("driver__user", "vehicle").prefetch_related("drop_points__order").get(id=trip.id)
    return _ok({"success": True, "trip": _serialize_trip(trip)}, 201)


@csrf_exempt
@require_http_methods(["DELETE"])
def trip_detail(request: HttpRequest, trip_id: str) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err

    trip = _real_trips(Trip.objects.filter(id=trip_id)).first()
    if not trip:
        return _err("Trip not found", 404)
    if str(trip.status or "").upper() != TripStatus.PLANNED:
        return _err("Only planned trips can be deleted", 409)

    trip_number = trip.trip_number
    trip.delete()
    return _ok({"success": True, "message": f"Trip {trip_number} deleted"})


@require_GET
def driver_trips(request: HttpRequest) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    if p.get("role") != "DRIVER":
        return _err("Forbidden", 403)
    d = Driver.objects.filter(user_id=p.get("userId")).first()
    if not d:
        return _err("Driver profile not found", 404)
    drop_points_prefetch = Prefetch(
        "drop_points",
        queryset=TripDropPoint.objects.select_related(
            "order",
            "order__customer",
            "order__logistics",
            "order__timeline",
        ).prefetch_related(
            "order__items__product",
        ).order_by("sequence"),
    )
    rows = (
        Trip.objects.select_related("driver__user", "vehicle")
        .prefetch_related(drop_points_prefetch)
        .filter(driver=d)
        .order_by("-updated_at")[:100]
    )

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
                "speed": float(latest_log.speed) if latest_log.speed is not None else None,
                "recordedAt": latest_log.recorded_at.isoformat() if latest_log.recorded_at else None,
            }
            if latest_log
            else None
        )
        payload_rows.append(row)

    return _ok({"success": True, "trips": payload_rows})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def customer_orders(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p or p.get("type") != "customer":
        return _err("Unauthorized", 401)
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = _real_orders(
            Order.objects.select_related("customer", "logistics", "timeline")
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
@require_http_methods(["POST"])
def paymongo_webhook(request: HttpRequest) -> JsonResponse:
    if not _verify_paymongo_webhook_signature(request):
        return _err("Invalid PayMongo webhook signature", 401)

    body = _json_body(request)
    event_type = str((((body or {}).get("data") or {}).get("attributes") or {}).get("type") or "").strip().lower()
    paid_events = {
        "checkout_session.payment.paid",
        "payment.paid",
        "source.chargeable",
        "source.paid",
    }
    if event_type and event_type not in paid_events:
        return _ok({"success": True, "ignored": True})

    metadata = _extract_paymongo_metadata(body)
    order_id = str(metadata.get("order_id") or metadata.get("orderId") or "").strip()
    order_number = str(metadata.get("order_number") or metadata.get("orderNumber") or "").strip()
    draft_id = str(metadata.get("draft_id") or metadata.get("draftId") or "").strip()

    if draft_id:
        with transaction.atomic():
            draft = PaymentCheckoutDraft.objects.select_for_update().select_related("customer").filter(id=draft_id).first()
            if not draft:
                return _err("Checkout draft not found for webhook metadata", 404)

            if str(draft.status or "").upper() == "COMPLETED" and draft.order_id:
                return _ok({"success": True, "orderId": draft.order_id, "duplicate": True})

            try:
                draft_payload = dict(draft.payload or {})
                normalized_payment_method = _normalize_payment_method(draft.payment_method or draft_payload.get("paymentMethod"))
                items = draft_payload.get("items") or []
                normalized_items, subtotal = _normalize_order_items_for_checkout(items)
                tax, shipping_cost, discount, total = _compute_order_totals(draft_payload, subtotal)
                selected_warehouse_id = str(draft_payload.get("warehouseId") or "").strip() or None
                shipping_latitude = (
                    draft_payload.get("shippingLatitude")
                    if draft_payload.get("shippingLatitude") is not None
                    else draft.customer.latitude
                )
                shipping_longitude = (
                    draft_payload.get("shippingLongitude")
                    if draft_payload.get("shippingLongitude") is not None
                    else draft.customer.longitude
                )
                order = _create_order_from_checkout_payload(
                    customer=draft.customer,
                    body=draft_payload,
                    normalized_items=normalized_items,
                    subtotal=subtotal,
                    tax=tax,
                    shipping_cost=shipping_cost,
                    discount=discount,
                    total_amount=total,
                    normalized_payment_method=normalized_payment_method,
                    selected_warehouse_id=selected_warehouse_id,
                    shipping_latitude=shipping_latitude,
                    shipping_longitude=shipping_longitude,
                    payment_status="paid",
                    performed_by="paymongo_webhook",
                )
            except ValueError as exc:
                return _err(str(exc), 400)

            draft.status = "COMPLETED"
            draft.order = order
            draft.completed_at = timezone.now()
            draft.save(update_fields=["status", "order", "completed_at", "updated_at"])
            return _ok({"success": True, "orderId": order.id})

    order = None
    if order_id:
        order = Order.objects.filter(id=order_id).first()
    if not order and order_number:
        order = Order.objects.filter(order_number=order_number).first()
    if not order:
        return _err("Order not found for webhook metadata", 404)

    update_fields = ["payment_status", "updated_at"]
    order.payment_status = "paid"
    order.save(update_fields=update_fields)
    return _ok({"success": True})


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
    if o.status in {OrderStatus.PREPARING, OrderStatus.DELIVERED, OrderStatus.CANCELLED}:
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
    qs = Replacement.objects.select_related("order", "order__customer", "order__logistics")

    if p.get("type") == "customer":
        qs = qs.filter(order__in=_real_orders(Order.objects.all()))
        qs = qs.filter(customer_id=p.get("userId"))
    elif p.get("type") != "staff":
        return _err("Forbidden", 403)

    warehouse_id = str(request.GET.get("warehouseId") or "").strip()
    if warehouse_id:
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


@require_GET
def customer_replacements(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p or p.get("type") != "customer":
        return _err("Unauthorized", 401)
    return replacements_collection(request)


@require_GET
def customer_tracking(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p or p.get("type") != "customer":
        return _err("Unauthorized", 401)
    orders = list(
        _real_orders(Order.objects.select_related("logistics", "customer").filter(customer_id=p.get("userId")))
        .order_by("-updated_at")[:100]
    )
    order_ids = [o.id for o in orders]

    latest_drop_point_by_order: dict[str, TripDropPoint] = {}
    trip_ids: set[str] = set()
    if order_ids:
        drop_points = (
            TripDropPoint.objects.select_related("trip__driver__user", "trip__vehicle")
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
    route_logs_by_trip: dict[str, list[LocationLog]] = {}
    if trip_ids:
        logs = LocationLog.objects.filter(trip_id__in=list(trip_ids)).order_by("trip_id", "-recorded_at")
        for log in logs:
            if not log.trip_id:
                continue
            if log.trip_id not in latest_log_by_trip:
                latest_log_by_trip[log.trip_id] = log
            bucket = route_logs_by_trip.setdefault(log.trip_id, [])
            if len(bucket) < 40:
                bucket.append(log)

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
        shipping_lat = _to_float_or_none((o.logistics.shipping_latitude if o.logistics else None) or getattr(o.customer, "latitude", None))
        shipping_lng = _to_float_or_none((o.logistics.shipping_longitude if o.logistics else None) or getattr(o.customer, "longitude", None))

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
        if trip and trip.id in route_logs_by_trip:
            latest_first_logs = route_logs_by_trip[trip.id]
            for log in reversed(latest_first_logs):
                log_lat = _to_float_or_none(getattr(log, "latitude", None))
                log_lng = _to_float_or_none(getattr(log, "longitude", None))
                if log_lat is None or log_lng is None:
                    continue
                route_points.append(
                    {
                        "latitude": float(log_lat),
                        "longitude": float(log_lng),
                        "recordedAt": log.recorded_at.isoformat() if log.recorded_at else None,
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
            raw_speed_mps = _to_float_or_none(getattr(latest_log, "speed", None)) if latest_log else None
            speed_kph = (raw_speed_mps * 3.6) if raw_speed_mps and raw_speed_mps > 0 else 24.0
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
    d = Driver.objects.filter(user_id=p.get("userId")).first()
    if not d:
        return _err("Driver not found", 404)
    body = _json_body(request)
    lat = _to_float_or_none(body.get("latitude"))
    lng = _to_float_or_none(body.get("longitude"))
    if lat is None or lng is None:
        return _err("Invalid coordinates")
    accuracy = _to_float_or_none(body.get("accuracy"))
    heading = _to_float_or_none(body.get("heading"))
    speed = _to_float_or_none(body.get("speed"))
    altitude = _to_float_or_none(body.get("altitude"))
    trip_id = body.get("tripId")
    if not trip_id:
        t = Trip.objects.filter(driver=d, status=TripStatus.IN_PROGRESS).order_by("-updated_at").first()
        trip_id = t.id if t else None
    log = LocationLog.objects.create(
        driver=d,
        trip_id=trip_id,
        latitude=lat,
        longitude=lng,
        speed=speed,
        heading=heading,
        altitude=altitude,
        accuracy=accuracy,
        battery=body.get("battery"),
    )
    return _ok({"success": True, "locationLogId": log.id})


@csrf_exempt
@require_http_methods(["GET", "PUT"])
def driver_profile(request: HttpRequest) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    if p.get("role") != "DRIVER":
        return _err("Forbidden", 403)
    d = Driver.objects.select_related("user").filter(user_id=p.get("userId")).first()
    if not d:
        return _err("Driver profile not found", 404)
    if request.method == "GET":
        return _ok({"success": True, "driver": _serialize_model(d, include={"user": lambda o: _serialize_model(o.user, exclude={"password"})})})
    body = _json_body(request)
    for key, attr in [
        ("phone", "phone"),
        ("emergencyContact", "emergency_contact"),
        ("licenseNumber", "license_number"),
        ("licenseType", "license_type"),
        ("licensePhoto", "license_photo"),
    ]:
        if key in body:
            setattr(d, attr, body.get(key))
    if "licenseExpiry" in body and body.get("licenseExpiry"):
        d.license_expiry = datetime.fromisoformat(str(body["licenseExpiry"]).replace("Z", "+00:00"))
    d.save()
    for key, attr in [("name", "name"), ("phone", "phone"), ("avatar", "avatar")]:
        if key in body:
            setattr(d.user, attr, body.get(key))
    d.user.save()
    return _ok({"success": True, "driver": _serialize_model(d, include={"user": lambda o: _serialize_model(o.user, exclude={"password"})})})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def driver_spare_products(request: HttpRequest) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    if p.get("role") != "DRIVER":
        return _err("Forbidden", 403)
    d = Driver.objects.filter(user_id=p.get("userId")).first()
    if not d:
        return _err("Driver not found", 404)
    if request.method == "GET":
        rows = (
            DriverSpareStock.objects.select_related("product")
            .filter(driver=d, product__in=_real_products(Product.objects.all()))
            .order_by("product__name")
        )
        data = [_serialize_model(x, include={"product": lambda o: _serialize_model(o.product)}) for x in rows]
        return _ok({"success": True, "spareProducts": data})
    body = _json_body(request)
    pid = str(body.get("productId") or "")
    qty = _int(body.get("quantity"), 0)
    if not pid or qty == 0:
        return _err("productId and non-zero quantity are required")
    prod = Product.objects.filter(id=pid).first()
    if not prod:
        return _err("Product not found", 404)
    stock, _ = DriverSpareStock.objects.get_or_create(driver=d, product=prod, defaults={"quantity": 0, "min_quantity": 0})
    stock.quantity += qty
    if "minQuantity" in body:
        stock.min_quantity = _int(body.get("minQuantity"), stock.min_quantity)
    stock.save()
    SpareStockTransaction.objects.create(driver=d, product=prod, type=body.get("type") or ("IN" if qty > 0 else "OUT"), quantity=qty, reference_type=body.get("referenceType"), reference_id=body.get("referenceId"), notes=body.get("notes"))
    serialized = _serialize_model(stock)
    return _ok({"success": True, "spareProducts": serialized})


@csrf_exempt
@require_http_methods(["POST"])
def driver_replacements_from_spare_products(request: HttpRequest) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    if p.get("role") != "DRIVER":
        return _err("Forbidden", 403)
    d = Driver.objects.filter(user_id=p.get("userId")).first()
    if not d:
        return _err("Driver not found", 404)
    body = _json_body(request)
    pickup_address_error = _ensure_negros_occidental_address(
        latitude=None,
        longitude=None,
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

    replacement_lines_raw = body.get("items") if isinstance(body.get("items"), list) else []
    if replacement_lines_raw and not follow_up_return:
        order_id = str(body.get("orderId") or "").strip()
        order = Order.objects.filter(id=order_id).first()
        if not order:
            return _err("orderId is required")
        replacement_lines: list[dict[str, Any]] = []
        for index, raw_line in enumerate(replacement_lines_raw, start=1):
            if not isinstance(raw_line, dict):
                return _err(f"Replacement item {index} is invalid", 400)
            order_item_id = str(raw_line.get("orderItemId") or "").strip()
            order_item = OrderItem.objects.select_related("order", "product").filter(id=order_item_id, order_id=order.id).first()
            if not order_item:
                return _err(f"Replacement item {index} was not found on this order", 400)
            quantity_to_replace = _int(raw_line.get("quantityToReplace", raw_line.get("quantity")), 0)
            if quantity_to_replace <= 0:
                return _err(f"Replacement item {index} quantity to replace must be greater than zero", 400)
            if quantity_to_replace > _int(order_item.quantity, 0):
                return _err(f"Replacement item {index} quantity cannot exceed ordered quantity", 400)
            quantity_replaced = quantity_to_replace if resolved_on_delivery else _int(raw_line.get("quantityReplaced", raw_line.get("partiallyReplacedQuantity")), 0)
            if quantity_replaced < 0:
                return _err(f"Replacement item {index} quantity replaced cannot be negative", 400)
            if quantity_replaced > quantity_to_replace:
                return _err(f"Replacement item {index} quantity replaced cannot exceed quantity to replace", 400)
            if resolved_on_delivery and quantity_replaced <= 0:
                return _err(f"Replacement item {index} quantity replaced must be greater than zero", 400)
            stock = DriverSpareStock.objects.filter(driver=d, product=order_item.product).first()
            available_qty = _int(getattr(stock, "quantity", 0), 0)
            if quantity_replaced > available_qty:
                return _err(f"Insufficient spare products for {order_item.product.name}", 400)
            replacement_lines.append({
                "orderItem": order_item,
                "product": order_item.product,
                "stock": stock,
                "availableQty": available_qty,
                "quantityToReplace": quantity_to_replace,
                "quantityReplaced": quantity_replaced,
            })
        if not replacement_lines:
            return _err("At least one replacement item is required", 400)

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
                product = line["product"]
                order_item = line["orderItem"]
                if quantity_replaced > 0:
                    stock = line["stock"]
                    if stock is None:
                        return _err(f"Insufficient spare products for {product.name}", 400)
                    stock.quantity -= quantity_replaced
                    stock.save(update_fields=["quantity", "updated_at"])
                    SpareStockTransaction.objects.create(
                        driver=d,
                        product=product,
                        type="OUT",
                        quantity=quantity_replaced,
                        reference_type="replacement",
                        reference_id=order.id,
                        notes="Driver replacement from spare products",
                    )
                meta = {
                    "outcome": outcome,
                    "damagePhotos": damage_photos,
                    "reportedAt": timezone.now().isoformat(),
                    "tripId": str(body.get("tripId") or "").strip() or None,
                    "dropPointId": str(body.get("dropPointId") or "").strip() or None,
                    "quantityToReplace": quantity_to_replace,
                    "quantityReplaced": quantity_replaced,
                    "remainingQuantity": max(quantity_to_replace - quantity_replaced, 0),
                    "replacementLines": [{
                        "originalOrderItemId": order_item.id,
                        "originalProductName": product.name,
                        "originalProductSku": product.sku,
                        "replacementProductName": product.name,
                        "replacementProductSku": product.sku,
                        "quantityToReplace": quantity_to_replace,
                        "quantityReplaced": quantity_replaced,
                        "remainingQuantity": max(quantity_to_replace - quantity_replaced, 0),
                    }],
                }
                created_returns.append(Replacement.objects.create(
                    replacement_number=f"RET-{timezone.now().year}-{str(count + offset).zfill(4)}",
                    order=order,
                    customer_id=order.customer_id,
                    reason=str(body.get("reason") or "Damaged item"),
                    description=body.get("description") or ("Replacement fulfilled by driver spare products" if resolved_on_delivery else "Partial replacement from driver spare products; follow-up required"),
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
                    processed_at=timezone.now() if resolved_on_delivery else None,
                    processed_by=p.get("userId") if resolved_on_delivery else None,
                    notes=f"{'Immediate replacement completed by driver' if resolved_on_delivery else 'Partial replacement reported by driver'}\nMeta: {json.dumps(meta)}",
                ))
        serialized_returns = [_serialize_replacement(entry) for entry in created_returns]
        remaining_spare_products = sum(
            max(_int(line["availableQty"], 0) - _int(line["quantityReplaced"], 0), 0)
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
        remaining_to_replace = max(follow_up_quantity_to_replace - _int(follow_up_return.replacement_quantity, 0), 0)
        if order_item and qty > remaining_to_replace:
            return _err("quantity cannot exceed the remaining quantity to replace", 400)
        quantity_replaced = qty
    else:
        follow_up_quantity_to_replace = qty

    stock = DriverSpareStock.objects.filter(driver=d, product=product).first() if product else None
    available_qty = _int(getattr(stock, "quantity", 0), 0)
    if quantity_replaced > available_qty:
        return _err("Insufficient spare products for selected replacement quantity", 400)
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
        "quantityReplaced": _int(getattr(follow_up_return, "replacement_quantity", 0), 0) + quantity_replaced if follow_up_return else quantity_replaced,
        "remainingQuantity": max(follow_up_quantity_to_replace - (_int(getattr(follow_up_return, "replacement_quantity", 0), 0) + quantity_replaced if follow_up_return else quantity_replaced), 0),
    }

    with transaction.atomic():
        if quantity_replaced > 0:
            stock.quantity -= quantity_replaced
            stock.save(update_fields=["quantity", "updated_at"])
            SpareStockTransaction.objects.create(
                driver=d,
                product=product,
                type="OUT",
                quantity=quantity_replaced,
                reference_type="replacement",
                reference_id=order.id,
                notes="Driver replacement from spare products",
            )
        if follow_up_return:
            follow_up_return.status = ReplacementStatus.COMPLETED
            follow_up_return.replacement_mode = follow_up_return.replacement_mode or replacement_mode
            follow_up_return.replacement_quantity = _int(follow_up_return.replacement_quantity, 0) + quantity_replaced
            follow_up_return.damage_photo_url = damage_photos[0]
            follow_up_return.processed_at = timezone.now()
            follow_up_return.processed_by = p.get("userId")
            follow_up_return.notes = (
                f"{follow_up_return.notes or ''}\nFollow-up replacement completed by driver\nMeta: {json.dumps(meta)}"
            ).strip()
            follow_up_return.save()
            r = follow_up_return
        else:
            count = Replacement.objects.count() + 1
            r = Replacement.objects.create(
                replacement_number=f"RET-{timezone.now().year}-{str(count).zfill(4)}",
                order=order,
                customer_id=order.customer_id,
                reason=str(body.get("reason") or "Damaged item"),
                description=body.get("description") or ("Replacement fulfilled by driver spare products" if resolved_on_delivery else "Partial replacement from driver spare products; follow-up required"),
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
                processed_at=timezone.now() if resolved_on_delivery else None,
                processed_by=p.get("userId") if resolved_on_delivery else None,
                notes=f"{'Immediate replacement completed by driver' if resolved_on_delivery else 'Partial replacement reported by driver'}\nMeta: {json.dumps(meta)}",
            )
    serialized_return = _serialize_replacement(r)
    remaining_qty = _int(serialized_return.get("remainingQuantity"), max(qty - quantity_replaced, 0))
    remaining_spare_products = max(available_qty - quantity_replaced, 0)
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
            Order.objects.select_related("customer", "logistics", "timeline")
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
            log = getattr(o, "logistics", None)
            city = str((log.shipping_city if log else None) or "Unknown").strip() or "Unknown"
            latitude = _to_float_or_none((log.shipping_latitude if log else None) or o.customer.latitude)
            longitude = _to_float_or_none((log.shipping_longitude if log else None) or o.customer.longitude)
            address = str((log.shipping_address if log else None) or "").strip()
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
                "customerName": o.customer.name,
                "address": address,
                "shippingAddress": address,
                "city": city,
                "province": log.shipping_province if log else None,
                "zipCode": log.shipping_zip_code if log else None,
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
            _serialize_model(x, include={"user": lambda o: _serialize_model(o.user, exclude={"password"})})
            for x in _real_drivers(Driver.objects.select_related("user").filter(is_active=True))[:200]
        ]
        vehicles = [
            _serialize_model(x)
            for x in _real_vehicles(Vehicle.objects.filter(status=VehicleStatus.AVAILABLE, is_active=True))[:200]
        ]
        return _ok({"success": True, "drivers": drivers, "vehicles": vehicles, "orders": orders, "routePlans": route_plans})
    body = _json_body(request)
    return _ok({"success": True, "routePlan": body, "message": "Route plan accepted"})


@csrf_exempt
@require_http_methods(["GET", "POST", "DELETE"])
def trips_saved_routes(request: HttpRequest) -> JsonResponse:
    payload, err = _require_staff(request)
    if err:
        return err

    role = str(payload.get("role") or "").upper()
    user_id = str(payload.get("userId") or "").strip() or None

    if request.method == "GET":
        qs = SavedRouteDraft.objects.all().order_by("-created_at")

        warehouse_id = str(request.GET.get("warehouseId") or "").strip()
        if warehouse_id:
            qs = qs.filter(warehouse_id=warehouse_id)

        # Warehouse users should only see their own drafts.
        if role == "WAREHOUSE_STAFF" and user_id:
            qs = qs.filter(created_by_user_id=user_id)

        route_rows = list(qs[:300])
        warehouse_ids = {str(route.warehouse_id) for route in route_rows if route.warehouse_id}
        warehouse_lookup = {
            warehouse.id: (
                _to_float_or_none(warehouse.latitude),
                _to_float_or_none(warehouse.longitude),
            )
            for warehouse in _real_warehouses(Warehouse.objects.filter(id__in=warehouse_ids)).only("id", "latitude", "longitude")
        }

        rows = []
        for route in route_rows:
            row = _serialize_saved_route(route)
            start_lat, start_lng = warehouse_lookup.get(str(route.warehouse_id), (None, None))
            orders_raw = [dict(order) for order in (row.get("orders") or []) if isinstance(order, dict)]
            enriched_orders, computed_total_km = _compute_order_distances(orders_raw, start_lat, start_lng)
            row["orders"] = enriched_orders
            if enriched_orders:
                row["totalDistanceKm"] = computed_total_km
            rows.append(row)
        return _ok({"success": True, "savedRoutes": rows})

    if request.method == "POST":
        body = _json_body(request)

        date_raw = str(body.get("date") or "").strip()
        warehouse_id = str(body.get("warehouseId") or "").strip()
        warehouse_name = str(body.get("warehouseName") or "").strip()
        city = str(body.get("city") or "").strip()
        total_distance_km = body.get("totalDistanceKm")
        order_ids = body.get("orderIds") or []
        orders = body.get("orders") or []

        if not date_raw or not warehouse_id or not city:
            return _err("date, warehouseId, and city are required")

        try:
            parsed_date = datetime.fromisoformat(date_raw).date()
        except ValueError:
            return _err("Invalid date. Expected YYYY-MM-DD")

        if not isinstance(order_ids, list) or len(order_ids) == 0:
            return _err("At least one orderId is required")

        if not isinstance(orders, list):
            return _err("orders must be an array")

        try:
            total_distance_value = float(total_distance_km or 0)
        except (TypeError, ValueError):
            total_distance_value = 0.0

        created_by = User.objects.filter(id=user_id).first() if user_id else None
        route = SavedRouteDraft.objects.create(
            date=parsed_date,
            warehouse_id=warehouse_id,
            warehouse_name=warehouse_name or "Unknown Warehouse",
            city=city,
            total_distance_km=total_distance_value,
            order_ids=[str(x) for x in order_ids],
            orders_json=orders,
            created_by_user=created_by,
        )
        return _ok({"success": True, "savedRoute": _serialize_saved_route(route)}, 201)

    body = _json_body(request)
    route_id = str(request.GET.get("id") or body.get("id") or "").strip()
    if not route_id:
        return _err("Route id is required")

    route = SavedRouteDraft.objects.filter(id=route_id).first()
    if not route:
        return _err("Saved route not found", 404)

    if role == "WAREHOUSE_STAFF" and user_id and route.created_by_user_id and route.created_by_user_id != user_id:
        return _err("Forbidden", 403)

    route.delete()
    return _ok({"success": True})


@csrf_exempt
@require_http_methods(["POST"])
def trip_start(request: HttpRequest, trip_id: str) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    t = Trip.objects.prefetch_related("drop_points__order").filter(id=trip_id).first()
    if not t:
        return _err("Trip not found", 404)
    if p.get("role") == "DRIVER" and p.get("userId") != t.driver.user_id:
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
            if str(order.warehouse_stage or "").upper() == WarehouseStage.LOADED:
                order.warehouse_stage = WarehouseStage.DISPATCHED
                order.warehouse_dispatched_at = now
                order.status = OrderStatus.OUT_FOR_DELIVERY
                order.save(update_fields=["warehouse_stage", "warehouse_dispatched_at", "status", "updated_at"])

                timeline, _ = OrderTimeline.objects.get_or_create(order=order)
                if not timeline.shipped_at:
                    timeline.shipped_at = now
                    timeline.save(update_fields=["shipped_at", "updated_at"])
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
    if p.get("role") == "DRIVER" and p.get("userId") != dp.trip.driver.user_id:
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
            if not _is_replacement_closed(entry):
                open_replacements.append(entry)
        if open_replacements:
            return _err("Drop point cannot be completed while a replacement follow-up is still open", 400)
    dp.status = next_status
    mapping = [("recipientName", "recipient_name"), ("recipientSignature", "recipient_signature"), ("deliveryPhoto", "delivery_photo"), ("failureReason", "failure_reason"), ("failureNotes", "failure_notes"), ("notes", "notes")]
    for key, attr in mapping:
        if key in body:
            setattr(dp, attr, body.get(key))
    now = timezone.now()
    if next_status == "ARRIVED":
        dp.actual_arrival = now
    if next_status in {"COMPLETED", "FAILED", "SKIPPED"}:
        dp.actual_departure = now
    dp.save()

    delivered_order = None
    if next_status == "COMPLETED" and dp.order_id:
        delivered_order = Order.objects.select_related("timeline").filter(id=dp.order_id).first()
        if delivered_order:
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
    should_release_inventory = next_status == "SKIPPED" or parsed_release_inventory

    # If drop point is marked as FAILED or SKIPPED, optionally return items back to inventory
    if next_status in {"FAILED", "SKIPPED"} and should_release_inventory and dp.order_id:
        order = Order.objects.prefetch_related("items").filter(id=dp.order_id).first()
        if order:
            user_id = str(p.get("userId") or "").strip() or None
            for order_item in order.items.all():
                _adjust_reserved_for_order_item(
                    order_item=order_item,
                    operation="release",
                    performed_by=user_id,
                )

    if next_status in {"FAILED", "SKIPPED"} and dp.order_id:
        order = Order.objects.select_related("timeline").filter(id=dp.order_id).first()
        if order:
            timeline = getattr(order, "timeline", None)
            if next_status == "FAILED" and reschedule_requested:
                order.status = OrderStatus.PREPARING
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

    terminal_drop_point_statuses = ["COMPLETED", "FAILED", "SKIPPED"]
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
            Order.objects.select_related("customer", "logistics", "timeline").prefetch_related("items__product").get(id=delivered_order.id),
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
def upload_customer_avatar(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    return _handle_image_upload(request, "customers", "customer")


@csrf_exempt
@require_http_methods(["POST"])
def upload_driver_license(request: HttpRequest) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    if p.get("role") != "DRIVER":
        return _err("Forbidden", 403)
    return _handle_image_upload(request, "driver-licenses", "license")


def ensure_demo_accounts() -> None:
    super_admin_role, _ = Role.objects.get_or_create(name="SUPER_ADMIN", defaults={"description": "Full system access"})
    driver_role, _ = Role.objects.get_or_create(name="DRIVER", defaults={"description": "Delivery driver"})
    warehouse_role, _ = Role.objects.get_or_create(name="WAREHOUSE_STAFF", defaults={"description": "Warehouse operations"})
    User.objects.get_or_create(email="admin@logistics.com", defaults={"name": "Admin User", "password": hash_password("admin123"), "phone": "+1-555-0100", "role": super_admin_role, "is_active": True})
    driver_user, _ = User.objects.get_or_create(email="driver@logistics.com", defaults={"name": "Demo Driver", "password": hash_password("driver123"), "phone": "+1-555-0103", "role": driver_role, "is_active": True})
    User.objects.get_or_create(email="warehouse@logistics.com", defaults={"name": "Warehouse Staff", "password": hash_password("admin123"), "phone": "+1-555-0102", "role": warehouse_role, "is_active": True})
    Customer.objects.get_or_create(email="customer@example.com", defaults={"name": "Demo Customer", "password": hash_password("customer123"), "phone": "+1-555-0104", "is_active": True})
    Driver.objects.get_or_create(user=driver_user, defaults={"license_number": f"DEMO-DRIVER-{driver_user.id[-6:].upper()}", "license_type": "B", "license_expiry": timezone.now() + timedelta(days=1500), "phone": driver_user.phone, "is_active": True})
