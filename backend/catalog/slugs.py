"""Slug / key derivation shared by catalog, cms and suppliers serializers (CA-15, CA-19, CA-22)."""

from __future__ import annotations

import re
import uuid

from django.utils.text import slugify


def unique_slug(model, base: str, *, field: str = "slug", max_length: int = 50, fallback: str = "item", exclude_pk=None) -> str:
    """``slugify(base)`` made unique on ``model.field`` by appending ``-2``, ``-3``...

    Arabic-only (or otherwise unsluggable) input falls back to ``<fallback>-<6 hex>``.
    """
    root = slugify(base or "")[:max_length].strip("-")
    if not root:
        root = f"{fallback}-{uuid.uuid4().hex[:6]}"
    candidate, n = root, 2
    qs = model.objects.all()
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    while qs.filter(**{field: candidate}).exists():
        suffix = f"-{n}"
        candidate = f"{root[: max_length - len(suffix)]}{suffix}"
        n += 1
    return candidate


def key_from_label(label: str, *, fallback: str = "field") -> str:
    """``"Player ID"`` -> ``"player_id"`` (lowercase_with_underscores; ``fallback`` when empty)."""
    key = re.sub(r"[^a-z0-9]+", "_", slugify(label or "").lower()).strip("_")
    if key and key[0].isdigit():
        key = f"f_{key}"
    return (key or fallback)[:64]
