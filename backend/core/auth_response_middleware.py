"""Response safeguards for authentication recovery paths."""

from django.http import HttpRequest, HttpResponse


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
