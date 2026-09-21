"""Staff user, customer account and role directory endpoints."""

import logging
from typing import Any

from django.db import transaction
from django.db.models import Count, Q, Sum
from django.http import HttpRequest, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from . import email_notifications, notification_services
from . import views_api as legacy
from .api_constants import (
    DEFAULT_COUNTRY,
    DISCOUNT_ACTIVE,
    DISCOUNT_CANCELLED,
    DISCOUNT_NO,
    DISCOUNT_OTHER,
    DISCOUNT_PRESET_PERCENT,
    DISCOUNT_REMOVED,
    PERSON_NAME_NUMBER_ERROR,
    PHILIPPINE_PHONE_ERROR,
)
from .api_utils import error as _err, json_body as _json_body, ok as _ok, to_int as _int
from .auth import hash_password
from .models import (
    Customer,
    CustomerApprovalStatus,
    DriverServiceArea,
    Order,
    OrderStatus,
    RoleType,
    SalesChannel,
    User,
)

logger = logging.getLogger(__name__)

_REGISTRATION_DECISIONS = {CustomerApprovalStatus.APPROVED, CustomerApprovalStatus.REJECTED}


# Helpers owned by sibling modules. Routing them through views_api keeps
# a single resolution point, so tests that patch there still apply.


def _create_staff_notifications(*, title: str, message: str, notification_type: str='INVENTORY', reference_type: str | None=None, reference_id: str | None=None) -> None:
    return legacy._create_staff_notifications(title=title, message=message, notification_type=notification_type, reference_type=reference_type, reference_id=reference_id)


def _email_new_staff_credentials(user: User, plain_password: str) -> None:
    return legacy._email_new_staff_credentials(user, plain_password)


def _ensure_negros_occidental_address(*, latitude: Any, longitude: Any, city: Any=None, province: Any, require_coordinates: bool=False) -> str | None:
    return legacy._ensure_negros_occidental_address(latitude=latitude, longitude=longitude, city=city, province=province, require_coordinates=require_coordinates)


def _format_display_name(first_name: str | None, middle_name: str | None, last_name: str | None, suffix: str | None=None, fallback_name: str | None=None) -> str:
    return legacy._format_display_name(first_name, middle_name, last_name, suffix, fallback_name)


def _is_email_verification_token_valid(token: str, email: str, account_type: str) -> bool:
    return legacy._is_email_verification_token_valid(token, email, account_type)


def _is_gmail_email(email: str) -> bool:
    return legacy._is_gmail_email(email)


def _normalize_philippine_phone(value: Any) -> str | None:
    return legacy._normalize_philippine_phone(value)


def _pagination(request: HttpRequest) -> tuple[int, int, int]:
    return legacy._pagination(request)


def _person_name_has_number(*values: Any) -> bool:
    return legacy._person_name_has_number(*values)


def _real_customers(qs):
    return legacy._real_customers(qs)


def _real_orders(qs):
    return legacy._real_orders(qs)


def _require_auth(request: HttpRequest) -> dict[str, Any] | None:
    return legacy._require_auth(request)


def _require_staff(request: HttpRequest) -> tuple[dict[str, Any] | None, JsonResponse | None]:
    return legacy._require_staff(request)


def _serialize_model(obj: Any, include: dict[str, Any] | None=None, exclude: set[str] | None=None) -> dict[str, Any]:
    return legacy._serialize_model(obj, include, exclude)


def _serialize_value(value: Any) -> Any:
    return legacy._serialize_value(value)


def _staff_email_conflict_message(email: str, role: str, exclude_user_id: str | None=None) -> str | None:
    return legacy._staff_email_conflict_message(email, role, exclude_user_id)


def _strip_default_country_suffix(address: Any) -> str:
    return legacy._strip_default_country_suffix(address)


def _submitted_person_name_has_number(body: dict[str, Any]) -> bool:
    return legacy._submitted_person_name_has_number(body)


def _validate_password_strength(password: str) -> str | None:
    return legacy._validate_password_strength(password)


