"""Google login accepts only the explicitly configured OAuth client audiences."""

import base64
import json
from datetime import timedelta
from unittest.mock import patch

from django.db import IntegrityError, transaction
from django.test import RequestFactory, SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from .auth import hash_password
from .views_api import _otp_bucket, _stateless_otp_for_bucket, _verify_google_token, auth_customer_google
from .models import Customer, RoleType, User


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
                                    content_type="application/json", HTTP_ORIGIN="http://testserver")

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

    def test_google_primary_factor_requires_customer_two_factor_code(self):
        """Existing Google customers must complete the same OTP step as password users."""
        customer = Customer.objects.create(
            email=self.claims["email"],
            name="Two-factor Customer",
            password=hash_password("StrongPassword2026!"),
            two_factor_enabled=True,
        )
        with patch("core.views_api._otp_mail_ready", return_value=True), \
             patch("core.views_api._send_login_otp_email") as send_otp, \
             patch("core.views_api._email_login_alert"):
            challenge_response = self.sign_in()

            self.assertEqual(challenge_response.status_code, 202, challenge_response.content)
            challenge = challenge_response.json()
            self.assertTrue(challenge["requiresTwoFactor"])
            # Google Identity Services does not expose the signed-in address to the UI.
            self.assertEqual(challenge["email"], customer.email)
            send_otp.assert_called_once()

            otp = _stateless_otp_for_bucket(
                customer.email,
                "customer",
                "login_2fa",
                _otp_bucket(timezone.now()),
            )
            verify_response = self.client.post(
                "/api/auth/login/verify-otp",
                {"challengeToken": challenge["challengeToken"], "otp": otp},
                content_type="application/json",
            )

        self.assertEqual(verify_response.status_code, 200, verify_response.content)
        self.assertEqual(verify_response.json()["user"]["type"], "customer")


@override_settings(GOOGLE_OAUTH_CLIENT_ID="", GOOGLE_OAUTH_CLIENT_IDS=["web-client"])
class UnifiedLoginTests(TestCase):
    """The neutral sign-in endpoint must select the existing account type safely."""

    password = "StrongPassword2026!"

    def create_customer(self, *, email: str = "unified-customer@example.com") -> Customer:
        return Customer.objects.create(
            email=email,
            name="Unified Customer",
            password=hash_password(self.password),
        )

    def create_staff(self, *, email: str = "unified-staff@example.com") -> User:
        return User.objects.create(
            email=email,
            name="Unified Staff",
            password=hash_password(self.password),
            role=RoleType.WAREHOUSE_STAFF,
        )

    def unified_password_sign_in(self, email: str):
        return self.client.post(
            "/api/auth/unified/login",
            {"email": email, "password": self.password, "rememberMe": True},
            content_type="application/json",
        )

    def unified_google_sign_in(self, claims: dict[str, object]):
        with patch("core.views_api._verify_google_token", return_value=claims):
            return self.client.post(
                "/api/auth/unified/google",
                {"credential": "verified-by-mock", "rememberMe": True},
                content_type="application/json",
            )

    def test_password_sign_in_routes_an_existing_customer(self):
        customer = self.create_customer()

        response = self.unified_password_sign_in(customer.email)

        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["user"]["userId"], customer.id)
        self.assertEqual(payload["user"]["type"], "customer")
        self.assertEqual(payload["user"]["role"], RoleType.CUSTOMER)

    def test_password_sign_in_routes_an_existing_staff_member(self):
        staff = self.create_staff()
        with patch("core.views_api._email_login_alert"):
            response = self.unified_password_sign_in(staff.email)

        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["user"]["userId"], staff.id)
        self.assertEqual(payload["user"]["type"], "staff")
        self.assertEqual(payload["user"]["role"], RoleType.WAREHOUSE_STAFF)

    def test_google_sign_in_routes_an_existing_customer_without_provisioning(self):
        customer = self.create_customer(email="unified-google-customer@example.com")
        claims = {"email": customer.email, "email_verified": True, "name": "Unified Customer"}

        response = self.unified_google_sign_in(claims)

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["user"]["type"], "customer")
        self.assertEqual(Customer.objects.filter(email=customer.email).count(), 1)

    def test_google_sign_in_routes_an_existing_staff_member(self):
        staff = self.create_staff(email="unified-google-staff@example.com")
        claims = {"email": staff.email, "email_verified": True, "name": "Unified Staff"}

        with patch("core.views_api._email_login_alert"):
            response = self.unified_google_sign_in(claims)

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["user"]["type"], "staff")
        self.assertEqual(response.json()["user"]["role"], RoleType.WAREHOUSE_STAFF)

    def test_google_sign_in_never_provisions_an_unknown_account(self):
        email = "unified-unknown@example.com"
        claims = {"email": email, "email_verified": True, "name": "Unknown Account"}

        response = self.unified_google_sign_in(claims)

        self.assertEqual(response.status_code, 401, response.content)
        self.assertEqual(Customer.objects.filter(email=email).count(), 0)
        self.assertEqual(User.objects.filter(email=email).count(), 0)

    def test_cross_table_duplicate_email_fails_closed_for_every_unified_factor(self):
        email = "unified-duplicate@example.com"
        self.create_customer(email=email)
        self.create_staff(email=email)
        claims = {"email": email, "email_verified": True, "name": "Duplicate Account"}

        password_response = self.unified_password_sign_in(email)
        google_response = self.unified_google_sign_in(claims)

        # A legacy cross-table collision is ambiguous, so the neutral entry point
        # must never pick one account based on factor order or insertion order.
        self.assertEqual(password_response.status_code, 401, password_response.content)
        self.assertEqual(google_response.status_code, 401, google_response.content)

    def test_each_account_table_rejects_case_and_whitespace_email_duplicates(self):
        self.create_staff(email="canonical-staff@example.com")
        self.create_customer(email="canonical-customer@example.com")

        # The database constraints protect writes that bypass API-level duplicate checks.
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.create_staff(email="  CANONICAL-STAFF@EXAMPLE.COM  ")
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.create_customer(email="  CANONICAL-CUSTOMER@EXAMPLE.COM  ")


