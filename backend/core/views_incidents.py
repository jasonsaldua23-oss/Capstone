"""Accidents and vehicle damage that drivers report during a trip.

A driver reports from the trip screen; the admin and warehouse live tracking maps
then flag that vehicle - where it is, what happened, whether it can still drive -
until warehouse staff resolve the incident. Trip and fleet changes belong to the
warehouse (see ``trip_detail`` and the vehicle endpoints), so administrators see
incidents but only warehouse staff act on them.
"""

from __future__ import annotations

import math
import re
from datetime import date, datetime
from typing import Any

from django.db import IntegrityError, transaction
from django.db.models import Case, IntegerField, Q, Value, When
from django.http import HttpRequest, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from . import views_api as legacy
from . import views_media as media
from .api_utils import error as _err, json_body as _json_body, ok as _ok
from .models import LocationLog, RoleType, Trip, TripStatus, User, Vehicle, VehicleIncident, VehicleStatus

PHOTO_FOLDER = "incident-photos"
DESCRIPTION_MAX_LENGTH = 1000
NOTES_MAX_LENGTH = 1000
REQUEST_ID_MAX_LENGTH = 120
# Same ceiling the live-location endpoint accepts; a vaguer fix is not a position.
MAX_DEVICE_ACCURACY_METERS = 300
OPEN_STATUSES = (VehicleIncident.Status.REPORTED, VehicleIncident.Status.ACKNOWLEDGED)
# TRIP_ENDED is recorded only when a trip ends with the incident open (incident_lifecycle).
MANUAL_OUTCOMES = (VehicleIncident.Outcome.RESUMED, VehicleIncident.Outcome.SENT_FOR_REPAIR)
_NUMBER_ATTEMPTS = 5


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _name(user: User | None) -> str | None:
    return (str(user.name or "").strip() or None) if user else None


def _what_happened(incident: VehicleIncident) -> str:
    return "an accident" if incident.type == VehicleIncident.Type.ACCIDENT else "vehicle damage"


def serialize_incident(incident: VehicleIncident, *, can_manage: bool = False) -> dict[str, Any]:
    trip = incident.trip
    vehicle = incident.vehicle
    is_open = incident.status in OPEN_STATUSES
    return {
        "id": incident.id,
        "incidentNumber": incident.incident_number,
        "type": incident.type,
        "typeLabel": incident.get_type_display(),
        "status": incident.status,
        "statusLabel": incident.get_status_display(),
        "isOpen": is_open,
        "vehicleCanContinue": incident.vehicle_can_continue,
        "description": incident.description,
        "photoUrl": incident.photo_url or None,
        "latitude": incident.latitude,
        "longitude": incident.longitude,
        "locationAccuracy": incident.location_accuracy,
        "locationSource": incident.location_source or None,
        "locationRecordedAt": _iso(incident.location_recorded_at),
        "tripId": incident.trip_id,
        "tripNumber": trip.trip_number,
        "tripStatus": trip.status,
        "warehouseId": trip.warehouse_id,
        "driverId": incident.driver_id,
        "driverName": _name(incident.driver),
        "vehicleId": incident.vehicle_id,
        "vehiclePlate": vehicle.license_plate,
        "vehicleStatus": vehicle.status,
        "reportedAt": _iso(incident.created_at),
        "acknowledgedAt": _iso(incident.acknowledged_at),
        "acknowledgedBy": _name(incident.acknowledged_by),
        "resolvedAt": _iso(incident.resolved_at),
        "resolvedBy": _name(incident.resolved_by),
        "resolutionOutcome": incident.resolution_outcome or None,
        "resolutionOutcomeLabel": incident.get_resolution_outcome_display() if incident.resolution_outcome else None,
        "resolutionNotes": incident.resolution_notes or None,
        # Whether the person reading may acknowledge or resolve it right now.
        "canManage": bool(can_manage and is_open),
    }


def _incidents():
    return VehicleIncident.objects.select_related("trip", "driver", "vehicle", "acknowledged_by", "resolved_by")


