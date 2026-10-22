"""Remove fake seed ratings: no real reviews exist, so every product goes to 0 / 0."""

from django.db import migrations


def reset_ratings(apps, schema_editor):
    Product = apps.get_model("catalog", "Product")
    Product.objects.exclude(rating=0, review_count=0).update(rating=0, review_count=0)


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0002_product_media_gallery"),
    ]

    operations = [
        migrations.RunPython(reset_ratings, migrations.RunPython.noop),
    ]
