"""Authentication, registration, OTP verification and password-reset endpoints."""

import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta
from time import monotonic
from typing import Any

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import connection, transaction
from django.http import HttpRequest, JsonResponse
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from . import views_api as legacy
from .api_constants import OTP_EXPIRY_MINUTES, PERSON_NAME_NUMBER_ERROR, STAFF_LOGIN_ROLE_SCOPE
from .api_utils import error as _err, json_body as _json_body, ok as _ok
from .auth import (
    CUSTOMER_TOKEN_NAME,
    PORTAL_TOKEN_NAMES,
    REMEMBER_ME_EXP_HOURS,
    STAFF_TOKEN_NAME,
    TOKEN_EXP_HOURS,
    TOKEN_NAME,
    create_token,
    decode_token,
    extract_token,
    hash_password,
    revoke_session,
    token_portal,
    verify_password,
)
from .auth_throttling import (
    LOGIN_FAILURE_POLICY,
    OTP_FAILURE_POLICY,
    OTP_SEND_POLICY,
    check_limit,
    clear_account_failures,
    consume_event,
    get_client_ip,
    record_failure,
    throttle_response,
)
from .models import Customer, RoleType, User

logger = logging.getLogger(__name__)

# Shared response for Google sign-in attempts that do not match an existing account.
NO_REGISTERED_ACCOUNT_MESSAGE = "No registered account"


# Helpers owned by sibling modules. Routing them through views_api keeps
# a single resolution point, so tests that patch there still apply.


def _alert_admin_login_failure(action: str, user: User, ip_address: str, failure_count: int, failure_stage: str) -> None:
    return legacy._alert_admin_login_failure(action, user, ip_address, failure_count, failure_stage)


def _customer_payload(customer: Customer) -> dict[str, Any]:
    return legacy._customer_payload(customer)


def _email_exists_for_account(email: str, account_type: str, role_id: str | None=None) -> bool:
    return legacy._email_exists_for_account(email, account_type, role_id)


def _email_login_alert(user: User) -> None:
    return legacy._email_login_alert(user)


def _ensure_negros_occidental_address(*, latitude: Any, longitude: Any, city: Any=None, province: Any, require_coordinates: bool=False) -> str | None:
    return legacy._ensure_negros_occidental_address(latitude=latitude, longitude=longitude, city=city, province=province, require_coordinates=require_coordinates)


def _get_reset_account(account_type: str, email: str, portal: str='') -> User | Customer | None:
    return legacy._get_reset_account(account_type, email, portal)


def _is_email_verification_token_valid(token: str, email: str, account_type: str) -> bool:
    return legacy._is_email_verification_token_valid(token, email, account_type)


def _is_gmail_email(email: str) -> bool:
    return legacy._is_gmail_email(email)


def _is_valid_stateless_otp(otp_code: str, email: str, account_type: str, purpose: str, now: datetime | None=None) -> bool:
    return legacy._is_valid_stateless_otp(otp_code, email, account_type, purpose, now)


def _issue_email_verification_token(email: str, account_type: str) -> str:
    return legacy._issue_email_verification_token(email, account_type)


def _normalize_email(value: Any) -> str:
    return legacy._normalize_email(value)


def _otp_bucket(value: datetime) -> int:
    return legacy._otp_bucket(value)


def _otp_mail_ready() -> bool:
    return legacy._otp_mail_ready()


def _otp_secret() -> str:
    return legacy._otp_secret()


def _password_reset_otp_scope(account_type: str, portal: str) -> str:
    return legacy._password_reset_otp_scope(account_type, portal)


def _password_reset_portal_error(account_type: str, portal: str) -> str | None:
    return legacy._password_reset_portal_error(account_type, portal)


def _person_name_has_number(*values: Any) -> bool:
    return legacy._person_name_has_number(*values)


def _record_login_failure(request: HttpRequest, email: str, portal: str, user: User | None) -> None:
    return legacy._record_login_failure(request, email, portal, user)


def _require_auth(request: HttpRequest) -> dict[str, Any] | None:
    return legacy._require_auth(request)


def _send_email_verification_otp(email: str, otp_code: str) -> None:
    return legacy._send_email_verification_otp(email, otp_code)


def _send_login_otp_email(email: str, otp_code: str) -> None:
    return legacy._send_login_otp_email(email, otp_code)


def _send_reset_otp_email(email: str, otp_code: str) -> None:
    return legacy._send_reset_otp_email(email, otp_code)


