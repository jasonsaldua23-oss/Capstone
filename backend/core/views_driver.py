"""Driver portal endpoints for trips, location and profile."""

import logging
import math
from datetime import datetime, timedelta
from typing import Any

from django.db import IntegrityError, transaction
from django.db.models import Count, Min, Prefetch, Q
from django.http import HttpRequest, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from . import views_api as legacy
from .api_constants import DRIVER_RESTRICTIONS, PERSON_NAME_NUMBER_ERROR, PHILIPPINE_PHONE_ERROR
from .api_utils import (
    error as _err,
    json_body as _json_body,
    ok as _ok,
    to_float_or_none as _to_float_or_none,
)
from .auth import REMEMBER_ME_EXP_HOURS, TOKEN_EXP_HOURS, create_token
from .fleet_sync import TERMINAL_DROP_POINT_STATUSES, local_date_of, trip_is_overdue
from .models import (
    LocationLog,
    OrderDepositRefundClaim,
    OrderItem,
    ProductPackaging,
    Replacement,
    Trip,
    TripDropPoint,
    TripStatus,
    User,
    Vehicle,
    Warehouse,
)

logger = logging.getLogger(__name__)


# Resolved through views_api so tests and runtime overrides that rebind
# these names on views_api keep applying here.


def driver_vehicle_license_error(driver: Any, vehicle: Any) -> str | None:
    return legacy.driver_vehicle_license_error(driver, vehicle)


# Helpers owned by sibling modules. Routing them through views_api keeps
# a single resolution point, so tests that patch there still apply.


def _build_order_item_trip_assignments_map(order_ids: list[str], *, trip_id: str | None=None) -> dict[str, dict[str, list[dict[str, Any]]]]:
    return legacy._build_order_item_trip_assignments_map(order_ids, trip_id=trip_id)


def _build_order_item_warehouse_allocations_map(order_ids: list[str]) -> dict[str, dict[str, list[dict[str, Any]]]]:
    return legacy._build_order_item_warehouse_allocations_map(order_ids)


def _driver_delivery_count(driver: User | None) -> int:
    return legacy._driver_delivery_count(driver)


def _format_display_name(first_name: str | None, middle_name: str | None, last_name: str | None, suffix: str | None=None, fallback_name: str | None=None) -> str:
    return legacy._format_display_name(first_name, middle_name, last_name, suffix, fallback_name)


def _is_gmail_email(email: str) -> bool:
    return legacy._is_gmail_email(email)


def _normalize_email(value: Any) -> str:
    return legacy._normalize_email(value)


def _normalize_philippine_phone(value: Any) -> str | None:
    return legacy._normalize_philippine_phone(value)


def _pagination(request: HttpRequest) -> tuple[int, int, int]:
    return legacy._pagination(request)


def _require_staff(request: HttpRequest) -> tuple[dict[str, Any] | None, JsonResponse | None]:
    return legacy._require_staff(request)


def _serialize_model(obj: Any, include: dict[str, Any] | None=None, exclude: set[str] | None=None) -> dict[str, Any]:
    return legacy._serialize_model(obj, include, exclude)


def _serialize_trip(trip: Trip, include_points: bool=True, *, ctx: dict=None) -> dict[str, Any]:
    return legacy._serialize_trip(trip, include_points, ctx=ctx)


def _set_auth_cookie(response: JsonResponse, token: str, remember_me: bool=False) -> None:
    return legacy._set_auth_cookie(response, token, remember_me)


def _staff_email_conflict_message(email: str, role: str, exclude_user_id: str | None=None) -> str | None:
    return legacy._staff_email_conflict_message(email, role, exclude_user_id)


def _submitted_person_name_has_number(body: dict[str, Any]) -> bool:
    return legacy._submitted_person_name_has_number(body)


def _user_payload(user: User) -> dict[str, Any]:
    return legacy._user_payload(user)


def _validate_future_license_expiry(value: Any) -> tuple[datetime | None, str | None]:
    return legacy._validate_future_license_expiry(value)


def _validate_philippine_driver_license(value: Any) -> tuple[str | None, str | None]:
    return legacy._validate_philippine_driver_license(value)


