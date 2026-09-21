"""Trip scheduling and fleet-status rules shared by the trip endpoints.

The driver portal, the trip serializer and ``trip_start`` must agree on the
day a trip is due and on whether the truck is still on the road, so the rules
live here instead of being repeated in each view.
"""

from datetime import date, datetime
from typing import Any, Iterable

from django.utils import timezone

from .models import Trip, TripStatus, Vehicle, VehicleStatus

# Drop points in these states no longer need the driver to do anything.
TERMINAL_DROP_POINT_STATUSES = frozenset({"COMPLETED", "FAILED", "SKIPPED", "CANCELLED"})

# Vehicle states an operator set by hand; the trip lifecycle never overrides them.
MANUAL_VEHICLE_STATUSES = frozenset({VehicleStatus.MAINTENANCE, VehicleStatus.OUT_OF_SERVICE})


def local_date_of(value: datetime | date | None) -> date | None:
    """Philippine calendar day of a scheduling timestamp (aware, naive or date)."""
    if not value:
        return None
    if isinstance(value, datetime):
        return timezone.localdate(value) if timezone.is_aware(value) else value.date()
    return value


def trip_scheduled_date(trip: Trip, drop_points: Iterable[Any] | None = None) -> date | None:
    """The local day a trip is due, exactly as ``trip_start`` enforces it.

    The earliest order delivery date among the drop points defines the day;
    ``planned_start_at`` only covers trips that predate order-driven scheduling.
    Pass ``drop_points`` when the rows are already loaded to avoid a re-query.
    """
    rows = drop_points if drop_points is not None else trip.drop_points.all()
    candidates = [
        point.order.timeline.delivery_date
        for point in rows
        if getattr(point, "order_id", None)
        and getattr(point, "order", None)
        and getattr(point.order, "timeline", None)
        and point.order.timeline.delivery_date
    ]
    return local_date_of(min(candidates) if candidates else getattr(trip, "planned_start_at", None))


def trip_is_overdue(status: str | None, scheduled_date: date | None, today: date | None = None) -> bool:
    """A planned trip whose day has passed can no longer be started."""
    if str(status or "").strip().upper() != TripStatus.PLANNED or scheduled_date is None:
        return False
    return scheduled_date < (today or timezone.localdate())


def sync_vehicle_status(vehicle: Vehicle | None) -> str | None:
    """Reconcile one vehicle's AVAILABLE/IN_USE flag with its in-progress trips.

    Idempotent: a truck on any IN_PROGRESS trip reads IN_USE, an IN_USE truck
    with no running trip goes back to AVAILABLE, and MAINTENANCE/OUT_OF_SERVICE
    are left exactly as the fleet operator set them.
    """
    if vehicle is None:
        return None
    current = str(vehicle.status or "").strip().upper()
    if current in MANUAL_VEHICLE_STATUSES:
        return current
    has_active_trip = Trip.objects.filter(vehicle_id=vehicle.id, status=TripStatus.IN_PROGRESS).exists()
    if has_active_trip:
        next_status = VehicleStatus.IN_USE
    elif current == VehicleStatus.IN_USE:
        next_status = VehicleStatus.AVAILABLE
    else:
        next_status = current
    if next_status != current:
        vehicle.status = next_status
        vehicle.save(update_fields=["status", "updated_at"])
    return next_status


def sync_vehicle_status_for_trip(trip: Trip | None) -> str | None:
    """Reconcile the vehicle of a trip whose status just changed."""
    vehicle_id = getattr(trip, "vehicle_id", None)
    if not vehicle_id:
        return None
    # Re-read the row: the trip's cached vehicle may predate an operator's status change.
    return sync_vehicle_status(Vehicle.objects.filter(id=vehicle_id).first())
