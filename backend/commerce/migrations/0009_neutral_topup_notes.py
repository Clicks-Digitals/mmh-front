"""Customer-visible top-up notes must never name the supplier (old automatic "Delivered via 1Epin")."""

from django.db import migrations

EN = "Your top-up has been added to your game account."
AR = "تمت إضافة الشحن إلى حساب اللعبة الخاص بك."


def forwards(apps, schema_editor):
    OrderItem = apps.get_model("commerce", "OrderItem")
    for item in OrderItem.objects.filter(delivery_note__icontains="1epin").select_related("order").iterator():
        item.delivery_note = AR if getattr(item.order, "locale", "en") == "ar" else EN
        item.save(update_fields=["delivery_note"])


class Migration(migrations.Migration):
    dependencies = [("commerce", "0008_backfill_code_identity_refunds_labels")]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