@require_GET
def driver_trips(request: HttpRequest) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    if p.get("role") != "DRIVER":
        return _err("Forbidden", 403)
    d = User.objects.filter(id=p.get("userId"), role="DRIVER").first()
    if not d:
        return _err("Driver profile not found", 404)
    drop_points_prefetch = Prefetch(
        "drop_points",
        queryset=TripDropPoint.objects.select_related(
            "order",
            "order__customer",
            "order__timeline",
        ).prefetch_related(
            Prefetch(
                "order__items",
                queryset=OrderItem.objects.select_related("product").prefetch_related("mixed_case_components__product"),
            ),
            # Fix: both the order payload and declared-empties payload read these
            # claims. Prefetch once for the page instead of twice per delivery stop.
            Prefetch(
                "order__deposit_refund_claims",
                queryset=OrderDepositRefundClaim.objects.select_related("product", "container_type"),
                to_attr="_serialized_refund_claims",
            ),
        ).order_by("sequence"),
    )
    page, size, off = _pagination(request)
    qs = (
        Trip.objects.select_related("driver", "vehicle")
        .prefetch_related(drop_points_prefetch)
        .filter(driver=d)
        .order_by("-updated_at")
    )
    total = qs.count()
    rows = list(qs[off : off + size])

    trip_ids = [trip.id for trip in rows]
    latest_log_by_trip: dict[str, LocationLog] = {}
    # Preserve the driver's last reliable fix even if it was recorded between trip links.
    latest_driver_log = LocationLog.objects.filter(driver=d).order_by("-recorded_at", "-id").first()
    if trip_ids:
        # Keep every returned fix scoped to the authenticated driver's account.
        logs = LocationLog.objects.filter(driver=d, trip_id__in=trip_ids).order_by("trip_id", "-recorded_at")
        for log in logs:
            if not log.trip_id:
                continue
            if log.trip_id not in latest_log_by_trip:
                latest_log_by_trip[log.trip_id] = log

    
    all_order_ids = []
    all_wh_ids = set()
    all_product_ids = set()
    for trip in rows:
        if trip.warehouse_id:
            all_wh_ids.add(str(trip.warehouse_id))
        prefetched_dp = getattr(trip, "_prefetched_objects_cache", {}).get("drop_points")
        if prefetched_dp is not None:
            for dp in prefetched_dp:
                if getattr(dp, "order", None):
                    all_order_ids.append(str(dp.order.id))
                    if dp.order.warehouse_id:
                        all_wh_ids.add(str(dp.order.warehouse_id))
                    for item in dp.order.items.all():
                        if item.product_id:
                            all_product_ids.add(str(item.product_id))
                        
    ctx = {
        "allocations_map": _build_order_item_warehouse_allocations_map(all_order_ids) if all_order_ids else {},
        "all_assignments_map": _build_order_item_trip_assignments_map(all_order_ids, trip_id=None) if all_order_ids else {},
        "warehouse_cache": {str(w.id): w for w in Warehouse.objects.filter(id__in=all_wh_ids)} if all_wh_ids else {},
        "packaging_cache": {
            str(packaging.product_id): packaging
            for packaging in ProductPackaging.objects.filter(product_id__in=all_product_ids, is_active=True)
        } if all_product_ids else {},
        # Fix: build all bottle-return charge adjustments in one query. Without
        # this map, serialization performs another database round trip per trip.
        "empties_adjustment_map": legacy.empties_adjustments_for_orders(all_order_ids) if all_order_ids else {},
        "order_returns_map": {},
        "trip_assignments_map": None, 
    }
    
    if all_order_ids:
        from core.models import Replacement
        replacements = Replacement.objects.filter(order_id__in=all_order_ids)
        for r in replacements:
            ctx["order_returns_map"].setdefault(str(r.order_id), []).append(r)

    payload_rows = []
    for trip in rows:
        row = _serialize_trip(trip, ctx=ctx)
        latest_log = latest_log_by_trip.get(trip.id) or latest_driver_log
        row["latestLocation"] = (
            {
                "latitude": float(latest_log.latitude),
                "longitude": float(latest_log.longitude),
                "accuracy": float(latest_log.accuracy) if latest_log.accuracy is not None else None,
                "heading": float(latest_log.heading) if latest_log.heading is not None else None,
                "recordedAt": latest_log.recorded_at.isoformat() if latest_log.recorded_at else None,
            }
            if latest_log
            else None
        )
        payload_rows.append(row)

    return _ok(
        {
            "success": True,
            "trips": payload_rows,
            # Added: dashboard tiles come from every trip of this driver, not the page.
            "stats": _driver_trip_stats(d),
            "total": total,
            "page": page,
            "pageSize": size,
            "totalPages": (total + size - 1) // size,
        }
    )


