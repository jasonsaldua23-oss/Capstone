from datetime import timedelta
from unittest.mock import patch

from django.test import Client, TestCase, override_settings
from django.utils import timezone

from .auth import create_token, hash_password
from .auth_throttling import (
    OTP_FAILURE_POLICY,
    OTP_SEND_POLICY,
    _identifier_hash,
    check_limit,
    consume_event,
    record_failure,
)
from .models import AuthThrottleState, RoleType, User


@override_settings(
    AUTH_LOGIN_ALERT_THRESHOLD=99,
    # Test-only fast hasher keeps throttle behavior tests focused on control flow.
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
)
class AuthenticationThrottleTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin = User.objects.create(
            email="security.admin@example.com",
            password=hash_password("ValidPassword1!"),
            name="Security Admin",
            role=RoleType.ADMIN,
            is_active=True,
        )

    def _login(self, email: str, password: str, ip_address: str = "203.0.113.10"):
        return self.client.post(
            "/api/auth/login",
            data={"email": email, "password": password, "portal": "admin"},
            content_type="application/json",
            REMOTE_ADDR=ip_address,
        )

    def _expire_progressive_delay(self) -> None:
        # Tests advance through multiple failures without waiting in real time.
        AuthThrottleState.objects.update(blocked_until=timezone.now() - timedelta(seconds=1))

    def test_login_is_limited_by_account_and_source_ip(self) -> None:
        first = self._login(self.admin.email, "wrong-password", "203.0.113.10")
        self.assertEqual(first.status_code, 401)

        # Put the account at its full temporary lockout, independent of request
        # latency to the test database used by this project.
        AuthThrottleState.objects.filter(action="password_login", scope="account").update(
            attempt_count=5,
            blocked_until=timezone.now() + timedelta(minutes=15),
        )
        account_limited = self._login(self.admin.email, "wrong-password", "203.0.113.11")
        self.assertEqual(account_limited.status_code, 429)
        self.assertIn("Retry-After", account_limited)
        # The body carries the wait too, so a client that cannot read the header
        # (cross-origin, or a proxy that drops it) still shows the lockout rather
        # than retrying until it ends.
        self.assertEqual(account_limited.json()["retryAfter"], int(account_limited["Retry-After"]))
        self.assertGreater(account_limited.json()["retryAfter"], 60)

        AuthThrottleState.objects.filter(action="password_login", scope="ip").update(
            attempt_count=20,
            blocked_until=timezone.now() + timedelta(minutes=15),
        )
        ip_limited = self._login("another.account@example.com", "wrong-password", "203.0.113.10")
        self.assertEqual(ip_limited.status_code, 429)

    def test_login_delay_increases_and_fifth_failure_locks_temporarily(self) -> None:
        observed_delays = []
        for attempt in range(1, 6):
            response = self._login(self.admin.email, "wrong-password")
            self.assertEqual(response.status_code, 401)
            account_state = AuthThrottleState.objects.get(action="password_login", scope="account")
            observed_delays.append(
                round((account_state.blocked_until - account_state.last_attempt_at).total_seconds())
            )
            if attempt < 5:
                self._expire_progressive_delay()

        self.assertEqual(observed_delays[:4], [10, 20, 40, 60])
        self.assertGreaterEqual(observed_delays[4], 899)
        locked = self._login(self.admin.email, "wrong-password")
        self.assertEqual(locked.status_code, 429)

    @override_settings(AUTH_LOGIN_ALERT_THRESHOLD=3)
    @patch("core.views_api._email_admin_login_failure_alert")
    def test_repeated_admin_login_failures_send_one_security_alert(self, send_alert) -> None:
        for _ in range(3):
            self.assertEqual(self._login(self.admin.email, "wrong-password").status_code, 401)
            self._expire_progressive_delay()

        send_alert.assert_called_once()

    @override_settings(AUTH_LOGIN_ALERT_THRESHOLD=3)
    @patch("core.views_api._email_admin_login_failure_alert")
    def test_repeated_admin_otp_failures_send_one_security_alert(self, send_alert) -> None:
        challenge = create_token(
            {
                "type": "login_2fa",
                "userId": self.admin.id,
                "email": self.admin.email,
                "portal": "admin",
                "rememberMe": False,
            },
            exp_hours=1,
        )
        for _ in range(3):
            response = self.client.post(
                "/api/auth/login/verify-otp",
                data={"challengeToken": challenge, "otp": "not-valid"},
                content_type="application/json",
                REMOTE_ADDR="203.0.113.40",
            )
            self.assertEqual(response.status_code, 400)
            self._expire_progressive_delay()

        send_alert.assert_called_once()

    @patch("core.views_api._send_reset_otp_email")
    @patch("core.views_api._otp_mail_ready", return_value=True)
    def test_password_reset_otp_send_is_limited(self, _mail_ready, send_otp) -> None:
        payload = {
            "email": self.admin.email,
            "accountType": "staff",
            "portal": "admin",
        }
        for _ in range(3):
            response = self.client.post(
                "/api/auth/password-reset/request-otp",
                data=payload,
                content_type="application/json",
                REMOTE_ADDR="203.0.113.20",
            )
            self.assertEqual(response.status_code, 200)

        limited = self.client.post(
            "/api/auth/password-reset/request-otp",
            data=payload,
            content_type="application/json",
            REMOTE_ADDR="203.0.113.20",
        )
        self.assertEqual(limited.status_code, 429)
        self.assertEqual(send_otp.call_count, 3)

    def test_password_reset_otp_failure_adds_progressive_delay(self) -> None:
        payload = {
            "email": self.admin.email,
            "accountType": "staff",
            "portal": "admin",
            "otp": "000000",
        }
        failed = self.client.post(
            "/api/auth/password-reset/verify-otp",
            data=payload,
            content_type="application/json",
            REMOTE_ADDR="203.0.113.30",
        )
        self.assertEqual(failed.status_code, 400)

        delayed = self.client.post(
            "/api/auth/password-reset/verify-otp",
            data=payload,
            content_type="application/json",
            REMOTE_ADDR="203.0.113.30",
        )
        self.assertEqual(delayed.status_code, 429)
        self.assertIn("Retry-After", delayed)


