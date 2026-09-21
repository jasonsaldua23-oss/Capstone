"""Transactional emails for auth, order, replacement and trip events."""

from datetime import datetime
from typing import Any

from django.utils import timezone

from . import views_api as legacy
from .api_constants import OTP_EXPIRY_MINUTES, _REPLACEMENT_CUSTOMER_COPY
from .api_utils import to_int as _int
from .email_templates import EmailBody, ProductLine, format_quantity, time_greeting
from .models import (
    Customer,
    Inventory,
    Order,
    PurchaseRequestStatus,
    Replacement,
    ReplacementStatus,
    RoleType,
    Trip,
    TripDropPoint,
    User,
)


# Helpers owned by sibling modules. Routing them through views_api keeps
# a single resolution point, so tests that patch there still apply.


def _account_display_name(email: str) -> str:
    return legacy._account_display_name(email)


def _create_staff_notifications(*, title: str, message: str, notification_type: str='INVENTORY', reference_type: str | None=None, reference_id: str | None=None) -> None:
    return legacy._create_staff_notifications(title=title, message=message, notification_type=notification_type, reference_type=reference_type, reference_id=reference_id)


def _email_purchase_request_approved_to_customer(order: Order) -> None:
    return legacy._email_purchase_request_approved_to_customer(order)


def _email_purchase_request_rejected_to_customer(order: Order, rejection_reason: str) -> None:
    return legacy._email_purchase_request_rejected_to_customer(order, rejection_reason)


def _get_product_size_label(product: Any) -> str:
    return legacy._get_product_size_label(product)


def _is_gmail_email(email: str) -> bool:
    return legacy._is_gmail_email(email)


def _normalize_email(value: Any) -> str:
    return legacy._normalize_email(value)


def _order_delivery_address(order: Order | None) -> str:
    return legacy._order_delivery_address(order)


def _order_product_lines(order: Order | None) -> list[ProductLine]:
    return legacy._order_product_lines(order)


def _order_reference_details(order: Order, *, include_amount: bool=True) -> list[tuple[str, str]]:
    return legacy._order_reference_details(order, include_amount=include_amount)


def _replacement_product_lines(replacement: Replacement | None) -> list[ProductLine]:
    return legacy._replacement_product_lines(replacement)


def _send_structured_email(*, subject: str, heading: str, body: EmailBody, recipients: list[str], preheader: str='') -> None:
    return legacy._send_structured_email(subject=subject, heading=heading, body=body, recipients=recipients, preheader=preheader)


def _trip_product_lines(trip: Trip | None) -> list[ProductLine]:
    return legacy._trip_product_lines(trip)


def _send_reset_otp_email(email: str, otp_code: str) -> None:
    heading = "Password reset code"
    body = EmailBody(
        recipient_name=_account_display_name(email),
        time_greeting=time_greeting(),
        paragraphs=["We received a request to reset the password for this account."],
        code=otp_code,
        code_label="Password reset code",
        code_note=f"This code expires in {OTP_EXPIRY_MINUTES} minutes.",
        next_step="Enter the code on the password reset page to choose a new password.",
        closing="Thank you.",
        note="If you did not request a password reset, you can ignore this email and your password will stay the same.",
    )
    _send_structured_email(
        subject="Password reset code for your account",
        heading=heading,
        body=body,
        recipients=[email],
        preheader="Use this code to reset your password.",
    )


def _send_email_verification_otp(email: str, otp_code: str) -> None:
    heading = "Verify your email address"
    body = EmailBody(
        recipient_name=_account_display_name(email),
        time_greeting=time_greeting(),
        paragraphs=["Please confirm that this email address belongs to you and can receive mail."],
        code=otp_code,
        code_label="Email verification code",
        code_note=f"This code expires in {OTP_EXPIRY_MINUTES} minutes.",
        next_step="Enter the code on the verification page to finish setting up your account.",
        closing="Thank you.",
        note="If you did not create an account with us, you can ignore this email.",
    )
    _send_structured_email(
        subject="Email verification code for your account",
        heading=heading,
        body=body,
        recipients=[email],
        preheader="Use this code to verify your email address.",
    )


