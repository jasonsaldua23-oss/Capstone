import ssl
from django.conf import settings
from django.core.mail.backends.smtp import EmailBackend as SMTPEmailBackend
from django.utils.functional import cached_property


def _as_bool(value: object, default: bool = False) -> bool:
    if value is None:
        return default
    raw = str(value).strip().lower()
    if raw == "":
        return default
    return raw in {"1", "true", "yes", "on"}


class DevTolerantSMTPEmailBackend(SMTPEmailBackend):
    """SMTP backend that can skip TLS cert validation in local development.

    Use only for development/troubleshooting environments.
    """

    @cached_property
    def ssl_context(self):
        skip_verify = _as_bool(
            getattr(settings, "OTP_SMTP_SKIP_TLS_VERIFY", False),
            default=False,
        )
        if skip_verify:
            return ssl._create_unverified_context()
        return super().ssl_context
