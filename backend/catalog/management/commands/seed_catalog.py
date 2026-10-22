from __future__ import annotations

from decimal import Decimal

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts.models import AdminProfile, AdminRole, CustomerProfile, Permission, RolePermission, UserKind
from accounts.permissions import DEFAULT_ROLE_PERMISSIONS, PERMISSION_DEFINITIONS
from catalog.models import (
    Category,
    FulfillmentType,
    Platform,
    Product,
    ProductFieldDefinition,
    ProductKind,
    ProductVariant,
    PublishStatus,
    Region,
    StockStatus,
)
from commerce.models import Coupon
from cms.models import Banner, FAQ
from suppliers.provider import ensure_mock_supplier

User = get_user_model()

# Permission keys/defaults live in accounts.permissions (seeded by migration as well).
PERMISSIONS = PERMISSION_DEFINITIONS


def fils(jod: float) -> int:
    return int(Decimal(str(jod)) * 1000)


CATALOG = [
    {
        "id": "psn-store",
        "slug": "playstation-store-wallet",
        "kind": ProductKind.WALLET,
        "fulfillment": FulfillmentType.CODE,
        "category": "gift-cards",
        "platform": "playstation",
        "brand": "PlayStation",
        "artwork": "card-psn",
        "image": "/catalog/psn-store.webp",
        "name_en": "PlayStation Store Wallet",
        "name_ar": "محفظة بلاي ستيشن",
        "price": 8.9,
        "featured": True,
        "bestseller": True,
        "denoms": [("10", "$10", 10, "USD", 8.9, 10.5), ("25", "$25", 25, "USD", 21.5, 24), ("50", "$50", 50, "USD", 39.9, 45)],
    },
    {
        "id": "steam-wallet",
        "slug": "steam-wallet",
        "kind": ProductKind.WALLET,
        "fulfillment": FulfillmentType.CODE,
        "category": "gift-cards",
        "platform": "steam",
        "brand": "Steam",
        "artwork": "card-steam",
        "image": "/catalog/steam-wallet.webp",
        "name_en": "Steam Wallet",
        "name_ar": "محفظة ستيم",
        "price": 8.5,
        "featured": True,
        "denoms": [("10", "$10", 10, "USD", 8.5, 9.9), ("20", "$20", 20, "USD", 16.5, None), ("50", "$50", 50, "USD", 39.5, 44)],
    },
    {
        "id": "xbox-gift",
        "slug": "xbox-gift-card",
        "kind": ProductKind.GIFT_CARD,
        "fulfillment": FulfillmentType.CODE,
        "category": "gift-cards",
        "platform": "xbox",
        "brand": "Xbox",
        "artwork": "card-xbox",
        "image": "/catalog/xbox-gift.webp",
        "name_en": "Xbox Gift Card",
        "name_ar": "بطاقة إكس بوكس",
        "price": 8.9,
        "denoms": [("10", "$10", 10, "USD", 8.9, None), ("25", "$25", 25, "USD", 21.9, None), ("50", "$50", 50, "USD", 42.9, None)],
    },
    {
        "id": "nintendo-eshop",
        "slug": "nintendo-eshop-card",
        "kind": ProductKind.GIFT_CARD,
        "fulfillment": FulfillmentType.CODE,
        "category": "gift-cards",
        "platform": "nintendo",
        "brand": "Nintendo",
        "artwork": "card-nintendo",
        "image": "/catalog/nintendo-eshop.webp",
        "name_en": "Nintendo eShop Card",
        "name_ar": "بطاقة نينتندو",
        "price": 9.2,
        "denoms": [("10", "$10", 10, "USD", 9.2, None), ("20", "$20", 20, "USD", 17.9, None)],
    },
    {
        "id": "apple-gift",
        "slug": "apple-gift-card",
        "kind": ProductKind.GIFT_CARD,
        "fulfillment": FulfillmentType.CODE,
        "category": "gift-cards",
        "platform": "apple",
        "brand": "Apple",
        "artwork": "card-apple",
        "image": "/catalog/apple-gift.webp",
        "name_en": "Apple Gift Card",
        "name_ar": "بطاقة آبل",
        "price": 21.9,
        "denoms": [("25", "$25", 25, "USD", 21.9, None), ("50", "$50", 50, "USD", 43.0, None)],
    },
    {
        "id": "google-play",
        "slug": "google-play-gift-card",
        "kind": ProductKind.GIFT_CARD,
        "fulfillment": FulfillmentType.CODE,
        "category": "gift-cards",
        "platform": "google",
        "brand": "Google Play",
        "artwork": "card-google",
        "image": "/catalog/google-play.webp",
        "name_en": "Google Play Gift Card",
        "name_ar": "بطاقة جوجل بلاي",
        "price": 21.5,
        "trending": True,
        "denoms": [("10", "$10", 10, "USD", 8.9, None), ("25", "$25", 25, "USD", 21.5, None), ("50", "$50", 50, "USD", 42.5, None)],
    },
    {
        "id": "razer-gold",
        "slug": "razer-gold",
        "kind": ProductKind.WALLET,
        "fulfillment": FulfillmentType.CODE,
        "category": "gift-cards",
        "platform": "razer",
        "brand": "Razer Gold",
        "artwork": "deal",
        "image": "/catalog/razer-gold.webp",
        "name_en": "Razer Gold",
        "name_ar": "ريزر جولد",
        "price": 9.5,
        "denoms": [("10", "$10", 10, "USD", 9.5, 11), ("20", "$20", 20, "USD", 18.5, None)],
    },
    {
        "id": "roblox-card",
        "slug": "roblox-gift-card",
        "kind": ProductKind.GIFT_CARD,
        "fulfillment": FulfillmentType.CODE,
        "category": "gift-cards",
        "platform": "roblox",
        "brand": "Roblox",
        "artwork": "card-roblox",
        "image": "/catalog/roblox-card.webp",
        "name_en": "Roblox Gift Card",
        "name_ar": "بطاقة روبلوكس",
        "price": 8.9,
        "denoms": [("10", "$10 / Robux", 10, "USD", 8.9, 10.5), ("25", "$25 / Robux", 25, "USD", 21.0, 24)],
    },
    {
        "id": "pubg-uc",
        "slug": "pubg-mobile-uc",
        "kind": ProductKind.DIRECT_TOPUP,
        "fulfillment": FulfillmentType.DIRECT_TOPUP,
        "category": "game-top-ups",
        "platform": "pubg",
        "brand": "PUBG Mobile",
        "artwork": "card-pubg",
        "image": "/catalog/pubg-uc.webp",
        "name_en": "PUBG Mobile UC",
        "name_ar": "شدات ببجي موبايل",
        "price": 8.5,
        "trending": True,
        "bestseller": True,
        "fields": [("playerId", "Player ID", "معرّف اللاعب")],
        "denoms": [("60", "60 UC", 60, "UC", 1.5, None), ("325", "325 UC", 325, "UC", 4.9, None), ("660", "660 UC", 660, "UC", 8.5, 9.9)],
    },
    {
        "id": "free-fire",
        "slug": "free-fire-diamonds",
        "kind": ProductKind.DIRECT_TOPUP,
        "fulfillment": FulfillmentType.DIRECT_TOPUP,
        "category": "game-top-ups",
        "platform": "free-fire",
        "brand": "Free Fire",
        "artwork": "card-ff",
        "image": "/catalog/free-fire.webp",
        "name_en": "Free Fire Diamonds",
        "name_ar": "جواهر فري فاير",
        "price": 4.5,
        "fields": [("playerId", "Player ID", "معرّف اللاعب")],
        "denoms": [("100", "100 Diamonds", 100, "DM", 1.9, None), ("310", "310 Diamonds", 310, "DM", 4.5, None)],
    },
    {
        "id": "mlbb-diamonds",
        "slug": "mobile-legends-diamonds",
        "kind": ProductKind.DIRECT_TOPUP,
        "fulfillment": FulfillmentType.DIRECT_TOPUP,
        "category": "game-top-ups",
        "platform": "mlbb",
        "brand": "Mobile Legends",
        "artwork": "card-mlbb",
        "image": "/catalog/mlbb-diamonds.webp",
        "name_en": "Mobile Legends Diamonds",
        "name_ar": "ماسات موبايل ليجندز",
        "price": 3.9,
        "fields": [("userId", "User ID", "معرّف المستخدم"), ("zoneId", "Zone ID", "معرّف المنطقة")],
        "denoms": [("86", "86 Diamonds", 86, "DM", 1.9, None), ("172", "172 Diamonds", 172, "DM", 3.9, None)],
    },
    {
        "id": "valorant-points",
        "slug": "valorant-points",
        "kind": ProductKind.GAME_CURRENCY,
        "fulfillment": FulfillmentType.CODE,
        "category": "game-top-ups",
        "platform": "valorant",
        "brand": "Valorant",
        "artwork": "card-valorant",
        "image": "/catalog/valorant-points.webp",
        "name_en": "Valorant Points",
        "name_ar": "نقاط فالورانت",
        "price": 7.9,
        "denoms": [("475", "475 VP", 475, "VP", 3.9, None), ("1000", "1000 VP", 1000, "VP", 7.9, None)],
    },
    {
        "id": "fortnite-vbucks",
        "slug": "fortnite-v-bucks",
        "kind": ProductKind.GAME_CURRENCY,
        "fulfillment": FulfillmentType.CODE,
        "category": "game-top-ups",
        "platform": "fortnite",
        "brand": "Fortnite",
        "artwork": "digital",
        "image": "/catalog/fortnite-vbucks.webp",
        "name_en": "Fortnite V-Bucks",
        "name_ar": "في باكس فورتنايت",
        "price": 8.5,
        "denoms": [("1000", "1,000 V-Bucks", 1000, "VB", 8.5, None)],
    },
    {
        "id": "ea-fc-points",
        "slug": "ea-sports-fc-points",
        "kind": ProductKind.GAME_CURRENCY,
        "fulfillment": FulfillmentType.CODE,
        "category": "game-top-ups",
        "platform": "ea",
        "brand": "EA Sports FC",
        "artwork": "card-ea",
        "image": "/catalog/ea-fc-points.webp",
        "name_en": "EA Sports FC Points",
        "name_ar": "نقاط EA Sports FC",
        "price": 9.5,
        "denoms": [("500", "500 Points", 500, "PT", 4.9, None), ("1050", "1050 Points", 1050, "PT", 9.5, None)],
    },
    {
        "id": "lol-card",
        "slug": "league-of-legends-card",
        "kind": ProductKind.GAME_CURRENCY,
        "fulfillment": FulfillmentType.CODE,
        "category": "game-top-ups",
        "platform": "riot",
        "brand": "League of Legends",
        "artwork": "digital",
        "image": "/catalog/lol-card.webp",
        "name_en": "League of Legends Card",
        "name_ar": "بطاقة ليغ أوف ليجندز",
        "price": 8.9,
        "denoms": [("10", "$10", 10, "USD", 8.9, None)],
    },
    {
        "id": "ps-plus",
        "slug": "playstation-plus",
        "kind": ProductKind.SUBSCRIPTION,
        "fulfillment": FulfillmentType.CODE,
        "category": "subscriptions",
        "platform": "playstation",
        "brand": "PlayStation Plus",
        "artwork": "card-psplus",
        "image": "/catalog/ps-plus.webp",
        "name_en": "PlayStation Plus",
        "name_ar": "بلاي ستيشن بلس",
        "price": 19.9,
        "featured": True,
        "denoms": [("essential-3m", "Essential 3 Months", 3, "MO", 19.9, None), ("extra-12m", "Extra 12 Months", 12, "MO", 59.9, None)],
    },
]