def _send_login_otp_email(email: str, otp_code: str) -> None:
    heading = "Verify your login"
    body = EmailBody(
        recipient_name=_account_display_name(email),
        time_greeting=time_greeting(),
        paragraphs=["A login to your account needs to be confirmed with a one-time code."],
        code=otp_code,
        code_label="Login verification code",
        code_note=f"This code expires in {OTP_EXPIRY_MINUTES} minutes.",
        next_step="Enter the code on the login page to continue.",
        closing="Thank you.",
        note="If you did not try to log in, please reset your password as soon as possible.",
    )
    _send_structured_email(
        subject="Login verification code for your account",
        heading=heading,
        body=body,
        recipients=[email],
        preheader="Use this code to complete your login.",
    )


def _email_login_alert(user: User) -> None:
    recipient = _normalize_email(getattr(user, "email", ""))
    if not recipient:
        return
    signed_in_at = timezone.localtime(timezone.now()).strftime("%B %d, %Y at %I:%M %p")
    body = EmailBody(
        recipient_name=str(getattr(user, "name", "") or "").strip(),
        time_greeting=time_greeting(),
        paragraphs=["Your account was used to sign in."],
        details=[
            ("Date and time", signed_in_at),
            ("Account", recipient),
        ],
        details_heading="Sign-in details",
        next_step="If this was you, no action is needed. If it was not, reset your password right away.",
        closing="Thank you.",
    )
    _send_structured_email(
        subject="New sign-in to your account",
        heading="New sign-in to your account",
        body=body,
        recipients=[recipient],
        preheader="A sign-in to your account was recorded.",
    )


def _email_admin_login_failure_alert(
    user: User,
    ip_address: str,
    failure_count: int,
    failure_stage: str,
) -> None:
    """Warn the targeted administrator without exposing submitted credentials."""
    recipient = _normalize_email(getattr(user, "email", ""))
    if not recipient:
        return
    attempted_at = timezone.localtime(timezone.now()).strftime("%B %d, %Y at %I:%M %p")
    body = EmailBody(
        recipient_name=str(getattr(user, "name", "") or "").strip(),
        time_greeting=time_greeting(),
        paragraphs=["We detected repeated unsuccessful attempts to sign in to your administrator account."],
        details=[
            ("Date and time", attempted_at),
            ("Account", recipient),
            ("Failure stage", failure_stage),
            ("Source IP", ip_address),
            ("Recent failed attempts", str(failure_count)),
        ],
        details_heading="Security details",
        next_step="If this was not you, reset your password and contact the system owner immediately.",
        closing="Thank you.",
    )
    _send_structured_email(
        subject="Security alert: unsuccessful administrator sign-in attempts",
        heading="Unsuccessful sign-in attempts detected",
        body=body,
        recipients=[recipient],
        preheader="Repeated administrator sign-in failures were detected.",
    )


def _warehouse_staff_emails() -> list[str]:
    rows = User.objects.filter(role=RoleType.WAREHOUSE_STAFF, is_active=True).values_list("email", flat=True)
    out: list[str] = []
    for email in rows:
        value = _normalize_email(email)
        if value:
            out.append(value)
    return sorted(set(out))


def _ops_staff_emails() -> list[str]:
    rows = User.objects.filter(
        role__in=[RoleType.SUPER_ADMIN, RoleType.ADMIN, RoleType.WAREHOUSE_STAFF],
        is_active=True,
    ).values_list("email", flat=True)
    out: list[str] = []
    for email in rows:
        value = _normalize_email(email)
        if value:
            out.append(value)
    return sorted(set(out))


def _customer_email_and_name(order: Order | None) -> tuple[str, str]:
    customer = getattr(order, "customer", None)
    email = _normalize_email(getattr(customer, "email", ""))
    name = str(getattr(customer, "name", "") or getattr(order, "shipping_name", "") or "").strip()
    return email, name


