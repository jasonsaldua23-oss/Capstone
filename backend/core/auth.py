import os
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from django.contrib.auth.hashers import check_password, make_password
from django.http import HttpRequest
from django.core.exceptions import ImproperlyConfigured

TOKEN_NAME = "auth_token"
STAFF_TOKEN_NAME = "auth_token_staff"
CUSTOMER_TOKEN_NAME = "auth_token_customer"
# Each portal retains its own HttpOnly session when all four accounts share a browser.
PORTAL_TOKEN_NAMES = {
    "admin": "auth_token_admin",
    "warehouse": "auth_token_warehouse",
    "driver": "auth_token_driver",
    "customer": CUSTOMER_TOKEN_NAME,
}


def token_portal(payload: dict[str, Any]) -> str | None:
    if payload.get("type") == "customer":
        return "customer"
    if payload.get("type") != "staff":
        return None
    return {"ADMIN": "admin", "WAREHOUSE_STAFF": "warehouse", "DRIVER": "driver"}.get(
        str(payload.get("role") or "").strip().upper()
    )

TOKEN_EXP_HOURS = 24
# Keep-me-logged-in tokens expire after exactly 30 * 24 hours.
REMEMBER_ME_EXP_HOURS = 24 * 30

# Session JWTs are returned both in the response body and an HttpOnly cookie.
# Keep only authorization claims here; profile data belongs in /api/auth/me.
_SESSION_CLAIM_KEYS = ("userId", "email", "name", "role", "type", "rememberMe", "idleLogout")

# A web session without "Keep me logged in" ends after this long with no user
# activity. Staff can raise their own limit; customers have no setting.
DEFAULT_IDLE_MINUTES = 30
MIN_IDLE_MINUTES = 5
# The web portal marks every API request with this header. The Expo apps and the
# native GPS service do not, so their unremembered sessions keep ending only when
# the app restarts or the token expires, as they always have.
SESSION_CLIENT_HEADER = "X-Session-Client"


def idle_logout_requested(request: HttpRequest, remember_me: bool) -> bool:
    """Whether a new session gets the server-enforced idle limit."""
    client = str(request.headers.get(SESSION_CLIENT_HEADER, "")).strip().lower()
    return not remember_me and client == "web"


def session_idle_minutes(account) -> int:
    try:
        minutes = int(getattr(account, "session_timeout_minutes", None) or DEFAULT_IDLE_MINUTES)
    except (TypeError, ValueError):
        minutes = DEFAULT_IDLE_MINUTES
    return max(MIN_IDLE_MINUTES, minutes)


def _last_session_activity(payload: dict[str, Any]) -> datetime:
    from .models import SessionActivity
    last_active_at = (
        SessionActivity.objects.filter(jti=str(payload.get("jti") or ""))
        .values_list("last_active_at", flat=True)
        .first()
    )
    # No recorded activity yet: the session has been idle since it was issued.
    return last_active_at or datetime.fromtimestamp(int(payload.get("iat") or 0), timezone.utc)


def session_idle_remaining_seconds(payload: dict[str, Any], account) -> float | None:
    """Seconds left before an idle-limited session expires; None when no limit applies."""
    if not payload.get("idleLogout"):
        return None
    idle_seconds = (datetime.now(timezone.utc) - _last_session_activity(payload)).total_seconds()
    return session_idle_minutes(account) * 60 - idle_seconds


def record_session_activity(payload: dict[str, Any]) -> None:
    """Restart an idle-limited session's clock. Every tab and worker shares it."""
    from .models import SessionActivity
    jti = str(payload.get("jti") or "")
    if not payload.get("idleLogout") or not jti or not payload.get("exp"):
        return
    SessionActivity.objects.bulk_create(
        [SessionActivity(
            jti=jti,
            last_active_at=datetime.now(timezone.utc),
            expires_at=datetime.fromtimestamp(int(payload["exp"]), timezone.utc),
        )],
        update_conflicts=True,
        unique_fields=["jti"],
        update_fields=["last_active_at"],
    )


def hash_password(password: str) -> str:
    return make_password(password)


def verify_password(password: str, hashed: str) -> bool:
    return check_password(password, hashed)


def _jwt_secret() -> str:
    secret = os.getenv("JWT_SECRET", "").strip()
    # Fix: public defaults must never sign sessions or email-verification proofs.
    if len(secret) < 32 or secret == "logistics-management-secret-key-2024":
        raise ImproperlyConfigured("JWT_SECRET must be a private random secret of at least 32 characters")
    return secret


def _session_account(payload):
    from .models import Customer, User
    model = {"staff": User, "customer": Customer}.get(payload.get("type"))
    return model.objects.filter(id=payload.get("userId"), is_active=True).first() if model and payload.get("userId") else None


