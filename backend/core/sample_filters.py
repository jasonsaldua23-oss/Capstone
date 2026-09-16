"""Filters that hide seeded demo records from production-facing queries."""

from django.db.models import Q

from .api_constants import HIDDEN_SAMPLE_EMAIL_DOMAINS, HIDDEN_SAMPLE_WORDS


def _hide_sample_data() -> bool:
    # Local/dev and portal operations should include seeded/demo records by default.
    return False


def _sample_text_query(*fields: str) -> Q:
    query = Q()
    for field in fields:
        for word in HIDDEN_SAMPLE_WORDS:
            query |= Q(**{f"{field}__icontains": word})
    return query


def _sample_email_query(*fields: str) -> Q:
    query = Q()
    for field in fields:
        for domain in HIDDEN_SAMPLE_EMAIL_DOMAINS:
            query |= Q(**{f"{field}__iendswith": domain})
    return query


def _real_users(qs):
    if not _hide_sample_data():
        return qs
    return qs.exclude(
        _sample_text_query("name")
        | _sample_text_query("email")
        | _sample_email_query("email")
        | Q(email__in=["driver@logistics.com", "warehouse@logistics.com"])
    )


def _real_customers(qs):
    if not _hide_sample_data():
        return qs
    return qs.exclude(
        _sample_text_query("name", "email", "address", "city")
        | _sample_email_query("email")
        | Q(email="customer@example.com")
    )


def _real_products(qs):
    if not _hide_sample_data():
        return qs
    return qs.exclude(_sample_text_query("name", "sku"))


def _real_warehouses(qs):
    if not _hide_sample_data():
        return qs
    return qs.exclude(_sample_text_query("name", "code", "address", "city"))


def _real_vehicles(qs):
    if not _hide_sample_data():
        return qs
    return qs.exclude(_sample_text_query("license_plate"))


def _real_drivers(qs):
    if not _hide_sample_data():
        return qs
    return qs.exclude(_sample_text_query("license_number", "name", "email") | _sample_email_query("email"))


def _real_orders(qs):
    if not _hide_sample_data():
        return qs
    return qs.exclude(
        _sample_text_query(
            "order_number",
            "customer__name",
            "customer__email",
            "shipping_name",
            "shipping_address",
            "shipping_city",
        )
        | _sample_email_query("customer__email")
    )


def _real_trips(qs):
    if not _hide_sample_data():
        return qs
    return qs.exclude(
        _sample_text_query("trip_number", "notes", "driver__license_number", "driver__name", "driver__email")
        | _sample_email_query("driver__email")
        | _sample_text_query(
            "drop_points__order__order_number",
            "drop_points__order__customer__name",
            "drop_points__order__customer__email",
            "drop_points__order__shipping_name",
            "drop_points__order__shipping_address",
        )
        | _sample_email_query("drop_points__order__customer__email")
    ).distinct()