def _email_new_order_to_warehouse_staff(order: Order) -> None:
    """Tell the warehouse a customer has submitted a new purchase request."""
    recipients = _warehouse_staff_emails()
    if not recipients:
        return
    _, customer_name = _customer_email_and_name(order)
    customer_name = customer_name or "A customer"
    reference = str(getattr(order, "purchase_request_number", "") or getattr(order, "order_number", "") or "").strip()
    details = _order_reference_details(order)
    details.extend([
        ("Customer", customer_name),
        ("Contact number", str(getattr(order, "shipping_phone", "") or "").strip()),
        ("Delivery address", _order_delivery_address(order)),
        ("Date submitted", timezone.localtime(getattr(order, "created_at", None) or timezone.now()).strftime("%B %d, %Y at %I:%M %p")),
    ])
    body = EmailBody(
        recipient_name="Warehouse Team",
        time_greeting=time_greeting(),
        paragraphs=[f"{customer_name} submitted a new purchase request through the customer portal."],
        details=details,
        products=_order_product_lines(order),
        products_heading="Products requested",
        next_step="Please review the request in the warehouse portal so it can be approved or rejected.",
        closing="Thank you.",
    )
    _send_structured_email(
        subject=f"New purchase request {reference}" if reference else "New purchase request received",
        heading="New purchase request received",
        body=body,
        recipients=recipients,
        preheader=f"{customer_name} submitted a new purchase request.",
    )


def _email_order_confirmed_to_customer(order: Order) -> None:
    """Kept for callers that approve a request: the customer reads it as an approval."""
    _email_purchase_request_approved_to_customer(order)


def _email_order_rejected_to_customer(order: Order, rejection_reason: str) -> None:
    is_pending_request = str(getattr(order, "request_status", "") or "").strip().upper() in {
        PurchaseRequestStatus.PENDING_APPROVAL,
        PurchaseRequestStatus.REJECTED,
    }
    if is_pending_request:
        _email_purchase_request_rejected_to_customer(order, rejection_reason)
        return

    customer_email, customer_name = _customer_email_and_name(order)
    if not customer_email:
        return
    order_number = str(getattr(order, "order_number", "") or "").strip()
    body = EmailBody(
        recipient_name=customer_name or "Customer",
        time_greeting=time_greeting(),
        paragraphs=[
            f"Your Order No. {order_number} has been rejected." if order_number
            else "Your order has been rejected."
        ],
        details=_order_reference_details(order),
        products=_order_product_lines(order),
        products_heading="Products in this order",
        reason_label="Reason for rejection",
        reason_text=str(rejection_reason or "").strip() or "No reason was provided.",
        next_step="You may place a new order at any time. Our team can help if you have questions.",
        closing="Thank you for your understanding.",
    )
    _send_structured_email(
        subject=f"Order {order_number} was rejected" if order_number else "Your order was rejected",
        heading="Your order was rejected",
        body=body,
        recipients=[customer_email],
        preheader="Your order was rejected.",
    )


def _email_order_cancelled_to_customer(order: Order, cancellation_reason: str, *, cancelled_by_customer: bool = False) -> None:
    customer_email, customer_name = _customer_email_and_name(order)
    if not customer_email:
        return
    order_number = str(
        getattr(order, "purchase_order_number", "") or getattr(order, "order_number", "") or ""
    ).strip()
    statement = (
        f"Your Order No. {order_number} has been cancelled."
        if order_number else
        "Your order has been cancelled."
    )
    paragraphs = [statement]
    if cancelled_by_customer:
        paragraphs.append("This cancellation was requested from your account.")
    body = EmailBody(
        recipient_name=customer_name or "Customer",
        time_greeting=time_greeting(),
        paragraphs=paragraphs,
        details=_order_reference_details(order),
        products=_order_product_lines(order),
        products_heading="Products in this order",
        reason_label="Reason for cancellation",
        reason_text=str(cancellation_reason or "").strip() or "No reason was provided.",
        next_step="Any reserved stock has been released. You may place a new order whenever you are ready.",
        closing="Thank you for your understanding.",
    )
    _send_structured_email(
        subject=f"Order {order_number} cancelled" if order_number else "Your order has been cancelled",
        heading="Your order has been cancelled",
        body=body,
        recipients=[customer_email],
        preheader="Your order has been cancelled.",
    )


