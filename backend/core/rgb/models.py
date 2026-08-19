"""Compatibility exports for the RGB feature package.

The database tables belong to the existing ``core`` Django app. Keeping the
actual declarations in ``core.models`` ensures migrations and runtime ORM state
use one app label and one schema.
"""

from ..models import (
    BottleReturn,
    BottleReturnLine,
    ContainerType,
    CustomerBottleBalance,
    CustomerDepositLedger,
    DepositTransaction,
    ProductPackaging,
)

__all__ = [
    "BottleReturn",
    "BottleReturnLine",
    "ContainerType",
    "CustomerBottleBalance",
    "CustomerDepositLedger",
    "DepositTransaction",
    "ProductPackaging",
]
