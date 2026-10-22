from __future__ import annotations

from django.conf import settings
from django.db import transaction
from rest_framework import serializers

from catalog.models import (
    Category,
    MediaAsset,
    Platform,
    Product,
    ProductFieldDefinition,
    ProductVariant,
    Region,
    StockStatus,
)
from catalog.stock import variant_stock


def media_absolute_url(request, url: str) -> str:
    """Absolute URL for uploaded media (MEDIA_URL paths); other values are returned unchanged."""
    url = url or ""
    if request and url.startswith(settings.MEDIA_URL):
        return request.build_absolute_uri(url)
    return url


class CategorySerializer(serializers.ModelSerializer):
    """Admin category serializer (all storefront fields writable)."""

    products_count = serializers.IntegerField(read_only=True, required=False)
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
            "name_en",
            "name_ar",
            "description_en",
            "description_ar",
            "products_count",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("created_at", "updated_at")

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


class PlatformSerializer(serializers.ModelSerializer):
    products_count = serializers.IntegerField(read_only=True, required=False)

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


class RegionSerializer(serializers.ModelSerializer):
    variants_count = serializers.IntegerField(read_only=True, required=False)

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
        )

    def _stock(self, obj) -> tuple[str, int]:
        cache = getattr(obj, "_stock_cache", None)
        if cache is None:
            cache = variant_stock(obj)
            obj._stock_cache = cache
        return cache

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
        return self.get_codes_available(obj) < threshold


class VariantWriteSerializer(serializers.ModelSerializer):
    """Writable variant fields. ``stock_status`` is the manual override (OUT_OF_STOCK always wins)."""

    id = serializers.IntegerField(required=False)
    product = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all(), required=False)
    region = serializers.PrimaryKeyRelatedField(
        queryset=Region.objects.all(), required=False, allow_null=True
    )
    delete = serializers.BooleanField(required=False, default=False, write_only=True)

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
        extra_kwargs = {"sku": {"validators": []}}

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


class FieldSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductFieldDefinition
        fields = (
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
        )


class FieldWriteSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(required=False)
    delete = serializers.BooleanField(required=False, default=False, write_only=True)

    class Meta:
        model = ProductFieldDefinition
        fields = (
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
            "delete",
        )


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
        return sorted(
            {
                v.region.name_en
                for v in obj.variants.select_related("region").all()
                if v.region_id
            }
        )

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

    class Meta(ProductListSerializer.Meta):
        fields = ProductListSerializer.Meta.fields + (
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
        )

    def _status(self, obj) -> str:
        cache = getattr(obj, "_stock_cache", None)
        if cache is None:
            cache = variant_stock(obj, fulfillment_type=self.context.get("fulfillment_type"))
            obj._stock_cache = cache
        return cache[0]

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

    def get_variants(self, obj) -> list[dict]:
        context = {**self.context, "fulfillment_type": obj.fulfillment_type}
        return PublicVariantSerializer(self._published_variants(obj), many=True, context=context).data

    def get_in_stock(self, obj) -> bool:
        for v in self._published_variants(obj):
            if getattr(v, "_stock_cache", None) is None:
                v._stock_cache = variant_stock(v, fulfillment_type=obj.fulfillment_type)
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


class ProductWriteSerializer(serializers.ModelSerializer):
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
        qs = Product.objects.filter(slug=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Slug already exists")
        return value

    @transaction.atomic
    def create(self, validated_data):
        variants_data = validated_data.pop("variants", [])
        fields_data = validated_data.pop("fields", [])
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
                for attr, value in item.items():
                    setattr(variant, attr, value)
                try:
                    variant.save()
                except Exception as exc:
                    if "sku" in str(exc).lower() or "unique" in str(exc).lower():
                        raise serializers.ValidationError({"variants": "SKU already exists"}) from exc
                    raise
            else:
                try:
                    ProductVariant.objects.create(product=product, **item)
                except Exception as exc:
                    if "sku" in str(exc).lower() or "unique" in str(exc).lower():
                        raise serializers.ValidationError({"variants": "SKU already exists"}) from exc
                    raise

    def _upsert_fields(self, product: Product, fields_data: list[dict]) -> None:
        for item in fields_data:
            item = dict(item)
            delete = item.pop("delete", False)
            fid = item.pop("id", None)
            if delete:
                if fid:
                    ProductFieldDefinition.objects.filter(product=product, pk=fid).delete()
                continue
            if fid:
                field = ProductFieldDefinition.objects.filter(product=product, pk=fid).first()
                if not field:
                    raise serializers.ValidationError({"fields": f"Field {fid} not found on product"})
                for attr, value in item.items():
                    setattr(field, attr, value)
                field.save()
            else:
                ProductFieldDefinition.objects.create(product=product, **item)

    def to_representation(self, instance):
        return ProductDetailSerializer(instance, context=self.context).data
