"""Token extraction, portal authorization and session cookie handling."""

import os
from datetime import date, datetime
from typing import Any

from django.conf import settings
from django.http import HttpRequest, JsonResponse
from django.utils import timezone

from .api_constants import PHILIPPINE_DRIVER_LICENSE_REGEX
from .api_utils import error as _err
from .auth import (
    CUSTOMER_TOKEN_NAME,
    PORTAL_TOKEN_NAMES,
    STAFF_TOKEN_NAME,
    TOKEN_NAME,
    decode_session,
    decode_token,
    extract_token,
    token_portal,
)
from .models import Customer, User


def _payload(request: HttpRequest) -> dict[str, Any] | None:
    token = extract_token(request)
    if not token:
        return None
    payload = decode_session(token)
    # Fix: email proofs and pending 2FA challenges are not authenticated sessions.
    if not payload or payload.get("type") not in {"staff", "customer"} or not payload.get("userId"):
        return None
    return payload


def _require_auth(request: HttpRequest) -> dict[str, Any] | None:
    return _payload(request)


def _require_staff(request: HttpRequest) -> tuple[dict[str, Any] | None, JsonResponse | None]:
    p = _payload(request)
    if p and p.get("type") == "staff":
        return p, None

    # Fix: a stale cross-portal Bearer token must not mask the valid staff-only
    # HttpOnly cookie held by this browser session.
    staff_cookie = request.COOKIES.get(STAFF_TOKEN_NAME)
    staff_payload = decode_session(staff_cookie) if staff_cookie else None
    requested_portal = str(request.headers.get("X-Portal", "")).lower()
    if staff_payload and staff_payload.get("type") == "staff" and (
        requested_portal not in PORTAL_TOKEN_NAMES or token_portal(staff_payload) == requested_portal
    ):
        request._staff_cookie_auth_fallback = True
        return staff_payload, None

    if not p:
        return None, _err("Unauthorized", 401)
    return None, _err("Forbidden", 403)


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
    # Fix: Admin, Warehouse and Driver must not overwrite each other's cookie-based restores.
    portal = token_portal(payload)
    if portal and PORTAL_TOKEN_NAMES[portal] != cookie_name:
        response.set_cookie(PORTAL_TOKEN_NAMES[portal], token, **cookie_kwargs)
    # Clear legacy shared cookie so role sessions no longer overwrite each other.
    response.delete_cookie(TOKEN_NAME, path="/")


def _user_payload(user: User) -> dict[str, Any]:
    return {
        "userId": user.id,
        "email": user.email,
        "name": user.name,
        "firstName": getattr(user, "first_name", None),
        "middleName": getattr(user, "middle_name", None),
        "lastName": getattr(user, "last_name", None),
        "suffix": getattr(user, "suffix", None),
        # Fix: hydrate saved staff phone numbers after login and page refresh.
        "phone": user.phone,
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
        # Fix: keep customer security preferences in the authenticated profile.
        "twoFactorEnabled": bool(getattr(customer, "two_factor_enabled", False)),
        "loginAlertsEnabled": bool(getattr(customer, "login_alerts_enabled", True)),
        "bottleBalances": balances,
    }


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
