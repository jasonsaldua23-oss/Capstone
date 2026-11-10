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
    keys = [_state_key(action, scope, identifier)[0] for scope, identifier in _identifiers(account, ip_address)]
    # One query for both scopes: every statement is a full round trip to the remote database.
    blocked = AuthThrottleState.objects.filter(key__in=keys, blocked_until__gt=now).values_list("blocked_until", flat=True)
    return max((_retry_seconds(until) for until in blocked), default=0)


@dataclass(frozen=True)
class _ScopeOutcome:
    scope: str
    attempt_count: int
    retry_after: int
    allowed: bool


_ADVANCED_FIELDS = ["attempt_count", "window_started_at", "last_attempt_at", "blocked_until"]


def _lock_states(keys: list[str]) -> dict[str, AuthThrottleState]:
    # Lock in key order so two requests sharing a row (one IP, two accounts) can never deadlock.
    rows = AuthThrottleState.objects.select_for_update().filter(key__in=keys).order_by("key")
    return {row.key: row for row in rows}


def _apply_attempt(state: AuthThrottleState, scope: str, policy: ThrottlePolicy, failure: bool, now) -> tuple[_ScopeOutcome, bool]:
    """Advance one locked counter in memory; the bool says whether it must be written back."""
    window_end = state.window_started_at + timedelta(seconds=policy.window_seconds)
    if now >= window_end:
        state.attempt_count = 0
        state.window_started_at = now
        state.blocked_until = None

    # A second concurrent worker must observe the first worker's lock before
    # incrementing or sending another OTP.
    if state.blocked_until and state.blocked_until > now:
        return _ScopeOutcome(scope, state.attempt_count, _retry_seconds(state.blocked_until), False), False

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

    retry_after = _retry_seconds(state.blocked_until) if state.blocked_until and state.blocked_until > now else 0
    return _ScopeOutcome(scope, state.attempt_count, retry_after, True), True


def _advance_states(
    action: str,
    account: str,
    ip_address: str,
    policy: ThrottlePolicy,
    *,
    failure: bool,
    stop_when_blocked: bool,
) -> list[_ScopeOutcome]:
    """Advance the account counter, then the IP counter, in a single transaction.

    Why one transaction: this runs on every OTP send and every login, against a
    database that is a network round trip away. Counting each scope in its own
    transaction with get_or_create + select_for_update + save cost 10 statements
    per call (16 on a first send), which was most of a verification-code request.
    This is 4 when both rows exist and 6 when either must be created.
    """
    now = timezone.now()
    targets = []
    for scope, identifier in _identifiers(account, ip_address):
        key, identifier_hash = _state_key(action, scope, identifier)
        targets.append((scope, key, identifier_hash))
    keys = [key for _, key, _ in targets]

    outcomes: list[_ScopeOutcome] = []
    with transaction.atomic():
        states = _lock_states(keys)
        missing = sorted((key, scope, identifier_hash) for scope, key, identifier_hash in targets if key not in states)
        if missing:
            # ON CONFLICT DO NOTHING absorbs a concurrent first request; the re-select
            # then locks whichever row won, so the attempt count stays serialized.
            AuthThrottleState.objects.bulk_create(
                [
                    AuthThrottleState(
                        key=key,
                        action=action,
                        scope=scope,
                        identifier_hash=identifier_hash,
                        attempt_count=0,
                        window_started_at=now,
                        last_attempt_at=now,
                    )
                    for key, scope, identifier_hash in missing
                ],
                ignore_conflicts=True,
            )
            states = _lock_states(keys)

        changed = []
        for scope, key, _ in targets:
            state = states[key]
            outcome, dirty = _apply_attempt(state, scope, policy, failure, now)
            outcomes.append(outcome)
            if dirty:
                changed.append(state)
            if stop_when_blocked and not outcome.allowed:
                break
        if changed:
            AuthThrottleState.objects.bulk_update(changed, _ADVANCED_FIELDS)
    return outcomes


def record_failure(action: str, account: str, ip_address: str, policy: ThrottlePolicy) -> FailureResult:
    outcomes = _advance_states(action, account, ip_address, policy, failure=True, stop_when_blocked=False)
    account_count = next((o.attempt_count for o in outcomes if o.scope == "account"), 0)
    return FailureResult(account_count=account_count, retry_after=max((o.retry_after for o in outcomes), default=0))


def consume_event(action: str, account: str, ip_address: str, policy: ThrottlePolicy) -> int:
    """Count a permitted OTP send; the request reaching the limit still succeeds."""
    # A blocked account stops before the IP counter is touched, as before.
    for outcome in _advance_states(action, account, ip_address, policy, failure=False, stop_when_blocked=True):
        if not outcome.allowed:
            return outcome.retry_after
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
