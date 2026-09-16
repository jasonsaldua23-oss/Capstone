"""Request parsing, field normalization and validation shared across the API."""

import math
import re
from datetime import datetime, time
from typing import Any

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.http import HttpRequest
from django.utils import timezone

from .api_constants import (
    PASSWORD_POLICY_ERROR,
    PHILIPPINE_DRIVER_LICENSE_REGEX,
    PRODUCT_UNIT_BOTTLE,
    PRODUCT_UNIT_CASE,
    PRODUCT_UNIT_MIXED_CASE,
    PRODUCT_UNIT_PACK_BUNDLE,
    _ORDER_STATUS_ALIASES,
)
from .api_utils import to_int as _int
from .models import OrderStatus, ReplacementStatus


def _pagination(request: HttpRequest) -> tuple[int, int, int]:
    page = max(1, _int(request.GET.get("page", "1"), 1))
    size = max(1, min(_int(request.GET.get("pageSize", request.GET.get("limit", "20")), 20), 1000))
    return page, size, (page - 1) * size


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


def _delivery_date_is_past(value: Any) -> bool:
    """Compare delivery schedules by local calendar date, not UTC timestamp."""
    parsed = value if isinstance(value, datetime) else _parse_iso_datetime(value)
    if parsed is None:
        return False
    local_value = timezone.localtime(parsed) if timezone.is_aware(parsed) else parsed
    return local_value.date() < timezone.localdate()


def _normalize_philippine_phone(value: Any) -> str | None:
    """Keep staff phone values numeric and limited to supported Philippine mobile formats."""
    phone = str(value or "").strip()
    if re.fullmatch(r"(?:09\d{9}|63\d{10})", phone):
        return phone
    return None


def _normalize_driver_status(value: Any) -> str:
    """Normalize UI labels such as OnLeave to the persisted status value."""
    normalized = str(value or "").strip().upper().replace(" ", "_")
    return "ON_LEAVE" if normalized == "ONLEAVE" else normalized


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


def _validate_stock_expiry(value: Any) -> tuple[datetime | None, str | None]:
    """Parse a stock expiry date and allow only today or a future local date."""
    raw = str(value or "").strip()
    parsed = _parse_iso_datetime(value)
    if not parsed:
        return None, "Invalid expiryDate format"
    local_expiry_date = timezone.localtime(parsed).date()
    if local_expiry_date < timezone.localdate():
        return None, "Expiry date cannot be in the past. Enter today or a future date."
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        # A date-only expiry remains usable throughout that entire local day.
        parsed = timezone.make_aware(
            datetime.combine(local_expiry_date, time.max),
            timezone.get_current_timezone(),
        )
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
        ReplacementStatus.CANCELLED,
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


def _person_name_has_number(*values: Any) -> bool:
    """Return whether any submitted person-name value contains a numeric character."""
    return any(re.search(r"\d", str(value or "")) for value in values)


def _submitted_person_name_has_number(body: dict[str, Any]) -> bool:
    """Validate structured parts when present because they replace the flat display name."""
    structured_keys = ("firstName", "middleName", "lastName", "suffix")
    keys = structured_keys if any(key in body for key in structured_keys) else ("name",)
    return _person_name_has_number(*(body.get(key) for key in keys if key in body))


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


def _round_half_up(value: float) -> int:
    return max(0, int(math.floor(max(value, 0) + 0.5)))
