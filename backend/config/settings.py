"""Django settings for MMH backend — environment-driven (development | staging | production)."""

from __future__ import annotations

import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

DJANGO_ENV = os.getenv("DJANGO_ENV", "development").lower().strip()
IS_PRODUCTION = DJANGO_ENV in {"prod", "production"}
IS_STAGING = DJANGO_ENV in {"staging", "stage"}
IS_DEVELOPMENT = not IS_PRODUCTION and not IS_STAGING


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.lower() in {"1", "true", "yes", "on"}


# ---------------------------------------------------------------------------
# Core secrets / debug
# ---------------------------------------------------------------------------

SECRET_KEY = os.getenv("SECRET_KEY") or os.getenv("DJANGO_SECRET_KEY") or ""
if not SECRET_KEY:
    if IS_PRODUCTION:
        raise RuntimeError("SECRET_KEY (or DJANGO_SECRET_KEY) must be set when DJANGO_ENV=production")
    SECRET_KEY = "dev-only-change-me-mmh-backend"

DEBUG = _env_bool("DEBUG", default=IS_DEVELOPMENT)
if IS_PRODUCTION and DEBUG:
    raise RuntimeError("DEBUG must be false when DJANGO_ENV=production")

ALLOWED_HOSTS = [h.strip() for h in os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h.strip()]
if IS_PRODUCTION and (not ALLOWED_HOSTS or ALLOWED_HOSTS == ["*"]):
    raise RuntimeError("ALLOWED_HOSTS must be set explicitly for production")

# Demo auto-pay: ONLY for local/dev demos. Hard-blocked in production via checks + runtime.
ALLOW_DEMO_AUTO_PAYMENT = _env_bool("ALLOW_DEMO_AUTO_PAYMENT", default=IS_DEVELOPMENT)
if IS_PRODUCTION and ALLOW_DEMO_AUTO_PAYMENT:
    raise RuntimeError(
        "ALLOW_DEMO_AUTO_PAYMENT cannot be true when DJANGO_ENV=production. "
        "Real payment integration must verify payment server-side before fulfilling orders."
    )

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "django_filters",
    "rest_framework",
    "rest_framework_simplejwt",
    "accounts",
    "catalog",
    "commerce",
    "cms",
    "suppliers",
    "audit",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "config.middleware.RequestIdMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

_db_options = {}
_sslmode = os.getenv("POSTGRES_SSLMODE", "require" if IS_PRODUCTION else "").strip()
if _sslmode:
    _db_options["sslmode"] = _sslmode

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("POSTGRES_DB", "mmh"),
        "USER": os.getenv("POSTGRES_USER", "mmh"),
        "PASSWORD": os.getenv("POSTGRES_PASSWORD", "mmh_dev_only" if IS_DEVELOPMENT else ""),
        "HOST": os.getenv("POSTGRES_HOST", "127.0.0.1"),
        "PORT": os.getenv("POSTGRES_PORT", "5432"),
        "CONN_MAX_AGE": int(os.getenv("POSTGRES_CONN_MAX_AGE", "60" if IS_PRODUCTION else "0")),
        "OPTIONS": _db_options,
    }
}
if IS_PRODUCTION and not os.getenv("POSTGRES_PASSWORD"):
    raise RuntimeError("POSTGRES_PASSWORD must be set when DJANGO_ENV=production")

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CORS_ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:3001,http://127.0.0.1:3001",
    ).split(",")
    if o.strip()
]
CORS_ALLOW_CREDENTIALS = True
if IS_PRODUCTION and not CORS_ALLOWED_ORIGINS:
    raise RuntimeError("CORS_ALLOWED_ORIGINS must be set for production")

CSRF_TRUSTED_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CSRF_TRUSTED_ORIGINS",
        "http://localhost:3001,http://127.0.0.1:3001",
    ).split(",")
    if o.strip()
]

# HTTPS / cookies — enabled for production & staging; local HTTP remains usable in development
if IS_PRODUCTION or IS_STAGING:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SESSION_COOKIE_HTTPONLY = True
    CSRF_COOKIE_HTTPONLY = False
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = _env_bool("SECURE_SSL_REDIRECT", default=IS_PRODUCTION)
    SECURE_HSTS_SECONDS = int(os.getenv("SECURE_HSTS_SECONDS", "31536000" if IS_PRODUCTION else "0"))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = IS_PRODUCTION
    SECURE_HSTS_PRELOAD = IS_PRODUCTION
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_REFERRER_POLICY = "same-origin"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.AllowAny",),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_PAGINATION_CLASS": "config.pagination.BoundedPageNumberPagination",
    "PAGE_SIZE": 24,
    "EXCEPTION_HANDLER": "config.exceptions.api_exception_handler",
}

# Local filesystem media by default; production should use a persistent volume or S3-compatible backend.
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"
        if (IS_PRODUCTION or IS_STAGING)
        else "django.contrib.staticfiles.storage.StaticFilesStorage",
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=int(os.getenv("JWT_ACCESS_HOURS", "8"))),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=int(os.getenv("JWT_REFRESH_DAYS", "7"))),
    "ROTATE_REFRESH_TOKENS": False,
    "AUTH_HEADER_TYPES": ("Bearer",),
}

