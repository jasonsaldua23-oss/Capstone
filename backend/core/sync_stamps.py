"""Server-side change stamps that make portal data sync across devices.

Why this exists
---------------
Every portal view already refreshes itself from a shared client event bus
(``src/lib/data-sync.ts``). That bus is built on BroadcastChannel/localStorage,
so it is instant *within one browser* and invisible *between devices*: a
warehouse edit never reached the driver's phone or the customer's app. Screens
that needed cross-device freshness each grew their own timer, re-fetching whole
collections every 2-4 seconds, and the screens nobody hand-tuned never updated
at all until the user switched tabs.

This module gives each sync scope a monotonic revision that the server bumps
whenever data in that scope is written. A client detects "something changed"
with one indexed row read, then refreshes only the scopes that actually moved.

Completeness
------------
Two mechanisms feed the stamps, deliberately overlapping:

* model signals, which attribute a write to its scopes precisely and for free;
* a write-path middleware, which bumps scopes derived from the request URL.

Signals alone would silently miss ``QuerySet.update()``, ``bulk_create()`` and
raw SQL - and would keep missing whichever of those a future change introduces.
The middleware closes that hole by construction. A scope bumped twice for one
request costs nothing: clients diff revisions, so both bumps land in one refresh.
"""

from __future__ import annotations

import logging
from typing import Iterable

from datetime import timedelta

from django.db import DatabaseError, transaction
from django.db.models import F
from django.db.models.signals import post_delete, post_save
from django.http import HttpRequest, HttpResponse
from django.utils import timezone

logger = logging.getLogger(__name__)


# Mirrors the DataSyncScope union in src/lib/data-sync.ts. 'auth' and 'user' are
# deliberately absent: they describe this tab's own session, so a global bump
# would make every other device re-read an account it did not change.
SYNC_SCOPES: tuple[str, ...] = (
    "orders",
    "trips",
    "replacements",
    "inventory",
    "stocks",
    "stock-batches",
    "inventory-transactions",
    "products",
    "warehouses",
    "drivers",
    "vehicles",
    "customers",
    "feedback",
    "notifications",
    "tracking",
)

_VALID_SCOPES = frozenset(SYNC_SCOPES)

_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})


def _model_scope_map() -> dict[type, tuple[str, ...]]:
    """Map each watched model to the scopes a write to it invalidates.

    Imported lazily so this module stays importable before the app registry is
    ready (``apps.py`` imports it from ``ready()``).
    """
    from . import models as m

    return {
        # Orders, including retail POS sales, which are Orders on a retail channel.
        m.Order: ("orders",),
        m.OrderItem: ("orders",),
        m.OrderTimeline: ("orders",),
        m.OrderDepositRefundClaim: ("orders",),
        m.OrderDepositRefundRequest: ("orders",),
        # Stock. 'stocks' and 'inventory' are separate scopes in the portals but
        # describe one physical state, so they always move together.
        m.Inventory: ("inventory", "stocks"),
        m.InventoryReservation: ("inventory", "stocks"),
        m.StockBatch: ("stock-batches", "inventory", "stocks"),
        m.InventoryTransaction: ("inventory-transactions", "inventory", "stocks"),
        # Catalog.
        m.Product: ("products",),
        m.ProductPackaging: ("products",),
        m.ContainerType: ("products",),
        m.MixedCaseComponent: ("products",),
        m.PackagingProfile: ("products",),
        m.Warehouse: ("warehouses",),
        # Logistics.
        m.Trip: ("trips",),
        m.TripDropPoint: ("trips",),
        m.Vehicle: ("vehicles", "drivers"),
        m.DriverServiceArea: ("drivers",),
        # Staff accounts carry the driver records since the Driver model was folded in.
        m.User: ("drivers",),
        # Customer-facing records.
        m.Customer: ("customers",),
        m.CustomerBottleBalance: ("customers",),
        m.CustomerDepositLedger: ("customers",),
        m.DepositTransaction: ("customers", "orders"),
        m.BottleReturn: ("orders",),
        m.BottleReturnLine: ("orders",),
        m.Replacement: ("replacements",),
        m.ReplacementLine: ("replacements",),
        m.ReturnReceipt: ("replacements",),
        m.ReturnReceiptLine: ("replacements",),
        m.Feedback: ("feedback",),
        m.Notification: ("notifications",),
        # Intentionally unwatched: LocationLog is written every few seconds by every
        # active driver, so a bump per ping would defeat the point of a stamp. The
        # 'tracking' scope below carries those writes on a throttle instead.
    }


