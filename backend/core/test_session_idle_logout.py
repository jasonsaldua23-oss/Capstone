"""Server-enforced idle logout for web sessions without "Keep me logged in"."""

from datetime import timedelta
from unittest.mock import patch

import jwt
from django.test import Client, TestCase, override_settings
from django.utils import timezone

from .auth import _jwt_secret, create_token, decode_token, hash_password
from .models import Customer, RoleType, SessionActivity, User
from .views_api import _otp_bucket, _stateless_otp_for_bucket

WEB = {"HTTP_X_SESSION_CLIENT": "web"}


@override_settings(
    AUTH_LOGIN_ALERT_THRESHOLD=99,
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
)
class SessionIdleLogoutTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin = User.objects.create(
            email="idle.admin@example.com",
            password=hash_password("ValidPassword1!"),
            name="Idle Admin",
            role=RoleType.ADMIN,
            is_active=True,
            login_alerts_enabled=False,
            session_timeout_minutes=10,
        )

    def _login(self, remember_me: bool, **headers) -> str:
        # A fresh client per login, as a cookie from an earlier login makes the
        # next POST cookie-authenticated and subject to the origin check.
        response = Client().post(
            "/api/auth/login",
            data={"email": self.admin.email, "password": "ValidPassword1!", "portal": "admin", "rememberMe": remember_me},
            content_type="application/json",
            **headers,
        )
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["token"]

    def _me(self, token: str):
        return self.client.get("/api/auth/me", HTTP_AUTHORIZATION=f"Bearer {token}", HTTP_X_PORTAL="admin")

    def _set_last_activity(self, token: str, minutes_ago: float) -> None:
        claims = decode_token(token)
        SessionActivity.objects.update_or_create(
            jti=claims["jti"],
            defaults={
                "last_active_at": timezone.now() - timedelta(minutes=minutes_ago),
                "expires_at": timezone.now() + timedelta(hours=1),
            },
        )

    def test_only_unremembered_web_logins_get_the_idle_limit(self) -> None:
        self.assertTrue(decode_token(self._login(False, **WEB)).get("idleLogout"))
        self.assertFalse(decode_token(self._login(True, **WEB)).get("idleLogout"))
        # The Expo apps and the native GPS service send no web marker.
        self.assertFalse(decode_token(self._login(False)).get("idleLogout"))

    def test_session_idle_past_the_users_limit_is_rejected(self) -> None:
        token = self._login(False, **WEB)
        self._set_last_activity(token, 9)
        self.assertEqual(self._me(token).status_code, 200)
        self._set_last_activity(token, 11)
        self.assertEqual(self._me(token).status_code, 401)

    def test_a_session_never_touched_is_idle_since_it_was_issued(self) -> None:
        claims = decode_token(self._login(False, **WEB))
        claims["iat"] = int((timezone.now() - timedelta(minutes=11)).timestamp())
        stale = jwt.encode(claims, _jwt_secret(), algorithm="HS256")
        self.assertEqual(self._me(stale).status_code, 401)

    def test_a_changed_limit_applies_to_existing_sessions(self) -> None:
        token = self._login(False, **WEB)
        self._set_last_activity(token, 20)
        self.assertEqual(self._me(token).status_code, 401)
        User.objects.filter(id=self.admin.id).update(session_timeout_minutes=30)
        self.assertEqual(self._me(token).status_code, 200)

    def test_remembered_sessions_have_no_idle_limit(self) -> None:
        token = self._login(True, **WEB)
        self._set_last_activity(token, 60 * 24 * 7)
        self.assertEqual(self._me(token).status_code, 200)

    def test_activity_in_any_tab_keeps_the_shared_session_alive(self) -> None:
        token = self._login(False, **WEB)
        self._set_last_activity(token, 9)
        # Another tab of the same session reports its user's activity.
        response = self.client.post("/api/auth/activity", HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(response.status_code, 200)
        self.assertGreater(response.json()["remainingSeconds"], 9 * 60)
        self.assertEqual(response.json()["idleMinutes"], 10)

    def test_reporting_status_does_not_count_as_activity(self) -> None:
        token = self._login(False, **WEB)
        response = self.client.get("/api/auth/activity", HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["idleLogout"])
        self.assertFalse(SessionActivity.objects.exists())

    def test_expired_session_cannot_revive_itself(self) -> None:
        token = self._login(False, **WEB)
        self._set_last_activity(token, 11)
        response = self.client.post("/api/auth/activity", HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(response.status_code, 401)

    @patch("core.views_api._email_login_alert")
    @patch("core.views_api._send_login_otp_email")
    @patch("core.views_api._otp_mail_ready", return_value=True)
    def test_two_factor_login_keeps_the_idle_limit(self, _mail_ready, _send_otp, _login_alert) -> None:
        User.objects.filter(id=self.admin.id).update(two_factor_enabled=True)
        started = self.client.post(
            "/api/auth/login",
            data={"email": self.admin.email, "password": "ValidPassword1!", "portal": "admin", "rememberMe": False},
            content_type="application/json",
            **WEB,
        )
        self.assertEqual(started.status_code, 202, started.content)
        otp = _stateless_otp_for_bucket(self.admin.email, "staff", "login_2fa", _otp_bucket(timezone.now()))
        verified = self.client.post(
            "/api/auth/login/verify-otp",
            data={"challengeToken": started.json()["challengeToken"], "otp": otp},
            content_type="application/json",
            **WEB,
        )
        self.assertEqual(verified.status_code, 200, verified.content)
        self.assertTrue(decode_token(verified.json()["token"]).get("idleLogout"))


class CustomerIdleLogoutTests(TestCase):
    def test_customers_use_the_default_thirty_minutes(self) -> None:
        customer = Customer.objects.create(email="idle.customer@example.com", password="hashed", name="Idle Customer", is_active=True)
        token = create_token(
            {"userId": customer.id, "email": customer.email, "name": customer.name, "role": "CUSTOMER",
             "type": "customer", "rememberMe": False, "idleLogout": True},
        )
        jti = decode_token(token)["jti"]
        for minutes_ago, expected in [(29, 200), (31, 401)]:
            SessionActivity.objects.update_or_create(
                jti=jti,
                defaults={"last_active_at": timezone.now() - timedelta(minutes=minutes_ago), "expires_at": timezone.now() + timedelta(hours=1)},
            )
            response = self.client.get("/api/auth/me", HTTP_AUTHORIZATION=f"Bearer {token}", HTTP_X_PORTAL="customer")
            self.assertEqual(response.status_code, expected, minutes_ago)


class DriverTrackingKeepsSessionAliveTests(TestCase):
    def test_gps_uploads_count_as_activity(self) -> None:
        driver = User.objects.create(email="idle.driver@example.com", password="hashed", name="Idle Driver", role="DRIVER", is_active=True)
        token = create_token(
            {"userId": driver.id, "email": driver.email, "name": driver.name, "role": "DRIVER",
             "type": "staff", "rememberMe": False, "idleLogout": True},
        )
        jti = decode_token(token)["jti"]
        SessionActivity.objects.create(
            jti=jti, last_active_at=timezone.now() - timedelta(minutes=25), expires_at=timezone.now() + timedelta(hours=1)
        )
        response = self.client.post(
            "/api/driver/location",
            data={"latitude": 10.68, "longitude": 122.95, "accuracy": 10},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
            HTTP_X_PORTAL="driver",
        )
        self.assertEqual(response.status_code, 200, response.content)
        last_active_at = SessionActivity.objects.get(jti=jti).last_active_at
        self.assertLess((timezone.now() - last_active_at).total_seconds(), 60)
