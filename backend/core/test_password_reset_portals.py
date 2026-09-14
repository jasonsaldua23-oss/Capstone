from unittest.mock import patch

from django.test import Client, TestCase
from django.utils import timezone

from .auth import verify_password
from .models import AuthThrottleState, Customer, RoleType, User
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
        # Duplicate staff emails are forbidden; portal purpose still binds the proof.
        otp = _stateless_otp_for_bucket(
            self.admin.email,
            "staff:admin",
            "password_reset",
            _otp_bucket(timezone.now()),
        )

        correct_portal = self.client.post(
            "/api/auth/password-reset/verify-otp",
            data={"email": self.admin.email, "accountType": "staff", "portal": "admin", "otp": otp},
            content_type="application/json",
        )

        wrong_portal = self.client.post(
            "/api/auth/password-reset/verify-otp",
            data={"email": self.admin.email, "accountType": "staff", "portal": "warehouse", "otp": otp},
            content_type="application/json",
        )
        self.assertEqual(wrong_portal.status_code, 404)
        self.assertEqual(wrong_portal.json()["error"], "Email is not registered for this portal")
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

    @patch("core.views_api._send_reset_otp_email")
    @patch("core.views_api._otp_mail_ready", return_value=True)
    def test_neutral_reset_resolves_existing_customer_and_staff_accounts(
        self,
        _mail_ready,
        send_otp,
    ) -> None:
        # The generic browser page must not require the user to reveal a role first.
        for email in (self.customer.email, self.driver.email):
            with self.subTest(email=email):
                response = self.client.post(
                    "/api/auth/password-reset/request-otp",
                    data={"email": email, "accountType": "unified"},
                    content_type="application/json",
                )
                self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(send_otp.call_count, 2)

    def test_neutral_reset_otp_is_not_valid_for_a_scoped_portal_reset(self) -> None:
        # Neutral recovery has its own proof scope, so it cannot be replayed on /login/admin.
        # This suite intentionally submits one invalid OTP; remove retained state
        # from a prior --keepdb run before asserting the independent valid path.
        AuthThrottleState.objects.all().delete()
        otp = _stateless_otp_for_bucket(
            self.admin.email,
            "unified",
            "password_reset",
            _otp_bucket(timezone.now()),
        )

        verify_response = self.client.post(
            "/api/auth/password-reset/verify-otp",
            data={"email": self.admin.email, "accountType": "unified", "otp": otp},
            content_type="application/json",
            REMOTE_ADDR="203.0.113.32",
        )
        self.assertEqual(verify_response.status_code, 200, verify_response.content)

        reset_response = self.client.post(
            "/api/auth/password-reset/reset",
            data={
                "email": self.admin.email,
                "accountType": "unified",
                "otp": otp,
                "newPassword": "NeutralReset!482Aa",
            },
            content_type="application/json",
            REMOTE_ADDR="203.0.113.32",
        )
        self.assertEqual(reset_response.status_code, 200, reset_response.content)
        self.admin.refresh_from_db()
        self.assertTrue(verify_password("NeutralReset!482Aa", self.admin.password))

        # Assert scope separation last so the deliberate invalid portal attempt
        # cannot throttle the valid neutral verification or password update.
        scoped_response = self.client.post(
            "/api/auth/password-reset/verify-otp",
            data={"email": self.admin.email, "accountType": "staff", "portal": "admin", "otp": otp},
            content_type="application/json",
            REMOTE_ADDR="203.0.113.31",
        )
        self.assertEqual(scoped_response.status_code, 400, scoped_response.content)

    @patch("core.views_api._send_reset_otp_email")
    @patch("core.views_api._otp_mail_ready", return_value=True)
    def test_neutral_reset_rejects_cross_table_email_collisions(self, _mail_ready, send_otp) -> None:
        Customer.objects.create(
            email=self.admin.email,
            password="hashed",
            name="Duplicate Reset Customer",
            is_active=True,
        )

        response = self.client.post(
            "/api/auth/password-reset/request-otp",
            data={"email": self.admin.email, "accountType": "unified"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 404, response.content)
        send_otp.assert_not_called()
