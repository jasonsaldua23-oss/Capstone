"""Disposable CI database and blocked outbound traffic; never use for serving the app."""

import os
import secrets
import socket
import tempfile
from pathlib import Path

# Fix: CI must not load developer credentials or open a production connection.
os.environ["DOTENV_OVERRIDE"] = "0"
os.environ["DATABASE_URL"] = "postgresql://ci:ci@localhost/ci"
os.environ["DJANGO_SECRET_KEY"] = secrets.token_urlsafe(48)
os.environ["JWT_SECRET"] = secrets.token_urlsafe(48)
os.environ["ENABLE_CORE_DB_ROUTER"] = "0"
os.environ["DJANGO_DEBUG"] = "1"

from .settings import *  # noqa: F403,E402

DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
DATABASE_ROUTERS = []
# SQLite verifies current models, not PostgreSQL migrations or locking.
MIGRATION_MODULES = {"core": None}
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
SUPABASE_URL = SUPABASE_SERVICE_ROLE_KEY = ""
WEB_PUSH_VAPID_PRIVATE_KEY = FCM_SERVICE_ACCOUNT_JSON = FCM_SERVICE_ACCOUNT_FILE = ""
BREVO_API_KEY = GMAIL_API_REFRESH_TOKEN = GMAIL_API_CLIENT_ID = GMAIL_API_CLIENT_SECRET = ""
GMAIL_API_SENDER_EMAIL = OTP_FROM_EMAIL = OTP_SMTP_FROM_EMAIL = ""
_test_media = tempfile.TemporaryDirectory(prefix="capstone-ci-")
MEDIA_ROOT = Path(_test_media.name)


def _block_outbound(*_args, **_kwargs):
    raise OSError("CI outbound network disabled")


socket.socket.connect = _block_outbound
socket.socket.connect_ex = _block_outbound
