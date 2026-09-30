"""Declare and verify customer empties that predate the system's purchase history."""

import re
from decimal import Decimal

from django.db import transaction
from django.http import HttpRequest
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from . import views_api as legacy
from . import views_media as media
from .api_utils import error as _err, json_body as _json_body, ok as _ok
from .auth_guards import _require_auth, _require_staff
from .beverage_categories import category_spec
from .models import (
    Customer, CustomerBottleBalance, DepositTransaction, OpeningEmptiesDeclaration, Product, ProductPackaging, User, generate_cuid,
)

EVIDENCE_FOLDER = "opening-empties-evidence"
# One submission can declare several products; each becomes its own reviewable row.
MAX_DECLARATIONS_PER_SUBMISSION = 20


class _Refusal(Exception):
    """Aborts a whole submission; raised inside the transaction so nothing is kept."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message, self.status = message, status


def _primary_packagings(product_ids=None) -> dict[str, ProductPackaging]:
    """Each product's primary active packaging, chosen the way retail checkout chooses it."""
    rows = ProductPackaging.objects.select_related("container_type").filter(is_active=True)
    if product_ids is not None:
        rows = rows.filter(product_id__in=product_ids)
    primary: dict[str, ProductPackaging] = {}
    for packaging in rows.order_by("product_id", "-is_primary", "created_at", "id"):
        primary.setdefault(str(packaging.product_id), packaging)
    return primary


def _carries_deposit(product: Product, packaging: ProductPackaging | None) -> bool:
    # Same test as retail checkout's _deposit_configuration, plus a deposit actually set:
    # only a product a customer pays a container deposit on can have empties to declare.
    spec = category_spec(product.category)
    return bool(
        spec and spec["depositAllowed"]
        and packaging and packaging.is_returnable and packaging.container_type.is_returnable
        and (packaging.deposit_amount > 0 or packaging.case_deposit_amount > 0)
    )


def _product_label(product: Product) -> str:
    # Same "Name - size" label the empties balance uses, so three "Pepsi" rows are told apart.
    sizes = ", ".join(str(size).strip() for size in (product.sizes or []) if str(size).strip())
    return f"{product.name} - {sizes}" if sizes else str(product.name)


def _summary(rows) -> str:
    """'Panalo Cola - 12oz (30 cases), 7Up - 8oz (20 cases)', shortened past three products."""
    def quantity(row):
        parts = [f"{row.cases} case{'s' if row.cases != 1 else ''}" if row.cases else "",
                 f"{row.bottles} bottle{'s' if row.bottles != 1 else ''}" if row.bottles else ""]
        return " + ".join(part for part in parts if part)
    lines = [f"{_product_label(row.product)} ({quantity(row)})" for row in rows]
    return ", ".join(lines[:3]) + (f", and {len(lines) - 3} more" if len(lines) > 3 else "")


# Notification helpers resolve through views_api so tests that patch them there still apply.
def _notify_staff_of_declaration(customer, rows) -> None:
    legacy._create_staff_notifications(
        title="Existing empties declared",
        message=f"{customer.name} declared existing empties for review: {_summary(rows)}.",
        notification_type="EMPTIES",
        reference_type="opening_empties",
        reference_id=rows[0].submission_id or rows[0].id,
    )


def _notify_customer_of_review(rows, decision: str, notes: str) -> None:
    approved = decision == "APPROVED"
    # The reason is followed by another sentence, so it needs its own full stop.
    notes = notes if notes.endswith((".", "!", "?")) else f"{notes}."
    legacy._create_customer_notification(
        customer=rows[0].customer,
        title="Existing empties approved" if approved else "Existing empties declaration rejected",
        message=(
            f"Your declared empties were approved: {_summary(rows)}. They are now available for exchange when you order these products."
            if approved else
            f"Your declared empties were not approved: {_summary(rows)}. Reason: {notes} You can declare them again with the correct details."
        ),
        notification_type="EMPTIES",
        reference_type="opening_empties",
        reference_id=rows[0].submission_id or rows[0].id,
    )


def _evidence_prefix(customer_id: str) -> str:
    return f"opening-empties-{customer_id}"


def _is_own_evidence_url(url: str, customer_id: str) -> bool:
    # The customer id is in the file name, so a declaration can only attach a photo
    # this customer uploaded. Attaching someone else's URL would grant read access to it.
    pattern = rf"/api/media/{EVIDENCE_FOLDER}/{re.escape(_evidence_prefix(customer_id))}-[0-9a-f]{{32}}\.[a-z0-9]{{1,5}}"
    return bool(re.fullmatch(pattern, url))


