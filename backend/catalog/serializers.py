from __future__ import annotations

import re
import uuid
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import transaction
from django.utils.text import slugify
from rest_framework import serializers

from accounts.validators import normalize_digits
from catalog.models import (
    Category,
    FieldInputType,
    FulfillmentType,
    MediaAsset,
    Platform,
    Product,
    ProductFieldDefinition,
    ProductKind,
    ProductVariant,
    PublishStatus,
    Region,
    StockStatus,
)
from catalog.slugs import key_from_label, unique_slug
from catalog.stock import available_code_counts, available_quantities, mapping_stock_payload, variant_stock


class AutoSlugMixin:
    """CA-15: a blank/missing ``slug`` on create is derived from ``slug_source`` (unique)."""

    slug_source = "name_en"
    slug_fallback = "item"

    def validate(self, attrs):
        attrs = super().validate(attrs)
        slug = (attrs.get("slug") or "").strip()
        if not slug and (self.instance is None or "slug" in attrs):
            model = self.Meta.model
            source = attrs.get(self.slug_source) or getattr(self.instance, self.slug_source, "") or ""
            attrs["slug"] = unique_slug(
                model, source, fallback=self.slug_fallback, exclude_pk=getattr(self.instance, "pk", None)
            )
        return attrs


def _optional_slug_field():
    return serializers.SlugField(max_length=50, required=False, allow_blank=True)


def _check_unique_slug(serializer, value: str) -> str:
    value = (value or "").strip()
    if not value:
        return value
    qs = serializer.Meta.model.objects.filter(slug=value)
    if serializer.instance is not None:
        qs = qs.exclude(pk=serializer.instance.pk)
    if qs.exists():
        raise serializers.ValidationError("This slug is already used")
    return value


def media_absolute_url(request, url: str) -> str:
    """Absolute URL for uploaded media (MEDIA_URL paths); other values are returned unchanged."""
    url = url or ""
    if request and url.startswith(settings.MEDIA_URL):
        return request.build_absolute_uri(url)
    return url


