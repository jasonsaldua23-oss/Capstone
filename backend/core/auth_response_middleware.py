"""Response safeguards for API failures and authentication recovery paths."""

from django.http import HttpRequest, HttpResponse
from django.http import JsonResponse
from django.db import OperationalError, InterfaceError
from django.utils.deprecation import MiddlewareMixin
import logging
import uuid


class ApiErrorResponseMiddleware(MiddlewareMixin):
    """Keep unexpected API failures actionable without exposing internal details."""

    def process_exception(self, request, exception):
        if not request.path.startswith("/api/"):
            return None
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
