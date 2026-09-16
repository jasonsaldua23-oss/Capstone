"""Customer emails for the purchase-request approval workflow."""

from django.utils import timezone

from . import views_api as legacy
from .email_templates import EmailBody, ProductLine, time_greeting
from .models import Order


# Helpers owned by sibling modules. Routing them through views_api keeps
# a single resolution point, so tests that patch there still apply.


def _customer_email_and_name(order: Order | None) -> tuple[str, str]:
    return legacy._customer_email_and_name(order)


def _order_delivery_address(order: Order | None) -> str:
    return legacy._order_delivery_address(order)


def _order_product_lines(order: Order | None) -> list[ProductLine]:
    return legacy._order_product_lines(order)


def _order_reference_details(order: Order, *, include_amount: bool=True) -> list[tuple[str, str]]:
    return legacy._order_reference_details(order, include_amount=include_amount)


def _send_structured_email(*, subject: str, heading: str, body: EmailBody, recipients: list[str], preheader: str='') -> None:
    return legacy._send_structured_email(subject=subject, heading=heading, body=body, recipients=recipients, preheader=preheader)


def _email_purchase_request_submitted_to_customer(order: Order) -> None:
    """Confirm to the customer that their request reached us."""
    customer_email, customer_name = _customer_email_and_name(order)
    if not customer_email:
        return
    reference = str(getattr(order, "purchase_request_number", "") or getattr(order, "order_number", "") or "").strip()
    statement = (
        f"Your Purchase Request with Purchase Request No. {reference} has been received "
        "and is now waiting for approval."
        if reference else
        "Your purchase request has been received and is now waiting for approval."
    )
    details = _order_reference_details(order)
    details.append(("Delivery address", _order_delivery_address(order)))
    body = EmailBody(
        recipient_name=customer_name or "Customer",
        time_greeting=time_greeting(),
        paragraphs=[statement],
        details=details,
        products=_order_product_lines(order),
        products_heading="Below are the details of your request:",
        next_step="We will send you another email once your request has been reviewed.",
        closing="Thank you for ordering with us.",
    )
    _send_structured_email(
        subject=f"Purchase Request {reference} received" if reference else "Purchase request received",
        heading="We received your purchase request",
        body=body,
        recipients=[customer_email],
        preheader="Your purchase request is waiting for approval.",
    )


def _email_purchase_request_approved_to_customer(order: Order) -> None:
    customer_email, customer_name = _customer_email_and_name(order)
    if not customer_email:
        return
    pr_number = str(getattr(order, "purchase_request_number", "") or "").strip()
    po_number = str(getattr(order, "purchase_order_number", "") or getattr(order, "order_number", "") or "").strip()
    statement = (
        f"Your Purchase Request with Purchase Request No. {pr_number} has been approved."
        if pr_number else
        "Your purchase request has been approved."
    )
    paragraphs = [statement]
    if po_number:
        paragraphs.append(f"It has been recorded as Purchase Order No. {po_number}.")
    details = _order_reference_details(order)
    details.append(("Approved on", timezone.localtime(getattr(order, "approved_at", None) or timezone.now()).strftime("%B %d, %Y at %I:%M %p")))
    details.append(("Delivery address", _order_delivery_address(order)))
    body = EmailBody(
        recipient_name=customer_name or "Customer",
        time_greeting=time_greeting(),
        paragraphs=paragraphs,
        details=details,
        products=_order_product_lines(order),
        products_heading="Below are the details of your request:",
        next_step="We will let you know once your order is prepared for delivery.",
        closing="Thank you for ordering with us.",
    )
    _send_structured_email(
        subject=f"Purchase Request {pr_number} approved" if pr_number else "Your purchase request has been approved",
        heading="Your purchase request has been approved",
        body=body,
        recipients=[customer_email],
        preheader="Your purchase request has been approved.",
    )


def _email_purchase_request_rejected_to_customer(order: Order, rejection_reason: str) -> None:
    customer_email, customer_name = _customer_email_and_name(order)
    if not customer_email:
        return
    pr_number = str(getattr(order, "purchase_request_number", "") or getattr(order, "order_number", "") or "").strip()
    statement = (
        f"Your Purchase Request with Purchase Request No. {pr_number} has been rejected."
        if pr_number else
        "Your purchase request has been rejected."
    )
    body = EmailBody(
        recipient_name=customer_name or "Customer",
        time_greeting=time_greeting(),
        paragraphs=[statement],
        details=_order_reference_details(order),
        products=_order_product_lines(order),
        products_heading="Products in this request",
        reason_label="Reason for rejection",
        reason_text=str(rejection_reason or "").strip() or "No reason was provided.",
        next_step="You may submit a new request once the reason above has been addressed. Our team can help if you have questions.",
        closing="Thank you for your understanding.",
    )
    _send_structured_email(
        subject=f"Purchase Request {pr_number} was not approved" if pr_number else "Your purchase request was not approved",
        heading="Your purchase request was not approved",
        body=body,
        recipients=[customer_email],
        preheader="Your purchase request was not approved.",
    )