class Command(BaseCommand):
    help = "Seed MMH catalog, demo users, coupons, and mock supplier"

    @transaction.atomic
    def handle(self, *args, **options):
        if getattr(settings, "IS_PRODUCTION", False):
            raise CommandError(
                "seed_catalog is a development/staging tool and refuses to run when "
                "DJANGO_ENV=production. Use admin APIs or a deliberate data migration instead."
            )

        for key, desc in PERMISSIONS:
            Permission.objects.update_or_create(key=key, defaults={"description": desc})
        # Only seed roles that have no rows yet: the DB is the source of truth and admins may
        # have customised permissions. SUPER_ADMIN is hard-coded to "*" and needs no rows.
        for role, keys in DEFAULT_ROLE_PERMISSIONS.items():
            if role == AdminRole.SUPER_ADMIN or RolePermission.objects.filter(role=role).exists():
                continue
            for key in sorted(keys):
                RolePermission.objects.get_or_create(role=role, permission=Permission.objects.get(key=key))

        categories = {
            "gift-cards": ("Gift cards", "بطاقات الهدايا", "/gift-cards"),
            "game-top-ups": ("Game top-ups", "شحن الألعاب", "/game-top-ups"),
            "subscriptions": ("Subscriptions", "الاشتراكات", "/category/subscriptions"),
        }
        cat_objs = {}
        for i, (slug, (en, ar, href)) in enumerate(categories.items()):
            cat_objs[slug], _ = Category.objects.update_or_create(
                slug=slug,
                defaults={
                    "name_en": en,
                    "name_ar": ar,
                    "href": href,
                    "status": PublishStatus.PUBLISHED,
                    "sort_order": i,
                },
            )

        platforms = {
            "playstation": "PlayStation",
            "steam": "Steam",
            "xbox": "Xbox",
            "nintendo": "Nintendo",
            "apple": "Apple",
            "google": "Google",
            "razer": "Razer",
            "roblox": "Roblox",
            "pubg": "PUBG",
            "free-fire": "Free Fire",
            "mlbb": "Mobile Legends",
            "valorant": "Valorant",
            "fortnite": "Fortnite",
            "ea": "EA",
            "riot": "Riot",
        }
        plat_objs = {}
        for i, (slug, name) in enumerate(platforms.items()):
            plat_objs[slug], _ = Platform.objects.update_or_create(
                slug=slug,
                defaults={"name_en": name, "name_ar": name, "status": PublishStatus.PUBLISHED, "sort_order": i},
            )

        regions = {
            "us": ("United States", "الولايات المتحدة", "USD", True),
            "uae": ("UAE / MENA", "الإمارات / الشرق الأوسط", "USD", True),
            "eu": ("Europe", "أوروبا", "EUR", True),
            "global": ("In-game account", "حساب داخل اللعبة", "USD", False),
        }
        region_objs = {}
        for slug, (en, ar, currency, locked) in regions.items():
            region_objs[slug], _ = Region.objects.update_or_create(
                slug=slug,
                defaults={"name_en": en, "name_ar": ar, "currency": currency, "locked": locked},
            )

        for item in CATALOG:
            product, _ = Product.objects.update_or_create(
                id=item["id"],
                defaults={
                    "slug": item["slug"],
                    "kind": item["kind"],
                    "fulfillment_type": item["fulfillment"],
                    "category": cat_objs[item["category"]],
                    "platform": plat_objs[item["platform"]],
                    "brand": item["brand"],
                    "artwork_key": item["artwork"],
                    "image_url": item["image"],
                    "status": PublishStatus.PUBLISHED,
                    "featured": item.get("featured", False),
                    "bestseller": item.get("bestseller", False),
                    "trending": item.get("trending", False),
                    "name_en": item["name_en"],
                    "name_ar": item["name_ar"],
                    "short_description_en": f"{item['name_en']} delivered digitally via MMH.",
                    "short_description_ar": f"{item['name_ar']} يُسلّم رقمياً عبر إم إم إتش.",
                    "description_en": f"Buy {item['name_en']} instantly from MMH.",
                    "description_ar": f"اشترِ {item['name_ar']} فوراً من إم إم إتش.",
                    "refund_policy_en": "Digital products are generally not refundable after delivery.",
                    "refund_policy_ar": "المنتجات الرقمية غير قابلة للاسترجاع عادة بعد التسليم.",
                    "delivery_estimate_en": "Instant after payment confirmation",
                    "delivery_estimate_ar": "فوري بعد تأكيد الدفع",
                    # No real reviews exist; never ship fake ratings.
                    "rating": Decimal("0"),
                    "review_count": 0,
                    "badges": ["digital", "instant"],
                    "how_to_use_en": ["Complete checkout", "Receive your code or top-up confirmation", "Redeem on the official store"],
                    "how_to_use_ar": ["أكمل الدفع", "استلم الكود أو تأكيد الشحن", "فعّله على المتجر الرسمي"],
                },
            )
            ProductFieldDefinition.objects.filter(product=product).delete()
            for idx, field in enumerate(item.get("fields") or []):
                ProductFieldDefinition.objects.create(
                    product=product,
                    key=field[0],
                    required=True,
                    sort_order=idx,
                    label_en=field[1],
                    label_ar=field[2],
                    placeholder_en=f"Enter {field[1]}",
                    placeholder_ar=f"أدخل {field[2]}",
                )
            default_region = region_objs["global"] if item["fulfillment"] == FulfillmentType.DIRECT_TOPUP else region_objs["us"]
            keep_skus: list[str] = []
            for sort, denom in enumerate(item["denoms"]):
                ext_id, label, value, currency, price, compare = denom
                sku = f"{product.id}-{ext_id}"
                keep_skus.append(sku)
                ProductVariant.objects.update_or_create(
                    product=product,
                    sku=sku,
                    defaults={
                        "region": default_region,
                        "external_id": ext_id,
                        "denomination": Decimal(str(value)),
                        "package_value": str(value),
                        "package_currency": currency,
                        "price_fils": fils(price),
                        "compare_at_price_fils": fils(compare) if compare is not None else None,
                        "stock_status": StockStatus.IN_STOCK,
                        "sort_order": sort,
                        "published": True,
                        "name_en": label,
                        "name_ar": label,
                    },
                )
            # Drop unused demo variants only when they are not referenced by orders.
            for orphan in ProductVariant.objects.filter(product=product).exclude(sku__in=keep_skus):
                if not orphan.orderitem_set.exists():
                    orphan.delete()

        admin_email = (settings.BOOTSTRAP_ADMIN_EMAIL or "").strip()
        admin_password = (settings.BOOTSTRAP_ADMIN_PASSWORD or "").strip()
        if not admin_email or not admin_password:
            self.stdout.write(
                self.style.WARNING(
                    "Skipping bootstrap admin — set BOOTSTRAP_ADMIN_EMAIL and "
                    "BOOTSTRAP_ADMIN_PASSWORD to create one."
                )
            )
        elif len(admin_password) < 12:
            raise CommandError("BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters")
        else:
            admin, _ = User.objects.get_or_create(
                email=admin_email,
                defaults={
                    "first_name": "MMH Admin",
                    "kind": UserKind.ADMIN,
                    "is_staff": True,
                    "is_superuser": True,
                },
            )
            admin.first_name = admin.first_name or "MMH Admin"
            admin.kind = UserKind.ADMIN
            admin.is_staff = True
            admin.is_superuser = True
            admin.set_password(admin_password)
            admin.save()
            AdminProfile.objects.update_or_create(
                user=admin, defaults={"role": AdminRole.SUPER_ADMIN, "title": "Owner"}
            )

        is_development = bool(getattr(settings, "IS_DEVELOPMENT", False))
        if is_development and getattr(settings, "SEED_DEMO_CUSTOMER", True):
            demo, created = User.objects.get_or_create(
                email="demo@mmh.local",
                defaults={"first_name": "Demo Customer", "kind": UserKind.CUSTOMER},
            )
            if created:
                demo.set_password("DemoCustomer1!")
                demo.save()
            else:
                # Keep demo password stable for storefront demos (development only).
                demo.set_password("DemoCustomer1!")
                demo.save(update_fields=["password"])
            CustomerProfile.objects.get_or_create(user=demo, defaults={"phone": "+962700000000"})
        else:
            self.stdout.write("Skipping demo customer (development only; SEED_DEMO_CUSTOMER)")

        if is_development:
            Coupon.objects.update_or_create(
                code="MMH10",
                defaults={"description": "10% off demo", "percent_off": Decimal("10.00"), "active": True},
            )
        else:
            self.stdout.write("Skipping demo coupon MMH10 (development only)")
        Banner.objects.update_or_create(
            href="/shop",
            title_en="Shop digital codes",
            defaults={
                "title_ar": "تسوّق الأكواد الرقمية",
                "subtitle_en": "Gift cards, top-ups, and subscriptions",
                "subtitle_ar": "بطاقات هدايا وشحن واشتراكات",
                "published": True,
                "sort_order": 0,
                "desktop_image": "/home/hero-banner.jpg",
            },
        )
        FAQ.objects.update_or_create(
            question_en="How fast is delivery?",
            defaults={
                "question_ar": "ما سرعة التسليم؟",
                "answer_en": "Most codes are delivered instantly after payment is confirmed.",
                "answer_ar": "معظم الأكواد تُسلّم فوراً بعد تأكيد الدفع.",
                "published": True,
                "sort_order": 0,
            },
        )
        ensure_mock_supplier()
        self.stdout.write(self.style.SUCCESS(f"Seeded {Product.objects.count()} products, demo users, and supplier mock."))