def _driver_trip_stats(driver: User) -> dict[str, Any]:
    """Dashboard counters over ALL of one driver's trips, never just the page.

    "Today" means the trip's scheduledDate (fleet_sync.trip_scheduled_date), the
    same day trip_start enforces. todayTrips counts today's trips except
    CANCELLED ones (nothing left for the driver to do). A trip counts as
    completedToday when it is COMPLETED and was scheduled for today: the tile
    answers "how many of today's trips are done", which is also what the portal
    computes offline, so the number does not jump when the server value arrives.
    """
    today = timezone.localdate()
    # One aggregate query stands in for min(drop-point delivery dates) per trip.
    earliest_delivery_by_trip = {
        row["trip_id"]: row["earliest"]
        for row in TripDropPoint.objects.filter(trip__driver_id=driver.id)
        .values("trip_id")
        .annotate(earliest=Min("order__timeline__delivery_date"))
        if row["earliest"] is not None
    }
    stats: dict[str, Any] = {
        "todayTrips": 0,
        "plannedToday": 0,
        "completedToday": 0,
        "pendingStops": 0,
        "overdueTrips": 0,
        "activeTrips": 0,
        "currentAssignment": None,
    }
    active_rows: list[tuple[dict[str, Any], Any]] = []
    for row in Trip.objects.filter(driver_id=driver.id).values(
        "id", "trip_number", "status", "planned_start_at", "actual_start_at", "updated_at",
    ):
        status = str(row["status"] or "").strip().upper()
        scheduled_date = local_date_of(earliest_delivery_by_trip.get(row["id"]) or row["planned_start_at"])
        if scheduled_date == today and status != TripStatus.CANCELLED:
            stats["todayTrips"] += 1
            if status == TripStatus.PLANNED:
                stats["plannedToday"] += 1
            elif status == TripStatus.COMPLETED:
                stats["completedToday"] += 1
        if trip_is_overdue(status, scheduled_date, today):
            stats["overdueTrips"] += 1
        if status == TripStatus.IN_PROGRESS:
            active_rows.append((row, scheduled_date))
    stats["activeTrips"] = len(active_rows)
    if active_rows:
        # Legacy data may hold several running trips (trip_start now refuses a
        # second one); the most recently started trip is the current assignment.
        row, scheduled_date = max(
            active_rows,
            key=lambda entry: entry[0]["actual_start_at"] or entry[0]["updated_at"],
        )
        active_points = TripDropPoint.objects.filter(trip__driver_id=driver.id, trip__status=TripStatus.IN_PROGRESS)
        stats["pendingStops"] = active_points.exclude(status__in=list(TERMINAL_DROP_POINT_STATUSES)).count()
        # Counted from the rows, not the stored counters, so the tile matches the stop list.
        current_points = active_points.filter(trip_id=row["id"]).aggregate(
            total=Count("id"),
            done=Count("id", filter=Q(status__in=list(TERMINAL_DROP_POINT_STATUSES))),
        )
        stats["currentAssignment"] = {
            "tripId": row["id"],
            "tripNumber": row["trip_number"],
            "completedDropPoints": int(current_points["done"] or 0),
            "totalDropPoints": int(current_points["total"] or 0),
            "scheduledDate": scheduled_date.isoformat() if scheduled_date else None,
        }
    return stats


