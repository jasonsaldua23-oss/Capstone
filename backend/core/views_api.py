import hashlib
import hmac
import base64
import json
import logging
import math
import os
import requests
import re
import secrets
from html import escape
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any

from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from django.db import IntegrityError, connection, transaction
from django.db.models.deletion import ProtectedError
from django.db.models import F, Max, Prefetch, Q, Sum
from django.conf import settings
from django.core import signing
from django.core.mail import send_mail
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.forms.models import model_to_dict
from django.http import HttpRequest, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from .auth import (
    REMEMBER_ME_EXP_HOURS,
    TOKEN_EXP_HOURS,
    TOKEN_NAME,
    STAFF_TOKEN_NAME,
    CUSTOMER_TOKEN_NAME,
    create_token,
    decode_token,
    extract_token,
    hash_password,
    verify_password,
)
from .models import (
    Customer,
    ContainerType,
    CustomerBottleBalance,
    CustomerDepositLedger,
    Feedback,
    Inventory,
    InventoryReservation,
    InventoryTransaction,
    LocationLog,
    MixedCaseComponent,
    Notification,
    Order,
    OrderItem,
    OrderItemType,
    PurchaseOrderStage,
    PurchaseRequestStatus,
    OrderStatus,
    OrderTimeline,
    Product,
    ProductPackaging,
    Replacement,
    ReplacementStatus,
    ReservationStatus,
    RoleType,
    SalesChannel,
    StockBatch,
    Trip,
    TripDropPoint,
    TripStatus,
    User,
    Vehicle,
    VehicleStatus,
    Warehouse,
)
from .retail_pos import (
    cancel_retail_sale,
    create_retail_sale,
    money,
    quote_retail_cart,
    serialize_retail_product,
    serialize_retail_quote,
    serialize_retail_sale,
    update_retail_payment,
    update_retail_pickup_status,
)
from .pod_overlay import build_driver_full_name, burn_pod_overlay, parse_pod_overlay_metadata
from .mixed_case import (
    consume_order_item_reservations,
    normalize_checkout_items,
    release_order_item_reservations,
    reserve_order_item,
    serialize_mixed_component,
)


logger = logging.getLogger(__name__)

PRODUCT_UNIT_CASE = "case"
PRODUCT_UNIT_PACK_BUNDLE = "pack"
PRODUCT_UNIT_BOTTLE = "bottle"
PRODUCT_UNIT_MIXED_CASE = "mixed_case"
ALLOWED_PRODUCT_UNITS = {PRODUCT_UNIT_CASE, PRODUCT_UNIT_PACK_BUNDLE, PRODUCT_UNIT_BOTTLE, PRODUCT_UNIT_MIXED_CASE}

HIDDEN_SAMPLE_WORDS = ("test", "demo", "sample", "dummy", "placeholder", "fake")
HIDDEN_SAMPLE_EMAIL_DOMAINS = ("@example.com", "@test.com", "@demo.com")
PASSWORD_POLICY_ERROR = "Password must be at least 8 characters and include uppercase, lowercase, number, and special character, with no spaces."
PHILIPPINE_PHONE_ERROR = "Please enter a valid Philippine mobile number"
DRIVER_RESTRICTIONS = {"A", "A1", "B", "B1", "B2", "C", "D", "BE", "CE"}
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


def _get_allowed_warehouse_ids_for_staff(user_id: str) -> set[str]:
    normalized_user_id = str(user_id or "").strip()
    if not normalized_user_id:
        return set()
    return {
        str(warehouse_id).strip()
        for warehouse_id in
        Warehouse.objects.filter(manager_id=normalized_user_id).values_list("id", flat=True)
        if str(warehouse_id).strip()
    }


def _resolve_requested_warehouse_manager_id(body: dict[str, Any], manager_id_fallback: str = "") -> str:
    manager_id = str(body.get("managerId") or "").strip()
    if manager_id:
        return manager_id
    requested_staff_ids = [
        str(value or "").strip()
        for value in (body.get("staffIds") or [])
        if str(value or "").strip()
    ]
    if requested_staff_ids:
        return requested_staff_ids[0]
    return str(manager_id_fallback or "").strip()


def _find_staff_already_assigned_elsewhere(staff_id: str, current_warehouse_id: str | None = None) -> str | None:
    normalized_staff_id = str(staff_id or "").strip()
    if not normalized_staff_id:
        return None
    manager_qs = Warehouse.objects.filter(manager_id=normalized_staff_id)
    if current_warehouse_id:
        manager_qs = manager_qs.exclude(id=current_warehouse_id)
    for warehouse in manager_qs.only("id", "name", "code", "manager_id"):
        return f"{warehouse.name} ({warehouse.code})"
    return None


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
        parsed = None
        # Accept common manually typed date formats from browser date fallbacks.
        for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y"):
            try:
                parsed = datetime.strptime(raw, fmt)
                break
            except ValueError:
                continue
        if parsed is None:
            return None
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def _normalize_philippine_phone(value: Any) -> str | None:
    """Keep staff phone values numeric and limited to supported Philippine mobile formats."""
    phone = str(value or "").strip()
    if re.fullmatch(r"(?:09\d{9}|63\d{10})", phone):
        return phone
    return None


PHILIPPINE_DRIVER_LICENSE_REGEX = re.compile(r"^[A-Z]\d{2}-\d{2}-\d{6}$")


def _validate_philippine_driver_license(value: Any) -> tuple[str | None, str | None]:
    """Validate Philippine LTO driver's license format (e.g. D09-22-000984, X00-00-000000)."""
    raw = str(value or "").strip().upper()
    if not raw:
        return None, "Driver's license number is required."
    if not PHILIPPINE_DRIVER_LICENSE_REGEX.match(raw):
        return None, "Driver's license number must follow the format X00-00-000000 (e.g. D09-22-000984)."
    return raw, None


def _validate_future_license_expiry(value: Any) -> tuple[datetime | None, str | None]:
    """Parse a license date and reject dates earlier than the current local date."""
    parsed = _parse_iso_datetime(value)
    if not parsed:
        return None, "Invalid licenseExpiry format"
    if timezone.localtime(parsed).date() < timezone.localdate():
        return None, "License expiration date cannot be in the past."
    return parsed, None


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


