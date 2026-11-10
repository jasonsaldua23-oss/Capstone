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


def uncovered_deposit(
    *,
    deposit_value: Any,
    shell_value: Any,
    bottles: int,
    cases: int,
    bottles_returned: int,
    cases_returned: int,
) -> Decimal:
    """Deposit still owed for the containers not handed back.

    deposit_value is the deposit for all `bottles` (in `cases` shells), shells included,
    and shell_value is the shells' part of it. Each missing bottle costs the bottle
    deposit and each missing case its shell, so a case handed back one bottle short
    costs one bottle's deposit, never a 24th of the whole case's.
    """
    bottle_count = max(0, int(bottles or 0))
    if bottle_count <= 0:
        return Decimal("0.00")
    case_count = max(0, int(cases or 0))
    total = max(Decimal("0.00"), Decimal(str(deposit_value or 0)))
    shells = min(max(Decimal("0.00"), Decimal(str(shell_value or 0))), total) if case_count > 0 else Decimal("0.00")
    short_bottles = max(0, bottle_count - max(0, int(bottles_returned or 0)))
    value = (total - shells) * Decimal(short_bottles) / Decimal(bottle_count)
    if case_count > 0:
        short_cases = max(0, case_count - max(0, int(cases_returned or 0)))
        value += shells * Decimal(short_cases) / Decimal(case_count)
    return money(value)


def cases_returned_from_bottles(
    bottles_returned: int,
    *,
    cases: int,
    loose_bottles: int,
    containers_per_case: int,
) -> int:
    """Cases handed back when only a bottle count is known.

    A part-filled case still comes back in its shell; loose bottles are not in one.
    """
    in_cases = max(0, int(bottles_returned or 0) - max(0, int(loose_bottles or 0)))
    return min(max(0, int(cases or 0)), -(-in_cases // max(1, int(containers_per_case or 1))))


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
