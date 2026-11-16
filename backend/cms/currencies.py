"""Display currencies for the storefront price switcher.

Prices are stored and charged in JOD; other currencies are shown converted with these rates
(units of the currency per 1 JOD). Staff can change rates and switch currencies off in
Admin → Settings; anything not set there uses the defaults below.
"""

from __future__ import annotations

# code -> default units per 1 JOD (JOD is pegged at 0.709 per USD; Gulf pegs per USD).
DEFAULT_RATES: dict[str, float] = {
    "JOD": 1.0,
    "USD": 1.4104,
    "SAR": 5.289,  # 3.75 / USD
    "AED": 5.1797,  # 3.6725 / USD
    "QAR": 5.1339,  # 3.64 / USD
    "BHD": 0.5303,  # 0.376 / USD
    "OMR": 0.5423,  # 0.3845 / USD
    "KWD": 0.4330,  # basket peg, ~0.307 / USD
    "ILS": 5.2185,  # floating, ~3.70 / USD
    "IQD": 1847.6,  # ~1310 / USD
    "LBP": 126231.0,  # ~89,500 / USD
    "SYP": 18335.0,  # ~13,000 / USD
}
CURRENCY_CODES = tuple(DEFAULT_RATES)


def effective_currencies(stored: dict | None) -> list[dict]:
    """Every supported currency with its rate and on/off flag (stored values over defaults)."""
    stored = stored if isinstance(stored, dict) else {}
    out = []
    for code, default in DEFAULT_RATES.items():
        entry = stored.get(code) if isinstance(stored.get(code), dict) else {}
        rate = entry.get("rate", default)
        try:
            rate = float(rate)
        except (TypeError, ValueError):
            rate = default
        out.append({"code": code, "rate": 1.0 if code == "JOD" else rate, "enabled": True if code == "JOD" else bool(entry.get("enabled", True))})
    return out


def clean_currency_rates(value) -> dict:
    """Validate the admin payload {code: {rate, enabled}}; raises ValueError with a plain message."""
    if value in (None, ""):
        return {}
    if not isinstance(value, dict):
        raise ValueError("Send currencies as {code: {rate, enabled}}.")
    cleaned: dict[str, dict] = {}
    for code, entry in value.items():
        code = str(code).upper()
        if code not in DEFAULT_RATES:
            raise ValueError(f"{code} is not a supported currency.")
        if code == "JOD":
            continue  # the base currency is always 1 and always on
        if not isinstance(entry, dict):
            raise ValueError(f"{code}: send {{rate, enabled}}.")
        try:
            rate = float(entry.get("rate", DEFAULT_RATES[code]))
        except (TypeError, ValueError):
            raise ValueError(f"{code}: the rate must be a number.") from None
        if not rate > 0 or rate > 10_000_000:
            raise ValueError(f"{code}: the rate must be more than 0.")
        cleaned[code] = {"rate": rate, "enabled": bool(entry.get("enabled", True))}
    return cleaned