def _generate_next_purchase_workflow_number(field_name: str, prefix: str) -> str:
    """Return the next PR/PO number while preserving the existing four-digit format."""
    year = timezone.now().year
    full_prefix = f"{prefix}-{year}-"
    max_sequence = 0
    for value in Order.objects.filter(**{f"{field_name}__startswith": full_prefix}).values_list(field_name, flat=True):
        suffix = str(value or "")[len(full_prefix):]
        if suffix.isdigit():
            max_sequence = max(max_sequence, int(suffix))
    return f"{full_prefix}{str(max_sequence + 1).zfill(4)}"


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
    pr_number = _generate_next_purchase_workflow_number("purchase_request_number", "PR")

    order = Order.objects.create(
        order_number=pr_number,
        request_id=str(body.get("requestId") or "").strip() or None,
        # Customer submissions start as Purchase Requests without a PO number until approved.
        purchase_order_number=None,
        purchase_request_number=pr_number,
        customer=customer,
        request_status=PurchaseRequestStatus.PENDING_APPROVAL,
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
    mixed_case_net_deposit = 0.0
    for item in normalized_items:
        if str(item.get("itemType") or "").strip().upper() == OrderItemType.MIXED_CASE:
            order_item = OrderItem.objects.create(
                order=order,
                product=None,
                product_name="Mixed Case",
                product_sku="MIXED-CASE",
                product_unit=PRODUCT_UNIT_MIXED_CASE,
                item_type=OrderItemType.MIXED_CASE,
                case_capacity=_int(item.get("caseCapacity"), 0),
                quantity=_int(item.get("quantity"), 0),
                unit_price=float(item.get("unitPrice") or 0),
                total_price=float(item.get("totalPrice") or 0),
                product_subtotal=item.get("totalPrice") or 0,
                notes=item.get("notes"),
            )
            item_deposit = 0.0
            for component in item.get("components") or []:
                product = component.get("product")
                if product is None:
                    raise ValueError("Mixed Case component product is unavailable")
                packaging = (
                    ProductPackaging.objects.filter(product=product, is_active=True)
                    .select_related("container_type")
                    .order_by("-is_primary", "created_at")
                    .first()
                )
                deposit_per_unit = float(packaging.deposit_amount or 0) if packaging and packaging.is_returnable else 0.0
                total_base_units = max(0, _int(component.get("totalBaseUnits"), 0))
                empty_covered = min(
                    total_base_units,
                    max(0, _int(component.get("emptyReturnedQuantity"), 0)),
                )
                component_deposit = max(0.0, (total_base_units - empty_covered) * deposit_per_unit)
                item_deposit += component_deposit
                MixedCaseComponent.objects.create(
                    order_item=order_item,
                    product=product,
                    product_name=product.name,
                    product_sku=product.sku,
                    base_unit_label=component.get("baseUnitLabel") or "bottle",
                    quantity_per_case=_int(component.get("quantityPerCase"), 0),
                    case_count=_int(component.get("caseCount"), 0),
                    total_base_units=total_base_units,
                    unit_price=component.get("unitPrice") or 0,
                    component_subtotal=component.get("componentSubtotal") or 0,
                    product_category=product.category,
                    packaging_type_snapshot=("RETURNABLE" if packaging and packaging.is_returnable else "NON_RETURNABLE"),
                    container_type_id=(packaging.container_type_id if packaging else None),
                    container_type_name=(packaging.container_type.name if packaging else None),
                    deposit_per_unit=deposit_per_unit,
                    deposit_total=component_deposit,
                    empty_covered_quantity=empty_covered,
                )
            order_item.is_returnable_item = item_deposit > 0
            order_item.full_quantity = max(0, _int(item.get("caseCapacity"), 0) * _int(item.get("quantity"), 0))
            order_item.empty_returned_quantity = sum(
                max(0, _int(component.get("emptyReturnedQuantity"), 0))
                for component in (item.get("components") or [])
            )
            order_item.deposit_charged = item_deposit
            order_item.net_deposit = item_deposit
            order_item.deposit_total = item_deposit
            order_item.save(update_fields=[
                "is_returnable_item",
                "full_quantity",
                "empty_returned_quantity",
                "deposit_charged",
                "net_deposit",
                "deposit_total",
            ])
            reserve_order_item(order_item, allocation_policy, performed_by)
            if str(order.warehouse_id or "").strip():
                warehouses_used_for_reservation.add(str(order.warehouse_id).strip())
            mixed_case_net_deposit += item_deposit
            continue

        pid = str(item.get("productId") or "").strip()
        prod = Product.objects.filter(id=pid).first()
        if not prod:
            raise ValueError(f"Product not found: {pid}")

        qty = _int(item.get("quantity"), 0)
        unit = float(item.get("unitPrice") or prod.price)
        line_total = float(item.get("totalPrice") or unit * qty)
        pkg = (
            ProductPackaging.objects.filter(product=prod, is_active=True)
            .select_related("container_type")
            .order_by("-is_primary", "created_at")
            .first()
        )
        is_returnable = bool(pkg and pkg.is_returnable and _is_returnable_product(prod))
        empty_returned = max(0, _int(item.get("emptyReturnedQuantity"), 0))
        containers_per_case = max(1, int(pkg.containers_per_case or 1)) if pkg else 1
        is_case = str(prod.unit or "").strip().lower() == "case"
        full_units = qty * containers_per_case if is_case else qty
        deposit_per_unit = float(pkg.deposit_amount or 0) if is_returnable else 0.0
        case_deposit = float(pkg.case_deposit_amount or 0) if is_returnable else 0.0
        deposit_charged = (qty * case_deposit) if is_case else (qty * deposit_per_unit)
        deposit_refunded = ((empty_returned // containers_per_case) * case_deposit) if is_case else (empty_returned * deposit_per_unit)
        net_deposit = max(0.0, deposit_charged - deposit_refunded)

        order_item = OrderItem.objects.create(
            order=order,
            product=prod,
            product_name=str(prod.name or "").strip() or None,
            product_sku=str(prod.sku or "").strip() or None,
            product_unit=_normalize_product_unit(prod.unit),
            quantity=qty,
            unit_price=unit,
            total_price=line_total,
            is_returnable_item=is_returnable,
            full_quantity=full_units,
            empty_returned_quantity=empty_returned,
            deposit_per_unit=deposit_per_unit,
            deposit_charged=deposit_charged,
            deposit_refunded=deposit_refunded,
            net_deposit=net_deposit,
            deposit_total=net_deposit,
            container_type_id=pkg.container_type_id if (pkg and is_returnable) else None,
            container_type_name=pkg.container_type.name if (pkg and is_returnable and pkg.container_type) else None,
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
    # Mixed-case deposits are server-priced from the component packaging records.
    order.total_amount = total_amount + mixed_case_net_deposit
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

        normalized_line = dict(source_line)
        normalized_line.update(
            {
                "originalOrderItemId": str(getattr(original_item, "id", "") or original_order_item_id or "").strip() or None,
                "originalProductId": original_product_id or None,
                "originalProductName": original_product_name,
                "originalProductSku": original_product_sku,
                "originalProductSize": original_product_size,
                "replacementProductId": replacement_product_id or None,
                "replacementProductName": replacement_product_name,
                "replacementProductSku": replacement_product_sku,
                "replacementProductSize": replacement_product_size,
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

    for line in source_lines:
        raw_qty_to_replace = _int(line.get("quantityToReplace"), _int(line.get("quantity"), 0))
        raw_qty_replaced = _int(line.get("quantityReplaced"), 0)
        remaining_qty_bottles = max(raw_qty_to_replace - raw_qty_replaced, 0)
        use_remaining_only = raw_qty_to_replace > 0 and raw_qty_replaced > 0 and remaining_qty_bottles > 0
        raw_qty = remaining_qty_bottles if use_remaining_only else _int(line.get("quantity"), raw_qty_to_replace or raw_qty_replaced)
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
    replacement.save(update_fields=["notes", "updated_at"])
    return replacement_order


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


def _missing_driver_profile_fields(driver: User) -> list[str]:
    missing: list[str] = []
    if not str(getattr(driver, "phone", "") or "").strip():
        missing.append("phone")
    lic_num = str(getattr(driver, "license_number", "") or "").strip().upper()
    if not lic_num:
        missing.append("license number")
    elif not PHILIPPINE_DRIVER_LICENSE_REGEX.match(lic_num):
        missing.append("valid license number (format: X00-00-000000)")
    if not str(getattr(driver, "license_type", "") or "").strip():
        missing.append("license type")
    lic_expiry = getattr(driver, "license_expiry", None)
    if not lic_expiry:
        missing.append("license expiry")
    elif isinstance(lic_expiry, (datetime, date)):
        exp_date = lic_expiry.date() if isinstance(lic_expiry, datetime) else lic_expiry
        if exp_date < timezone.localdate():
            missing.append("valid (unexpired) license")
    return missing


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


def _create_user_notification(
    *,
    user: User | None,
    title: str,
    message: str,
    notification_type: str,
    reference_type: str | None = None,
    reference_id: str | None = None,
) -> None:
    """Create a notification for one staff user, such as an assigned driver."""
    if not user:
        return
    Notification.objects.create(
        user=user,
        title=title,
        message=message,
        type=notification_type,
        reference_type=reference_type,
        reference_id=reference_id,
        is_read=False,
    )


def _set_auth_cookie(response: JsonResponse, token: str, remember_me: bool = False) -> None:
    # Use secure cookies in production (HTTPS) - required for cross-origin/cross-site contexts
    is_prod = not getattr(settings, "DEBUG", True)
    secure = os.getenv("AUTH_COOKIE_SECURE", "1" if is_prod else "0").lower() in ("1", "true", "yes", "on")
    cookie_kwargs = {
        "httponly": True,
        "secure": secure,
        "samesite": "Lax",
        "path": "/",
    }
    if remember_me:
        cookie_kwargs["max_age"] = 60 * 60 * 24 * 30
    payload = decode_token(token) or {}
    account_type = str(payload.get("type") or "").strip().lower()
    cookie_name = CUSTOMER_TOKEN_NAME if account_type == "customer" else STAFF_TOKEN_NAME
    response.set_cookie(cookie_name, token, **cookie_kwargs)
    # Clear legacy shared cookie so role sessions no longer overwrite each other.
    response.delete_cookie(TOKEN_NAME, path="/")


def _format_display_name(
    first_name: str | None,
    middle_name: str | None,
    last_name: str | None,
    suffix: str | None = None,
    fallback_name: str | None = None,
) -> str:
    first = str(first_name or "").strip()
    middle = str(middle_name or "").strip()
    last = str(last_name or "").strip()
    suf = str(suffix or "").strip()

    parts = []
    if first:
        parts.append(first)
    if middle:
        clean_m = middle.rstrip(".")
        if clean_m:
            initial = f"{clean_m[0].upper()}."
            parts.append(initial)
    if last:
        parts.append(last)

    base = " ".join(parts)
    if suf:
        base = f"{base} {suf}".strip() if base else suf
    return base or str(fallback_name or "").strip()


def _user_payload(user: User) -> dict[str, Any]:
    return {
        "userId": user.id,
        "email": user.email,
        "name": user.name,
        "firstName": getattr(user, "first_name", None),
        "middleName": getattr(user, "middle_name", None),
        "lastName": getattr(user, "last_name", None),
        "suffix": getattr(user, "suffix", None),
        "avatar": user.avatar,
        "role": user.role,
        "twoFactorEnabled": bool(getattr(user, "two_factor_enabled", False)),
        "loginAlertsEnabled": bool(getattr(user, "login_alerts_enabled", True)),
        "sessionTimeoutMinutes": int(getattr(user, "session_timeout_minutes", 30) or 30),
        "type": "staff",
    }


def _customer_payload(customer: Customer) -> dict[str, Any]:
    from .rgb.services import get_customer_bottle_balances
    balances = get_customer_bottle_balances(customer)
    return {
        "userId": customer.id,
        "email": customer.email,
        "name": customer.name,
        "firstName": customer.first_name,
        "middleName": customer.middle_name,
        "lastName": customer.last_name,
        "suffix": customer.suffix,
        "avatar": customer.avatar,
        "role": "CUSTOMER",
        "type": "customer",
        "bottleBalances": balances,
    }


def _serialize_order(
    order: Order,
    include_items: bool = True,
    include_progress: bool = False,
    *,
    warehouse_lookup: dict[str, Warehouse] | None = None,
    assigned_trip: Trip | None = None,
    fulfillment_legs: list[dict[str, Any]] | None = None,
    warehouse_allocations: list[dict[str, Any]] | None = None,
    item_warehouse_allocations: dict[str, list[dict[str, Any]]] | None = None,
    item_trip_assignments: dict[str, list[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    data = _serialize_model(order)
    data["status"] = _normalize_order_status(data.get("status"))
    normalized_order_status = str(data.get("status") or "").strip().upper()
    request_status_value = str(data.get("requestStatus") or "").strip().upper()
    # For approved orders, the current delivery status is authoritative for the displayed PO stage.
    if request_status_value == PurchaseRequestStatus.APPROVED:
        stage_by_status = {
            OrderStatus.CONFIRMED: PurchaseOrderStage.APPROVED,
            OrderStatus.PREPARING: PurchaseOrderStage.PROCESSING,
            OrderStatus.OUT_FOR_DELIVERY: PurchaseOrderStage.OUT_FOR_DELIVERY,
            OrderStatus.RESCHEDULED: PurchaseOrderStage.OUT_FOR_DELIVERY,
            OrderStatus.DELIVERED: PurchaseOrderStage.DELIVERED,
            OrderStatus.CANCELLED: PurchaseOrderStage.CANCELLED,
            OrderStatus.REJECTED: PurchaseOrderStage.CANCELLED,
        }
        derived_stage = stage_by_status.get(normalized_order_status)
        if derived_stage:
            data["purchaseOrderStage"] = derived_stage
    # Retail and counter-sale orders may intentionally have no linked customer.
    data["customer"] = _serialize_model(order.customer, exclude={"password"}) if order.customer else None
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
    shipping_latitude = order.shipping_latitude if order.shipping_latitude is not None else getattr(order.customer, "latitude", None)
    shipping_longitude = order.shipping_longitude if order.shipping_longitude is not None else getattr(order.customer, "longitude", None)
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
        prefetched_items = getattr(order, "_serialized_order_items", None)
        order_items = prefetched_items if prefetched_items is not None else order.items.select_related("product").all()
        for item in order_items:
            row = _serialize_order_item_with_spare_products(item, include_full_product=True)
            item_id = str(getattr(item, "id", "") or "").strip()
            if item_warehouse_allocations is not None and item_id:
                allocs = item_warehouse_allocations.get(item_id, [])
                row["warehouseAllocations"] = allocs
                row["allocatedQtyTotal"] = sum(max(0, _int(entry.get("allocatedQty"), 0)) for entry in allocs)
            if item_trip_assignments is not None and item_id:
                row["tripAssignments"] = item_trip_assignments.get(item_id, [])
            items.append(row)
        data["items"] = items

    if fulfillment_legs is not None:
        data["fulfillments"] = fulfillment_legs
    if warehouse_allocations is not None:
        data["warehouseAllocations"] = warehouse_allocations
        data["warehouseIds"] = [str((row or {}).get("warehouseId") or "").strip() for row in warehouse_allocations if str((row or {}).get("warehouseId") or "").strip()]
        data["warehouses"] = [
            {
                "id": str((row or {}).get("warehouseId") or "").strip() or None,
                "name": str((row or {}).get("warehouseName") or "").strip() or None,
                "code": str((row or {}).get("warehouseCode") or "").strip() or None,
            }
            for row in warehouse_allocations
            if str((row or {}).get("warehouseId") or "").strip()
        ]

    data["scheduledReplacement"] = _get_scheduled_replacement_payload(order)

    # Once an order is rescheduled, the previous failed trip should no longer appear
    # as its active assignment/progress until it is planned again.
    if normalized_order_status == OrderStatus.RESCHEDULED:
        assigned_trip = None

    if assigned_trip is None:
        assigned_trip = None if normalized_order_status == OrderStatus.RESCHEDULED else _select_trip_for_order(order.id, require_driver=True)
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
        progress_trip = None if normalized_order_status == OrderStatus.RESCHEDULED else _select_trip_for_order(order.id, require_driver=False)
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

    # A workflow status alone must never promote an unapproved request into a PO.
    is_approved_order = request_status_value == PurchaseRequestStatus.APPROVED
    po_num = str(getattr(order, "purchase_order_number", "") or "").strip() or None
    pr_num = str(getattr(order, "purchase_request_number", "") or "").strip() or None

    data["purchaseRequestNumber"] = pr_num or order.order_number
    data["purchaseOrderNumber"] = po_num if is_approved_order else None
    data["orderNumber"] = (po_num if (is_approved_order and po_num) else (pr_num or order.order_number))

    # Added: expose only the real inventory OUT transaction IDs after this order was delivered.
    is_delivered = normalized_order_status == OrderStatus.DELIVERED or bool(getattr(timeline, "delivered_at", None))
    delivery_transaction_ids: list[str] = []
    if is_delivered:
        order_item_ids = [
            str(row.get("id") or "").strip()
            for row in data.get("items", [])
            if str(row.get("id") or "").strip()
        ]
        if not order_item_ids:
            order_item_ids = [str(item_id) for item_id in order.items.values_list("id", flat=True)]
        if order_item_ids:
            delivery_transaction_ids = [
                str(transaction_id)
                for transaction_id in InventoryTransaction.objects.filter(
                    type="OUT",
                    reference_type="order_item",
                    reference_id__in=order_item_ids,
                ).order_by("created_at", "id").values_list("id", flat=True)
            ]
    data["inventoryTransactionIds"] = delivery_transaction_ids
    data["inventoryTransactionId"] = delivery_transaction_ids[0] if delivery_transaction_ids else None
    return data


def _build_order_fulfillment_legs_map(order_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    normalized_ids = [str(order_id or "").strip() for order_id in order_ids if str(order_id or "").strip()]
    if not normalized_ids:
        return {}

    # Get fulfillment legs from TripDropPoint (existing logic)
    points = (
        TripDropPoint.objects.select_related("trip")
        .filter(order_id__in=normalized_ids)
        .order_by("order_id", "sequence", "created_at", "id")
    )

    warehouse_ids = {
        str(getattr(point.trip, "warehouse_id", "") or "").strip()
        for point in points
        if getattr(point, "trip", None) is not None
    }
    warehouse_ids = {warehouse_id for warehouse_id in warehouse_ids if warehouse_id}
    warehouse_lookup = {
        warehouse.id: warehouse
        for warehouse in Warehouse.objects.filter(id__in=list(warehouse_ids))
    } if warehouse_ids else {}

    out: dict[str, list[dict[str, Any]]] = {}
    seen_keys: dict[str, set[str]] = {}  # order_id -> set of "warehouse_id::trip_id" keys

    for point in points:
        order_id = str(getattr(point, "order_id", "") or "").strip()
        if not order_id:
            continue
        trip = getattr(point, "trip", None)
        # Skip if trip doesn't exist (was deleted)
        if not trip:
            continue
        warehouse_id = str(getattr(trip, "warehouse_id", "") or "").strip()
        warehouse = warehouse_lookup.get(warehouse_id) if warehouse_id else None
        status_value = _normalize_order_status(getattr(point, "status", None) or getattr(trip, "status", None))
        trip_id = str(getattr(trip, "id", "") or "").strip()
        trip_number = str(getattr(trip, "trip_number", "") or "").strip()

        # Check for duplicates BEFORE adding
        key = f"{warehouse_id}::{trip_id}"
        if key in seen_keys.get(order_id, set()):
            continue  # Skip duplicate
        
        # Track seen combination
        seen_keys.setdefault(order_id, set()).add(key)

        out.setdefault(order_id, []).append(
            {
                "id": str(getattr(point, "id", "") or "").strip() or None,
                "warehouseId": warehouse_id,
                "warehouseName": str(getattr(warehouse, "name", "") or "").strip() or None,
                "warehouseCode": str(getattr(warehouse, "code", "") or "").strip() or None,
                "status": status_value,
                "tripId": trip_id,
                "tripNumber": trip_number,
                "sequence": getattr(point, "sequence", None),
            }
        )

    # Also include fulfillment legs from trip assignments (InventoryTransaction)
    # ONLY for orders that don't have TripDropPoint data
    # This prevents duplicates while ensuring all trip assignments are represented
    item_trip_assignments = _build_order_item_trip_assignments_map(normalized_ids)
    for order_id, items_map in item_trip_assignments.items():
        # Skip if this order already has TripDropPoint data
        if order_id in out and len(out[order_id]) > 0:
            continue
        # Collect unique warehouse/trip combinations
        added_keys: set[str] = set()
        for item_id, assignments in items_map.items():
            for assignment in assignments:
                warehouse_id = str(assignment.get("warehouseId") or "").strip()
                trip_id = str(assignment.get("tripId") or "").strip()
                trip_number = str(assignment.get("tripNumber") or "").strip()

                if not warehouse_id:
                    continue

                # Skip duplicates within this order
                key = f"{warehouse_id}::{trip_id}"
                if key in added_keys:
                    continue
                added_keys.add(key)

                # Get warehouse info
                warehouse = warehouse_lookup.get(warehouse_id) or Warehouse.objects.filter(id=warehouse_id).first()

                # Add to fulfillment legs
                out.setdefault(order_id, []).append(
                    {
                        "id": None,
                        "warehouseId": warehouse_id,
                        "warehouseName": str(getattr(warehouse, "name", "") or "").strip() or None,
                        "warehouseCode": str(getattr(warehouse, "code", "") or "").strip() or None,
                        "status": "PENDING",
                        "tripId": trip_id or None,
                        "tripNumber": trip_number or None,
                        "sequence": None,
                        "source": "transaction",
                    }
                )

    return out


def _build_order_warehouse_allocations_map(order_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    normalized_ids = [str(order_id or "").strip() for order_id in order_ids if str(order_id or "").strip()]
    if not normalized_ids:
        return {}

    order_items = list(
        OrderItem.objects.filter(order_id__in=normalized_ids).only("id", "order_id")
    )
    if not order_items:
        return {}

    order_by_item_id = {
        str(item.id): str(item.order_id)
        for item in order_items
        if str(item.id or "").strip() and str(item.order_id or "").strip()
    }
    item_ids = list(order_by_item_id.keys())
    if not item_ids:
        return {}

    tx_rows = list(
        InventoryTransaction.objects.filter(
            reference_type="order_item_reserve",
            reference_id__in=item_ids,
            type="RESERVE",
        ).values("reference_id", "warehouse_id", "quantity")
    )
    if not tx_rows:
        return {}

    warehouse_ids = {
        str(row.get("warehouse_id") or "").strip()
        for row in tx_rows
        if str(row.get("warehouse_id") or "").strip()
    }
    warehouse_lookup = {
        warehouse.id: warehouse
        for warehouse in Warehouse.objects.filter(id__in=list(warehouse_ids))
    } if warehouse_ids else {}

    grouped_qty: dict[str, dict[str, int]] = {}
    for row in tx_rows:
        ref_id = str(row.get("reference_id") or "").strip()
        warehouse_id = str(row.get("warehouse_id") or "").strip()
        if not ref_id or not warehouse_id:
            continue
        order_id = order_by_item_id.get(ref_id)
        if not order_id:
            continue
        qty = max(0, _int(row.get("quantity"), 0))
        grouped_qty.setdefault(order_id, {})
        grouped_qty[order_id][warehouse_id] = grouped_qty[order_id].get(warehouse_id, 0) + qty

    out: dict[str, list[dict[str, Any]]] = {}
    for order_id, by_wh in grouped_qty.items():
        rows: list[dict[str, Any]] = []
        for warehouse_id, qty in sorted(by_wh.items(), key=lambda entry: entry[0]):
            warehouse = warehouse_lookup.get(warehouse_id)
            rows.append(
                {
                    "warehouseId": warehouse_id,
                    "warehouseName": str(getattr(warehouse, "name", "") or "").strip() or None,
                    "warehouseCode": str(getattr(warehouse, "code", "") or "").strip() or None,
                    "allocatedQty": qty,
                }
            )
        out[order_id] = rows
    return out


def _build_order_item_warehouse_allocations_map(order_ids: list[str]) -> dict[str, dict[str, list[dict[str, Any]]]]:
    normalized_ids = [str(order_id or "").strip() for order_id in order_ids if str(order_id or "").strip()]
    if not normalized_ids:
        return {}

    order_items = list(
        OrderItem.objects.filter(order_id__in=normalized_ids).only("id", "order_id")
    )
    if not order_items:
        return {}

    order_by_item_id = {
        str(item.id): str(item.order_id)
        for item in order_items
        if str(item.id or "").strip() and str(item.order_id or "").strip()
    }
    item_ids = list(order_by_item_id.keys())
    if not item_ids:
        return {}

    tx_rows = list(
        InventoryTransaction.objects.filter(
            reference_type="order_item_reserve",
            reference_id__in=item_ids,
            type="RESERVE",
        ).values("reference_id", "warehouse_id", "quantity")
    )
    if not tx_rows:
        return {}

    warehouse_ids = {
        str(row.get("warehouse_id") or "").strip()
        for row in tx_rows
        if str(row.get("warehouse_id") or "").strip()
    }
    warehouse_lookup = {
        warehouse.id: warehouse
        for warehouse in Warehouse.objects.filter(id__in=list(warehouse_ids))
    } if warehouse_ids else {}

    grouped: dict[str, dict[str, dict[str, int]]] = {}
    for row in tx_rows:
        item_id = str(row.get("reference_id") or "").strip()
        warehouse_id = str(row.get("warehouse_id") or "").strip()
        if not item_id or not warehouse_id:
            continue
        order_id = order_by_item_id.get(item_id)
        if not order_id:
            continue
        grouped.setdefault(order_id, {})
        grouped[order_id].setdefault(item_id, {})
        grouped[order_id][item_id][warehouse_id] = grouped[order_id][item_id].get(warehouse_id, 0) + max(0, _int(row.get("quantity"), 0))

    out: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for order_id, by_item in grouped.items():
        out[order_id] = {}
        for item_id, by_wh in by_item.items():
            allocs: list[dict[str, Any]] = []
            for warehouse_id, qty in sorted(by_wh.items(), key=lambda entry: entry[0]):
                warehouse = warehouse_lookup.get(warehouse_id)
                allocs.append({
                    "warehouseId": warehouse_id,
                    "warehouseName": str(getattr(warehouse, "name", "") or "").strip() or None,
                    "warehouseCode": str(getattr(warehouse, "code", "") or "").strip() or None,
                    "allocatedQty": qty,
                })
            out[order_id][item_id] = allocs
    return out


def _build_order_item_trip_assignments_map(
    order_ids: list[str],
    *,
    trip_id: str | None = None,
) -> dict[str, dict[str, list[dict[str, Any]]]]:
    normalized_ids = [str(order_id or "").strip() for order_id in order_ids if str(order_id or "").strip()]
    if not normalized_ids:
        return {}

    order_items = list(
        OrderItem.objects.filter(order_id__in=normalized_ids).only("id", "order_id")
    )
    if not order_items:
        return {}

    order_by_item_id = {
        str(item.id): str(item.order_id)
        for item in order_items
        if str(item.id or "").strip() and str(item.order_id or "").strip()
    }
    item_ids = list(order_by_item_id.keys())
    if not item_ids:
        return {}

    tx_qs = InventoryTransaction.objects.filter(
        reference_type="order_item_trip_assign",
        reference_id__in=item_ids,
        type="ASSIGN",
    )
    if trip_id:
        tx_qs = tx_qs.filter(notes__icontains=f'"tripId":"{trip_id}"')
    tx_rows = list(tx_qs.values("reference_id", "warehouse_id", "quantity", "notes"))
    if not tx_rows:
        return {}

    warehouse_ids = {
        str(row.get("warehouse_id") or "").strip()
        for row in tx_rows
        if str(row.get("warehouse_id") or "").strip()
    }
    warehouse_lookup = {
        warehouse.id: warehouse
        for warehouse in Warehouse.objects.filter(id__in=list(warehouse_ids))
    } if warehouse_ids else {}

    grouped: dict[str, dict[str, dict[str, int]]] = {}
    for row in tx_rows:
        item_id = str(row.get("reference_id") or "").strip()
        warehouse_id = str(row.get("warehouse_id") or "").strip()
        if not item_id or not warehouse_id:
            continue
        order_id = order_by_item_id.get(item_id)
        if not order_id:
            continue
        meta_raw = str(row.get("notes") or "").strip()
        meta: dict[str, Any] = {}
        if meta_raw:
            try:
                meta = json.loads(meta_raw)
            except Exception:
                meta = {}
        meta_trip_id = str(meta.get("tripId") or "").strip()
        meta_trip_number = str(meta.get("tripNumber") or "").strip()
        key = f"{warehouse_id}::{meta_trip_id}::{meta_trip_number}"
        grouped.setdefault(order_id, {}).setdefault(item_id, {})
        grouped[order_id][item_id][key] = grouped[order_id][item_id].get(key, 0) + max(0, _int(row.get("quantity"), 0))

    out: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for order_id, by_item in grouped.items():
        out[order_id] = {}
        for item_id, by_key in by_item.items():
            rows: list[dict[str, Any]] = []
            for joined_key, qty in sorted(by_key.items(), key=lambda entry: entry[0]):
                warehouse_id, meta_trip_id, meta_trip_number = joined_key.split("::", 2)
                warehouse = warehouse_lookup.get(warehouse_id)
                rows.append(
                    {
                        "warehouseId": warehouse_id,
                        "warehouseName": str(getattr(warehouse, "name", "") or "").strip() or None,
                        "warehouseCode": str(getattr(warehouse, "code", "") or "").strip() or None,
                        "tripId": meta_trip_id or None,
                        "tripNumber": meta_trip_number or None,
                        "allocatedQty": qty,
                    }
                )
            out[order_id][item_id] = rows
    return out


def _assign_order_items_to_trip_for_warehouse(
    *,
    trip: Trip,
    order_ids: list[str],
    warehouse_id: str,
    performed_by: str | None = None,
) -> int:
    normalized_order_ids = [str(order_id or "").strip() for order_id in order_ids if str(order_id or "").strip()]
    target_warehouse_id = str(warehouse_id or "").strip()
    trip_id_value = str(getattr(trip, "id", "") or "").strip()
    trip_number_value = str(getattr(trip, "trip_number", "") or "").strip()
    if not normalized_order_ids or not target_warehouse_id or not trip_id_value:
        return 0

    order_item_allocations = _build_order_item_warehouse_allocations_map(normalized_order_ids)
    order_item_trip_assignments = _build_order_item_trip_assignments_map(normalized_order_ids, trip_id=trip_id_value)
    order_items = list(
        OrderItem.objects.select_related("product").prefetch_related("mixed_case_components__product").filter(order_id__in=normalized_order_ids)
    )

    rows_created = 0
    for item in order_items:
        item_id = str(getattr(item, "id", "") or "").strip()
        order_id = str(getattr(item, "order_id", "") or "").strip()
        if not item_id or not order_id:
            continue

        warehouse_allocs = (order_item_allocations.get(order_id, {}) or {}).get(item_id, [])
        allocated_for_target_warehouse = sum(
            max(0, _int(entry.get("allocatedQty"), 0))
            for entry in warehouse_allocs
            if str(entry.get("warehouseId") or "").strip() == target_warehouse_id
        )
        if allocated_for_target_warehouse <= 0:
            continue

        assigned_rows = (order_item_trip_assignments.get(order_id, {}) or {}).get(item_id, [])
        already_assigned_for_trip = sum(
            max(0, _int(entry.get("allocatedQty"), 0))
            for entry in assigned_rows
            if str(entry.get("warehouseId") or "").strip() == target_warehouse_id
            and str(entry.get("tripId") or "").strip() == trip_id_value
        )

        pending_qty = max(0, allocated_for_target_warehouse - already_assigned_for_trip)
        if pending_qty <= 0:
            continue

        if item.product_id:
            InventoryTransaction.objects.create(
                warehouse_id=target_warehouse_id,
                product=item.product,
                type="ASSIGN",
                quantity=pending_qty,
                reference_type="order_item_trip_assign",
                reference_id=item_id,
                order_item=item,
                notes=json.dumps(
                    {
                        "tripId": trip_id_value,
                        "tripNumber": trip_number_value or None,
                        "orderId": order_id,
                    },
                    separators=(",", ":"),
                ),
            )
            rows_created += 1
        elif item.item_type == "MIXED_CASE":
            components = item.mixed_case_components.select_related("product").all()
            for comp in components:
                if comp.product:
                    comp_qty = comp.total_base_units if comp.total_base_units else (comp.quantity_per_case * item.quantity)
                    InventoryTransaction.objects.create(
                        warehouse_id=target_warehouse_id,
                        product=comp.product,
                        type="ASSIGN",
                        quantity=comp_qty,
                        reference_type="order_item_trip_assign",
                        reference_id=item_id,
                        mixed_case_component=comp,
                        order_item=item,
                        notes=json.dumps(
                            {
                                "tripId": trip_id_value,
                                "tripNumber": trip_number_value or None,
                                "orderId": order_id,
                                "componentId": comp.id,
                            },
                            separators=(",", ":"),
                        ),
                    )
                    rows_created += 1

    return rows_created


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
    data["warehouseStage"] = None
    data["status"] = normalized_status
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
    structured_replacement_lines = _normalize_serialized_replacement_lines(
        entry,
        order,
        meta,
        normalized_status=normalized_status,
        delivered_linked_replacement_order=delivered_linked_replacement_order,
    )
    if structured_replacement_lines:
        total_qty_to_replace = sum(max(0, _int(line.get("quantityToReplace"), 0)) for line in structured_replacement_lines)
        total_qty_replaced = sum(max(0, _int(line.get("quantityReplaced"), 0)) for line in structured_replacement_lines)
        total_remaining = max(total_qty_to_replace - total_qty_replaced, 0)
        data["quantityToReplace"] = total_qty_to_replace
        data["quantityReplaced"] = total_qty_replaced
        data["remainingQuantity"] = total_remaining
        data["replacementLines"] = structured_replacement_lines
        data["replacementItems"] = structured_replacement_lines

        first_line = structured_replacement_lines[0]
        original_names: list[str] = []
        replacement_names: list[str] = []
        for line in structured_replacement_lines:
            original_name = str(line.get("originalProductName") or "").strip()
            replacement_name = str(line.get("replacementProductName") or "").strip()
            if original_name and original_name not in original_names:
                original_names.append(original_name)
            if replacement_name and replacement_name not in replacement_names:
                replacement_names.append(replacement_name)

        def _format_product_summary(values: list[str]) -> str | None:
            if not values:
                return None
            if len(values) <= 3:
                return ", ".join(values)
            return f"{', '.join(values[:3])} +{len(values) - 3} more"

        data["originalProductName"] = _format_product_summary(original_names)
        data["replacementProductName"] = _format_product_summary(replacement_names or original_names)
        data["originalProductSku"] = first_line.get("originalProductSku") or None
        data["replacementProductSku"] = first_line.get("replacementProductSku") or None
        data["originalProductSize"] = first_line.get("originalProductSize") or None
        data["replacementProductSize"] = first_line.get("replacementProductSize") or None

        first_original_order_item_id = str(first_line.get("originalOrderItemId") or "").strip()
        first_original_item = None
        if first_original_order_item_id:
            first_original_item = OrderItem.objects.select_related("product").filter(id=first_original_order_item_id).first()
        if first_original_item:
            data["originalOrderItem"] = {
                "id": first_original_item.id,
                "quantity": first_original_item.quantity,
                "product": _serialize_model(first_original_item.product) if first_original_item.product_id else None,
            }
            data["originalQuantity"] = first_original_item.quantity
    elif original_item:
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
        if not structured_replacement_lines:
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
                item_allocations_by_order = _build_order_item_warehouse_allocations_map([str(dp.order.id)]).get(str(dp.order.id), {})
                # Get trip assignments for current trip (for allocation UI)
                item_trip_assignments_by_order = _build_order_item_trip_assignments_map(
                    [str(dp.order.id)],
                    trip_id=str(getattr(trip, "id", "") or "").strip() or None,
                ).get(str(dp.order.id), {})
                # Get ALL trip assignments for this order (to detect items assigned to other trips)
                all_item_trip_assignments_by_order = _build_order_item_trip_assignments_map(
                    [str(dp.order.id)],
                    trip_id=None,  # Don't filter by trip - get all assignments
                ).get(str(dp.order.id), {})
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
                    "loadedAt": dp.order.loaded_at.isoformat() if dp.order.loaded_at else None,
                    "status": _normalize_order_status(dp.order.status),
                    "isDriverAssigned": bool(trip.driver_id),
                    "assignedDriverName": str(getattr(getattr(trip.driver, "user", None), "name", "") or "").strip() or None,
                    "totalAmount": dp.order.total_amount,
                    "scheduledReplacement": _get_scheduled_replacement_payload(dp.order),
                    "items": [
                        {
                            **_serialize_order_item_with_spare_products(item, include_full_product=False),
                            "warehouseAllocations": item_allocations_by_order.get(str(getattr(item, "id", "") or "").strip(), []),
                            "tripAssignments": item_trip_assignments_by_order.get(str(getattr(item, "id", "") or "").strip(), []),
                            "allTripAssignments": all_item_trip_assignments_by_order.get(str(getattr(item, "id", "") or "").strip(), []),
                        }
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
    if value in {"pack", "bundle", "pack(bundle)", "pack (bundle)", PRODUCT_UNIT_PACK_BUNDLE}:
        return PRODUCT_UNIT_PACK_BUNDLE
    if value in {"bottle", "bottles", PRODUCT_UNIT_BOTTLE}:
        return PRODUCT_UNIT_BOTTLE
    if value in {"mixed_case", "mixed-case", "mixed case", PRODUCT_UNIT_MIXED_CASE}:
        return PRODUCT_UNIT_MIXED_CASE
    return value


def _round_half_up(value: float) -> int:
    return max(0, int(math.floor(max(value, 0) + 0.5)))


def _serialize_order_item_with_spare_products(item: OrderItem, *, include_full_product: bool = True) -> dict[str, Any]:
    row = _serialize_model(item)
    product = getattr(item, "product", None)
    quantity_per_case = _int(getattr(product, "quantity_per_unit", 0), 0)
    packaging = ProductPackaging.objects.filter(product=product, is_active=True).first() if product else None
    containers_per_case = int(packaging.containers_per_case) if (packaging and packaging.containers_per_case) else (quantity_per_case or 1)
    snapshot_name = str(getattr(item, "product_name", "") or "").strip()
    snapshot_sku = str(getattr(item, "product_sku", "") or "").strip()
    snapshot_unit = _normalize_product_unit(getattr(item, "product_unit", None))
    product_size_label = _get_product_size_label(product) if product else ""
    product_sizes = list(getattr(product, "sizes", []) or []) if product else []
    row["quantityPerCase"] = quantity_per_case
    row["containersPerCase"] = containers_per_case
    row["caseDepositAmount"] = float(packaging.case_deposit_amount or 0) if packaging else 0.0
    row["depositAmount"] = float(packaging.deposit_amount or 0) if packaging else 0.0
    if include_full_product:
        if product:
            row["product"] = _serialize_model(product)
            row["product"]["quantityPerCase"] = quantity_per_case
            row["product"]["sizeLabel"] = product_size_label or None
            row["product"]["size"] = product_size_label or None
            row["product"]["sizes"] = product_sizes
            row["product"]["category"] = str(getattr(product, "category", "") or "").strip() or None
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
                "category": None,
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
                "category": str(getattr(product, "category", "") or "").strip() or None,
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
                "category": None,
            }
        )
    # Mixed-case contents must remain available to every portal after the order is reloaded.
    if str(getattr(item, "item_type", "") or "").strip().upper() == "MIXED_CASE":
        prefetched_components = getattr(item, "_serialized_mixed_case_components", None)
        components = (
            prefetched_components
            if prefetched_components is not None
            else item.mixed_case_components.select_related("product").all().order_by("created_at", "id")
        )
        row["components"] = [serialize_mixed_component(component) for component in components]
    else:
        row["components"] = []
    return row


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
        )

    return allocation_rows


def _select_best_warehouse_for_order_items(
    *,
    items: list[dict[str, Any]],
    shipping_latitude: Any,
    shipping_longitude: Any,
) -> str | None:
    requested_by_product: dict[str, int] = {}
    mixed_component_requests: list[tuple[str, int]] = []
    for item in items:
        if str(item.get("itemType") or "").strip().upper() == OrderItemType.MIXED_CASE:
            case_count = max(0, _int(item.get("quantity", item.get("caseCount")), 0))
            for component in item.get("components") or []:
                product_id = str((component or {}).get("productId") or "").strip()
                bottle_quantity = max(0, _int((component or {}).get("quantity"), 0)) * case_count
                if product_id and bottle_quantity > 0:
                    mixed_component_requests.append((product_id, bottle_quantity))
            continue
        product_id = str(item.get("productId") or "").strip()
        if not product_id:
            continue
        qty = _int(item.get("quantity"), 0)
        if qty <= 0:
            continue
        requested_by_product[product_id] = requested_by_product.get(product_id, 0) + qty

    if mixed_component_requests:
        product_ids = {product_id for product_id, _ in mixed_component_requests}
        case_sizes = {
            str(product_id): max(1, _int(quantity_per_unit, 1))
            for product_id, quantity_per_unit in Product.objects.filter(id__in=product_ids).values_list("id", "quantity_per_unit")
        }
        # Warehouse availability is stored in cases; round component bottles up to their source-case requirement.
        for product_id, bottle_quantity in mixed_component_requests:
            required_cases = int(math.ceil(bottle_quantity / max(1, case_sizes.get(product_id, 1))))
            requested_by_product[product_id] = requested_by_product.get(product_id, 0) + required_cases

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
        )


def _finalize_order_inventory_on_delivery(order: Order, performed_by: str | None) -> None:
    items = list(order.items.select_related("product").prefetch_related("mixed_case_components__product").all())
    for order_item in items:
        # Check for component-level reservations (e.g. Mixed Case items)
        item_reservations = InventoryReservation.objects.filter(order_item=order_item, status=ReservationStatus.RESERVED)
        if item_reservations.exists() or order_item.item_type == OrderItemType.MIXED_CASE:
            allocations = consume_order_item_reservations(order_item, performed_by)
            policy = _extract_allocation_policy_from_notes(order_item.notes) or "FEFO"
            if allocations:
                allocation_note = f"Delivered allocation ({policy}): " + ", ".join(
                    [f"{row['batchNumber']} x{row['quantity']}" for row in allocations]
                )
                order_item.notes = f"{order_item.notes or ''}\n{allocation_note}".strip()
                order_item.save(update_fields=["notes"])
            continue

        if not order_item.product:
            continue

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
        item_reservations = InventoryReservation.objects.filter(order_item=order_item, status=ReservationStatus.RESERVED)
        if item_reservations.exists() or order_item.item_type == OrderItemType.MIXED_CASE:
            release_order_item_reservations(order_item, performed_by)
            continue
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
    from .deposit_lifecycle import finalize_order_deposits_on_delivery
    finalize_order_deposits_on_delivery(order, performed_by)
    _reconcile_replacement_bottle_remainder_on_delivery(order, performed_by)
    order.status = OrderStatus.DELIVERED
    update_fields = ["status", "updated_at"]
    if str(order.request_status or "").strip().upper() == PurchaseRequestStatus.APPROVED:
        # Keep the PO workflow stage synchronized with driver-completed delivery.
        order.purchase_order_stage = PurchaseOrderStage.DELIVERED
        update_fields.append("purchase_order_stage")
    order.save(update_fields=update_fields)

    timeline, _ = OrderTimeline.objects.get_or_create(order=order)
    if not timeline.shipped_at:
        timeline.shipped_at = getattr(order, "warehouse_dispatched_at", None) or timezone.now()
    if not timeline.delivered_at:
        timeline.delivered_at = delivered_at or timezone.now()
    timeline.save(update_fields=["shipped_at", "delivered_at", "updated_at"])

    # Notify the order owner only after delivery was successfully persisted.
    _create_customer_notification(
        customer=order.customer,
        title="Order delivered",
        message=f"Your order {order.order_number} has been delivered successfully.",
        notification_type="ORDER",
        reference_type="order",
        reference_id=order.id,
    )


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
    sku_label = getattr(product, "sku", None) or getattr(order_item, "product_sku", None) or getattr(order_item, "product_name", "UNKNOWN")
    if not product:
        raise ValueError(f"No product found for order item {sku_label}")
    if requested_qty <= 0:
        raise ValueError(f"Quantity for product {sku_label} must be greater than zero")

    inventory_qs = Inventory.objects.select_related("warehouse").filter(product=product)
    if warehouse_id:
        inventory_qs = inventory_qs.filter(warehouse_id=warehouse_id)

    inventories = list(inventory_qs)
    if not inventories:
        raise ValueError(f"No inventory found for product {sku_label}")

    effective_requested_qty = requested_qty
    replacement_notes = str(getattr(order_item, "notes", "") or "")
    replacement_unit_mode = str(getattr(order, "order_number", "") or "").strip().upper().startswith("RPL-") and "ReplacementUnitMode=BOTTLE" in replacement_notes
    if replacement_unit_mode and _normalize_product_unit(getattr(product, "unit", None)) != "bottle":
        requested_bottles_match = re.search(r"ReplacementRequestedBottles=(\d+)", replacement_notes)
        requested_bottles = _int(requested_bottles_match.group(1), 0) if requested_bottles_match else 0
        qty_per_case = max(1, _int(getattr(product, "quantity_per_unit", 0), 1))
        if requested_bottles > 0:
            remaining_bottles = requested_bottles
            inventories_sorted = sorted(
                inventories,
                key=lambda inv: str(getattr(inv, "warehouse_id", "") or "") != str(warehouse_id or ""),
            )
            loose_consumed_total = 0
            for inventory in inventories_sorted:
                if remaining_bottles <= 0:
                    break
                loose_available = max(0, _int(getattr(inventory, "loose_bottles", 0), 0))
                if loose_available <= 0:
                    continue
                consume_loose = min(loose_available, remaining_bottles)
                if consume_loose <= 0:
                    continue
                inventory.loose_bottles = loose_available - consume_loose
                inventory.save(update_fields=["loose_bottles", "updated_at"])
                InventoryTransaction.objects.create(
                    warehouse=inventory.warehouse,
                    product=product,
                    type="OUT",
                    quantity=consume_loose,
                    reference_type="order_item",
                    reference_id=order_item.id,
                    notes=f"Replacement bottle allocation from loose stock for order {order.order_number}",
                )
                loose_consumed_total += consume_loose
                remaining_bottles -= consume_loose

            if loose_consumed_total > 0:
                allocation_rows = [
                    {
                        "batchNumber": "LOOSE_BOTTLES",
                        "quantity": loose_consumed_total,
                        "warehouseId": None,
                    }
                ]
            else:
                allocation_rows = []
            effective_requested_qty = int(math.ceil(remaining_bottles / qty_per_case)) if remaining_bottles > 0 else 0
        else:
            allocation_rows = []
    else:
        allocation_rows = []

    if effective_requested_qty <= 0:
        return allocation_rows

    inventory_by_id = {inv.id: inv for inv in inventories}
    batches = list(
        StockBatch.objects.select_related("inventory")
        .filter(inventory_id__in=list(inventory_by_id.keys()), quantity__gt=0)
    )
    if not batches:
        raise ValueError(f"No available stock batches for product {product.sku}")

    ordered_batches = _sorted_batches_for_policy(batches, allocation_policy)
    remaining = effective_requested_qty

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


OTP_EXPIRY_MINUTES = 5

EMAIL_VERIFICATION_TOKEN_HOURS = 1


def _normalize_email(value: Any) -> str:
    return str(value or "").strip().lower()


def _is_gmail_email(email: str) -> bool:
    normalized = str(email or "").strip()
    if not normalized:
        return False
    try:
        validate_email(normalized)
        return True
    except ValidationError:
        return False


def _staff_email_conflict_message(email: str, role: str, exclude_user_id: str | None = None) -> str | None:
    normalized_email = _normalize_email(email)
    if not normalized_email:
        return None

    # Fix: email addresses identify one account system-wide, not one account per role.
    qs = User.objects.filter(email__iexact=normalized_email)
    if exclude_user_id:
        qs = qs.exclude(id=exclude_user_id)
    if qs.exists() or Customer.objects.filter(email__iexact=normalized_email).exists():
        return "This email address is already registered."
    return None


def _email_exists_for_account(email: str, account_type: str, role_id: str | None = None) -> bool:
    normalized_email = _normalize_email(email)
    if not normalized_email:
        return False
    if account_type not in {"customer", "staff"}:
        return False
    # Fix: registration and email verification share the same global duplicate check.
    return (
        Customer.objects.filter(email__iexact=normalized_email).exists()
        or User.objects.filter(email__iexact=normalized_email).exists()
    )


def _verify_google_token(credential: str) -> dict[str, Any]:
    client_id = getattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "")
    if not client_id:
        raise ValueError("Google OAuth is not configured")
    skip_ssl_verify = bool(getattr(settings, "GOOGLE_OAUTH_SKIP_SSL_VERIFY", getattr(settings, "DEBUG", False)))

    if skip_ssl_verify and getattr(settings, "DEBUG", False):
        # Local-dev fallback: avoid remote cert fetch when host SSL trust chain is broken.
        parts = credential.split(".")
        if len(parts) != 3:
            raise ValueError("Malformed Google credential")
        payload_part = parts[1]
        payload_part += "=" * ((4 - len(payload_part) % 4) % 4)
        try:
            claims = json.loads(base64.urlsafe_b64decode(payload_part.encode("ascii")).decode("utf-8"))
        except Exception as exc:
            raise ValueError(f"Malformed Google credential payload: {exc}")

        if str(claims.get("aud") or "") != client_id:
            raise ValueError("Google token audience mismatch")
        if str(claims.get("iss") or "") not in {"accounts.google.com", "https://accounts.google.com"}:
            raise ValueError("Google token issuer is invalid")
        exp_raw = claims.get("exp")
        if exp_raw is not None:
            try:
                exp = int(exp_raw)
                now_ts = int(timezone.now().timestamp())
                if exp < now_ts - 300:
                    raise ValueError("Google token is expired")
            except ValueError:
                raise
            except Exception:
                raise ValueError("Google token exp is invalid")
        return claims

    # Allow small server/client clock drift to avoid false "Token used too early" failures.
    import requests as _requests
    session = _requests.Session()
    if os.name == "nt" and getattr(settings, "DEBUG", False):
        # Windows local-dev hard override: trust chain issues are common and block Google cert fetch.
        session.verify = False
    elif skip_ssl_verify and getattr(settings, "DEBUG", False):
        session.verify = False
    else:
        ca_bundle = os.getenv("REQUESTS_CA_BUNDLE", "").strip()
        session.verify = ca_bundle or True
    request = google_requests.Request(session)
    return google_id_token.verify_oauth2_token(
        credential,
        request,
        client_id,
        clock_skew_in_seconds=300,
    )


_GMAIL_API_TOKEN_CACHE = {"token": "", "expires_at": 0.0}


def _get_gmail_api_access_token() -> str:
    import time
    now = time.time()
    if _GMAIL_API_TOKEN_CACHE["token"] and _GMAIL_API_TOKEN_CACHE["expires_at"] > now + 60:
        return _GMAIL_API_TOKEN_CACHE["token"]

    refresh_token = str(getattr(settings, "GMAIL_API_REFRESH_TOKEN", "") or "").strip()
    client_id = str(getattr(settings, "GMAIL_API_CLIENT_ID", "") or getattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "") or "").strip()
    client_secret = str(getattr(settings, "GMAIL_API_CLIENT_SECRET", "") or getattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", "") or "").strip()

    if not refresh_token or not client_id or not client_secret:
        return ""

    try:
        resp = requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        token = data.get("access_token", "")
        expires_in = int(data.get("expires_in", 3600))
        if token:
            _GMAIL_API_TOKEN_CACHE["token"] = token
            _GMAIL_API_TOKEN_CACHE["expires_at"] = now + expires_in
            return token
    except Exception:
        logger.exception("Failed to refresh Gmail API access token")
    return ""


def _send_via_gmail_api(*, subject: str, message: str, recipient: str, html_message: str | None = None) -> bool:
    from email.mime.multipart import MIMEMultipart
    from email.mime.image import MIMEImage
    from email.mime.text import MIMEText
    from email.utils import formatdate, make_msgid
    token = _get_gmail_api_access_token()
    if not token:
        return False

    from_email = str(getattr(settings, "GMAIL_API_SENDER_EMAIL", "") or getattr(settings, "OTP_FROM_EMAIL", "") or getattr(settings, "OTP_GMAIL_USER", "") or "").strip()
    from_name = str(getattr(settings, "OTP_FROM_NAME", "Ann Ann's Beverages Trading") or "Ann Ann's Beverages Trading").strip()

    # Send multipart email so modern clients show the branded design while plain text remains available.
    msg = MIMEMultipart("related")
    alternatives = MIMEMultipart("alternative")
    alternatives.attach(MIMEText(message, "plain", "utf-8"))
    if html_message:
        public_logo_url = _email_public_url("/email-assets/ann-anns-logo.png")
        logo_path = Path(settings.BASE_DIR).parent / "public" / "ann-anns-logo.png"
        resolved_html = html_message
        if public_logo_url and logo_path.is_file():
            # Embed the real system logo so Gmail does not need access to a local server URL.
            resolved_html = resolved_html.replace(public_logo_url, "cid:ann-anns-logo")
        alternatives.attach(MIMEText(resolved_html, "html", "utf-8"))
        msg.attach(alternatives)
        if public_logo_url and logo_path.is_file():
            logo_image = MIMEImage(logo_path.read_bytes(), _subtype="png")
            logo_image.add_header("Content-ID", "<ann-anns-logo>")
            logo_image.add_header("Content-Disposition", "inline", filename="ann-anns-logo.png")
            msg.attach(logo_image)
    else:
        msg.attach(alternatives)
    msg["To"] = recipient
    msg["From"] = f"{from_name} <{from_email}>" if from_email else from_name
    msg["Subject"] = subject
    # RFC-required headers — missing Message-ID is a top spam trigger for raw MIME via Gmail API.
    email_domain = from_email.split("@")[-1] if "@" in from_email else "gmail.com"
    msg["Message-ID"] = make_msgid(domain=email_domain)
    msg["Date"] = formatdate(localtime=True)
    msg["Reply-To"] = f"{from_name} <{from_email}>" if from_email else from_name
    msg["MIME-Version"] = "1.0"

    raw_message = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")

    resp = requests.post(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={"raw": raw_message},
        timeout=20,
    )
    resp.raise_for_status()
    return True


def _otp_mail_ready() -> bool:
    has_gmail_api = bool(
        getattr(settings, "GMAIL_API_REFRESH_TOKEN", "") and
        (getattr(settings, "GMAIL_API_CLIENT_ID", "") or getattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "")) and
        (getattr(settings, "GMAIL_API_CLIENT_SECRET", "") or getattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", ""))
    )
    has_brevo = bool(getattr(settings, "BREVO_API_KEY", "") and getattr(settings, "OTP_FROM_EMAIL", ""))
    has_gmail = bool(getattr(settings, "OTP_GMAIL_USER", "") and getattr(settings, "OTP_GMAIL_APP_PASSWORD", ""))
    return bool(has_gmail_api or has_brevo or has_gmail)


def _send_via_brevo(*, subject: str, message: str, recipient: str, html_message: str | None = None) -> bool:
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
            "htmlContent": html_message or None,
        },
        timeout=20,
    )
    response.raise_for_status()
    return True


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


def _render_order_product_rows(order: Order | None) -> str:
    if order is None or not hasattr(order, "items"):
        return ""
    rows: list[str] = []
    for item in order.items.select_related("product").all():
        product = getattr(item, "product", None)
        name = str(getattr(product, "name", "") or getattr(item, "product_name", "") or "Product").strip()
        size = _get_product_size_label(product)
        quantity = max(0, _int(getattr(item, "quantity", 0), 0))
        total = float(getattr(item, "total_price", 0) or (quantity * float(getattr(item, "unit_price", 0) or 0)))
        image_url = _email_public_url(getattr(product, "image_url", ""))
        image = (
            f'<img src="{escape(image_url)}" alt="{escape(name)}" width="64" height="64" '
            'style="display:block;width:64px;height:64px;border-radius:12px;object-fit:cover;border:1px solid #e2e8f0;">'
            if image_url else
            '<div style="width:64px;height:64px;border-radius:12px;background:#eff6ff;border:1px solid #dbeafe;text-align:center;line-height:64px;color:#0b3b82;font-weight:700;">AAB</div>'
        )
        rows.append(
            '<tr><td style="padding:10px 0;border-bottom:1px solid #e8eef6;width:76px;vertical-align:middle;">'
            f'{image}</td><td style="padding:10px 0;border-bottom:1px solid #e8eef6;vertical-align:middle;">'
            f'<div style="font-size:15px;font-weight:700;color:#102a56;">{escape(name)}</div>'
            f'<div style="font-size:13px;color:#64748b;margin-top:3px;">{escape(size) if size else "Beverage"} &nbsp;&middot;&nbsp; Qty {quantity}</div>'
            f'</td><td style="padding:10px 0;border-bottom:1px solid #e8eef6;text-align:right;vertical-align:middle;font-size:14px;font-weight:700;color:#102a56;">PHP {total:,.2f}</td></tr>'
        )
    if not rows:
        return ""
    return (
        '<div style="margin-top:24px;"><div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#2fa913;margin-bottom:8px;">Order products</div>'
        f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">{"".join(rows)}</table></div>'
    )


def _build_branded_email_html(*, subject: str, message: str, otp_code: str | None = None, order: Order | None = None) -> str:
    """Create one responsive, email-client-safe AAB design for every outgoing message."""
    title = subject.split(" - ")[-1].strip() or subject
    subject_key = subject.casefold()
    # Match the reference's direct, human-readable headline style.
    if "password reset" in subject_key:
        title = "Reset Your Password"
    elif "email verification" in subject_key:
        title = "Verify Your Email"
    elif "login verification" in subject_key:
        title = "Verify Your Login"
    logo_url = _email_public_url("/email-assets/ann-anns-logo.png")
    logo = (
        f'<img src="{escape(logo_url)}" alt="AAB Trading" width="180" style="display:block;width:180px;height:auto;margin:0 auto;">'
        if logo_url else
        '<div style="text-align:center;padding:8px 0 2px;"><div style="font-size:38px;line-height:1;font-weight:900;letter-spacing:.06em;color:#073783;display:inline-block;">A<span style="color:#43b51a;">A</span>B</div><div style="margin-top:4px;color:#073783;font-size:15px;font-weight:800;letter-spacing:.28em;">TRADING</div></div>'
    )
    visible_message = message
    if otp_code:
        # The reference places the code and expiry exclusively inside the OTP panel.
        visible_message = "\n".join(
            line for line in message.splitlines()
            if not line.strip().lower().startswith(("otp:", "verification code:", "expires in"))
        ).strip()
    body_html = escape(visible_message).replace("\n", "<br>")
    otp_html = ""
    if otp_code:
        digits = "&nbsp; ".join(escape(character) for character in str(otp_code))
        otp_html = (
            '<div style="margin:26px 0 22px;border:2px solid #0a3e91;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(7,55,131,.10);">'
            '<div style="background:#073783;padding:15px 20px;text-align:center;color:#ffffff;font-size:16px;font-weight:800;letter-spacing:.04em;">&#128274;&nbsp;&nbsp; YOUR OTP CODE</div>'
            f'<div style="padding:28px 18px 20px;text-align:center;background:#ffffff;font-size:43px;line-height:1.2;font-weight:800;letter-spacing:.13em;color:#35ad15;">{digits}</div>'
            '<div style="margin:0 24px;border-top:2px dashed #b4c9eb;"></div>'
            f'<div style="padding:18px;text-align:center;color:#17233b;font-size:16px;">&#9201;&nbsp; Expires in <strong style="color:#35ad15;">{OTP_EXPIRY_MINUTES} minutes.</strong></div></div>'
        )
    products_html = _render_order_product_rows(order)
    year = timezone.localtime(timezone.now()).year
    return f'''<!doctype html><html><body style="margin:0;padding:0;background:#e7edf7;font-family:Arial,Helvetica,sans-serif;color:#17233b;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#e7edf7;"><tr><td align="center" style="padding:20px 10px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;overflow:hidden;box-shadow:0 18px 48px rgba(2,35,91,.20);">
<tr><td style="height:76px;background:#063784;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="height:12px;background:#42b719;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td align="center" style="padding:0 28px 18px;background:#ffffff;">{logo}</td></tr>
<tr><td style="padding:0 42px 32px;background:#ffffff;"><h1 style="margin:0;text-align:center;color:#073783;font-size:40px;line-height:1.16;font-weight:800;">{escape(title)}</h1>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0 26px;"><tr><td style="height:2px;background:#65c945;font-size:0;">&nbsp;</td><td align="center" width="76" style="color:#43b719;font-size:25px;line-height:1;">&#9679;</td><td style="height:2px;background:#65c945;font-size:0;">&nbsp;</td></tr></table>
<div style="font-size:17px;line-height:1.72;color:#151b27;"><strong style="color:#073783;">Hello,</strong><br>{body_html}</div>{otp_html}{products_html}
<div style="margin-top:26px;padding:18px 20px;border:1px solid #71c953;border-radius:14px;background:#f8fcf6;color:#17233b;font-size:15px;line-height:1.55;">&#9432;&nbsp;&nbsp; If you did not request this, <strong style="color:#35ad15;">you can ignore this email.</strong></div>
</td></tr>
<tr><td style="height:11px;background:#43b719;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="height:28px;background:#063784;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td align="center" style="padding:22px 24px;background:#ffffff;color:#17233b;font-size:13px;line-height:1.7;">&copy; {year} Ann Ann's Beverages Trading. All rights reserved.<br><span style="color:#35ad15;font-weight:700;font-style:italic;">Moving fresh ideas, <span style="color:#073783;">delivering great service.</span></span></td></tr>
</table></td></tr></table></body></html>'''


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
    html_message = _build_branded_email_html(subject=subject, message=message, otp_code=otp_code)
    gmail_refresh = str(getattr(settings, "GMAIL_API_REFRESH_TOKEN", "") or "").strip()
    if gmail_refresh:
        try:
            if _send_via_gmail_api(subject=subject, message=message, recipient=email, html_message=html_message):
                return
        except Exception:
            logger.exception("Gmail API OTP send failed for password reset; falling back")
    brevo_key = str(getattr(settings, "BREVO_API_KEY", "") or "").strip()
    if brevo_key:
        try:
            _send_via_brevo(subject=subject, message=message, recipient=email, html_message=html_message)
            return
        except Exception:
            logger.exception("Brevo OTP send failed for password reset; falling back to SMTP")
    send_mail(
        subject=subject,
        message=message,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[email],
        fail_silently=False,
        html_message=html_message,
    )


def _send_email_verification_otp(email: str, otp_code: str) -> None:
    subject = "Ann Ann's Beverages Trading - Email Verification Code"
    message = (
        "Use this code to verify that your email address is active and can receive mail.\n\n"
        f"Verification code: {otp_code}\n"
        f"Expires in {OTP_EXPIRY_MINUTES} minutes.\n\n"
        "If you did not request this, you can ignore this email."
    )
    html_message = _build_branded_email_html(subject=subject, message=message, otp_code=otp_code)
    gmail_refresh = str(getattr(settings, "GMAIL_API_REFRESH_TOKEN", "") or "").strip()
    if gmail_refresh:
        try:
            if _send_via_gmail_api(subject=subject, message=message, recipient=email, html_message=html_message):
                return
        except Exception:
            logger.exception("Gmail API OTP send failed for email verification; falling back")
    brevo_key = str(getattr(settings, "BREVO_API_KEY", "") or "").strip()
    if brevo_key:
        try:
            _send_via_brevo(subject=subject, message=message, recipient=email, html_message=html_message)
            return
        except Exception:
            logger.exception("Brevo OTP send failed for email verification; falling back to SMTP")
    send_mail(
        subject=subject,
        message=message,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[email],
        fail_silently=False,
        html_message=html_message,
    )


def _send_login_otp_email(email: str, otp_code: str) -> None:
    subject = "Ann Ann's Beverages Trading - Login Verification Code"
    message = (
        "Use this one-time code to complete your login.\n\n"
        f"Verification code: {otp_code}\n"
        f"Expires in {OTP_EXPIRY_MINUTES} minutes.\n\n"
        "If you did not attempt to login, please reset your password immediately."
    )
    html_message = _build_branded_email_html(subject=subject, message=message, otp_code=otp_code)
    gmail_refresh = str(getattr(settings, "GMAIL_API_REFRESH_TOKEN", "") or "").strip()
    if gmail_refresh:
        try:
            if _send_via_gmail_api(subject=subject, message=message, recipient=email, html_message=html_message):
                return
        except Exception:
            logger.exception("Gmail API OTP send failed for login verification; falling back")
    brevo_key = str(getattr(settings, "BREVO_API_KEY", "") or "").strip()
    if brevo_key:
        try:
            _send_via_brevo(subject=subject, message=message, recipient=email, html_message=html_message)
            return
        except Exception:
            logger.exception("Brevo OTP send failed for login verification; falling back to SMTP")
    send_mail(
        subject=subject,
        message=message,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[email],
        fail_silently=False,
        html_message=html_message,
    )


def _send_transactional_email(*, subject: str, message: str, recipients: list[str], order: Order | None = None) -> None:
    cleaned = [str(x or "").strip().lower() for x in recipients if str(x or "").strip()]
    if not cleaned:
        return
    html_message = _build_branded_email_html(subject=subject, message=message, order=order)
    try:
        gmail_refresh = str(getattr(settings, "GMAIL_API_REFRESH_TOKEN", "") or "").strip()
        if gmail_refresh:
            for recipient in cleaned:
                try:
                    _send_via_gmail_api(subject=subject, message=message, recipient=recipient, html_message=html_message)
                except Exception:
                    logger.exception("Gmail API transactional send failed for %s; falling back", recipient)
                    send_mail(
                        subject=subject,
                        message=message,
                        from_email=settings.DEFAULT_FROM_EMAIL,
                        recipient_list=[recipient],
                        fail_silently=False,
                        html_message=html_message,
                    )
            return

        brevo_key = str(getattr(settings, "BREVO_API_KEY", "") or "").strip()
        if brevo_key:
            for recipient in cleaned:
                try:
                    _send_via_brevo(subject=subject, message=message, recipient=recipient, html_message=html_message)
                except Exception:
                    logger.exception("Brevo transactional send failed for %s; falling back to SMTP", recipient)
                    send_mail(
                        subject=subject,
                        message=message,
                        from_email=settings.DEFAULT_FROM_EMAIL,
                        recipient_list=[recipient],
                        fail_silently=False,
                        html_message=html_message,
                    )
            return

        send_mail(
            subject=subject,
            message=message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=cleaned,
            fail_silently=False,
            html_message=html_message,
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
        f"Customer Contact: {shipping_phone}\n"
    )
    _send_transactional_email(subject=subject, message=message, recipients=recipients, order=order)


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
        f"Total Price: PHP {total_amount:.2f}\n\n"
        f"Assigned Driver: {assigned_driver_name}\n"
        f"Contact Info: {assigned_driver_phone}\n\n"
        f"Please prepare the payment amount and be ready to receive your order.\n\n"
        f"Thank you for ordering with us."
    )
    _send_transactional_email(subject=subject, message=message, recipients=[customer_email], order=order)


def _email_order_confirmed_to_customer(order: Order) -> None:
    customer_email = _normalize_email(getattr(order.customer, "email", ""))
    if not customer_email:
        return
    customer_name = str(getattr(order.customer, "name", "") or "Customer").strip()

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
        f"Total Price: PHP {total_amount:.2f}\n"
        f"Delivery Address: {shipping_address}\n\n"
        f"We are now preparing your order for dispatch.\n\n"
        f"Thank you for ordering with us."
    )
    _send_transactional_email(subject=subject, message=message, recipients=[customer_email], order=order)


def _email_order_rejected_to_customer(order: Order, rejection_reason: str) -> None:
    customer_email = _normalize_email(getattr(order.customer, "email", ""))
    if not customer_email:
        return

    subject = f"Order Rejected: {order.order_number}"
    message = (
        f"Your order request has been rejected.\n\n"
        f"Order Number: {order.order_number}\n"
        f"Customer: {getattr(order, 'shipping_name', '') or getattr(getattr(order, 'customer', None), 'name', '') or 'N/A'}\n"
        f"Reason: {rejection_reason or 'No reason provided'}\n\n"
        f"Total Amount: {float(getattr(order, 'total_amount', 0) or 0):,.2f}\n"
        f"Date: {timezone.localtime(getattr(order, 'created_at', timezone.now())).strftime('%Y-%m-%d %I:%M %p')}\n\n"
        f"If you need help, please contact support."
    )
    _send_transactional_email(subject=subject, message=message, recipients=[customer_email], order=order)


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


def _is_inventory_overstocked_flagged_by_stockin(inventory: Inventory) -> bool:
    threshold = max(0, _int(getattr(inventory, "threshold", 0), 0))
    if threshold <= 0:
        return False
    latest_stockin = (
        InventoryTransaction.objects.filter(
            warehouse_id=getattr(inventory, "warehouse_id", None),
            product_id=getattr(inventory, "product_id", None),
            type="IN",
            reference_type="stock_batch",
        )
        .order_by("-created_at")
        .only("quantity")
        .first()
    )
    if not latest_stockin:
        return False
    return max(0, _int(getattr(latest_stockin, "quantity", 0), 0)) >= (threshold * 10)


def _is_inventory_overstocked_for_restock_block(inventory: Inventory, incoming_restock_qty: int = 0) -> bool:
    """
    Overstock guard for stock-in:
    - block only when product is currently flagged overstocked
    - overstock flag is based on latest stock-in batch quantity >= 10x threshold
    """
    return _is_inventory_overstocked_flagged_by_stockin(inventory)


def _stockin_would_flag_overstock(inventory: Inventory, stockin_qty: int) -> bool:
    threshold = max(0, _int(getattr(inventory, "threshold", 0), 0))
    if threshold <= 0:
        return False
    return max(0, _int(stockin_qty, 0)) >= (threshold * 10)


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
    # Use a strict rolling window so an OTP expires within ~5 minutes.
    for minute_offset in range(0, OTP_EXPIRY_MINUTES):
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
        return _err("Invalid email format")
    if account_type not in {"staff", "customer"}:
        return _err("accountType must be 'staff' or 'customer'")
    if account_type == "staff":
        if not role_id:
            return _err("Role is required before verifying a staff email")
        if role_id not in {x for x, _ in RoleType.choices}:
            return _err("Role not found", 404)
    if _email_exists_for_account(email, account_type, role_id):
        return _err("This email address is already registered.", 409)
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
        return _err("Invalid email format")

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
        return _err("Invalid email format")
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
        return _err("Invalid email format")
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
    email = str(body.get("email", "")).strip()
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
    if bool(getattr(user, "two_factor_enabled", False)):
        if not _otp_mail_ready():
            return _err("2FA is enabled but OTP email service is not configured", 500)
        now = timezone.now()
        code = _stateless_otp_for_bucket(user.email, "staff", "login_2fa", _otp_bucket(now))
        try:
            _send_login_otp_email(user.email, code)
        except Exception:
            logger.exception("Failed to send login 2FA OTP")
            return _err("Failed to send login verification code", 500)

        challenge_token = create_token(
            {
                "type": "login_2fa",
                "userId": user.id,
                "email": user.email,
                "portal": portal or "",
                "rememberMe": bool(remember_me),
            },
            exp_hours=1,
        )
        return _ok(
            {
                "success": False,
                "requiresTwoFactor": True,
                "message": "Verification code sent to your email",
                "challengeToken": challenge_token,
            },
            202,
        )

    user.last_login_at = timezone.now()
    user.save(update_fields=["last_login_at", "updated_at"])
    payload = _user_payload(user)
    # Keep auth token lifetime independent from UI inactivity timeout.
    # Inactivity is enforced client-side via session timer; short absolute JWT lifetimes
    # cause active users to get unexpected 401s mid-session.
    token_exp_hours = REMEMBER_ME_EXP_HOURS if remember_me else TOKEN_EXP_HOURS
    # Preserve the signed remember-me choice so restored sessions can reliably
    # skip inactivity logout for the full (and only the full) 30-day lifetime.
    token = create_token({**payload, "rememberMe": remember_me}, token_exp_hours)
    resp = _ok({"success": True, "user": payload, "token": token, "message": "Login successful"})
    _set_auth_cookie(resp, token, remember_me)
    if bool(getattr(user, "login_alerts_enabled", True)):
        try:
            _send_transactional_email(
                subject="Ann Ann's Beverages Trading - New Login Alert",
                message=(
                    f"Hello {user.name},\n\n"
                    f"A new login to your account was detected at {timezone.now().strftime('%Y-%m-%d %H:%M:%S %Z')}.\n"
                    "If this wasn't you, please reset your password immediately."
                ),
                recipients=[user.email],
            )
        except Exception:
            logger.exception("Failed to send login alert email for user=%s", user.id)
    return resp


@csrf_exempt
@require_http_methods(["POST"])
def auth_login_verify_otp(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    challenge_token = str(body.get("challengeToken", "")).strip()
    otp_code = str(body.get("otp", "")).strip()
    if not challenge_token or not otp_code:
        return _err("challengeToken and otp are required")

    challenge_payload = decode_token(challenge_token)
    if not challenge_payload or str(challenge_payload.get("type") or "") != "login_2fa":
        return _err("Invalid or expired login challenge", 401)

    user_id = str(challenge_payload.get("userId") or "").strip()
    email = str(challenge_payload.get("email") or "").strip()
    remember_me = bool(challenge_payload.get("rememberMe", False))
    if not user_id or not email:
        return _err("Invalid login challenge", 401)

    now = timezone.now()
    if not _is_valid_stateless_otp(otp_code, email, "staff", "login_2fa", now):
        return _err("Invalid or expired verification code", 400)

    user = User.objects.filter(id=user_id, email=email, is_active=True).first()
    if not user:
        return _err("Account is unavailable", 401)

    user.last_login_at = timezone.now()
    user.save(update_fields=["last_login_at", "updated_at"])
    payload = _user_payload(user)
    # Keep auth token lifetime independent from UI inactivity timeout.
    token_exp_hours = REMEMBER_ME_EXP_HOURS if remember_me else TOKEN_EXP_HOURS
    # Preserve the original remember-me choice through the completed 2FA login.
    token = create_token({**payload, "rememberMe": remember_me}, token_exp_hours)
    resp = _ok({"success": True, "user": payload, "token": token, "message": "Login successful"})
    _set_auth_cookie(resp, token, remember_me)
    if bool(getattr(user, "login_alerts_enabled", True)):
        try:
            _send_transactional_email(
                subject="Ann Ann's Beverages Trading - New Login Alert",
                message=(
                    f"Hello {user.name},\n\n"
                    f"A new login to your account was detected at {timezone.now().strftime('%Y-%m-%d %H:%M:%S %Z')}.\n"
                    "If this wasn't you, please reset your password immediately."
                ),
                recipients=[user.email],
            )
        except Exception:
            logger.exception("Failed to send login alert email for user=%s", user.id)
    return resp


@csrf_exempt
@require_http_methods(["POST"])
def auth_customer_login(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    email = str(body.get("email", "")).strip()
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
    token = create_token(
        {**payload, "rememberMe": remember_me},
        REMEMBER_ME_EXP_HOURS if remember_me else TOKEN_EXP_HOURS,
    )
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
    except Exception as exc:
        logger.exception("Google customer token verification failed: %s", str(exc))
        if getattr(settings, "DEBUG", False):
            return _err(f"Google authentication failed: {str(exc)}", 503)
        return _err("Google authentication service is temporarily unavailable", 503)

    try:
        email = _normalize_email(claims.get("email"))
        if not email:
            return _err("Google account email is unavailable")
        if not bool(claims.get("email_verified")):
            return _err("Google email is not verified", 401)
        if not _is_gmail_email(email):
            return _err("Invalid email format (example@domain.com)")

        given_name = str(claims.get("given_name") or "").strip()
        family_name = str(claims.get("family_name") or "").strip()
        full_name = str(claims.get("name") or "").strip() or email.split("@")[0]
        avatar = str(claims.get("picture") or "").strip() or None

        if not given_name and not family_name:
            parts = full_name.split()
            given_name = parts[0] if parts else full_name
            family_name = parts[-1] if len(parts) > 1 else ""
            middle_name = " ".join(parts[1:-1]) if len(parts) > 2 else None
        else:
            middle_name = None

        with transaction.atomic():
            customer = Customer.objects.filter(email=email).first()
            if not customer:
                # Create a new active Customer for Google OAuth registration
                random_secret = secrets.token_urlsafe(32)
                customer = Customer.objects.create(
                    email=email,
                    password=hash_password(random_secret),
                    name=full_name,
                    first_name=given_name or full_name,
                    last_name=family_name or None,
                    middle_name=middle_name,
                    avatar=avatar,
                    is_active=True,
                )
                created = True
            else:
                if not customer.is_active:
                    return _err("Account is deactivated", 403)

                changed_fields: list[str] = []
                if not str(customer.name or "").strip() and full_name:
                    customer.name = full_name
                    changed_fields.append("name")
                if not str(customer.first_name or "").strip() and given_name:
                    customer.first_name = given_name
                    changed_fields.append("first_name")
                if not str(customer.last_name or "").strip() and family_name:
                    customer.last_name = family_name
                    changed_fields.append("last_name")
                if avatar and customer.avatar != avatar:
                    customer.avatar = avatar
                    changed_fields.append("avatar")
                if changed_fields:
                    changed_fields.append("updated_at")
                    customer.save(update_fields=changed_fields)
                created = False

        payload = _customer_payload(customer)
        token = create_token(
            {**payload, "rememberMe": remember_me},
            REMEMBER_ME_EXP_HOURS if remember_me else TOKEN_EXP_HOURS,
        )
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
    except Exception as exc:
        logger.exception("Google customer auth post-verification failed: %s", str(exc))
        if getattr(settings, "DEBUG", False):
            return _err(f"Google sign-in post-verification failed: {str(exc)}", 500)
        return _err("Google sign-in is temporarily unavailable. Please use email/password for now.", 500)


@csrf_exempt
@require_http_methods(["POST"])
def auth_staff_google(request: HttpRequest) -> JsonResponse:
    return _err("Google sign-in is disabled for warehouse staff and drivers", 403)


@csrf_exempt
@require_http_methods(["POST"])
def auth_register(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    first_name = str(body.get("firstName") or body.get("first_name") or "").strip()
    middle_name = str(body.get("middleName") or body.get("middle_name") or "").strip()
    last_name = str(body.get("lastName") or body.get("last_name") or "").strip()
    suffix = str(body.get("suffix") or "").strip()

    name = str(body.get("name", "")).strip()
    if first_name and last_name:
        name_parts = [first_name]
        if middle_name:
            name_parts.append(middle_name)
        name_parts.append(last_name)
        if suffix:
            name_parts.append(suffix)
        constructed_name = " ".join(name_parts)
        if not name:
            name = constructed_name
    elif name and not first_name and not last_name:
        parts = name.split()
        first_name = parts[0] if parts else ""
        last_name = parts[-1] if len(parts) > 1 else ""
        middle_name = " ".join(parts[1:-1]) if len(parts) > 2 else ""

    email = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", ""))
    email_verification_token = str(body.get("emailVerificationToken", "")).strip()
    if not (first_name and last_name or name) or not email or not password:
        return _err("First name, last name, email and password are required")
    password_error = _validate_password_strength(password)
    if password_error:
        return _err(password_error)
    if not _is_gmail_email(email):
        return _err("Invalid email format (example@domain.com)")
    if _email_exists_for_account(email, "customer"):
        return _err("This email address is already registered.", 409)
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
        first_name=first_name,
        middle_name=middle_name or None,
        last_name=last_name,
        suffix=suffix or None,
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
    if p.get("type") == "staff":
        user = User.objects.filter(id=p.get("userId"), is_active=True).first()
        if not user:
            return _err("Unauthorized", 401)
        user_payload = _user_payload(user)
        # Return the signed session choice so every staff portal applies the
        # same inactivity policy after a page reload.
        user_payload["rememberMe"] = bool(p.get("rememberMe", False))
        return _ok({"success": True, "user": user_payload})
    if p.get("type") == "customer":
        customer = Customer.objects.filter(id=p.get("userId"), is_active=True).first()
        if not customer:
            return _err("Unauthorized", 401)
        customer_payload = _customer_payload(customer)
        customer_payload["rememberMe"] = bool(p.get("rememberMe", False))
        return _ok({"success": True, "user": customer_payload})
    return _ok({"success": True, "user": p})


@csrf_exempt
@require_http_methods(["POST"])
def auth_logout(request: HttpRequest) -> JsonResponse:
    resp = _ok({"success": True, "message": "Logout successful"})
    payload = _require_auth(request)
    account_type = str((payload or {}).get("type") or "").strip().lower()
    if account_type == "customer":
        resp.delete_cookie(CUSTOMER_TOKEN_NAME, path="/")
    elif account_type == "staff":
        resp.delete_cookie(STAFF_TOKEN_NAME, path="/")
    else:
        # Unknown/expired token: only clear legacy cookie, avoid killing other role sessions.
        resp.delete_cookie(TOKEN_NAME, path="/")
    # Keep cleanup for legacy shared cookie if present.
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


@csrf_exempt
@require_http_methods(["POST"])
def auth_password_reset_verify_otp(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    email = _normalize_email(body.get("email"))
    account_type = str(body.get("accountType", "")).strip().lower()
    otp_code = str(body.get("otp", "")).strip()

    if not email:
        return _err("Email is required")
    if account_type not in {"staff", "customer"}:
        return _err("accountType must be 'staff' or 'customer'")
    if not otp_code:
        return _err("OTP is required")

    now = timezone.now()
    if not _is_valid_stateless_otp(otp_code, email, account_type, "password_reset", now):
        return _err("Invalid or expired OTP", 400)

    return _ok({"success": True, "message": "OTP verified successfully."})


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
    phone = _normalize_philippine_phone(body.get("phone"))
    email_verification_token = str(body.get("emailVerificationToken", "")).strip()
    if not email or not name or not password or not role_id:
        return _err("name, email, password and roleId are required")
    if not phone:
        return _err(PHILIPPINE_PHONE_ERROR)
    password_error = _validate_password_strength(password)
    if password_error:
        return _err(password_error)
    if not _is_gmail_email(email):
        return _err("Invalid email format for staff/driver account")
    if role_id not in {x for x, _ in RoleType.choices}:
        return _err("Role not found", 404)
    role = role_id
    existing_message = _staff_email_conflict_message(email, role_id)
    if existing_message:
        return _err(existing_message, 409)
    if not _is_email_verification_token_valid(email_verification_token, email, "staff"):
        return _err("Please verify this email address before creating the user", 400)
    user = User.objects.create(
        email=email,
        password=hash_password(password),
        name=name,
        phone=phone,
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
    current_role = str(user.role or "").strip()
    requested_email_raw = body.get("email", None)
    requested_email = current_email
    email_change_requested = False
    if requested_email_raw is not None:
        requested_email = str(requested_email_raw).strip().lower()
        email_change_requested = requested_email != current_email

    requested_role = str(body.get("roleId") or current_role).strip()
    role_change_requested = requested_role != current_role
    if email_change_requested or role_change_requested:
        existing_message = _staff_email_conflict_message(requested_email, requested_role, exclude_user_id=user.id)
        if existing_message:
            return _err(existing_message, 409)

    password_change_requested = bool(body.get("password"))
    admin_password_reset_requested = password_change_requested and bool(body.get("adminResetPassword"))
    if admin_password_reset_requested:
        actor_role = str(staff.get("role") or "").strip().upper()
        target_role = str(user.role or "").strip().upper()
        if actor_role not in {RoleType.SUPER_ADMIN, RoleType.ADMIN}:
            return _err("Only an administrator can reset another user's password", 403)
        if target_role == RoleType.SUPER_ADMIN and actor_role != RoleType.SUPER_ADMIN:
            return _err("Only the owner can reset this password", 403)

    if email_change_requested or (password_change_requested and not admin_password_reset_requested):
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

    if "firstName" in body:
        user.first_name = str(body.get("firstName") or "").strip() or None
    if "middleName" in body:
        user.middle_name = str(body.get("middleName") or "").strip() or None
    if "lastName" in body:
        user.last_name = str(body.get("lastName") or "").strip() or None
    if "suffix" in body:
        user.suffix = str(body.get("suffix") or "").strip() or None

    if any(k in body for k in ("firstName", "middleName", "lastName", "suffix")):
        user.name = _format_display_name(user.first_name, user.middle_name, user.last_name, user.suffix, user.name)
    elif "name" in body:
        user.name = str(body.get("name") or "").strip()

    if "phone" in body:
        # Fix: validate and persist the same numeric phone value returned to admin/staff clients.
        normalized_phone = _normalize_philippine_phone(body.get("phone"))
        if not normalized_phone:
            return _err(PHILIPPINE_PHONE_ERROR)
        user.phone = normalized_phone
    if "avatar" in body:
        user.avatar = body.get("avatar")
    if "twoFactorEnabled" in body:
        user.two_factor_enabled = bool(body.get("twoFactorEnabled"))
    if "loginAlertsEnabled" in body:
        user.login_alerts_enabled = bool(body.get("loginAlertsEnabled"))
    if "sessionTimeoutMinutes" in body:
        try:
            timeout_minutes = int(body.get("sessionTimeoutMinutes"))
        except (TypeError, ValueError):
            return _err("Session timeout must be a valid number")
        if timeout_minutes < 5:
            return _err("Session timeout must be at least 5 minutes")
        user.session_timeout_minutes = timeout_minutes
    if "email" in body:
        next_email = requested_email
        if not next_email:
            return _err("Email is required")
        if next_email != current_email and not _is_gmail_email(next_email):
            return _err("Invalid email format for staff/driver account")
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
    if email_change_requested or role_change_requested:
        # Fix: unchanged legacy emails must not block unrelated profile updates.
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
        return _err("Invalid email format for customer account")
    if _email_exists_for_account(email, "customer"):
        return _err("This email address is already registered.", 409)
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
        cust_data = _serialize_model(c, exclude={"password"})
        from .rgb.services import get_customer_bottle_balances
        cust_data["bottleBalances"] = get_customer_bottle_balances(c)
        return _ok({"success": True, "customer": cust_data})
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

    if "firstName" in body:
        c.first_name = str(body.get("firstName") or "").strip() or None
    if "middleName" in body:
        c.middle_name = str(body.get("middleName") or "").strip() or None
    if "lastName" in body:
        c.last_name = str(body.get("lastName") or "").strip() or None
    if "suffix" in body:
        c.suffix = str(body.get("suffix") or "").strip() or None

    if any(k in body for k in ("firstName", "middleName", "lastName", "suffix")):
        c.name = _format_display_name(c.first_name, c.middle_name, c.last_name, c.suffix, c.name)
    elif "name" in body:
        c.name = str(body.get("name") or "").strip()

    mapping = [("phone", "phone"), ("avatar", "avatar"), ("address", "address"), ("city", "city"), ("province", "province"), ("zipCode", "zip_code"), ("latitude", "latitude"), ("longitude", "longitude")]
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
            qs = qs.filter(id__in=list(_get_allowed_warehouse_ids_for_staff(user_id)))
        total = qs.count()
        rows = list(qs[off : off + size])
        payload_rows = []
        for row in rows:
            serialized = _serialize_model(row)
            manager_id = str(getattr(row, "manager_id", "") or "").strip()
            serialized["staffIds"] = [manager_id] if manager_id else []
            payload_rows.append(serialized)
        return _ok({"success": True, "warehouses": payload_rows, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
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
    requested_manager_id = _resolve_requested_warehouse_manager_id(body)
    warehouse_label = _find_staff_already_assigned_elsewhere(requested_manager_id)
    if warehouse_label:
        staff_user = User.objects.filter(id=requested_manager_id).only("name", "email").first()
        staff_name = str(getattr(staff_user, "name", "") or getattr(staff_user, "email", "") or requested_manager_id)
        return _err(f"{staff_name} is already assigned to {warehouse_label}. One warehouse staff can only belong to one warehouse.", 400)
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
        manager_id=requested_manager_id or None,
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
    warehouse_data = _serialize_model(w)
    warehouse_data["staffIds"] = [requested_manager_id] if requested_manager_id else []
    return _ok({"success": True, "warehouse": warehouse_data}, 201)


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
        warehouse_data = _serialize_model(w)
        manager_id = str(getattr(w, "manager_id", "") or "").strip()
        warehouse_data["staffIds"] = [manager_id] if manager_id else []
        return _ok({"success": True, "warehouse": warehouse_data})
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
    if "staffIds" in body or "managerId" in body:
        requested_manager_id = _resolve_requested_warehouse_manager_id(body, manager_id_fallback=str(getattr(w, "manager_id", "") or ""))
        warehouse_label = _find_staff_already_assigned_elsewhere(requested_manager_id, current_warehouse_id=str(w.id))
        if warehouse_label:
            staff_user = User.objects.filter(id=requested_manager_id).only("name", "email").first()
            staff_name = str(getattr(staff_user, "name", "") or getattr(staff_user, "email", "") or requested_manager_id)
            return _err(f"{staff_name} is already assigned to {warehouse_label}. One warehouse staff can only belong to one warehouse.", 400)
        w.manager_id = requested_manager_id or None
    w.save()
    warehouse_data = _serialize_model(w)
    manager_id = str(getattr(w, "manager_id", "") or "").strip()
    warehouse_data["staffIds"] = [manager_id] if manager_id else []
    return _ok({"success": True, "warehouse": warehouse_data})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def products_collection(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = _real_products(Product.objects.filter(is_active=True)).order_by("name")
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

        packagings = list(
            ProductPackaging.objects.filter(product_id__in=product_ids, is_active=True)
            .select_related("container_type")
        )
        packaging_by_product: dict[str, ProductPackaging] = {p.product_id: p for p in packagings}

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

            qty_per_unit = max(1, int(product.quantity_per_unit or 1)) if product.quantity_per_unit else 1
            if product.price and product.price > 0:
                row["baseUnitPrice"] = round(float(product.price) / qty_per_unit, 2)
            elif hasattr(product, "retail_unit_price") and product.retail_unit_price:
                row["baseUnitPrice"] = float(product.retail_unit_price)
            else:
                row["baseUnitPrice"] = 0.0

            pkg = packaging_by_product.get(product.id)
            if pkg:
                row["packagingType"] = "RETURNABLE" if pkg.is_returnable else "NON_RETURNABLE"
                row["containerTypeId"] = pkg.container_type_id
                row["containerTypeName"] = pkg.container_type.name if pkg.container_type else None
                row["containersPerCase"] = pkg.containers_per_case
                row["depositAmount"] = float(pkg.deposit_amount)
                row["caseDepositAmount"] = float(pkg.case_deposit_amount)
            elif _is_returnable_product(product):
                pkg_obj, ct_obj = _get_or_create_product_packaging(product)
                row["packagingType"] = "RETURNABLE"
                row["containerTypeId"] = ct_obj.id
                row["containerTypeName"] = ct_obj.name
                row["containersPerCase"] = pkg_obj.containers_per_case
                row["depositAmount"] = float(pkg_obj.deposit_amount)
                row["caseDepositAmount"] = float(pkg_obj.case_deposit_amount)

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
    raw_sizes = body.get("sizes")
    normalized_sizes = [str(value).strip() for value in raw_sizes] if isinstance(raw_sizes, list) else []
    normalized_sizes = [value for value in normalized_sizes if value]
    category_value = str(body.get("category") or "").strip() or None
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
                category=category_value,
                sizes=normalized_sizes,
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

            # Create or update packaging / deposit if specified
            bottle_deposit = float(body.get("bottleDeposit") or body.get("depositAmount") or 0)
            case_deposit = float(body.get("caseDeposit") or body.get("caseDepositAmount") or 0)
            if bottle_deposit > 0 or case_deposit > 0 or _is_returnable_product(prod):
                pkg_obj, ct_obj = _get_or_create_product_packaging(prod)
                if bottle_deposit > 0:
                    pkg_obj.deposit_amount = Decimal(str(round(bottle_deposit, 2)))
                    ct_obj.deposit_amount = Decimal(str(round(bottle_deposit, 2)))
                    ct_obj.save(update_fields=["deposit_amount"])
                if case_deposit > 0:
                    pkg_obj.case_deposit_amount = Decimal(str(round(case_deposit, 2)))
                pkg_obj.save(update_fields=["deposit_amount", "case_deposit_amount"])

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
        inventory_rows = Inventory.objects.filter(product_id=prod.id).values(
            "warehouse__name",
            "quantity",
            "loose_bottles",
            "reserved_quantity",
        )
        total_cases = 0
        total_loose = 0
        total_reserved = 0
        for row in inventory_rows:
            total_cases += max(0, _int(row.get("quantity"), 0))
            total_loose += max(0, _int(row.get("loose_bottles"), 0))
            total_reserved += max(0, _int(row.get("reserved_quantity"), 0))
        if total_cases > 0 or total_loose > 0 or total_reserved > 0:
            return _err(
                (
                    "Cannot delete product while stock still exists. "
                    f"Remaining: {total_cases} case(s), {total_loose} loose bottle(s), "
                    f"{total_reserved} reserved."
                ),
                409,
            )
        # Preserve order history snapshots, then allow hard delete.
        # OrderItem.product uses SET_NULL so historical order rows remain readable.
        try:
            with transaction.atomic():
                linked_order_items = OrderItem.objects.filter(product_id=prod.id)
                for item in linked_order_items:
                    updates: list[str] = []
                    if not str(getattr(item, "product_name", "") or "").strip():
                        item.product_name = product_name
                        updates.append("product_name")
                    if not str(getattr(item, "product_sku", "") or "").strip():
                        item.product_sku = product_sku or None
                        updates.append("product_sku")
                    if not str(getattr(item, "product_unit", "") or "").strip():
                        item.product_unit = _normalize_product_unit(getattr(prod, "unit", None))
                        updates.append("product_unit")
                    if updates:
                        item.save(update_fields=updates)
                prod.delete()
        except ProtectedError:
            return _err(
                "Cannot delete product because it is still referenced by protected records. "
                "Clear related records first, then try again.",
                409,
            )
        except IntegrityError as exc:
            logger.exception("Product delete integrity error for product %s", product_id)
            return _err(f"Delete blocked by a system constraint: {str(exc)}", 409)
        except Exception as exc:
            logger.exception("Unexpected product delete error for product %s", product_id)
            return _err(f"Failed to delete product: {str(exc)}", 500)
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
    if "category" in body:
        prod.category = str(body.get("category") or "").strip() or None
    if "sizes" in body:
        raw_sizes = body.get("sizes")
        if not isinstance(raw_sizes, list):
            return _err("sizes must be an array", 400)
        prod.sizes = [str(value).strip() for value in raw_sizes if str(value).strip()]
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
            .filter(product__is_active=True)
            .filter(warehouse__in=_real_warehouses(Warehouse.objects.all()))
            .order_by("-updated_at")
        )

        staff_role = str(staff.get("role") or "").strip().upper()
        staff_user_id = str(staff.get("userId") or "").strip()
        allowed_warehouse_ids: set[str] | None = None
        if staff_role == "WAREHOUSE_STAFF" and staff_user_id:
            allowed_warehouse_ids = set(
                _get_allowed_warehouse_ids_for_staff(staff_user_id)
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
        data = []
        for item in rows:
            row = _serialize_model(
                item,
                include={"warehouse": lambda o: _serialize_model(o.warehouse), "product": lambda o: _serialize_model(o.product)},
            )
            row["overstockedFlag"] = _is_inventory_overstocked_flagged_by_stockin(item)
            data.append(row)
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
    if not created and _is_inventory_overstocked_for_restock_block(item, qty):
        return _err("Cannot add stock: product is currently flagged as overstocked (latest stock-in is >= 10x threshold).", 400)
    if not created:
        item.quantity += qty
        item.loose_bottles = max(0, _int(getattr(item, "loose_bottles", 0), 0) + loose_bottles)
    else:
        item.loose_bottles = loose_bottles
    should_update_threshold = not _stockin_would_flag_overstock(item, qty)
    if should_update_threshold:
        item.threshold = max(1, int(item.quantity * 0.15))
    item.last_restocked_at = timezone.now()
    update_fields = ["quantity", "loose_bottles", "last_restocked_at", "updated_at"]
    if should_update_threshold:
        update_fields.insert(2, "threshold")
    item.save(update_fields=update_fields)
    InventoryTransaction.objects.create(
        warehouse=warehouse,
        product=product,
        type=str(body.get("type") or "IN"),
        quantity=qty,
        reference_type=body.get("referenceType"),
        reference_id=body.get("referenceId"),
        notes=body.get("notes"),
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
            _get_allowed_warehouse_ids_for_staff(staff_user_id)
        )
        if not allowed_warehouse_ids:
            return _ok({"success": True, "transactions": [], "total": 0, "page": page, "pageSize": size, "totalPages": 0})
        qs = qs.filter(warehouse_id__in=list(allowed_warehouse_ids))

    tx_type = str(request.GET.get("type") or "").strip().upper()
    if tx_type and tx_type != "ALL":
        qs = qs.filter(type__iexact=tx_type)

    search = str(request.GET.get("search") or "").strip()
    if search:
        qs = qs.filter(
            Q(product__name__icontains=search)
            | Q(product__sku__icontains=search)
            | Q(notes__icontains=search)
            | Q(id__icontains=search)
            | Q(reference_id__icontains=search)
        )

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
@require_http_methods(["GET", "POST", "PUT"])
def stock_batches_collection(request: HttpRequest) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = (
            StockBatch.objects.select_related("inventory", "inventory__warehouse", "inventory__product")
            .filter(inventory__product__in=_real_products(Product.objects.all()))
            .filter(inventory__product__is_active=True)
            .filter(inventory__warehouse__in=_real_warehouses(Warehouse.objects.all()))
            .filter(quantity__gt=0)
            .order_by("-created_at")
        )
        staff_role = str(staff.get("role") or "").strip().upper()
        staff_user_id = str(staff.get("userId") or "").strip()
        allowed_warehouse_ids: set[str] | None = None
        if staff_role == "WAREHOUSE_STAFF" and staff_user_id:
            allowed_warehouse_ids = set(
                _get_allowed_warehouse_ids_for_staff(staff_user_id)
            )
            if not allowed_warehouse_ids:
                return _ok({"success": True, "stockBatches": [], "total": 0, "page": page, "pageSize": size, "totalPages": 0})
            qs = qs.filter(inventory__warehouse_id__in=list(allowed_warehouse_ids))
        total = qs.count()
        rows = list(qs[off : off + size])
        data = [_serialize_model(x, include={"inventory": lambda o: _serialize_model(o.inventory, include={"warehouse": lambda i: _serialize_model(i.warehouse), "product": lambda i: _serialize_model(i.product)})}) for x in rows]
        return _ok({"success": True, "stockBatches": data, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})
    body = _json_body(request)
    if request.method == "PUT":
        batch_id = str(body.get("batchId") or body.get("id") or "").strip()
        if not batch_id:
            return _err("batchId is required", 400)
        quantity = _int(body.get("quantity"), -1)
        if quantity < 0:
            return _err("quantity must be a non-negative number", 400)

        batch = (
            StockBatch.objects.select_related("inventory", "inventory__warehouse", "inventory__product")
            .filter(id=batch_id)
            .first()
        )
        if not batch:
            return _err("Stock batch not found", 404)

        staff_role = str(staff.get("role") or "").strip().upper()
        staff_user_id = str(staff.get("userId") or "").strip()
        if staff_role == "WAREHOUSE_STAFF" and staff_user_id:
            allowed_warehouse_ids = _get_allowed_warehouse_ids_for_staff(staff_user_id)
            if not allowed_warehouse_ids or str(getattr(batch.inventory, "warehouse_id", "") or "").strip() not in allowed_warehouse_ids:
                return _err("Access denied for this warehouse", 403)

        inv = batch.inventory
        previous_qty = max(0, _int(getattr(batch, "quantity", 0), 0))
        next_qty = max(0, quantity)
        delta = next_qty - previous_qty

        # Added: warehouse staff can update batch dates independently of quantity.
        manufactured_date = batch.receipt_date
        if "manufacturedDate" in body or "manufactured_date" in body:
            manufactured_raw = str(body.get("manufacturedDate") or body.get("manufactured_date") or "").strip()
            if not manufactured_raw:
                return _err("manufacturedDate is required", 400)
            try:
                manufactured_date = datetime.fromisoformat(manufactured_raw.replace("Z", "+00:00"))
                if timezone.is_naive(manufactured_date):
                    manufactured_date = timezone.make_aware(manufactured_date)
            except ValueError:
                return _err("Invalid manufacturedDate", 400)

        expiry_date = batch.expiry_date
        if "expiryDate" in body or "expiry_date" in body:
            expiry_raw = str(body.get("expiryDate") or body.get("expiry_date") or "").strip()
            if expiry_raw:
                try:
                    expiry_date = datetime.fromisoformat(expiry_raw.replace("Z", "+00:00"))
                    if timezone.is_naive(expiry_date):
                        expiry_date = timezone.make_aware(expiry_date)
                except ValueError:
                    return _err("Invalid expiryDate", 400)
            else:
                expiry_date = None

        dates_changed = manufactured_date != batch.receipt_date or expiry_date != batch.expiry_date
        if delta == 0 and not dates_changed:
            return _ok(
                {
                    "success": True,
                    "stockBatch": _serialize_model(batch, include={"inventory": lambda o: _serialize_model(o.inventory)}),
                    "message": "Stock batch unchanged",
                }
            )

        if delta > 0 and _is_inventory_overstocked_for_restock_block(inv, delta):
            return _err("Cannot increase stock batch quantity: product is overstocked.", 400)

        with transaction.atomic():
            if delta != 0:
                batch.quantity = next_qty
                _persist_stock_batch_quantity(batch)

            # Save date-only edits too; quantity persistence deliberately uses a narrow update_fields list.
            if next_qty > 0 and dates_changed:
                batch.receipt_date = manufactured_date
                batch.expiry_date = expiry_date
                batch.save(update_fields=["receipt_date", "expiry_date", "updated_at"])

            if delta != 0:
                refreshed_inventory = Inventory.objects.select_for_update().filter(id=inv.id).first()
                if not refreshed_inventory:
                    return _err("Inventory not found", 404)
                recalculated_total = (
                    StockBatch.objects.filter(inventory_id=refreshed_inventory.id, quantity__gt=0)
                    .aggregate(total=Sum("quantity"))
                    .get("total")
                )
                inv.quantity = max(0, _int(recalculated_total, 0))
                should_update_threshold = not _stockin_would_flag_overstock(inv, next_qty)
                if should_update_threshold:
                    inv.threshold = max(1, int(inv.quantity * 0.15))
                update_fields = ["quantity", "updated_at"]
                if should_update_threshold:
                    update_fields.insert(1, "threshold")
                inv.save(update_fields=update_fields)

                tx = (
                    InventoryTransaction.objects.filter(
                        reference_type="stock_batch",
                        reference_id=batch_id,
                        type="IN",
                    )
                    .order_by("created_at")
                    .first()
                )
                if tx:
                    tx.quantity = next_qty
                    tx.notes = "Stock batch added (edited quantity)"
                    tx.save(update_fields=["quantity", "notes"])
                else:
                    InventoryTransaction.objects.create(
                        warehouse=inv.warehouse,
                        product=inv.product,
                        type="IN",
                        quantity=next_qty,
                        reference_type="stock_batch",
                        reference_id=batch_id,
                        notes="Stock batch added (edited quantity)",
                    )

        updated_batch = (
            StockBatch.objects.select_related("inventory", "inventory__warehouse", "inventory__product")
            .filter(id=batch_id)
            .first()
        )
        return _ok(
            {
                "success": True,
                "stockBatch": _serialize_model(updated_batch, include={"inventory": lambda o: _serialize_model(o.inventory)}) if updated_batch else None,
                "message": "Stock batch updated",
            }
        )

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
    if not expiry_raw:
        return _err("expiryDate is required", 400)
    expiry_date = None
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
                if not created and _is_inventory_overstocked_for_restock_block(inv, qty):
                    return _err("Cannot add stock: product is currently flagged as overstocked (latest stock-in is >= 10x threshold).", 400)

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
            should_update_threshold = not _stockin_would_flag_overstock(inv, qty)
            if should_update_threshold:
                inv.threshold = max(1, int(inv.quantity * 0.15))
            inv.last_restocked_at = timezone.now()
            update_fields = ["quantity", "last_restocked_at", "updated_at"]
            if should_update_threshold:
                update_fields.insert(1, "threshold")
            inv.save(update_fields=update_fields)

            InventoryTransaction.objects.create(
                warehouse=inv.warehouse,
                product=inv.product,
                type="IN",
                quantity=qty,
                reference_type="stock_batch",
                reference_id=batch.id,
                notes="Stock batch added",
            )
            from .deposit_lifecycle import record_stockin_empty_consumption
            record_stockin_empty_consumption(inv, batch, qty)
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
    seen_product_ids: set[str] = set()
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
        if product_id in seen_product_ids:
            return _err(f"Batch {idx}: product is already included in this stock submission", 400)
        seen_product_ids.add(product_id)
        if qty <= 0:
            return _err(f"Batch {idx}: quantity must be > 0", 400)

        product = Product.objects.filter(id=product_id).first()
        if not product:
            return _err(f"Batch {idx}: Product not found", 404)

        if not expiry_raw:
            return _err(f"Batch {idx}: expiryDate is required", 400)
        expiry_date = None
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
            newly_created_count = 0
            reused_count = 0

            for batch_data in validated_batches:
                product_id = batch_data["product_id"]
                product = batch_data["product"]
                qty = batch_data["quantity"]
                expiry_date = batch_data["expiry_date"]

                # Add Stock only accepts products already registered in this warehouse inventory.
                inv = (
                    Inventory.objects.select_for_update()
                    .select_related("warehouse", "product")
                    .filter(warehouse=warehouse, product=product)
                    .first()
                )
                if not inv:
                    return _err(
                        f"Batch {batch_data['index']}: selected product is not registered in this warehouse inventory.",
                        400,
                    )

                # A retried request reuses its original batch and must not add quantity twice.
                existing_batch = (
                    StockBatch.objects.select_related("inventory")
                    .filter(batch_number=batch_data["batch_number"])
                    .first()
                )
                if existing_batch:
                    same_submission = (
                        existing_batch.inventory_id == inv.id
                        and _int(existing_batch.quantity, 0) == qty
                    )
                    if not same_submission:
                        return _err(f"Batch {batch_data['index']}: batch number is already in use", 409)
                    created_stock_batches.append(existing_batch)
                    reused_count += 1
                    continue

                if _is_inventory_overstocked_for_restock_block(inv, qty):
                    return _err(
                        f"Batch {batch_data['index']}: cannot add stock for product currently flagged as overstocked (latest stock-in is >= 10x threshold).",
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
                newly_created_count += 1

                # Update inventory quantity
                inv.quantity += qty
                should_update_threshold = not _stockin_would_flag_overstock(inv, qty)
                if should_update_threshold:
                    inv.threshold = max(1, int(inv.quantity * 0.15))
                inv.last_restocked_at = timezone.now()
                update_fields = ["quantity", "last_restocked_at", "updated_at"]
                if should_update_threshold:
                    update_fields.insert(1, "threshold")
                inv.save(update_fields=update_fields)

                # Create inventory transaction
                InventoryTransaction.objects.create(
                    warehouse=inv.warehouse,
                    product=inv.product,
                    type="IN",
                    quantity=qty,
                    reference_type="stock_batch",
                    reference_id=batch.id,
                    notes="Bulk stock batch added",
                )
                from .deposit_lifecycle import record_stockin_empty_consumption
                record_stockin_empty_consumption(inv, batch, qty)

                created_stock_batches.append(batch)

            serialized_batches = [_serialize_model(b, include={"inventory": lambda o: _serialize_model(o.inventory, include={"warehouse": lambda i: _serialize_model(i.warehouse), "product": lambda i: _serialize_model(i.product)})}) for b in created_stock_batches]
            if newly_created_count > 0:
                actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
                _create_staff_notifications(
                    title="Bulk Stock In completed",
                    message=f"{actor_name} completed Stock In for {newly_created_count} batches in {warehouse.name}.",
                    reference_type="stock_batch",
                    reference_id=warehouse.id,
                )

            return _ok({
                "success": True,
                "created": len(created_stock_batches),
                "reused": reused_count,
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
        raw_plate = str(body["licensePlate"]).strip()
        if Vehicle.objects.filter(license_plate__iexact=raw_plate).exists():
            return _err(f"A vehicle with plate number {raw_plate} already exists.", 400)
        driver_id = str(body.get("driverId") or "").strip()
        if driver_id:
            driver = User.objects.filter(id=driver_id, role="DRIVER").first()
            if not driver:
                return _err("Driver not found", 404)
            existing_veh = Vehicle.objects.filter(driver=driver).first()
            if existing_veh:
                return _err(f"Driver is already assigned to vehicle {existing_veh.license_plate}.", 400)
        v = Vehicle.objects.create(
            license_plate=raw_plate,
            brand=str(body.get("brand") or "").strip(),
            model=str(body.get("model") or "").strip(),
            year=body.get("year"),
            type=body["type"],
            classification=body.get("classification") or "LIGHT_DUTY",
            capacity=body.get("capacity"),
            status=body.get("status") or VehicleStatus.AVAILABLE,
            is_active=bool(body.get("isActive", True)),
        )
        if driver_id:
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
    if "licensePlate" in body:
        new_plate = str(body.get("licensePlate") or "").strip()
        if new_plate and Vehicle.objects.filter(license_plate__iexact=new_plate).exclude(id=v.id).exists():
            return _err(f"A vehicle with plate number {new_plate} already exists.", 400)
    mapping = [("licensePlate", "license_plate"), ("brand", "brand"), ("model", "model"), ("year", "year"), ("type", "type"), ("classification", "classification"), ("capacity", "capacity"), ("status", "status")]
    for key, attr in mapping:
        if key in body:
            setattr(v, attr, body.get(key))
    if "driverId" in body:
        driver_id = str(body.get("driverId") or "").strip()
        if driver_id:
            driver = User.objects.filter(id=driver_id, role="DRIVER").first()
            if not driver:
                return _err("Driver not found", 404)
            existing_veh = Vehicle.objects.filter(driver=driver).exclude(id=v.id).first()
            if existing_veh:
                return _err(f"Driver is already assigned to vehicle {existing_veh.license_plate}.", 400)
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
        lic_number, lic_err = _validate_philippine_driver_license(body.get("licenseNumber"))
        if lic_err:
            return _err(lic_err, 400)
        user.role = "DRIVER"
        user.license_number = lic_number
        license_type_value = str(body.get("licenseType") or "B").strip().upper()
        if license_type_value not in DRIVER_RESTRICTIONS:
            return _err("Restrictions must be one of: A, A1, B, B1, B2, C, D, BE, CE", 400)
        user.license_type = license_type_value
        user.license_photo_url = body.get("licensePhotoUrl") or None
        if body.get("licenseExpiry"):
            parsed_license_expiry, expiry_error = _validate_future_license_expiry(body.get("licenseExpiry"))
            if expiry_error:
                return _err(expiry_error, 400)
            user.license_expiry = parsed_license_expiry
        else:
            user.license_expiry = timezone.now() + timedelta(days=365)
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
    if "licenseNumber" in body:
        lic_number, lic_err = _validate_philippine_driver_license(body.get("licenseNumber"))
        if lic_err:
            return _err(lic_err, 400)
        d.license_number = lic_number
    mapping = [
        ("licenseType", "license_type"),
        ("licensePhotoUrl", "license_photo_url"),
        ("emergencyContact", "emergency_contact"),
        ("rating", "rating"),
        ("totalDeliveries", "total_deliveries"),
    ]
    for key, attr in mapping:
        if key in body:
            next_value = body.get(key)
            if attr == "license_type" and next_value is not None:
                normalized_type = str(next_value).strip().upper()
                if normalized_type not in DRIVER_RESTRICTIONS:
                    return _err("Restrictions must be one of: A, A1, B, B1, B2, C, D, BE, CE", 400)
                setattr(d, attr, normalized_type or None)
            else:
                setattr(d, attr, next_value)
    if "licenseExpiry" in body and body.get("licenseExpiry"):
        parsed_license_expiry, expiry_error = _validate_future_license_expiry(body.get("licenseExpiry"))
        if expiry_error:
            return _err(expiry_error, 400)
        d.license_expiry = parsed_license_expiry
    if "vehicleId" in body:
        vehicle_id = str(body.get("vehicleId") or "").strip()
        if vehicle_id:
            vehicle = Vehicle.objects.filter(id=vehicle_id).first()
            if not vehicle:
                return _err("Vehicle not found", 404)
            existing_veh = Vehicle.objects.filter(driver=d).exclude(id=vehicle.id).first()
            if existing_veh:
                return _err(f"Driver is already assigned to vehicle {existing_veh.license_plate}.", 400)
            _assign_vehicle_to_driver(d, vehicle)
        else:
            _assign_vehicle_to_driver(d, None)
    if "isActive" in body:
        d.is_active = bool(body.get("isActive"))
    d.save()
    if "phone" in body:
        normalized_phone = _normalize_philippine_phone(body.get("phone"))
        if not normalized_phone:
            return _err(PHILIPPINE_PHONE_ERROR)
        d.phone = normalized_phone
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
    loaded_orders = 0
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
        include_fulfillments = str(request.GET.get("includeFulfillments") or "").strip().lower() in {"1", "true", "yes"}
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
                    _get_allowed_warehouse_ids_for_staff(staff_user_id)
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
                # Include direct warehouse-bound orders and split-allocation orders
                # whose stock reservations belong to this warehouse.
                reserved_order_ids = list(
                    OrderItem.objects.filter(
                        id__in=InventoryTransaction.objects.filter(
                            reference_type="order_item_reserve",
                            type="RESERVE",
                            warehouse_id__in=list(allowed_warehouse_ids),
                        ).values_list("reference_id", flat=True)
                    ).values_list("order_id", flat=True)
                )
                where &= (
                    Q(warehouse_id__in=list(allowed_warehouse_ids))
                    | Q(id__in=reserved_order_ids)
                )
        if request.GET.get("status"):
            where &= Q(status=_normalize_order_status(request.GET.get("status")))
        if updated_after:
            where &= Q(updated_at__gt=updated_after)
        s = str(request.GET.get("search", "")).strip()
        if s:
            where &= Q(order_number__icontains=s) | Q(customer__name__icontains=s)
        # POS receipts belong to the retail transaction history, not the regular order workflow.
        orders_qs = Order.objects.select_related("customer", "timeline").filter(where).exclude(
            sales_channel=SalesChannel.RETAIL_POS
        )
        if include_items != "none":
            # Serializer-only attributes keep item and component hydration to two batched queries.
            serialized_components = Prefetch(
                "mixed_case_components",
                queryset=MixedCaseComponent.objects.select_related("product").order_by("created_at", "id"),
                to_attr="_serialized_mixed_case_components",
            )
            serialized_items = Prefetch(
                "items",
                queryset=OrderItem.objects.select_related("product").prefetch_related(serialized_components),
                to_attr="_serialized_order_items",
            )
            orders_qs = orders_qs.prefetch_related(serialized_items)
        order_by_field = "-updated_at" if sort in {"updated", "updated_at"} else "-created_at"
        oqs = _real_orders(orders_qs).order_by(order_by_field)
        total = oqs.count() if include_orders else 0
        orders = list(oqs[off : off + size]) if include_orders else []
        order_ids = [str(getattr(order, "id", "") or "").strip() for order in orders]
        warehouse_ids = {str(getattr(order, "warehouse_id", "") or "").strip() for order in orders if str(getattr(order, "warehouse_id", "") or "").strip()}
        warehouse_lookup = {warehouse.id: warehouse for warehouse in Warehouse.objects.filter(id__in=warehouse_ids)} if warehouse_ids else {}
        assigned_trip_map = _build_assigned_trip_map(order_ids, require_driver=True)
        fulfillment_legs_map = _build_order_fulfillment_legs_map(order_ids) if include_fulfillments else {}
        warehouse_allocations_map = _build_order_warehouse_allocations_map(order_ids)
        item_warehouse_allocations_map = _build_order_item_warehouse_allocations_map(order_ids)
        item_trip_assignments_map = _build_order_item_trip_assignments_map(order_ids)
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
                fulfillment_legs=fulfillment_legs_map.get(str(getattr(o, "id", "") or "").strip()) if include_fulfillments else None,
                warehouse_allocations=warehouse_allocations_map.get(str(getattr(o, "id", "") or "").strip(), []),
                item_warehouse_allocations=item_warehouse_allocations_map.get(str(getattr(o, "id", "") or "").strip(), {}),
                item_trip_assignments=item_trip_assignments_map.get(str(getattr(o, "id", "") or "").strip(), {}),
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
        request_id = str(body.get("requestId") or "").strip()
        if request_id:
            existing_order = (
                Order.objects.select_related("customer", "timeline")
                .prefetch_related("items__product", "items__mixed_case_components__product")
                .filter(customer=customer, request_id=request_id)
                .first()
            )
            if existing_order:
                return _ok({"success": True, "duplicate": True, "order": _serialize_order(existing_order)})
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
            # Mixed cases do not have a parent productId; use the component-aware server normalizer.
            normalized_items, normalized_subtotal = normalize_checkout_items(items)
            subtotal = float(normalized_subtotal)
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
        return _ok({"success": True, "duplicate": False, "order": _serialize_order(order)}, 201)
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
    allowed_schedule_targets = {ReplacementStatus.APPROVED, ReplacementStatus.IN_PROGRESS}
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
        try:
            replacement_order = _create_scheduled_replacement_order(
                r,
                scheduled_date=replacement_delivery_date,
                staff_user_id=str(staff.get("userId") or "").strip() or None,
            )
        except ValueError as e:
            return _err(str(e), 400)
        except Exception:
            logger.exception("Failed to schedule replacement delivery for %s", r.id)
            return _err("Unable to schedule replacement delivery right now", 500)
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
    legs_map = _build_order_fulfillment_legs_map([str(o.id)])
    warehouse_allocations_map = _build_order_warehouse_allocations_map([str(o.id)])
    item_warehouse_allocations_map = _build_order_item_warehouse_allocations_map([str(o.id)])
    item_trip_assignments_map = _build_order_item_trip_assignments_map([str(o.id)])
    return _ok(
        {
            "success": True,
            "order": _serialize_order(
                o,
                include_progress=True,
                fulfillment_legs=legs_map.get(str(o.id), []),
                warehouse_allocations=warehouse_allocations_map.get(str(o.id), []),
                item_warehouse_allocations=item_warehouse_allocations_map.get(str(o.id), {}),
                item_trip_assignments=item_trip_assignments_map.get(str(o.id), {}),
            ),
        }
    )


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
    is_pending_request = str(o.request_status or "").strip().upper() == PurchaseRequestStatus.PENDING_APPROVAL
    repairs_missing_approval = (
        next_status == OrderStatus.CONFIRMED
        and (is_pending_request or not str(o.purchase_order_number or "").strip())
    )

    if current_status == next_status and not repairs_missing_approval:
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
    if current_status != next_status and next_status not in allowed_transitions.get(current_status, set()):
        return _err(f"Invalid transition from {current_status} to {next_status}", 400)

    staff_role = str(staff.get("role") or "").strip().upper()
    if (is_pending_request or current_status == OrderStatus.PENDING) and next_status == OrderStatus.CONFIRMED:
        if staff_role != RoleType.WAREHOUSE_STAFF:
            return _err("Only warehouse staff can approve purchase requests", 403)

    # Pending requests must go through approval before any PO fulfillment stage.
    if is_pending_request and next_status not in {
        OrderStatus.CONFIRMED,
        OrderStatus.REJECTED,
        OrderStatus.CANCELLED,
    }:
        return _err("Purchase request must be approved before processing", 400)

    if is_pending_request and next_status == OrderStatus.REJECTED and not rejection_reason:
        return _err("A rejection reason is required", 400)

    try:
        with transaction.atomic():
            # Fix: lock and update the PR workflow together with the order status so approval creates one PO.
            o = Order.objects.select_for_update().get(id=order_id)
            now = timezone.now()
            actor_id = str(staff.get("userId") or "").strip()
            actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
            if next_status == OrderStatus.DELIVERED:
                _finalize_order_inventory_on_delivery(o, staff.get("userId"))
                from .deposit_lifecycle import finalize_order_deposits_on_delivery
                finalize_order_deposits_on_delivery(o, staff.get("userId"))
            elif next_status in {OrderStatus.CANCELLED, OrderStatus.REJECTED}:
                _release_order_reservations(o, staff.get("userId"))

            o.status = next_status
            update_fields = ["status", "updated_at"]

            if next_status == OrderStatus.CONFIRMED:
                if not str(o.purchase_request_number or "").strip():
                    o.purchase_request_number = _generate_next_purchase_workflow_number("purchase_request_number", "PR")
                    update_fields.append("purchase_request_number")
                if not str(o.purchase_order_number or "").strip():
                    o.purchase_order_number = _generate_next_purchase_workflow_number("purchase_order_number", "PO")
                    update_fields.append("purchase_order_number")
                o.order_number = o.purchase_order_number
                update_fields.append("order_number")
                o.request_status = PurchaseRequestStatus.APPROVED
                o.purchase_order_stage = PurchaseOrderStage.APPROVED
                o.approved_by_user_id = actor_id
                o.approved_by_name = actor_name
                o.approved_at = now
                update_fields.extend(["request_status", "purchase_order_stage", "approved_by_user_id", "approved_by_name", "approved_at"])
            elif is_pending_request and next_status == OrderStatus.REJECTED:
                # Keep rejected requests as PR records without creating a PO stage.
                o.request_status = PurchaseRequestStatus.REJECTED
                o.purchase_order_stage = None
                o.rejected_by_user_id = actor_id
                o.rejected_by_name = actor_name
                o.rejection_reason = rejection_reason
                o.rejected_at = now
                update_fields.extend(["request_status", "purchase_order_stage", "rejected_by_user_id", "rejected_by_name", "rejection_reason", "rejected_at"])
            elif is_pending_request and next_status == OrderStatus.CANCELLED:
                # Keep cancelled requests as PR records without creating a PO stage.
                o.request_status = PurchaseRequestStatus.CANCELLED
                o.purchase_order_stage = None
                o.cancelled_by_user_id = actor_id
                o.cancelled_by_name = actor_name
                o.cancellation_reason = rejection_reason or "Cancelled by warehouse staff"
                o.cancelled_at = now
                update_fields.extend(["request_status", "purchase_order_stage", "cancelled_by_user_id", "cancelled_by_name", "cancellation_reason", "cancelled_at"])
            elif next_status == OrderStatus.PREPARING:
                o.purchase_order_stage = PurchaseOrderStage.PROCESSING
                update_fields.append("purchase_order_stage")
            elif next_status in {OrderStatus.OUT_FOR_DELIVERY, OrderStatus.RESCHEDULED}:
                o.purchase_order_stage = PurchaseOrderStage.OUT_FOR_DELIVERY
                update_fields.append("purchase_order_stage")
            elif next_status == OrderStatus.DELIVERED:
                o.purchase_order_stage = PurchaseOrderStage.DELIVERED
                update_fields.append("purchase_order_stage")
            elif next_status == OrderStatus.CANCELLED:
                o.purchase_order_stage = PurchaseOrderStage.CANCELLED
                o.cancelled_by_user_id = actor_id
                o.cancelled_by_name = actor_name
                o.cancellation_reason = rejection_reason or "Cancelled by warehouse staff"
                o.cancelled_at = now
                update_fields.extend(["purchase_order_stage", "cancelled_by_user_id", "cancelled_by_name", "cancellation_reason", "cancelled_at"])
            elif next_status == OrderStatus.REJECTED:
                o.purchase_order_stage = PurchaseOrderStage.CANCELLED
                o.rejected_by_user_id = actor_id
                o.rejected_by_name = actor_name
                o.rejection_reason = rejection_reason
                o.rejected_at = now
                update_fields.extend(["purchase_order_stage", "rejected_by_user_id", "rejected_by_name", "rejection_reason", "rejected_at"])

            if rejection_reason:
                existing_notes = str(getattr(o, "notes", "") or "").strip()
                note_line = f"Order Note: {rejection_reason}"
                o.notes = f"{existing_notes}\n{note_line}".strip() if existing_notes else note_line
                update_fields.append("notes")
            o.save(update_fields=list(dict.fromkeys(update_fields)))

            timeline, _ = OrderTimeline.objects.get_or_create(order=o)
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

    if next_status == OrderStatus.CONFIRMED:
        pr_number = str(updated.purchase_request_number or updated.order_number or "").strip()
        po_number = str(updated.purchase_order_number or updated.order_number or "").strip()
        # Approval keeps the PR identity while telling the customer which PO was created.
        _create_customer_notification(
            customer=updated.customer,
            title="Purchase request approved",
            message=f"Your purchase request {pr_number} was approved as purchase order {po_number}.",
            notification_type="ORDER",
            reference_type="order",
            reference_id=updated.id,
        )
    elif next_status == OrderStatus.DELIVERED:
        # Direct staff delivery updates do not pass through _mark_order_delivered.
        _create_customer_notification(
            customer=updated.customer,
            title="Order delivered",
            message=f"Your order {updated.order_number} has been delivered successfully.",
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
                _get_allowed_warehouse_ids_for_staff(staff_user_id)
            )
            if not allowed_warehouse_ids:
                return _ok({"success": True, "trips": [], "total": 0, "page": page, "pageSize": size, "totalPages": 0})
            # Show trips directly tied to the staff's warehouse assignments
            # and trips that carry orders allocated to those same warehouses.
            reserved_order_ids = list(
                OrderItem.objects.filter(
                    id__in=InventoryTransaction.objects.filter(
                        reference_type="order_item_reserve",
                        type="RESERVE",
                        warehouse_id__in=list(allowed_warehouse_ids),
                    ).values_list("reference_id", flat=True)
                ).values_list("order_id", flat=True)
            )
            qs = qs.filter(
                Q(warehouse_id__in=list(allowed_warehouse_ids))
                | Q(drop_points__order_id__in=reserved_order_ids)
            ).distinct()
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
                # Only expose a location when its owner matches the trip's driver account.
                LocationLog.objects.filter(
                    trip_id__in=trip_ids,
                    driver_id=F("trip__driver_id"),
                )
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
    missing_driver_fields = _missing_driver_profile_fields(driver)
    if missing_driver_fields:
        return _err(
            "Driver cannot be assigned to trip because driver's license is not yet verified or filled out. Missing/Invalid: " + ", ".join(missing_driver_fields),
            400,
        )
    requested_order_ids = [str(oid) for oid in (body.get("orderIds") or []) if str(oid).strip()]
    requested_warehouse_id = str(body.get("warehouseId") or "").strip()
    if not requested_warehouse_id:
        return _err("warehouseId is required", 400)

    staff_role = str(staff.get("role") or "").strip().upper()
    staff_user_id = str(staff.get("userId") or "").strip()
    if staff_role != "WAREHOUSE_STAFF":
        return _err("Only warehouse staff can create trips", 403)
    if staff_role == "WAREHOUSE_STAFF" and staff_user_id:
        allowed_warehouse_ids = set(
            _get_allowed_warehouse_ids_for_staff(staff_user_id)
        )
        if requested_warehouse_id not in allowed_warehouse_ids:
            return _err("Forbidden: trip warehouse is outside your assigned warehouse scope", 403)

    orders_to_assign = list(
        Order.objects.filter(id__in=requested_order_ids).prefetch_related("items__product").all()
    )
    orders_by_id = {str(order.id): order for order in orders_to_assign}
    missing_order_ids = [oid for oid in requested_order_ids if oid not in orders_by_id]
    if missing_order_ids:
        return _err("Some orders were not found", 404)

    order_allocations_map = _build_order_warehouse_allocations_map(requested_order_ids)
    incompatible_orders: list[str] = []
    for order_id in requested_order_ids:
        order = orders_by_id.get(order_id)
        if not order:
            continue
        allowed_order_warehouse_ids = set()
        direct_order_warehouse_id = str(getattr(order, "warehouse_id", "") or "").strip()
        if direct_order_warehouse_id:
            allowed_order_warehouse_ids.add(direct_order_warehouse_id)
        for allocation in order_allocations_map.get(order_id, []):
            wid = str((allocation or {}).get("warehouseId") or "").strip()
            if wid:
                allowed_order_warehouse_ids.add(wid)

        # Enforce warehouse-leg correctness for split orders and direct-bound orders.
        # Orders with no warehouse binding at all are not eligible for trip assignment.
        if not allowed_order_warehouse_ids or requested_warehouse_id not in allowed_order_warehouse_ids:
            incompatible_orders.append(str(getattr(order, "order_number", order_id)))

    if incompatible_orders:
        return _err(
            "Order(s) are not allocated to the selected warehouse: " + ", ".join(incompatible_orders),
            400,
        )
    active_assignment_statuses = ["PENDING", "ARRIVED", "IN_TRANSIT", "IN_PROGRESS"]
    already_assigned_order_ids = set(
        TripDropPoint.objects.filter(
            order_id__in=requested_order_ids,
            status__in=active_assignment_statuses,
        ).values_list("order_id", flat=True)
    )
    if already_assigned_order_ids:
        assigned_orders = list(
            Order.objects.filter(id__in=already_assigned_order_ids).values_list("order_number", flat=True)
        )
        return _err(
            f"Order(s) already assigned to a trip: {', '.join(assigned_orders or sorted(already_assigned_order_ids))}",
            400,
        )

    # Validate vehicle capacity (80% limit)
    vehicle_capacity = float(vehicle.capacity or 0)
    if vehicle_capacity > 0:
        max_capacity_allowed = vehicle_capacity * 0.8  # 80% of capacity
        current_vehicle_usage = _get_vehicle_capacity_usage(vehicle.id)

        # Calculate weight of new orders being assigned
        new_orders_weight = 0.0
        for order in orders_to_assign:
            new_orders_weight += _calculate_order_weight(order)

        total_weight_after_assignment = current_vehicle_usage + new_orders_weight

        if total_weight_after_assignment > max_capacity_allowed:
            return _err(
                (
                    f"Vehicle capacity limit reached. Total assigned weight would be "
                    f"{total_weight_after_assignment:.2f} kg, but only up to 80% of capacity is allowed "
                    f"({max_capacity_allowed:.2f} kg of {vehicle_capacity:.2f} kg)."
                ),
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
                    warehouse_id=requested_warehouse_id,
                    created_by_user_id=staff_user_id or None,
                    status=body.get("status") or TripStatus.PLANNED,
                    planned_start_at=planned_start_at,
                    notes=body.get("notes"),
                )
                seq = 1
                for oid in requested_order_ids:
                    order = orders_by_id.get(str(oid))
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
                _assign_order_items_to_trip_for_warehouse(
                    trip=trip,
                    order_ids=requested_order_ids,
                    warehouse_id=requested_warehouse_id,
                    performed_by=staff_user_id or None,
                )
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
    # Send the assignment directly to the driver who owns this trip.
    _create_user_notification(
        user=trip.driver,
        title="New trip assigned",
        message=f"You were assigned to trip {trip.trip_number} with {trip.total_drop_points} delivery stop(s).",
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
        assign_warehouse_legs = bool(body.get("assignWarehouseLegs"))
        assign_warehouse_id = str(body.get("assignWarehouseId") or "").strip()
        requested_driver_id = str(body.get("driverId") or "").strip()
        requested_vehicle_id = str(body.get("vehicleId") or "").strip()
        driver_change_requested = "driverId" in body or "vehicleId" in body
        driver_changed = False
        next_driver = None
        next_vehicle = None

        if driver_change_requested:
            if not requested_driver_id or not requested_vehicle_id:
                return _err("driverId and vehicleId are required when changing the trip driver", 400)
            try:
                next_driver = User.objects.get(id=requested_driver_id, role=RoleType.DRIVER)
                next_vehicle = Vehicle.objects.get(id=requested_vehicle_id)
            except (User.DoesNotExist, Vehicle.DoesNotExist):
                return _err("Driver or vehicle not found", 404)
            missing_driver_fields = _missing_driver_profile_fields(next_driver)
            if missing_driver_fields:
                return _err(
                    "Selected driver profile is incomplete. Missing: " + ", ".join(missing_driver_fields),
                    400,
                )
            if str(next_vehicle.driver_id or "").strip() != str(next_driver.id or "").strip():
                return _err("Selected vehicle is not assigned to the selected driver", 400)
            driver_changed = (
                str(trip.driver_id or "").strip() != str(next_driver.id or "").strip()
                or str(trip.vehicle_id or "").strip() != str(next_vehicle.id or "").strip()
            )

        if not add_order_ids and not remove_drop_point_ids and not assign_warehouse_legs and not driver_changed:
            return _err("No trip changes provided", 400)

        terminal_drop_point_statuses = {"COMPLETED", "FAILED", "SKIPPED", "CANCELLED"}

        with transaction.atomic():
            existing_drop_points_count = TripDropPoint.objects.select_for_update().filter(trip_id=trip.id).count()
            projected_drop_points_count = existing_drop_points_count - len(remove_drop_point_ids)
            if add_order_ids:
                existing_order_ids_on_trip = set(
                    TripDropPoint.objects.filter(trip_id=trip.id).values_list("order_id", flat=True)
                )
                deduplicated_add_order_ids = {
                    oid for oid in add_order_ids if oid not in existing_order_ids_on_trip
                }
                projected_drop_points_count += len(deduplicated_add_order_ids)

            if projected_drop_points_count <= 0:
                return _err("A trip must keep at least one drop point", 409)

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

            requested_add_order_ids = list(add_order_ids)
            if add_order_ids:
                existing_order_ids_on_trip = set(
                    TripDropPoint.objects.filter(trip_id=trip.id).values_list("order_id", flat=True)
                )
                duplicate_on_trip = [oid for oid in add_order_ids if oid in existing_order_ids_on_trip]
                if duplicate_on_trip and not assign_warehouse_legs:
                    return _err("Some orders are already in this trip", 409)
                add_order_ids = [oid for oid in add_order_ids if oid not in existing_order_ids_on_trip]

                active_assignment_statuses = ["PENDING", "ARRIVED", "IN_TRANSIT", "IN_PROGRESS"]
                already_assigned_order_ids = set(
                    TripDropPoint.objects.filter(
                        order_id__in=add_order_ids,
                        status__in=active_assignment_statuses,
                    )
                    .exclude(trip_id=trip.id)
                    .values_list("order_id", flat=True)
                )
                if already_assigned_order_ids:
                    assigned_orders = list(
                        Order.objects.filter(id__in=already_assigned_order_ids).values_list("order_number", flat=True)
                    )
                    return _err(
                        f"Order(s) already assigned to another trip: {', '.join(assigned_orders or sorted(already_assigned_order_ids))}",
                        400,
                    )

                orders_map = {
                    str(order.id): order
                    for order in Order.objects.select_related("customer").filter(id__in=add_order_ids)
                }
                missing_order_ids = [oid for oid in add_order_ids if oid not in orders_map]
                if missing_order_ids:
                    return _err("Some orders were not found", 404)

                staff_role = str(staff.get("role") or "").strip().upper()
                staff_user_id = str(staff.get("userId") or "").strip()
                if staff_role == "WAREHOUSE_STAFF" and staff_user_id:
                    allowed_warehouse_ids = set(
                        _get_allowed_warehouse_ids_for_staff(staff_user_id)
                    )
                    if not allowed_warehouse_ids:
                        return _err("Forbidden: no warehouse assignment found for this staff", 403)
                    order_allocations_map = _build_order_warehouse_allocations_map(add_order_ids)
                    inaccessible_orders: list[str] = []
                    for order_id in add_order_ids:
                        order = orders_map.get(order_id)
                        if not order:
                            continue
                        order_warehouse_ids = set()
                        direct_order_warehouse_id = str(getattr(order, "warehouse_id", "") or "").strip()
                        if direct_order_warehouse_id:
                            order_warehouse_ids.add(direct_order_warehouse_id)
                        for allocation in order_allocations_map.get(order_id, []):
                            wid = str((allocation or {}).get("warehouseId") or "").strip()
                            if wid:
                                order_warehouse_ids.add(wid)
                        if not order_warehouse_ids.intersection(allowed_warehouse_ids):
                            inaccessible_orders.append(str(getattr(order, "order_number", order_id)))
                    if inaccessible_orders:
                        return _err(
                            "Order(s) are outside your warehouse scope: " + ", ".join(inaccessible_orders),
                            403,
                        )

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

            if assign_warehouse_legs and requested_add_order_ids:
                target_warehouse_id = assign_warehouse_id or str(getattr(trip, "warehouse_id", "") or "").strip()
                if target_warehouse_id:
                    staff_role = str(staff.get("role") or "").strip().upper()
                    staff_user_id = str(staff.get("userId") or "").strip()
                    if staff_role == "WAREHOUSE_STAFF" and staff_user_id:
                        allowed_warehouse_ids = set(_get_allowed_warehouse_ids_for_staff(staff_user_id))
                        if target_warehouse_id not in allowed_warehouse_ids:
                            return _err("Forbidden: cannot assign allocation for this warehouse", 403)
                    _assign_order_items_to_trip_for_warehouse(
                        trip=trip,
                        order_ids=requested_add_order_ids,
                        warehouse_id=target_warehouse_id,
                        performed_by=staff_user_id or None,
                    )

            # Enforce vehicle capacity (80%) on trip edits as well:
            # adding/removing orders and changing driver/vehicle must stay within limit.
            selected_vehicle = next_vehicle if (driver_changed and next_vehicle is not None) else trip.vehicle
            if selected_vehicle:
                vehicle_capacity = float(getattr(selected_vehicle, "capacity", 0) or 0)
                if vehicle_capacity > 0:
                    max_capacity_allowed = vehicle_capacity * 0.8
                    trip_order_ids = list(
                        TripDropPoint.objects.filter(trip_id=trip.id)
                        .exclude(order_id__isnull=True)
                        .values_list("order_id", flat=True)
                        .distinct()
                    )
                    trip_orders = (
                        Order.objects.filter(id__in=trip_order_ids)
                        .prefetch_related("items__product")
                    )
                    trip_total_weight = sum(_calculate_order_weight(order) for order in trip_orders)
                    current_vehicle_usage = _get_vehicle_capacity_usage(selected_vehicle.id)

                    # If trip stays on the same vehicle, usage already includes this trip.
                    # If trip is moved to another vehicle, add this trip weight to that vehicle usage.
                    if str(getattr(trip, "vehicle_id", "") or "").strip() == str(getattr(selected_vehicle, "id", "") or "").strip():
                        total_weight_after_assignment = current_vehicle_usage
                    else:
                        total_weight_after_assignment = current_vehicle_usage + trip_total_weight

                    if total_weight_after_assignment > max_capacity_allowed:
                        return _err(
                            (
                                f"Vehicle capacity limit reached. Total assigned weight would be "
                                f"{total_weight_after_assignment:.2f} kg, but only up to 80% of capacity is allowed "
                                f"({max_capacity_allowed:.2f} kg of {vehicle_capacity:.2f} kg)."
                            ),
                            400,
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
            update_fields = ["total_drop_points", "completed_drop_points", "updated_at"]
            if driver_changed and next_driver and next_vehicle:
                trip.driver = next_driver
                trip.vehicle = next_vehicle
                update_fields.extend(["driver", "vehicle"])
            trip.total_drop_points = total_drop_points
            trip.completed_drop_points = completed_drop_points
            trip.save(update_fields=update_fields)

        actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
        update_summary_parts = [
            f"+{len(add_order_ids)} added",
            f"-{len(remove_drop_point_ids)} removed",
        ]
        if driver_changed and next_driver and next_vehicle:
            next_driver_name = str(getattr(next_driver, "name", "") or "").strip() or "Driver"
            next_vehicle_label = str(getattr(next_vehicle, "license_plate", "") or "").strip() or "vehicle"
            update_summary_parts.append(f"driver changed to {next_driver_name} ({next_vehicle_label})")
        _create_staff_notifications(
            title="Trip updated",
            message=(
                f"{actor_name} updated trip {trip.trip_number}: "
                + ", ".join(update_summary_parts)
                + "."
            ),
            notification_type="TRIP",
            reference_type="trip",
            reference_id=trip.id,
        )
        if driver_changed and next_driver:
            # Notify only the newly assigned driver when trip ownership changes.
            _create_user_notification(
                user=next_driver,
                title="Trip assigned to you",
                message=f"You were assigned to trip {trip.trip_number}.",
                notification_type="TRIP",
                reference_type="trip",
                reference_id=trip.id,
            )
        trip = Trip.objects.select_related("driver", "vehicle").prefetch_related("drop_points__order").get(id=trip.id)
        return _ok({"success": True, "trip": _serialize_trip(trip)})

    if str(trip.status or "").upper() != TripStatus.PLANNED:
        return _err("Only planned trips can be deleted", 409)

    trip_number = trip.trip_number

    try:
        # Explicitly delete related objects first to ensure clean deletion
        with transaction.atomic():
            # Delete drop points
            TripDropPoint.objects.filter(trip_id=trip.id).delete()
            # "stops" alias is backed by TripDropPoint in this codebase.
            TripDropPoint.objects.filter(trip_id=trip.id).delete()
            # Delete location logs
            LocationLog.objects.filter(trip_id=trip.id).delete()
            # Delete inventory transactions related to this trip
            InventoryTransaction.objects.filter(
                reference_type="order_item_trip_assign",
                notes__icontains=f'"tripId":"{trip.id}"'
            ).delete()
            # Finally delete the trip
            trip.delete()
    except ProtectedError:
        return _err("Trip cannot be deleted because it is referenced by protected records", 409)
    except Exception as exc:
        return _err(f"Trip delete failed: {str(exc)}", 500)
    
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
def trip_check(request: HttpRequest, trip_number: str) -> JsonResponse:
    """Check if a trip exists and return its details."""
    staff, err = _require_staff(request)
    if err:
        return err
    
    trip = Trip.objects.filter(trip_number=trip_number).first()
    if not trip:
        return _ok({"exists": False, "message": f"Trip {trip_number} not found"})
    
    # Count related objects
    drop_points_count = TripDropPoint.objects.filter(trip_id=trip.id).count()
    # "stops" alias is backed by TripDropPoint in this codebase.
    stops_count = TripDropPoint.objects.filter(trip_id=trip.id).count()
    location_logs_count = LocationLog.objects.filter(trip_id=trip.id).count()
    
    return _ok({
        "exists": True,
        "trip": {
            "id": trip.id,
            "tripNumber": trip.trip_number,
            "status": trip.status,
            "driverId": trip.driver_id,
            "vehicleId": trip.vehicle_id,
            "warehouseId": trip.warehouse_id,
        },
        "relatedCounts": {
            "dropPoints": drop_points_count,
            "stops": stops_count,
            "locationLogs": location_logs_count,
        }
    })


@csrf_exempt
@require_http_methods(["POST"])
def trip_unassign_items(request: HttpRequest, trip_id: str) -> JsonResponse:
    """Unassign order items from a trip for a specific warehouse."""
    staff, err = _require_staff(request)
    if err:
        return err

    trip = Trip.objects.filter(id=trip_id).first()
    if not trip:
        return _err("Trip not found", 404)

    if str(trip.status or "").upper() != TripStatus.PLANNED:
        return _err("Only planned trips can be modified", 409)

    body = _json_body(request)
    order_id = str(body.get("orderId") or "").strip()
    warehouse_id = str(body.get("warehouseId") or "").strip()
    item_ids = [str(iid).strip() for iid in (body.get("itemIds") or []) if str(iid).strip()]

    if not order_id:
        return _err("orderId is required", 400)
    if not warehouse_id:
        return _err("warehouseId is required", 400)
    if not item_ids:
        return _err("itemIds is required", 400)

    # Verify the order is in this trip
    drop_point = TripDropPoint.objects.filter(trip_id=trip.id, order_id=order_id).first()
    if not drop_point:
        return _err("Order not found in this trip", 404)

    # Delete the ASSIGN transactions for these items
    deleted_count = 0
    with transaction.atomic():
        for item_id in item_ids:
            txs = InventoryTransaction.objects.filter(
                reference_type="order_item_trip_assign",
                reference_id=item_id,
                type="ASSIGN",
                warehouse_id=warehouse_id,
            ).filter(notes__icontains=f'"tripId":"{trip_id}"')
            deleted_count += txs.count()
            txs.delete()

    return _ok({
        "success": True,
        "message": f"Unassigned {deleted_count} items from trip",
        "deletedCount": deleted_count,
    })


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
    # Preserve the driver's last reliable fix even if it was recorded between trip links.
    latest_driver_log = LocationLog.objects.filter(driver=d).order_by("-recorded_at", "-id").first()
    if trip_ids:
        # Keep every returned fix scoped to the authenticated driver's account.
        logs = LocationLog.objects.filter(driver=d, trip_id__in=trip_ids).order_by("trip_id", "-recorded_at")
        for log in logs:
            if not log.trip_id:
                continue
            if log.trip_id not in latest_log_by_trip:
                latest_log_by_trip[log.trip_id] = log

    payload_rows: list[dict[str, Any]] = []
    for trip in rows:
        row = _serialize_trip(trip)
        latest_log = latest_log_by_trip.get(trip.id) or latest_driver_log
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
        now = timezone.now()
        actor_name = str((o.customer.name if getattr(o, "customer", None) else None) or "Customer").strip() or "Customer"
        o.status = OrderStatus.CANCELLED
        o.request_status = PurchaseRequestStatus.CANCELLED
        o.purchase_order_stage = PurchaseOrderStage.CANCELLED
        o.cancelled_by_user_id = str(p.get("userId") or "").strip() or None
        o.cancelled_by_name = actor_name
        o.cancellation_reason = "Cancelled by customer"
        o.cancelled_at = now
        o.save(update_fields=[
            "status",
            "request_status",
            "purchase_order_stage",
            "cancelled_by_user_id",
            "cancelled_by_name",
            "cancellation_reason",
            "cancelled_at",
            "updated_at",
        ])
        timeline, _ = OrderTimeline.objects.get_or_create(order=o)
        timeline.cancelled_at = now
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
                _get_allowed_warehouse_ids_for_staff(staff_user_id)
            )
            if not allowed_warehouse_ids:
                return _ok({"success": True, "replacements": [], "total": 0, "page": page, "pageSize": size, "totalPages": 0})
            qs = qs.filter(order__warehouse_id__in=list(allowed_warehouse_ids))
    else:
        return _err("Forbidden", 403)

    qs = qs.filter(replacement_mode="CUSTOMER_SUBMITTED")

    warehouse_id = str(request.GET.get("warehouseId") or "").strip()
    if warehouse_id:
        if p.get("type") == "staff":
            staff_role = str(p.get("role") or "").strip().upper()
            if staff_role == "WAREHOUSE_STAFF":
                allowed_warehouse_ids = set(
                    _get_allowed_warehouse_ids_for_staff(str(p.get("userId") or "").strip())
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
        Order.objects.select_related("customer", "timeline")
        .prefetch_related("items__product")
        .filter(id=order_id, customer_id=p.get("userId"))
        .first()
    )
    if not order:
        return _err("Order not found", 404)

    normalized_order_status = _normalize_order_status(getattr(order, "status", None))
    if normalized_order_status != OrderStatus.DELIVERED:
        return _err("Replacement request is only allowed for delivered orders", 400)

    delivered_at = getattr(getattr(order, "timeline", None), "delivered_at", None)
    if delivered_at is None:
        delivered_at = getattr(order, "updated_at", None) or getattr(order, "created_at", None)
    if delivered_at is not None and timezone.now() > (delivered_at + timedelta(days=3)):
        return _err("Replacement request is only allowed within 3 days after delivery", 400)

    existing_customer_replacements = (
        Replacement.objects.filter(order_id=order.id, customer_id=order.customer_id, replacement_mode="CUSTOMER_SUBMITTED")
        .only("id", "status", "replacement_mode", "notes")
    )
    for existing in existing_customer_replacements:
        normalized_existing_status = _normalize_replacement_status(existing.status, existing.replacement_mode)
        if normalized_existing_status in {
            ReplacementStatus.REJECTED,
            ReplacementStatus.COMPLETED,
            ReplacementStatus.RESOLVED_ON_DELIVERY,
        }:
            return _err(
                "You cannot request another replacement for this order after a rejected or completed replacement case",
                400,
            )
        if _is_linked_replacement_order_delivered(existing):
            return _err(
                "You cannot request another replacement for this order after a rejected or completed replacement case",
                400,
            )

    order_items = list(order.items.select_related("product").all())
    order_items_by_id = {
        str(getattr(item, "id", "") or "").strip(): item
        for item in order_items
        if str(getattr(item, "id", "") or "").strip()
    }

    replacement_lines_input = body.get("replacementLines") if isinstance(body.get("replacementLines"), list) else []
    replacement_lines: list[dict[str, Any]] = []
    if replacement_lines_input:
        merged_lines_by_item_id: dict[str, dict[str, Any]] = {}
        for raw_line in replacement_lines_input:
            if not isinstance(raw_line, dict):
                continue
            original_order_item_id = str(
                raw_line.get("originalOrderItemId")
                or raw_line.get("productId")
                or raw_line.get("orderItemId")
                or ""
            ).strip()
            source_item = order_items_by_id.get(original_order_item_id)
            if not source_item:
                return _err("Each replacement line must reference a valid product from the order", 400)

            product = getattr(source_item, "product", None)
            quantity_per_case = max(
                1,
                _int(
                    raw_line.get("quantityPerCase"),
                    _int(
                        raw_line.get("qtyPerUnit"),
                        _int(getattr(product, "quantity_per_unit", 0), 1),
                    ),
                ),
            )
            input_mode = str(raw_line.get("inputMode") or raw_line.get("lineInputMode") or "").strip().lower()
            quantity_to_replace = max(0, _int(raw_line.get("quantityToReplace"), 0))
            quantity_to_replace_cases = max(
                0,
                _int(
                    raw_line.get("quantityToReplaceCases"),
                    _int(raw_line.get("quantityToReplaceUnits"), 0),
                ),
            )
            quantity_to_replace_bottles = max(0, _int(raw_line.get("quantityToReplaceBottles"), 0))

            if input_mode == "case":
                if quantity_to_replace_cases <= 0 and quantity_to_replace > 0 and quantity_per_case > 0:
                    quantity_to_replace_cases = max(1, quantity_to_replace // quantity_per_case)
                if quantity_to_replace <= 0 and quantity_to_replace_cases > 0:
                    quantity_to_replace = quantity_to_replace_cases * quantity_per_case
            else:
                input_mode = "bottle"
                if quantity_to_replace_bottles <= 0 and quantity_to_replace > 0:
                    quantity_to_replace_bottles = quantity_to_replace
                if quantity_to_replace <= 0 and quantity_to_replace_bottles > 0:
                    quantity_to_replace = quantity_to_replace_bottles

            if quantity_to_replace <= 0:
                return _err("Each replacement line must have quantity greater than zero", 400)

            reason = str(raw_line.get("reason") or body.get("damageType") or body.get("reason") or "").strip()
            if not reason:
                return _err("Each replacement line must include a reason", 400)
            description = str(raw_line.get("description") or "").strip()
            original_product_name = str(
                getattr(product, "name", "")
                or getattr(source_item, "product_name", "")
                or raw_line.get("originalProductName")
                or ""
            ).strip() or "Product"
            original_product_sku = str(
                getattr(product, "sku", "")
                or getattr(source_item, "product_sku", "")
                or raw_line.get("originalProductSku")
                or ""
            ).strip() or None
            original_product_size = _get_product_size_label(product) or str(raw_line.get("originalProductSize") or "").strip() or None
            replacement_product_id = str(
                raw_line.get("replacementProductId")
                or getattr(source_item, "product_id", "")
                or ""
            ).strip() or None

            next_line = {
                "originalOrderItemId": source_item.id,
                "originalProductId": str(getattr(source_item, "product_id", "") or "").strip() or None,
                "originalProductName": original_product_name,
                "originalProductSku": original_product_sku,
                "originalProductSize": original_product_size,
                "replacementProductId": replacement_product_id,
                "replacementProductName": original_product_name,
                "replacementProductSku": original_product_sku,
                "replacementProductSize": original_product_size,
                "replacementProductUnit": str(getattr(product, "unit", "") or "").strip() or None,
                "lineInputMode": input_mode,
                "replacementInputMode": input_mode,
                "quantityPerCase": quantity_per_case,
                "qtyPerUnit": quantity_per_case,
                "quantityToReplace": quantity_to_replace,
                "quantityReplaced": 0,
                "remainingQuantity": quantity_to_replace,
                "reason": reason,
                "description": description or None,
            }
            if input_mode == "case":
                next_line["quantityToReplaceCases"] = quantity_to_replace_cases
                next_line["quantityToReplaceUnits"] = quantity_to_replace_cases
            else:
                next_line["quantityToReplaceBottles"] = quantity_to_replace_bottles

            existing_line = merged_lines_by_item_id.get(source_item.id)
            if existing_line:
                existing_line["quantityToReplace"] = max(0, _int(existing_line.get("quantityToReplace"), 0)) + quantity_to_replace
                existing_line["remainingQuantity"] = existing_line["quantityToReplace"]
                if input_mode == "case":
                    existing_line["quantityToReplaceCases"] = max(0, _int(existing_line.get("quantityToReplaceCases"), 0)) + quantity_to_replace_cases
                    existing_line["quantityToReplaceUnits"] = existing_line["quantityToReplaceCases"]
                else:
                    existing_line["quantityToReplaceBottles"] = max(0, _int(existing_line.get("quantityToReplaceBottles"), 0)) + quantity_to_replace_bottles
                if reason and reason not in str(existing_line.get("reason") or ""):
                    existing_line["reason"] = f"{existing_line['reason']}; {reason}"
                if description:
                    previous_description = str(existing_line.get("description") or "").strip()
                    if description not in previous_description:
                        existing_line["description"] = f"{previous_description}; {description}".strip("; ")
            else:
                merged_lines_by_item_id[source_item.id] = next_line

        replacement_lines = list(merged_lines_by_item_id.values())
        if not replacement_lines:
            return _err("At least one valid replacement line is required", 400)

    number_damaged_items = max(
        0,
        _int(
            body.get("numberDamagedItems"),
            sum(max(0, _int(line.get("quantityToReplace"), 0)) for line in replacement_lines),
        ),
    )
    if number_damaged_items <= 0:
        return _err("numberDamagedItems must be greater than zero", 400)
    damage_type = str(body.get("damageType") or body.get("reason") or "").strip()
    if not damage_type and replacement_lines:
        unique_reasons = [str(line.get("reason") or "").strip() for line in replacement_lines if str(line.get("reason") or "").strip()]
        unique_reasons = list(dict.fromkeys(unique_reasons))
        if len(unique_reasons) == 1:
            damage_type = unique_reasons[0]
        elif len(unique_reasons) > 1:
            damage_type = "Multiple issues"
    if not damage_type:
        return _err("reason/type of damage is required", 400)
    evidence_list_raw = body.get("evidence") if isinstance(body.get("evidence"), list) else []
    evidence_list = [str(item).strip() for item in evidence_list_raw if str(item).strip()]
    primary_evidence = str(body.get("evidencePrimary") or body.get("damagePhoto") or "").strip()
    if primary_evidence and primary_evidence not in evidence_list:
        evidence_list.insert(0, primary_evidence)
    if not evidence_list:
        return _err("At least one evidence file is required", 400)

    if Replacement.objects.filter(order=order, status__in=[ReplacementStatus.COMPLETED, ReplacementStatus.RESOLVED_ON_DELIVERY]).exists():
        return _err("A replacement request is already completed for this order", 400)

    count = Replacement.objects.count() + 1
    now = timezone.now()
    if replacement_lines:
        product_summaries = []
        for line in replacement_lines:
            product_name = str(line.get("originalProductName") or "Product").strip()
            quantity_text = str(line.get("quantityToReplace") or "0").strip()
            reason_text = str(line.get("reason") or damage_type).strip()
            line_detail = str(line.get("description") or "").strip()
            summary = f"[{product_name}] qty {quantity_text}. Reason: {reason_text}"
            if line_detail:
                summary = f"{summary}. {line_detail}"
            product_summaries.append(summary)
        description_text = str(body.get("description") or "").strip() or "; ".join(product_summaries)
    else:
        description_text = str(body.get("description") or "Customer replacement request").strip() or "Customer replacement request"

    meta = {
        "submittedBy": "CUSTOMER",
        "submittedAt": now.isoformat(),
        "numberDamagedItems": number_damaged_items,
        "damageType": damage_type,
        "evidence": evidence_list,
        "damagePhotos": evidence_list,
        "quantityToReplace": number_damaged_items,
        "quantityReplaced": 0,
        "statusTimeline": [
            {"status": ReplacementStatus.PENDING, "at": now.isoformat(), "by": str(order.customer_id)},
        ],
    }
    if replacement_lines:
        meta["replacementLines"] = replacement_lines
        meta["replacementItems"] = replacement_lines
    replacement = Replacement.objects.create(
        replacement_number=f"RPL-{timezone.now().year}-{str(count).zfill(4)}",
        order=order,
        customer_id=order.customer_id,
        reason=damage_type,
        description=description_text,
        status=ReplacementStatus.PENDING,
        requested_by="CUSTOMER",
        replacement_mode="CUSTOMER_SUBMITTED",
        replacement_quantity=number_damaged_items,
        original_order_item_id=str(replacement_lines[0].get("originalOrderItemId") or "").strip() or None if replacement_lines else None,
        replacement_product_id=str(replacement_lines[0].get("replacementProductId") or "").strip() or None if replacement_lines else None,
        damage_photo_url=evidence_list[0],
        damage_photo_urls=json.dumps(evidence_list),
        notes=f"Customer-submitted replacement request\nMeta: {json.dumps(meta)}",
    )
    customer_name = str(getattr(order.customer, "name", "") or "Customer").strip()
    if replacement_lines:
        product_names = list(
            dict.fromkeys(
                str(line.get("originalProductName") or "").strip()
                for line in replacement_lines
                if str(line.get("originalProductName") or "").strip()
            )
        )
        product_hint = ", ".join(product_names[:3]) if product_names else "N/A"
        if len(product_names) > 3:
            product_hint = f"{product_hint} +{len(product_names) - 3} more"
    else:
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
        # Ignore malformed legacy rows whose owner does not match the assigned trip driver.
        logs = LocationLog.objects.filter(
            trip_id__in=list(trip_ids),
            driver_id=F("trip__driver_id"),
        ).order_by("trip_id", "-recorded_at")
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
            # Prefer actual GPS speed (m/s → km/h) when available, fall back to 24 km/h.
            raw_driver_speed = _to_float_or_none(getattr(latest_log, "speed", None)) if latest_log else None
            speed_kph = (raw_driver_speed * 3.6) if raw_driver_speed is not None and raw_driver_speed > 0 else 24.0
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
    if lat is None or lng is None or not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
        return _err("Invalid coordinates")
    accuracy = _to_float_or_none(body.get("accuracy"))
    if accuracy is not None and accuracy < 0:
        accuracy = None
    heading = _to_float_or_none(body.get("heading"))
    altitude = _to_float_or_none(body.get("altitude"))
    raw_speed = _to_float_or_none(body.get("speed"))
    gps_speed = raw_speed if raw_speed is not None and 0 <= raw_speed <= 50 else None
    requested_trip_id = str(body.get("tripId") or "").strip()
    active_statuses = {"IN_PROGRESS", "IN_TRANSIT", "OUT_FOR_DELIVERY"}
    active_trip = Trip.objects.filter(driver_id=d.id, status__in=list(active_statuses)).order_by("-updated_at").first()
    trip_id = None
    trip_resolution = "none"
    if requested_trip_id:
        requested_trip = Trip.objects.filter(id=requested_trip_id, driver_id=d.id).first()
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
            log.speed = gps_speed
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
                    "speed",
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
                speed=gps_speed,
                battery=body.get("battery"),
                recorded_at=now,
            )

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
    next_license_number: str | None = None
    for key, attr in [
        ("emergencyContact", "emergency_contact"),
        ("licenseNumber", "license_number"),
        ("licenseType", "license_type"),
        ("licensePhotoUrl", "license_photo_url"),
    ]:
        if key in body:
            next_value = body.get(key)
            if attr == "license_number":
                if next_value:
                    normalized, lic_err = _validate_philippine_driver_license(next_value)
                    if lic_err:
                        return _err(lic_err, 400)
                    next_license_number = normalized
                else:
                    next_license_number = None
                setattr(d, attr, next_license_number)
            elif attr == "license_type":
                normalized_type = str(next_value or "").strip().upper()
                if normalized_type not in DRIVER_RESTRICTIONS:
                    return _err("Restrictions must be one of: A, A1, B, B1, B2, C, D, BE, CE", 400)
                setattr(d, attr, normalized_type or None)
            else:
                setattr(d, attr, next_value)
    if "licenseExpiry" in body and body.get("licenseExpiry"):
        parsed_license_expiry, expiry_error = _validate_future_license_expiry(body.get("licenseExpiry"))
        if expiry_error:
            return _err(expiry_error, 400)
        d.license_expiry = parsed_license_expiry
    if next_license_number:
        duplicate = User.objects.filter(
            role="DRIVER",
            license_number=next_license_number,
        ).exclude(id=d.id).exists()
        if duplicate:
            return _err("License number is already used by another driver", 409)

    if "firstName" in body:
        d.first_name = str(body.get("firstName") or "").strip() or None
    if "middleName" in body:
        d.middle_name = str(body.get("middleName") or "").strip() or None
    if "lastName" in body:
        d.last_name = str(body.get("lastName") or "").strip() or None
    if "suffix" in body:
        d.suffix = str(body.get("suffix") or "").strip() or None

    if any(k in body for k in ("firstName", "middleName", "lastName", "suffix")):
        d.name = _format_display_name(d.first_name, d.middle_name, d.last_name, d.suffix, d.name)
    elif "name" in body:
        d.name = str(body.get("name") or "").strip()

    if "phone" in body:
        normalized_phone = _normalize_philippine_phone(body.get("phone"))
        if not normalized_phone:
            return _err(PHILIPPINE_PHONE_ERROR)
        d.phone = normalized_phone
    if "avatar" in body:
        d.avatar = body.get("avatar")
    if "twoFactorEnabled" in body:
        d.two_factor_enabled = bool(body.get("twoFactorEnabled"))
    if "emailNotificationsEnabled" in body:
        d.email_notifications_enabled = bool(body.get("emailNotificationsEnabled"))
    if "smsNotificationsEnabled" in body:
        d.sms_notifications_enabled = bool(body.get("smsNotificationsEnabled"))
    if "pushNotificationsEnabled" in body:
        d.push_notifications_enabled = bool(body.get("pushNotificationsEnabled"))
    if "loginAlertsEnabled" in body:
        d.login_alerts_enabled = bool(body.get("loginAlertsEnabled"))
    try:
        d.save()
    except IntegrityError:
        return _err("Failed to update profile: duplicate or invalid driver data", 400)
    except Exception:
        logger.exception("Driver profile update failed for user_id=%s", d.id)
        return _err("Failed to update profile", 500)
    row = _serialize_model(d, exclude={"password"})
    row["phone"] = d.phone
    row["user"] = _serialize_model(d, exclude={"password"})
    return _ok({"success": True, "driver": row})


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

        # Do not over-restrict by later global order statuses here; split-warehouse orders can have
        # one leg already moving while another leg still needs trip planning. Still exclude
        # orders that are not yet approved / confirmed for delivery planning.
        route_plan_items = Prefetch(
            "items",
            queryset=OrderItem.objects.select_related("product"),
            to_attr="_route_plan_items",
        )
        oqs = _real_orders(
            Order.objects.select_related("customer", "timeline")
            .prefetch_related(route_plan_items)
            .exclude(
                status__in=[
                    OrderStatus.PENDING,
                    OrderStatus.DELIVERED,
                    OrderStatus.CANCELLED,
                    OrderStatus.REJECTED,
                    "UNAPPROVED",
                ]
            )
        ).order_by("created_at")

        active_drop_points_qs = TripDropPoint.objects.filter(
            status__in=["PENDING", "ARRIVED", "IN_TRANSIT", "IN_PROGRESS"]
        )
        if warehouse_id:
            active_drop_points_qs = active_drop_points_qs.filter(trip__warehouse_id=warehouse_id)
        active_route_order_ids = active_drop_points_qs.values_list("order_id", flat=True)
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

        candidate_orders = list(oqs[:600])
        candidate_order_ids = [str(getattr(order, "id", "") or "").strip() for order in candidate_orders if str(getattr(order, "id", "") or "").strip()]
        allocations_map = _build_order_warehouse_allocations_map(candidate_order_ids) if candidate_order_ids else {}
        item_allocations_map = _build_order_item_warehouse_allocations_map(candidate_order_ids) if candidate_order_ids else {}
        if warehouse_id and candidate_orders:
            warehouse_scoped_candidates = []
            for order in candidate_orders:
                direct_warehouse_id = str(getattr(order, "warehouse_id", "") or "").strip()
                if direct_warehouse_id == warehouse_id:
                    warehouse_scoped_candidates.append(order)
                    continue
                order_allocations = allocations_map.get(str(getattr(order, "id", "") or "").strip(), [])
                has_selected_warehouse_allocation = any(
                    str((allocation or {}).get("warehouseId") or "").strip() == warehouse_id
                    for allocation in order_allocations
                )
                if has_selected_warehouse_allocation:
                    warehouse_scoped_candidates.append(order)
            candidate_orders = warehouse_scoped_candidates

        orders = []
        grouped_by_city: dict[str, list[dict[str, Any]]] = {}
        for o in candidate_orders[:300]:
            # Fix: reuse the batched item list; per-order related queries time out on deployed databases.
            order_items = list(getattr(o, "_route_plan_items", []))
            city = str((o.shipping_city or None) or "Unknown").strip() or "Unknown"
            latitude = _to_float_or_none((o.shipping_latitude or None) or o.customer.latitude)
            longitude = _to_float_or_none((o.shipping_longitude or None) or o.customer.longitude)
            address = str((o.shipping_address or None) or "").strip()
            order_allocations = allocations_map.get(str(getattr(o, "id", "") or "").strip(), [])
            allocated_qty_for_selected_warehouse = 0
            if warehouse_id:
                allocated_qty_for_selected_warehouse = sum(
                    max(_int((allocation or {}).get("allocatedQty"), 0), 0)
                    for allocation in order_allocations
                    if str((allocation or {}).get("warehouseId") or "").strip() == warehouse_id
                )
            total_order_qty = sum(max(_int(item.quantity, 0), 0) for item in order_items)
            product_allocations: list[dict[str, Any]] = []
            for item in order_items:
                item_id = str(getattr(item, "id", "") or "").strip()
                item_allocations = (item_allocations_map.get(str(getattr(o, "id", "") or "").strip(), {}) or {}).get(item_id, [])
                allocated_for_selected_warehouse = 0
                if warehouse_id:
                    allocated_for_selected_warehouse = sum(
                        max(_int((allocation or {}).get("allocatedQty"), 0), 0)
                        for allocation in item_allocations
                        if str((allocation or {}).get("warehouseId") or "").strip() == warehouse_id
                    )
                size_label = _get_product_size_label(getattr(item, "product", None))
                product_name = str(getattr(getattr(item, "product", None), "name", "") or getattr(item, "product_name", "") or "Product").strip() or "Product"
                product_allocations.append(
                    {
                        "itemId": item_id or None,
                        "productName": product_name,
                        "sizeLabel": size_label or None,
                        "allocatedQtyForSelectedWarehouse": allocated_for_selected_warehouse,
                        "totalQty": max(_int(getattr(item, "quantity", 0), 0), 0),
                    }
                )
            scheduled_replacement = _get_scheduled_replacement_payload(o)

            def _format_route_plan_qty_label(item: OrderItem) -> str:
                raw_qty = max(_int(getattr(item, "quantity", 0), 0), 0)
                item_unit = _normalize_product_unit(getattr(item, "product_unit", None))
                if scheduled_replacement and len(order_items) == 1:
                    exact_qty = max(
                        _int(scheduled_replacement.get("quantityRemaining"), 0),
                        _int(scheduled_replacement.get("quantityToReplace"), 0),
                    )
                    if exact_qty > 0:
                        if str(scheduled_replacement.get("unitMode") or "").strip().upper() == "BOTTLE":
                            return f"{exact_qty} bottle(s)"
                        if item_unit == PRODUCT_UNIT_PACK_BUNDLE:
                            return f"{exact_qty} pack(s)"
                        return f"{exact_qty} case(s)"
                if item_unit == PRODUCT_UNIT_PACK_BUNDLE:
                    return f"{raw_qty} pack(s)"
                return f"{raw_qty} case(s)"

            products_preview = ", ".join(
                [
                    f"{str(getattr(item.product, 'name', '') or getattr(item, 'product_name', '') or 'Product').strip()} {_format_route_plan_qty_label(item)}"
                    for item in order_items[:3]
                    if getattr(item, "product", None) or str(getattr(item, "product_name", "") or "").strip()
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
                "productAllocations": product_allocations,
                "allocatedQtyForSelectedWarehouse": allocated_qty_for_selected_warehouse,
                "totalOrderQty": total_order_qty,
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
            _release_order_reservations(order, user_id)

    if next_status in {"FAILED", "SKIPPED", "CANCELLED"} and dp.order_id:
        order = Order.objects.select_related("timeline").filter(id=dp.order_id).first()
        if order:
            timeline = getattr(order, "timeline", None)
            if next_status == "FAILED" and reschedule_requested:
                order.status = OrderStatus.RESCHEDULED
                order.loaded_at = None
                order.warehouse_dispatched_at = None
                update_fields = ["status", "loaded_at", "warehouse_dispatched_at", "updated_at"]
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
    try:
        overlay = parse_pod_overlay_metadata(request.POST)
    except ValueError as exc:
        return _err(str(exc))
    if overlay is not None:
        file_obj = request.FILES.get("file")
        if not file_obj:
            return _err("Image file is required")
        if not str(file_obj.content_type or "").lower().startswith("image/"):
            return _err("Only image files are allowed")
        driver = User.objects.filter(id=str(p.get("userId") or "")).first()
        if not driver:
            return _err("Driver account not found", 404)
        try:
            # Added: native captures are stamped server-side with the authenticated driver's name.
            stamped, extension = burn_pod_overlay(file_obj.read(), overlay, build_driver_full_name(driver))
        except ValueError as exc:
            return _err(str(exc))
        media_root = Path(__file__).resolve().parents[1] / "media" / "uploads" / "pods"
        media_root.mkdir(parents=True, exist_ok=True)
        name = f"pod-{int(timezone.now().timestamp() * 1000)}{extension}"
        (media_root / name).write_bytes(stamped)
        return _ok({"success": True, "imageUrl": f"/uploads/pods/{name}"})
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
    if p.get("role") not in {"DRIVER", "ADMIN", "SUPER_ADMIN"}:
        return _err("Forbidden", 403)
    # Added: driver and admin editors share one authenticated license-image endpoint.
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


RETAIL_QUOTE_SIGNING_SALT = "retail-pos-quote"
RETAIL_QUOTE_MAX_AGE_SECONDS = 600


def _require_retail_warehouse(request: HttpRequest) -> tuple[dict[str, Any] | None, Warehouse | None, JsonResponse | None]:
    """Restrict Retail sales to active warehouse staff and administrators."""
    payload, error = _require_staff(request)
    if error:
        return None, None, error
    role = str(payload.get("role") or "").strip().upper()
    if role not in (RoleType.WAREHOUSE_STAFF, RoleType.ADMIN, RoleType.SUPER_ADMIN):
        return None, None, _err("Retail is available only to warehouse staff and administrators", 403)
    staff_id = str(payload.get("userId") or "").strip()
    if role in (RoleType.ADMIN, RoleType.SUPER_ADMIN):
        requested_id = str(request.GET.get("warehouseId") or "").strip()
        if request.method != "GET":
            requested_id = str(_json_body(request).get("warehouseId") or requested_id).strip()
        warehouse = Warehouse.objects.filter(id=requested_id).first() if requested_id else None
        if warehouse is None:
            warehouse = Warehouse.objects.first()
        return payload, warehouse, None
    if not User.objects.filter(id=staff_id, role=RoleType.WAREHOUSE_STAFF, is_active=True).exists():
        return None, None, _err("Warehouse staff account is unavailable", 403)
    allowed_ids = _get_allowed_warehouse_ids_for_staff(staff_id)
    requested_id = str(request.GET.get("warehouseId") or "").strip()
    if request.method != "GET":
        requested_id = str(_json_body(request).get("warehouseId") or requested_id).strip()
    if requested_id and requested_id not in allowed_ids:
        return None, None, _err("You are not assigned to the selected warehouse", 403)
    warehouse_id = requested_id or next(iter(sorted(allowed_ids)), "")
    warehouse = Warehouse.objects.filter(id=warehouse_id).first()
    if warehouse is None:
        return None, None, _err("No warehouse is assigned to this staff account", 403)
    return payload, warehouse, None


def _retail_error(exc: ValueError) -> JsonResponse:
    message = str(exc)
    conflict_markers = ("insufficient", "changed", "unavailable", "refresh")
    status = 409 if any(marker in message.lower() for marker in conflict_markers) else 400
    return _err(message, status)


def _retail_sale_queryset(warehouse: Warehouse | None = None):
    qs = (
        Order.objects.select_related("customer", "created_by_user")
        .prefetch_related("items__product", "items__mixed_case_components__product", "bottle_returns")
        .filter(sales_channel=SalesChannel.RETAIL_POS)
    )
    if warehouse is not None:
        qs = qs.filter(warehouse_id=warehouse.id)
    return qs


@require_GET
def retail_products(request: HttpRequest) -> JsonResponse:
    _payload_data, warehouse, error = _require_retail_warehouse(request)
    if error:
        return error
    if warehouse is None:
        warehouse = Warehouse.objects.first()
        if warehouse is None:
            return _err("No warehouse registered", 404)
    page, size, offset = _pagination(request)
    size = min(size, 100)
    products = _real_products(Product.objects.filter(is_active=True))
    search = str(request.GET.get("search") or "").strip()
    if search:
        products = products.filter(Q(name__icontains=search) | Q(sku__icontains=search))
    total = products.count()
    rows = list(products[offset : offset + size])
    inventories = {
        inv.product_id: inv
        for inv in Inventory.objects.filter(
            warehouse_id=warehouse.id, product_id__in=[product.id for product in rows]
        )
    }
    return _ok({
        "success": True,
        "products": [serialize_retail_product(product, inventories.get(product.id)) for product in rows],
        "total": total,
        "page": page,
        "pageSize": size,
        "totalPages": (total + size - 1) // size,
    })


@csrf_exempt
@require_http_methods(["POST"])
def retail_quote(request: HttpRequest) -> JsonResponse:
    _payload_data, warehouse, error = _require_retail_warehouse(request)
    if error:
        return error
    if warehouse is None:
        return _err("warehouseId is required for retail quotes", 400)
    body = _json_body(request)
    if str(body.get("customerType") or "WALK_IN").strip().upper() == "EXISTING":
        customer_id = str(body.get("customerId") or "").strip()
        if not Customer.objects.filter(id=customer_id, is_active=True).exists():
            return _err("The selected customer is unavailable; refresh or use Walk-in Customer", 409)
    try:
        quote = quote_retail_cart(warehouse=warehouse, payload=body)
    except ValueError as exc:
        return _retail_error(exc)
    quote_token = signing.dumps(
        {"fingerprint": quote["fingerprint"], "warehouseId": warehouse.id},
        salt=RETAIL_QUOTE_SIGNING_SALT,
        compress=True,
    )
    return _ok({"success": True, "quote": serialize_retail_quote(quote), "quoteToken": quote_token})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def retail_sales_collection(request: HttpRequest) -> JsonResponse:
    payload_data, warehouse, error = _require_retail_warehouse(request)
    if error:
        return error
    if request.method == "POST":
        if warehouse is None:
            return _err("warehouseId is required to create a retail sale", 400)
        body = _json_body(request)
        request_id = str(body.get("idempotencyKey") or "").strip()
        if not request_id:
            return _err("idempotencyKey is required")
        existing_sale = _retail_sale_queryset(warehouse).filter(retail_request_id=request_id).first()
        if existing_sale is not None:
            return _ok({"success": True, "sale": serialize_retail_sale(existing_sale), "created": False})
        quote_token = str(body.get("quoteToken") or "").strip()
        if not quote_token:
            return _err("quoteToken is required")
        try:
            signed_quote = signing.loads(
                quote_token,
                salt=RETAIL_QUOTE_SIGNING_SALT,
                max_age=RETAIL_QUOTE_MAX_AGE_SECONDS,
            )
        except signing.BadSignature:
            return _err("Quote expired or invalid; refresh the quote", 409)
        if str(signed_quote.get("warehouseId") or "") != warehouse.id:
            return _err("Quote belongs to a different warehouse; refresh the quote", 409)
        staff = User.objects.filter(id=payload_data.get("userId"), is_active=True).first()
        if staff is None:
            return _err("Staff account is unavailable", 403)
        try:
            sale, created = create_retail_sale(
                warehouse=warehouse,
                staff=staff,
                payload=body,
                expected_fingerprint=str(signed_quote.get("fingerprint") or ""),
            )
        except IntegrityError:
            existing = Order.objects.filter(
                retail_request_id=str(body.get("idempotencyKey") or "").strip(),
                sales_channel=SalesChannel.RETAIL_POS,
                warehouse_id=warehouse.id,
            ).first()
            if existing is None:
                return _err("The retail sale could not be saved", 409)
            sale, created = existing, False
        except ValueError as exc:
            return _retail_error(exc)
        sale = _retail_sale_queryset(warehouse).get(id=sale.id)
        return _ok({"success": True, "sale": serialize_retail_sale(sale), "created": created}, 201 if created else 200)

    page, size, offset = _pagination(request)
    queryset = _retail_sale_queryset(warehouse)
    search = str(request.GET.get("search") or "").strip()
    if search:
        queryset = queryset.filter(
            Q(retail_transaction_number__icontains=search)
            | Q(customer__name__icontains=search)
            | Q(walk_in_name__icontains=search)
            | Q(walk_in_contact__icontains=search)
        )
    field_filters = {
        "paymentStatus": "payment_status",
        "fulfillmentType": "fulfillment_type",
        "pickupStatus": "pickup_status",
        "transactionStatus": "retail_status",
    }
    for query_name, model_name in field_filters.items():
        value = str(request.GET.get(query_name) or "").strip().upper()
        if value:
            queryset = queryset.filter(**{model_name: value})
    for query_name, lookup in (("dateFrom", "created_at__date__gte"), ("dateTo", "created_at__date__lte")):
        value = str(request.GET.get(query_name) or "").strip()
        if value:
            try:
                parsed_date = date.fromisoformat(value)
            except ValueError:
                return _err(f"{query_name} must use YYYY-MM-DD")
            queryset = queryset.filter(**{lookup: parsed_date})
    queryset = queryset.order_by("-created_at")
    total = queryset.count()
    rows = list(queryset[offset : offset + size])
    return _ok({
        "success": True,
        "sales": [serialize_retail_sale(row) for row in rows],
        "total": total,
        "page": page,
        "pageSize": size,
        "totalPages": (total + size - 1) // size,
    })


@require_GET
def retail_sale_detail(request: HttpRequest, sale_id: str) -> JsonResponse:
    _payload_data, warehouse, error = _require_retail_warehouse(request)
    if error:
        return error
    sale = _retail_sale_queryset(warehouse).filter(id=sale_id).first()
    if sale is None:
        return _err("Retail transaction not found", 404)
    return _ok({"success": True, "sale": serialize_retail_sale(sale)})


@csrf_exempt
@require_http_methods(["PATCH"])
def retail_sale_payment(request: HttpRequest, sale_id: str) -> JsonResponse:
    payload_data, warehouse, error = _require_retail_warehouse(request)
    if error:
        return error
    sale = _retail_sale_queryset(warehouse).filter(id=sale_id).first()
    if sale is None:
        return _err("Retail transaction not found", 404)
    staff = User.objects.filter(id=payload_data.get("userId"), is_active=True).first()
    if staff is None:
        return _err("Staff account is unavailable", 403)
    try:
        sale = update_retail_payment(sale, _json_body(request).get("amountPaid"), staff)
    except ValueError as exc:
        return _retail_error(exc)
    sale = _retail_sale_queryset(warehouse).get(id=sale.id)
    return _ok({"success": True, "sale": serialize_retail_sale(sale)})


@csrf_exempt
@require_http_methods(["PATCH"])
def retail_sale_pickup_status(request: HttpRequest, sale_id: str) -> JsonResponse:
    payload_data, warehouse, error = _require_retail_warehouse(request)
    if error:
        return error
    sale = _retail_sale_queryset(warehouse).filter(id=sale_id).first()
    if sale is None:
        return _err("Retail transaction not found", 404)
    staff = User.objects.filter(id=payload_data.get("userId"), is_active=True).first()
    if staff is None:
        return _err("Staff account is unavailable", 403)
    try:
        sale = update_retail_pickup_status(sale, _json_body(request).get("pickupStatus"), staff)
    except ValueError as exc:
        return _retail_error(exc)
    sale = _retail_sale_queryset(warehouse).get(id=sale.id)
    return _ok({"success": True, "sale": serialize_retail_sale(sale)})


@csrf_exempt
@require_http_methods(["POST"])
def retail_sale_cancel(request: HttpRequest, sale_id: str) -> JsonResponse:
    payload_data, warehouse, error = _require_retail_warehouse(request)
    if error:
        return error
    sale = _retail_sale_queryset(warehouse).filter(id=sale_id).first()
    if sale is None:
        return _err("Retail transaction not found", 404)
    staff = User.objects.filter(id=payload_data.get("userId"), is_active=True).first()
    if staff is None:
        return _err("Staff account is unavailable", 403)
    body = _json_body(request)
    try:
        sale = cancel_retail_sale(
            order=sale,
            staff=staff,
            reason=str(body.get("reason") or "").strip(),
            empties_restored_to_customer=bool(body.get("emptiesRestoredToCustomer")),
        )
    except ValueError as exc:
        return _retail_error(exc)
    sale = _retail_sale_queryset(warehouse).get(id=sale.id)
    return _ok({"success": True, "sale": serialize_retail_sale(sale)})


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


def _is_returnable_product(product: Product) -> bool:
    if not product:
        return False
    if product.packaging_type == "RETURNABLE":
        return True
    cat = str(product.category or "").strip().lower()
    if any(k in cat for k in ["(glass)", "glass", "returnable"]):
        if not any(k in cat for k in ["pet", "plastic", "can"]):
            return True
    return ProductPackaging.objects.filter(product=product, is_returnable=True, is_active=True).exists()


def _get_or_create_product_packaging(product: Product) -> tuple[ProductPackaging, ContainerType]:
    """Ensure a returnable glass product has active ProductPackaging and ContainerType records."""
    from decimal import Decimal
    is_1l = any("1l" in str(sz).lower() or "1 liter" in str(sz).lower() for sz in (product.sizes or []))
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

    pkg = ProductPackaging.objects.filter(product=product, is_active=True).select_related("container_type").first()
    if not pkg:
        pkg, _ = ProductPackaging.objects.get_or_create(
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
    if not pkg.is_returnable or not pkg.is_active:
        pkg.is_returnable = True
        pkg.is_active = True
        pkg.save(update_fields=["is_returnable", "is_active"])

    if product.packaging_type != "RETURNABLE":
        product.packaging_type = "RETURNABLE"
        product.save(update_fields=["packaging_type"])

    return pkg, container_type


@require_GET
def customer_empty_bottles_eligible(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p or p.get("type") != "customer":
        return _err("Unauthorized", 401)
    customer_id = p.get("userId")
    customer = Customer.objects.filter(id=customer_id, is_active=True).first()
    if not customer:
        return _err("Customer not found", 404)

    # Find all returnable products purchased by this customer across non-cancelled orders
    order_items = (
        OrderItem.objects.filter(order__customer=customer)
        .exclude(order__status__in=["CANCELLED", "REJECTED"])
        .select_related("product", "order")
    )

    # Group purchased quantities by product
    purchased_cases_by_product: dict[str, int] = {}
    for item in order_items:
        prod = item.product
        if not prod or not prod.is_active or not _is_returnable_product(prod):
            continue
        pkg, _ = _get_or_create_product_packaging(prod)
        containers_per_case = pkg.containers_per_case or (prod.quantity_per_unit or 24)
        item_unit = str(getattr(item, "product_unit", "") or getattr(item, "unit", "") or getattr(prod, "unit", "") or "").strip().lower()
        qty_cases = item.quantity if item_unit == "case" else max(1, item.quantity // containers_per_case)
        purchased_cases_by_product[prod.id] = purchased_cases_by_product.get(prod.id, 0) + qty_cases

    eligible_items = []
    for prod_id, total_cases_ordered in purchased_cases_by_product.items():
        product = Product.objects.filter(id=prod_id).first()
        if not product or not _is_returnable_product(product):
            continue

        pkg, container_type = _get_or_create_product_packaging(product)
        containers_per_case = pkg.containers_per_case or (product.quantity_per_unit or 24)
        case_deposit = float(pkg.case_deposit_amount or 42.0)
        unit_deposit = float(pkg.deposit_amount or 2.0)

        balance = CustomerBottleBalance.objects.filter(customer=customer, container_type=container_type).first()
        currently_held_bottles = balance.bottles_outstanding if balance else 0
        currently_held_cases = currently_held_bottles // max(1, containers_per_case)

        available_cases = max(0, total_cases_ordered - currently_held_cases)
        if available_cases > 0:
            eligible_items.append({
                "productId": product.id,
                "productName": product.name,
                "imageUrl": product.image_url,
                "category": product.category,
                "containerTypeId": container_type.id,
                "containerTypeName": container_type.name,
                "containersPerCase": containers_per_case,
                "unitDeposit": unit_deposit,
                "caseDeposit": case_deposit,
                "totalCasesOrdered": total_cases_ordered,
                "currentlyHeldCases": currently_held_cases,
                "availableCasesToReturn": available_cases,
            })

    return _ok({"success": True, "eligibleItems": eligible_items})


@csrf_exempt
@require_http_methods(["POST"])
def customer_record_empty_bottles(request: HttpRequest) -> JsonResponse:
    from decimal import Decimal
    from .models import DepositTransaction

    p = _require_auth(request)
    if not p or p.get("type") != "customer":
        return _err("Unauthorized", 401)
    customer_id = p.get("userId")
    customer = Customer.objects.filter(id=customer_id, is_active=True).first()
    if not customer:
        return _err("Customer not found", 404)

    body = _json_body(request)
    product_id = str(body.get("productId") or "").strip()
    cases = _int(body.get("cases"), 0)
    if not product_id:
        return _err("Product is required", 400)
    if cases <= 0:
        return _err("Number of cases must be at least 1", 400)

    product = Product.objects.filter(id=product_id, is_active=True).first()
    if not product or not _is_returnable_product(product):
        return _err("Product is not a returnable glass item", 400)

    pkg, container_type = _get_or_create_product_packaging(product)
    containers_per_case = pkg.containers_per_case or (product.quantity_per_unit or 24)
    case_deposit = Decimal(str(pkg.case_deposit_amount or "42.00"))

    order_items = (
        OrderItem.objects.filter(order__customer=customer, product=product)
        .exclude(order__status__in=["CANCELLED", "REJECTED"])
    )
    total_cases_ordered = sum(
        item.quantity if str(getattr(item, "product_unit", "") or getattr(item, "unit", "") or getattr(product, "unit", "") or "").strip().lower() == "case" else max(1, item.quantity // containers_per_case)
        for item in order_items
    )
    if total_cases_ordered <= 0:
        return _err(f"You have no purchase history for {product.name}. Empty bottles can only be recorded for products you purchased.", 400)

    with transaction.atomic():
        balance, _ = CustomerBottleBalance.objects.select_for_update().get_or_create(
            customer=customer,
            container_type=container_type,
            defaults={
                "bottles_outstanding": 0,
                "deposit_balance": Decimal("0.00"),
                "bottles_returned_total": 0,
                "bottles_sold_total": total_cases_ordered * containers_per_case,
            }
        )

        currently_held_cases = balance.bottles_outstanding // max(1, containers_per_case)
        available_cases = max(0, total_cases_ordered - currently_held_cases)
        if cases > available_cases:
            return _err(
                f"You can only record up to {available_cases} case(s) based on your purchase history of {product.name}.",
                400
            )

        added_bottles = cases * containers_per_case
        added_deposit = case_deposit * Decimal(str(cases))

        balance_before = balance.deposit_balance
        balance.bottles_outstanding += added_bottles
        balance.deposit_balance += added_deposit
        balance.last_return_at = timezone.now()
        balance.save()

        DepositTransaction.objects.create(
            customer=customer,
            type=DepositTransaction.TransactionType.ADJUSTMENT,
            amount=added_deposit,
            balance_before=balance_before,
            balance_after=balance.deposit_balance,
            container_type=container_type,
            container_count=added_bottles,
            reason=f"Customer declared {cases} empty case(s) ({added_bottles} bottles) of {product.name}",
            performed_by=customer.name or "Customer",
        )

    updated_customer = Customer.objects.get(id=customer.id)
    return _ok({
        "success": True,
        "message": f"Successfully recorded {cases} case(s) ({added_bottles} bottles) of {product.name}.",
        "user": _customer_payload(updated_customer),
    })


@require_GET
def bottle_returns_collection(_request: HttpRequest) -> JsonResponse:
    return _ok({"success": True, "returns": []})
