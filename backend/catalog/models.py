from __future__ import annotations

from django.contrib.postgres.fields import ArrayField
from django.db import models


class PublishStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft"
    PUBLISHED = "PUBLISHED", "Published"
    ARCHIVED = "ARCHIVED", "Archived"


class FulfillmentType(models.TextChoices):
    CODE = "CODE", "Code"
    DIRECT_TOPUP = "DIRECT_TOPUP", "Direct top-up"


class ProductKind(models.TextChoices):
    GIFT_CARD = "GIFT_CARD", "Gift card"
    WALLET = "WALLET", "Wallet"
    GAME_CURRENCY = "GAME_CURRENCY", "Game currency"
    SUBSCRIPTION = "SUBSCRIPTION", "Subscription"
    DIRECT_TOPUP = "DIRECT_TOPUP", "Direct top-up"
    DIGITAL_CODE = "DIGITAL_CODE", "Digital code"


class ProductSource(models.TextChoices):
    MANUAL = "MANUAL", "Manual"
    SUPPLIER = "SUPPLIER", "Supplier"


class FieldInputType(models.TextChoices):
    TEXT = "TEXT", "Text"
    EMAIL = "EMAIL", "Email"
    TEL = "TEL", "Tel"
    SELECT = "SELECT", "Select"


class FieldInputFormat(models.TextChoices):
    """Character rules for a required customer field (D17), enforced at checkout."""

    TEXT = "text", "Any text"
    NUMERIC = "numeric", "Digits only"
    ALPHANUMERIC = "alphanumeric", "Letters and digits"
    EMAIL = "email", "Email address"
    PHONE = "phone", "Phone number"


class StockStatus(models.TextChoices):
    IN_STOCK = "IN_STOCK", "In stock"
    OUT_OF_STOCK = "OUT_OF_STOCK", "Out of stock"
    UNKNOWN = "UNKNOWN", "Unknown"


class Category(models.Model):
    slug = models.SlugField(unique=True)
    href = models.CharField(max_length=255, blank=True)
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="children"
    )
    artwork_key = models.CharField(max_length=64, blank=True)
    artwork_url = models.CharField(max_length=512, blank=True)
    # Uploaded picture (MEDIA_URL path) set via POST/DELETE admin/categories/<id>/image/.
    # Empty -> the storefront shows the built-in artwork picked by artwork_key / slug.
    image = models.CharField(max_length=512, blank=True, default="")
    status = models.CharField(max_length=16, choices=PublishStatus.choices, default=PublishStatus.PUBLISHED)
    sort_order = models.IntegerField(default=0)
    # D20: storefront header / mega menu / mobile menu / home tiles list published categories
    # with show_in_menu, ordered by sort_order then name.
    show_in_menu = models.BooleanField(default=False)
    name_en = models.CharField(max_length=160)
    name_ar = models.CharField(max_length=160, blank=True)
    description_en = models.TextField(blank=True)
    description_ar = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "name_en", "slug"]
        verbose_name_plural = "categories"

    def __str__(self) -> str:
        return self.name_en


class Platform(models.Model):
    slug = models.SlugField(unique=True)
    artwork_key = models.CharField(max_length=64, blank=True)
    # Uploaded logo (MEDIA_URL path) set via POST/DELETE admin/platforms/<id>/image/.
    image = models.CharField(max_length=512, blank=True, default="")
    status = models.CharField(max_length=16, choices=PublishStatus.choices, default=PublishStatus.PUBLISHED)
    sort_order = models.IntegerField(default=0)
    name_en = models.CharField(max_length=160)
    name_ar = models.CharField(max_length=160, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "slug"]

    def __str__(self) -> str:
        return self.name_en