def _account(request: HttpRequest) -> tuple[User | None, JsonResponse | None]:
    """The signed-in staff account, with its role read from the database, not the token."""
    payload, error = legacy._require_staff(request)
    if error is not None:
        return None, error
    user = User.objects.filter(id=str(payload.get("userId") or "").strip(), is_active=True).first()
    if user is None:
        return None, _err("Unauthorized", 401)
    return user, None


def _allowed_warehouse_ids(user: User) -> set[str]:
    return {str(value) for value in legacy._get_allowed_warehouse_ids_for_staff(str(user.id))}


def _visible_to(user: User, queryset):
    role = str(user.role or "").upper()
    if role == RoleType.ADMIN:
        return queryset
    if role == RoleType.WAREHOUSE_STAFF:
        return queryset.filter(trip__warehouse_id__in=_allowed_warehouse_ids(user))
    if role == RoleType.DRIVER:
        return queryset.filter(driver_id=user.id)
    return queryset.none()


def _photo_prefix(driver_id: str) -> str:
    return f"incident-{driver_id}"


def _is_own_photo_url(url: str, driver_id: str) -> bool:
    # The driver's id is in the file name, so a report can only attach a photo this
    # driver uploaded. Attaching someone else's URL would grant read access to it.
    pattern = rf"/api/media/{PHOTO_FOLDER}/{re.escape(_photo_prefix(driver_id))}-[0-9a-f]{{32}}\.[a-z0-9]{{1,5}}"
    return bool(re.fullmatch(pattern, url))


