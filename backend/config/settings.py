import os
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse, urlunparse

try:
    import certifi
except Exception:  # pragma: no cover - fallback when certifi is unavailable
    certifi = None

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent

load_dotenv(REPO_ROOT / ".env")
load_dotenv(BASE_DIR / ".env")

# Ensure Python uses a CA bundle for outbound TLS (SMTP/HTTPS).
# Production default: certifi. Local override: set CUSTOM_CA_BUNDLE explicitly.
custom_ca_bundle = os.getenv("CUSTOM_CA_BUNDLE", "").strip()
if custom_ca_bundle:
    os.environ.setdefault("SSL_CERT_FILE", custom_ca_bundle)
    os.environ.setdefault("REQUESTS_CA_BUNDLE", custom_ca_bundle)
elif certifi is not None:
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
    os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())


def _bool(name: str, default: bool = False) -> bool:
    raw = str(os.getenv(name, str(default))).strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _normalize_db_target(value: str) -> str:
    raw = str(value or "").strip().lower()
    if raw in {"lite", "sqlite", "local", "local_sqlite"}:
        return "lite"
    if raw in {"supa", "supabase", "postgres", "postgresql"}:
        return "supa"
    return ""


def _parse_database_url(url: str) -> dict:
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    options = {
        "sslmode": query.get("sslmode", ["require"])[0],
        "connect_timeout": int(query.get("connect_timeout", ["10"])[0]),
        "gssencmode": query.get("gssencmode", ["disable"])[0],
    }
    if certifi is not None:
        options["sslrootcert"] = certifi.where()
    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": (parsed.path or "").lstrip("/") or "postgres",
        "USER": unquote(parsed.username or ""),
        "PASSWORD": unquote(parsed.password or ""),
        "HOST": parsed.hostname or "",
        "PORT": str(parsed.port or "5432"),
        "CONN_MAX_AGE": int(query.get("conn_max_age", ["0"])[0]),
        "CONN_HEALTH_CHECKS": False,
        "OPTIONS": options,
    }


def _normalize_runtime_database_url(url: str) -> str:
    raw = str(url or "").strip()
    if not raw:
        return ""

    parsed = urlparse(raw)
    hostname = str(parsed.hostname or "").strip().lower()
    port = parsed.port or 0

    # Supabase pooler URLs on 6543 have been intermittently timing out in local
    # Django runs. Normalize them to the working Postgres runtime port.
    if hostname.endswith(".pooler.supabase.com") and port == 6543:
        auth = parsed.username or ""
        if parsed.password:
            auth = f"{auth}:{parsed.password}"
        if auth:
            auth = f"{auth}@"
        netloc = f"{auth}{parsed.hostname}:5432"
        return urlunparse(parsed._replace(netloc=netloc))

    return raw


SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "django-insecure-logistics-dev-key")
DEBUG = _bool("DJANGO_DEBUG", True)

ALLOWED_HOSTS = [h.strip() for h in os.getenv("DJANGO_ALLOWED_HOSTS", "*").split(",") if h.strip()]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "core",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

FORCE_SQLITE = _bool("DJANGO_USE_SQLITE", False)
SHOW_SAMPLE_DATA = _bool("SHOW_SAMPLE_DATA", False)
DATABASE_URL = _normalize_runtime_database_url(os.getenv("DATABASE_URL", ""))
SQLITE_DB_PATH = os.getenv("SQLITE_DB_PATH", "").strip()
APP_DB_TARGET = _normalize_db_target(os.getenv("APP_DB_TARGET", ""))
LOCAL_SQLITE_DB = {
    "ENGINE": "django.db.backends.sqlite3",
    "NAME": SQLITE_DB_PATH or (BASE_DIR / "db.sqlite3"),
}
REMOTE_POSTGRES_DB = _parse_database_url(DATABASE_URL) if DATABASE_URL else None

if APP_DB_TARGET:
    USE_SQLITE_DB = APP_DB_TARGET == "lite"
else:
    USE_SQLITE_DB = FORCE_SQLITE or not REMOTE_POSTGRES_DB

ACTIVE_DB_ALIAS = "local_sqlite" if USE_SQLITE_DB else "supabase"

if USE_SQLITE_DB or not REMOTE_POSTGRES_DB:
    DATABASES = {
        "default": LOCAL_SQLITE_DB,
        "local_sqlite": LOCAL_SQLITE_DB,
    }
    if REMOTE_POSTGRES_DB:
        DATABASES["supabase"] = REMOTE_POSTGRES_DB
else:
    DATABASES = {
        "default": REMOTE_POSTGRES_DB,
        "supabase": REMOTE_POSTGRES_DB,
        "local_sqlite": LOCAL_SQLITE_DB,
    }

AUTH_PASSWORD_VALIDATORS = []

LANGUAGE_CODE = "en-us"
TIME_ZONE = os.getenv("DJANGO_TIME_ZONE", "UTC")
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CORS_ALLOW_ALL_ORIGINS = _bool("DJANGO_CORS_ALLOW_ALL", True)
CORS_ALLOW_CREDENTIALS = True

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ]
}

DATABASE_ROUTERS = ["core.db_router.CoreAppRouter"]

# Gmail-only SMTP for OTP emails
OTP_GMAIL_USER = os.getenv("OTP_GMAIL_USER", "").strip()
OTP_GMAIL_APP_PASSWORD = "".join(os.getenv("OTP_GMAIL_APP_PASSWORD", "").split())
OTP_FROM_NAME = os.getenv("OTP_FROM_NAME", "Ann Ann's Beverages Trading").strip()
OTP_FROM_EMAIL = os.getenv("OTP_FROM_EMAIL", OTP_GMAIL_USER).strip()
OTP_SMTP_SKIP_TLS_VERIFY = _bool("OTP_SMTP_SKIP_TLS_VERIFY", DEBUG)
BREVO_API_KEY = os.getenv("BREVO_API_KEY", "").strip()

EMAIL_BACKEND = "core.mail_backends.DevTolerantSMTPEmailBackend"
EMAIL_HOST = "smtp.gmail.com"
EMAIL_PORT = 587
EMAIL_USE_TLS = True
EMAIL_HOST_USER = OTP_GMAIL_USER
EMAIL_HOST_PASSWORD = OTP_GMAIL_APP_PASSWORD
DEFAULT_FROM_EMAIL = f"{OTP_FROM_NAME} <{OTP_FROM_EMAIL}>" if OTP_FROM_EMAIL else OTP_FROM_NAME
SERVER_EMAIL = DEFAULT_FROM_EMAIL

# Google OAuth (customer registration/login)
GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "").strip()
GOOGLE_OAUTH_CLIENT_SECRET = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
# Dev only: disable SSL verification for Google APIs (fix Windows cert issues)
GOOGLE_OAUTH_SKIP_SSL_VERIFY = _bool("GOOGLE_OAUTH_SKIP_SSL_VERIFY", DEBUG)
