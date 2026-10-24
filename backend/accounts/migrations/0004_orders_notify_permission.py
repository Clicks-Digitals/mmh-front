"""D13: ``orders.notify`` (resend order emails) for SUPPORT_AGENT, ORDER_MANAGER and ADMIN.

RolePermission rows are the source of truth: the key is only added to those roles when
they already have rows (a role an administrator emptied on purpose stays empty).
"""

from django.db import migrations

KEY = "orders.notify"
DESCRIPTION = "Resend order emails to customers"
ROLES = ("SUPPORT_AGENT", "ORDER_MANAGER", "ADMIN")


def forwards(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    RolePermission = apps.get_model("accounts", "RolePermission")
    perm, _ = Permission.objects.get_or_create(key=KEY, defaults={"description": DESCRIPTION})
    for role in ROLES:
        if RolePermission.objects.filter(role=role).exists():
            RolePermission.objects.get_or_create(role=role, permission=perm)


def backwards(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Permission.objects.filter(key=KEY).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0003_user_token_version"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
