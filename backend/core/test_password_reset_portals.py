from unittest.mock import patch

from django.test import Client, TestCase
from django.utils import timezone

from .models import Customer, RoleType, User
from .views_api import _otp_bucket, _stateless_otp_for_bucket


class PasswordResetPortalValidationTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin = User.objects.create(
            email="reset.admin@gmail.com",
            password="hashed",
            name="Reset Admin",
            role=RoleType.ADMIN,
            is_active=True,
        )
        self.warehouse = User.objects.create(
            email="reset.warehouse@gmail.com",
            password="hashed",
            name="Reset Warehouse",
            role=RoleType.WAREHOUSE_STAFF,
            is_active=True,
        )
        self.driver = User.objects.create(
            email="reset.driver@gmail.com",
            password="hashed",
            name="Reset Driver",
            role=RoleType.DRIVER,
            is_active=True,
        )
        self.customer = Customer.objects.create(
            email="reset.customer@gmail.com",
            password="hashed",
            name="Reset Customer",
            is_active=True,
        )

    @patch("core.views_api._send_reset_otp_email")
    @patch("core.views_api._otp_mail_ready", return_value=True)
    def test_each_portal_accepts_only_its_registered_account(
        self,
        _mail_ready,
        send_otp,
    ) -> None:
        valid_accounts = {
            "admin": self.admin.email,
            "warehouse": self.warehouse.email,
            "driver": self.driver.email,
        }

        for portal, email in valid_accounts.items():
            with self.subTest(portal=portal, accepted=True):
                response = self.client.post(
                    "/api/auth/password-reset/request-otp",
                    data={"email": email, "accountType": "staff", "portal": portal},
                    content_type="application/json",
                )
                self.assertEqual(response.status_code, 200)

        # Fix: the warehouse portal must not send an OTP to another staff role.
        for email in (self.admin.email, self.driver.email):
            with self.subTest(portal="warehouse", rejected_email=email):
                response = self.client.post(
                    "/api/auth/password-reset/request-otp",
                    data={"email": email, "accountType": "staff", "portal": "warehouse"},
                    content_type="application/json",
                )
                self.assertEqual(response.status_code, 404)
                self.assertEqual(response.json()["error"], "Email is not registered for this portal")

        self.assertEqual(send_otp.call_count, 3)

    @patch("core.views_api._otp_mail_ready", return_value=True)
    def test_staff_reset_requires_a_portal(self, _mail_ready) -> None:
        response = self.client.post(
            "/api/auth/password-reset/request-otp",
            data={"email": self.warehouse.email, "accountType": "staff"},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "A valid staff portal is required")

    def test_staff_otp_cannot_be_reused_across_portals(self) -> None:
        # User.email is not unique, so cover the edge case where the same address
        # exists under two staff roles and account lookup alone cannot distinguish it.
        User.objects.create(
            email=self.admin.email,
            password="hashed",
            name="Duplicate Warehouse Address",
            role=RoleType.WAREHOUSE_STAFF,
            is_active=True,
        )
        otp = _stateless_otp_for_bucket(
            self.admin.email,
            "staff:admin",
            "password_reset",
            _otp_bucket(timezone.now()),
        )

        wrong_portal = self.client.post(
            "/api/auth/password-reset/verify-otp",
            data={"email": self.admin.email, "accountType": "staff", "portal": "warehouse", "otp": otp},
            content_type="application/json",
        )
        correct_portal = self.client.post(
            "/api/auth/password-reset/verify-otp",
            data={"email": self.admin.email, "accountType": "staff", "portal": "admin", "otp": otp},
            content_type="application/json",
        )

        self.assertEqual(wrong_portal.status_code, 400)
        self.assertEqual(wrong_portal.json()["error"], "Invalid or expired OTP")
        self.assertEqual(correct_portal.status_code, 200)

    @patch("core.views_api._send_reset_otp_email")
    @patch("core.views_api._otp_mail_ready", return_value=True)
    def test_customer_reset_still_uses_the_customer_account_table(
        self,
        _mail_ready,
        send_otp,
    ) -> None:
        response = self.client.post(
            "/api/auth/password-reset/request-otp",
            data={"email": self.customer.email, "accountType": "customer", "portal": "customer"},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        send_otp.assert_called_once()