@csrf_exempt
@require_http_methods(["POST"])
def driver_location(request: HttpRequest) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    if p.get("role") != "DRIVER":
        return _err("Forbidden", 403)
    d = User.objects.filter(id=p.get("userId"), role="DRIVER").first()
    if not d:
        return _err("Driver not found", 404)
    body = _json_body(request)
    lat = _to_float_or_none(body.get("latitude"))
    lng = _to_float_or_none(body.get("longitude"))
    if lat is None or lng is None or not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
        return _err("Invalid coordinates")
    accuracy = _to_float_or_none(body.get("accuracy"))
    # Keep this ceiling aligned with the native/web client grace period. A 100–300m
    # estimate is visibly less precise but still lets a weak-signal driver's vehicle move.
    if accuracy is not None and (accuracy < 0 or accuracy > 300):
        return _err("Location accuracy is too low for live tracking", 400)
    heading = _to_float_or_none(body.get("heading"))
    altitude = _to_float_or_none(body.get("altitude"))
    raw_speed = _to_float_or_none(body.get("speed"))
    gps_speed = raw_speed if raw_speed is not None and 0 <= raw_speed <= 50 else None
    # Preserve capture time across background/offline retries, rather than labelling stale GPS as live.
    recorded_at = timezone.now()
    if body.get("recordedAt") is not None:
        milliseconds = _to_float_or_none(body.get("recordedAt"))
        try:
            if milliseconds is None or not math.isfinite(milliseconds) or milliseconds <= 0:
                return _err("Invalid location timestamp")
            captured_at = datetime.fromtimestamp(milliseconds / 1000, tz=recorded_at.tzinfo)
        except (ValueError, OverflowError, OSError):
            return _err("Invalid location timestamp")
        if captured_at > recorded_at + timedelta(seconds=30):
            return _err("Location timestamp is in the future")
        recorded_at = min(captured_at, recorded_at)
    requested_trip_id = str(body.get("tripId") or "").strip()
    active_statuses = {TripStatus.IN_PROGRESS}
    active_trip = Trip.objects.filter(driver_id=d.id, status__in=list(active_statuses)).order_by("-updated_at").first()
    trip_id = None
    trip_resolution = "none"
    tracking_allowed = False
    if requested_trip_id:
        requested_trip = Trip.objects.filter(id=requested_trip_id, driver_id=d.id).first()
        if requested_trip:
            trip_id = requested_trip.id
            tracking_allowed = requested_trip.status in active_statuses | {"PLANNED"}
            trip_resolution = "requested_trip_matched_driver"
        elif active_trip:
            trip_id = active_trip.id
            tracking_allowed = True
            trip_resolution = "fallback_active_trip"
    else:
        trip_id = active_trip.id if active_trip else None
        tracking_allowed = bool(active_trip)
        trip_resolution = "auto_active_trip" if trip_id else "none"
    with transaction.atomic():
        # Lock before reading: concurrent first uploads must not create competing latest rows.
        User.objects.select_for_update().get(id=d.id)
        log = (
            LocationLog.objects.select_for_update()
            .filter(driver_id=d.id)
            .order_by("-recorded_at", "-id")
            .first()
        )
        if log and recorded_at < log.recorded_at:
            return _ok({"success": True, "ignored": "older_location", "locationLogId": log.id})
        now = recorded_at
        if log:
            log.trip_id = trip_id
            log.latitude = lat
            log.longitude = lng
            log.heading = heading
            log.altitude = altitude
            log.accuracy = accuracy
            log.speed = gps_speed
            log.battery = body.get("battery")
            log.recorded_at = now
            log.save(
                update_fields=[
                    "trip_id",
                    "latitude",
                    "longitude",
                    "heading",
                    "altitude",
                    "accuracy",
                    "speed",
                    "battery",
                    "recorded_at",
                ]
            )
        else:
            log = LocationLog.objects.create(
                driver_id=d.id,
                trip_id=trip_id,
                latitude=lat,
                longitude=lng,
                heading=heading,
                altitude=altitude,
                accuracy=accuracy,
                speed=gps_speed,
                battery=body.get("battery"),
                recorded_at=now,
            )

        LocationLog.objects.filter(driver_id=d.id).exclude(id=log.id).delete()
    return _ok({
        "success": True,
        "locationLogId": log.id,
        "tripIdUsed": trip_id,
        "tripIdRequested": requested_trip_id or None,
        "tripResolution": trip_resolution,
        "trackingAllowed": tracking_allowed,
    })


