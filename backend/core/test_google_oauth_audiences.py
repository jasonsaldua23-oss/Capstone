"""Google login accepts only the explicitly configured OAuth client audiences."""

import base64
import json
from datetime import timedelta

from django.test import SimpleTestCase, override_settings
from django.utils import timezone

from .views_api import _verify_google_token


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