def _email_order_preparing_to_customer(order: Order) -> None:
    customer_email, customer_name = _customer_email_and_name(order)
    if not customer_email:
        return
    order_number = str(
        getattr(order, "purchase_order_number", "") or getattr(order, "order_number", "") or ""
    ).strip()
    body = EmailBody(
        recipient_name=customer_name or "Customer",
        time_greeting=time_greeting(),
        paragraphs=[
            f"Your Order No. {order_number} is now being prepared by our warehouse team."
            if order_number else
            "Your order is now being prepared by our warehouse team."
        ],
        details=_order_reference_details(order) + [("Delivery address", _order_delivery_address(order))],
        products=_order_product_lines(order),
        products_heading="Products being prepared",
        next_step="We will email you again once your order is on the way.",
        closing="Thank you for ordering with us.",
    )
    _send_structured_email(
        subject=f"Order {order_number} is being prepared" if order_number else "Your order is being prepared",
        heading="Your order is being prepared",
        body=body,
        recipients=[customer_email],
        preheader="Your order is being prepared for delivery.",
    )


def _email_order_out_for_delivery_to_customer(order: Order) -> None:
    customer_email, customer_name = _customer_email_and_name(order)
    if not customer_email:
        return
    order_number = str(
        getattr(order, "purchase_order_number", "") or getattr(order, "order_number", "") or ""
    ).strip()

    driver_name = ""
    driver_phone = ""
    linked_drop_point = (
        TripDropPoint.objects.select_related("trip__driver")
        .filter(order_id=order.id)
        .order_by("-created_at")
        .first()
    )
    if linked_drop_point and getattr(linked_drop_point, "trip", None) and getattr(linked_drop_point.trip, "driver", None):
        driver = linked_drop_point.trip.driver
        driver_name = str(getattr(driver, "name", "") or "").strip()
        driver_phone = str(getattr(driver, "phone", "") or "").strip()

    details = _order_reference_details(order)
    details.append(("Delivery address", _order_delivery_address(order)))
    if driver_name:
        details.append(("Assigned driver", driver_name))
    if driver_phone:
        details.append(("Driver contact number", driver_phone))

    body = EmailBody(
        recipient_name=customer_name or "Customer",
        time_greeting=time_greeting(),
        paragraphs=[
            f"Your Order No. {order_number} is on the way to your delivery address."
            if order_number else
            "Your order is on the way to your delivery address."
        ],
        details=details,
        products=_order_product_lines(order),
        products_heading="Products in this delivery",
        next_step="Please prepare the payment amount and make sure someone is available to receive the delivery.",
        closing="Thank you for ordering with us.",
    )
    _send_structured_email(
        subject=f"Order {order_number} is out for delivery" if order_number else "Your order is out for delivery",
        heading="Your order is out for delivery",
        body=body,
        recipients=[customer_email],
        preheader="Your order is on the way.",
    )


def _email_order_delivered_to_customer(order: Order, *, received_by: str = "") -> None:
    customer_email, customer_name = _customer_email_and_name(order)
    if not customer_email:
        return
    order_number = str(
        getattr(order, "purchase_order_number", "") or getattr(order, "order_number", "") or ""
    ).strip()
    details = _order_reference_details(order)
    details.append(("Delivered on", timezone.localtime(timezone.now()).strftime("%B %d, %Y at %I:%M %p")))
    recipient_of_goods = str(received_by or getattr(order, "pod_recipient_name", "") or "").strip()
    if recipient_of_goods:
        details.append(("Received by", recipient_of_goods))
    body = EmailBody(
        recipient_name=customer_name or "Customer",
        time_greeting=time_greeting(),
        paragraphs=[
            f"Your Order No. {order_number} has been delivered."
            if order_number else
            "Your order has been delivered."
        ],
        details=details,
        products=_order_product_lines(order),
        products_heading="Products delivered",
        next_step="If any item arrived damaged or incorrect, you may submit a replacement request from your account.",
        closing="Thank you for ordering with us.",
    )
    _send_structured_email(
        subject=f"Order {order_number} has been delivered" if order_number else "Your order has been delivered",
        heading="Your order has been delivered",
        body=body,
        recipients=[customer_email],
        preheader="Your order has been delivered.",
    )


