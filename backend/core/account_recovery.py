"""Password-reset account lookup, portal scoping and login-failure alerting."""

import hashlib
import logging
from typing import Any

from django.conf import settings
from django.http import HttpRequest

from . import views_api as legacy
from .api_constants import _PASSWORD_RESET_PORTAL_ROLES
from .auth_throttling import (
    LOGIN_FAILURE_POLICY,
    claim_account_alert,
    get_client_ip,
    record_failure,
)
from .models import Customer, RoleType, User

logger = logging.getLogger(__name__)


# Helpers owned by sibling modules. Routing them through views_api keeps
# a single resolution point, so tests that patch there still apply.


def _email_admin_login_failure_alert(user: User, ip_address: str, failure_count: int, failure_stage: str) -> None:
    return legacy._email_admin_login_failure_alert(user, ip_address, failure_count, failure_stage)


def _normalize_email(value: Any) -> str:
    return legacy._normalize_email(value)


def _resolve_unified_login_accounts(email: str) -> tuple[User | None, Customer | None, bool]:
    return legacy._resolve_unified_login_accounts(email)


def _password_reset_staff_portal(role: str) -> str | None:
    """Return the one scoped portal that is permitted for a staff role."""
    normalized_role = str(role or "").strip().upper()
    for portal, allowed_roles in _PASSWORD_RESET_PORTAL_ROLES.items():
        if normalized_role in allowed_roles:
            return portal
    return None


def _get_unified_reset_account(email: str) -> User | Customer | None:
    """Resolve one active reset account without disclosing a legacy collision."""
    # Security: historical records can predate the global email check. Do not
    # choose an account when the address occurs in either table more than once.
    user_count = User.objects.filter(email__iexact=email).count()
    customer_count = Customer.objects.filter(email__iexact=email).count()
    if user_count + customer_count != 1:
        return None

    staff, customer, is_ambiguous = _resolve_unified_login_accounts(email)
    if is_ambiguous:
        return None
    if staff and staff.is_active and _password_reset_staff_portal(staff.role):
        return staff
    if customer and customer.is_active:
        return customer
    return None


def _get_reset_account(account_type: str, email: str, portal: str = "") -> User | Customer | None:
    if account_type == "unified" and not portal:
        return _get_unified_reset_account(email)
    if account_type == "staff":
        allowed_roles = _PASSWORD_RESET_PORTAL_ROLES.get(portal)
        if not allowed_roles:
            return None
        # Fix: a staff email is valid only when its role belongs to the portal
        # where the password reset was requested.
        return User.objects.filter(email=email, role__in=allowed_roles, is_active=True).first()
    if account_type == "customer" and portal in {"", "customer"}:
        return Customer.objects.filter(email=email, is_active=True).first()
    return None


def _password_reset_otp_scope(account_type: str, portal: str) -> str:
    """Bind staff reset codes to one portal while preserving the customer scope."""
    # A neutral-login OTP must never validate in a portal-bound reset flow.
    if account_type == "unified":
        return "unified"
    return f"staff:{portal}" if account_type == "staff" else "customer"


def _password_reset_portal_error(account_type: str, portal: str) -> str | None:
    if account_type == "unified" and portal:
        return "A portal is not allowed for a unified password reset"
    if account_type == "staff" and portal not in _PASSWORD_RESET_PORTAL_ROLES:
        return "A valid staff portal is required"
    if account_type == "customer" and portal not in {"", "customer"}:
        return "Portal does not match the customer account type"
    return None


def _account_display_name(email: str) -> str:
    """Best-effort first name for an address, so security mail is not anonymous."""
    normalized = _normalize_email(email)
    if not normalized:
        return ""
    holder = (
        User.objects.filter(email=normalized).values_list("name", flat=True).first()
        or Customer.objects.filter(email=normalized).values_list("name", flat=True).first()
    )
    return str(holder or "").strip()


def _alert_admin_login_failure(
    action: str,
    user: User,
    ip_address: str,
    failure_count: int,
    failure_stage: str,
) -> None:
    alert_threshold = max(1, int(getattr(settings, "AUTH_LOGIN_ALERT_THRESHOLD", 3)))
    if str(user.role).upper() not in {RoleType.ADMIN, RoleType.SUPER_ADMIN}:
        return
    if failure_count >= alert_threshold and claim_account_alert(action, user.email):
        # Alert delivery failure is logged by the shared mail sender and never
        # changes the authentication response seen by the requester.
        _email_admin_login_failure_alert(user, ip_address, failure_count, failure_stage)


def _record_login_failure(request: HttpRequest, email: str, portal: str, user: User | None) -> None:
    """Apply progressive account/IP delays and alert a targeted administrator."""
    ip_address = get_client_ip(request)
    result = record_failure("password_login", email, ip_address, LOGIN_FAILURE_POLICY)
    logger.warning(
        "Authentication failure portal=%s account_hash=%s source_ip=%s count=%s",
        portal or "unknown",
        hashlib.sha256(email.encode("utf-8")).hexdigest()[:12],
        ip_address,
        result.account_count,
    )
    if portal == "admin" and user is not None:
        _alert_admin_login_failure(
            "password_login", user, ip_address, result.account_count, "Password verification"
        )


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