def _set_auth_cookie(response: JsonResponse, token: str, remember_me: bool=False) -> None:
    return legacy._set_auth_cookie(response, token, remember_me)


def _stateless_otp_for_bucket(email: str, account_type: str, purpose: str, bucket: int) -> str:
    return legacy._stateless_otp_for_bucket(email, account_type, purpose, bucket)


def _user_payload(user: User) -> dict[str, Any]:
    return legacy._user_payload(user)


def _validate_password_strength(password: str) -> str | None:
    return legacy._validate_password_strength(password)


def _verify_google_token(credential: str) -> dict[str, Any]:
    return legacy._verify_google_token(credential)


@require_GET
def api_root(_request: HttpRequest) -> JsonResponse:
    return _ok({"success": True, "message": "Django Logistics API", "version": "1.0"})


@require_GET
def health(_request: HttpRequest) -> JsonResponse:
    """Liveness only: is the WSGI process answering? Never touches the database."""
    return _ok({"success": True, "service": "django-backend", "status": "ok"})


@require_GET
def health_ready(_request: HttpRequest) -> JsonResponse:
    """Readiness: the process is only useful if it can still reach Postgres.

    The plain /api/health probe answers 200 even when every real endpoint is
    failing on a dead Supabase pooler connection, so uptime monitors stayed green
    through outages that users saw immediately. Point monitors at this instead.
    """
    from django.db import connection

    started = monotonic()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception as exc:  # noqa: BLE001 - any driver error means "not ready"
        logger.exception("Readiness probe failed to reach the database")
        return _ok(
            {
                "success": False,
                "service": "django-backend",
                "status": "degraded",
                "database": "unreachable",
                "error": str(exc)[:200],
            },
            503,
        )
    return _ok(
        {
            "success": True,
            "service": "django-backend",
            "status": "ok",
            "database": "ok",
            "dbLatencyMs": round((monotonic() - started) * 1000, 1),
        }
    )


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

    # Security: count both the destination account and source address before
    # dispatch so concurrent requests cannot send beyond the OTP allowance.
    retry_after = consume_event(
        "email_verification_send", email, get_client_ip(request), OTP_SEND_POLICY
    )
    if retry_after:
        return throttle_response(retry_after)

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

    # Added: an administrator editing a staff account may verify that account's current email.
    target_user_id = str(body.get("targetUserId") or "").strip()
    current_email = _normalize_email(p.get("email"))
    if target_user_id:
        if str(p.get("role") or "").upper() not in {RoleType.ADMIN, RoleType.SUPER_ADMIN}:
            return _err("Forbidden", 403)
        target_user = User.objects.filter(id=target_user_id).first()
        if not target_user:
            return _err("User not found", 404)
        if target_user.role == RoleType.SUPER_ADMIN and str(p.get("role") or "").upper() != RoleType.SUPER_ADMIN:
            return _err("Only the owner can modify this account", 403)
        current_email = _normalize_email(target_user.email)
    if email != current_email:
        return _err("Email does not match your current account email", 400)

    if not _otp_mail_ready():
        return _err("Verification email service is not configured", 500)

    retry_after = consume_event(
        "email_verification_send", email, get_client_ip(request), OTP_SEND_POLICY
    )
    if retry_after:
        return throttle_response(retry_after)

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

    # Added: confirmation must resolve the same administrator-selected staff account.
    target_user_id = str(body.get("targetUserId") or "").strip()
    current_email = _normalize_email(p.get("email"))
    if target_user_id:
        if str(p.get("role") or "").upper() not in {RoleType.ADMIN, RoleType.SUPER_ADMIN}:
            return _err("Forbidden", 403)
        target_user = User.objects.filter(id=target_user_id).first()
        if not target_user:
            return _err("User not found", 404)
        if target_user.role == RoleType.SUPER_ADMIN and str(p.get("role") or "").upper() != RoleType.SUPER_ADMIN:
            return _err("Only the owner can modify this account", 403)
        current_email = _normalize_email(target_user.email)
    if email != current_email:
        return _err("Email does not match your current account email", 400)

    ip_address = get_client_ip(request)
    retry_after = check_limit("email_verification_otp", email, ip_address, OTP_FAILURE_POLICY)
    if retry_after:
        return throttle_response(retry_after)

    now = timezone.now()
    if not _is_valid_stateless_otp(otp_code, email, account_type, "old_email_confirm", now):
        record_failure("email_verification_otp", email, ip_address, OTP_FAILURE_POLICY)
        return _err("Invalid or expired verification code", 400)
    clear_account_failures("email_verification_otp", email)

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

    ip_address = get_client_ip(request)
    retry_after = check_limit("email_verification_otp", email, ip_address, OTP_FAILURE_POLICY)
    if retry_after:
        return throttle_response(retry_after)

    now = timezone.now()
    if not _is_valid_stateless_otp(otp_code, email, account_type, "email_verification", now):
        record_failure("email_verification_otp", email, ip_address, OTP_FAILURE_POLICY)
        return _err("Invalid or expired verification code", 400)
    clear_account_failures("email_verification_otp", email)
    verification_token = _issue_email_verification_token(email, account_type)
    return _ok({"success": True, "message": "Email verified successfully", "verificationToken": verification_token})