def _email_delivery_failed_to_customer(
    order: Order,
    failure_reason: str,
    *,
    rescheduled_for: datetime | None = None,
    order_cancelled: bool = False,
) -> None:
    customer_email, customer_name = _customer_email_and_name(order)
    if not customer_email:
        return
    order_number = str(
        getattr(order, "purchase_order_number", "") or getattr(order, "order_number", "") or ""
    ).strip()
    details = _order_reference_details(order)
    details.append(("Delivery address", _order_delivery_address(order)))
    if rescheduled_for is not None:
        details.append(("New delivery date", timezone.localtime(rescheduled_for).strftime("%B %d, %Y")))
    if rescheduled_for is not None:
        next_step = "Our team will attempt the delivery again on the date above."
    elif order_cancelled:
        next_step = (
            "This order has been closed and any reserved stock has been released. "
            "You may place a new order whenever you are ready."
        )
    else:
        next_step = "Our team will contact you to arrange another delivery date."
    body = EmailBody(
        recipient_name=customer_name or "Customer",
        time_greeting=time_greeting(),
        paragraphs=[
            f"The delivery attempt for your Order No. {order_number} could not be completed."
            if order_number else
            "The delivery attempt for your order could not be completed."
        ],
        details=details,
        products=_order_product_lines(order),
        products_heading="Products in this delivery",
        reason_label="Reason the delivery was not completed",
        reason_text=str(failure_reason or "").strip() or "No reason was provided.",
        next_step=next_step,
        closing="Thank you for your patience.",
    )
    _send_structured_email(
        subject=f"Delivery for Order {order_number} was not completed" if order_number else "Your delivery was not completed",
        heading="Your delivery was not completed",
        body=body,
        recipients=[customer_email],
        preheader="We could not complete your delivery.",
    )


def _email_replacement_submitted_to_customer(replacement: Replacement) -> None:
    order = getattr(replacement, "order", None)
    customer_email, customer_name = _customer_email_and_name(order)
    if not customer_email:
        return
    replacement_number = str(getattr(replacement, "replacement_number", "") or "").strip()
    details: list[tuple[str, str]] = []
    if replacement_number:
        details.append(("Replacement Request No.", replacement_number))
    if order is not None:
        details.append(("Order No.", str(getattr(order, "order_number", "") or "").strip()))
    details.append(("Date submitted", timezone.localtime(getattr(replacement, "created_at", None) or timezone.now()).strftime("%B %d, %Y at %I:%M %p")))
    body = EmailBody(
        recipient_name=customer_name or "Customer",
        time_greeting=time_greeting(),
        paragraphs=[
            f"Your Replacement Request No. {replacement_number} has been received and is now for review."
            if replacement_number else
            "Your replacement request has been received and is now for review."
        ],
        details=details,
        products=_replacement_product_lines(replacement),
        products_heading="Products in this replacement request",
        reason_label="Reason for the request",
        reason_text=str(getattr(replacement, "reason", "") or "").strip(),
        next_step="We will email you again once the request has been reviewed.",
        closing="Thank you for letting us know.",
    )
    _send_structured_email(
        subject=f"Replacement Request {replacement_number} received" if replacement_number else "Replacement request received",
        heading="We received your replacement request",
        body=body,
        recipients=[customer_email],
        preheader="Your replacement request is under review.",
    )


def _email_replacement_submitted_to_staff(replacement: Replacement) -> None:
    recipients = _ops_staff_emails()
    if not recipients:
        return
    order = getattr(replacement, "order", None)
    _, customer_name = _customer_email_and_name(order)
    replacement_number = str(getattr(replacement, "replacement_number", "") or "").strip()
    details: list[tuple[str, str]] = []
    if replacement_number:
        details.append(("Replacement Request No.", replacement_number))
    if order is not None:
        details.append(("Order No.", str(getattr(order, "order_number", "") or "").strip()))
    details.append(("Customer", customer_name or "Customer"))
    details.append(("Date submitted", timezone.localtime(getattr(replacement, "created_at", None) or timezone.now()).strftime("%B %d, %Y at %I:%M %p")))
    body = EmailBody(
        recipient_name="Team",
        time_greeting=time_greeting(),
        paragraphs=[f"{customer_name or 'A customer'} submitted a replacement request."],
        details=details,
        products=_replacement_product_lines(replacement),
        products_heading="Products in this replacement request",
        reason_label="Reason given by the customer",
        reason_text=str(getattr(replacement, "reason", "") or "").strip(),
        next_step="Please review the request in the admin portal so it can be approved or rejected.",
        closing="Thank you.",
    )
    _send_structured_email(
        subject=f"New replacement request {replacement_number}" if replacement_number else "New replacement request",
        heading="New replacement request received",
        body=body,
        recipients=recipients,
        preheader="A customer submitted a replacement request.",
    )


