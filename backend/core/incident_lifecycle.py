"""What a vehicle incident report does to its trip, and the trip to it.

Two rules, shared by the stop update, trip completion, cancellation and load transfer:

* A truck that cannot move stops its driver. While the trip's latest incident says
  the vehicle cannot continue (until the warehouse clears it as resumed), or the
  warehouse has sent the truck for repair, the driver cannot move on to another
  stop. A stop already reached can still be settled: the goods are at that door.
  The warehouse then transfers the load, cancels the trip, or clears the truck.
* A trip does not end with its incident open. Whoever ends it closes it - except a
  driver completing a trip whose truck is stranded (say it broke down on the way
  back): the truck is still where the map pin is, so that incident stays open
  until the warehouse has dealt with the truck.
"""

from __future__ import annotations

from datetime import datetime

from django.utils import timezone

from .models import User, VehicleIncident

OPEN_STATUSES = (VehicleIncident.Status.REPORTED, VehicleIncident.Status.ACKNOWLEDGED)


def stopping_incident(trip_id: str) -> VehicleIncident | None:
    """The incident that keeps this trip's vehicle from moving on, if any."""
    latest = VehicleIncident.objects.filter(trip_id=trip_id).order_by("-created_at", "-id").first()
    if latest is None:
        return None
    if latest.status in OPEN_STATUSES and not latest.vehicle_can_continue:
        return latest
    if latest.status == VehicleIncident.Status.RESOLVED and latest.resolution_outcome == VehicleIncident.Outcome.SENT_FOR_REPAIR:
        return latest
    return None


def stopped_vehicle_message(incident: VehicleIncident) -> str:
    if incident.status == VehicleIncident.Status.RESOLVED:
        return "Your vehicle was sent for repair. Wait for the warehouse to send another truck or cancel the trip."
    return (
        "Your vehicle was reported unable to continue. Wait for the warehouse to send another truck, "
        "cancel the trip, or clear this vehicle to continue."
    )


def close_open_incidents(
    trip_id: str,
    *,
    outcome: str,
    notes: str,
    actor: User | None,
    only_if_vehicle_can_continue: bool = False,
    now: datetime | None = None,
) -> list[VehicleIncident]:
    """Resolve the trip's open incidents. Call inside the transaction that ends the trip.

    ``actor`` is the staff member ending the trip, or None when the system closes it
    on the driver's behalf. A staff member closing it has also seen it.
    """
    now = now or timezone.now()
    queryset = VehicleIncident.objects.select_for_update().filter(trip_id=trip_id, status__in=OPEN_STATUSES)
    if only_if_vehicle_can_continue:
        queryset = queryset.filter(vehicle_can_continue=True)
    closed = []
    for incident in queryset.order_by("created_at", "id"):
        if incident.acknowledged_at is None and actor is not None:
            incident.acknowledged_by = actor
            incident.acknowledged_at = now
        incident.status = VehicleIncident.Status.RESOLVED
        incident.resolved_by = actor
        incident.resolved_at = now
        incident.resolution_outcome = outcome
        incident.resolution_notes = notes
        incident.save(update_fields=[
            "status", "acknowledged_by", "acknowledged_at", "resolved_by", "resolved_at",
            "resolution_outcome", "resolution_notes", "updated_at",
        ])
        closed.append(incident)
    return closed


def open_incident_numbers(trip_id: str) -> list[str]:
    return list(
        VehicleIncident.objects.filter(trip_id=trip_id, status__in=OPEN_STATUSES)
        .order_by("created_at", "id").values_list("incident_number", flat=True)
    )
