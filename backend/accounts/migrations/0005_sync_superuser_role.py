"""D14 / RO-06: make ``is_superuser`` and the SUPER_ADMIN role agree.

* Profile role SUPER_ADMIN            -> is_superuser = True (and kind ADMIN, is_staff).
* Superuser without a profile         -> gets a SUPER_ADMIN profile.
* Superuser whose profile role is lower (the "demoted superuser" bug) -> is_superuser = False,
  unless that would leave no active SUPER_ADMIN at all; then the role is restored instead.
"""

from django.db import migrations
from django.db.models import Q


def forwards(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    AdminProfile = apps.get_model("accounts", "AdminProfile")

    for profile in AdminProfile.objects.filter(role="SUPER_ADMIN").select_related("user"):
        user = profile.user
        if not user.is_superuser or user.kind != "ADMIN" or not user.is_staff:
            User.objects.filter(pk=user.pk).update(is_superuser=True, kind="ADMIN", is_staff=True)

    for user in User.objects.filter(is_superuser=True, admin_profile__isnull=True):
        AdminProfile.objects.create(user=user, role="SUPER_ADMIN", title="")
        if user.kind != "ADMIN" or not user.is_staff:
            User.objects.filter(pk=user.pk).update(kind="ADMIN", is_staff=True)

    def active_super_admins():
        return User.objects.filter(is_active=True, disabled=False).filter(
            Q(admin_profile__role="SUPER_ADMIN")
        )

    demoted = User.objects.filter(is_superuser=True).exclude(admin_profile__role="SUPER_ADMIN").order_by("id")
    for user in demoted:
        if active_super_admins().exclude(pk=user.pk).exists():
            User.objects.filter(pk=user.pk).update(is_superuser=False)
        else:
            AdminProfile.objects.filter(user=user).update(role="SUPER_ADMIN")


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0004_orders_notify_permission"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