def _email_replacement_outcome_to_customer(
    replacement: Replacement,
    status: str,
    *,
    notes: str = "",
    scheduled_delivery_date: Any = None,
) -> None:
    copy = _REPLACEMENT_CUSTOMER_COPY.get(str(status or "").strip().upper())
    if not copy:
        return
    order = getattr(replacement, "order", None)
    customer_email, customer_name = _customer_email_and_name(order)
    if not customer_email:
        return
    replacement_number = str(getattr(replacement, "replacement_number", "") or "").strip()

    details: list[tuple[str, str]] = []
    if replacement_number:
        details.append(("Replacement Request No.", replacement_number))
    if order is not None:
        details.append(("Order No.", str(getattr(order, "order_number", "") or "").strip()))
    if scheduled_delivery_date is not None:
        try:
            details.append(("Scheduled delivery date", scheduled_delivery_date.strftime("%B %d, %Y")))
        except AttributeError:
            details.append(("Scheduled delivery date", str(scheduled_delivery_date)))

    reason_label = ""
    reason_text = ""
    if str(status or "").strip().upper() == ReplacementStatus.REJECTED:
        reason_label = "Reason for rejection"
        reason_text = str(notes or "").strip() or "No reason was provided."
    elif str(notes or "").strip():
        reason_label = "Note from our team"
        reason_text = str(notes).strip()

    statement = copy["statement"].format(number=replacement_number) if replacement_number else copy["statement"].replace(
        " No. {number}", ""
    ).format(number="")
    body = EmailBody(
        recipient_name=customer_name or "Customer",
        time_greeting=time_greeting(),
        paragraphs=[statement],
        details=details,
        products=_replacement_product_lines(replacement),
        products_heading="Products in this replacement request",
        reason_label=reason_label,
        reason_text=reason_text,
        next_step=copy["next_step"],
        closing="Thank you.",
    )
    subject = copy["subject"].format(number=replacement_number) if replacement_number else copy["heading"]
    _send_structured_email(
        subject=subject,
        heading=copy["heading"],
        body=body,
        recipients=[customer_email],
        preheader=statement,
    )


def _email_replacement_update_to_staff(
    replacement: Replacement,
    status: str,
    *,
    actor_name: str,
    notes: str = "",
    scheduled_delivery_date: Any = None,
) -> None:
    recipients = _ops_staff_emails()
    if not recipients:
        return
    order = getattr(replacement, "order", None)
    _, customer_name = _customer_email_and_name(order)
    replacement_number = str(getattr(replacement, "replacement_number", "") or "").strip()
    outcome = str(status or "").replace("_", " ").strip().lower()

    details: list[tuple[str, str]] = []
    if replacement_number:
        details.append(("Replacement Request No.", replacement_number))
    if order is not None:
        details.append(("Order No.", str(getattr(order, "order_number", "") or "").strip()))
    details.append(("Customer", customer_name or "Customer"))
    details.append(("Handled by", str(actor_name or "Staff").strip()))
    if scheduled_delivery_date is not None:
        try:
            details.append(("Scheduled delivery date", scheduled_delivery_date.strftime("%B %d, %Y")))
        except AttributeError:
            details.append(("Scheduled delivery date", str(scheduled_delivery_date)))

    body = EmailBody(
        recipient_name="Team",
        time_greeting=time_greeting(),
        paragraphs=[
            f"Replacement Request No. {replacement_number} for {customer_name or 'a customer'} is now {outcome}."
            if replacement_number else
            f"A replacement request for {customer_name or 'a customer'} is now {outcome}."
        ],
        details=details,
        products=_replacement_product_lines(replacement),
        products_heading="Products in this replacement request",
        reason_label="Notes" if str(notes or "").strip() else "",
        reason_text=str(notes or "").strip(),
        closing="Thank you.",
    )
    _send_structured_email(
        subject=f"Replacement Request {replacement_number} update" if replacement_number else "Replacement request update",
        heading="Replacement request update",
        body=body,
        recipients=recipients,
        preheader=f"Replacement request is now {outcome}.",
    )


