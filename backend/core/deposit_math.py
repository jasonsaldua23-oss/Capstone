"""Shared arithmetic for bottle and physical-case deposits."""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any


MONEY = Decimal("0.01")


def money(value: Any) -> Decimal:
    """Normalize a deposit value to the system's two-decimal currency precision."""
    return Decimal(str(value or 0)).quantize(MONEY, rounding=ROUND_HALF_UP)


def full_case_deposit(
    bottle_deposit: Any,
    containers_per_case: Any,
    case_deposit: Any,
) -> Decimal:
    """Return bottle deposits for a full case plus its physical-case deposit."""
    capacity = max(1, int(containers_per_case or 1))
    return money((money(bottle_deposit) * Decimal(capacity)) + money(case_deposit))


def deposit_for_case_and_bottles(
    *,
    cases: Any,
    loose_bottles: Any,
    bottle_deposit: Any,
    containers_per_case: Any,
    case_deposit: Any,
) -> Decimal:
    """Price explicit cases and loose bottles without treating a case as one bottle."""
    case_count = max(0, int(cases or 0))
    bottle_count = max(0, int(loose_bottles or 0))
    return money(
        full_case_deposit(bottle_deposit, containers_per_case, case_deposit) * Decimal(case_count)
        + money(bottle_deposit) * Decimal(bottle_count)
    )


def deposit_for_container_count(
    container_count: Any,
    *,
    bottle_deposit: Any,
    containers_per_case: Any,
    case_deposit: Any,
    include_case_deposit: bool,
) -> Decimal:
    """Price bottles, adding one physical-case deposit for each complete case."""
    count = max(0, int(container_count or 0))
    capacity = max(1, int(containers_per_case or 1))
    if not include_case_deposit:
        return money(money(bottle_deposit) * Decimal(count))
    cases, loose_bottles = divmod(count, capacity)
    return deposit_for_case_and_bottles(
        cases=cases,
        loose_bottles=loose_bottles,
        bottle_deposit=bottle_deposit,
        containers_per_case=capacity,
        case_deposit=case_deposit,
    )