@require_GET
def roles_list(request: HttpRequest) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    roles = [{"id": value, "name": value, "description": label} for value, label in RoleType.choices]
    return _ok({"success": True, "roles": roles})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def users_collection(request: HttpRequest) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    actor_role = str(staff.get("role") or "").upper()
    if request.method == "POST" and actor_role not in {RoleType.ADMIN, RoleType.SUPER_ADMIN}:
        return _err("Only administrators can create staff accounts", 403)
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = User.objects.prefetch_related("service_areas").all().order_by("-created_at")
        # Fix: drivers need their own profile, not the staff directory.
        if actor_role == RoleType.DRIVER:
            qs = qs.filter(id=staff.get("userId"))
        s = str(request.GET.get("search", "")).strip()
        if s:
            qs = qs.filter(Q(name__icontains=s) | Q(email__icontains=s))
        total = qs.count()
        rows = list(qs[off : off + size])
        users = []
        for user in rows:
            row = _serialize_model(user, exclude={"password"})
            # Added: populate the driver edit form with its persisted service area.
            row["serviceAreas"] = [area.city for area in user.service_areas.all()]
            row["serviceArea"] = row["serviceAreas"][0] if row["serviceAreas"] else ""
            users.append(row)
        return _ok({"success": True, "users": users, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size})

    body = _json_body(request)
    email = str(body.get("email", "")).strip().lower()
    name = str(body.get("name", "")).strip()
    password = str(body.get("password", "")).strip()
    role_id = str(body.get("roleId", "")).strip()
    if role_id == RoleType.SUPER_ADMIN and actor_role != RoleType.SUPER_ADMIN:
        return _err("Only the owner can create an owner account", 403)
    phone = _normalize_philippine_phone(body.get("phone"))
    email_verification_token = str(body.get("emailVerificationToken", "")).strip()
    # Fix: the structured name parts were accepted from the client and then dropped,
    # leaving every new user with a display name and no first/last name. The profile
    # editors then had to guess the parts back out of it.
    first_name = str(body.get("firstName") or "").strip() or None
    middle_name = str(body.get("middleName") or "").strip() or None
    last_name = str(body.get("lastName") or "").strip() or None
    suffix = str(body.get("suffix") or "").strip() or None
    if _person_name_has_number(name, first_name, middle_name, last_name, suffix):
        # Fix: enforce the rule for every staff or driver account created by an admin.
        return _err(PERSON_NAME_NUMBER_ERROR, 400)
    if first_name or middle_name or last_name or suffix:
        name = _format_display_name(first_name, middle_name, last_name, suffix, name)
    if not email or not name or not password or not role_id:
        return _err("name, email, password and roleId are required")
    password_error = _validate_password_strength(password)
    if password_error:
        return _err(password_error)
    if not phone:
        return _err(PHILIPPINE_PHONE_ERROR)
    if not _is_gmail_email(email):
        return _err("Invalid email format for staff/driver account")
    if role_id not in {x for x, _ in RoleType.choices}:
        return _err("Role not found", 404)
    # Added: driver service area is selected during registration, not in fleet management.
    service_area = str(body.get("serviceArea") or "").strip().casefold()
    if role_id == RoleType.DRIVER:
        if str(staff.get("role") or "").upper() not in {RoleType.ADMIN, RoleType.SUPER_ADMIN}:
            return _err("Only administrators can assign a driver service area", 403)
        if service_area not in {"silay", "talisay"}:
            return _err("Select Silay or Talisay as the driver's service area", 400)
    role = role_id
    existing_message = _staff_email_conflict_message(email, role_id)
    if existing_message:
        return _err(existing_message, 409)
    if not _is_email_verification_token_valid(email_verification_token, email, "staff"):
        return _err("Please verify this email address before creating the user", 400)
    # Keep account creation and its required service-area assignment atomic.
    with transaction.atomic():
        user = User.objects.create(
            email=email,
            password=hash_password(password),
            name=name,
            first_name=first_name,
            middle_name=middle_name,
            last_name=last_name,
            suffix=suffix,
            phone=phone,
            avatar=body.get("avatar"),
            role=role,
            is_active=bool(body.get("isActive", True)),
        )
        if role == RoleType.DRIVER:
            DriverServiceArea.objects.create(driver=user, city=service_area, assigned_by=staff.get("userId"))
    warnings: list[str] = []
    try:
        _email_new_staff_credentials(user, password)
    except Exception:
        logger.exception("Failed to send new staff credentials email for user=%s", user.id)
        warnings.append("credentials_email_failed")
    actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
    try:
        _create_staff_notifications(
            title="User added",
            message=f"{actor_name} added user {user.name} ({user.email}) with role {user.role}.",
            notification_type="USER",
            reference_type="user",
            reference_id=user.id,
        )
    except Exception:
        logger.exception("Failed to create staff notifications for new user=%s", user.id)
        warnings.append("staff_notification_failed")
    serialized_user = _serialize_model(user, exclude={"password"})
    serialized_user["serviceAreas"] = [area.city for area in user.service_areas.all()]
    serialized_user["serviceArea"] = serialized_user["serviceAreas"][0] if serialized_user["serviceAreas"] else ""
    payload: dict[str, Any] = {"success": True, "user": serialized_user}
    if warnings:
        payload["warnings"] = warnings
    return _ok(payload, 201)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
