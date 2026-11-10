"""Customer feedback API endpoints."""

from typing import Any

from django.db import transaction
from django.db.models import Q
from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from . import views_api as legacy
from .api_utils import error as _err, json_body as _json_body, ok as _ok
from .models import Customer, Feedback, Order


# Reuse established filtering and serialization contracts during the controller split.
def _require_auth(request: HttpRequest) -> dict[str, Any] | None:
    return legacy._require_auth(request)


def _pagination(request: HttpRequest) -> tuple[int, int, int]:
    return legacy._pagination(request)


def _real_customers(queryset):
    return legacy._real_customers(queryset)


def _real_orders(queryset):
    return legacy._real_orders(queryset)


def _serialize_model(instance, include=None, exclude=None):
    return legacy._serialize_model(instance, include=include, exclude=exclude)


@csrf_exempt
@require_http_methods(["GET", "POST"])
def feedback_collection(request: HttpRequest) -> JsonResponse:
    p = _require_auth(request)
    if not p:
        return _err("Unauthorized", 401)
    if request.method == "GET":
        page, size, off = _pagination(request)
        qs = (
            Feedback.objects.select_related("customer", "order")
            .filter(customer__in=_real_customers(Customer.objects.all()))
            .filter(Q(order__isnull=True) | Q(order__in=_real_orders(Order.objects.all())))
            .order_by("-created_at")
        )
        if p.get("type") == "customer":
            requester_id = str(p.get("userId") or "").strip()
            customer_scope_q = Q(customer_id=requester_id)
            qs = qs.filter(customer_scope_q)
        total = qs.count()
        rows = list(qs[off : off + size])
        data = [
            _serialize_model(
                x,
                include={
                    "customer": lambda o: _serialize_model(o.customer, exclude={"password"}),
                    "order": lambda o: _serialize_model(o.order) if o.order else None,
                },
            )
            for x in rows
        ]
        for row in data:
            order_obj = row.get("order")
            if isinstance(order_obj, dict):
                row["orderNumber"] = order_obj.get("orderNumber") or order_obj.get("order_number")
        return _ok({
            "success": True,
            "feedback": data,
            "feedbacks": data,
            "total": total,
            "page": page,
            "pageSize": size,
            "totalPages": (total + size - 1) // size,
        })
    if request.method == "POST":
        body = _json_body(request)
        if not isinstance(body, dict):
            return _err("A feedback object is required", 400)
        customer_ref = str(p.get("userId") or "").strip() if p.get("type") == "customer" else str(body.get("customerId") or "").strip()
        if not customer_ref:
            return _err("customerId is required")
        customer = (
            Customer.objects.filter(id=customer_ref).first()
        )
        if not customer:
            return _err("Customer not found", 404)
        order = None
        if body.get("orderId"):
            order = Order.objects.filter(id=str(body["orderId"])).first()
        if p.get("type") == "customer" and order and str(order.customer_id or "") != str(customer.id):
            return _err("Forbidden", 403)
        entries, error = _rating_entries(body)
        if error is not None:
            return error
        with transaction.atomic():
            # Serialize one customer's submissions so a double tap cannot rate a target twice.
            Customer.objects.select_for_update().filter(id=customer.id).first()
            if order and Feedback.objects.filter(
                order_id=order.id, customer_id=customer.id, rating_target__in=[entry["target"] for entry in entries],
            ).exists():
                return _err("Feedback already submitted for this order", 409)
            created = [
                Feedback.objects.create(
                    customer=customer,
                    order=order,
                    type=entry["type"],
                    subject=entry["subject"],
                    message=entry["message"],
                    rating=entry["rating"],
                    rating_target=entry["target"],
                )
                for entry in entries
            ]
        serialized = [_serialize_model(row) for row in created]
        return _ok({"success": True, "feedback": serialized[0], "feedbackItems": serialized}, 201)


def _rating_entries(body: dict[str, Any]) -> tuple[list[dict[str, Any]], JsonResponse | None]:
    """The ratings in one submission: `ratings` (products and service), or one bare rating.

    A bare rating is what clients sent before the split, and still what the mobile app
    sends; it rated the delivery, so with no target it is SERVICE.
    """
    raw = body.get("ratings")
    if raw is None:
        raw = [body]
    elif not isinstance(raw, list) or not 1 <= len(raw) <= len(Feedback.RatingTarget.values):
        return [], _err("Send at most one rating for the products and one for the service", 400)
    entries = []
    for item in raw:
        if not isinstance(item, dict):
            return [], _err("Each rating must be an object", 400)
        target = str(item.get("ratingTarget") or Feedback.RatingTarget.SERVICE).strip().upper()
        if target not in Feedback.RatingTarget.values:
            return [], _err("ratingTarget must be PRODUCT or SERVICE", 400)
        message = str(item.get("message") or "").strip()
        # Added: rated reviews must include feedback, even when the API is called directly.
        if not message:
            return [], _err("Feedback is required when submitting a rating" if item.get("rating") is not None else "Feedback is required", 400)
        rating = item.get("rating")
        if rating is not None and (isinstance(rating, bool) or not isinstance(rating, int) or not 1 <= rating <= 5):
            return [], _err("Rating must be an integer from 1 to 5", 400)
        entries.append({
            "target": target,
            "message": message,
            "rating": rating,
            "type": item.get("type") or "SUGGESTION",
            "subject": str(item.get("subject") or "General Feedback"),
        })
    if len({entry["target"] for entry in entries}) != len(entries):
        return [], _err("Rate the products and the service once each", 400)
    return entries, None

