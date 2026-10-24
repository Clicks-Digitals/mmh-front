from __future__ import annotations

import logging

from rest_framework.permissions import BasePermission

from accounts.models import UserKind
from accounts.permissions import has_permission

logger = logging.getLogger("accounts")


def client_ip(request) -> str:
    """Best-effort client IP (honours DRF NUM_PROXIES via the throttle helper)."""
    try:
        from rest_framework.throttling import BaseThrottle

        return BaseThrottle().get_ident(request) or ""
    except Exception:  # noqa: BLE001
        return request.META.get("REMOTE_ADDR", "") if hasattr(request, "META") else ""


def record_permission_denied(request, view, permission=None) -> None:
    """Audit a 403 on the admin API by an authenticated user (RO-17). Never raises."""
    try:
        from audit.services import record_audit

        user = request.user
        if isinstance(permission, (list, tuple, set, frozenset)):
            permission = sorted(permission)
        record_audit(
            user,
            "auth.permission_denied",
            entity_type="User",
            entity_id=user.pk,
            meta={
                "email": user.email,
                "method": request.method,
                "path": request.path[:200],
                "permission": permission or "",
                "view": view.__class__.__name__,
                "ip": client_ip(request),
            },
        )
    except Exception:  # noqa: BLE001 — auditing must never break the request
        logger.exception("Could not record permission-denied audit entry")


class IsCustomer(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and not user.disabled and user.kind == UserKind.CUSTOMER)


class IsAdminUser(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated and not user.disabled):
            return False
        allowed = user.kind == UserKind.ADMIN or user.is_superuser
        if not allowed:
            record_permission_denied(request, view, "staff")
        return allowed


class HasAdminPermission(BasePermission):
    """Checks ``view.admin_permission`` (a key, or a list/tuple meaning *any of*)."""

    permission_key = ""

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated or user.disabled:
            return False
        if not (user.kind == UserKind.ADMIN or user.is_superuser):
            return False
        key = getattr(view, "admin_permission", None) or self.permission_key
        if not key:
            return True
        allowed = has_permission(user, key)
        if not allowed:
            record_permission_denied(request, view, key)
        return allowed