class CategorySerializer(AutoSlugMixin, serializers.ModelSerializer):
    """Admin category serializer (all storefront fields writable; blank slug -> from name_en)."""

    slug_fallback = "category"
    slug = _optional_slug_field()
    products_count = serializers.IntegerField(read_only=True, required=False)
    children = serializers.SerializerMethodField()
    parent = serializers.PrimaryKeyRelatedField(queryset=Category.objects.all(), required=False, allow_null=True)
    parent_slug = serializers.CharField(source="parent.slug", read_only=True, allow_null=True, default=None)

    class Meta:
        model = Category
        fields = (
            "id",
            "slug",
            "href",
            "parent",
            "parent_slug",
            "artwork_key",
            "artwork_url",
            "status",
            "sort_order",
            "show_in_menu",
            "name_en",
            "name_ar",
            "description_en",
            "description_ar",
            "products_count",
            "children",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("created_at", "updated_at")

    def validate_slug(self, value):
        return _check_unique_slug(self, value)

    def get_children(self, obj) -> list[dict]:
        return [{"id": c.id, "slug": c.slug, "name_en": c.name_en} for c in obj.children.all()]

    def validate_parent(self, parent):
        if parent is None or self.instance is None:
            return parent
        node, seen = parent, set()
        while node is not None and node.pk not in seen:
            if node.pk == self.instance.pk:
                raise serializers.ValidationError("A category cannot be its own parent or descendant")
            seen.add(node.pk)
            node = node.parent
        return parent


class PublicCategorySerializer(serializers.ModelSerializer):
    parent = serializers.CharField(source="parent.slug", read_only=True, allow_null=True, default=None)
    artwork_url = serializers.SerializerMethodField()
    href = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = (
            "id",
            "slug",
            "href",
            "parent",
            "artwork_key",
            "artwork_url",
            "sort_order",
            "show_in_menu",
            "name_en",
            "name_ar",
            "description_en",
            "description_ar",
        )

    def get_artwork_url(self, obj) -> str:
        return media_absolute_url(self.context.get("request"), obj.artwork_url)

    def get_href(self, obj) -> str:
        return obj.href or f"/category/{obj.slug}"


class PublicPlatformSerializer(serializers.ModelSerializer):
    class Meta:
        model = Platform
        fields = ("id", "slug", "artwork_key", "sort_order", "name_en", "name_ar")


class PublicRegionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Region
        fields = ("id", "slug", "currency", "locked", "name_en", "name_ar")


class PlatformSerializer(AutoSlugMixin, serializers.ModelSerializer):
    slug_fallback = "platform"
    slug = _optional_slug_field()
    products_count = serializers.IntegerField(read_only=True, required=False)

    def validate_slug(self, value):
        return _check_unique_slug(self, value)

    class Meta:
        model = Platform
        fields = (
            "id",
            "slug",
            "artwork_key",
            "status",
            "sort_order",
            "name_en",
            "name_ar",
            "products_count",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("created_at", "updated_at")


class RegionSerializer(AutoSlugMixin, serializers.ModelSerializer):
    slug_fallback = "region"
    slug = _optional_slug_field()
    variants_count = serializers.IntegerField(read_only=True, required=False)

    def validate_slug(self, value):
        return _check_unique_slug(self, value)

    class Meta:
        model = Region
        fields = ("id", "slug", "currency", "locked", "name_en", "name_ar", "variants_count", "created_at")
        read_only_fields = ("created_at",)


class VariantSerializer(serializers.ModelSerializer):
    price_jod = serializers.FloatField(read_only=True)
    compare_at_price_jod = serializers.FloatField(read_only=True)
    region_slug = serializers.CharField(source="region.slug", read_only=True, allow_null=True)
    product = serializers.CharField(source="product_id", read_only=True)
    codes_available = serializers.SerializerMethodField()
    codes_reserved = serializers.SerializerMethodField()
    codes_delivered = serializers.SerializerMethodField()
    low_stock = serializers.SerializerMethodField()
    available_codes = serializers.SerializerMethodField()
    effective_stock_status = serializers.SerializerMethodField()
    available = serializers.SerializerMethodField()
    available_quantity = serializers.SerializerMethodField()
    product_name = serializers.CharField(source="product.name_en", read_only=True)
    fulfillment_type = serializers.CharField(source="product.fulfillment_type", read_only=True)

    class Meta:
        model = ProductVariant
        fields = (
            "id",
            "product",
            "product_name",
            "fulfillment_type",
            "sku",
            "external_id",
            "denomination",
            "package_value",
            "package_currency",
            "cost_fils",
            "price_fils",
            "compare_at_price_fils",
            "price_jod",
            "compare_at_price_jod",
            "stock_status",
            "min_quantity",
            "max_quantity",
            "sort_order",
            "published",
            "name_en",
            "name_ar",
            "region",
            "region_slug",
            "codes_available",
            "codes_reserved",
            "codes_delivered",
            "low_stock",
            "available_codes",
            "effective_stock_status",
            "available",
            "available_quantity",
        )

    def _stock(self, obj) -> tuple[str, int]:
        cache = getattr(obj, "_stock_cache", None)
        if cache is None:
            net = self.context.get("net_available")
            if net is None or obj.pk not in net:
                net = available_code_counts([obj.pk])
            cache = variant_stock(obj, net_available=net)
            obj._stock_cache = cache
        return cache

    def get_available_quantity(self, obj) -> int | None:
        if obj.product.fulfillment_type != FulfillmentType.CODE:
            return None
        return min(self._stock(obj)[1], 99)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # RO-04 / RO-11: roles that only read variants for the code-import picker do not
        # need purchase costs.
        if self.context.get("hide_cost"):
            data.pop("cost_fils", None)
        return data

    def get_available_codes(self, obj) -> int:
        return self._stock(obj)[1]

    def get_effective_stock_status(self, obj) -> str:
        return self._stock(obj)[0]

    def get_available(self, obj) -> bool:
        return self._stock(obj)[0] == StockStatus.IN_STOCK

    def get_codes_available(self, obj) -> int:
        return int(getattr(obj, "codes_available", 0) or 0)

    def get_codes_reserved(self, obj) -> int:
        return int(getattr(obj, "codes_reserved", 0) or 0)

    def get_codes_delivered(self, obj) -> int:
        return int(getattr(obj, "codes_delivered", 0) or 0)

    def get_low_stock(self, obj) -> bool:
        threshold = self.context.get("low_stock_threshold")
        if threshold is None:
            from cms.models import SiteSettings

            threshold = SiteSettings.load().low_stock_threshold
            self.context["low_stock_threshold"] = threshold
        # D24: low stock means available <= threshold (everywhere).
        return self.get_codes_available(obj) <= threshold


class VariantWriteSerializer(serializers.ModelSerializer):
    """Writable variant fields. ``stock_status`` is the manual override (OUT_OF_STOCK always wins)."""

    id = serializers.IntegerField(required=False)
    product = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all(), required=False)
    region = serializers.PrimaryKeyRelatedField(
        queryset=Region.objects.all(), required=False, allow_null=True
    )
    delete = serializers.BooleanField(required=False, default=False, write_only=True)
    # CA-21: optional; derived by fill_variant_defaults() when blank.
    sku = serializers.CharField(max_length=120, required=False, allow_blank=True)
    denomination = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True)
    package_value = serializers.CharField(max_length=64, required=False, allow_blank=True)
    package_currency = serializers.CharField(max_length=8, required=False, allow_blank=True)

    class Meta:
        model = ProductVariant
        fields = (
            "id",
            "product",
            "sku",
            "external_id",
            "denomination",
            "package_value",
            "package_currency",
            "cost_fils",
            "price_fils",
            "compare_at_price_fils",
            "stock_status",
            "min_quantity",
            "max_quantity",
            "sort_order",
            "published",
            "name_en",
            "name_ar",
            "region",
            "delete",
        )


    def validate_price_fils(self, value: int) -> int:
        if value is None or value < 0:
            raise serializers.ValidationError("Selling price cannot be negative")
        return value

    def validate_cost_fils(self, value: int) -> int:
        if value is not None and value < 0:
            raise serializers.ValidationError("Cost cannot be negative")
        return value

    def validate_compare_at_price_fils(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError("Compare-at price cannot be negative")
        return value

    def validate(self, attrs):
        sku = attrs.get("sku")
        vid = attrs.get("id") or (self.instance.pk if self.instance is not None else None)
        if sku:
            qs = ProductVariant.objects.filter(sku=sku)
            if vid:
                qs = qs.exclude(pk=vid)
            if qs.exists():
                raise serializers.ValidationError({"sku": "SKU already exists"})
        existing = self.instance
        if existing is None and attrs.get("id"):
            existing = ProductVariant.objects.filter(pk=attrs["id"]).first()
        min_q = attrs.get("min_quantity", getattr(existing, "min_quantity", 1))
        max_q = attrs.get("max_quantity", getattr(existing, "max_quantity", 5))
        if min_q is not None and min_q < 1:
            raise serializers.ValidationError({"min_quantity": "Minimum quantity must be at least 1"})
        if min_q is not None and max_q is not None and min_q > max_q:
            raise serializers.ValidationError({"max_quantity": "Maximum quantity must be >= minimum quantity"})
        return attrs

    def to_representation(self, instance):
        if self.parent is not None:
            return super().to_representation(instance)
        from catalog.stock import annotate_stock
        from catalog.views import _variant_code_queryset

        fresh = annotate_stock(_variant_code_queryset()).filter(pk=instance.pk).first() or instance
        return VariantSerializer(fresh, context=self.context).data


FIELD_PUBLIC_FIELDS = (
    "id",
    "key",
    "type",
    "required",
    "sort_order",
    "label_en",
    "label_ar",
    "placeholder_en",
    "placeholder_ar",
    "help_text_en",
    "help_text_ar",
    "input_format",
    "min_length",
    "max_length",
    "options",
)

FIELD_KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")


class FieldSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductFieldDefinition
        fields = FIELD_PUBLIC_FIELDS


def normalize_field_options(value) -> list[dict]:
    """Validate SELECT options: list of ``{value, label_en, label_ar}`` (value derived from label_en)."""
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        raise serializers.ValidationError("Options must be a list")
    out, seen = [], set()
    for idx, raw in enumerate(value):
        if not isinstance(raw, dict):
            raise serializers.ValidationError(f"Option {idx + 1} must be an object")
        label_en = str(raw.get("label_en") or "").strip()
        label_ar = str(raw.get("label_ar") or "").strip()
        val = str(raw.get("value") or "").strip()
        if not label_en:
            raise serializers.ValidationError(f"Option {idx + 1}: English label is required")
        if not val:
            val = key_from_label(label_en, fallback=f"option_{idx + 1}")
        if len(val) > 120 or len(label_en) > 160 or len(label_ar) > 160:
            raise serializers.ValidationError(f"Option {idx + 1} is too long")
        if val in seen:
            raise serializers.ValidationError(f"Option value '{val}' is used twice")
        seen.add(val)
        out.append({"value": val, "label_en": label_en, "label_ar": label_ar})
    return out


class FieldWriteSerializer(serializers.ModelSerializer):
    """D17 / CA-22. ``key`` is optional: derived from ``label_en`` (lowercase_with_underscores)."""

    id = serializers.IntegerField(required=False)
    delete = serializers.BooleanField(required=False, default=False, write_only=True)
    key = serializers.CharField(max_length=64, required=False, allow_blank=True)
    options = serializers.JSONField(required=False)

    class Meta:
        model = ProductFieldDefinition
        fields = FIELD_PUBLIC_FIELDS + ("delete",)
        # Uniqueness of (product, key) is enforced in ProductWriteSerializer._upsert_fields.
        validators: list = []

    def validate_key(self, value: str) -> str:
        value = (value or "").strip()
        if value and not FIELD_KEY_RE.fullmatch(value):
            raise serializers.ValidationError(
                "Key must start with a letter and use only letters, digits and underscores"
            )
        return value

    def validate_options(self, value):
        return normalize_field_options(value)

    def validate(self, attrs):
        if attrs.get("delete"):
            return attrs
        existing = self.instance
        if existing is None and attrs.get("id"):
            existing = ProductFieldDefinition.objects.filter(pk=attrs["id"]).first()

        def merged(name, default=None):
            if name in attrs:
                return attrs[name]
            return getattr(existing, name, default) if existing is not None else default

        if existing is None and not (attrs.get("label_en") or "").strip():
            raise serializers.ValidationError({"label_en": ["English label is required"]})
        ftype = merged("type", FieldInputType.TEXT)
        options = merged("options", []) or []
        if ftype == FieldInputType.SELECT and not options:
            raise serializers.ValidationError({"options": ["A dropdown field needs at least one option"]})
        min_len, max_len = merged("min_length"), merged("max_length")
        if max_len is not None and max_len < 1:
            raise serializers.ValidationError({"max_length": ["Maximum length must be at least 1"]})
        if min_len is not None and max_len is not None and min_len > max_len:
            raise serializers.ValidationError({"max_length": ["Maximum length must be >= minimum length"]})
        return attrs


class ProductListSerializer(serializers.ModelSerializer):
    price_jod = serializers.SerializerMethodField()
    price_min_fils = serializers.IntegerField(read_only=True, required=False)
    price_max_fils = serializers.IntegerField(read_only=True, required=False)
    price_min_jod = serializers.SerializerMethodField()
    price_max_jod = serializers.SerializerMethodField()
    variants_count = serializers.IntegerField(read_only=True, required=False)
    codes_available = serializers.IntegerField(read_only=True, required=False)
    category_slug = serializers.CharField(source="category.slug", read_only=True)
    category_name = serializers.CharField(source="category.name_en", read_only=True)
    platform_slug = serializers.CharField(source="platform.slug", read_only=True)
    platform_name = serializers.CharField(source="platform.name_en", read_only=True)
    supplier_names = serializers.SerializerMethodField()
    region_labels = serializers.SerializerMethodField()
    primary_image_url = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = (
            "id",
            "slug",
            "kind",
            "fulfillment_type",
            "brand",
            "artwork_key",
            "image_url",
            "primary_image_url",
            "status",
            "featured",
            "bestseller",
            "trending",
            "rating",
            "review_count",
            "badges",
            "tags",
            "name_en",
            "name_ar",
            "short_description_en",
            "short_description_ar",
            "price_jod",
            "price_min_fils",
            "price_max_fils",
            "price_min_jod",
            "price_max_jod",
            "variants_count",
            "codes_available",
            "category_slug",
            "category_name",
            "platform_slug",
            "platform_name",
            "category_id",
            "platform_id",
            "supplier_names",
            "region_labels",
            "updated_at",
            "created_at",
        )

    def get_price_jod(self, obj) -> float:
        min_fils = getattr(obj, "price_min_fils", None)
        if min_fils is not None:
            return float(min_fils) / 1000.0
        return float(obj.price_jod)

    def get_price_min_jod(self, obj) -> float | None:
        v = getattr(obj, "price_min_fils", None)
        return None if v is None else float(v) / 1000.0

    def get_price_max_jod(self, obj) -> float | None:
        v = getattr(obj, "price_max_fils", None)
        return None if v is None else float(v) / 1000.0

    def get_supplier_names(self, obj) -> list[str]:
        names = getattr(obj, "_supplier_names", None)
        if names is not None:
            return names
        return sorted({m.supplier.name for m in obj.supplier_mappings.select_related("supplier").all()})

    def get_region_labels(self, obj) -> list[str]:
        labels = getattr(obj, "_region_labels", None)
        if labels is not None:
            return labels
        # CA-20: only published variants define the regions shown in lists.
        return sorted({v.region.name_en for v in obj.variants.all() if v.region_id and v.published})

    def get_primary_image_url(self, obj) -> str:
        """Primary uploaded media, else ``image_url``, else "" (never a guessed path)."""
        request = self.context.get("request")
        prefetched = getattr(obj, "_prefetched_objects_cache", {})
        if "media" in prefetched:
            media = list(prefetched["media"])
        else:
            media = list(obj.media.all()) if obj.pk else []
        primary = next((m for m in media if m.is_primary), None)
        url = (primary.url if primary and primary.url else "") or (obj.image_url or "")
        # Only uploaded media lives on the API host; other relative paths are storefront assets.
        return media_absolute_url(request, url)


class MediaAssetSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = MediaAsset
        fields = (
            "id",
            "key",
            "url",
            "alt",
            "mime_type",
            "product",
            "sort_order",
            "is_primary",
            "created_at",
        )
        read_only_fields = ("id", "key", "mime_type", "product", "created_at")

    def get_url(self, obj) -> str:
        return media_absolute_url(self.context.get("request"), obj.url)


class ProductDetailSerializer(ProductListSerializer):
    variants = VariantSerializer(many=True, read_only=True)
    fields = FieldSerializer(many=True, read_only=True)
    media = MediaAssetSerializer(many=True, read_only=True)
    category = CategorySerializer(read_only=True)
    platform = PlatformSerializer(read_only=True)
    supplier_mappings = serializers.SerializerMethodField()
    warnings = serializers.SerializerMethodField()

    class Meta(ProductListSerializer.Meta):
        fields = ProductListSerializer.Meta.fields + (
            "warnings",
            "description_en",
            "description_ar",
            "instructions_en",
            "instructions_ar",
            "how_to_use_en",
            "how_to_use_ar",
            "region_restrictions_en",
            "region_restrictions_ar",
            "refund_policy_en",
            "refund_policy_ar",
            "region_warning_en",
            "region_warning_ar",
            "delivery_estimate_en",
            "delivery_estimate_ar",
            "account_currency",
            "source",
            "refundable",
            "sort_order",
            "variants",
            "fields",
            "media",
            "category",
            "platform",
            "supplier_mappings",
        )

    def get_warnings(self, obj) -> list[str]:
        """CA-20: publishing is allowed, but a published product with nothing to buy is flagged."""
        warnings = []
        if obj.status == PublishStatus.PUBLISHED and not any(v.published for v in obj.variants.all()):
            warnings.append("no_published_variants")
        return warnings

    def get_supplier_mappings(self, obj) -> list[dict]:
        rows = []
        qs = obj.supplier_mappings.select_related("supplier", "variant").all()
        for m in qs:
            rows.append(
                {
                    "id": m.id,
                    "supplier_id": m.supplier_id,
                    "supplier_slug": m.supplier.slug,
                    "supplier_name": m.supplier.name,
                    "product": m.product_id,
                    "variant": m.variant_id,
                    "variant_sku": m.variant.sku if m.variant_id else None,
                    "external_product_id": m.external_product_id,
                    "external_name": m.external_name,
                    "ignored": m.ignored,
                    "created_at": m.created_at,
                    **mapping_stock_payload(m),
                }
            )
        return rows


class PublicVariantSerializer(serializers.ModelSerializer):
    price_jod = serializers.FloatField(read_only=True)
    compare_at_price_jod = serializers.FloatField(read_only=True)
    region_slug = serializers.CharField(source="region.slug", read_only=True, allow_null=True)
    region_name_en = serializers.CharField(source="region.name_en", read_only=True, allow_null=True)
    region_name_ar = serializers.CharField(source="region.name_ar", read_only=True, allow_null=True)
    region_locked = serializers.BooleanField(source="region.locked", read_only=True, allow_null=True)
    region = serializers.SerializerMethodField()
    stock_status = serializers.SerializerMethodField()
    available = serializers.SerializerMethodField()
    available_quantity = serializers.SerializerMethodField()

    class Meta:
        model = ProductVariant
        fields = (
            "id",
            "external_id",
            "denomination",
            "package_value",
            "package_currency",
            "price_jod",
            "compare_at_price_jod",
            "stock_status",
            "min_quantity",
            "max_quantity",
            "sort_order",
            "name_en",
            "name_ar",
            "region_slug",
            "region_name_en",
            "region_name_ar",
            "region_locked",
            "region",
            "available",
            "available_quantity",
        )

    def _status(self, obj) -> str:
        cache = getattr(obj, "_stock_cache", None)
        if cache is None:
            cache = variant_stock(
                obj,
                fulfillment_type=self.context.get("fulfillment_type"),
                net_available=self.context.get("net_available"),
            )
            obj._stock_cache = cache
        return cache[0]

    def get_available_quantity(self, obj) -> int | None:
        """D2: CODE variants -> min(sellable codes, 99) (0 when out of stock); top-ups -> null."""
        ftype = self.context.get("fulfillment_type") or obj.product.fulfillment_type
        if ftype != FulfillmentType.CODE:
            return None
        if self._status(obj) != StockStatus.IN_STOCK:
            return 0
        qty = (self.context.get("available_quantity") or {}).get(obj.pk)
        if qty is None:
            qty = available_quantities([obj.pk]).get(obj.pk, 0)
        if qty == 0 and getattr(obj, "_has_supplier_mapping", False):
            # Supplier-backed (live) stock: the store may sell up to the per-order maximum.
            return min(obj.max_quantity or 99, 99)
        return qty

    def get_stock_status(self, obj) -> str:
        """Effective status: manual override + available codes / supplier mapping."""
        return self._status(obj)

    def get_available(self, obj) -> bool:
        return self._status(obj) == StockStatus.IN_STOCK

    def get_region(self, obj) -> dict | None:
        if not obj.region_id:
            return None
        r = obj.region
        return {"slug": r.slug, "name_en": r.name_en, "name_ar": r.name_ar, "currency": r.currency}


_PUBLIC_EXCLUDED = {"supplier_names", "codes_available", "variants_count", "price_min_fils", "price_max_fils"}


class PublicProductSerializer(ProductListSerializer):
    """Storefront-facing product: no cost, stock counts, or supplier data."""

    variants = serializers.SerializerMethodField()
    in_stock = serializers.SerializerMethodField()
    fields = FieldSerializer(many=True, read_only=True)
    media = MediaAssetSerializer(many=True, read_only=True)
    category = PublicCategorySerializer(read_only=True)
    platform = PublicPlatformSerializer(read_only=True)

    class Meta(ProductListSerializer.Meta):
        fields = tuple(f for f in ProductListSerializer.Meta.fields if f not in _PUBLIC_EXCLUDED) + (
            "in_stock",
            "description_en",
            "description_ar",
            "instructions_en",
            "instructions_ar",
            "how_to_use_en",
            "how_to_use_ar",
            "region_restrictions_en",
            "region_restrictions_ar",
            "refund_policy_en",
            "refund_policy_ar",
            "region_warning_en",
            "region_warning_ar",
            "delivery_estimate_en",
            "delivery_estimate_ar",
            "account_currency",
            "refundable",
            "sort_order",
            "variants",
            "fields",
            "media",
            "category",
            "platform",
        )

    def _published_variants(self, obj) -> list[ProductVariant]:
        return [v for v in obj.variants.all() if v.published]

    def _stock_maps(self, obj) -> tuple[dict, dict]:
        """Reservation-aware counts for this product's CODE variants (batched per list page
        when the view pre-fills ``net_available`` / ``available_quantity`` in the context)."""
        net = self.context.setdefault("net_available", {})
        qty = self.context.setdefault("available_quantity", {})
        if obj.fulfillment_type == FulfillmentType.CODE:
            missing = [v.pk for v in self._published_variants(obj) if v.pk not in net]
            if missing:
                net.update(available_code_counts(missing))
                qty.update(available_quantities(missing))
        return net, qty

    def get_variants(self, obj) -> list[dict]:
        net, qty = self._stock_maps(obj)
        context = {
            **self.context,
            "fulfillment_type": obj.fulfillment_type,
            "net_available": net,
            "available_quantity": qty,
        }
        return PublicVariantSerializer(self._published_variants(obj), many=True, context=context).data

    def get_in_stock(self, obj) -> bool:
        net, _ = self._stock_maps(obj)
        for v in self._published_variants(obj):
            if getattr(v, "_stock_cache", None) is None:
                v._stock_cache = variant_stock(v, fulfillment_type=obj.fulfillment_type, net_available=net)
            if v._stock_cache[0] == StockStatus.IN_STOCK:
                return True
        return False

    def get_region_labels(self, obj) -> list[str]:
        return sorted({v.region.name_en for v in obj.variants.all() if v.published and v.region_id})

    def get_price_jod(self, obj) -> float:
        prices = [v.price_fils for v in obj.variants.all() if v.published]
        return min(prices) / 1000.0 if prices else 0.0

    def get_price_min_jod(self, obj) -> float | None:
        prices = [v.price_fils for v in obj.variants.all() if v.published]
        return min(prices) / 1000.0 if prices else None

    def get_price_max_jod(self, obj) -> float | None:
        prices = [v.price_fils for v in obj.variants.all() if v.published]
        return max(prices) / 1000.0 if prices else None


_NUMBER_RE = re.compile(r"\d[\d,]*(?:\.\d+)?")


def number_from_name(name: str) -> Decimal | None:
    """First number in a variant name: ``"$10"`` -> 10, ``"1,000 V-Bucks"`` -> 1000."""
    match = _NUMBER_RE.search(normalize_digits(name or ""))
    if not match:
        return None
    try:
        return Decimal(match.group().replace(",", ""))
    except InvalidOperation:
        return None


def _plain_number(value: Decimal) -> str:
    text = format(value.normalize(), "f") if value == value.to_integral() else format(value, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def fill_variant_defaults(item: dict, product: Product, instance: ProductVariant | None = None) -> dict:
    """CA-21: derive optional variant fields (only on create, or when sent blank on update).

    * ``package_currency``: region currency -> product ``account_currency`` -> ``"USD"``.
    * ``denomination``: first number in ``name_en`` (``"$25"`` -> 25), else 0.
    * ``package_value``: the denomination as plain text (``"25"``), else ``name_en``.
    * ``sku``: ``<product id>-<slug of name_en>`` made unique.
    """
    creating = instance is None
    name = item.get("name_en") or (instance.name_en if instance is not None else "") or ""
    region = item["region"] if "region" in item else (instance.region if instance is not None else None)
    if not (item.get("package_currency") or "").strip() and (creating or "package_currency" in item):
        item["package_currency"] = ((region.currency if region else "") or product.account_currency or "USD").upper()[:8]
    number = number_from_name(name)
    if item.get("denomination") is None and (creating or "denomination" in item):
        item["denomination"] = number if number is not None else Decimal("0")
    if not (item.get("package_value") or "").strip() and (creating or "package_value" in item):
        denom = item.get("denomination") if item.get("denomination") is not None else getattr(instance, "denomination", None)
        if denom:
            item["package_value"] = _plain_number(Decimal(denom))[:64]
        else:
            item["package_value"] = (name or "1")[:64]
    if creating and not (item.get("sku") or "").strip():
        base = f"{product.pk}-{slugify(name) or uuid.uuid4().hex[:6]}"[:110]
        candidate, n = base, 2
        while ProductVariant.objects.filter(sku=candidate).exists():
            candidate = f"{base}-{n}"
            n += 1
        item["sku"] = candidate
    elif "sku" in item and not (item.get("sku") or "").strip():
        item.pop("sku")  # blank on update keeps the existing SKU
    return item


# CA-19: kinds that may use DIRECT_TOPUP fulfillment.
TOPUP_KINDS = frozenset({ProductKind.DIRECT_TOPUP, ProductKind.GAME_CURRENCY})


class ProductWriteSerializer(serializers.ModelSerializer):
    """Create/update a product with nested variants and fields.

    CA-19 defaults on create: ``id`` from slug, ``slug`` from ``name_en``, ``kind`` GIFT_CARD
    (DIRECT_TOPUP when the fulfillment is a top-up), ``fulfillment_type`` from kind,
    ``brand`` from the platform name, ``artwork_key`` optional.
    """

    id = serializers.CharField(max_length=64, required=False, allow_blank=True)
    slug = serializers.SlugField(max_length=50, required=False, allow_blank=True)
    kind = serializers.ChoiceField(choices=ProductKind.choices, required=False)
    fulfillment_type = serializers.ChoiceField(choices=FulfillmentType.choices, required=False)
    brand = serializers.CharField(max_length=120, required=False, allow_blank=True)
    artwork_key = serializers.CharField(max_length=64, required=False, allow_blank=True)
    category_id = serializers.PrimaryKeyRelatedField(queryset=Category.objects.all(), source="category")
    platform_id = serializers.PrimaryKeyRelatedField(queryset=Platform.objects.all(), source="platform")
    variants = VariantWriteSerializer(many=True, required=False)
    fields = FieldWriteSerializer(many=True, required=False)

    class Meta:
        model = Product
        fields = (
            "id",
            "slug",
            "kind",
            "fulfillment_type",
            "source",
            "category_id",
            "platform_id",
            "brand",
            "artwork_key",
            "account_currency",
            "status",
            "featured",
            "bestseller",
            "trending",
            "refundable",
            "region_warning_en",
            "region_warning_ar",
            "delivery_estimate_en",
            "delivery_estimate_ar",
            "sort_order",
            "badges",
            "tags",
            "name_en",
            "name_ar",
            "short_description_en",
            "short_description_ar",
            "description_en",
            "description_ar",
            "instructions_en",
            "instructions_ar",
            "how_to_use_en",
            "how_to_use_ar",
            "region_restrictions_en",
            "region_restrictions_ar",
            "refund_policy_en",
            "refund_policy_ar",
            "image_url",
            "variants",
            "fields",
        )

    def validate_slug(self, value: str) -> str:
        value = (value or "").strip()
        if not value:
            return value
        qs = Product.objects.filter(slug=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Slug already exists")
        return value

    def validate_id(self, value: str) -> str:
        value = (value or "").strip()
        if self.instance is not None:
            return value
        if value and Product.objects.filter(pk=value).exists():
            raise serializers.ValidationError("A product with this ID already exists")
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        inst = self.instance
        if inst is not None:
            attrs.pop("id", None)  # the primary key never changes
        kind = attrs.get("kind") or (inst.kind if inst is not None else None)
        fulfillment = attrs.get("fulfillment_type") or (inst.fulfillment_type if inst is not None else None)
        if inst is None:
            if not kind:
                kind = ProductKind.DIRECT_TOPUP if fulfillment == FulfillmentType.DIRECT_TOPUP else ProductKind.GIFT_CARD
            if not fulfillment:
                fulfillment = FulfillmentType.DIRECT_TOPUP if kind == ProductKind.DIRECT_TOPUP else FulfillmentType.CODE
            attrs["kind"], attrs["fulfillment_type"] = kind, fulfillment
        if fulfillment == FulfillmentType.DIRECT_TOPUP and kind not in TOPUP_KINDS:
            raise serializers.ValidationError(
                {"kind": ["Direct top-up fulfillment only fits the Direct top-up or Game currency kinds"]}
            )
        if kind == ProductKind.DIRECT_TOPUP and fulfillment != FulfillmentType.DIRECT_TOPUP:
            raise serializers.ValidationError(
                {"fulfillment_type": ["Direct top-up products must use Direct top-up fulfillment"]}
            )
        if inst is None or "slug" in attrs:
            if not attrs.get("slug"):
                source = attrs.get("name_en") or (inst.name_en if inst is not None else "")
                attrs["slug"] = unique_slug(
                    Product, source, fallback="product", exclude_pk=getattr(inst, "pk", None)
                )
        if inst is None and not attrs.get("id"):
            attrs["id"] = unique_slug(Product, attrs["slug"], field="pk", max_length=64, fallback="product")
        if not (attrs.get("brand") or "").strip() and (inst is None or "brand" in attrs):
            platform = attrs.get("platform") or (inst.platform if inst is not None else None)
            attrs["brand"] = (platform.name_en if platform else "") or attrs.get("name_en") or ""
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        variants_data = validated_data.pop("variants", [])
        fields_data = validated_data.pop("fields", [])
        validated_data.setdefault("artwork_key", "")
        product = Product.objects.create(**validated_data)
        self._upsert_variants(product, variants_data)
        self._upsert_fields(product, fields_data)
        return product

    @transaction.atomic
    def update(self, instance, validated_data):
        variants_data = validated_data.pop("variants", None)
        fields_data = validated_data.pop("fields", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if variants_data is not None:
            self._upsert_variants(instance, variants_data)
        if fields_data is not None:
            self._upsert_fields(instance, fields_data)
        return instance

    def _upsert_variants(self, product: Product, variants_data: list[dict]) -> None:
        from commerce.models import DigitalCode, OrderItem

        for item in variants_data:
            item = dict(item)
            delete = item.pop("delete", False)
            vid = item.pop("id", None)
            item.pop("product", None)
            if delete:
                if not vid:
                    continue
                variant = ProductVariant.objects.filter(product=product, pk=vid).first()
                if not variant:
                    continue
                has_history = (
                    DigitalCode.objects.filter(variant=variant).exists()
                    or OrderItem.objects.filter(variant=variant).exists()
                )
                if has_history:
                    variant.published = False
                    variant.save(update_fields=["published", "updated_at"])
                else:
                    variant.delete()
                continue
            if vid:
                variant = ProductVariant.objects.filter(product=product, pk=vid).first()
                if not variant:
                    raise serializers.ValidationError({"variants": f"Variant {vid} not found on product"})
                fill_variant_defaults(item, product, variant)
                for attr, value in item.items():
                    setattr(variant, attr, value)
                try:
                    variant.save()
                except Exception as exc:
                    if "sku" in str(exc).lower() or "unique" in str(exc).lower():
                        raise serializers.ValidationError({"variants": "SKU already exists"}) from exc
                    raise
            else:
                if not (item.get("name_en") or "").strip():
                    raise serializers.ValidationError({"variants": "Each new variant needs an English name"})
                if item.get("price_fils") is None:
                    raise serializers.ValidationError({"variants": "Each new variant needs a selling price"})
                fill_variant_defaults(item, product)
                try:
                    ProductVariant.objects.create(product=product, **item)
                except Exception as exc:
                    if "sku" in str(exc).lower() or "unique" in str(exc).lower():
                        raise serializers.ValidationError({"variants": "SKU already exists"}) from exc
                    raise

    def _upsert_fields(self, product: Product, fields_data: list[dict]) -> None:
        # Deletes first so a removed key can be reused in the same request.
        for item in fields_data:
            if item.get("delete") and item.get("id"):
                ProductFieldDefinition.objects.filter(product=product, pk=item["id"]).delete()
        for item in fields_data:
            item = dict(item)
            delete = item.pop("delete", False)
            fid = item.pop("id", None)
            if delete:
                continue
            field = None
            if fid:
                field = ProductFieldDefinition.objects.filter(product=product, pk=fid).first()
                if not field:
                    raise serializers.ValidationError({"fields": f"Field {fid} not found on product"})
            taken = set(
                ProductFieldDefinition.objects.filter(product=product)
                .exclude(pk=getattr(field, "pk", None))
                .values_list("key", flat=True)
            )
            key = (item.get("key") or "").strip()
            if not key and (field is None or "key" in item):
                label = item.get("label_en") or getattr(field, "label_en", "")
                base = key_from_label(label, fallback="field")
                key, n = base, 2
                while key in taken:
                    key = f"{base}_{n}"[:64]
                    n += 1
                item["key"] = key
            elif key and key in taken:
                raise serializers.ValidationError({"fields": f"Two fields use the key '{key}'"})
            if field is not None:
                if "key" in item and not item["key"]:
                    item.pop("key")
                for attr, value in item.items():
                    setattr(field, attr, value)
                field.save()
            else:
                ProductFieldDefinition.objects.create(product=product, **item)

    def to_representation(self, instance):
        return ProductDetailSerializer(instance, context=self.context).data
