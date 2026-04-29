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

load_dotenv(REPO_ROOT / ".env")
load_dotenv(BASE_DIR / ".env")

# Ensure Python uses an up-to-date CA bundle for outbound TLS (SMTP/HTTPS).
if certifi is not None:
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
    os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())


def _bool(name: str, default: bool = False) -> bool:
    raw = str(os.getenv(name, str(default))).strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _parse_database_url(url: str) -> dict:
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": (parsed.path or "").lstrip("/") or "postgres",
        "USER": unquote(parsed.username or ""),
        "PASSWORD": unquote(parsed.password or ""),
        "HOST": parsed.hostname or "",
        "PORT": str(parsed.port or "5432"),
        "CONN_MAX_AGE": int(query.get("conn_max_age", ["0"])[0]),
        "CONN_HEALTH_CHECKS": False,
        "OPTIONS": {
            "sslmode": query.get("sslmode", ["require"])[0],
            "connect_timeout": int(query.get("connect_timeout", ["10"])[0]),
        },
    }


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
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
SQLITE_DB_PATH = os.getenv("SQLITE_DB_PATH", "").strip()
LOCAL_SQLITE_DB = {
    "ENGINE": "django.db.backends.sqlite3",
    "NAME": SQLITE_DB_PATH or (BASE_DIR / "db.sqlite3"),
}
REMOTE_POSTGRES_DB = _parse_database_url(DATABASE_URL) if DATABASE_URL else None

if FORCE_SQLITE or not REMOTE_POSTGRES_DB:
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
OTP_SMTP_SKIP_TLS_VERIFY = _bool("OTP_SMTP_SKIP_TLS_VERIFY", DEBUG)

EMAIL_BACKEND = "core.mail_backends.DevTolerantSMTPEmailBackend"
EMAIL_HOST = "smtp.gmail.com"
EMAIL_PORT = 587
EMAIL_USE_TLS = True
EMAIL_HOST_USER = OTP_GMAIL_USER
EMAIL_HOST_PASSWORD = OTP_GMAIL_APP_PASSWORD
DEFAULT_FROM_EMAIL = f"{OTP_FROM_NAME} <{OTP_GMAIL_USER}>" if OTP_GMAIL_USER else OTP_FROM_NAME
SERVER_EMAIL = DEFAULT_FROM_EMAIL

# Google OAuth (customer registration/login)
GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "").strip()
GOOGLE_OAUTH_CLIENT_SECRET = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()

# PayMongo (test/sandbox or live, depending on keys)
PAYMONGO_ENABLE_CHECKOUT = _bool("PAYMONGO_ENABLE_CHECKOUT", False)
PAYMONGO_SECRET_KEY = os.getenv("PAYMONGO_SECRET_KEY", "").strip()
PAYMONGO_PUBLIC_KEY = os.getenv("PAYMONGO_PUBLIC_KEY", "").strip()
PAYMONGO_PAYMENT_METHOD_TYPES = os.getenv("PAYMONGO_PAYMENT_METHOD_TYPES", "gcash,paymaya,card").strip()
PAYMONGO_SUCCESS_URL = os.getenv("PAYMONGO_SUCCESS_URL", "").strip()
PAYMONGO_CANCEL_URL = os.getenv("PAYMONGO_CANCEL_URL", "").strip()
PAYMONGO_WEBHOOK_SECRET = os.getenv("PAYMONGO_WEBHOOK_SECRET", "").strip()
