"""Persistent rate limits, progressive delays, and lockouts for auth endpoints."""

import hashlib
import math
from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.http import HttpRequest, JsonResponse
from django.utils import timezone

from .models import AuthThrottleState


@dataclass(frozen=True)
class ThrottlePolicy:
    account_limit: int
    ip_limit: int
    window_seconds: int
    lockout_seconds: int
    progressive_delay: bool = False


@dataclass(frozen=True)
class FailureResult:
    account_count: int
    retry_after: int


# Security: login failures slow down exponentially before the temporary lockout.
LOGIN_FAILURE_POLICY = ThrottlePolicy(5, 20, 15 * 60, 15 * 60, progressive_delay=True)
OTP_SEND_POLICY = ThrottlePolicy(3, 10, 15 * 60, 15 * 60)
OTP_FAILURE_POLICY = ThrottlePolicy(5, 20, 15 * 60, 15 * 60, progressive_delay=True)


def get_client_ip(request: HttpRequest) -> str:
    """Return the originating address supplied by the trusted deployment proxy."""
    forwarded = str(request.META.get("HTTP_X_FORWARDED_FOR", "") or "").split(",", 1)[0].strip()
    return forwarded or str(request.META.get("REMOTE_ADDR", "") or "unknown").strip() or "unknown"


def _identifier_hash(scope: str, identifier: str) -> str:
    normalized = str(identifier or "unknown").strip().lower()
    return hashlib.sha256(f"{scope}:{normalized}".encode("utf-8")).hexdigest()


def _state_key(action: str, scope: str, identifier: str) -> tuple[str, str]:
    identifier_hash = _identifier_hash(scope, identifier)
    key = hashlib.sha256(f"{action}:{scope}:{identifier_hash}".encode("utf-8")).hexdigest()
    return key, identifier_hash


def _identifiers(account: str, ip_address: str) -> tuple[tuple[str, str], ...]:
    return (("account", account), ("ip", ip_address))


def _limit_for(policy: ThrottlePolicy, scope: str) -> int:
    return policy.account_limit if scope == "account" else policy.ip_limit


def _retry_seconds(blocked_until) -> int:
    return max(1, math.ceil((blocked_until - timezone.now()).total_seconds()))


def throttle_response(retry_after: int) -> JsonResponse:
    # The standard header lets browsers and API clients know exactly when to retry.
    response = JsonResponse(
        {"success": False, "error": f"Too many attempts. Try again in {retry_after} seconds."},
        status=429,
    )
    response["Retry-After"] = str(max(1, retry_after))
    return response


def check_limit(action: str, account: str, ip_address: str, policy: ThrottlePolicy) -> int:
    """Return the longest active account/IP delay, or zero when allowed."""
    now = timezone.now()
    retry_after = 0
    for scope, identifier in _identifiers(account, ip_address):
        key, _ = _state_key(action, scope, identifier)
        state = AuthThrottleState.objects.filter(key=key).only("blocked_until").first()
        if state and state.blocked_until and state.blocked_until > now:
            retry_after = max(retry_after, _retry_seconds(state.blocked_until))
    return retry_after


def _locked_state(action: str, scope: str, identifier: str, now) -> AuthThrottleState:
    key, identifier_hash = _state_key(action, scope, identifier)
    # get_or_create handles the first request; select_for_update serializes later
    # updates so concurrent workers cannot bypass the configured attempt count.
    AuthThrottleState.objects.get_or_create(
        key=key,
        defaults={
            "action": action,
            "scope": scope,
            "identifier_hash": identifier_hash,
            "window_started_at": now,
            "last_attempt_at": now,
        },
    )
    return AuthThrottleState.objects.select_for_update().get(key=key)


def _advance_state(
    action: str,
    scope: str,
    identifier: str,
    policy: ThrottlePolicy,
    failure: bool,
) -> tuple[int, int, bool]:
    now = timezone.now()
    with transaction.atomic():
        state = _locked_state(action, scope, identifier, now)
        window_end = state.window_started_at + timedelta(seconds=policy.window_seconds)
        if now >= window_end:
            state.attempt_count = 0
            state.window_started_at = now
            state.blocked_until = None
            window_end = now + timedelta(seconds=policy.window_seconds)

        # A second concurrent worker must observe the first worker's lock before
        # incrementing or sending another OTP.
        if state.blocked_until and state.blocked_until > now:
            return state.attempt_count, _retry_seconds(state.blocked_until), False

        state.attempt_count += 1
        state.last_attempt_at = now
        limit = _limit_for(policy, scope)
        if state.attempt_count >= limit:
            state.blocked_until = now + timedelta(seconds=policy.lockout_seconds)
        elif failure and policy.progressive_delay:
            # 10, 20, 40, 60... seconds. Starting at ten seconds ensures the
            # delay remains meaningful even when password hashing is deliberately slow.
            delay = min(10 * (2 ** max(0, state.attempt_count - 1)), 60)
            state.blocked_until = now + timedelta(seconds=delay)
        elif state.blocked_until and state.blocked_until <= now:
            state.blocked_until = None

        state.save(
            update_fields=["attempt_count", "window_started_at", "last_attempt_at", "blocked_until"]
        )
        retry_after = _retry_seconds(state.blocked_until) if state.blocked_until and state.blocked_until > now else 0
        return state.attempt_count, retry_after, True


def record_failure(action: str, account: str, ip_address: str, policy: ThrottlePolicy) -> FailureResult:
    account_count = 0
    retry_after = 0
    for scope, identifier in _identifiers(account, ip_address):
        count, scope_retry, _ = _advance_state(action, scope, identifier, policy, failure=True)
        if scope == "account":
            account_count = count
        retry_after = max(retry_after, scope_retry)
    return FailureResult(account_count=account_count, retry_after=retry_after)


def consume_event(action: str, account: str, ip_address: str, policy: ThrottlePolicy) -> int:
    """Count a permitted OTP send; the request reaching the limit still succeeds."""
    for scope, identifier in _identifiers(account, ip_address):
        _, retry_after, allowed = _advance_state(action, scope, identifier, policy, failure=False)
        if not allowed:
            return retry_after
    return 0


def clear_account_failures(action: str, account: str) -> None:
    # Keep the IP counter to continue detecting credential-stuffing across accounts.
    key, _ = _state_key(action, "account", account)
    AuthThrottleState.objects.filter(key=key).delete()


def claim_account_alert(action: str, account: str, cooldown_seconds: int = 15 * 60) -> bool:
    """Atomically claim one alert delivery per account and cooldown window."""
    key, _ = _state_key(action, "account", account)
    now = timezone.now()
    with transaction.atomic():
        state = AuthThrottleState.objects.select_for_update().filter(key=key).first()
        if not state:
            return False
        if state.alert_sent_at and state.alert_sent_at + timedelta(seconds=cooldown_seconds) > now:
            return False
        state.alert_sent_at = now
        state.save(update_fields=["alert_sent_at"])
        return True
