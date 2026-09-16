"""Stateless OTP derivation and email-verification token signing."""

import hashlib
import hmac
from datetime import datetime, timedelta
from typing import Any

from django.conf import settings
from django.utils import timezone

from . import views_api as legacy
from .api_constants import EMAIL_VERIFICATION_TOKEN_HOURS, OTP_EXPIRY_MINUTES
from .auth import create_token, decode_token


# Helpers owned by sibling modules. Routing them through views_api keeps
# a single resolution point, so tests that patch there still apply.


def _normalize_email(value: Any) -> str:
    return legacy._normalize_email(value)


def _otp_secret() -> str:
    return str(getattr(settings, "OTP_SECRET_KEY", "") or settings.SECRET_KEY)


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
    # Fix: a successful reset consumes its account/purpose-scoped proof across workers.
    from .models import ConsumedAuthProof
    proof_digest = hmac.new(_otp_secret().encode(), f"{email}|{account_type}|{purpose}|{candidate}".encode(), hashlib.sha256).hexdigest()
    if ConsumedAuthProof.objects.filter(digest=proof_digest, expires_at__gt=current).exists():
        return False
    # Use the shared rolling window so backend validation matches the displayed expiry.
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
