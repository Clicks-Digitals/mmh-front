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