def _active_customer(request: HttpRequest):
    payload = _require_auth(request)
    if not payload or payload.get("type") != "customer":
        return None, _err("Unauthorized", 401)
    customer = Customer.objects.filter(id=payload.get("userId"), is_active=True).first()
    if customer is None:
        return None, _err("Customer not found", 404)
    return customer, None


def _serialize(declaration):
    return {
        "id": declaration.id,
        "submissionId": declaration.submission_id or declaration.id,
        "customerId": declaration.customer_id,
        "customerName": declaration.customer.name,
        "productId": declaration.product_id,
        "productName": declaration.product.name,
        "productLabel": _product_label(declaration.product),
        "cases": declaration.cases,
        "bottles": declaration.bottles,
        "containersPerCase": declaration.containers_per_case,
        "status": declaration.status,
        "notes": declaration.notes,
        "evidencePhotoUrl": declaration.evidence_photo_url or None,
        "reviewNotes": declaration.review_notes,
        "reviewedBy": declaration.reviewed_by.name if declaration.reviewed_by else None,
        "reviewedAt": declaration.reviewed_at.isoformat() if declaration.reviewed_at else None,
        "createdAt": declaration.created_at.isoformat(),
    }


def _declarations():
    return OpeningEmptiesDeclaration.objects.select_related("customer", "product", "reviewed_by").order_by("-created_at")


def _reviewer(request):
    payload, error = _require_staff(request)
    if error is not None:
        return None, error
    # Added: verify the current database role, not just a role claimed by an old token.
    reviewer = User.objects.filter(id=payload.get("userId"), is_active=True, role__in=["ADMIN", "WAREHOUSE_STAFF"]).first()
    return (reviewer, None) if reviewer else (None, _err("Only admin or warehouse staff can review existing empties", 403))


@csrf_exempt
@require_http_methods(["POST"])
def customer_opening_empties_evidence(request: HttpRequest):
    """Store the one photo a declaration carries; the declaration then references its URL."""
    customer, error = _active_customer(request)
    if error is not None:
        return error
    return media._handle_image_upload(request, EVIDENCE_FOLDER, _evidence_prefix(customer.id))


