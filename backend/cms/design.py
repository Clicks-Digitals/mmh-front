"""Store design: theme colours / neon level and the home page section list (Settings → Store design).

Both live on SiteSettings as JSON. Empty values mean "the built-in look": the storefront falls back
to DEFAULT_THEME and DEFAULT_HOME_LAYOUT, so existing stores render exactly as before.
"""

from __future__ import annotations

import re
import uuid

HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
NEON_LEVELS = ("off", "accents", "full")
THEME_COLORS = ("primary", "secondary", "background")

DEFAULT_THEME = {"primary": "#f7c037", "secondary": "#565895", "background": "#17182b", "neon": "accents"}

# Built-in home sections, in their original order. Each may appear at most once.
BUILTIN_SECTIONS = (
    "banners",  # home banners carousel (or the hero picture when there are none)
    "promo",  # "Trusted codes. Clear regions." strip
    "platforms",  # platform logo links
    "categories",  # categories slider
    "best_sellers",  # best sellers row
    "services",  # store services grid
    "suggested",  # MMH suggests circles
    "support",  # contact support call-out
)
CUSTOM_SECTIONS = ("products", "image")
MAX_SECTIONS = 40
MAX_PRODUCTS = 24

DEFAULT_HOME_LAYOUT = [{"id": key, "type": key, "visible": True} for key in BUILTIN_SECTIONS]


def clean_theme(value) -> dict:
    if value in (None, "") or value == {}:
        return {}
    if not isinstance(value, dict):
        raise ValueError("Send the theme as {primary, secondary, background, neon}.")
    cleaned: dict[str, str] = {}
    for key in THEME_COLORS:
        raw = str(value.get(key) or DEFAULT_THEME[key]).strip()
        if not HEX.match(raw):
            raise ValueError(f"{key}: use a colour like #f7c037.")
        cleaned[key] = raw.lower()
    neon = str(value.get("neon") or DEFAULT_THEME["neon"]).strip().lower()
    if neon not in NEON_LEVELS:
        raise ValueError("neon must be off, accents or full.")
    cleaned["neon"] = neon
    return cleaned


def _text(entry: dict, key: str, limit: int) -> str:
    return str(entry.get(key) or "").strip()[:limit]


def _href(raw: str) -> str:
    raw = raw.strip()
    if not raw:
        return ""
    if raw.startswith("/") and not raw.startswith("//"):
        return raw[:500]
    if re.match(r"^https?://", raw, re.I):
        return raw[:500]
    raise ValueError("Links must start with / (a store page) or https://.")


def _image(raw: str) -> str:
    raw = raw.strip()
    if not raw:
        return ""
    if raw.startswith("/media/") or re.match(r"^https://", raw, re.I):
        return raw[:512]
    raise ValueError("Upload the picture from the panel.")


def clean_home_layout(value) -> list:
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        raise ValueError("Send the home page as a list of sections.")
    if len(value) > MAX_SECTIONS:
        raise ValueError(f"The home page can have at most {MAX_SECTIONS} sections.")
    seen_builtin: set[str] = set()
    seen_ids: set[str] = set()
    cleaned: list[dict] = []
    for position, entry in enumerate(value, start=1):
        if not isinstance(entry, dict):
            raise ValueError(f"Section {position}: send an object.")
        kind = str(entry.get("type") or "").strip()
        if kind in BUILTIN_SECTIONS:
            if kind in seen_builtin:
                raise ValueError(f"Section {position}: “{kind}” is already on the page.")
            seen_builtin.add(kind)
            section_id = kind
        elif kind in CUSTOM_SECTIONS:
            section_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(entry.get("id") or ""))[:40] or uuid.uuid4().hex[:10]
            if section_id in BUILTIN_SECTIONS:
                section_id = uuid.uuid4().hex[:10]
        else:
            raise ValueError(f"Section {position}: unknown type “{kind}”.")
        if section_id in seen_ids:
            section_id = uuid.uuid4().hex[:10]
        seen_ids.add(section_id)
        row: dict = {"id": section_id, "type": kind, "visible": entry.get("visible", True) is not False}
        try:
            if kind == "products":
                row.update(_clean_products(entry))
            elif kind == "image":
                row.update(_clean_image(entry))
        except ValueError as exc:
            raise ValueError(f"Section {position}: {exc}") from None
        cleaned.append(row)
    return cleaned


def _clean_products(entry: dict) -> dict:
    source = str(entry.get("source") or "category").strip()
    if source not in ("category", "products", "deals", "newest"):
        raise ValueError("choose where the products come from.")
    out = {
        "title_en": _text(entry, "title_en", 120),
        "title_ar": _text(entry, "title_ar", 120),
        "source": source,
        "category": "",
        "products": [],
        "style": "grid" if entry.get("style") == "grid" else "row",
    }
    try:
        limit = int(entry.get("limit") or 8)
    except (TypeError, ValueError):
        limit = 8
    out["limit"] = max(2, min(MAX_PRODUCTS, limit))
    if source == "category":
        out["category"] = re.sub(r"[^a-z0-9-]", "", str(entry.get("category") or "").lower())[:120]
        if not out["category"]:
            raise ValueError("pick a category.")
    elif source == "products":
        slugs = entry.get("products") or []
        if not isinstance(slugs, list):
            raise ValueError("send products as a list.")
        clean = []
        for slug in slugs:
            slug = re.sub(r"[^a-z0-9-]", "", str(slug).lower())[:160]
            if slug and slug not in clean:
                clean.append(slug)
        if not clean:
            raise ValueError("pick at least one product.")
        out["products"] = clean[:MAX_PRODUCTS]
    if not out["title_en"] and not out["title_ar"]:
        raise ValueError("give the row a title.")
    return out


def _clean_image(entry: dict) -> dict:
    out = {
        "image": _image(str(entry.get("image") or "")),
        "image_mobile": _image(str(entry.get("image_mobile") or "")),
        "href": _href(str(entry.get("href") or "")),
        "alt_en": _text(entry, "alt_en", 160),
        "alt_ar": _text(entry, "alt_ar", 160),
    }
    if not out["image"]:
        raise ValueError("upload a picture.")
    return out