class Region(models.Model):
    slug = models.SlugField(unique=True)
    currency = models.CharField(max_length=8)
    locked = models.BooleanField(default=True)
    name_en = models.CharField(max_length=160)
    name_ar = models.CharField(max_length=160, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return self.name_en


class Product(models.Model):
    id = models.CharField(max_length=64, primary_key=True)
    slug = models.SlugField(unique=True)
    kind = models.CharField(max_length=32, choices=ProductKind.choices)
    fulfillment_type = models.CharField(max_length=32, choices=FulfillmentType.choices)
    source = models.CharField(max_length=16, choices=ProductSource.choices, default=ProductSource.MANUAL)
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="products")
    platform = models.ForeignKey(Platform, on_delete=models.PROTECT, related_name="products")
    brand = models.CharField(max_length=120)
    artwork_key = models.CharField(max_length=64, blank=True, default="")
    account_currency = models.CharField(max_length=8, blank=True)
    status = models.CharField(max_length=16, choices=PublishStatus.choices, default=PublishStatus.DRAFT)
    featured = models.BooleanField(default=False)
    bestseller = models.BooleanField(default=False)
    trending = models.BooleanField(default=False)
    refundable = models.BooleanField(default=False)
    region_warning_en = models.TextField(blank=True)
    region_warning_ar = models.TextField(blank=True)
    delivery_estimate_en = models.CharField(max_length=255, blank=True)
    delivery_estimate_ar = models.CharField(max_length=255, blank=True)
    sort_order = models.IntegerField(default=0)
    rating = models.DecimalField(max_digits=3, decimal_places=2, default=0)
    review_count = models.IntegerField(default=0)
    badges = ArrayField(models.CharField(max_length=32), default=list, blank=True)
    tags = ArrayField(models.CharField(max_length=64), default=list, blank=True)
    name_en = models.CharField(max_length=255)
    name_ar = models.CharField(max_length=255, blank=True)
    short_description_en = models.TextField(blank=True)
    short_description_ar = models.TextField(blank=True)
    description_en = models.TextField(blank=True)
    description_ar = models.TextField(blank=True)
    instructions_en = models.TextField(blank=True)
    instructions_ar = models.TextField(blank=True)
    how_to_use_en = ArrayField(models.TextField(), default=list, blank=True)
    how_to_use_ar = ArrayField(models.TextField(), default=list, blank=True)
    region_restrictions_en = models.TextField(blank=True)
    region_restrictions_ar = models.TextField(blank=True)
    refund_policy_en = models.TextField(blank=True)
    refund_policy_ar = models.TextField(blank=True)
    image_url = models.CharField(max_length=512, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "slug"]

    def __str__(self) -> str:
        return self.name_en

    @property
    def price_jod(self) -> float:
        variant = self.variants.filter(published=True).order_by("sort_order", "price_fils").first()
        if not variant:
            return 0.0
        return variant.price_fils / 1000.0


class ProductVariant(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="variants")
    region = models.ForeignKey(Region, null=True, blank=True, on_delete=models.SET_NULL, related_name="variants")
    sku = models.CharField(max_length=120, unique=True)
    denomination = models.DecimalField(max_digits=12, decimal_places=2)
    package_value = models.CharField(max_length=64)
    package_currency = models.CharField(max_length=8)
    cost_fils = models.IntegerField(default=0)
    price_fils = models.IntegerField()
    compare_at_price_fils = models.IntegerField(null=True, blank=True)
    stock_status = models.CharField(max_length=16, choices=StockStatus.choices, default=StockStatus.IN_STOCK)
    min_quantity = models.IntegerField(default=1)
    max_quantity = models.IntegerField(default=5)
    sort_order = models.IntegerField(default=0)
    published = models.BooleanField(default=True)
    name_en = models.CharField(max_length=160)
    name_ar = models.CharField(max_length=160, blank=True)
    external_id = models.CharField(max_length=64, blank=True, help_text="Storefront denomination id")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "price_fils"]

    def __str__(self) -> str:
        return self.sku

    @property
    def price_jod(self) -> float:
        return self.price_fils / 1000.0

    @property
    def compare_at_price_jod(self) -> float | None:
        if self.compare_at_price_fils is None:
            return None
        return self.compare_at_price_fils / 1000.0


class ProductFieldDefinition(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="fields")
    key = models.CharField(max_length=64)
    type = models.CharField(max_length=16, choices=FieldInputType.choices, default=FieldInputType.TEXT)
    required = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)
    label_en = models.CharField(max_length=120)
    label_ar = models.CharField(max_length=120, blank=True)
    placeholder_en = models.CharField(max_length=160, blank=True)
    placeholder_ar = models.CharField(max_length=160, blank=True)
    help_text_en = models.CharField(max_length=255, blank=True)
    help_text_ar = models.CharField(max_length=255, blank=True)
    input_format = models.CharField(max_length=16, choices=FieldInputFormat.choices, default=FieldInputFormat.TEXT)
    min_length = models.PositiveIntegerField(null=True, blank=True)
    max_length = models.PositiveIntegerField(null=True, blank=True)
    # SELECT fields: [{"value": "eu", "label_en": "Europe", "label_ar": "أوروبا"}, ...]
    options = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["sort_order", "key"]
        unique_together = ("product", "key")


class MediaAsset(models.Model):
    key = models.CharField(max_length=120, unique=True)
    url = models.CharField(max_length=512)
    alt = models.CharField(max_length=255, blank=True)
    mime_type = models.CharField(max_length=64, blank=True)
    product = models.ForeignKey(
        Product, null=True, blank=True, on_delete=models.CASCADE, related_name="media"
    )
    storage_path = models.CharField(max_length=512, blank=True)
    sort_order = models.IntegerField(default=0)
    is_primary = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["sort_order", "id"]

    def __str__(self) -> str:
        return self.key
