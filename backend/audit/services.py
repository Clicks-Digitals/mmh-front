"""Single entry point for writing audit trail rows.

Use ``record_audit`` from views/services instead of ``AuditLog.objects.create`` so
anonymous actors, entity ids and metadata are normalised the same way everywhere.
"""

from __future__ import annotations

import logging
from typing import Any

from audit.models import AuditLog

logger = logging.getLogger("audit")


def _actor_or_none(actor):
    if actor is None:
        return None
    if not getattr(actor, "is_authenticated", False):
        return None
    if getattr(actor, "pk", None) is None:
        return None
    return actor


def record_audit(
    actor,
    action: str,
    *,
    entity_type: str = "",
    entity_id: Any = "",
    meta: dict | None = None,
) -> AuditLog:
    """Persist an audit entry. Never put secrets (passwords, codes, tokens) in ``meta``."""
    return AuditLog.objects.create(
        actor=_actor_or_none(actor),
        action=action[:64],
        entity_type=(entity_type or "")[:64],
        entity_id=str(entity_id if entity_id is not None else "")[:64],
        meta=meta or {},
    )


def changed_fields(instance_before: dict, instance_after: dict) -> list[str]:
    """Names of keys whose values differ between two plain dicts."""
    keys = set(instance_before) | set(instance_after)
    return sorted(k for k in keys if instance_before.get(k) != instance_after.get(k))


class AuditedModelViewSetMixin:
    """Writes ``<prefix>.created|updated|deleted`` audit rows for ModelViewSet CRUD.

    Set ``audit_prefix`` (e.g. ``"cms.banner"``) and optionally ``audit_entity_type``.
    Must be placed before the DRF viewset in the MRO.
    """

    audit_prefix = ""
    audit_entity_type = ""

    def _audit_entity_type(self, instance) -> str:
        return self.audit_entity_type or instance.__class__.__name__

    def _audit_label(self, instance) -> dict:
        meta: dict[str, Any] = {}
        for attr in ("slug", "title_en", "question_en", "name_en", "name", "placement"):
            value = getattr(instance, attr, None)
            if value not in (None, ""):
                meta[attr] = str(value)[:200]
        return meta

    def perform_create(self, serializer):
        super().perform_create(serializer)
        instance = serializer.instance
        record_audit(
            self.request.user,
            f"{self.audit_prefix}.created",
            entity_type=self._audit_entity_type(instance),
            entity_id=instance.pk,
            meta=self._audit_label(instance),
        )

    def perform_update(self, serializer):
        fields = sorted(serializer.validated_data.keys()) if hasattr(serializer, "validated_data") else []
        super().perform_update(serializer)
        instance = serializer.instance
        meta = self._audit_label(instance)
        meta["fields"] = fields
        record_audit(
            self.request.user,
            f"{self.audit_prefix}.updated",
            entity_type=self._audit_entity_type(instance),
            entity_id=instance.pk,
            meta=meta,
        )

    def perform_destroy(self, instance):
        pk = instance.pk
        entity_type = self._audit_entity_type(instance)
        meta = self._audit_label(instance)
        super().perform_destroy(instance)
        record_audit(
            self.request.user,
            f"{self.audit_prefix}.deleted",
            entity_type=entity_type,
            entity_id=pk,
            meta=meta,
        )


# --- Display helpers (OR-14, RO-17) ---------------------------------------------------

ENTITY_NAMES = {
    "Order": "Order",
    "Coupon": "Coupon",
    "DigitalCode": "Code",
    "CodeImportBatch": "Code import",
    "ProductVariant": "Product option",
    "Product": "Product",
    "User": "User",
}


def actor_label(entry) -> str:
    actor = getattr(entry, "actor", None) if getattr(entry, "actor_id", None) else None
    if actor is None:
        return ""
    name = (actor.get_full_name() or "").strip() if hasattr(actor, "get_full_name") else ""
    return f"{name} ({actor.email})" if name else (actor.email or f"User #{actor.pk}")


def variant_display_name(product_name: str, variant_name: str) -> str:
    """'PUBG Mobile – 60 UC'; either part may be missing."""
    product_name = (product_name or "").strip()
    variant_name = (variant_name or "").strip()
    if product_name and variant_name:
        return f"{product_name} – {variant_name}"
    return product_name or variant_name


def _variant_label(entity_id, meta: dict) -> str:
    """Product option target as '<product> – <option>' (one id, or a few comma-joined ids)."""
    from catalog.models import ProductVariant

    ids = [part for part in str(entity_id or "").split(",") if part.strip().isdigit()]
    if ids:
        variants = {
            str(v.pk): variant_display_name(v.product.name_en, v.name_en)
            for v in ProductVariant.objects.select_related("product").filter(pk__in=ids[:20]).only("name_en", "product__name_en")
        }
        names = [variants[i] for i in ids if i in variants]
        if len(ids) == 1 and names:
            return names[0]
        if names:
            shown = ", ".join(names[:3])
            return f"{shown} +{len(ids) - 3} more" if len(ids) > 3 else shown
    from_meta = variant_display_name(str(meta.get("product_name") or meta.get("product_name_en") or ""), str(meta.get("name_en") or meta.get("variant_name") or ""))
    return from_meta


def entity_label(entry) -> str:
    """Readable target, e.g. 'Order 1A2B3C4D5E6F', 'Coupon SAVE10', 'User jane@example.com'."""
    meta = entry.meta or {}
    kind = entry.entity_type or ""
    name = ENTITY_NAMES.get(kind, kind)
    if kind == "Order" and meta.get("order_number"):
        return f"Order {meta['order_number']}"
    if kind == "Coupon" and meta.get("code"):
        return f"Coupon {meta['code']}"
    if kind == "DigitalCode":
        masked = meta.get("masked")
        order_number = meta.get("order_number")
        label = f"Code {masked}" if masked else f"Code #{entry.entity_id}"
        return f"{label} (order {order_number})" if order_number else label
    if kind == "CodeImportBatch" and meta.get("filename"):
        return f"Code import {meta['filename']}"
    if kind == "ProductVariant":
        label = _variant_label(entry.entity_id, meta)
        if label:
            return label
    for key in ("email", "target_email", "user_email"):
        if meta.get(key) and kind == "User":
            return f"User {meta[key]}"
    if kind == "User" and entry.entity_id:
        from django.contrib.auth import get_user_model

        user = get_user_model().objects.filter(pk=entry.entity_id).only("email").first() if str(entry.entity_id).isdigit() else None
        if user is not None:
            return f"User {user.email}"
    for key in ("name_en", "title_en", "slug", "name", "code", "sku"):
        if meta.get(key):
            return f"{name} {meta[key]}"
    return f"{name} #{entry.entity_id}" if entry.entity_id else name
