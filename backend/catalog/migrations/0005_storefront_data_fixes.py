"""Data fixes from the E2E pass (values frozen here on purpose).

* D20  - flag existing published top-level categories ``show_in_menu`` so the live menu
         keeps working once the storefront reads the flag.
* ST-20 - CODE products filed under "game-top-ups" (EA FC, Fortnite, LoL, Valorant...) move
         to a "game-currencies" category (created when needed).
* D17  - PUBG / Free Fire / Mobile Legends ID fields become numeric with sensible lengths.
* ST-16 - Arabic names for the seed variants whose ``name_ar`` is just a copy of ``name_en``.
"""

from django.db import migrations

GAME_TOP_UPS = "game-top-ups"
GAME_CURRENCIES = {
    "slug": "game-currencies",
    "name_en": "Game currencies",
    "name_ar": "عملات الألعاب",
    "href": "/category/game-currencies",
    "description_en": "In-game currency codes and points cards - redeem the code in the game or on the publisher's site.",
    "description_ar": "أكواد العملات والنقاط داخل الألعاب - استبدل الكود داخل اللعبة أو على موقع الناشر.",
}

# (product id, field key) -> (input_format, min_length, max_length)
FIELD_FORMATS = {
    ("pubg-uc", "playerId"): ("numeric", 6, 12),
    ("free-fire", "playerId"): ("numeric", 6, 12),
    ("mlbb-diamonds", "userId"): ("numeric", 5, 12),
    ("mlbb-diamonds", "zoneId"): ("numeric", 3, 6),
}
FIELD_FORMAT_SLUGS = {
    "pubg-mobile-uc": "pubg-uc",
    "free-fire-diamonds": "free-fire",
    "mobile-legends-diamonds": "mlbb-diamonds",
}

VARIANT_NAMES_AR = {
    "psn-store-10": "10 دولار",
    "psn-store-25": "25 دولار",
    "psn-store-50": "50 دولار",
    "steam-wallet-10": "10 دولار",
    "steam-wallet-20": "20 دولار",
    "steam-wallet-50": "50 دولار",
    "xbox-gift-10": "10 دولار",
    "xbox-gift-25": "25 دولار",
    "xbox-gift-50": "50 دولار",
    "nintendo-eshop-10": "10 دولار",
    "nintendo-eshop-20": "20 دولار",
    "apple-gift-25": "25 دولار",
    "apple-gift-50": "50 دولار",
    "google-play-10": "10 دولار",
    "google-play-25": "25 دولار",
    "google-play-50": "50 دولار",
    "razer-gold-10": "10 دولار",
    "razer-gold-20": "20 دولار",
    "roblox-card-10": "10 دولار / روبوكس",
    "roblox-card-25": "25 دولار / روبوكس",
    "pubg-uc-60": "60 شدة",
    "pubg-uc-325": "325 شدة",
    "pubg-uc-660": "660 شدة",
    "free-fire-100": "100 جوهرة",
    "free-fire-310": "310 جوهرة",
    "mlbb-diamonds-86": "86 ماسة",
    "mlbb-diamonds-172": "172 ماسة",
    "valorant-points-475": "475 نقطة فالورانت",
    "valorant-points-1000": "1000 نقطة فالورانت",
    "fortnite-vbucks-1000": "1,000 في-باكس",
    "ea-fc-points-500": "500 نقطة",
    "ea-fc-points-1050": "1050 نقطة",
    "lol-card-10": "10 دولار",
    "ps-plus-essential-3m": "إسنشال - 3 أشهر",
    "ps-plus-extra-12m": "إكسترا - 12 شهرًا",
}


def flag_menu_categories(apps, schema_editor):
    Category = apps.get_model("catalog", "Category")
    Category.objects.filter(status="PUBLISHED", parent__isnull=True).update(show_in_menu=True)


def move_code_products_out_of_top_ups(apps, schema_editor):
    Category = apps.get_model("catalog", "Category")
    Product = apps.get_model("catalog", "Product")
    top_ups = Category.objects.filter(slug=GAME_TOP_UPS).first()
    if top_ups is None:
        return
    misfiled = Product.objects.filter(category=top_ups, fulfillment_type="CODE")
    if not misfiled.exists():
        return
    target = Category.objects.filter(slug=GAME_CURRENCIES["slug"]).first()
    if target is None:
        last = Category.objects.order_by("-sort_order").values_list("sort_order", flat=True).first() or 0
        target = Category.objects.create(
            slug=GAME_CURRENCIES["slug"],
            name_en=GAME_CURRENCIES["name_en"],
            name_ar=GAME_CURRENCIES["name_ar"],
            href=GAME_CURRENCIES["href"],
            description_en=GAME_CURRENCIES["description_en"],
            description_ar=GAME_CURRENCIES["description_ar"],
            status="PUBLISHED",
            sort_order=last + 1,
            show_in_menu=top_ups.show_in_menu,
        )
    misfiled.update(category=target)


def numeric_player_ids(apps, schema_editor):
    Product = apps.get_model("catalog", "Product")
    Field = apps.get_model("catalog", "ProductFieldDefinition")
    ids = {pid for pid, _ in FIELD_FORMATS}
    products = Product.objects.filter(id__in=ids) | Product.objects.filter(slug__in=list(FIELD_FORMAT_SLUGS))
    for product in products.distinct():
        canonical = product.id if product.id in ids else FIELD_FORMAT_SLUGS.get(product.slug)
        for field in Field.objects.filter(product=product):
            fmt = FIELD_FORMATS.get((canonical, field.key))
            if not fmt or field.input_format != "text":
                continue
            field.input_format, field.min_length, field.max_length = fmt
            field.save(update_fields=["input_format", "min_length", "max_length"])


def arabic_variant_names(apps, schema_editor):
    Variant = apps.get_model("catalog", "ProductVariant")
    for variant in Variant.objects.filter(sku__in=list(VARIANT_NAMES_AR)):
        if not variant.name_ar or variant.name_ar == variant.name_en:
            variant.name_ar = VARIANT_NAMES_AR[variant.sku]
            variant.save(update_fields=["name_ar"])


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0004_category_menu_field_formats"),
    ]

    operations = [
        migrations.RunPython(flag_menu_categories, migrations.RunPython.noop),
        migrations.RunPython(move_code_products_out_of_top_ups, migrations.RunPython.noop),
        migrations.RunPython(numeric_player_ids, migrations.RunPython.noop),
        migrations.RunPython(arabic_variant_names, migrations.RunPython.noop),
    ]
