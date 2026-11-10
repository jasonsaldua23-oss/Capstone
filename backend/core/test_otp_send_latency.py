"""Verification-code sends must not make the person wait on avoidable round trips.

Every database statement on these requests is a sequential round trip to the
remote Supabase pooler, and every email first tried the Gmail API. Both made the
password-change, email-verification and 2FA "Send code" buttons spin.
"""

from unittest.mock import Mock, patch

from django.test import Client, SimpleTestCase, TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.db import connection

from . import email_transport
from .auth import hash_password
from .models import Customer, RoleType, User

PASSWORD = "StrongLoginPassword2026!"


def _reset_transport_state() -> None:
    email_transport._gmail_api_disabled_until = 0.0
    email_transport._brevo_disabled_until = 0.0
    email_transport._smtp_disabled_until = 0.0
    email_transport._GMAIL_API_TOKEN_CACHE.update({"token": "", "expires_at": 0.0})


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
@patch("core.views_api._otp_mail_ready", return_value=True)
@patch("core.views_api._account_display_name", side_effect=AssertionError("name lookup on the request path"))
@patch("core.views_api._send_structured_email")
class OtpSendRequestTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.customer = Customer.objects.create(
            email="otp.latency.customer@gmail.com",
            password=hash_password(PASSWORD),
            name="Latency Customer",
            is_active=True,
            two_factor_enabled=True,
        )
        self.staff = User.objects.create(
            email="otp.latency.admin@gmail.com",
            password=hash_password(PASSWORD),
            name="Latency Admin",
            role=RoleType.ADMIN,
            is_active=True,
            two_factor_enabled=True,
        )

    def _post(self, path: str, body: dict):
        with CaptureQueriesContext(connection) as queries:
            response = self.client.post(path, data=body, content_type="application/json")
        return response, len(queries.captured_queries)

    def _greeted_name(self, send_structured_email) -> str:
        send_structured_email.assert_called_once()
        return send_structured_email.call_args.kwargs["body"].recipient_name

    def test_password_reset_send_reuses_the_account_it_loaded(self, send_structured_email, _name, _ready) -> None:
        response, statements = self._post(
            "/api/auth/password-reset/request-otp",
            {"email": self.customer.email, "accountType": "customer"},
        )

        self.assertEqual(response.status_code, 200, response.content.decode())
        self.assertEqual(self._greeted_name(send_structured_email), "Latency Customer")
        # Was 19: two throttle transactions plus a User-then-Customer name lookup.
        self.assertLessEqual(statements, 7)

    def test_new_email_verification_send_skips_the_name_lookup(self, send_structured_email, _name, _ready) -> None:
        response, statements = self._post(
            "/api/auth/email-verification/request",
            {"email": "not.registered.yet@gmail.com", "accountType": "customer"},
        )

        self.assertEqual(response.status_code, 200, response.content.decode())
        # The duplicate check just proved no account holds the address.
        self.assertEqual(self._greeted_name(send_structured_email), "")
        self.assertLessEqual(statements, 8)  # was 20

    def test_two_factor_challenge_greets_the_account_signing_in(self, send_structured_email, _name, _ready) -> None:
        response, statements = self._post(
            "/api/auth/unified/login",
            {"email": self.customer.email, "password": PASSWORD},
        )

        self.assertEqual(response.status_code, 202, response.content.decode())
        self.assertEqual(self._greeted_name(send_structured_email), "Latency Customer")
        self.assertLessEqual(statements, 13)  # was 26

    def test_staff_two_factor_challenge_greets_the_staff_member(self, send_structured_email, _name, _ready) -> None:
        response, _statements = self._post(
            "/api/auth/unified/login",
            {"email": self.staff.email, "password": PASSWORD},
        )

        self.assertEqual(response.status_code, 202, response.content.decode())
        self.assertEqual(self._greeted_name(send_structured_email), "Latency Admin")


