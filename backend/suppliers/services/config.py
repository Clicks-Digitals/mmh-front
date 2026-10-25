"""Mode / money helpers for the 1Epin integration (no network)."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from django.conf import settings

from suppliers.models import SupplierEnvironment

VALID_MODES = ("mock", "test", "live")
CATALOG_MAX_AGE_HOURS = 48
CALLBACK_PATH = "/api/v1/suppliers/1epin/callback/"


def supplier_mode() -> str:
    return (getattr(settings, "SUPPLIER_MODE", "mock") or "mock").strip().lower()


def current_environment() -> str:
    mode = supplier_mode()
    if mode == "live":
        return SupplierEnvironment.LIVE
    if mode == "test":
        return SupplierEnvironment.TEST
    return SupplierEnvironment.MOCK


def credentials_configured() -> bool:
    return bool(getattr(settings, "ONEEPIN_EMAIL", "") and getattr(settings, "ONEEPIN_PASSWORD", ""))


def live_enabled() -> bool:
    return supplier_mode() == "live" and bool(getattr(settings, "ONEEPIN_ALLOW_LIVE", False))


def trading_enabled() -> bool:
    """True when supplier orders may be placed in the current mode."""
    mode = supplier_mode()
    if mode == "mock":
        return bool(getattr(settings, "ONEEPIN_MOCK_FULFILLMENT", False))
    if mode == "test":
        return credentials_configured()
    if mode == "live":
        return live_enabled() and credentials_configured()
    return False


def trading_disabled_reason() -> str:
    mode = supplier_mode()
    if mode not in VALID_MODES:
        return f"Unknown SUPPLIER_MODE {mode!r}"
    if mode == "mock" and not getattr(settings, "ONEEPIN_MOCK_FULFILLMENT", False):
        return "Mock mode does not buy outside development (ONEEPIN_MOCK_FULFILLMENT)."
    if mode == "live" and not live_enabled():
        return "Live purchasing needs ONEEPIN_ALLOW_LIVE=true."
    if mode in {"test", "live"} and not credentials_configured():
        return "1Epin credentials are not configured (ONEEPIN_EMAIL / ONEEPIN_PASSWORD)."
    return ""


def mapping_stock_mode_ok() -> bool:
    """D10: mappings count as stock only in live mode (or test/mock with ONEEPIN_TEST_COUNTS_AS_STOCK)."""
    if not trading_enabled():
        return False
    if supplier_mode() == "live":
        return True
    return bool(getattr(settings, "ONEEPIN_TEST_COUNTS_AS_STOCK", False))


def currency() -> str:
    return getattr(settings, "ONEEPIN_CURRENCY", "USD") or "USD"


def _decimal_setting(name: str, default: str) -> Decimal:
    try:
        return Decimal(str(getattr(settings, name, default) or default))
    except (InvalidOperation, ValueError):
        return Decimal(default)


def fx_to_jod() -> Decimal:
    return _decimal_setting("ONEEPIN_FX_TO_JOD", "0.709")


def low_balance_threshold() -> Decimal:
    return _decimal_setting("ONEEPIN_LOW_BALANCE", "20")


def to_fils(amount: Decimal | None) -> int | None:
    """Supplier-currency amount -> JOD fils (rounded half up)."""
    if amount is None:
        return None
    return int((Decimal(amount) * fx_to_jod() * 1000).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def fils_display(fils: int | None) -> str | None:
    if fils is None:
        return None
    return f"{Decimal(fils) / 1000:.3f} JOD"


def callback_url(*, with_token: bool = True) -> str:
    base = (getattr(settings, "PUBLIC_API_URL", "") or "").rstrip("/")
    token = getattr(settings, "ONEEPIN_CALLBACK_TOKEN", "") or ""
    if with_token and token:
        return f"{base}{CALLBACK_PATH}{token}/"
    return f"{base}{CALLBACK_PATH}"
