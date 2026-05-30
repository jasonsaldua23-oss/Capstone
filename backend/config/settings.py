import os
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

try:
    import certifi
except Exception:  # pragma: no cover - fallback when certifi is unavailable
    certifi = None

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent

load_dotenv(REPO_ROOT / ".env", override=True)
load_dotenv(BASE_DIR / ".env", override=True)

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


def _csv(name: str) -> list[str]:
    return [value.strip() for value in str(os.getenv(name, "")).split(",") if value.strip()]


def _normalize_db_target(value: str) -> str:
    raw = str(value or "").strip().lower()
    if raw in {"supa", "supabase", "postgres", "postgresql"}:
        return "supa"
    return ""


def _resolve_postgres_sslrootcert(query: dict, sslmode: str) -> str:
    explicit_sslrootcert = unquote(str(query.get("sslrootcert", [""])[0]).strip())
    if explicit_sslrootcert:
        return explicit_sslrootcert

    # Only opt into certificate verification when the connection URL asks for it.
    if sslmode in {"verify-ca", "verify-full"} and certifi is not None:
        return certifi.where()

    return ""


def _parse_database_url(url: str) -> dict:
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    sslmode = str(query.get("sslmode", ["require"])[0]).strip().lower() or "require"
    options = {
        "sslmode": sslmode,
        "connect_timeout": int(query.get("connect_timeout", ["10"])[0]),
        "gssencmode": query.get("gssencmode", ["disable"])[0],
    }
    sslrootcert = _resolve_postgres_sslrootcert(query, sslmode)
    if sslrootcert:
        options["sslrootcert"] = sslrootcert
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
    return raw


SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "django-insecure-logistics-dev-key")
DEBUG = _bool("DJANGO_DEBUG", True)

allowed_hosts = _csv("DJANGO_ALLOWED_HOSTS")
render_external_hostname = str(os.getenv("RENDER_EXTERNAL_HOSTNAME", "")).strip()
if render_external_hostname:
    allowed_hosts.append(render_external_hostname)
allowed_hosts.extend(["localhost", "127.0.0.1"])
if not allowed_hosts:
    allowed_hosts = ["*"] if DEBUG else []
ALLOWED_HOSTS = sorted(set(allowed_hosts))

csrf_trusted_origins = _csv("DJANGO_CSRF_TRUSTED_ORIGINS")
if render_external_hostname:
    csrf_trusted_origins.append(f"https://{render_external_hostname}")
CSRF_TRUSTED_ORIGINS = sorted(set(csrf_trusted_origins))
USE_X_FORWARDED_HOST = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

INSTALLED_APPS = [
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "core",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
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
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

SHOW_SAMPLE_DATA = _bool("SHOW_SAMPLE_DATA", False)
DATABASE_URL = _normalize_runtime_database_url(os.getenv("DATABASE_URL", ""))
APP_DB_TARGET = _normalize_db_target(os.getenv("APP_DB_TARGET", ""))
REMOTE_POSTGRES_DB = _parse_database_url(DATABASE_URL) if DATABASE_URL else None

if APP_DB_TARGET and APP_DB_TARGET != "supa":
    raise RuntimeError("Only Supabase/Postgres is supported. Set APP_DB_TARGET=supa or remove it.")

if not REMOTE_POSTGRES_DB:
    raise RuntimeError("DATABASE_URL is required. SQLite fallback has been removed.")

ACTIVE_DB_ALIAS = "supabase"
DATABASES = {
    "default": REMOTE_POSTGRES_DB,
    "supabase": REMOTE_POSTGRES_DB,
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
OTP_SMTP_FROM_EMAIL = os.getenv("OTP_SMTP_FROM_EMAIL", OTP_GMAIL_USER or OTP_FROM_EMAIL).strip()
OTP_SMTP_SKIP_TLS_VERIFY = _bool("OTP_SMTP_SKIP_TLS_VERIFY", DEBUG)
BREVO_API_KEY = os.getenv("BREVO_API_KEY", "").strip()

EMAIL_BACKEND = "core.mail_backends.DevTolerantSMTPEmailBackend"
EMAIL_HOST = "smtp.gmail.com"
EMAIL_PORT = 587
EMAIL_USE_TLS = True
EMAIL_HOST_USER = OTP_GMAIL_USER
EMAIL_HOST_PASSWORD = OTP_GMAIL_APP_PASSWORD
DEFAULT_FROM_EMAIL = f"{OTP_FROM_NAME} <{OTP_FROM_EMAIL}>" if OTP_FROM_EMAIL else OTP_FROM_NAME
if OTP_SMTP_FROM_EMAIL:
    DEFAULT_FROM_EMAIL = f"{OTP_FROM_NAME} <{OTP_SMTP_FROM_EMAIL}>"
SERVER_EMAIL = DEFAULT_FROM_EMAIL

# Google OAuth (customer registration/login)
GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "").strip()
GOOGLE_OAUTH_CLIENT_SECRET = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
# Dev only: disable SSL verification for Google APIs (fix Windows cert issues)
GOOGLE_OAUTH_SKIP_SSL_VERIFY = _bool("GOOGLE_OAUTH_SKIP_SSL_VERIFY", DEBUG)