def _email_trip_assigned_to_driver(trip: Trip) -> None:
    driver = getattr(trip, "driver", None)
    recipient = _normalize_email(getattr(driver, "email", ""))
    if not recipient:
        return
    trip_number = str(getattr(trip, "trip_number", "") or "").strip()
    vehicle = getattr(trip, "vehicle", None)
    vehicle_type_label = str(getattr(vehicle, "type", "") or "").replace("_", " ").strip().title()
    vehicle_label = " ".join(
        part for part in [
            str(getattr(vehicle, "brand", "") or "").strip(),
            str(getattr(vehicle, "model", "") or "").strip(),
            f"({str(getattr(vehicle, 'license_plate', '') or '').strip()})"
            if str(getattr(vehicle, "license_plate", "") or "").strip() else "",
            f"- {vehicle_type_label}" if vehicle_type_label else "",
        ] if part
    ).strip()

    stops = list(trip.drop_points.select_related("order").order_by("sequence"))
    details: list[tuple[str, str]] = []
    if trip_number:
        details.append(("Trip No.", trip_number))
    if vehicle_label:
        details.append(("Vehicle", vehicle_label))
    details.append(("Delivery stops", str(len(stops))))
    planned_start = getattr(trip, "planned_start_at", None)
    if planned_start:
        details.append(("Planned start", timezone.localtime(planned_start).strftime("%B %d, %Y at %I:%M %p")))
    for stop in stops[:10]:
        order_number = str(getattr(getattr(stop, "order", None), "order_number", "") or "").strip()
        location = str(getattr(stop, "location_name", "") or getattr(stop, "address", "") or "").strip()
        label = f"Stop {getattr(stop, 'sequence', 0)}"
        value = " - ".join(part for part in [order_number, location] if part)
        if value:
            details.append((label, value))

    body = EmailBody(
        recipient_name=str(getattr(driver, "name", "") or "").strip() or "Driver",
        time_greeting=time_greeting(),
        paragraphs=[
            f"You have been assigned to Trip No. {trip_number}."
            if trip_number else
            "You have been assigned to a new delivery trip."
        ],
        details=details,
        details_heading="Trip details",
        products=_trip_product_lines(trip),
        products_heading="Products to load for this trip",
        next_step="Please review the trip in the driver app before you start, and confirm the load with the warehouse team.",
        closing="Thank you.",
    )
    _send_structured_email(
        subject=f"Trip {trip_number} assigned to you" if trip_number else "A new trip has been assigned to you",
        heading="You have a new delivery trip",
        body=body,
        recipients=[recipient],
        preheader="A delivery trip has been assigned to you.",
    )


def _email_new_staff_credentials(user: User, plain_password: str) -> None:
    recipient = _normalize_email(getattr(user, "email", ""))
    if not recipient:
        return
    role_value = str(getattr(user, "role", "") or "").strip().upper()
    if role_value not in {RoleType.WAREHOUSE_STAFF, RoleType.DRIVER}:
        return
    if not _is_gmail_email(recipient):
        return
    role_label = str(getattr(user, "role", "") or "STAFF").replace("_", " ").title()
    body = EmailBody(
        recipient_name=str(getattr(user, "name", "") or "").strip(),
        time_greeting=time_greeting(),
        paragraphs=[f"An administrator has created your {role_label} account."],
        details=[
            ("Login email", recipient),
            ("Temporary password", str(plain_password or "")),
            ("Role", role_label),
        ],
        details_heading="Your account details",
        next_step="Please log in and change your password right away. Keep these details private.",
        closing="Thank you.",
    )
    _send_structured_email(
        subject="Your account is ready",
        heading="Your account is ready",
        body=body,
        recipients=[recipient],
        preheader="Your account has been created.",
    )