@csrf_exempt
@require_http_methods(["GET", "PUT"])
def driver_profile(request: HttpRequest) -> JsonResponse:
    p, err = _require_staff(request)
    if err:
        return err
    if p.get("role") != "DRIVER":
        return _err("Forbidden", 403)
    d = User.objects.filter(id=p.get("userId"), role="DRIVER").first()
    if not d:
        return _err("Driver profile not found", 404)
    if request.method == "GET":
        row = _serialize_model(d, exclude={"password"})
        row["phone"] = d.phone
        row["totalDeliveries"] = _driver_delivery_count(d)
        row["user"] = _serialize_model(d, exclude={"password"})
        row["user"]["totalDeliveries"] = row["totalDeliveries"]
        return _ok({"success": True, "driver": row})
    body = _json_body(request)
    if _submitted_person_name_has_number(body):
        return _err(PERSON_NAME_NUMBER_ERROR, 400)
    next_license_number: str | None = None
    for key, attr in [
        ("emergencyContact", "emergency_contact"),
        ("licenseNumber", "license_number"),
        ("licenseType", "license_type"),
    ]:
        if key in body:
            next_value = body.get(key)
            if attr == "license_number":
                if next_value:
                    normalized, lic_err = _validate_philippine_driver_license(next_value)
                    if lic_err:
                        return _err(lic_err, 400)
                    next_license_number = normalized
                else:
                    next_license_number = None
                setattr(d, attr, next_license_number)
            elif attr == "license_type":
                normalized_type = str(next_value or "").strip().upper()
                if normalized_type not in DRIVER_RESTRICTIONS:
                    return _err("Restrictions must be one of: A, A1, B, B1, B2, C, D, BE, CE", 400)
                setattr(d, attr, normalized_type or None)
            else:
                setattr(d, attr, next_value)
    if "licenseExpiry" in body and body.get("licenseExpiry"):
        parsed_license_expiry, expiry_error = _validate_future_license_expiry(body.get("licenseExpiry"))
        if expiry_error:
            return _err(expiry_error, 400)
        d.license_expiry = parsed_license_expiry
    if next_license_number:
        duplicate = User.objects.filter(
            role="DRIVER",
            license_number=next_license_number,
        ).exclude(id=d.id).exists()
        if duplicate:
            return _err("License number is already used by another driver", 409)

    if "licenseType" in body:
        # A driver editing their own restriction code must not end up holding a
        # vehicle their new code does not cover.
        current_vehicle = Vehicle.objects.filter(driver=d).first()
        if driver_vehicle_license_error(d, current_vehicle):
            return _err(
                f"Driver is not qualified to drive vehicle {current_vehicle.license_plate} with License Code "
                f"{str(d.license_type or '').strip().upper()}. Ask an administrator to unassign the vehicle first.",
                400,
            )

    if "firstName" in body:
        d.first_name = str(body.get("firstName") or "").strip() or None
    if "middleName" in body:
        d.middle_name = str(body.get("middleName") or "").strip() or None
    if "lastName" in body:
        d.last_name = str(body.get("lastName") or "").strip() or None
    if "suffix" in body:
        d.suffix = str(body.get("suffix") or "").strip() or None

    if any(k in body for k in ("firstName", "middleName", "lastName", "suffix")):
        d.name = _format_display_name(d.first_name, d.middle_name, d.last_name, d.suffix, d.name)
    elif "name" in body:
        d.name = str(body.get("name") or "").strip()

    if "phone" in body:
        normalized_phone = _normalize_philippine_phone(body.get("phone"))
        if not normalized_phone:
            return _err(PHILIPPINE_PHONE_ERROR)
        d.phone = normalized_phone
    email_changed = False
    if "email" in body:
        next_email = _normalize_email(body.get("email"))
        if not _is_gmail_email(next_email):
            return _err("Please enter a valid Gmail address", 400)
        if next_email != _normalize_email(d.email):
            conflict = _staff_email_conflict_message(next_email, d.role, exclude_user_id=d.id)
            if conflict:
                return _err(conflict, 409)
            # Added: persist the driver's new Gmail while preventing cross-account duplicates.
            d.email = next_email
            email_changed = True
    if "avatar" in body:
        d.avatar = body.get("avatar")
    if "twoFactorEnabled" in body:
        d.two_factor_enabled = bool(body.get("twoFactorEnabled"))
    if "emailNotificationsEnabled" in body:
        d.email_notifications_enabled = bool(body.get("emailNotificationsEnabled"))
    if "smsNotificationsEnabled" in body:
        d.sms_notifications_enabled = bool(body.get("smsNotificationsEnabled"))
    if "pushNotificationsEnabled" in body:
        d.push_notifications_enabled = bool(body.get("pushNotificationsEnabled"))
    if "loginAlertsEnabled" in body:
        d.login_alerts_enabled = bool(body.get("loginAlertsEnabled"))
    try:
        d.save()
    except IntegrityError:
        return _err("Failed to update profile: duplicate or invalid driver data", 400)
    except Exception:
        logger.exception("Driver profile update failed for user_id=%s", d.id)
        return _err("Failed to update profile", 500)
    row = _serialize_model(d, exclude={"password"})
    row["phone"] = d.phone
    row["user"] = _serialize_model(d, exclude={"password"})
    response_payload: dict[str, Any] = {"success": True, "driver": row}
    response = _ok(response_payload)
    if email_changed:
        # Fix: refresh signed claims so later email-sensitive actions use the new Gmail address.
        remember_me = bool(p.get("rememberMe", False))
        token = create_token(
            {**_user_payload(d), "rememberMe": remember_me},
            REMEMBER_ME_EXP_HOURS if remember_me else TOKEN_EXP_HOURS,
        )
        response_payload["token"] = token
        response = _ok(response_payload)
        _set_auth_cookie(response, token, remember_me)
    return response