def _start_staff_login_two_factor(
    request: HttpRequest,
    user: User,
    portal: str,
    remember_me: bool,
    *,
    include_email: bool = False,
) -> JsonResponse:
    """Send the shared staff login challenge after a primary factor succeeds."""
    if not _otp_mail_ready():
        return _err("2FA is enabled but OTP email service is not configured", 500)

    email = _normalize_email(user.email)
    ip_address = get_client_ip(request)
    retry_after = consume_event("login_otp_send", email, ip_address, OTP_SEND_POLICY)
    if retry_after:
        return throttle_response(retry_after)

    now = timezone.now()
    code = _stateless_otp_for_bucket(email, "staff", "login_2fa", _otp_bucket(now))
    try:
        _send_login_otp_email(email, code)
    except Exception:
        logger.exception("Failed to send login 2FA OTP")
        return _err("Failed to send login verification code", 500)

    challenge_token = create_token(
        {
            "type": "login_2fa",
            # Fix: verification can now resolve staff and customer challenges safely.
            "accountType": "staff",
            "userId": user.id,
            "email": email,
            "portal": portal or "",
            "rememberMe": bool(remember_me),
        },
        exp_hours=1,
    )
    response_payload = {
        "success": False,
        "requiresTwoFactor": True,
        "message": "Verification code sent to your email",
        "challengeToken": challenge_token,
    }
    # Google Identity Services does not reveal an address to the page. It is safe
    # to return the verified account address only after Google's primary factor.
    if include_email:
        response_payload["email"] = email
    return _ok(response_payload, 202)


def _start_customer_login_two_factor(
    request: HttpRequest,
    customer: Customer,
    remember_me: bool,
    *,
    include_email: bool = False,
) -> JsonResponse:
    """Send the same shared login challenge for a Customer primary factor."""
    if not _otp_mail_ready():
        return _err("2FA is enabled but OTP email service is not configured", 500)

    email = _normalize_email(customer.email)
    ip_address = get_client_ip(request)
    retry_after = consume_event("login_otp_send", email, ip_address, OTP_SEND_POLICY)
    if retry_after:
        return throttle_response(retry_after)

    now = timezone.now()
    code = _stateless_otp_for_bucket(email, "customer", "login_2fa", _otp_bucket(now))
    try:
        _send_login_otp_email(email, code)
    except Exception:
        logger.exception("Failed to send customer login 2FA OTP")
        return _err("Failed to send login verification code", 500)

    challenge_token = create_token(
        {
            "type": "login_2fa",
            "accountType": "customer",
            "userId": customer.id,
            "email": email,
            "portal": "customer",
            "rememberMe": bool(remember_me),
        },
        exp_hours=1,
    )
    response_payload = {
        "success": False,
        "requiresTwoFactor": True,
        "message": "Verification code sent to your email",
        "challengeToken": challenge_token,
    }
    # Google does not disclose the verified address to the browser, so the OTP
    # screen receives it only after Google has completed the primary factor.
    if include_email:
        response_payload["email"] = email
    return _ok(response_payload, 202)


def _issue_staff_login_response(user: User, remember_me: bool) -> JsonResponse:
    """Create the normal staff session after all required factors have passed."""
    user.last_login_at = timezone.now()
    user.save(update_fields=["last_login_at", "updated_at"])
    payload = _user_payload(user)
    token = create_token(
        {**payload, "rememberMe": remember_me},
        REMEMBER_ME_EXP_HOURS if remember_me else TOKEN_EXP_HOURS,
    )
    resp = _ok({"success": True, "user": payload, "token": token, "message": "Login successful"})
    _set_auth_cookie(resp, token, remember_me)
    if bool(getattr(user, "login_alerts_enabled", True)):
        try:
            _email_login_alert(user)
        except Exception:
            logger.exception("Failed to send login alert email for user=%s", user.id)
    return resp


