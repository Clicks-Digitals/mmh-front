"""Input normalisation/validation shared by accounts, cms and catalog."""

from __future__ import annotations

import re

from django.core.exceptions import ValidationError
from django.utils.translation import gettext as _, ngettext

# Arabic-Indic (U+0660-0669) and Extended Arabic-Indic / Persian (U+06F0-06F9) digits.
_DIGIT_TRANSLATION = {
    **{0x0660 + i: str(i) for i in range(10)},
    **{0x06F0 + i: str(i) for i in range(10)},
}


def normalize_digits(value: str) -> str:
    """Convert Arabic-Indic / Persian digits to ASCII digits."""
    return (value or "").translate(_DIGIT_TRANSLATION)


_PHONE_SEPARATORS = re.compile(r"[\s\-(). ‏‎]")


def normalize_phone(value: str) -> str:
    """Normalise a phone number: ASCII digits, no separators, ``00`` prefix -> ``+``.

    Returns ``""`` for blank input. Raises ``ValueError`` with a user-facing message when
    the result is not E.164-ish: optional ``+`` then 8-15 digits (``+`` numbers may not
    start with 0). Local numbers such as ``0791234567`` are accepted as typed.
    """
    raw = normalize_digits(str(value or "")).strip()
    if not raw:
        return ""
    compact = _PHONE_SEPARATORS.sub("", raw)
    if compact.startswith("00"):
        compact = "+" + compact[2:]
    if compact.startswith("+"):
        if not re.fullmatch(r"\+[1-9]\d{7,14}", compact):
            raise ValueError(_("Enter a valid phone number, e.g. +962791234567."))
    elif not re.fullmatch(r"\d{8,15}", compact):
        raise ValueError(_("Enter a valid phone number, e.g. +962791234567."))
    return compact


def normalize_whatsapp(value: str) -> str:
    """Digits only (8-15) after converting Arabic-Indic digits and dropping ``+``/spaces/dashes/``00``."""
    raw = normalize_digits(str(value or "")).strip()
    if not raw:
        return ""
    compact = _PHONE_SEPARATORS.sub("", raw)
    if compact.startswith("+"):
        compact = compact[1:]
    elif compact.startswith("00"):
        compact = compact[2:]
    if not re.fullmatch(r"\d{8,15}", compact):
        raise ValueError(
            _("Enter the WhatsApp number in international format using digits only, e.g. 962791234567.")
        )
    return compact


class MinimumDistinctCharactersValidator:
    """Reject low-variety passwords such as ``aaaaaaaaaaaa`` or ``121212121212`` (D16)."""

    def __init__(self, min_distinct: int = 5):
        self.min_distinct = min_distinct

    def validate(self, password, user=None):
        if len(set(password or "")) < self.min_distinct:
            raise ValidationError(
                ngettext(
                    "This password is too repetitive. Use at least %(min)d different character.",
                    "This password is too repetitive. Use at least %(min)d different characters.",
                    self.min_distinct,
                )
                % {"min": self.min_distinct},
                code="password_too_repetitive",
                params={"min": self.min_distinct},
            )

    def get_help_text(self):
        return _("Your password must contain at least %(min)d different characters.") % {"min": self.min_distinct}
