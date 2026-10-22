"""Django settings for MMH backend — environment-driven (development | staging | production)."""

from __future__ import annotations

import logging
import os
import sys
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

from config.env import (
    email_settings,
    env_bool,
    normalize_env,
    resolve_code_encryption_key,
    resolve_secret_key,
)

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

DJANGO_ENV = normalize_env(os.getenv("DJANGO_ENV"))
IS_PRODUCTION = DJANGO_ENV == "production"
IS_STAGING = DJANGO_ENV == "staging"
IS_DEVELOPMENT = not IS_PRODUCTION and not IS_STAGING
IS_DEPLOYED = IS_PRODUCTION or IS_STAGING
TESTING = len(sys.argv) > 1 and sys.argv[1] == "test"


def _env_bool(name: str, default: bool = False) -> bool:
    return env_bool(os.environ, name, default)


# ---------------------------------------------------------------------------
# Core secrets / debug
# ---------------------------------------------------------------------------

# Required in staging and production (raises at startup when missing).
SECRET_KEY = resolve_secret_key(DJANGO_ENV, os.environ)

DEBUG = _env_bool("DEBUG", default=IS_DEVELOPMENT)
if IS_PRODUCTION and DEBUG:
    raise RuntimeError("DEBUG must be false when DJANGO_ENV=production")

ALLOWED_HOSTS = [h.strip() for h in os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h.strip()]
if IS_PRODUCTION and (not ALLOWED_HOSTS or ALLOWED_HOSTS == ["*"]):
    raise RuntimeError("ALLOWED_HOSTS must be set explicitly for production")

# Demo auto-pay: opt-in for local demos only. Off by default so storefront orders stay PENDING,
# matching the "no payment provider connected" checkout copy. Hard-blocked in production.
ALLOW_DEMO_AUTO_PAYMENT = _env_bool("ALLOW_DEMO_AUTO_PAYMENT", default=False)
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
    "rest_framework_simplejwt.token_blacklist",
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
# Point at a persistent volume in deployed environments, e.g. MEDIA_ROOT=/data/media on Railway.
MEDIA_ROOT = Path(os.getenv("MEDIA_ROOT") or (BASE_DIR / "media"))
# Uploaded media is served by Django in every environment (config.media.serve_media).
MEDIA_CACHE_SECONDS = int(os.getenv("MEDIA_CACHE_SECONDS", str(60 * 60 * 24 * 30)))

# Public storefront origin used in emails (password reset links, etc.).
SITE_URL = (os.getenv("SITE_URL") or "https://www.mmhcard.com").strip().rstrip("/")
SUPPORT_EMAIL = os.getenv("SUPPORT_EMAIL", "").strip()

# Email: SMTP when EMAIL_HOST is set, otherwise console output.
_email = email_settings(os.environ)
EMAIL_CONFIGURED = _email.pop("EMAIL_CONFIGURED")
globals().update(_email)

# /django-admin/ is only mounted when enabled (default: development only).
DJANGO_ADMIN_ENABLED = _env_bool("DJANGO_ADMIN_ENABLED", default=IS_DEVELOPMENT)

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

# HTTPS / cookies — staging is hardened exactly like production; local HTTP stays usable in development.
if IS_DEPLOYED:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SESSION_COOKIE_HTTPONLY = True
    CSRF_COOKIE_HTTPONLY = False
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = _env_bool("SECURE_SSL_REDIRECT", default=True)
    # Platform health checks hit the container over plain HTTP.
    SECURE_REDIRECT_EXEMPT = [r"^health/$", r"^api/health/$", r"^api/ready/$"]
    SECURE_HSTS_SECONDS = int(os.getenv("SECURE_HSTS_SECONDS", "31536000"))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = _env_bool("SECURE_HSTS_PRELOAD", default=False)
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_REFERRER_POLICY = "same-origin"

# Shared cache so throttle counters hold across gunicorn workers/containers.
# The entrypoint runs `manage.py createcachetable` before starting.
if TESTING:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "mmh-tests"}}
else:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.db.DatabaseCache",
            "LOCATION": "django_cache",
            "TIMEOUT": 300,
            "OPTIONS": {"MAX_ENTRIES": 20000},
        }
    }


def _rate(name: str, default: str | None) -> str | None:
    """Throttle rate from env THROTTLE_<NAME>_RATE; an empty value disables that limit."""
    raw = os.getenv(f"THROTTLE_{name.upper()}_RATE")
    value = default if raw is None else (raw.strip() or None)
    if TESTING and value is not None:
        # The suite sends many requests from one client; throttle tests patch tiny rates explicitly.
        return "100000/min"
    return value


THROTTLE_RATES = {
    # Anonymous writes (POST/PUT/PATCH/DELETE) per client IP.
    "anon": _rate("anon", "120/min"),
    # Anonymous reads. Off by default: the storefront renders server-side from shared
    # Vercel egress IPs, so a per-IP read cap would throttle every visitor at once.
    "anon_read": _rate("anon_read", None),
    "user": _rate("user", "300/min"),
    "login": _rate("login", "10/min"),
    "register": _rate("register", "5/hour"),
    "password_reset": _rate("password_reset", "5/hour"),
    "password_reset_confirm": _rate("password_reset_confirm", "20/hour"),
    "token_refresh": _rate("token_refresh", "60/min"),
    "logout": _rate("logout", "30/min"),
    "coupon": _rate("coupon", "20/min"),
    "checkout": _rate("checkout", "30/hour"),
    "order_lookup": _rate("order_lookup", "30/min"),
    "code_reveal": _rate("code_reveal", "20/hour"),
    "paypal": _rate("paypal", "60/hour"),
    "contact": _rate("contact", "10/hour"),
    "supplier_callback": _rate("supplier_callback", "120/min"),
}

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        # Rejects disabled/inactive users on every request, not only at login.
        "accounts.authentication.ActiveUserJWTAuthentication",
    ),
    "DEFAULT_THROTTLE_CLASSES": (
        "config.throttling.AnonWriteRateThrottle",
        "config.throttling.AnonReadRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
        "rest_framework.throttling.ScopedRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": THROTTLE_RATES,
    # Trusted reverse proxies in front of gunicorn (Railway edge = 1) so the client IP
    # comes from X-Forwarded-For instead of the proxy address.
    "NUM_PROXIES": int(os.environ["DRF_NUM_PROXIES"]) if os.getenv("DRF_NUM_PROXIES") else (1 if IS_DEPLOYED else None),
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
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_AUTHENTICATION_RULE": "accounts.authentication.user_can_authenticate",
}

# Required (64 hex chars) in staging and production.
CODE_ENCRYPTION_KEY = resolve_code_encryption_key(DJANGO_ENV, os.environ)

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
        "accounts": {"handlers": ["console"], "level": "INFO", "propagate": False},
        "config": {"handlers": ["console"], "level": "INFO", "propagate": False},
    },
}

# Sentry error reporting — only when SENTRY_DSN is set.
SENTRY_DSN = os.getenv("SENTRY_DSN", "").strip()
if SENTRY_DSN and not TESTING:
    import sentry_sdk
    from sentry_sdk.integrations.django import DjangoIntegration

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        integrations=[DjangoIntegration()],
        environment=DJANGO_ENV,
        send_default_pii=False,
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0") or 0),
    )

if IS_DEPLOYED and not EMAIL_CONFIGURED and not TESTING:
    logging.getLogger("config").warning(
        "EMAIL_HOST is not configured (DJANGO_ENV=%s): transactional email such as password "
        "resets is only written to the console.",
        DJANGO_ENV,
    )

# Load Django system checks (production launch guards).
import config.checks  # noqa: E402, F401