def _issue_customer_login_response(
    customer: Customer,
    remember_me: bool,
    *,
    message: str = "Login successful",
    status: int = 200,
    created: bool | None = None,
) -> JsonResponse:
    """Create the normal Customer session while retaining Google registration metadata."""
    payload = _customer_payload(customer)
    token = create_token(
        {**payload, "rememberMe": remember_me},
        REMEMBER_ME_EXP_HOURS if remember_me else TOKEN_EXP_HOURS,
    )
    response_payload: dict[str, Any] = {
        "success": True,
        "user": payload,
        "token": token,
        "message": message,
    }
    if created is not None:
        response_payload["created"] = created
    resp = _ok(response_payload, status)
    _set_auth_cookie(resp, token, remember_me)
    return resp


def _resolve_unified_login_accounts(email: str) -> tuple[User | None, Customer | None, bool]:
    """Resolve one account type, failing closed when legacy records conflict."""
    matching_users = User.objects.filter(email__iexact=email)
    staff = matching_users.filter(role__in=STAFF_LOGIN_ROLE_SCOPE).first()
    customer = Customer.objects.filter(email__iexact=email).first()
    # Registration prevents these combinations now, but historical data can still
    # contain them. Never choose a session type from an ambiguous email address.
    has_legacy_non_staff_user = matching_users.exclude(role__in=STAFF_LOGIN_ROLE_SCOPE).exists()
    return staff, customer, bool(has_legacy_non_staff_user or (staff and customer))