@csrf_exempt
@require_http_methods(["GET", "POST"])
def customer_opening_empties(request: HttpRequest):
    customer, error = _active_customer(request)
    if error is not None:
        return error

    if request.method == "GET":
        # Read-only: every active product that carries a container deposit, with its size.
        packagings = _primary_packagings()
        products = []
        for product in Product.objects.filter(is_active=True, id__in=list(packagings)):
            packaging = packagings[str(product.id)]
            if not _carries_deposit(product, packaging):
                continue
            products.append({
                "productId": product.id,
                "productName": product.name,
                "productLabel": _product_label(product),
                "unit": product.unit,
                "containersPerCase": max(1, packaging.containers_per_case),
            })
        products.sort(key=lambda row: (row["productLabel"].casefold(), row["productId"]))
        return _ok({"success": True, "products": products, "declarations": [_serialize(row) for row in _declarations().filter(customer=customer)]})

    body = _json_body(request)
    if not isinstance(body, dict):
        return _err("A declaration object is required", 400)
    # {"items": [...]} declares several products at once; a bare object is a single item.
    raw_items = body.get("items") if "items" in body else [body]
    if not isinstance(raw_items, list) or not 1 <= len(raw_items) <= MAX_DECLARATIONS_PER_SUBMISSION:
        return _err(f"Declare between 1 and {MAX_DECLARATIONS_PER_SUBMISSION} products at a time", 400)

    items = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            return _err("Each product needs its own declaration object", 400)
        request_id = str(raw.get("requestId") or "").strip()
        notes = raw.get("notes", "")
        evidence_photo_url = raw.get("evidencePhotoUrl")
        cases, bottles = raw.get("cases", 0), raw.get("bottles", 0)
        if not request_id or len(request_id) > 120:
            return _err("A requestId of 1 to 120 characters is required", 400)
        if not isinstance(notes, str) or len(notes) > 1000:
            return _err("Notes must be 1000 characters or fewer", 400)
        if any(type(value) is not int or value < 0 or value > 2147483647 for value in (cases, bottles)) or cases + bottles == 0:
            return _err("Enter a positive quantity using whole, non-negative cases and bottles", 400)
        if not isinstance(evidence_photo_url, str) or not _is_own_evidence_url(evidence_photo_url, customer.id):
            return _err("Add one photo of these empties so staff can verify them", 400)
        items.append({
            "requestId": request_id, "productId": str(raw.get("productId") or "").strip(),
            "cases": cases, "bottles": bottles, "notes": notes.strip(), "evidencePhotoUrl": evidence_photo_url,
        })
    for field, message in [
        ("requestId", "Each product needs its own requestId"),
        ("productId", "Each product can be declared only once per submission"),
        ("evidencePhotoUrl", "Use a separate photo for each product"),
    ]:
        if len({item[field] for item in items}) != len(items):
            return _err(message, 400)

    try:
        with transaction.atomic():
            # Serialize submissions for one customer, including retries with different request IDs.
            Customer.objects.select_for_update().get(id=customer.id)
            products = Product.objects.in_bulk([item["productId"] for item in items])
            packagings = _primary_packagings(list(products))
            previous_rows = {row.request_id: row for row in _declarations().filter(
                customer=customer, request_id__in=[item["requestId"] for item in items],
            )}
            # A retry joins the submission its earlier products were saved under.
            submission_id = next((row.submission_id for row in previous_rows.values() if row.submission_id), "") or generate_cuid()
            results, created_rows = [], []
            for item in items:
                previous = previous_rows.get(item["requestId"])
                if previous is not None:
                    if (previous.product_id, previous.cases, previous.bottles, previous.notes, previous.evidence_photo_url) != (
                        item["productId"], item["cases"], item["bottles"], item["notes"], item["evidencePhotoUrl"],
                    ):
                        raise _Refusal("This requestId was already used for another declaration", 409)
                    results.append(previous)
                    continue
                # One photo per product: a picture already attached elsewhere cannot vouch for this one too.
                if OpeningEmptiesDeclaration.objects.filter(customer=customer, evidence_photo_url=item["evidencePhotoUrl"]).exists():
                    raise _Refusal("Use a separate photo for each product")
                product = products.get(item["productId"])
                packaging = packagings.get(item["productId"])
                if product is None or not product.is_active or not _carries_deposit(product, packaging):
                    raise _Refusal("Select an active product that carries a container deposit")
                label = _product_label(product)
                capacity = max(1, packaging.containers_per_case)
                cases, bottles = item["cases"], item["bottles"]
                is_case = str(product.unit or "").strip().lower() == "case"
                if (is_case and bottles >= capacity) or (not is_case and cases):
                    raise _Refusal(f"{label}: use full cases and fewer loose bottles than one case, or bottles only for a bottle product")
                if cases * capacity + bottles > 2147483647:
                    raise _Refusal(f"{label}: the declared quantity is too large")
                if OpeningEmptiesDeclaration.objects.filter(customer=customer, product=product, status__in=["PENDING", "APPROVED"]).exists():
                    raise _Refusal(f"{label} already has existing empties pending or approved", 409)
                declaration = OpeningEmptiesDeclaration.objects.create(
                    request_id=item["requestId"], submission_id=submission_id,
                    customer=customer, product=product, container_type=packaging.container_type,
                    cases=cases, bottles=bottles, containers_per_case=capacity, notes=item["notes"],
                    evidence_photo_url=item["evidencePhotoUrl"],
                )
                results.append(declaration)
                created_rows.append(declaration)
    except _Refusal as refusal:
        return _err(refusal.message, refusal.status)
    # Staff hear about new declarations only; a retried submission adds nothing to review.
    if created_rows:
        _notify_staff_of_declaration(customer, created_rows)
    serialized = [_serialize(row) for row in results]
    return _ok({"success": True, "declarations": serialized, "declaration": serialized[0]}, status=201 if created_rows else 200)


@require_GET
def staff_opening_empties(request: HttpRequest):
    _, error = _reviewer(request)
    if error is not None:
        return error
    declarations = _declarations()
    if request.GET.get("customerId"):
        declarations = declarations.filter(customer_id=request.GET["customerId"])
    return _ok({"success": True, "declarations": [_serialize(row) for row in declarations]})


def _review_body(request: HttpRequest):
    """The reviewer plus a validated decision, or an error response."""
    reviewer, error = _reviewer(request)
    if error is not None:
        return None, None, None, error
    body = _json_body(request)
    if not isinstance(body, dict):
        return None, None, None, _err("A review object is required", 400)
    decision, notes = body.get("decision"), body.get("reviewNotes", "")
    if decision not in ["APPROVED", "REJECTED"]:
        return None, None, None, _err("Choose APPROVED or REJECTED", 400)
    if not isinstance(notes, str) or len(notes) > 1000:
        return None, None, None, _err("Review notes must be 1000 characters or fewer", 400)
    if decision == "REJECTED" and not notes.strip():
        return None, None, None, _err("Explain why the declaration was rejected", 400)
    return reviewer, decision, notes.strip(), None


