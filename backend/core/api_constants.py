"""Shared constants for the core API modules."""

import re

from django.db.models import Q

from .models import (
    DriverStatus,
    DropPointStatus,
    DropPointType,
    OrderStatus,
    ReplacementStatus,
    RoleType,
)

PRODUCT_UNIT_CASE = "case"

PRODUCT_UNIT_PACK_BUNDLE = "pack"

PRODUCT_UNIT_BOTTLE = "bottle"

PRODUCT_UNIT_MIXED_CASE = "mixed_case"

ALLOWED_PRODUCT_UNITS = {PRODUCT_UNIT_CASE, PRODUCT_UNIT_PACK_BUNDLE, PRODUCT_UNIT_BOTTLE, PRODUCT_UNIT_MIXED_CASE}

HIDDEN_SAMPLE_WORDS = ("test", "demo", "sample", "dummy", "placeholder", "fake")

HIDDEN_SAMPLE_EMAIL_DOMAINS = ("@example.com", "@test.com", "@demo.com")

PASSWORD_POLICY_ERROR = "Password must be at least 8 characters and include uppercase, lowercase, number, and special character, with no spaces."

PHILIPPINE_PHONE_ERROR = "Please enter a valid Philippine mobile number"

DRIVER_RESTRICTIONS = {"A", "A1", "B", "B1", "B2", "C", "D", "BE", "CE"}

DRIVER_STATUSES = {choice for choice, _ in DriverStatus.choices}

DISCOUNT_NO = "NO_DISCOUNT"

DISCOUNT_OTHER = "OTHER"

DISCOUNT_ACTIVE = "ACTIVE"

DISCOUNT_CANCELLED = "CANCELLED"

DISCOUNT_REMOVED = "REMOVED"

DISCOUNT_PRESET_PERCENT: dict[str, float] = {
    DISCOUNT_NO: 0.0,
    "DISCOUNT_5": 5.0,
    "DISCOUNT_10": 10.0,
    "DISCOUNT_15": 15.0,
    "DISCOUNT_20": 20.0,
    "DISCOUNT_25": 25.0,
}

DISCOUNT_PRESET_LABEL: dict[str, str] = {
    DISCOUNT_NO: "No Discount",
    "DISCOUNT_5": "5% Discount - courtesy discount",
    "DISCOUNT_10": "10% Discount - regular customer discount",
    "DISCOUNT_15": "15% Discount - loyal customer discount",
    "DISCOUNT_20": "20% Discount - bulk order discount",
    "DISCOUNT_25": "25% Discount - maximum recommended discount",
    DISCOUNT_OTHER: "Other (Manual)",
}

COMPLETED_DELIVERY_FILTER = Q(
    trips__drop_points__status=DropPointStatus.COMPLETED,
    trips__drop_points__drop_point_type=DropPointType.DELIVERY,
)

PHILIPPINE_DRIVER_LICENSE_REGEX = re.compile(r"^[A-Z]\d{2}-\d{2}-\d{6}$")

NEGROS_OCCIDENTAL_BOUNDS = {
    # Fix: include the eastern portions of Silay and Talisay represented by the
    # municipal polygons used by the customer map.
    "min_lat": 10.64,
    "max_lat": 10.92,
    "min_lng": 122.88,
    "max_lng": 123.26,
}

DEFAULT_COUNTRY = "Philippines"

_ORDER_STATUS_ALIASES: dict[str, str] = {
    "PROCESSING": OrderStatus.PREPARING,
    "PACKED": OrderStatus.PREPARING,
    "DISPATCHED": OrderStatus.OUT_FOR_DELIVERY,
    "READY_FOR_PICKUP": OrderStatus.PREPARING,
    "IN_TRANSIT": OrderStatus.OUT_FOR_DELIVERY,
    "UNAPPROVED": OrderStatus.PENDING,
    "FAILED_DELIVERY": OrderStatus.CANCELLED,
    "REJECTED": OrderStatus.REJECTED,
    # The approved status used to be stored as CONFIRMED; older clients may still send it.
    "CONFIRMED": OrderStatus.APPROVED,
}

PERSON_NAME_NUMBER_ERROR = "Names cannot contain numbers."

_NOT_PROVIDED = object()

OTP_EXPIRY_MINUTES = 2

EMAIL_VERIFICATION_TOKEN_HOURS = 1

_PASSWORD_RESET_PORTAL_ROLES = {
    "admin": {RoleType.SUPER_ADMIN, RoleType.ADMIN},
    "warehouse": {RoleType.WAREHOUSE_STAFF},
    "driver": {RoleType.DRIVER},
}

_REPLACEMENT_CUSTOMER_COPY: dict[str, dict[str, str]] = {
    ReplacementStatus.UNDER_REVIEW: {
        "subject": "Replacement Request {number} is being reviewed",
        "heading": "Your replacement request is being reviewed",
        "statement": "Your Replacement Request No. {number} is now being reviewed by our team.",
        "next_step": "We will email you again once a decision has been made.",
    },
    ReplacementStatus.APPROVED: {
        "subject": "Replacement Request {number} approved",
        "heading": "Your replacement request has been approved",
        "statement": "Your Replacement Request No. {number} has been approved.",
        "next_step": "Our warehouse team will schedule the replacement delivery and keep you updated.",
    },
    ReplacementStatus.REJECTED: {
        "subject": "Replacement Request {number} was not approved",
        "heading": "Your replacement request was not approved",
        "statement": "Your Replacement Request No. {number} has been rejected.",
        "next_step": "Our team can help if you have questions about this decision.",
    },
    ReplacementStatus.IN_PROGRESS: {
        "subject": "Replacement Request {number} is being processed",
        "heading": "Your replacement is being processed",
        "statement": "Your Replacement Request No. {number} is now being processed.",
        "next_step": "We will let you know once the replacement is on the way.",
    },
    ReplacementStatus.NEEDS_FOLLOW_UP: {
        "subject": "Replacement Request {number} needs more information",
        "heading": "Your replacement request needs more information",
        "statement": "We need a little more information before we can continue with your Replacement Request No. {number}.",
        "next_step": "Our team will contact you shortly to complete the details.",
    },
    ReplacementStatus.RESOLVED_ON_DELIVERY: {
        "subject": "Replacement Request {number} completed",
        "heading": "Your replacement has been completed",
        "statement": "Your Replacement Request No. {number} has been completed on delivery.",
        "next_step": "No further action is needed on your side.",
    },
    ReplacementStatus.COMPLETED: {
        "subject": "Replacement Request {number} completed",
        "heading": "Your replacement has been completed",
        "statement": "Your Replacement Request No. {number} has been completed.",
        "next_step": "No further action is needed on your side.",
    },
}

STAFF_LOGIN_ROLE_SCOPE = {
    RoleType.SUPER_ADMIN,
    RoleType.ADMIN,
    RoleType.WAREHOUSE_STAFF,
    RoleType.DRIVER,
}

_PHYSICAL_STOCK_IN_TYPES = {"IN", "STOCK_IN", "RETURN"}

_PHYSICAL_STOCK_OUT_TYPES = {"OUT", "STOCK_OUT"}

RESOLVED_DROP_POINT_STATUSES = [
    DropPointStatus.COMPLETED,
    DropPointStatus.FAILED,
    # Fix: a cancelled delivery has no remaining work and must not block trip closure.
    "CANCELLED",
]