@csrf_exempt
@require_http_methods(["POST"])
def auth_login(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    email = _normalize_email(body.get("email"))
    password = str(body.get("password", ""))
    portal = str(body.get("portal", "")).strip().lower()
    remember_me = bool(body.get("rememberMe", False))
    if not email or not password:
        return _err("Email and password are required")
    ip_address = get_client_ip(request)
    retry_after = check_limit("password_login", email, ip_address, LOGIN_FAILURE_POLICY)
    if retry_after:
        return throttle_response(retry_after)
    role_scope = {
        "admin": {"SUPER_ADMIN", "ADMIN"},
        "driver": {"DRIVER"},
        "warehouse": {"WAREHOUSE_STAFF"},
        # Added: the neutral staff sign-in accepts every permitted staff role,
        # then the UI routes from the signed account's actual role.
        "staff": STAFF_LOGIN_ROLE_SCOPE,
    }.get(portal)
    # A generic or unknown portal must never authenticate an obsolete
    # User(role=CUSTOMER) record as a staff session.
    users_qs = User.objects.filter(email__iexact=email, role__in=STAFF_LOGIN_ROLE_SCOPE)
    if role_scope:
        users_qs = users_qs.filter(role__in=role_scope)
    user = users_qs.first()
    if not user:
        _record_login_failure(request, email, portal, None)
        return _err("Invalid email or password", 401)
    if not user.is_active or not verify_password(password, user.password):
        _record_login_failure(request, email, portal, user)
        return _err("Invalid email or password", 401)
    # A valid password clears only the account counter; the IP counter remains so
    # one source cannot evade credential-stuffing detection across many accounts.
    clear_account_failures("password_login", email)
    if bool(getattr(user, "two_factor_enabled", False)):
        return _start_staff_login_two_factor(request, user, portal, remember_me)

    return _issue_staff_login_response(user, remember_me)


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

    ip_address = get_client_ip(request)
    retry_after = check_limit("login_otp_verify", email, ip_address, OTP_FAILURE_POLICY)
    if retry_after:
        return throttle_response(retry_after)

    # Challenges issued before accountType was added are staff challenges.
    account_type = str(challenge_payload.get("accountType") or "staff").strip().lower()
    if account_type == "customer":
        account = Customer.objects.filter(id=user_id, email__iexact=email, is_active=True).first()
    elif account_type == "staff":
        account = User.objects.filter(id=user_id, email__iexact=email, is_active=True).first()
    else:
        return _err("Invalid login challenge", 401)
    if not account:
        return _err("Account is unavailable", 401)
    now = timezone.now()
    if not _is_valid_stateless_otp(otp_code, email, account_type, "login_2fa", now):
        result = record_failure("login_otp_verify", email, ip_address, OTP_FAILURE_POLICY)
        logger.warning(
            "Login OTP failure account_hash=%s source_ip=%s count=%s",
            hashlib.sha256(email.encode("utf-8")).hexdigest()[:12],
            ip_address,
            result.account_count,
        )
        if account_type == "staff":
            _alert_admin_login_failure(
                "login_otp_verify", account, ip_address, result.account_count, "Two-factor verification"
            )
        return _err("Invalid or expired verification code", 400)
    clear_account_failures("login_otp_verify", email)

    if account_type == "staff":
        account.last_login_at = timezone.now()
        account.save(update_fields=["last_login_at", "updated_at"])
        payload = _user_payload(account)
    else:
        payload = _customer_payload(account)
    # Keep auth token lifetime independent from UI inactivity timeout.
    token_exp_hours = REMEMBER_ME_EXP_HOURS if remember_me else TOKEN_EXP_HOURS
    # Preserve the original remember-me choice through the completed 2FA login.
    token = create_token({**payload, "rememberMe": remember_me}, token_exp_hours)
    resp = _ok({"success": True, "user": payload, "token": token, "message": "Login successful"})
    _set_auth_cookie(resp, token, remember_me)
    if bool(getattr(account, "login_alerts_enabled", True)):
        try:
            _email_login_alert(account)
        except Exception:
            logger.exception("Failed to send login alert email for account=%s", account.id)
    return resp


@csrf_exempt
@require_http_methods(["POST"])
def auth_customer_login(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    email = _normalize_email(body.get("email"))
    password = str(body.get("password", ""))
    remember_me = bool(body.get("rememberMe", False))
    if not email or not password:
        return _err("Email and password are required")
    ip_address = get_client_ip(request)
    retry_after = check_limit("password_login", email, ip_address, LOGIN_FAILURE_POLICY)
    if retry_after:
        return throttle_response(retry_after)
    customer = Customer.objects.filter(email__iexact=email).first()
    if not customer:
        record_failure("password_login", email, ip_address, LOGIN_FAILURE_POLICY)
        return _err("Invalid email or password", 401)
    if not customer.is_active or not verify_password(password, customer.password):
        record_failure("password_login", email, ip_address, LOGIN_FAILURE_POLICY)
        return _err("Invalid email or password", 401)
    clear_account_failures("password_login", email)
    if bool(getattr(customer, "two_factor_enabled", False)):
        return _start_customer_login_two_factor(request, customer, remember_me)
    return _issue_customer_login_response(customer, remember_me)


@csrf_exempt
@require_http_methods(["POST"])
def auth_customer_google(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    credential = str(body.get("credential") or body.get("idToken") or "").strip()
    remember_me = bool(body.get("rememberMe", False))
    sign_in_only = body.get("signInOnly") is True
    if not credential:
        return _err("Google credential is required")

    # Fix: use the same explicit audience configuration as the token verifier.
    if not (getattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "") or getattr(settings, "GOOGLE_OAUTH_CLIENT_IDS", [])):
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
        if claims.get("email_verified") is not True:
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
            # Keep Google registration subject to the same one-email/one-account
            # rule as password registration, including historical staff records.
            if User.objects.filter(email__iexact=email).exists():
                return _err("Google account is not authorized for customer access", 401)
            customer = Customer.objects.filter(email__iexact=email).first()
            if not customer:
                # Fix: login screens must not silently register a newly selected Google account.
                if sign_in_only:
                    return _err(NO_REGISTERED_ACCOUNT_MESSAGE, 401)
                # Customer registration is complete as soon as Google verifies the identity.
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

        if created:
            return _issue_customer_login_response(
                customer,
                remember_me,
                message="Registration successful",
                status=201,
                created=True,
            )
        if bool(getattr(customer, "two_factor_enabled", False)):
            # Fix: Google is a primary factor, not a bypass for Customer 2FA.
            return _start_customer_login_two_factor(request, customer, remember_me, include_email=True)
        return _issue_customer_login_response(customer, remember_me, created=False)
    except Exception as exc:
        logger.exception("Google customer auth post-verification failed: %s", str(exc))
        if getattr(settings, "DEBUG", False):
            return _err(f"Google sign-in post-verification failed: {str(exc)}", 500)
        return _err("Google sign-in is temporarily unavailable. Please use email/password for now.", 500)


@csrf_exempt
@require_http_methods(["POST"])
def auth_staff_google(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    credential = str(body.get("credential") or body.get("idToken") or "").strip()
    remember_me = bool(body.get("rememberMe", False))
    if not credential:
        return _err("Google credential is required")

    if not (getattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "") or getattr(settings, "GOOGLE_OAUTH_CLIENT_IDS", [])):
        return _err("Google OAuth is not configured on the server", 500)

    try:
        claims = _verify_google_token(credential)
    except ValueError as exc:
        logger.warning("Invalid Google credential during staff auth: %s", str(exc))
        return _err(f"Invalid Google credential: {str(exc)}", 401)
    except Exception as exc:
        logger.exception("Google staff token verification failed: %s", str(exc))
        if getattr(settings, "DEBUG", False):
            return _err(f"Google authentication failed: {str(exc)}", 503)
        return _err("Google authentication service is temporarily unavailable", 503)

    email = _normalize_email(claims.get("email"))
    if not email:
        return _err("Google account email is unavailable")
    if claims.get("email_verified") is not True:
        return _err("Google email is not verified", 401)
    if not _is_gmail_email(email):
        return _err("Invalid email format (example@domain.com)")

    # Security: Google proves possession of an email, not authorization to create
    # a privileged account. Only an existing active staff record may sign in.
    user = User.objects.filter(
        email__iexact=email,
        role__in=STAFF_LOGIN_ROLE_SCOPE,
        is_active=True,
    ).first()
    if not user:
        return _err(NO_REGISTERED_ACCOUNT_MESSAGE, 401)

    if bool(getattr(user, "two_factor_enabled", False)):
        # Keep the same second factor as password login; Google is the primary factor.
        return _start_staff_login_two_factor(request, user, "staff", remember_me, include_email=True)

    return _issue_staff_login_response(user, remember_me)


@csrf_exempt
@require_http_methods(["POST"])
def auth_unified_login(request: HttpRequest) -> JsonResponse:
    """Authenticate one existing Customer or permitted staff account by email."""
    body = _json_body(request)
    email = _normalize_email(body.get("email"))
    password = str(body.get("password", ""))
    remember_me = bool(body.get("rememberMe", False))
    if not email or not password:
        return _err("Email and password are required")

    ip_address = get_client_ip(request)
    retry_after = check_limit("password_login", email, ip_address, LOGIN_FAILURE_POLICY)
    if retry_after:
        return throttle_response(retry_after)

    staff, customer, is_ambiguous = _resolve_unified_login_accounts(email)
    if is_ambiguous:
        # Do not let a historical duplicate pick a potentially privileged account.
        _record_login_failure(request, email, "unified", staff)
        return _err("Invalid email or password", 401)

    account = staff or customer
    if not account or not account.is_active or not verify_password(password, account.password):
        _record_login_failure(request, email, "unified", staff)
        return _err("Invalid email or password", 401)

    clear_account_failures("password_login", email)
    if staff:
        if bool(getattr(staff, "two_factor_enabled", False)):
            return _start_staff_login_two_factor(request, staff, "unified", remember_me)
        return _issue_staff_login_response(staff, remember_me)

    # At this point the resolver guarantees that customer is the one valid account.
    if bool(getattr(customer, "two_factor_enabled", False)):
        return _start_customer_login_two_factor(request, customer, remember_me)
    return _issue_customer_login_response(customer, remember_me)


@csrf_exempt
@require_http_methods(["POST"])
def auth_unified_google(request: HttpRequest) -> JsonResponse:
    """Route a verified Google identity to its existing account type without provisioning."""
    body = _json_body(request)
    credential = str(body.get("credential") or body.get("idToken") or "").strip()
    remember_me = bool(body.get("rememberMe", False))
    if not credential:
        return _err("Google credential is required")
    if not (getattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "") or getattr(settings, "GOOGLE_OAUTH_CLIENT_IDS", [])):
        return _err("Google OAuth is not configured on the server", 500)

    try:
        claims = _verify_google_token(credential)
    except ValueError as exc:
        logger.warning("Invalid Google credential during unified auth: %s", str(exc))
        return _err(f"Invalid Google credential: {str(exc)}", 401)
    except Exception as exc:
        logger.exception("Google unified token verification failed: %s", str(exc))
        if getattr(settings, "DEBUG", False):
            return _err(f"Google authentication failed: {str(exc)}", 503)
        return _err("Google authentication service is temporarily unavailable", 503)

    email = _normalize_email(claims.get("email"))
    if not email:
        return _err("Google account email is unavailable")
    if claims.get("email_verified") is not True:
        return _err("Google email is not verified", 401)
    if not _is_gmail_email(email):
        return _err("Invalid email format (example@domain.com)")

    staff, customer, is_ambiguous = _resolve_unified_login_accounts(email)
    if is_ambiguous:
        # This endpoint is sign-in only. New customer creation remains on the
        # dedicated Customer registration flow, never the neutral staff page.
        return _err("Google account is not authorized for this system", 401)
    if not (staff or customer):
        return _err(NO_REGISTERED_ACCOUNT_MESSAGE, 401)

    if staff:
        if not staff.is_active:
            return _err("Google account is not authorized for this system", 401)
        if bool(getattr(staff, "two_factor_enabled", False)):
            return _start_staff_login_two_factor(request, staff, "unified", remember_me, include_email=True)
        return _issue_staff_login_response(staff, remember_me)

    if not customer.is_active:
        return _err("Google account is not authorized for this system", 401)
    if bool(getattr(customer, "two_factor_enabled", False)):
        return _start_customer_login_two_factor(request, customer, remember_me, include_email=True)
    return _issue_customer_login_response(customer, remember_me)


@csrf_exempt
@require_http_methods(["POST"])
def auth_register(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    remember_me = bool(body.get("rememberMe", False))
    first_name = str(body.get("firstName") or body.get("first_name") or "").strip()
    middle_name = str(body.get("middleName") or body.get("middle_name") or "").strip()
    last_name = str(body.get("lastName") or body.get("last_name") or "").strip()
    suffix = str(body.get("suffix") or "").strip()

    name = str(body.get("name", "")).strip()
    if _person_name_has_number(first_name, middle_name, last_name, suffix, name):
        # Fix: API callers cannot bypass the customer registration name rule.
        return _err(PERSON_NAME_NUMBER_ERROR, 400)
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
    # Customer registration no longer requires a separate administrator decision.
    return _issue_customer_login_response(
        customer,
        remember_me,
        message="Registration successful",
        status=201,
        created=True,
    )


@never_cache
@require_GET
def auth_me(request: HttpRequest) -> JsonResponse:
    # Fix: proxies must never reuse one tab's session identity for another account.
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
        # Pin a restored cookie session in the caller's tab before another staff login replaces it.
        return _ok({"success": True, "user": user_payload, "token": extract_token(request)})
    if p.get("type") == "customer":
        customer = Customer.objects.filter(id=p.get("userId"), is_active=True).first()
        if not customer:
            return _err("Unauthorized", 401)
        customer_payload = _customer_payload(customer)
        customer_payload["rememberMe"] = bool(p.get("rememberMe", False))
        # Fix: customer cookie restores need the same tab-local session pinning as staff.
        return _ok({"success": True, "user": customer_payload, "token": extract_token(request)})
    return _ok({"success": True, "user": p})


@csrf_exempt
@require_http_methods(["POST"])
def auth_logout(request: HttpRequest) -> JsonResponse:
    resp = _ok({"success": True, "message": "Logout successful"})
    payload = _require_auth(request)
    # Fix: cookie deletion alone cannot revoke a copied Bearer token.
    token = extract_token(request)
    if token:
        revoke_session(token)
    account_type = str((payload or {}).get("type") or "").strip().lower()
    # Clear only the signed-out portal's dedicated cookie; other portal sessions remain usable.
    portal = token_portal(payload or {})
    if portal:
        resp.delete_cookie(PORTAL_TOKEN_NAMES[portal], path="/")
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
    portal = str(body.get("portal", "")).strip().lower()

    if not email:
        return _err("Email is required")
    try:
        validate_email(email)
    except ValidationError:
        return _err("Please enter a valid email address")
    if account_type not in {"staff", "customer", "unified"}:
        return _err("accountType must be 'staff', 'customer', or 'unified'")
    portal_error = _password_reset_portal_error(account_type, portal)
    if portal_error:
        return _err(portal_error)
    if not _otp_mail_ready():
        return _err("OTP email service is not configured", 500)

    ip_address = get_client_ip(request)
    # Security: even requests for unknown addresses consume the allowance, which
    # prevents account discovery from becoming an unlimited email-probing path.
    retry_after = consume_event("password_reset_send", email, ip_address, OTP_SEND_POLICY)
    if retry_after:
        return throttle_response(retry_after)

    account = _get_reset_account(account_type, email, portal)
    if not account:
        return _err("Email is not registered for this portal", 404)

    now = timezone.now()
    otp_scope = _password_reset_otp_scope(account_type, portal)
    code = _stateless_otp_for_bucket(email, otp_scope, "password_reset", _otp_bucket(now))
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
    portal = str(body.get("portal", "")).strip().lower()
    otp_code = str(body.get("otp", "")).strip()
    new_password = str(body.get("newPassword", "")).strip()

    if not email:
        return _err("Email is required")
    if account_type not in {"staff", "customer", "unified"}:
        return _err("accountType must be 'staff', 'customer', or 'unified'")
    portal_error = _password_reset_portal_error(account_type, portal)
    if portal_error:
        return _err(portal_error)
    if not otp_code:
        return _err("OTP is required")
    password_error = _validate_password_strength(new_password)
    if password_error:
        return _err(password_error)

    ip_address = get_client_ip(request)
    retry_after = check_limit("password_reset_otp", email, ip_address, OTP_FAILURE_POLICY)
    if retry_after:
        return throttle_response(retry_after)

    account = _get_reset_account(account_type, email, portal)
    if not account:
        record_failure("password_reset_otp", email, ip_address, OTP_FAILURE_POLICY)
        return _err("Email is not registered for this portal", 404)

    now = timezone.now()
    otp_scope = _password_reset_otp_scope(account_type, portal)
    if not _is_valid_stateless_otp(otp_code, email, otp_scope, "password_reset", now):
        record_failure("password_reset_otp", email, ip_address, OTP_FAILURE_POLICY)
        return _err("Invalid or expired OTP", 400)
    clear_account_failures("password_reset_otp", email)

    from .models import ConsumedAuthProof
    proof_digest = hmac.new(_otp_secret().encode(), f"{email}|{otp_scope}|password_reset|{otp_code}".encode(), hashlib.sha256).hexdigest()
    with transaction.atomic():
        # The unique digest makes simultaneous reuse fail before changing the password.
        proof, created = ConsumedAuthProof.objects.get_or_create(
            digest=proof_digest,
            defaults={"purpose": "password_reset", "expires_at": now + timedelta(minutes=OTP_EXPIRY_MINUTES)},
        )
        if not created and proof.expires_at > now:
            return _err("Invalid or expired OTP", 400)
        if not created:
            # A later randomly recurring code may be used only after its old window ends.
            proof = ConsumedAuthProof.objects.select_for_update().get(pk=proof.pk)
            if proof.expires_at > now:
                return _err("Invalid or expired OTP", 400)
            proof.expires_at = now + timedelta(minutes=OTP_EXPIRY_MINUTES)
            proof.save(update_fields=["expires_at"])
        account.password = hash_password(new_password)
        account.save(update_fields=["password", "updated_at"])

    return _ok({"success": True, "message": "Password reset successful. Please log in."})


@csrf_exempt
@require_http_methods(["POST"])
def auth_password_reset_verify_otp(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    email = _normalize_email(body.get("email"))
    account_type = str(body.get("accountType", "")).strip().lower()
    portal = str(body.get("portal", "")).strip().lower()
    otp_code = str(body.get("otp", "")).strip()

    if not email:
        return _err("Email is required")
    if account_type not in {"staff", "customer", "unified"}:
        return _err("accountType must be 'staff', 'customer', or 'unified'")
    portal_error = _password_reset_portal_error(account_type, portal)
    if portal_error:
        return _err(portal_error)
    if not otp_code:
        return _err("OTP is required")

    ip_address = get_client_ip(request)
    retry_after = check_limit("password_reset_otp", email, ip_address, OTP_FAILURE_POLICY)
    if retry_after:
        return throttle_response(retry_after)

    if not _get_reset_account(account_type, email, portal):
        record_failure("password_reset_otp", email, ip_address, OTP_FAILURE_POLICY)
        return _err("Email is not registered for this portal", 404)

    now = timezone.now()
    otp_scope = _password_reset_otp_scope(account_type, portal)
    if not _is_valid_stateless_otp(otp_code, email, otp_scope, "password_reset", now):
        record_failure("password_reset_otp", email, ip_address, OTP_FAILURE_POLICY)
        return _err("Invalid or expired OTP", 400)
    clear_account_failures("password_reset_otp", email)

    return _ok({"success": True, "message": "OTP verified successfully."})
