"""Response safeguards for API failures and authentication recovery paths."""

from django.http import HttpRequest, HttpResponse
from django.http import JsonResponse
from django.db import OperationalError, InterfaceError, IntegrityError
from django.utils.deprecation import MiddlewareMixin
import logging
import uuid
import json
from urllib.parse import urlsplit
from django.conf import settings


class ApiInputSecurityMiddleware:
    """Validate JSON shape and the source of browser requests before any mutation."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith("/api/") and request.method not in {"GET", "HEAD", "OPTIONS"}:
            if request.content_type == "application/json" and request.body:
                try:
                    body = json.loads(request.body)
                except (ValueError, UnicodeDecodeError):
                    return JsonResponse({"success": False, "error": "Invalid JSON body"}, status=400)
                if not isinstance(body, dict):
                    return JsonResponse({"success": False, "error": "JSON body must be an object"}, status=400)
            # Bearer-only native clients have no ambient cookies. Browser origins
            # are checked even with a Bearer header to protect cookie fallback.
            origin = request.headers.get("Origin")
            has_cookie = any(name.startswith("auth_token") for name in request.COOKIES)
            bearer_only = request.headers.get("Authorization", "").lower().startswith("bearer ") and not has_cookie
            if (origin or has_cookie) and not bearer_only:
                source = origin or request.headers.get("Referer", "")
                parsed = urlsplit(source)
                source_origin = f"{parsed.scheme}://{parsed.netloc}"
                allowed = set(settings.CORS_ALLOWED_ORIGINS) | {f"{request.scheme}://{request.get_host()}"}
                if source_origin not in allowed:
                    return JsonResponse({"success": False, "error": "Untrusted request origin"}, status=403)
        return self.get_response(request)


class ApiErrorResponseMiddleware(MiddlewareMixin):
    """Keep unexpected API failures actionable without exposing internal details."""

    def process_exception(self, request, exception):
        if not request.path.startswith("/api/"):
            return None
        # Fix: concurrent account creation can pass the preliminary lookup; the
        # database uniqueness constraint is authoritative and returns a conflict.
        if isinstance(exception, IntegrityError) and "unique_staff_email_normalized" in str(exception):
            return JsonResponse({"success": False, "error": "This email address is already registered."}, status=409)
        # Fix: correlate the user's failure with a traceback, without logging request bodies/tokens.
        reference = uuid.uuid4().hex
        logging.getLogger(__name__).error(
            "API failure reference=%s method=%s path=%s",
            reference, request.method, request.path,
            exc_info=(type(exception), exception, exception.__traceback__),
        )
        status = 503 if isinstance(exception, (OperationalError, InterfaceError)) else 500
        response = JsonResponse({
            "success": False,
            "error": (
                "The server could not confirm this request. "
                "Check the latest record before submitting again. "
                f"Support reference: {reference}"
            ),
            "requestId": reference,
        }, status=status)
        response["Cache-Control"] = "no-store"
        response["X-Request-ID"] = reference
        return response


class StaffAuthFallbackNoStoreMiddleware:
    """Prevent a staff-cookie recovery response from using the stale Bearer cache key."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        response = self.get_response(request)
        if getattr(request, "_staff_cookie_auth_fallback", False):
            # Fix: recovered staff data must not be cached under a customer Bearer token.
            response["Cache-Control"] = "no-store"
        return response
