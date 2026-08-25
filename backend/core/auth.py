import os
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from django.contrib.auth.hashers import check_password, make_password
from django.http import HttpRequest

TOKEN_NAME = "auth_token"
STAFF_TOKEN_NAME = "auth_token_staff"
CUSTOMER_TOKEN_NAME = "auth_token_customer"
TOKEN_EXP_HOURS = 24
# Keep-me-logged-in tokens expire after exactly 30 * 24 hours.
REMEMBER_ME_EXP_HOURS = 24 * 30


def hash_password(password: str) -> str:
    return make_password(password)


def verify_password(password: str, hashed: str) -> bool:
    return check_password(password, hashed)


def _jwt_secret() -> str:
    return os.getenv("JWT_SECRET", "logistics-management-secret-key-2024")


def create_token(payload: dict[str, Any], exp_hours: int = TOKEN_EXP_HOURS) -> str:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(hours=exp_hours)
    token_payload = {**payload, "iat": int(now.timestamp()), "exp": int(exp.timestamp())}
    return jwt.encode(token_payload, _jwt_secret(), algorithm="HS256")


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
    if path.startswith("/api/customer/"):
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