@override_settings(
    GMAIL_API_REFRESH_TOKEN="revoked-refresh-token",
    GMAIL_API_CLIENT_ID="client-id",
    GMAIL_API_CLIENT_SECRET="client-secret",
    BREVO_API_KEY="brevo-key",
    OTP_FROM_EMAIL="sender@example.com",
    GMAIL_API_SENDER_EMAIL="sender@example.com",
    OTP_SMTP_FROM_EMAIL="sender@example.com",
)
class GmailTokenFailureTests(SimpleTestCase):
    def setUp(self) -> None:
        self._reset_transport_state()
        self.addCleanup(self._reset_transport_state)

    @staticmethod
    def _reset_transport_state() -> None:
        _reset_transport_state()

    def _fake_post(self, token_response):
        brevo = Mock(ok=True, status_code=201)

        def post(url, **_kwargs):
            return token_response if "oauth2.googleapis.com" in url else brevo

        return post

    def _send_twice(self, token_response):
        with patch("core.email_transport.requests.post", side_effect=self._fake_post(token_response)) as post, \
                self.assertLogs("core.email_transport", level="WARNING") as logs:
            for _ in range(2):
                email_transport._dispatch_email(subject="Code", text="123456", html="<p>123456</p>", recipient="person@example.com")
        urls = [call.args[0] for call in post.call_args_list]
        return urls, "\n".join(logs.output)

    def test_revoked_refresh_token_is_not_retried_for_every_email(self) -> None:
        revoked = Mock(ok=False, status_code=400)
        revoked.json.return_value = {"error": "invalid_grant", "error_description": "Bad Request"}

        urls, log_text = self._send_twice(revoked)

        # Each email used to ask Google again (up to a 15s timeout) before Brevo.
        self.assertEqual(sum("oauth2.googleapis.com" in url for url in urls), 1)
        self.assertEqual(sum("api.brevo.com" in url for url in urls), 2)
        self.assertIn("invalid_grant", log_text)
        self.assertIn("get_gmail_refresh_token.py", log_text)
        self.assertGreaterEqual(
            email_transport._gmail_api_disabled_until - email_transport.monotonic(),
            email_transport._GMAIL_API_COOLDOWN_SECONDS,
        )

    def test_unreachable_token_endpoint_backs_off_for_the_short_cooldown(self) -> None:
        import requests

        def post(url, **_kwargs):
            if "oauth2.googleapis.com" in url:
                raise requests.ConnectTimeout("timed out")
            return Mock(ok=True, status_code=201)

        with patch("core.email_transport.requests.post", side_effect=post) as mocked, \
                self.assertLogs("core.email_transport", level="WARNING"):
            for _ in range(2):
                email_transport._dispatch_email(subject="Code", text="1", html="<p>1</p>", recipient="person@example.com")

        urls = [call.args[0] for call in mocked.call_args_list]
        self.assertEqual(sum("oauth2.googleapis.com" in url for url in urls), 1)
        self.assertEqual(sum("api.brevo.com" in url for url in urls), 2)
        self.assertLessEqual(
            email_transport._gmail_api_disabled_until - email_transport.monotonic(),
            email_transport._GMAIL_API_COOLDOWN_SECONDS,
        )


@override_settings(
    GMAIL_API_REFRESH_TOKEN="",
    BREVO_API_KEY="brevo-key",
    # Brevo cannot send as a free mailbox: it rewrites this to <id>.brevosend.com,
    # which Gmail rejects under that domain's DMARC p=reject.
    OTP_FROM_EMAIL="owner.personal@gmail.com",
    EMAIL_HOST_USER="business.mailbox@gmail.com",
    EMAIL_HOST_PASSWORD="app-password",
    DEFAULT_FROM_EMAIL="Business <business.mailbox@gmail.com>",
    GMAIL_API_SENDER_EMAIL="business.mailbox@gmail.com",
    OTP_SMTP_FROM_EMAIL="business.mailbox@gmail.com",
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
)
class FreeMailboxSenderOrderTests(SimpleTestCase):
    def setUp(self) -> None:
        _reset_transport_state()
        self.addCleanup(_reset_transport_state)

    def _dispatch(self) -> None:
        email_transport._dispatch_email(subject="Code", text="123456", html="<p>123456</p>", recipient="person@gmail.com")

    def test_gmail_smtp_goes_before_a_rewritten_brevo_sender(self) -> None:
        from django.core import mail

        with patch("core.email_transport.requests.post") as post:
            self._dispatch()

        post.assert_not_called()
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].from_email, "Business <business.mailbox@gmail.com>")

    def test_smtp_failure_falls_back_to_brevo_and_backs_off(self) -> None:
        import smtplib

        brevo = Mock(ok=True, status_code=201)
        with patch("core.email_transport.send_mail", side_effect=smtplib.SMTPAuthenticationError(535, b"rejected")) as smtp, \
                patch("core.email_transport.requests.post", return_value=brevo) as post, \
                self.assertLogs("core.email_transport", level="WARNING"):
            self._dispatch()
            self._dispatch()

        # A broken app password must not make every email wait out EMAIL_TIMEOUT first.
        self.assertEqual(smtp.call_count, 1)
        self.assertEqual(post.call_count, 2)

    def test_every_transport_failing_is_reported(self) -> None:
        import smtplib

        with patch("core.email_transport.send_mail", side_effect=smtplib.SMTPServerDisconnected("gone")), \
                patch("core.email_transport.requests.post", return_value=Mock(ok=False, status_code=500, raise_for_status=Mock(side_effect=RuntimeError("500")))), \
                self.assertLogs("core.email_transport", level="WARNING"), \
                self.assertRaises(RuntimeError):
            self._dispatch()

    @override_settings(OTP_FROM_EMAIL="codes@annanns-trading.example")
    def test_brevo_with_its_own_domain_still_goes_first(self) -> None:
        from django.core import mail

        with patch("core.email_transport.requests.post", return_value=Mock(ok=True, status_code=201)) as post:
            self._dispatch()

        post.assert_called_once()
        self.assertEqual(len(mail.outbox), 0)