CODE_ENCRYPTION_KEY = os.getenv("CODE_ENCRYPTION_KEY", "").strip()
if IS_PRODUCTION:
    if len(CODE_ENCRYPTION_KEY) != 64:
        raise RuntimeError(
            "CODE_ENCRYPTION_KEY must be a 64-character hex string in production "
            "(generate with: openssl rand -hex 32). Losing this key makes stored codes undecryptable."
        )

SUPPLIER_MODE = os.getenv("SUPPLIER_MODE", "mock").lower()
ONEEPIN_MODE = os.getenv("ONEEPIN_MODE", "test").lower()
ONEEPIN_TEST_BASE_URL = os.getenv("ONEEPIN_TEST_BASE_URL", "https://www.1epin.com/api/test/")
ONEEPIN_LIVE_BASE_URL = os.getenv("ONEEPIN_LIVE_BASE_URL", "https://www.1epin.com/api/live/")
ONEEPIN_EMAIL = os.getenv("ONEEPIN_EMAIL", "")
ONEEPIN_PASSWORD = os.getenv("ONEEPIN_PASSWORD", "")
ONEEPIN_CALLBACK_TOKEN = os.getenv("ONEEPIN_CALLBACK_TOKEN", "")
ONEEPIN_RECONCILE_TOKEN = os.getenv("ONEEPIN_RECONCILE_TOKEN", "")
ONEEPIN_ALLOW_LIVE = _env_bool("ONEEPIN_ALLOW_LIVE", default=False)
ONEEPIN_REQUEST_TIMEOUT_MS = int(os.getenv("ONEEPIN_REQUEST_TIMEOUT_MS", "15000"))

# PayPal Orders v2. The client secret stays on the server.
# Orders are priced in JOD (fils). PAYPAL_CURRENCY is the business-account
# settlement currency. When it differs from JOD, PAYPAL_FX_RATE is the number
# of PayPal major units per 1 JOD, applied only on the server.
_paypal_env = os.getenv("PAYPAL_ENV", "sandbox").strip().lower()
PAYPAL_ENV = _paypal_env if _paypal_env in {"sandbox", "live"} else "sandbox"
PAYPAL_CLIENT_ID = os.getenv("PAYPAL_CLIENT_ID", "").strip()
PAYPAL_CLIENT_SECRET = os.getenv("PAYPAL_CLIENT_SECRET", "").strip()
PAYPAL_WEBHOOK_ID = os.getenv("PAYPAL_WEBHOOK_ID", "").strip()
PAYPAL_CURRENCY = (os.getenv("PAYPAL_CURRENCY", "USD").strip().upper() or "USD")
PAYPAL_FX_RATE = os.getenv("PAYPAL_FX_RATE", "").strip()
PAYPAL_BRAND_NAME = os.getenv("PAYPAL_BRAND_NAME", "MMH").strip() or "MMH"
PAYPAL_TIMEOUT_SECONDS = float(os.getenv("PAYPAL_TIMEOUT_SECONDS", "20"))

# Live OneEpin remains locked until payment + fulfillment go-live is explicitly approved.
if IS_PRODUCTION and (ONEEPIN_ALLOW_LIVE or SUPPLIER_MODE == "live"):
    raise RuntimeError(
        "OneEpin live purchasing is locked for production until payment integration and "
        "fulfillment idempotency are complete. Keep ONEEPIN_ALLOW_LIVE=false and SUPPLIER_MODE=mock|test."
    )

# Bootstrap admin — no default password in production; seed refuses insecure defaults.
BOOTSTRAP_ADMIN_EMAIL = os.getenv("BOOTSTRAP_ADMIN_EMAIL", "admin@mmh.local" if IS_DEVELOPMENT else "")
BOOTSTRAP_ADMIN_PASSWORD = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "AdminChangeMe1!" if IS_DEVELOPMENT else "")
SEED_DEMO_CUSTOMER = _env_bool("SEED_DEMO_CUSTOMER", default=IS_DEVELOPMENT)

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {
        "request_id": {
            "()": "config.logging_filters.RequestIdFilter",
        },
    },
    "formatters": {
        "standard": {
            "format": "%(asctime)s %(levelname)s [%(name)s] [req=%(request_id)s] %(message)s",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "filters": ["request_id"],
            "formatter": "standard",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": os.getenv("LOG_LEVEL", "INFO" if IS_PRODUCTION else "DEBUG"),
    },
    "loggers": {
        "django.request": {"handlers": ["console"], "level": "WARNING", "propagate": False},
        "commerce": {"handlers": ["console"], "level": "INFO", "propagate": False},
        "suppliers": {"handlers": ["console"], "level": "INFO", "propagate": False},
    },
}

# Load Django system checks (production launch guards).
import config.checks  # noqa: E402, F401
