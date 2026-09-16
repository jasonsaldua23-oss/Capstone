"""Negros Occidental service-area geography and distance helpers."""

import math
from typing import Any

from .api_constants import NEGROS_OCCIDENTAL_BOUNDS
from .api_utils import to_float_or_none as _to_float_or_none


def _is_within_negros_occidental(lat: float, lng: float) -> bool:
    return (
        NEGROS_OCCIDENTAL_BOUNDS["min_lat"] <= lat <= NEGROS_OCCIDENTAL_BOUNDS["max_lat"]
        and NEGROS_OCCIDENTAL_BOUNDS["min_lng"] <= lng <= NEGROS_OCCIDENTAL_BOUNDS["max_lng"]
    )


def _normalize_province(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = text.replace(".", " ").replace("-", " ")
    text = " ".join(text.split())
    return text


def _normalize_city(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = text.replace(".", " ").replace("-", " ")
    text = " ".join(text.split())
    return text


def _strip_default_country_suffix(address: Any) -> str:
    text = str(address or "").strip()
    if not text:
        return ""
    tokens = [token.strip() for token in text.split(",") if token.strip()]
    if not tokens:
        return text
    country_tokens = {"philippines", "republic of the philippines"}
    while tokens and tokens[-1].lower() in country_tokens:
        tokens.pop()
    return ", ".join(tokens) if tokens else ""


def _ensure_negros_occidental_address(
    *,
    latitude: Any,
    longitude: Any,
    city: Any = None,
    province: Any,
    require_coordinates: bool = False,
) -> str | None:
    lat = _to_float_or_none(latitude)
    lng = _to_float_or_none(longitude)
    normalized_province = _normalize_province(province)
    normalized_city = _normalize_city(city)
    allowed_cities = {"silay", "silay city", "talisay", "talisay city"}

    if lat is None or lng is None:
        if require_coordinates:
            return "Pinned location is required and must be within Silay or Talisay, Negros Occidental, Philippines"
        if normalized_city and normalized_city not in allowed_cities:
            return "Address city must be Silay or Talisay"
        if normalized_province and normalized_province != "negros occidental":
            return "Address province must be Negros Occidental"
        return None

    if not _is_within_negros_occidental(lat, lng):
        return "Pinned location must be within Silay or Talisay, Negros Occidental, Philippines"
    if normalized_city and normalized_city not in allowed_cities:
        return "Address city must be Silay or Talisay"
    if normalized_province and normalized_province != "negros occidental":
        return "Address province must be Negros Occidental"
    return None


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_km = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return radius_km * c


def _compute_order_distances(
    orders: list[dict[str, Any]],
    start_latitude: float | None = None,
    start_longitude: float | None = None,
) -> tuple[list[dict[str, Any]], float]:
    previous_lat = _to_float_or_none(start_latitude)
    previous_lng = _to_float_or_none(start_longitude)
    total_distance_km = 0.0
    enriched_orders: list[dict[str, Any]] = []

    for raw_order in orders:
        order_row = dict(raw_order or {})
        order_lat = _to_float_or_none(order_row.get("latitude") or order_row.get("shippingLatitude"))
        order_lng = _to_float_or_none(order_row.get("longitude") or order_row.get("shippingLongitude"))

        if order_lat is None or order_lng is None:
            order_row["distanceKm"] = None
            enriched_orders.append(order_row)
            continue

        if previous_lat is not None and previous_lng is not None:
            segment_distance_km = _haversine_km(previous_lat, previous_lng, order_lat, order_lng)
            order_row["distanceKm"] = round(segment_distance_km, 2)
            total_distance_km += segment_distance_km
        else:
            order_row["distanceKm"] = 0.0

        previous_lat = order_lat
        previous_lng = order_lng
        enriched_orders.append(order_row)

    return enriched_orders, round(total_distance_km, 2)
