from __future__ import annotations

from django.conf import settings
from django.core.checks import Error, Warning, register


@register()
def check_production_launch_guards(app_configs, **kwargs):
    """Fail loud when unsafe demo/commerce settings are active in production."""
    errors = []
    warnings = []
    is_production = getattr(settings, "IS_PRODUCTION", False)
    is_development = getattr(settings, "IS_DEVELOPMENT", True)

    if is_production:
        if getattr(settings, "DEBUG", False):
            errors.append(Error("DEBUG must be False in production.", id="config.E001"))
        if getattr(settings, "ALLOW_DEMO_AUTO_PAYMENT", False):
            errors.append(
                Error(
                    "ALLOW_DEMO_AUTO_PAYMENT must be False in production. "
                    "Demo auto-pay checkout is a launch blocker.",
                    id="config.E002",
                )
            )
        if getattr(settings, "ONEEPIN_ALLOW_LIVE", False):
            errors.append(
                Error(
                    "ONEEPIN_ALLOW_LIVE must remain False until payment integration "
                    "and an explicit go-live decision.",
                    id="config.E003",
                )
            )
        if not getattr(settings, "CORS_ALLOWED_ORIGINS", None):
            errors.append(
                Error(
                    "CORS_ALLOWED_ORIGINS must be configured in production.",
                    id="config.E004",
                )
            )
        secret = getattr(settings, "SECRET_KEY", "") or ""
        if not secret or secret.startswith("dev-") or len(secret) < 32:
            errors.append(
                Error(
                    "DJANGO_SECRET_KEY must be a strong explicit value in production.",
                    id="config.E005",
                )
            )
        hosts = getattr(settings, "ALLOWED_HOSTS", []) or []
        if not hosts or hosts == ["*"]:
            errors.append(
                Error(
                    "ALLOWED_HOSTS must be explicitly configured in production.",
                    id="config.E006",
                )
            )
        key = getattr(settings, "CODE_ENCRYPTION_KEY", "") or ""
        if len(key) != 64:
            errors.append(
                Error(
                    "CODE_ENCRYPTION_KEY must be a 64-char hex string in production.",
                    id="config.E007",
                )
            )

    if getattr(settings, "ALLOW_DEMO_AUTO_PAYMENT", False) and not is_development:
        warnings.append(
            Warning(
                "ALLOW_DEMO_AUTO_PAYMENT is enabled outside development.",
                id="config.W001",
            )
        )

    if (
        getattr(settings, "PAYPAL_CLIENT_ID", "")
        and getattr(settings, "PAYPAL_CURRENCY", "JOD") != "JOD"
        and not getattr(settings, "PAYPAL_FX_RATE", "")
    ):
        warnings.append(
            Warning(
                "PAYPAL_FX_RATE must be set when PAYPAL_CURRENCY is not JOD. "
                "PayPal charges are converted from the JOD order total on the server.",
                id="config.W002",
            )
        )

    return errors + warnings