def _account_fingerprint(account) -> str:
    # A password/email/role/2FA change invalidates old sessions without storing password material in JWTs.
    state = f"{account.pk}|{account.password}|{account.email}|{getattr(account, 'role', 'CUSTOMER')}|{account.two_factor_enabled}"
    return hmac.new(_jwt_secret().encode(), state.encode(), hashlib.sha256).hexdigest()


def create_token(payload: dict[str, Any], exp_hours: int = TOKEN_EXP_HOURS) -> str:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(hours=exp_hours)
    is_session = payload.get("type") in {"staff", "customer"}
    token_claims = (
        {key: payload[key] for key in _SESSION_CLAIM_KEYS if key in payload}
        if is_session
        else dict(payload)
    )
    token_payload = {**token_claims, "iat": int(now.timestamp()), "exp": int(exp.timestamp())}
    if is_session:
        account = _session_account(payload)
        if account:
            token_payload["accountState"] = _account_fingerprint(account)
        # Independent logins in the same second must remain independently revocable.
        token_payload["jti"] = secrets.token_urlsafe(24)
    return jwt.encode(token_payload, _jwt_secret(), algorithm="HS256")


def decode_session(token: str) -> dict[str, Any] | None:
    from .models import ConsumedAuthProof
    payload = decode_token(token)
    if not payload or payload.get("type") not in {"staff", "customer"}:
        return None
    account = _session_account(payload)
    if not account or not hmac.compare_digest(str(payload.get("accountState") or ""), _account_fingerprint(account)):
        return None
    if ConsumedAuthProof.objects.filter(digest=hashlib.sha256(token.encode()).hexdigest()).exists():
        return None
    remaining = session_idle_remaining_seconds(payload, account)
    if remaining is not None and remaining <= 0:
        return None
    if payload["type"] == "staff":
        payload["role"] = account.role
    return payload


def revoke_session(token: str) -> None:
    from .models import ConsumedAuthProof
    payload = decode_token(token)
    if payload and payload.get("type") in {"staff", "customer"} and payload.get("exp"):
        ConsumedAuthProof.objects.get_or_create(
            digest=hashlib.sha256(token.encode()).hexdigest(),
            defaults={"purpose": "session", "expires_at": datetime.fromtimestamp(payload["exp"], timezone.utc)},
        )


def decode_token(token: str) -> dict[str, Any] | None:
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=["HS256"])
        return payload
    except jwt.PyJWTError:
        return None


def extract_token(request: HttpRequest) -> str | None:
    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip()
        if token:
            return token

    # Role-scoped cookie fallback allows concurrent customer + staff sessions.
    path = str(getattr(request, "path", "") or "")
    # The remembered portal selects a cookie, never a role or permission. JWT
    # verification and endpoint authorization still validate the selected session.
    portal = str(request.headers.get("X-Portal", "")).lower()
    if portal in PORTAL_TOKEN_NAMES:
        # Legacy cookies may restore only the requested role, never another signed-in portal.
        for name in [PORTAL_TOKEN_NAMES[portal], STAFF_TOKEN_NAME, CUSTOMER_TOKEN_NAME, TOKEN_NAME]:
            raw = request.COOKIES.get(name)
            payload = decode_token(raw) if raw else None
            if payload and token_portal(payload) == portal:
                return raw
        return None
    if portal in {"admin", "warehouse", "driver"}:
        candidate_cookie_names = [STAFF_TOKEN_NAME, TOKEN_NAME]
    elif portal == "customer":
        candidate_cookie_names = [CUSTOMER_TOKEN_NAME, TOKEN_NAME]
    elif path.startswith("/api/customer/"):
        candidate_cookie_names = [CUSTOMER_TOKEN_NAME, STAFF_TOKEN_NAME, TOKEN_NAME]
    elif path.startswith(("/api/staff/", "/api/warehouse/", "/api/driver/", "/api/admin/")):
        candidate_cookie_names = [STAFF_TOKEN_NAME, CUSTOMER_TOKEN_NAME, TOKEN_NAME]
    else:
        # Shared endpoints (e.g. /api/auth/me, /api/replacements, /api/feedback, /api/notifications, /api/customers/, /api/mixed-cases/, /api/uploads/):
        # Check both customer and staff cookie tokens
        candidate_cookie_names = [CUSTOMER_TOKEN_NAME, STAFF_TOKEN_NAME, TOKEN_NAME]

    # Find the first candidate cookie that decodes to a valid session
    for cookie_name in candidate_cookie_names:
        raw_cookie = request.COOKIES.get(cookie_name)
        if raw_cookie and decode_token(raw_cookie) is not None:
            return raw_cookie

    # Fallback to the first existing cookie even if expired/invalid
    for cookie_name in candidate_cookie_names:
        raw_cookie = request.COOKIES.get(cookie_name)
        if raw_cookie:
            return raw_cookie

    return None
