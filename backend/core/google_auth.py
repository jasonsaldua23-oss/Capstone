"""Google identity token verification for staff and customer sign-in."""

import base64
import json
import os
from typing import Any

from django.conf import settings
from django.utils import timezone
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token


def _verify_google_token(credential: str) -> dict[str, Any]:
    client_ids = list(getattr(settings, "GOOGLE_OAUTH_CLIENT_IDS", []) or [])
    primary_client_id = str(getattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "") or "").strip()
    if primary_client_id and primary_client_id not in client_ids:
        client_ids.insert(0, primary_client_id)
    if not client_ids:
        raise ValueError("Google OAuth is not configured")
    skip_ssl_verify = bool(getattr(settings, "GOOGLE_OAUTH_SKIP_SSL_VERIFY", getattr(settings, "DEBUG", False)))

    if skip_ssl_verify and getattr(settings, "DEBUG", False):
        # Local-dev fallback: avoid remote cert fetch when host SSL trust chain is broken.
        parts = credential.split(".")
        if len(parts) != 3:
            raise ValueError("Malformed Google credential")
        payload_part = parts[1]
        payload_part += "=" * ((4 - len(payload_part) % 4) % 4)
        try:
            claims = json.loads(base64.urlsafe_b64decode(payload_part.encode("ascii")).decode("utf-8"))
        except Exception as exc:
            raise ValueError(f"Malformed Google credential payload: {exc}")

        # Fix: accept tokens from every explicitly configured web/mobile OAuth
        # client while continuing to reject tokens minted for unrelated apps.
        if str(claims.get("aud") or "") not in client_ids:
            raise ValueError("Google token audience mismatch")
        if str(claims.get("iss") or "") not in {"accounts.google.com", "https://accounts.google.com"}:
            raise ValueError("Google token issuer is invalid")
        exp_raw = claims.get("exp")
        if exp_raw is not None:
            try:
                exp = int(exp_raw)
                now_ts = int(timezone.now().timestamp())
                if exp < now_ts - 300:
                    raise ValueError("Google token is expired")
            except ValueError:
                raise
            except Exception:
                raise ValueError("Google token exp is invalid")
        return claims

    # Allow small server/client clock drift to avoid false "Token used too early" failures.
    import requests as _requests
    session = _requests.Session()
    if os.name == "nt" and getattr(settings, "DEBUG", False):
        # Windows local-dev hard override: trust chain issues are common and block Google cert fetch.
        session.verify = False
    elif skip_ssl_verify and getattr(settings, "DEBUG", False):
        session.verify = False
    else:
        ca_bundle = os.getenv("REQUESTS_CA_BUNDLE", "").strip()
        session.verify = ca_bundle or True
    request = google_requests.Request(session)
    return google_id_token.verify_oauth2_token(
        credential,
        request,
        client_ids,
        clock_skew_in_seconds=300,
    )