def _email_customer_registration_approved(customer: Customer) -> None:
    recipient = _normalize_email(getattr(customer, "email", ""))
    if not recipient:
        return
    body = EmailBody(
        recipient_name=str(getattr(customer, "name", "") or "").strip() or "Customer",
        time_greeting=time_greeting(),
        paragraphs=["An administrator has approved your client registration."],
        details=[("Account", recipient)],
        details_heading="Account details",
        next_step="You can now sign in with the email address you registered with.",
        closing="Thank you.",
    )
    _send_structured_email(
        subject="Your registration was approved",
        heading="Your registration was approved",
        body=body,
        recipients=[recipient],
        preheader="Your account is ready to use.",
    )


def _email_customer_registration_rejected(customer: Customer, rejection_reason: str) -> None:
    recipient = _normalize_email(getattr(customer, "email", ""))
    if not recipient:
        return
    body = EmailBody(
        recipient_name=str(getattr(customer, "name", "") or "").strip() or "Customer",
        time_greeting=time_greeting(),
        paragraphs=["Your client registration was reviewed and was not approved."],
        details=[("Account", recipient)],
        details_heading="Account details",
        reason_label="Reason",
        reason_text=str(rejection_reason or "").strip() or "No reason was provided.",
        next_step="If you believe this was a mistake, please contact us and we will review it again.",
        closing="Thank you for your understanding.",
    )
    _send_structured_email(
        subject="Your registration was not approved",
        heading="Your registration was not approved",
        body=body,
        recipients=[recipient],
        preheader="Your registration was reviewed.",
    )


def _send_inventory_stock_alert(*, inventory: Inventory, status: str, available_qty: int, reason: str) -> None:
    """Send one committed stock transition through in-app, push, and email channels."""
    current_qty = max(0, _int(available_qty, 0))
    threshold = max(0, _int(getattr(inventory, "threshold", 0), 0))
    recipients = _ops_staff_emails()
    warehouse_name = str(getattr(getattr(inventory, "warehouse", None), "name", "") or "Warehouse").strip()
    product = getattr(inventory, "product", None)
    product_name = str(getattr(product, "name", "") or "Product").strip()
    sku = str(getattr(product, "sku", "") or "").strip()
    unit = str(getattr(product, "unit", "") or "case").strip()

    is_out_of_stock = status == "out_of_stock"
    title = f"Out of stock: {product_name}" if is_out_of_stock else f"Restock needed: {product_name}"
    message = (
        f"{product_name} at {warehouse_name} is out of stock."
        if is_out_of_stock
        else f"{product_name} at {warehouse_name} has reached its reorder point ({threshold} {unit}s)."
    )
    # Added: persist the alert and mirror it to registered browser/native devices.
    _create_staff_notifications(
        title=title,
        message=message,
        notification_type="INVENTORY",
        reference_type="inventory",
        reference_id=inventory.id,
    )
    if not recipients:
        return

    details = [("Warehouse", warehouse_name)]
    if sku:
        details.append(("SKU", sku))
    details.append(("Reorder threshold", format_quantity(threshold, unit)))
    details.append(("Recorded because of", str(reason or "").strip() or "a stock movement"))

    body = EmailBody(
        recipient_name="Operations Team",
        time_greeting=time_greeting(),
        paragraphs=[message],
        details=details,
        details_heading="Stock details",
        products=[
            ProductLine(
                name=product_name,
                category=str(getattr(product, "category", "") or "").strip(),
                size=_get_product_size_label(product),
                quantity=format_quantity(current_qty, unit),
            )
        ],
        products_heading="Remaining stock",
        next_step="Please arrange a restock so upcoming orders and counter sales are not affected.",
        closing="Thank you.",
    )
    _send_structured_email(
        subject=f"{'Out of stock' if is_out_of_stock else 'Restock needed'}: {product_name} at {warehouse_name}",
        heading="Out of stock alert" if is_out_of_stock else "Restock alert",
        body=body,
        recipients=recipients,
        preheader=message,
    )
