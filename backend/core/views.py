import json
from datetime import datetime, timedelta, timezone

from django.db import transaction
from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from .auth import TOKEN_NAME, create_token, decode_token, extract_token, hash_password, verify_password
from .models import Customer, User


def _json_body(request: HttpRequest) -> dict:
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return {}


def _response(data: dict, status: int = 200) -> JsonResponse:
    return JsonResponse(data, status=status)


def _set_auth_cookie(response: JsonResponse, token: str) -> None:
    response.set_cookie(
        TOKEN_NAME,
        token,
        httponly=True,
        secure=False,
        samesite="Lax",
        max_age=24 * 60 * 60,
        path="/",
    )


@require_GET
def health(_request: HttpRequest) -> JsonResponse:
    return _response({"success": True, "service": "django-backend", "status": "ok"})


@csrf_exempt
@require_http_methods(["POST"])
def staff_login(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    email = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", ""))
    if not email or not password:
        return _response({"success": False, "error": "Email and password are required"}, status=400)

    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        return _response({"success": False, "error": "Invalid email or password"}, status=401)

    if not user.is_active or not verify_password(password, user.password):
        return _response({"success": False, "error": "Invalid email or password"}, status=401)

    user.last_login_at = datetime.now(timezone.utc)
    user.save(update_fields=["last_login_at", "updated_at"])

    payload = {
        "userId": user.id,
        "email": user.email,
        "name": user.name,
        "avatar": user.avatar,
        "role": user.role,
        "type": "staff",
    }
    token = create_token(payload)
    response = _response({"success": True, "user": payload, "token": token, "message": "Login successful"})
    _set_auth_cookie(response, token)
    return response


@csrf_exempt
@require_http_methods(["POST"])
def customer_login(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    email = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", ""))
    if not email or not password:
        return _response({"success": False, "error": "Email and password are required"}, status=400)

    try:
        customer = Customer.objects.get(email=email)
    except Customer.DoesNotExist:
        return _response({"success": False, "error": "Invalid email or password"}, status=401)

    if not customer.is_active or not verify_password(password, customer.password):
        return _response({"success": False, "error": "Invalid email or password"}, status=401)

    payload = {
        "userId": customer.id,
        "email": customer.email,
        "name": customer.name,
        "avatar": customer.avatar,
        "role": "CUSTOMER",
        "type": "customer",
    }
    token = create_token(payload)
    response = _response({"success": True, "user": payload, "token": token, "message": "Login successful"})
    _set_auth_cookie(response, token)
    return response


@csrf_exempt
@require_http_methods(["POST"])
def customer_register(request: HttpRequest) -> JsonResponse:
    body = _json_body(request)
    email = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", ""))
    name = str(body.get("name", "")).strip()

    if not email or not password or not name:
        return _response({"success": False, "error": "Name, email and password are required"}, status=400)

    if Customer.objects.filter(email=email).exists():
        return _response({"success": False, "error": "Email is already registered"}, status=409)

    customer = Customer.objects.create(
        email=email,
        password=hash_password(password),
        name=name,
        phone=str(body.get("phone", "")).strip() or None,
        address=str(body.get("address", "")).strip() or None,
        city=str(body.get("city", "")).strip() or None,
        province=str(body.get("province", "")).strip() or None,
        zip_code=str(body.get("zipCode", "")).strip() or None,
    )

    payload = {
        "userId": customer.id,
        "email": customer.email,
        "name": customer.name,
        "avatar": customer.avatar,
        "role": "CUSTOMER",
        "type": "customer",
    }
    token = create_token(payload)
    response = _response({"success": True, "user": payload, "token": token, "message": "Registration successful"}, status=201)
    _set_auth_cookie(response, token)
    return response


@require_GET
def auth_me(request: HttpRequest) -> JsonResponse:
    token = extract_token(request)
    if not token:
        return _response({"success": False, "error": "Unauthorized"}, status=401)

    payload = decode_token(token)
    if not payload:
        return _response({"success": False, "error": "Unauthorized"}, status=401)

    return _response({"success": True, "user": payload})


@csrf_exempt
@require_http_methods(["POST"])
def auth_logout(_request: HttpRequest) -> JsonResponse:
    response = _response({"success": True, "message": "Logout successful"})
    response.delete_cookie(TOKEN_NAME, path="/")
    return response


@transaction.atomic
def ensure_demo_accounts() -> None:
    User.objects.get_or_create(
        email="admin@logistics.com",
        defaults={
            "name": "Admin User",
            "password": hash_password("admin123"),
            "phone": "+1-555-0100",
            "role": "SUPER_ADMIN",
            "is_active": True,
        },
    )
    User.objects.get_or_create(
        email="driver@logistics.com",
        defaults={
            "name": "Demo Driver",
            "password": hash_password("driver123"),
            "phone": "+1-555-0103",
            "role": "DRIVER",
            "is_active": True,
        },
    )
    User.objects.get_or_create(
        email="warehouse@logistics.com",
        defaults={
            "name": "Warehouse Staff",
            "password": hash_password("admin123"),
            "phone": "+1-555-0102",
            "role": "WAREHOUSE_STAFF",
            "is_active": True,
        },
    )
    Customer.objects.get_or_create(
        email="customer@example.com",
        defaults={
            "name": "Demo Customer",
            "password": hash_password("customer123"),
            "phone": "+1-555-0104",
            "is_active": True,
        },
    )
