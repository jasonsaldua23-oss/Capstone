from django.http import HttpResponse
from django.test import RequestFactory, TestCase

from .auth import STAFF_TOKEN_NAME, create_token
from .auth_response_middleware import StaffAuthFallbackNoStoreMiddleware
from .views_api import _require_staff
from .models import Customer, User


class StaffCookieAuthFallbackTests(TestCase):
    def setUp(self):
        # Session validation now checks live account state as well as JWT signatures.
        Customer.objects.create(id="customer-1", email="customer@audit.invalid", name="Customer")
        User.objects.create(id="staff-1", email="staff@audit.invalid", name="Staff", role="ADMIN")
        self.factory = RequestFactory()
        self.customer_token = create_token({"type": "customer", "userId": "customer-1"})
        self.staff_token = create_token({"type": "staff", "userId": "staff-1", "role": "ADMIN"})

    def test_valid_staff_cookie_recovers_from_stale_customer_bearer(self):
        request = self.factory.get(
            "/api/warehouses",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        request.COOKIES[STAFF_TOKEN_NAME] = self.staff_token

        payload, error = _require_staff(request)

        self.assertIsNone(error)
        self.assertEqual(payload["userId"], "staff-1")
        self.assertTrue(request._staff_cookie_auth_fallback)

    def test_customer_bearer_without_staff_cookie_remains_forbidden(self):
        request = self.factory.get(
            "/api/warehouses",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        payload, error = _require_staff(request)

        self.assertIsNone(payload)
        self.assertEqual(error.status_code, 403)

    def test_recovered_response_is_not_cacheable(self):
        request = self.factory.get("/api/warehouses")
        request._staff_cookie_auth_fallback = True
        middleware = StaffAuthFallbackNoStoreMiddleware(lambda _request: HttpResponse("ok"))

        response = middleware(request)

        self.assertEqual(response["Cache-Control"], "no-store")