@override_settings(GOOGLE_OAUTH_CLIENT_ID="", GOOGLE_OAUTH_CLIENT_IDS=["web-client"])
class StaffGoogleSessionTests(TestCase):
    """Staff Google sign-in authenticates existing accounts without provisioning roles."""

    claims = {
        "email": "staff-google@example.com",
        "email_verified": True,
        "name": "Google Staff",
    }

    def create_staff(self, *, active: bool = True, two_factor: bool = False) -> User:
        return User.objects.create(
            email=self.claims["email"],
            password=hash_password("StrongPassword2026!"),
            name="Configured Staff",
            role=RoleType.WAREHOUSE_STAFF,
            is_active=active,
            two_factor_enabled=two_factor,
        )

    def sign_in(self):
        with patch("core.views_api._verify_google_token", return_value=self.claims):
            return self.client.post(
                "/api/auth/staff/google",
                {"credential": "verified-by-mock", "rememberMe": True},
                content_type="application/json",
            )

    def test_existing_active_staff_receives_a_role_scoped_session(self):
        staff = self.create_staff()
        with patch("core.views_api._email_login_alert"):
            response = self.sign_in()

        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["user"]["userId"], staff.id)
        self.assertEqual(payload["user"]["role"], RoleType.WAREHOUSE_STAFF)
        self.assertTrue(payload["token"])
        session = self.client.get("/api/auth/me", HTTP_X_PORTAL="warehouse")
        self.assertEqual(session.status_code, 200, session.content)
        self.assertEqual(session.json()["user"]["email"], staff.email)

    def test_generic_password_scope_returns_the_existing_staff_role(self):
        staff = self.create_staff()
        with patch("core.views_api._email_login_alert"):
            response = self.client.post(
                "/api/auth/login",
                {
                    "email": staff.email,
                    "password": "StrongPassword2026!",
                    "portal": "staff",
                },
                content_type="application/json",
            )

        # The neutral form does not select a role; the client routes from this value.
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["user"]["role"], RoleType.WAREHOUSE_STAFF)

    def test_google_sign_in_never_creates_an_unknown_staff_account(self):
        with patch("core.views_api._verify_google_token", return_value=self.claims):
            response = self.client.post(
                "/api/auth/staff/google",
                {"credential": "verified-by-mock"},
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 401, response.content)
        self.assertEqual(User.objects.filter(email=self.claims["email"]).count(), 0)

    def test_deactivated_staff_cannot_sign_in_with_google(self):
        self.create_staff(active=False)
        with patch("core.views_api._verify_google_token", return_value=self.claims):
            response = self.client.post(
                "/api/auth/staff/google",
                {"credential": "verified-by-mock"},
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 401, response.content)

    def test_google_primary_factor_still_requires_staff_two_factor_code(self):
        staff = self.create_staff(two_factor=True)
        with patch("core.views_api._verify_google_token", return_value=self.claims), \
             patch("core.views_api._otp_mail_ready", return_value=True), \
             patch("core.views_api._send_login_otp_email") as send_otp, \
             patch("core.views_api._email_login_alert"):
            challenge_response = self.client.post(
                "/api/auth/staff/google",
                {"credential": "verified-by-mock"},
                content_type="application/json",
            )
            self.assertEqual(challenge_response.status_code, 202, challenge_response.content)
            challenge = challenge_response.json()
            self.assertTrue(challenge["requiresTwoFactor"])
            self.assertEqual(challenge["email"], staff.email)
            send_otp.assert_called_once()

            otp = _stateless_otp_for_bucket(
                staff.email,
                "staff",
                "login_2fa",
                _otp_bucket(timezone.now()),
            )
            verify_response = self.client.post(
                "/api/auth/login/verify-otp",
                {"challengeToken": challenge["challengeToken"], "otp": otp},
                content_type="application/json",
            )

        self.assertEqual(verify_response.status_code, 200, verify_response.content)
        self.assertTrue(verify_response.json()["success"])