def user_detail(request: HttpRequest, user_id: str) -> JsonResponse:
    staff, err = _require_staff(request)
    if err:
        return err
    try:
        user = User.objects.prefetch_related("service_areas").get(id=user_id)
    except User.DoesNotExist:
        return _err("User not found", 404)
    actor_role = str(staff.get("role") or "").upper()
    is_admin = actor_role in {RoleType.ADMIN, RoleType.SUPER_ADMIN}
    is_self = str(staff.get("userId")) == str(user.id)
    # Fix: self-service profiles never grant administration of other accounts.
    if not is_admin and not is_self:
        return _err("Forbidden", 403)
    if request.method != "GET" and user.role == RoleType.SUPER_ADMIN and actor_role != RoleType.SUPER_ADMIN:
        return _err("Only the owner can modify this account", 403)
    if request.method == "DELETE" and (not is_admin or is_self):
        return _err("This account cannot be deleted by this session", 403)
    if request.method == "GET":
        row = _serialize_model(user, exclude={"password"})
        row["serviceAreas"] = [area.city for area in user.service_areas.all()]
        row["serviceArea"] = row["serviceAreas"][0] if row["serviceAreas"] else ""
        return _ok({"success": True, "user": row})
    if request.method == "DELETE":
        actor_name = str(staff.get("name") or "Staff").strip() or "Staff"
        deleted_name = str(user.name or "User").strip() or "User"
        deleted_email = str(user.email or "").strip()
        user.delete()
        _create_staff_notifications(
            title="User deleted",
            message=f"{actor_name} deleted user {deleted_name}{f' ({deleted_email})' if deleted_email else ''}.",
            notification_type="USER",
            reference_type="user",
            reference_id=user_id,
        )
        return _ok({"success": True})
    body = _json_body(request)
    # Fix: privilege changes require administration even on one's own account.
    if not is_admin and any(key in body for key in ("roleId", "isActive", "adminResetPassword")):
        return _err("Only administrators can change account privileges", 403)
    if body.get("roleId") == RoleType.SUPER_ADMIN and actor_role != RoleType.SUPER_ADMIN:
        return _err("Only the owner can assign this role", 403)
    if _submitted_person_name_has_number(body):
        return _err(PERSON_NAME_NUMBER_ERROR, 400)
    current_email = str(user.email or "").strip().lower()
    current_role = str(user.role or "").strip()
    requested_email_raw = body.get("email", None)
    requested_email = current_email
    email_change_requested = False
    if requested_email_raw is not None:
        requested_email = str(requested_email_raw).strip().lower()
        email_change_requested = requested_email != current_email

    requested_role = str(body.get("roleId") or current_role).strip()
    role_change_requested = requested_role != current_role
    service_area_supplied = "serviceArea" in body
    service_area = str(body.get("serviceArea") or "").strip().casefold()
    if requested_role == RoleType.DRIVER and service_area_supplied:
        # Added: service-area changes remain an administrator-owned account setting.
        if str(staff.get("role") or "").upper() not in {RoleType.ADMIN, RoleType.SUPER_ADMIN}:
            return _err("Only administrators can assign a driver service area", 403)
        if service_area not in {"silay", "talisay"}:
            return _err("Select Silay or Talisay as the driver's service area", 400)
    # Fix: legacy missing service areas must not block unrelated profile/password updates.
    if role_change_requested and requested_role == RoleType.DRIVER and not service_area_supplied and not user.service_areas.exists():
        return _err("Select Silay or Talisay as the driver's service area", 400)
    if email_change_requested or role_change_requested:
        existing_message = _staff_email_conflict_message(requested_email, requested_role, exclude_user_id=user.id)
        if existing_message:
            return _err(existing_message, 409)

    password_change_requested = bool(body.get("password"))
    admin_password_reset_requested = password_change_requested and bool(body.get("adminResetPassword"))
    if admin_password_reset_requested:
        actor_role = str(staff.get("role") or "").strip().upper()
        target_role = str(user.role or "").strip().upper()
        if actor_role not in {RoleType.SUPER_ADMIN, RoleType.ADMIN}:
            return _err("Only an administrator can reset another user's password", 403)
        if target_role == RoleType.SUPER_ADMIN and actor_role != RoleType.SUPER_ADMIN:
            return _err("Only the owner can reset this password", 403)

    if email_change_requested or (password_change_requested and not admin_password_reset_requested):
        email_verification_token = str(body.get("emailVerificationToken", "")).strip()
        old_email_verification_token = str(body.get("oldEmailVerificationToken", "")).strip()
        verification_email = requested_email if email_change_requested else current_email
        if email_change_requested:
            # Require old-email confirmation token first
            if not _is_email_verification_token_valid(old_email_verification_token, current_email + ":old_confirmed", "staff"):
                return _err("Please verify your current (old) email address first", 400)
            # Then require new-email verification token
            if not _is_email_verification_token_valid(email_verification_token, requested_email, "staff"):
                return _err("Please verify your new email address before saving", 400)
        else:
            if not _is_email_verification_token_valid(email_verification_token, verification_email, "staff"):
                return _err("Please verify OTP before changing email or password", 400)

    if "firstName" in body:
        user.first_name = str(body.get("firstName") or "").strip() or None
    if "middleName" in body:
        user.middle_name = str(body.get("middleName") or "").strip() or None
    if "lastName" in body:
        user.last_name = str(body.get("lastName") or "").strip() or None
    if "suffix" in body:
        user.suffix = str(body.get("suffix") or "").strip() or None

    if any(k in body for k in ("firstName", "middleName", "lastName", "suffix")):
        user.name = _format_display_name(user.first_name, user.middle_name, user.last_name, user.suffix, user.name)
    elif "name" in body:
        user.name = str(body.get("name") or "").strip()

    if "phone" in body:
        # Fix: validate and persist the same numeric phone value returned to admin/staff clients.
        normalized_phone = _normalize_philippine_phone(body.get("phone"))
        if not normalized_phone:
            return _err(PHILIPPINE_PHONE_ERROR)
        user.phone = normalized_phone
    if "avatar" in body:
        user.avatar = body.get("avatar")
    if "twoFactorEnabled" in body:
        user.two_factor_enabled = bool(body.get("twoFactorEnabled"))
    if "loginAlertsEnabled" in body:
        user.login_alerts_enabled = bool(body.get("loginAlertsEnabled"))
    if "sessionTimeoutMinutes" in body:
        try:
            timeout_minutes = int(body.get("sessionTimeoutMinutes"))
        except (TypeError, ValueError):
            return _err("Session timeout must be a valid number")
        if timeout_minutes < 5:
            return _err("Session timeout must be at least 5 minutes")
        user.session_timeout_minutes = timeout_minutes
    if "email" in body:
        next_email = requested_email
        if not next_email:
            return _err("Email is required")
        if next_email != current_email and not _is_gmail_email(next_email):
            return _err("Invalid email format for staff/driver account")
        user.email = next_email
    if "isActive" in body:
        user.is_active = bool(body.get("isActive"))
    if body.get("password"):
        password_error = _validate_password_strength(str(body["password"]))
        if password_error:
            return _err(password_error)
        user.password = hash_password(str(body["password"]))
    if body.get("roleId"):
        role_value = str(body["roleId"])
        if role_value not in {x for x, _ in RoleType.choices}:
            return _err("Role not found", 404)
        user.role = role_value
    if email_change_requested or role_change_requested:
        # Fix: unchanged legacy emails must not block unrelated profile updates.
        existing_message = _staff_email_conflict_message(user.email, user.role, exclude_user_id=user.id)
        if existing_message:
            return _err(existing_message, 409)
    with transaction.atomic():
        user.save()
        if user.role != RoleType.DRIVER:
            # A non-driver account must not retain routing assignments.
            user.service_areas.all().delete()
        elif service_area_supplied:
            # The UI intentionally assigns one operational city per driver.
            user.service_areas.all().delete()
            DriverServiceArea.objects.create(
                driver=user,
                city=service_area,
                assigned_by=str(staff.get("userId") or ""),
            )
    row = _serialize_model(user, exclude={"password"})
    row["serviceAreas"] = [area.city for area in user.service_areas.all()]
    row["serviceArea"] = row["serviceAreas"][0] if row["serviceAreas"] else ""
    return _ok({"success": True, "user": row})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def customers_collection(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = _real_customers(Customer.objects.all()).order_by("-created_at")
        # Fix: a customer session may only read its own directory record.
        if p.get("type") == "customer":
            qs = qs.filter(id=p.get("userId"))
        s = str(request.GET.get("search", "")).strip()
        if s:
            qs = qs.filter(Q(name__icontains=s) | Q(email__icontains=s) | Q(phone__icontains=s))
        # Added: the Clients page's "Pending approval" filter.
        approval_filter = str(request.GET.get("approvalStatus", "")).strip().upper()
        if approval_filter:
            if approval_filter not in CustomerApprovalStatus.values:
                return _err("Invalid approvalStatus filter", 400)
            qs = qs.filter(approval_status=approval_filter)
        total = qs.count()
        rows = list(qs[off : off + size])
        customer_ids = [customer.id for customer in rows]
        regular_orders = _real_orders(
            Order.objects.filter(customer_id__in=customer_ids).exclude(sales_channel=SalesChannel.RETAIL_POS)
        )
        # Fix: calculate client delivery totals in the database instead of making
        # the Clients page serialize every order before it can show these columns.
        delivered_stats = {
            str(entry["customer_id"]): entry
            for entry in regular_orders.filter(status=OrderStatus.DELIVERED)
            .values("customer_id")
            .annotate(successful_deliveries=Count("id"), successful_delivery_spend=Sum("total_amount"))
        }
        last_orders: dict[str, dict[str, Any]] = {}
        for entry in regular_orders.order_by("-created_at").values("customer_id", "order_number", "created_at"):
            last_orders.setdefault(str(entry["customer_id"]), entry)

        serialized_customers = []
        for customer in rows:
            customer_data = _serialize_model(customer, exclude={"password"})
            stats = delivered_stats.get(str(customer.id), {})
            last_order = last_orders.get(str(customer.id), {})
            customer_data["successfulDeliveries"] = _int(stats.get("successful_deliveries"), 0)
            customer_data["successfulDeliverySpend"] = float(stats.get("successful_delivery_spend") or 0)
            customer_data["lastOrderNumber"] = last_order.get("order_number")
            customer_data["lastOrderDate"] = _serialize_value(last_order.get("created_at"))
            serialized_customers.append(customer_data)

        response_payload: dict[str, Any] = {"success": True, "customers": serialized_customers, "total": total, "page": page, "pageSize": size, "totalPages": (total + size - 1) // size}
        if p.get("type") == "staff":
            # Independent of paging and filters, so the review badge stays accurate.
            response_payload["pendingApprovalCount"] = _real_customers(
                Customer.objects.filter(approval_status=CustomerApprovalStatus.PENDING_APPROVAL)
            ).count()
        return _ok(response_payload)
    _, err = _require_staff(request)
    if err:
        return err
    # Customer accounts are created through the verified self-registration flow.
    # Staff must not provision credentials through this administrative endpoint.
    return _err("Forbidden", 403)


def _review_customer_registration(request: HttpRequest, customer_id: str, body: dict[str, Any]) -> JsonResponse:
    """Record an administrator's approve/reject decision on a client registration.

    Idempotent: repeating the current decision changes nothing and notifies no one
    again. A rejected registration may later be approved; an approved account is
    never "rejected" (deactivate it instead), so a live session cannot be orphaned.
    """
    staff, err = _require_staff(request)
    if err:
        return err
    if str(staff.get("role") or "").strip().upper() not in {RoleType.ADMIN, RoleType.SUPER_ADMIN}:
        return _err("Only administrators can review client registrations", 403)
    decision = str(body.get("approvalStatus") or "").strip().upper()
    if decision not in _REGISTRATION_DECISIONS:
        return _err("approvalStatus must be APPROVED or REJECTED", 400)
    notes = str(body.get("approvalNotes") or "").strip()
    if decision == CustomerApprovalStatus.REJECTED and not notes:
        return _err("A reason is required to reject a registration", 400)

    reviewer_id = str(staff.get("userId") or "").strip() or None
    reviewer_name = str(staff.get("name") or "").strip()
    if not reviewer_name and reviewer_id:
        reviewer_name = User.objects.filter(id=reviewer_id).values_list("name", flat=True).first() or ""

    with transaction.atomic():
        # Locked so two administrators deciding at once cannot both send a decision.
        c = Customer.objects.select_for_update().filter(id=customer_id).first()
        if not c:
            return _err("Customer not found", 404)
        if c.approval_status == decision:
            return _ok({"success": True, "unchanged": True, "customer": _serialize_model(c, exclude={"password"})})
        if decision == CustomerApprovalStatus.REJECTED and c.approval_status == CustomerApprovalStatus.APPROVED:
            return _err("An approved client cannot be rejected. Deactivate the account instead.", 409)
        c.approval_status = decision
        # Re-approving a rejected registration replaces the old rejection reason.
        c.approval_notes = notes or None
        c.approval_reviewed_at = timezone.now()
        c.approval_reviewed_by_user_id = reviewer_id
        c.approval_reviewed_by_name = reviewer_name or None
        c.save(update_fields=[
            "approval_status",
            "approval_notes",
            "approval_reviewed_at",
            "approval_reviewed_by_user_id",
            "approval_reviewed_by_name",
            "updated_at",
        ])

    # The decision is committed; tell the client without letting delivery fail it.
    approved = decision == CustomerApprovalStatus.APPROVED
    try:
        notification_services._create_customer_notification(
            customer=c,
            title="Registration approved" if approved else "Registration not approved",
            message=(
                "Your client registration was approved. You can now sign in."
                if approved
                else f"Your client registration was not approved. Reason: {notes}"
            ),
            notification_type="ACCOUNT",
            reference_type="CUSTOMER",
            reference_id=c.id,
        )
    except Exception:
        logger.exception("Failed to record registration decision notification customer=%s", c.id)
    try:
        # Rendered here, delivered on the transport's background thread.
        if approved:
            email_notifications._email_customer_registration_approved(c)
        else:
            email_notifications._email_customer_registration_rejected(c, notes)
    except Exception:
        logger.exception("Failed to queue registration decision email customer=%s", c.id)
    return _ok({"success": True, "customer": _serialize_model(c, exclude={"password"})})


@csrf_exempt
@require_http_methods(["GET", "PUT", "PATCH", "DELETE"])
def customer_detail(request: HttpRequest, customer_id: str) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    if request.method in {"PUT", "PATCH"}:
        review_body = _json_body(request)
        # Added: registration review is its own admin-only action; it never rides
        # along with a profile edit, so a customer cannot approve themselves.
        if isinstance(review_body, dict) and "approvalStatus" in review_body:
            return _review_customer_registration(request, customer_id, review_body)
    try:
        c = Customer.objects.get(id=customer_id)
    except Customer.DoesNotExist:
        return _err("Customer not found", 404)
    if request.method == "GET":
        if p.get("type") == "customer" and p.get("userId") != c.id:
            return _err("Forbidden", 403)
        cust_data = _serialize_model(c, exclude={"password"})
        from .rgb.services import get_customer_bottle_balances
        cust_data["bottleBalances"] = get_customer_bottle_balances(c)
        return _ok({"success": True, "customer": cust_data})
    if p.get("type") != "staff" and p.get("userId") != c.id:
        return _err("Forbidden", 403)
    # Fix: delivery staff must not mutate customer accounts or security settings.
    if p.get("type") == "staff" and p.get("role") not in {RoleType.ADMIN, RoleType.SUPER_ADMIN}:
        return _err("Only administrators can manage customer accounts", 403)
    if request.method == "DELETE":
        c.delete()
        return _ok({"success": True})
    body = _json_body(request)
    if body.get("password"):
        password_error = _validate_password_strength(str(body["password"]))
        if password_error:
            return _err(password_error)
    if body.get("password") and not _is_email_verification_token_valid(
        str(body.get("emailVerificationToken") or ""), c.email, "customer"
    ):
        return _err("Please verify OTP before changing the password", 400)
    if _submitted_person_name_has_number(body):
        return _err(PERSON_NAME_NUMBER_ERROR, 400)
    discount_keys = {
        "discountOption",
        "discountStatus",
        "discountPercent",
        "discountAmountPerCase",
    }
    if p.get("type") == "staff" and any(key in body for key in discount_keys):
        staff_role = str(p.get("role") or "").strip().upper()
        option = str(body.get("discountOption") or getattr(c, "discount_option", DISCOUNT_NO)).strip().upper()
        status = str(body.get("discountStatus") or getattr(c, "discount_status", DISCOUNT_REMOVED)).strip().upper()
        percent = float(body.get("discountPercent") if body.get("discountPercent") is not None else getattr(c, "discount_percent", 0) or 0)
        amount_per_case = float(body.get("discountAmountPerCase") if body.get("discountAmountPerCase") is not None else getattr(c, "discount_amount_per_case", 0) or 0)

        if option not in set(DISCOUNT_PRESET_PERCENT.keys()) | {DISCOUNT_OTHER}:
            return _err("Invalid discount option", 400)
        if status not in {DISCOUNT_ACTIVE, DISCOUNT_CANCELLED, DISCOUNT_REMOVED}:
            return _err("Invalid discount status", 400)

        if option in DISCOUNT_PRESET_PERCENT:
            percent = float(DISCOUNT_PRESET_PERCENT[option])
            amount_per_case = 0.0
        elif option == DISCOUNT_OTHER:
            percent = max(0.0, percent)
            if percent <= 0:
                return _err("For Other discount, set a custom percent", 400)
            if percent > 25 and staff_role != RoleType.SUPER_ADMIN:
                return _err("Only owner can apply custom discount above 25%", 403)
            amount_per_case = 0.0

        c.discount_option = option
        c.discount_status = status
        c.discount_percent = percent
        c.discount_amount_per_case = amount_per_case
        c.discount_applied_by_user_id = str(p.get("userId") or "").strip() or None
        c.discount_applied_by_name = str(p.get("name") or "").strip() or None
        c.discount_updated_at = timezone.now()

    if "firstName" in body:
        c.first_name = str(body.get("firstName") or "").strip() or None
    if "middleName" in body:
        c.middle_name = str(body.get("middleName") or "").strip() or None
    if "lastName" in body:
        c.last_name = str(body.get("lastName") or "").strip() or None
    if "suffix" in body:
        c.suffix = str(body.get("suffix") or "").strip() or None

    if any(k in body for k in ("firstName", "middleName", "lastName", "suffix")):
        c.name = _format_display_name(c.first_name, c.middle_name, c.last_name, c.suffix, c.name)
    elif "name" in body:
        c.name = str(body.get("name") or "").strip()

    mapping = [("phone", "phone"), ("avatar", "avatar"), ("address", "address"), ("city", "city"), ("province", "province"), ("zipCode", "zip_code"), ("latitude", "latitude"), ("longitude", "longitude")]
    for key, attr in mapping:
        if key in body:
            if key == "address":
                setattr(c, attr, _strip_default_country_suffix(body.get(key)))
            else:
                setattr(c, attr, body.get(key))
    c.country = DEFAULT_COUNTRY
    if any(key in body for key in {"address", "city", "province", "zipCode", "latitude", "longitude"}):
        address_error = _ensure_negros_occidental_address(
            latitude=c.latitude,
            longitude=c.longitude,
            city=c.city,
            province=c.province,
            require_coordinates=False,
        )
        if address_error:
            return _err(address_error, 400)
    if "isActive" in body and p.get("type") == "staff":
        c.is_active = bool(body.get("isActive"))
    # Fix: these customer settings were accepted by the UI but previously discarded.
    if "twoFactorEnabled" in body:
        c.two_factor_enabled = bool(body.get("twoFactorEnabled"))
    if "loginAlertsEnabled" in body:
        c.login_alerts_enabled = bool(body.get("loginAlertsEnabled"))
    if body.get("password"):
        password_error = _validate_password_strength(str(body["password"]))
        if password_error:
            return _err(password_error)
        c.password = hash_password(str(body["password"]))
    with transaction.atomic():
        c.save()
        # Advance the existing order delta feed when live customer details change.
        # Shipping snapshots and original order dates remain untouched.
        Order.objects.filter(customer=c).update(updated_at=timezone.now())
    return _ok({"success": True, "customer": _serialize_model(c, exclude={"password"})})


@require_GET
def categories_list(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    return _ok({"success": True, "categories": []})