def _approve_stock(declaration, reviewer, label_errors: bool):
    """Add one approved product's empties to the customer's exchange balance."""
    def refuse(message: str, status: int = 400):
        # In a multi-product declaration, name the product that blocked the approval.
        raise _Refusal(f"{_product_label(declaration.product)}: {message}" if label_errors else message[0].upper() + message[1:], status)

    packaging = _primary_packagings([declaration.product_id]).get(str(declaration.product_id))
    if not declaration.customer.is_active or not declaration.product.is_active or not _carries_deposit(declaration.product, packaging):
        refuse("the customer must be active and the product must still carry a container deposit")
    container = packaging.container_type
    if container.id != declaration.container_type_id or max(1, packaging.containers_per_case) != declaration.containers_per_case:
        refuse("product packaging changed; reject this declaration and request a new one", 409)
    quantity = declaration.cases * declaration.containers_per_case + declaration.bottles
    balance, _ = CustomerBottleBalance.objects.select_for_update().get_or_create(
        customer=declaration.customer, container_type=container,
    )
    if balance.bottles_outstanding + quantity > 2147483647:
        refuse("the resulting empty-container balance is too large")
    balance.bottles_outstanding += quantity
    balance.save(update_fields=["bottles_outstanding", "updated_at"])
    declaration.remaining_bottles = quantity
    # Approval records physical exchange stock; it never invents a historical deposit payment.
    DepositTransaction.objects.create(
        customer=declaration.customer, type=DepositTransaction.TransactionType.ADJUSTMENT,
        amount=Decimal("0.00"), balance_before=balance.deposit_balance, balance_after=balance.deposit_balance,
        container_type=container, container_count=quantity, reference_type="opening_product",
        reference_id=declaration.product_id, reason=f"Approved existing empties for {declaration.product.name}",
        performed_by=reviewer.id,
    )


def _review(rows, reviewer, decision: str, notes: str) -> list:
    """Review every product of one declaration together; any refusal leaves all of them pending.

    Returns the rows this call decided, empty for a retry of a decision already recorded.
    """
    pending = [row for row in rows if row.status == "PENDING"]
    if not pending:
        if all(row.status == decision for row in rows):
            return []  # A retried request: the same decision is already recorded.
        raise _Refusal("This declaration has already been reviewed", 409)
    reviewed_at = timezone.now()
    for row in pending:
        if decision == "APPROVED":
            _approve_stock(row, reviewer, label_errors=len(rows) > 1)
        row.status = decision
        row.review_notes = notes
        row.reviewed_by = reviewer
        row.reviewed_at = reviewed_at
        row.save(update_fields=["status", "review_notes", "reviewed_by", "reviewed_at", "remaining_bottles"])
    return pending


@csrf_exempt
@require_http_methods(["POST"])
def review_opening_empties(request: HttpRequest, declaration_id: str):
    reviewer, decision, notes, error = _review_body(request)
    if error is not None:
        return error
    try:
        with transaction.atomic():
            # Lock only this table: the nullable reviewer join cannot be locked in PostgreSQL.
            declaration = OpeningEmptiesDeclaration.objects.select_for_update().filter(id=declaration_id).first()
            if declaration is None:
                return _err("Declaration not found", 404)
            decided = _review([declaration], reviewer, decision, notes)
    except _Refusal as refusal:
        return _err(refusal.message, refusal.status)
    if decided:
        _notify_customer_of_review(decided, decision, notes)
    return _ok({"success": True, "declaration": _serialize(declaration)})


@csrf_exempt
@require_http_methods(["POST"])
def review_opening_empties_submission(request: HttpRequest, submission_id: str):
    """Approve or reject every product a customer declared in one submission."""
    reviewer, decision, notes, error = _review_body(request)
    if error is not None:
        return error
    try:
        with transaction.atomic():
            rows = list(OpeningEmptiesDeclaration.objects.select_for_update().filter(submission_id=submission_id).order_by("created_at", "id"))
            if not rows:
                return _err("Declaration not found", 404)
            decided = _review(rows, reviewer, decision, notes)
    except _Refusal as refusal:
        return _err(refusal.message, refusal.status)
    # One notification per declaration, however many products it covers.
    if decided:
        _notify_customer_of_review(decided, decision, notes)
    return _ok({"success": True, "declarations": [_serialize(row) for row in rows]})