# Request paths whose scopes a write invalidates, longest matching prefix winning.
# This is the safety net for writes that never reach a model signal.
_PATH_SCOPES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("/api/orders", ("orders", "inventory", "stocks", "stock-batches")),
    ("/api/customer/orders", ("orders", "inventory", "stocks")),
    ("/api/customer/replacements", ("replacements", "orders")),
    ("/api/customer/empty-bottles", ("orders", "customers")),
    ("/api/bottle-returns", ("orders", "customers", "inventory", "stocks")),
    ("/api/replacements", ("replacements", "orders")),
    ("/api/trips", ("trips", "orders", "inventory", "stocks")),
    ("/api/driver/trips", ("trips", "orders")),
    ("/api/driver/profile", ("drivers",)),
    ("/api/retail", ("orders", "inventory", "stocks", "stock-batches", "products")),
    ("/api/inventory-transactions", ("inventory-transactions", "inventory", "stocks")),
    ("/api/inventory", ("inventory", "stocks", "stock-batches")),
    ("/api/stock-batches", ("stock-batches", "inventory", "stocks")),
    ("/api/products", ("products", "inventory", "stocks")),
    ("/api/warehouses", ("warehouses",)),
    ("/api/vehicles", ("vehicles", "drivers")),
    ("/api/drivers", ("drivers", "vehicles")),
    ("/api/users", ("drivers",)),
    ("/api/customers", ("customers",)),
    ("/api/feedback", ("feedback",)),
    ("/api/notifications", ("notifications",)),
    ("/api/uploads", ("orders", "replacements", "products")),
)

# Paths whose scopes advance at most once per window. A driver reports a position
# every few seconds, and several drivers report at once, so an un-throttled bump
# would ask every open portal to re-read on almost every poll. Throttled, the maps
# still see movement promptly without a request per ping.
_THROTTLED_PATH_SCOPES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("/api/driver/location", ("tracking",)),
)

TRACKING_BUMP_INTERVAL_SECONDS = 4


# Writes that must never bump a stamp: they either carry no portal-visible data
# or fire far too often to be a refresh trigger.
_PATH_SCOPES_EXCLUDED: tuple[str, ...] = (
    "/api/auth",
    "/api/driver/location",
    "/api/push-subscriptions",
    "/api/sync",
    "/api/health",
)


def scopes_for_path(path: str) -> tuple[str, ...]:
    """Resolve the scopes a write to ``path`` invalidates."""
    normalized = (path or "").rstrip("/") or "/"
    if any(normalized.startswith(prefix) for prefix in _PATH_SCOPES_EXCLUDED):
        return ()
    best: tuple[str, ...] = ()
    best_length = -1
    for prefix, scopes in _PATH_SCOPES:
        if normalized.startswith(prefix) and len(prefix) > best_length:
            best, best_length = scopes, len(prefix)
    return best


def throttled_scopes_for_path(path: str) -> tuple[str, ...]:
    """Resolve the scopes a write to ``path`` invalidates at most once per window."""
    normalized = (path or "").rstrip("/") or "/"
    for prefix, scopes in _THROTTLED_PATH_SCOPES:
        if normalized.startswith(prefix):
            return scopes
    return ()


def _apply_bump(scopes: tuple[str, ...]) -> None:
    from .models import SyncStamp

    try:
        updated = SyncStamp.objects.filter(scope__in=scopes).update(revision=F("revision") + 1)
        if updated != len(scopes):
            # A scope added after the last migration still has to work.
            existing = set(SyncStamp.objects.filter(scope__in=scopes).values_list("scope", flat=True))
            for scope in scopes:
                if scope not in existing:
                    SyncStamp.objects.get_or_create(scope=scope, defaults={"revision": 1})
    except DatabaseError:
        # Sync is an accelerator, never a reason to fail the user's write. Clients
        # still recover on focus and on their slow fallback refresh.
        logger.warning("Could not bump sync stamps for %s", ",".join(scopes), exc_info=True)


