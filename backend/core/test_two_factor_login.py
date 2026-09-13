"""Regression coverage for staff and customer two-factor login."""

from unittest.mock import patch

from django.test import Client, TestCase
from django.utils import timezone

from .auth import create_token, hash_password
from .models import Customer, RoleType, User
from .views_api import _otp_bucket, _stateless_otp_for_bucket


class TwoFactorLoginTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.password = "StrongLoginPassword2026!"
        self.warehouse_user = User.objects.create(
            email="two.factor.warehouse@example.com",
            password=hash_password(self.password),
            name="Two Factor Warehouse",
            role=RoleType.WAREHOUSE_STAFF,
            is_active=True,
            two_factor_enabled=True,
        )
        self.customer = Customer.objects.create(
            email="two.factor.customer@example.com",
            password=hash_password(self.password),
            name="Two Factor Customer",
            is_active=True,
            two_factor_enabled=True,
        )

    @patch("core.views_api._email_login_alert")
    @patch("core.views_api._send_login_otp_email")
    @patch("core.views_api._otp_mail_ready", return_value=True)
    def test_customer_challenge_accepts_customer_otp_and_issues_customer_session(
        self, _mail_ready, send_otp, login_alert
    ) -> None:
        # Fix: customer password login must stop at an OTP challenge before issuing a session.
        challenge_response = self.client.post(
            "/api/auth/customer/login",
            data={"email": self.customer.email, "password": self.password, "rememberMe": True},
            content_type="application/json",
        )
        self.assertEqual(challenge_response.status_code, 202, challenge_response.content.decode())
        challenge = challenge_response.json()
        self.assertTrue(challenge["requiresTwoFactor"])
        send_otp.assert_called_once()

        otp = _stateless_otp_for_bucket(
            self.customer.email,
            "customer",
            "login_2fa",
            _otp_bucket(timezone.now()),
        )
        verify_response = self.client.post(
            "/api/auth/login/verify-otp",
            data={"challengeToken": challenge["challengeToken"], "otp": otp},
            content_type="application/json",
        )

        self.assertEqual(verify_response.status_code, 200, verify_response.content.decode())
        payload = verify_response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["user"]["type"], "customer")
        self.assertTrue(payload["token"])
        login_alert.assert_called_once_with(self.customer)

    @patch("core.views_api._email_login_alert")
    @patch("core.views_api._send_login_otp_email")
    @patch("core.views_api._otp_mail_ready", return_value=True)
    def test_warehouse_challenge_still_accepts_staff_otp(
        self, _mail_ready, _send_otp, _login_alert
    ) -> None:
        challenge_response = self.client.post(
            "/api/auth/login",
            data={
                "email": self.warehouse_user.email,
                "password": self.password,
                "portal": "warehouse",
            },
            content_type="application/json",
        )
        self.assertEqual(challenge_response.status_code, 202, challenge_response.content.decode())

        otp = _stateless_otp_for_bucket(
            self.warehouse_user.email,
            "staff",
            "login_2fa",
            _otp_bucket(timezone.now()),
        )
        verify_response = self.client.post(
            "/api/auth/login/verify-otp",
            data={"challengeToken": challenge_response.json()["challengeToken"], "otp": otp},
            content_type="application/json",
        )

        self.assertEqual(verify_response.status_code, 200, verify_response.content.decode())
        self.assertEqual(verify_response.json()["user"]["role"], RoleType.WAREHOUSE_STAFF)

    def test_customer_can_persist_two_factor_setting(self) -> None:
        self.customer.two_factor_enabled = False
        self.customer.save(update_fields=["two_factor_enabled", "updated_at"])
        token = create_token(
            {"type": "customer", "userId": self.customer.id, "email": self.customer.email},
            1,
        )

        response = self.client.put(
            f"/api/customers/{self.customer.id}",
            data={"twoFactorEnabled": True},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        self.assertEqual(response.status_code, 200, response.content.decode())
        self.customer.refresh_from_db()
        self.assertTrue(self.customer.two_factor_enabled)
        self.assertTrue(response.json()["customer"]["twoFactorEnabled"])
