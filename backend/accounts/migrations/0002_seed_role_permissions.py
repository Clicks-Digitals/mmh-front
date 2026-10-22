"""Make RolePermission rows the single source of truth for admin RBAC.

Creates every Permission key and, for each non-SUPER_ADMIN role that has no rows yet,
seeds the historical hard-coded defaults. Roles that already have rows are left alone
so customised permissions survive. Values are frozen here on purpose.
"""

from django.db import migrations

PERMISSIONS = [
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

DEFAULTS = {
    "ADMIN": [key for key, _ in PERMISSIONS],
    "CATALOG_MANAGER": [
        "catalog.read",
        "catalog.write",
        "content.read",
        "content.write",
        "suppliers.read",
        "codes.read",
    ],
    "ORDER_MANAGER": [
        "orders.read",
        "orders.write",
        "orders.fulfill",
        "codes.read",
        "codes.manage",
        "codes.reveal",
        "customers.read",
    ],
    "CONTENT_MANAGER": ["content.read", "content.write", "catalog.read"],
    "SUPPORT_AGENT": ["orders.read", "customers.read", "codes.read"],
    "VIEWER": [
        "catalog.read",
        "orders.read",
        "customers.read",
        "content.read",
        "suppliers.read",
        "audit.read",
        "codes.read",
    ],
}


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    RolePermission = apps.get_model("accounts", "RolePermission")
    perms = {}
    for key, desc in PERMISSIONS:
        perm, _ = Permission.objects.get_or_create(key=key, defaults={"description": desc})
        perms[key] = perm
    # SUPER_ADMIN is hard-coded to "*"; stale rows would only confuse the UI.
    RolePermission.objects.filter(role="SUPER_ADMIN").delete()
    for role, keys in DEFAULTS.items():
        if RolePermission.objects.filter(role=role).exists():
            continue
        RolePermission.objects.bulk_create([RolePermission(role=role, permission=perms[k]) for k in keys])


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