def bump_scopes(scopes: Iterable[str]) -> None:
    """Advance the revision of every valid scope in ``scopes``.

    The bump is deferred to commit so a client can never observe a new revision,
    re-fetch, and read the *old* rows - which would leave it permanently stale,
    because the revision it recorded on that read would never change again.
    """
    wanted = tuple(sorted({scope for scope in scopes if scope in _VALID_SCOPES}))
    if not wanted:
        return
    transaction.on_commit(lambda: _apply_bump(wanted))


def bump_scopes_throttled(scopes: Iterable[str], interval_seconds: int = TRACKING_BUMP_INTERVAL_SECONDS) -> None:
    """Advance ``scopes`` only if they have not advanced within the window.

    The filter and the write are one statement, so concurrent drivers reporting at
    the same moment produce one bump between them rather than one each. Unlike
    ``_apply_bump`` this writes ``updated_at``: for a throttled scope that column
    is what "when did this last move" means, and ``auto_now`` does not fire on an
    UPDATE.
    """
    from .models import SyncStamp

    wanted = tuple(sorted({scope for scope in scopes if scope in _VALID_SCOPES}))
    if not wanted:
        return
    now = timezone.now()
    cutoff = now - timedelta(seconds=interval_seconds)
    try:
        updated = SyncStamp.objects.filter(scope__in=wanted, updated_at__lte=cutoff).update(
            revision=F("revision") + 1, updated_at=now
        )
        if updated == len(wanted):
            return
        existing = set(SyncStamp.objects.filter(scope__in=wanted).values_list("scope", flat=True))
        for scope in wanted:
            if scope not in existing:
                SyncStamp.objects.create(scope=scope, revision=1, updated_at=now)
    except DatabaseError:
        logger.warning("Could not bump throttled sync stamps for %s", ",".join(wanted), exc_info=True)


def read_stamps() -> dict[str, int]:
    """Return every scope's current revision, defaulting unseeded scopes to 0."""
    from .models import SyncStamp

    stamps = {scope: 0 for scope in SYNC_SCOPES}
    for scope, revision in SyncStamp.objects.values_list("scope", "revision"):
        if scope in stamps:
            stamps[scope] = int(revision or 0)
    return stamps


class SyncStampMiddleware:
    """Bump the scopes a successful API write touched, whatever ORM path it used."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        response = self.get_response(request)
        if request.method in _SAFE_METHODS or not request.path.startswith("/api/"):
            return response
        # A rejected write changed nothing, so it must not wake every device.
        if response.status_code >= 400:
            return response
        scopes = scopes_for_path(request.path)
        if scopes:
            # The view's transaction has already committed by the time the response
            # reaches this middleware, so apply the bump directly.
            _apply_bump(tuple(sorted(set(scopes))))
        throttled = throttled_scopes_for_path(request.path)
        if throttled:
            bump_scopes_throttled(throttled)
        return response


_MODEL_SCOPES: dict[type, tuple[str, ...]] = {}

# Saves that touch only these fields change nothing any portal displays. Every
# sign-in writes last_login_at, so without this a login would make all connected
# devices reload their staff and customer lists.
_BOOKKEEPING_FIELDS = frozenset({"last_login_at", "updated_at"})


def _on_model_write(sender, instance, update_fields=None, **kwargs) -> None:
    scopes = _MODEL_SCOPES.get(type(instance), ())
    if not scopes:
        return
    if update_fields and set(update_fields) <= _BOOKKEEPING_FIELDS:
        return
    bump_scopes(scopes)


def register_signals() -> None:
    """Attach stamp bumping to every watched model. Safe to call once, at startup."""
    global _MODEL_SCOPES
    _MODEL_SCOPES = _model_scope_map()
    for model in _MODEL_SCOPES:
        label = model._meta.label_lower
        post_save.connect(_on_model_write, sender=model, dispatch_uid=f"sync-stamp-save-{label}")
        post_delete.connect(_on_model_write, sender=model, dispatch_uid=f"sync-stamp-delete-{label}")
