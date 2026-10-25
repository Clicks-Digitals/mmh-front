from __future__ import annotations

from django.conf import settings
from django.core.checks import Error, Warning, register


@register()
def check_production_launch_guards(app_configs, **kwargs):
    """Fail loud when unsafe demo/commerce settings are active in staging or production."""
    errors = []
    warnings = []
    # Staging is held to the same launch guards as production.
    is_production = bool(getattr(settings, "IS_PRODUCTION", False) or getattr(settings, "IS_STAGING", False))
    is_development = getattr(settings, "IS_DEVELOPMENT", True)

    if is_production:
        if getattr(settings, "DEBUG", False):
            errors.append(Error("DEBUG must be False in staging/production.", id="config.E001"))
        if getattr(settings, "ALLOW_DEMO_AUTO_PAYMENT", False):
            errors.append(
                Error(
                    "ALLOW_DEMO_AUTO_PAYMENT must be False in staging/production. "
                    "Demo auto-pay checkout is a launch blocker.",
                    id="config.E002",
                )
            )
        if not getattr(settings, "CORS_ALLOWED_ORIGINS", None):
            errors.append(
                Error(
                    "CORS_ALLOWED_ORIGINS must be configured in staging/production.",
                    id="config.E004",
                )
            )
        secret = getattr(settings, "SECRET_KEY", "") or ""
        if not secret or secret.startswith("dev-") or len(secret) < 32:
            errors.append(
                Error(
                    "DJANGO_SECRET_KEY must be a strong explicit value in staging/production.",
                    id="config.E005",
                )
            )
        hosts = getattr(settings, "ALLOWED_HOSTS", []) or []
        if not hosts or hosts == ["*"]:
            errors.append(
                Error(
                    "ALLOWED_HOSTS must be explicitly configured in staging/production.",
                    id="config.E006",
                )
            )
        key = getattr(settings, "CODE_ENCRYPTION_KEY", "") or ""
        if len(key) != 64:
            errors.append(
                Error(
                    "CODE_ENCRYPTION_KEY must be a 64-char hex string in staging/production.",
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

    errors.extend(check_oneepin_settings(is_production=is_production))
    return errors + warnings


def check_oneepin_settings(*, is_production: bool) -> list:
    """1Epin supplier configuration (D-1E-1): live needs SUPPLIER_MODE=live AND ONEEPIN_ALLOW_LIVE."""
    out = []
    mode = (getattr(settings, "SUPPLIER_MODE", "mock") or "").strip().lower()
    allow_live = bool(getattr(settings, "ONEEPIN_ALLOW_LIVE", False))
    has_creds = bool(getattr(settings, "ONEEPIN_EMAIL", "") and getattr(settings, "ONEEPIN_PASSWORD", ""))
    token = getattr(settings, "ONEEPIN_CALLBACK_TOKEN", "") or ""
    if mode not in {"mock", "test", "live"}:
        out.append(Error(f"SUPPLIER_MODE must be mock, test or live (got {mode!r}).", id="suppliers.E001"))
        return out
    if mode == "live" and allow_live:
        if not has_creds:
            out.append(
                Warning(
                    "1Epin live mode is on but ONEEPIN_EMAIL / ONEEPIN_PASSWORD are missing: nothing can be bought.",
                    id="suppliers.W001",
                )
            )
        if len(token) < 16:
            out.append(
                Warning(
                    "1Epin live mode is on without a strong ONEEPIN_CALLBACK_TOKEN (>= 16 chars): callbacks are "
                    "rejected and orders only complete through the scheduled reconcile.",
                    id="suppliers.W002",
                )
            )
    if mode == "live" and not allow_live:
        out.append(
            Warning(
                "SUPPLIER_MODE=live without ONEEPIN_ALLOW_LIVE=true: live purchasing stays disabled.",
                id="suppliers.W003",
            )
        )
    if allow_live and mode != "live":
        out.append(
            Warning("ONEEPIN_ALLOW_LIVE=true has no effect unless SUPPLIER_MODE=live.", id="suppliers.W004")
        )
    if mode == "test" and not has_creds:
        out.append(
            Warning(
                "SUPPLIER_MODE=test without ONEEPIN_EMAIL / ONEEPIN_PASSWORD (public test accounts: "
                "test@1epin.com or test_usd@1epin.com / test1234).",
                id="suppliers.W005",
            )
        )
    try:
        from decimal import Decimal

        if Decimal(str(getattr(settings, "ONEEPIN_FX_TO_JOD", "0.709"))) <= 0:
            raise ValueError
    except Exception:  # noqa: BLE001
        out.append(Error("ONEEPIN_FX_TO_JOD must be a positive number.", id="suppliers.E002"))
    if is_production and mode == "mock":
        out.append(
            Warning(
                "SUPPLIER_MODE=mock in staging/production: 1Epin is simulated and never buys "
                "(mapped items without own stock wait for staff).",
                id="suppliers.W006",
            )
        )
    return out
