"""Outbound email transports: Gmail API, Brevo, and the SMTP fallback."""

import base64
import logging
import threading
from datetime import time
from pathlib import Path
from time import monotonic
from typing import Any

import requests
from django.conf import settings
from django.core.mail import send_mail
from django.db import close_old_connections

from . import views_api as legacy
from .email_templates import EmailBody
from .models import Order

logger = logging.getLogger(__name__)

_GMAIL_API_TOKEN_CACHE = {"token": "", "expires_at": 0.0}

_GMAIL_API_COOLDOWN_SECONDS = 300

_gmail_api_disabled_until = 0.0

_BREVO_COOLDOWN_SECONDS = 300

_brevo_disabled_until = 0.0

_sender_identity_checked = False


# Helpers owned by sibling modules. Routing them through views_api keeps
# a single resolution point, so tests that patch there still apply.


def _email_public_url(path: Any) -> str:
    return legacy._email_public_url(path)


def _normalize_email(value: Any) -> str:
    return legacy._normalize_email(value)


def _render_email_parts(body: EmailBody, *, heading: str, preheader: str='') -> tuple[str, str]:
    return legacy._render_email_parts(body, heading=heading, preheader=preheader)


def _get_gmail_api_access_token() -> str:
    import time
    now = time.time()
    if _GMAIL_API_TOKEN_CACHE["token"] and _GMAIL_API_TOKEN_CACHE["expires_at"] > now + 60:
        return _GMAIL_API_TOKEN_CACHE["token"]

    refresh_token = str(getattr(settings, "GMAIL_API_REFRESH_TOKEN", "") or "").strip()
    client_id = str(getattr(settings, "GMAIL_API_CLIENT_ID", "") or getattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "") or "").strip()
    client_secret = str(getattr(settings, "GMAIL_API_CLIENT_SECRET", "") or getattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", "") or "").strip()

    if not refresh_token or not client_id or not client_secret:
        return ""

    try:
        resp = requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        token = data.get("access_token", "")
        expires_in = int(data.get("expires_in", 3600))
        if token:
            _GMAIL_API_TOKEN_CACHE["token"] = token
            _GMAIL_API_TOKEN_CACHE["expires_at"] = now + expires_in
            return token
    except Exception:
        logger.exception("Failed to refresh Gmail API access token")
    return ""


def _send_via_gmail_api(*, subject: str, message: str, recipient: str, html_message: str | None = None) -> bool:
    from email.mime.multipart import MIMEMultipart
    from email.mime.image import MIMEImage
    from email.mime.text import MIMEText
    from email.utils import formatdate, make_msgid
    token = _get_gmail_api_access_token()
    if not token:
        return False

    from_email = str(getattr(settings, "GMAIL_API_SENDER_EMAIL", "") or getattr(settings, "OTP_FROM_EMAIL", "") or getattr(settings, "OTP_GMAIL_USER", "") or "").strip()
    from_name = str(getattr(settings, "OTP_FROM_NAME", "Ann Ann's Beverages Trading") or "Ann Ann's Beverages Trading").strip()

    # Send multipart email so modern clients show the branded design while plain text remains available.
    msg = MIMEMultipart("related")
    alternatives = MIMEMultipart("alternative")
    alternatives.attach(MIMEText(message, "plain", "utf-8"))
    if html_message:
        public_logo_url = _email_public_url("/email-assets/ann-anns-logo.png")
        logo_path = Path(settings.BASE_DIR).parent / "public" / "ann-anns-logo.png"
        resolved_html = html_message
        if public_logo_url and logo_path.is_file():
            # Embed the real system logo so Gmail does not need access to a local server URL.
            resolved_html = resolved_html.replace(public_logo_url, "cid:ann-anns-logo")
        alternatives.attach(MIMEText(resolved_html, "html", "utf-8"))
        msg.attach(alternatives)
        if public_logo_url and logo_path.is_file():
            logo_image = MIMEImage(logo_path.read_bytes(), _subtype="png")
            logo_image.add_header("Content-ID", "<ann-anns-logo>")
            logo_image.add_header("Content-Disposition", "inline", filename="ann-anns-logo.png")
            msg.attach(logo_image)
    else:
        msg.attach(alternatives)
    msg["To"] = recipient
    msg["From"] = f"{from_name} <{from_email}>" if from_email else from_name
    msg["Subject"] = subject
    # RFC-required headers — missing Message-ID is a top spam trigger for raw MIME via Gmail API.
    email_domain = from_email.split("@")[-1] if "@" in from_email else "gmail.com"
    msg["Message-ID"] = make_msgid(domain=email_domain)
    msg["Date"] = formatdate(localtime=True)
    msg["Reply-To"] = f"{from_name} <{from_email}>" if from_email else from_name
    msg["MIME-Version"] = "1.0"

    raw_message = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")

    resp = requests.post(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={"raw": raw_message},
        timeout=20,
    )
    resp.raise_for_status()
    return True


def _otp_mail_ready() -> bool:
    has_gmail_api = bool(
        getattr(settings, "GMAIL_API_REFRESH_TOKEN", "") and
        (getattr(settings, "GMAIL_API_CLIENT_ID", "") or getattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "")) and
        (getattr(settings, "GMAIL_API_CLIENT_SECRET", "") or getattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", ""))
    )
    has_brevo = bool(getattr(settings, "BREVO_API_KEY", "") and getattr(settings, "OTP_FROM_EMAIL", ""))
    has_gmail = bool(getattr(settings, "OTP_GMAIL_USER", "") and getattr(settings, "OTP_GMAIL_APP_PASSWORD", ""))
    return bool(has_gmail_api or has_brevo or has_gmail)


def _gmail_api_available() -> bool:
    return monotonic() >= _gmail_api_disabled_until


def _mark_gmail_api_failed() -> None:
    global _gmail_api_disabled_until
    _gmail_api_disabled_until = monotonic() + _GMAIL_API_COOLDOWN_SECONDS


class BrevoUnavailable(RuntimeError):
    """Brevo is known-bad right now; callers should fall through to SMTP."""


def _send_via_brevo(*, subject: str, message: str, recipient: str, html_message: str | None = None) -> bool:
    global _brevo_disabled_until

    api_key = str(getattr(settings, "BREVO_API_KEY", "") or "").strip()
    from_email = str(getattr(settings, "OTP_FROM_EMAIL", "") or "").strip()
    from_name = str(getattr(settings, "OTP_FROM_NAME", "Ann Ann's Beverages Trading") or "Ann Ann's Beverages Trading").strip()
    if not api_key or not from_email:
        raise BrevoUnavailable("Brevo is not configured")

    now = monotonic()
    if now < _brevo_disabled_until:
        raise BrevoUnavailable(
            f"Brevo skipped; retrying in {int(_brevo_disabled_until - now)}s after a recent failure"
        )

    try:
        return _brevo_post(
            api_key=api_key,
            from_name=from_name,
            from_email=from_email,
            subject=subject,
            message=message,
            recipient=recipient,
            html_message=html_message,
        )
    except Exception:
        _brevo_disabled_until = monotonic() + _BREVO_COOLDOWN_SECONDS
        raise


def _brevo_post(
    *,
    api_key: str,
    from_name: str,
    from_email: str,
    subject: str,
    message: str,
    recipient: str,
    html_message: str | None,
) -> bool:
    response = requests.post(
        "https://api.brevo.com/v3/smtp/email",
        headers={
            "accept": "application/json",
            "content-type": "application/json",
            "api-key": api_key,
        },
        json={
            "sender": {"name": from_name, "email": from_email},
            "to": [{"email": recipient}],
            "subject": subject,
            "textContent": message,
            "htmlContent": html_message or None,
        },
        timeout=20,
    )
    response.raise_for_status()
    return True


def _warn_on_mismatched_sender_identity() -> None:
    """Warn once when the transports would send from different From addresses.

    Receiving providers weigh a consistent sender identity heavily. Gmail API,
    Brevo and SMTP each read their own setting, so a half-configured environment
    silently alternates between addresses and pushes mail towards spam.
    """
    global _sender_identity_checked
    if _sender_identity_checked:
        return
    _sender_identity_checked = True
    addresses = {
        "GMAIL_API_SENDER_EMAIL": _normalize_email(getattr(settings, "GMAIL_API_SENDER_EMAIL", "")),
        "OTP_FROM_EMAIL": _normalize_email(getattr(settings, "OTP_FROM_EMAIL", "")),
        "OTP_SMTP_FROM_EMAIL": _normalize_email(getattr(settings, "OTP_SMTP_FROM_EMAIL", "")),
    }
    configured = {name: value for name, value in addresses.items() if value}
    if len(set(configured.values())) > 1:
        logger.warning(
            "Outgoing mail is configured with more than one sender address (%s). "
            "Point these settings at the same mailbox so recipients and spam filters "
            "always see one sender.",
            ", ".join(f"{name}={value}" for name, value in sorted(configured.items())),
        )


def _dispatch_email(*, subject: str, text: str, html: str, recipient: str) -> None:
    """Send one message through the first transport that is configured and healthy."""
    _warn_on_mismatched_sender_identity()
    gmail_refresh = str(getattr(settings, "GMAIL_API_REFRESH_TOKEN", "") or "").strip()
    if gmail_refresh and _gmail_api_available():
        try:
            if _send_via_gmail_api(subject=subject, message=text, recipient=recipient, html_message=html):
                return
        except Exception:
            _mark_gmail_api_failed()
            logger.exception("Gmail API send failed for %s; falling back", recipient)

    if str(getattr(settings, "BREVO_API_KEY", "") or "").strip():
        try:
            if _send_via_brevo(subject=subject, message=text, recipient=recipient, html_message=html):
                return
        except Exception:
            logger.exception("Brevo send failed for %s; falling back to SMTP", recipient)

    send_mail(
        subject=subject,
        message=text,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[recipient],
        fail_silently=False,
        html_message=html,
    )


def _start_email_delivery(deliver) -> None:
    """Run outbound email I/O without holding the originating API response open.

    Why a thread and not an inline call: every transport below is a network round
    trip with a multi-second timeout (Gmail token 15s + send 20s, then Brevo 20s,
    then SMTP), and they are tried in order. A staff sign-in measured 28s end to
    end, virtually all of it the login-alert email, because the response was fully
    built and then made to wait for delivery. Gunicorn runs gthread, so a parked
    thread does not stall the process, but the pool is still bounded and no caller
    should buy an email send with its own latency.

    Safe by contract: `_send_transactional_email` already logged and swallowed
    per-recipient failures, so no caller ever observed a delivery result.
    """

    def run_with_fresh_connection() -> None:
        # Gunicorn request threads must not leak their database connection into this
        # background thread; Django opens a thread-local connection on demand.
        close_old_connections()
        try:
            deliver()
        finally:
            close_old_connections()

    threading.Thread(
        target=run_with_fresh_connection,
        name="transactional-email",
        daemon=True,
    ).start()


def _send_transactional_email(
    *,
    subject: str,
    message: str,
    recipients: list[str],
    order: Order | None = None,
    html_message: str | None = None,
) -> None:
    """Deliver one message to every recipient, never raising into the request.

    This stays the single delivery point for the whole system: the structured
    senders below render their parts and hand them here.
    """
    cleaned = [str(x or "").strip().lower() for x in recipients if str(x or "").strip()]
    if not cleaned:
        return
    if html_message is None:
        # Legacy callers pass plain text only; give it the standard shell. Rendering
        # stays on the request thread so a template error still surfaces to the caller
        # rather than only in a worker log.
        body = EmailBody(paragraphs=[line for line in str(message or "").split("\n\n") if line.strip()])
        heading = subject.split(" - ")[-1].strip() or subject
        message, html_message = _render_email_parts(body, heading=heading)

    text_body, html_body = message, html_message

    def deliver() -> None:
        for recipient in cleaned:
            try:
                _dispatch_email(subject=subject, text=text_body, html=html_body, recipient=recipient)
            except Exception:
                logger.exception("Failed to send email: subject=%s recipient=%s", subject, recipient)

    _start_email_delivery(deliver)
