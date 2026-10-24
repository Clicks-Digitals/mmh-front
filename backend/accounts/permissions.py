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
    ("orders.notify", "Resend order emails to customers"),
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
        "orders.notify",
        "codes.read",
        "codes.manage",
        "codes.reveal",
        "customers.read",
    },
    AdminRole.CONTENT_MANAGER: {"content.read", "content.write", "catalog.read"},
    AdminRole.SUPPORT_AGENT: {"orders.read", "orders.notify", "customers.read", "codes.read"},
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


def role_label(role: str | None) -> str:
    """Human label for a role value (``"ORDER_MANAGER"`` -> ``"Order manager"``)."""
    if not role:
        return ""
    return dict(AdminRole.choices).get(role, str(role))


def effective_role(user) -> str | None:
    """The admin role that governs ``user``.

    The ``AdminProfile`` role wins. ``is_superuser`` only implies SUPER_ADMIN for an account
    without a profile (e.g. created by ``createsuperuser``); role changes keep the two in
    sync (D14), so a demoted superuser never keeps ``*``.
    """
    role = user_role(user)
    if role:
        return role
    if user is not None and getattr(user, "is_superuser", False):
        return AdminRole.SUPER_ADMIN
    return None


def is_super_admin(user) -> bool:
    if not user or not getattr(user, "is_authenticated", False) or getattr(user, "disabled", False):
        return False
    return effective_role(user) == AdminRole.SUPER_ADMIN


def effective_super_admins_qs():
    """Active, enabled accounts whose effective role is SUPER_ADMIN."""
    from django.db.models import Q

    return User.objects.filter(is_active=True, disabled=False).filter(
        Q(admin_profile__role=AdminRole.SUPER_ADMIN) | Q(is_superuser=True, admin_profile__isnull=True)
    )


def user_permissions(user: User) -> set[str]:
    if not user or not user.is_authenticated or user.disabled or not user.is_active:
        return set()
    if effective_role(user) == AdminRole.SUPER_ADMIN and (user.kind == UserKind.ADMIN or user.is_superuser):
        return set(SUPER_ADMIN_PERMISSIONS)
    if user.kind != UserKind.ADMIN:
        return set()
    role = user_role(user)
    if not role:
        return set()
    return role_permissions(role)


def has_permission(user: User, key) -> bool:
    """``key`` may be a single permission key or a list/tuple meaning *any of*."""
    perms = user_permissions(user)
    if "*" in perms:
        return True
    if isinstance(key, (list, tuple, set, frozenset)):
        return any(k in perms for k in key)
    return key in perms