def _finite(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _device_location(body: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    """The position the driver's device sent with the report, or why it was refused."""
    latitude, longitude = body.get("latitude"), body.get("longitude")
    if latitude is None and longitude is None:
        return None, None
    lat, lng = _finite(latitude), _finite(longitude)
    if lat is None or lng is None or not -90 <= lat <= 90 or not -180 <= lng <= 180:
        return None, "Invalid coordinates"
    accuracy = _finite(body.get("accuracy")) if body.get("accuracy") is not None else None
    if accuracy is not None and accuracy < 0:
        return None, "Invalid location accuracy"
    if accuracy is not None and accuracy > MAX_DEVICE_ACCURACY_METERS:
        # Too vague to mark where the vehicle is; the last good fix is used instead.
        return None, None
    now = timezone.now()
    recorded_at = now
    recorded_ms = _finite(body.get("recordedAt")) if body.get("recordedAt") is not None else None
    if recorded_ms is not None and recorded_ms > 0:
        try:
            captured = datetime.fromtimestamp(recorded_ms / 1000, tz=now.tzinfo)
        except (OverflowError, OSError, ValueError):
            captured = None
        if captured is not None:
            recorded_at = min(captured, now)
    return {"latitude": lat, "longitude": lng, "accuracy": accuracy, "recordedAt": recorded_at}, None


def _last_trip_fix(driver: User, trip: Trip) -> dict[str, Any] | None:
    """The newest GPS fix the driver uploaded since this trip started, if any.

    One row per driver is kept (see ``driver_location``), so this is where the
    vehicle was last seen. A fix from before the trip says nothing about it.
    """
    log = LocationLog.objects.filter(driver_id=driver.id).order_by("-recorded_at", "-id").first()
    if log is None:
        return None
    if trip.actual_start_at and log.recorded_at < trip.actual_start_at:
        return None
    return {"latitude": log.latitude, "longitude": log.longitude, "accuracy": log.accuracy, "recordedAt": log.recorded_at}


def _next_incident_number() -> str:
    prefix = f"INC-{timezone.localdate().year}-"
    numbers = VehicleIncident.objects.filter(incident_number__startswith=prefix).values_list("incident_number", flat=True)
    sequence = max((int(number[len(prefix):]) for number in numbers if number[len(prefix):].isdigit()), default=0)
    return f"{prefix}{sequence + 1:04d}"


def _notify_staff_of_report(incident: VehicleIncident) -> None:
    continuing = "can still continue the trip" if incident.vehicle_can_continue else "cannot continue the trip"
    legacy._create_staff_notifications(
        title=f"{incident.get_type_display()} reported",
        message=(
            f"{_name(incident.driver) or 'A driver'} reported {_what_happened(incident)} on trip "
            f"{incident.trip.trip_number} ({incident.vehicle.license_plate}). The vehicle {continuing}."
        ),
        notification_type="INCIDENT",
        reference_type="incident",
        reference_id=incident.id,
    )


def _notify_driver(incident: VehicleIncident, title: str, message: str) -> None:
    # Opens the trip the report was made from.
    legacy._create_user_notification(
        user=incident.driver,
        title=title,
        message=message,
        notification_type="INCIDENT",
        reference_type="trip",
        reference_id=incident.trip_id,
    )


def _list(request: HttpRequest, user: User) -> JsonResponse:
    page, size, offset = legacy._pagination(request)
    queryset = _visible_to(user, _incidents())
    status = str(request.GET.get("status") or "all").strip().lower()
    if status == "open":
        queryset = queryset.filter(status__in=OPEN_STATUSES)
    elif status == "resolved":
        queryset = queryset.filter(status=VehicleIncident.Status.RESOLVED)
    elif status != "all":
        return _err("Invalid status. Expected open, resolved or all", 400)
    trip_id = str(request.GET.get("tripId") or "").strip()
    if trip_id:
        queryset = queryset.filter(trip_id=trip_id)
    day_raw = str(request.GET.get("date") or "").strip()
    if day_raw:
        try:
            day = date.fromisoformat(day_raw)
        except ValueError:
            return _err("Invalid date. Expected YYYY-MM-DD", 400)
        # A day's incidents, plus any still open: an open one is live whatever day it began.
        queryset = queryset.filter(Q(created_at__date=day) | Q(status__in=OPEN_STATUSES))
    queryset = queryset.annotate(
        open_first=Case(When(status__in=OPEN_STATUSES, then=Value(0)), default=Value(1), output_field=IntegerField())
    ).order_by("open_first", "-created_at", "-id")
    total = queryset.count()
    rows = list(queryset[offset : offset + size])
    managing = str(user.role or "").upper() == RoleType.WAREHOUSE_STAFF
    allowed = _allowed_warehouse_ids(user) if managing else set()
    incidents = [
        serialize_incident(row, can_manage=managing and str(row.trip.warehouse_id or "") in allowed)
        for row in rows
    ]
    return _ok({
        "success": True,
        "incidents": incidents,
        "total": total,
        "page": page,
        "pageSize": size,
        "totalPages": (total + size - 1) // size,
    })


def _report(request: HttpRequest, driver: User) -> JsonResponse:
    if str(driver.role or "").upper() != RoleType.DRIVER:
        return _err("Only drivers can report incidents", 403)
    body = _json_body(request)
    if not isinstance(body, dict):
        return _err("An incident report object is required", 400)
    request_id = str(body.get("requestId") or "").strip()
    if not request_id or len(request_id) > REQUEST_ID_MAX_LENGTH:
        return _err(f"A requestId of 1 to {REQUEST_ID_MAX_LENGTH} characters is required", 400)
    incident_type = body.get("type")
    if incident_type not in VehicleIncident.Type.values:
        return _err("Choose what happened: an accident or vehicle damage", 400)
    can_continue = body.get("vehicleCanContinue")
    if not isinstance(can_continue, bool):
        return _err("Say whether the vehicle can continue the trip", 400)
    description = body.get("description")
    if not isinstance(description, str) or not description.strip():
        return _err("Describe what happened", 400)
    description = description.strip()
    if len(description) > DESCRIPTION_MAX_LENGTH:
        return _err(f"The description must be {DESCRIPTION_MAX_LENGTH} characters or fewer", 400)
    photo_url = body.get("photoUrl") or ""
    if not isinstance(photo_url, str) or (photo_url and not _is_own_photo_url(photo_url, driver.id)):
        return _err("Attach a photo uploaded from this account", 400)
    device_fix, location_error = _device_location(body)
    if location_error:
        return _err(location_error, 400)

    trip = Trip.objects.filter(id=str(body.get("tripId") or "").strip()).first()
    if trip is None:
        return _err("Trip not found", 404)
    if trip.driver_id != driver.id:
        return _err("Forbidden", 403)

    def replay(existing: VehicleIncident) -> JsonResponse:
        if (existing.trip_id, existing.type, existing.description) != (trip.id, incident_type, description):
            return _err("This requestId was already used for another incident", 409)
        return _ok({"success": True, "incident": serialize_incident(_incidents().get(id=existing.id))})

    incident = None
    for attempt in range(_NUMBER_ATTEMPTS):
        try:
            with transaction.atomic():
                # Two taps of Report queue up here; the second sees the first one's incident.
                locked_trip = Trip.objects.select_for_update().get(id=trip.id)
                previous = VehicleIncident.objects.filter(driver=driver, request_id=request_id).first()
                if previous is not None:
                    return replay(previous)
                if locked_trip.status != TripStatus.IN_PROGRESS:
                    return _err("Incidents can only be reported on a trip in progress", 409)
                open_incident = VehicleIncident.objects.filter(trip=locked_trip, status__in=OPEN_STATUSES).first()
                if open_incident is not None:
                    return JsonResponse(
                        {
                            "success": False,
                            "error": "An incident is already open for this trip",
                            "incident": serialize_incident(_incidents().get(id=open_incident.id)),
                        },
                        status=409,
                    )
                fix = device_fix or _last_trip_fix(driver, locked_trip)
                source = (
                    VehicleIncident.LocationSource.DEVICE if device_fix
                    else VehicleIncident.LocationSource.LAST_GPS if fix
                    else ""
                )
                incident = VehicleIncident.objects.create(
                    incident_number=_next_incident_number(),
                    request_id=request_id,
                    trip=locked_trip,
                    driver=driver,
                    vehicle_id=locked_trip.vehicle_id,
                    type=incident_type,
                    vehicle_can_continue=can_continue,
                    description=description,
                    photo_url=photo_url,
                    latitude=fix["latitude"] if fix else None,
                    longitude=fix["longitude"] if fix else None,
                    location_accuracy=fix["accuracy"] if fix else None,
                    location_source=source,
                    location_recorded_at=fix["recordedAt"] if fix else None,
                )
            break
        except IntegrityError:
            # Another report took this incident number (or this very request) a moment ago.
            previous = VehicleIncident.objects.filter(driver=driver, request_id=request_id).first()
            if previous is not None:
                return replay(previous)
            if attempt == _NUMBER_ATTEMPTS - 1:
                return _err("The incident could not be recorded. Please try again.", 503)

    incident = _incidents().get(id=incident.id)
    _notify_staff_of_report(incident)
    return _ok({"success": True, "incident": serialize_incident(incident)}, 201)


@csrf_exempt
@require_http_methods(["GET", "POST"])
def incidents_collection(request: HttpRequest) -> JsonResponse:
    user, error = _account(request)
    if error is not None:
        return error
    if request.method == "GET":
        return _list(request, user)
    return _report(request, user)


@csrf_exempt
@require_http_methods(["POST"])
def incident_photo(request: HttpRequest) -> JsonResponse:
    """Store the one photo a report may carry; the report then references its URL."""
    user, error = _account(request)
    if error is not None:
        return error
    if str(user.role or "").upper() != RoleType.DRIVER:
        return _err("Only drivers can attach incident photos", 403)
    return media._handle_image_upload(request, PHOTO_FOLDER, _photo_prefix(user.id))


@csrf_exempt
@require_http_methods(["PATCH"])
def incident_detail(request: HttpRequest, incident_id: str) -> JsonResponse:
    """Acknowledge or resolve an incident. Warehouse staff only, within their warehouse."""
    user, error = _account(request)
    if error is not None:
        return error
    if str(user.role or "").upper() != RoleType.WAREHOUSE_STAFF:
        return _err("Only warehouse staff can respond to incidents", 403)
    incident = VehicleIncident.objects.select_related("trip").filter(id=incident_id).first()
    if incident is None:
        return _err("Incident not found", 404)
    if str(incident.trip.warehouse_id or "") not in _allowed_warehouse_ids(user):
        return _err("This incident is outside your assigned warehouse scope", 403)

    body = _json_body(request)
    if not isinstance(body, dict):
        return _err("An action object is required", 400)
    action = body.get("action")
    if action not in ("ACKNOWLEDGE", "RESOLVE"):
        return _err("Choose ACKNOWLEDGE or RESOLVE", 400)
    outcome, notes = body.get("outcome"), body.get("notes", "")
    if action == "RESOLVE":
        if outcome not in MANUAL_OUTCOMES:
            return _err("Choose how the incident was resolved", 400)
        if not isinstance(notes, str) or not notes.strip():
            return _err("Add notes on how the incident was resolved", 400)
        notes = notes.strip()
        if len(notes) > NOTES_MAX_LENGTH:
            return _err(f"Notes must be {NOTES_MAX_LENGTH} characters or fewer", 400)

    changed = False
    with transaction.atomic():
        # Lock only this table: the nullable staff joins cannot be locked in PostgreSQL.
        locked = VehicleIncident.objects.select_for_update().get(id=incident.id)
        now = timezone.now()
        if action == "ACKNOWLEDGE":
            if locked.status == VehicleIncident.Status.RESOLVED:
                return _err("This incident is already resolved", 409)
            if locked.status == VehicleIncident.Status.REPORTED:
                locked.status = VehicleIncident.Status.ACKNOWLEDGED
                locked.acknowledged_by = user
                locked.acknowledged_at = now
                locked.save(update_fields=["status", "acknowledged_by", "acknowledged_at", "updated_at"])
                changed = True
        elif locked.status == VehicleIncident.Status.RESOLVED:
            if (locked.resolution_outcome, locked.resolution_notes) != (outcome, notes):
                return _err("This incident is already resolved", 409)
        else:
            if locked.acknowledged_at is None:
                # Resolving it is also seeing it.
                locked.acknowledged_by = user
                locked.acknowledged_at = now
            locked.status = VehicleIncident.Status.RESOLVED
            locked.resolved_by = user
            locked.resolved_at = now
            locked.resolution_outcome = outcome
            locked.resolution_notes = notes
            locked.save(update_fields=[
                "status", "acknowledged_by", "acknowledged_at", "resolved_by", "resolved_at",
                "resolution_outcome", "resolution_notes", "updated_at",
            ])
            if outcome == VehicleIncident.Outcome.SENT_FOR_REPAIR:
                vehicle = Vehicle.objects.select_for_update().get(id=locked.vehicle_id)
                # Out of service already says more than maintenance; leave it.
                if vehicle.status != VehicleStatus.OUT_OF_SERVICE:
                    vehicle.status = VehicleStatus.MAINTENANCE
                    vehicle.save(update_fields=["status", "updated_at"])
            changed = True

    incident = _incidents().get(id=incident.id)
    if changed:
        what = _what_happened(incident)
        if incident.status == VehicleIncident.Status.ACKNOWLEDGED:
            _notify_driver(
                incident,
                "Incident acknowledged",
                f"{_name(user) or 'The warehouse'} acknowledged your report of {what} on trip "
                f"{incident.trip.trip_number}. The warehouse is coordinating the next steps.",
            )
        else:
            _notify_driver(
                incident,
                "Incident resolved",
                f"Your report of {what} on trip {incident.trip.trip_number} was resolved: "
                f"{incident.get_resolution_outcome_display()}. {incident.resolution_notes}",
            )
    return _ok({"success": True, "incident": serialize_incident(incident, can_manage=True)})
