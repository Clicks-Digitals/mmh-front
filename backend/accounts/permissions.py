"""Admin RBAC.

The database (``RolePermission`` rows) is the single source of truth for every role
except ``SUPER_ADMIN``, which is hard-coded to ``"*"``. ``DEFAULT_ROLE_PERMISSIONS``
is only used to seed roles that have no rows yet (see the accounts data migration).
"""

from __future__ import annotations

from accounts.models import AdminRole, RolePermission, User, UserKind

SUPER_ADMIN_PERMISSIONS = frozenset({"*"})

# Every assignable permission key and its description (seeded by migration).
PERMISSION_DEFINITIONS: list[tuple[str, str]] = [
    ("catalog.read", "Read catalog"),
    ("catalog.write", "Write catalog"),
    ("orders.read", "Read orders"),
    ("orders.write", "Write orders"),
    ("orders.fulfill", "Fulfill orders"),
    ("codes.read", "List digital codes"),
    ("codes.manage", "Manage digital code inventory"),
    ("codes.reveal", "Reveal digital codes"),
    ("customers.read", "Read customers"),
    ("customers.write", "Write customers"),
    ("content.read", "Read CMS"),
    ("content.write", "Write CMS"),
    ("suppliers.read", "Read suppliers"),
    ("suppliers.write", "Write suppliers"),
    ("audit.read", "Read audit"),
    ("admins.read", "Read administrators"),
    ("admins.write", "Manage administrators"),
    ("settings.manage", "Manage site settings"),
]

# Seed defaults only. Runtime permissions come from RolePermission rows.
DEFAULT_ROLE_PERMISSIONS: dict[str, set[str]] = {
    AdminRole.SUPER_ADMIN: {"*"},
    AdminRole.ADMIN: {key for key, _ in PERMISSION_DEFINITIONS},
    AdminRole.CATALOG_MANAGER: {
        "catalog.read",
        "catalog.write",
        "content.read",
        "content.write",
        "suppliers.read",
        "codes.read",
    },
    AdminRole.ORDER_MANAGER: {
        "orders.read",
        "orders.write",
        "orders.fulfill",
        "codes.read",
        "codes.manage",
        "codes.reveal",
        "customers.read",
    },
    AdminRole.CONTENT_MANAGER: {"content.read", "content.write", "catalog.read"},
    AdminRole.SUPPORT_AGENT: {"orders.read", "customers.read", "codes.read"},
    AdminRole.VIEWER: {
        "catalog.read",
        "orders.read",
        "customers.read",
        "content.read",
        "suppliers.read",
        "audit.read",
        "codes.read",
    },
}

# Backwards-compatible name (tests/tools import it); these are seed defaults only.
ROLE_PERMISSIONS = DEFAULT_ROLE_PERMISSIONS

# Roles only a SUPER_ADMIN may grant, revoke, or manage.
PRIVILEGED_ROLES = frozenset({AdminRole.SUPER_ADMIN, AdminRole.ADMIN})


def role_permissions(role: str) -> set[str]:
    """Effective permission keys for a role (DB rows; SUPER_ADMIN is always ``*``)."""
    if role == AdminRole.SUPER_ADMIN:
        return set(SUPER_ADMIN_PERMISSIONS)
    return set(RolePermission.objects.filter(role=role).values_list("permission__key", flat=True))


def user_role(user) -> str | None:
    profile = getattr(user, "admin_profile", None) if user is not None else None
    return profile.role if profile else None


def is_super_admin(user) -> bool:
    if not user or not getattr(user, "is_authenticated", False) or getattr(user, "disabled", False):
        return False
    return bool(user.is_superuser or user_role(user) == AdminRole.SUPER_ADMIN)


def user_permissions(user: User) -> set[str]:
    if not user or not user.is_authenticated or user.disabled or not user.is_active:
        return set()
    if user.is_superuser:
        return set(SUPER_ADMIN_PERMISSIONS)
    if user.kind != UserKind.ADMIN:
        return set()
    role = user_role(user)
    if not role:
        return set()
    return role_permissions(role)


def has_permission(user: User, key: str) -> bool:
    perms = user_permissions(user)
    return "*" in perms or key in perms
