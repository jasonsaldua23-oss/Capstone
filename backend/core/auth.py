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
        return auth_header[7:].strip() or None

    # Role-scoped cookie fallback allows concurrent customer + staff sessions.
    path = str(getattr(request, "path", "") or "")
    preferred_cookie = CUSTOMER_TOKEN_NAME if path.startswith("/api/customer/") else STAFF_TOKEN_NAME
    cookie_token = request.COOKIES.get(preferred_cookie)
    if cookie_token:
        return cookie_token

    # Backward compatibility fallback for older shared cookie.
    legacy_cookie = request.COOKIES.get(TOKEN_NAME)
    if legacy_cookie:
        return legacy_cookie
    return None
