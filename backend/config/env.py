"""Pure helpers used by settings.py (kept import-light so they are unit-testable)."""

from __future__ import annotations

import re
from collections.abc import Mapping

DEV_SECRET_KEY = "dev-only-change-me-mmh-backend"
_HEX64 = re.compile(r"^[0-9a-fA-F]{64}$")


def normalize_env(raw: str | None) -> str:
    value = (raw or "development").lower().strip()
    if value in {"prod", "production"}:
        return "production"
    if value in {"staging", "stage"}:
        return "staging"
    return "development"


def is_deployed(env: str) -> bool:
    """Staging and production share the same hardening rules."""
    return env in {"staging", "production"}


def env_bool(environ: Mapping[str, str], name: str, default: bool = False) -> bool:
    raw = environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def resolve_secret_key(env: str, environ: Mapping[str, str]) -> str:
    secret = (environ.get("SECRET_KEY") or environ.get("DJANGO_SECRET_KEY") or "").strip()
    if secret:
        return secret
    if is_deployed(env):
        raise RuntimeError(f"SECRET_KEY (or DJANGO_SECRET_KEY) must be set when DJANGO_ENV={env}")
    return DEV_SECRET_KEY


def resolve_code_encryption_key(env: str, environ: Mapping[str, str]) -> str:
    key = (environ.get("CODE_ENCRYPTION_KEY") or "").strip()
    if is_deployed(env) and not _HEX64.match(key):
        raise RuntimeError(
            f"CODE_ENCRYPTION_KEY must be a 64-character hex string when DJANGO_ENV={env} "
            "(generate with: openssl rand -hex 32). Losing this key makes stored codes undecryptable."
        )
    return key


def email_settings(environ: Mapping[str, str]) -> dict:
    """SMTP when EMAIL_HOST is set, otherwise the console backend."""
    host = (environ.get("EMAIL_HOST") or "").strip()
    conf: dict = {
        "DEFAULT_FROM_EMAIL": (environ.get("DEFAULT_FROM_EMAIL") or "MMH <no-reply@mmhcard.com>").strip(),
        "EMAIL_CONFIGURED": bool(host),
    }
    if host:
        use_ssl = env_bool(environ, "EMAIL_USE_SSL", False)
        conf.update(
            {
                "EMAIL_BACKEND": "django.core.mail.backends.smtp.EmailBackend",
                "EMAIL_HOST": host,
                "EMAIL_PORT": int(environ.get("EMAIL_PORT") or (465 if use_ssl else 587)),
                "EMAIL_HOST_USER": environ.get("EMAIL_HOST_USER", ""),
                "EMAIL_HOST_PASSWORD": environ.get("EMAIL_HOST_PASSWORD", ""),
                "EMAIL_USE_SSL": use_ssl,
                # TLS and SSL are mutually exclusive in Django.
                "EMAIL_USE_TLS": False if use_ssl else env_bool(environ, "EMAIL_USE_TLS", True),
                "EMAIL_TIMEOUT": int(environ.get("EMAIL_TIMEOUT") or 20),
            }
        )
    else:
        # UTF-8 safe console output (Arabic e-mails on Windows consoles).
        conf["EMAIL_BACKEND"] = "config.mail.EmailBackend"
    return conf
