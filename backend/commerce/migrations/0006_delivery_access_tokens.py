import secrets

from django.db import migrations, models

import commerce.models

MASK_CHARS = {"•", "*"}


def _remask(old: str) -> str:
    """Convert a legacy mask (first chars + bullets + last chars) to bullets + last 4.

    Works from the stored mask only, so no plaintext is decrypted during migration.
    """
    tail = ""
    for ch in reversed(old or ""):
        if ch in MASK_CHARS:
            break
        tail = ch + tail
        if len(tail) == 4:
            break
    if not tail:
        return "••••"
    return "••••••••" + tail


def forwards(apps, schema_editor):
    Order = apps.get_model("commerce", "Order")
    for order in Order.objects.filter(access_token="").only("id").iterator():
        Order.objects.filter(pk=order.pk).update(access_token=secrets.token_urlsafe(24))
    DigitalCode = apps.get_model("commerce", "DigitalCode")
    for code in DigitalCode.objects.only("id", "masked").iterator():
        new = _remask(code.masked)
        if new != code.masked:
            DigitalCode.objects.filter(pk=code.pk).update(masked=new)
    # Delivered timestamps for codes/items already attached to orders.
    for code in DigitalCode.objects.filter(order_item__isnull=False, delivered_at__isnull=True).only(
        "id", "created_at"
    ).iterator():
        DigitalCode.objects.filter(pk=code.pk).update(delivered_at=code.created_at)


class Migration(migrations.Migration):
    dependencies = [
        ("commerce", "0005_paypal_payment"),
    ]

    operations = [
        migrations.AddField(
            model_name="order",
            name="access_token",
            field=models.CharField(default="", editable=False, max_length=64),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="coupon",
            name="max_uses_per_customer",
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="orderitem",
            name="delivered_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="orderitem",
            name="delivery_note",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="digitalcode",
            name="delivered_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="codeimportbatch",
            name="pending_payload",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="codeimportbatch",
            name="pending_payload_nonce",
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.RunPython(forwards, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="order",
            name="access_token",
            field=models.CharField(
                default=commerce.models.generate_access_token, editable=False, max_length=64
            ),
        ),
    ]