class ThrottleRoundTripTests(TestCase):
    """The throttle sits on every OTP send and login, a network round trip per statement.

    Counting the account and IP scopes in separate transactions cost 10 statements
    per call (16 on a first send), most of a verification-code request's latency.
    """

    action = "round_trip_probe"
    account = "round.trip@example.com"
    ip_address = "203.0.113.50"

    def _counts(self) -> dict[str, int]:
        return dict(
            AuthThrottleState.objects.filter(action=self.action).values_list("scope", "attempt_count")
        )

    def test_consume_event_advances_both_scopes_in_one_transaction(self) -> None:
        # First send creates both rows: begin, lock, insert, re-lock, update, commit.
        with self.assertNumQueries(6):
            self.assertEqual(consume_event(self.action, self.account, self.ip_address, OTP_SEND_POLICY), 0)
        # Later sends find both rows: begin, lock, update, commit.
        with self.assertNumQueries(4):
            self.assertEqual(consume_event(self.action, self.account, self.ip_address, OTP_SEND_POLICY), 0)
        self.assertEqual(self._counts(), {"account": 2, "ip": 2})

    def test_check_limit_reads_both_scopes_in_one_query(self) -> None:
        with self.assertNumQueries(1):
            self.assertEqual(check_limit(self.action, self.account, self.ip_address, OTP_SEND_POLICY), 0)

    def test_blocked_account_does_not_spend_the_ip_allowance(self) -> None:
        # The send that reaches the account limit still succeeds.
        for _ in range(OTP_SEND_POLICY.account_limit):
            self.assertEqual(consume_event(self.action, self.account, self.ip_address, OTP_SEND_POLICY), 0)
        self.assertEqual(self._counts(), {"account": 3, "ip": 3})

        retry_after = consume_event(self.action, self.account, self.ip_address, OTP_SEND_POLICY)

        self.assertGreater(retry_after, 0)
        self.assertEqual(self._counts(), {"account": 3, "ip": 3})
        self.assertEqual(check_limit(self.action, self.account, self.ip_address, OTP_SEND_POLICY), retry_after)

    def test_blocked_ip_keeps_the_account_attempt_that_preceded_it(self) -> None:
        # Same order as before the merge: the account is counted, then the IP refuses.
        consume_event(self.action, "someone.else@example.com", self.ip_address, OTP_SEND_POLICY)
        AuthThrottleState.objects.filter(action=self.action, scope="ip").update(
            blocked_until=timezone.now() + timedelta(minutes=15),
        )

        retry_after = consume_event(self.action, self.account, self.ip_address, OTP_SEND_POLICY)

        self.assertGreater(retry_after, 0)
        account_row = AuthThrottleState.objects.get(
            action=self.action,
            scope="account",
            identifier_hash=_identifier_hash("account", self.account),
        )
        self.assertEqual(account_row.attempt_count, 1)

    def test_record_failure_counts_both_scopes_even_when_the_account_is_blocked(self) -> None:
        record_failure(self.action, self.account, self.ip_address, OTP_FAILURE_POLICY)
        AuthThrottleState.objects.filter(action=self.action, scope="account").update(
            blocked_until=timezone.now() + timedelta(minutes=15),
        )
        AuthThrottleState.objects.filter(action=self.action, scope="ip").update(blocked_until=None)

        result = record_failure(self.action, self.account, self.ip_address, OTP_FAILURE_POLICY)

        self.assertEqual(result.account_count, 1)
        self.assertGreater(result.retry_after, 0)
        self.assertEqual(self._counts(), {"account": 1, "ip": 2})
