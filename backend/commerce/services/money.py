"""JOD money display helpers. Amounts are stored as integer fils (1 JOD = 1000 fils)."""

from __future__ import annotations

from decimal import Decimal


def jod_amount(fils: int | None) -> str:
    """'8.90' for 8900 fils, '8.905' when the third decimal is used, '-1.50' for refunds."""
    value = int(fils or 0)
    sign = "-" if value < 0 else ""
    value = abs(value)
    if value % 10 == 0:
        return f"{sign}{Decimal(value) / Decimal(1000):.2f}"
    return f"{sign}{Decimal(value) / Decimal(1000):.3f}"


def format_jod(fils: int | None, locale: str = "en") -> str:
    """Panel/e-mail display: 'JOD 8.90' (EN) or '8.90 د.أ' (AR)."""
    amount = jod_amount(fils)
    if locale == "ar":
        return f"{amount} د.أ"
    return f"JOD {amount}"
