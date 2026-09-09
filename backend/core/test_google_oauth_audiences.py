"""Google login accepts only the explicitly configured OAuth client audiences."""

import base64
import json
from datetime import timedelta
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from .views_api import _verify_google_token, auth_customer_google
from .models import Customer


def _unsigned_test_credential(audience: str) -> str:
    payload = {
        "aud": audience,
        "iss": "https://accounts.google.com",
        "exp": int((timezone.now() + timedelta(minutes=5)).timestamp()),
    }
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    return f"header.{encoded}.signature"


@override_settings(
    DEBUG=True,
    GOOGLE_OAUTH_SKIP_SSL_VERIFY=True,
    GOOGLE_OAUTH_CLIENT_ID="gmail-client.apps.googleusercontent.com",
    GOOGLE_OAUTH_CLIENT_IDS=[
        "gmail-client.apps.googleusercontent.com",
        "production-web.apps.googleusercontent.com",
    ],
)
class GoogleOAuthAudienceTests(SimpleTestCase):
    def test_additional_production_web_client_is_accepted(self):
        claims = _verify_google_token(_unsigned_test_credential("production-web.apps.googleusercontent.com"))
        self.assertEqual(claims["aud"], "production-web.apps.googleusercontent.com")

    def test_unconfigured_client_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "audience mismatch"):
            _verify_google_token(_unsigned_test_credential("untrusted.apps.googleusercontent.com"))

    @override_settings(GOOGLE_OAUTH_CLIENT_ID="", GOOGLE_OAUTH_CLIENT_IDS=["web-client"])
    def test_customer_endpoint_uses_the_configured_audience_list(self):
        # Fix regression: list-only configuration must reach verification, not fail the primary-ID guard.
        request = RequestFactory().post("/api/auth/customer/google", {"credential": "test"}, content_type="application/json")
        with patch("core.views_api._verify_google_token", side_effect=ValueError("invalid test token")) as verify:
            response = auth_customer_google(request)
        verify.assert_called_once_with("test")
        self.assertEqual(response.status_code, 401)

    @override_settings(GOOGLE_OAUTH_CLIENT_ID="", GOOGLE_OAUTH_CLIENT_IDS=[])
    def test_customer_endpoint_still_rejects_missing_configuration(self):
        request = RequestFactory().post("/api/auth/customer/google", {"credential": "test"}, content_type="application/json")
        response = auth_customer_google(request)
        self.assertEqual(response.status_code, 500)


@override_settings(GOOGLE_OAUTH_CLIENT_ID="", GOOGLE_OAUTH_CLIENT_IDS=["web-client"])
class CustomerGoogleSessionTests(TestCase):
    # Mock only Google's external verification; exercise real customer creation and session issuance.
    claims = {"email": "google-session@example.com", "email_verified": True,
              "given_name": "Google", "family_name": "Customer", "name": "Google Customer"}

    def sign_in(self):
        with patch("core.views_api._verify_google_token", return_value=self.claims):
            return self.client.post("/api/auth/customer/google", {"credential": "verified-by-mock", "rememberMe": True},
                                    content_type="application/json")

    def test_new_customer_receives_working_cookie_and_bearer_sessions(self):
        response = self.sign_in()
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(response.json()["created"])
        token = response.json()["token"]
        session = self.client.get("/api/auth/me")
        self.assertEqual(session.status_code, 200, session.content)
        self.assertEqual(session.json()["user"]["email"], self.claims["email"])
        self.client.cookies.clear()
        session = self.client.get("/api/auth/me", HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(session.status_code, 200, session.content)

    def test_repeat_sign_in_reuses_customer(self):
        self.assertEqual(self.sign_in().status_code, 201)
        response = self.sign_in()
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.json()["created"])
        self.assertEqual(Customer.objects.filter(email=self.claims["email"]).count(), 1)

    def test_deactivated_customer_cannot_sign_in(self):
        Customer.objects.create(email=self.claims["email"], name="Disabled", password="unused", is_active=False)
        self.assertEqual(self.sign_in().status_code, 403)
