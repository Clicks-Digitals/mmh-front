from __future__ import annotations

import uuid

from django.core.files.storage import default_storage
from django.db import transaction
from django.db.models import Count, Min, Max, Prefetch, Q, Sum
from django.db.models.deletion import ProtectedError
from django_filters import rest_framework as filters
from rest_framework import generics, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.drf_permissions import HasAdminPermission, IsAdminUser
from audit.models import AuditLog
from audit.services import AuditedModelViewSetMixin, record_audit
from catalog.models import (
    Category,
    MediaAsset,
    Platform,
    Product,
    ProductFieldDefinition,
    ProductVariant,
    PublishStatus,
    Region,
    StockStatus,
)
from catalog.serializers import (
    CategorySerializer,
    MediaAssetSerializer,
    PlatformSerializer,
    ProductDetailSerializer,
    ProductListSerializer,
    ProductWriteSerializer,
    PublicCategorySerializer,
    PublicPlatformSerializer,
    PublicProductSerializer,
    PublicRegionSerializer,
    RegionSerializer,
    VariantSerializer,
    VariantWriteSerializer,
)
from accounts.permissions import has_permission
from catalog.stock import annotate_stock, available_code_counts, available_quantities, mapping_stock_payload, variant_stock
from config.pagination import LargePageNumberPagination
from catalog.services.entity_images import entity_image_response
from catalog.services.media import (
    MediaUploadError,
    absolute_media_url,
    attach_product_media,
    delete_media,
    reorder_media,
    save_upload,
    set_primary_media,
)
from cms.models import SiteSettings
from commerce.models import DigitalCode, DigitalCodeStatus
from suppliers.models import Supplier, SupplierProductMapping


def _variant_code_queryset():
    return ProductVariant.objects.select_related("region", "product").annotate(
        codes_available=Count(
            "digital_codes", filter=Q(digital_codes__status=DigitalCodeStatus.AVAILABLE)
        ),
        codes_reserved=Count(
            "digital_codes", filter=Q(digital_codes__status=DigitalCodeStatus.RESERVED)
        ),
        codes_delivered=Count(
            "digital_codes", filter=Q(digital_codes__status=DigitalCodeStatus.DELIVERED)
        ),
    )


class ConflictError(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "Cannot delete this record because it is still referenced."
    default_code = "conflict"


class ProtectedDestroyMixin:
    protected_detail = "Cannot delete because related products or records still reference it."

    def perform_destroy(self, instance):
        try:
            instance.delete()
        except ProtectedError as exc:
            raise ConflictError(detail=self.protected_detail) from exc


def _has_order_or_code_history(*, product=None, variant=None) -> bool:
    from commerce.models import OrderItem

    if variant is not None:
        return (
            OrderItem.objects.filter(variant=variant).exists()
            or DigitalCode.objects.filter(variant=variant).exists()
        )
    return (
        OrderItem.objects.filter(Q(product=product) | Q(variant__product=product)).exists()
        or DigitalCode.objects.filter(variant__product=product).exists()
    )


class PublicProductFilter(filters.FilterSet):
    """Storefront filters. No supplier/stock/status filters (internal data)."""

    category = filters.CharFilter(method="filter_category")
    platform = filters.CharFilter(method="filter_platform")
    region = filters.CharFilter(method="filter_region")
    kind = filters.CharFilter(field_name="kind")
    featured = filters.BooleanFilter()
    bestseller = filters.BooleanFilter()
    trending = filters.BooleanFilter()
    q = filters.CharFilter(method="filter_q")

    class Meta:
        model = Product
        fields = ["category", "platform", "kind", "featured", "bestseller", "trending", "region"]

    def filter_category(self, queryset, name, value):
        if not value:
            return queryset
        if str(value).isdigit():
            return queryset.filter(category_id=int(value))
        return queryset.filter(category__slug=value)

    def filter_platform(self, queryset, name, value):
        if not value:
            return queryset
        if str(value).isdigit():
            return queryset.filter(platform_id=int(value))
        return queryset.filter(platform__slug=value)

    def filter_region(self, queryset, name, value):
        if not value:
            return queryset
        return queryset.filter(variants__region__slug=value, variants__published=True).distinct()

    def filter_q(self, queryset, name, value):
        return queryset.filter(
            Q(name_en__icontains=value)
            | Q(name_ar__icontains=value)
            | Q(slug__icontains=value)
            | Q(brand__icontains=value)
        ).distinct()


class ProductFilter(filters.FilterSet):
    """Admin product filters (includes supplier and stock)."""

    category = filters.CharFilter(method="filter_category")
    platform = filters.CharFilter(method="filter_platform")
    region = filters.CharFilter(method="filter_region")
    supplier = filters.CharFilter(method="filter_supplier")
    kind = filters.CharFilter(field_name="kind")
    status = filters.CharFilter(field_name="status")
    stock = filters.CharFilter(method="filter_stock")
    featured = filters.BooleanFilter()
    bestseller = filters.BooleanFilter()
    trending = filters.BooleanFilter()
    q = filters.CharFilter(method="filter_q")

    class Meta:
        model = Product
        fields = ["category", "platform", "kind", "status", "featured", "bestseller", "trending", "region", "supplier"]

    def filter_category(self, queryset, name, value):
        if not value:
            return queryset
        if str(value).isdigit():
            return queryset.filter(category_id=int(value))
        return queryset.filter(category__slug=value)

    def filter_platform(self, queryset, name, value):
        if not value:
            return queryset
        if str(value).isdigit():
            return queryset.filter(platform_id=int(value))
        return queryset.filter(platform__slug=value)

    def filter_region(self, queryset, name, value):
        if not value:
            return queryset
        return queryset.filter(variants__region__slug=value).distinct()

    def filter_supplier(self, queryset, name, value):
        if not value:
            return queryset
        return queryset.filter(supplier_mappings__supplier__slug=value).distinct()

    def filter_stock(self, queryset, name, value):
        threshold = SiteSettings.load().low_stock_threshold
        value = (value or "").lower()
        qs = queryset.annotate(
            _codes_available=Count(
                "variants__digital_codes",
                filter=Q(variants__digital_codes__status=DigitalCodeStatus.AVAILABLE),
                distinct=True,
            )
        )
        if value in {"in_stock", "in-stock", "instock"}:
            return qs.filter(_codes_available__gt=0)
        if value in {"out_of_stock", "out-of-stock", "outofstock"}:
            return qs.filter(_codes_available=0)
        if value in {"low_stock", "low-stock", "lowstock"}:
            # D24: available <= threshold (still in stock).
            return qs.filter(_codes_available__gt=0, _codes_available__lte=threshold)
        return queryset

    def filter_q(self, queryset, name, value):
        return queryset.filter(
            Q(name_en__icontains=value)
            | Q(name_ar__icontains=value)
            | Q(slug__icontains=value)
            | Q(brand__icontains=value)
            | Q(id__icontains=value)
            | Q(variants__sku__icontains=value)
        ).distinct()


class CategoryListView(generics.ListAPIView):
    """Published categories ordered by sort_order, name. ``?menu=1`` -> only show_in_menu ones."""

    permission_classes = [AllowAny]
    serializer_class = PublicCategorySerializer
    pagination_class = None
    filter_backends: list = []

    def get_queryset(self):
        qs = Category.objects.filter(status=PublishStatus.PUBLISHED).select_related("parent").order_by(
            "sort_order", "name_en", "slug"
        )
        if (self.request.query_params.get("menu") or "").lower() in {"1", "true", "yes"}:
            qs = qs.filter(show_in_menu=True)
        return qs


class PlatformListView(generics.ListAPIView):
    permission_classes = [AllowAny]
    serializer_class = PublicPlatformSerializer
    queryset = Platform.objects.filter(status=PublishStatus.PUBLISHED).order_by("sort_order", "slug")
    pagination_class = None
    filter_backends: list = []


class RegionListView(generics.ListAPIView):
    permission_classes = [AllowAny]
    serializer_class = PublicRegionSerializer
    queryset = Region.objects.all().order_by("slug")
    pagination_class = None
    filter_backends: list = []


def _public_product_queryset():
    """Published products whose category AND platform are also published."""
    variants = annotate_stock(ProductVariant.objects.select_related("region"))
    return (
        Product.objects.filter(
            status=PublishStatus.PUBLISHED,
            category__status=PublishStatus.PUBLISHED,
            platform__status=PublishStatus.PUBLISHED,
        )
        .select_related("category", "category__parent", "platform")
        .prefetch_related(Prefetch("variants", queryset=variants), "fields", "media")
        .order_by("sort_order", "slug")
    )


def _public_stock_context(products) -> dict:
    """Batch reservation-aware counts for every published CODE variant on a page."""
    ids = [
        v.pk
        for p in products
        if p.fulfillment_type == "CODE"
        for v in p.variants.all()
        if v.published
    ]
    if not ids:
        return {"net_available": {}, "available_quantity": {}}
    return {"net_available": available_code_counts(ids), "available_quantity": available_quantities(ids)}


class ProductListView(generics.ListAPIView):
    permission_classes = [AllowAny]
    serializer_class = PublicProductSerializer
    filterset_class = PublicProductFilter
    pagination_class = LargePageNumberPagination
    search_fields = ["name_en", "name_ar", "slug", "brand"]
    ordering_fields = ["sort_order", "created_at", "name_en"]

    def get_queryset(self):
        return _public_product_queryset()

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        rows = list(page if page is not None else queryset)
        context = {**self.get_serializer_context(), **_public_stock_context(rows)}
        data = PublicProductSerializer(rows, many=True, context=context).data
        if page is not None:
            return self.get_paginated_response(data)
        return Response(data)


class ProductDetailView(generics.RetrieveAPIView):
    permission_classes = [AllowAny]
    serializer_class = PublicProductSerializer
    lookup_field = "slug"

    def get_queryset(self):
        return _public_product_queryset()


class AdminCategoryViewSet(AuditedModelViewSetMixin, ProtectedDestroyMixin, viewsets.ModelViewSet):
    audit_prefix = "catalog.category"
    permission_classes = [IsAdminUser, HasAdminPermission]
    serializer_class = CategorySerializer
    queryset = (
        Category.objects.select_related("parent")
        .prefetch_related("children")
        .annotate(products_count=Count("products"))
        .order_by("sort_order", "name_en", "slug")
    )
    search_fields = ["slug", "name_en", "name_ar"]
    ordering_fields = ["sort_order", "slug", "created_at", "name_en"]
    filterset_fields = ["status", "show_in_menu", "parent"]

    def get_permissions(self):
        self.admin_permission = "catalog.read" if self.action in {"list", "retrieve"} else "catalog.write"
        return super().get_permissions()

    def destroy(self, request, *args, **kwargs):
        """D20 / CA-16: a category that still has sub-categories cannot be deleted (409)."""
        category = self.get_object()
        children = list(category.children.order_by("sort_order", "name_en"))
        if children:
            names = ", ".join(c.name_en for c in children)
            return Response(
                {
                    "detail": f"Move or delete its sub-categories first: {names}.",
                    "code": "has_children",
                    "children": [{"id": c.id, "slug": c.slug, "name_en": c.name_en} for c in children],
                },
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post", "delete"], url_path="image", parser_classes=[MultiPartParser, FormParser, JSONParser])
    def image(self, request, pk=None):
        """POST multipart ``file``: set the category picture. DELETE: remove it (built-in artwork again)."""
        category = self.get_object()
        return entity_image_response(
            request,
            category,
            audit_prefix="catalog.category",
            entity_type="Category",
            label=category.name_en,
            serialize=lambda obj: CategorySerializer(self.get_queryset().get(pk=obj.pk), context={"request": request}).data,
        )


class AdminPlatformViewSet(AuditedModelViewSetMixin, ProtectedDestroyMixin, viewsets.ModelViewSet):
    audit_prefix = "catalog.platform"
    permission_classes = [IsAdminUser, HasAdminPermission]
    serializer_class = PlatformSerializer
    queryset = Platform.objects.annotate(products_count=Count("products")).all()
    search_fields = ["slug", "name_en", "name_ar"]
    ordering_fields = ["sort_order", "slug", "created_at"]
    filterset_fields = ["status"]

    def get_permissions(self):
        self.admin_permission = "catalog.read" if self.action in {"list", "retrieve"} else "catalog.write"
        return super().get_permissions()

    @action(detail=True, methods=["post", "delete"], url_path="image", parser_classes=[MultiPartParser, FormParser, JSONParser])
    def image(self, request, pk=None):
        """POST multipart ``file``: set the platform logo. DELETE: remove it (built-in artwork again)."""
        platform = self.get_object()
        return entity_image_response(
            request,
            platform,
            audit_prefix="catalog.platform",
            entity_type="Platform",
            label=platform.name_en,
            serialize=lambda obj: PlatformSerializer(self.get_queryset().get(pk=obj.pk), context={"request": request}).data,
        )


class AdminRegionViewSet(AuditedModelViewSetMixin, ProtectedDestroyMixin, viewsets.ModelViewSet):
    audit_prefix = "catalog.region"
    permission_classes = [IsAdminUser, HasAdminPermission]
    serializer_class = RegionSerializer
    queryset = Region.objects.annotate(variants_count=Count("variants")).all()
    search_fields = ["slug", "name_en", "name_ar", "currency"]

    def get_permissions(self):
        self.admin_permission = "catalog.read" if self.action in {"list", "retrieve"} else "catalog.write"
        return super().get_permissions()


def _product_admin_queryset():
    return (
        Product.objects.select_related("category", "platform")
        .prefetch_related(
            Prefetch("variants", queryset=annotate_stock(_variant_code_queryset())),
            "fields",
            "media",
            "supplier_mappings__supplier",
            "supplier_mappings__variant",
        )
        .annotate(
            variants_count=Count("variants", distinct=True),
            codes_available=Count(
                "variants__digital_codes",
                filter=Q(variants__digital_codes__status=DigitalCodeStatus.AVAILABLE),
                distinct=True,
            ),
            # CA-20: price range from published variants only.
            price_min_fils=Min("variants__price_fils", filter=Q(variants__published=True)),
            price_max_fils=Max("variants__price_fils", filter=Q(variants__published=True)),
        )
    )


class AdminProductViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser, HasAdminPermission]
    queryset = _product_admin_queryset()
    pagination_class = LargePageNumberPagination
    lookup_field = "slug"
    search_fields = ["name_en", "name_ar", "slug", "brand", "id", "variants__sku"]
    filterset_class = ProductFilter
    ordering_fields = ["updated_at", "created_at", "name_en", "sort_order", "status"]
    ordering = ["-updated_at"]

    def get_permissions(self):
        if self.action in {"list", "retrieve"}:
            # RO-04: the code-import picker (codes.manage) reads product lists too.
            self.admin_permission = ("catalog.read", "codes.manage")
        elif self.action == "create_mapping":
            self.admin_permission = "suppliers.write"
        else:
            self.admin_permission = "catalog.write"
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action == "list":
            return ProductListSerializer
        if self.action in {"create", "update", "partial_update"}:
            return ProductWriteSerializer
        return ProductDetailSerializer

    def get_queryset(self):
        return _product_admin_queryset()

    def perform_create(self, serializer):
        product = serializer.save()
        record_audit(
            self.request.user,
            "product.created",
            entity_type="Product",
            entity_id=product.id,
            meta={"slug": product.slug, "status": product.status},
        )

    def perform_update(self, serializer):
        before_status = serializer.instance.status if serializer.instance is not None else None
        fields = sorted(k for k in serializer.validated_data.keys())
        product = serializer.save()
        record_audit(
            self.request.user,
            "product.updated",
            entity_type="Product",
            entity_id=product.id,
            meta={"slug": product.slug, "status": product.status, "previous_status": before_status, "fields": fields},
        )

    def destroy(self, request, *args, **kwargs):
        product = self.get_object()
        if _has_order_or_code_history(product=product):
            return Response(
                {
                    "detail": "This product has order or code history and cannot be deleted. Archive it instead.",
                    "code": "conflict",
                    "slug": product.slug,
                    "status": product.status,
                },
                status=status.HTTP_409_CONFLICT,
            )
        product_id, slug = product.id, product.slug
        try:
            with transaction.atomic():
                product.delete()
        except ProtectedError as exc:
            raise ConflictError(
                detail="Cannot delete this product because related records still reference it. Archive it instead."
            ) from exc
        record_audit(request.user, "product.deleted", entity_type="Product", entity_id=product_id, meta={"slug": slug})
        return Response(status=status.HTTP_204_NO_CONTENT)

    def _set_status(self, request, new_status: str, action_name: str):
        product = self.get_object()
        previous = product.status
        if previous != new_status:
            product.status = new_status
            product.save(update_fields=["status", "updated_at"])
        record_audit(
            request.user,
            action_name,
            entity_type="Product",
            entity_id=product.id,
            meta={"slug": product.slug, "previous_status": previous, "status": new_status},
        )
        product = _product_admin_queryset().get(pk=product.pk)
        return Response(ProductDetailSerializer(product, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="archive")
    def archive(self, request, slug=None):
        return self._set_status(request, PublishStatus.ARCHIVED, "product.archived")

    @action(detail=True, methods=["post"], url_path="unarchive")
    def unarchive(self, request, slug=None):
        return self._set_status(request, PublishStatus.DRAFT, "product.unarchived")

    @action(detail=True, methods=["post"], url_path="duplicate")
    def duplicate(self, request, slug=None):
        product = self.get_object()
        copy_mappings = str(request.data.get("copy_mappings", "")).lower() in {"1", "true", "yes"}
        suffix = uuid.uuid4().hex[:6]
        new_id = f"{product.id}-copy-{suffix}"[:64]
        new_slug = f"{product.slug}-copy-{suffix}"[:50]
        with transaction.atomic():
            clone = Product.objects.create(
                id=new_id,
                slug=new_slug,
                kind=product.kind,
                fulfillment_type=product.fulfillment_type,
                source=product.source,
                category=product.category,
                platform=product.platform,
                brand=product.brand,
                artwork_key=product.artwork_key,
                account_currency=product.account_currency,
                status=PublishStatus.DRAFT,
                featured=False,
                bestseller=False,
                trending=False,
                refundable=product.refundable,
                region_warning_en=product.region_warning_en,
                region_warning_ar=product.region_warning_ar,
                delivery_estimate_en=product.delivery_estimate_en,
                delivery_estimate_ar=product.delivery_estimate_ar,
                sort_order=product.sort_order,
                badges=list(product.badges or []),
                tags=list(product.tags or []),
                name_en=f"{product.name_en} (Copy)",
                name_ar=product.name_ar,
                short_description_en=product.short_description_en,
                short_description_ar=product.short_description_ar,
                description_en=product.description_en,
                description_ar=product.description_ar,
                instructions_en=product.instructions_en,
                instructions_ar=product.instructions_ar,
                how_to_use_en=list(product.how_to_use_en or []),
                how_to_use_ar=list(product.how_to_use_ar or []),
                region_restrictions_en=product.region_restrictions_en,
                region_restrictions_ar=product.region_restrictions_ar,
                refund_policy_en=product.refund_policy_en,
                refund_policy_ar=product.refund_policy_ar,
                image_url=product.image_url,
            )
            variant_map: dict[int, ProductVariant] = {}
            for v in product.variants.all():
                nv = ProductVariant.objects.create(
                    product=clone,
                    region=v.region,
                    sku=f"{v.sku}-COPY-{suffix}"[:120],
                    denomination=v.denomination,
                    package_value=v.package_value,
                    package_currency=v.package_currency,
                    cost_fils=v.cost_fils,
                    price_fils=v.price_fils,
                    compare_at_price_fils=v.compare_at_price_fils,
                    stock_status=StockStatus.OUT_OF_STOCK,
                    min_quantity=v.min_quantity,
                    max_quantity=v.max_quantity,
                    sort_order=v.sort_order,
                    published=v.published,
                    name_en=v.name_en,
                    name_ar=v.name_ar,
                    external_id=v.external_id,
                )
                variant_map[v.id] = nv
            for f in product.fields.all():
                ProductFieldDefinition.objects.create(
                    product=clone,
                    key=f.key,
                    type=f.type,
                    required=f.required,
                    sort_order=f.sort_order,
                    label_en=f.label_en,
                    label_ar=f.label_ar,
                    placeholder_en=f.placeholder_en,
                    placeholder_ar=f.placeholder_ar,
                    help_text_en=f.help_text_en,
                    help_text_ar=f.help_text_ar,
                    input_format=f.input_format,
                    min_length=f.min_length,
                    max_length=f.max_length,
                    options=list(f.options or []),
                )
            if copy_mappings:
                for m in product.supplier_mappings.all():
                    SupplierProductMapping.objects.create(
                        supplier=m.supplier,
                        product=clone,
                        variant=variant_map.get(m.variant_id) if m.variant_id else None,
                        external_product_id=f"{m.external_product_id}-COPY-{suffix}"[:120],
                        external_name=m.external_name,
                        ignored=m.ignored,
                    )
        AuditLog.objects.create(
            actor=request.user,
            action="product.duplicated",
            entity_type="Product",
            entity_id=str(clone.id),
            meta={"source_id": product.id, "slug": clone.slug, "copy_mappings": copy_mappings},
        )
        clone = _product_admin_queryset().get(pk=clone.pk)
        return Response(ProductDetailSerializer(clone, context={"request": request}).data, status=201)

    @action(detail=True, methods=["post"], url_path="media", parser_classes=[MultiPartParser, FormParser])
    def upload_media(self, request, slug=None):
        product = self.get_object()
        upload = request.FILES.get("file") or request.FILES.get("image")
        if not upload:
            return Response({"detail": "file is required"}, status=400)
        try:
            path, url, mime = save_upload(upload, getattr(upload, "name", "") or "")
            asset = attach_product_media(
                product=product,
                storage_path=path,
                url=url,
                mime_type=mime,
                alt=str(request.data.get("alt") or ""),
                make_primary=str(request.data.get("is_primary", "")).lower() in {"1", "true", "yes"},
            )
        except MediaUploadError as exc:
            return Response({"detail": exc.message}, status=exc.status)
        record_audit(
            request.user,
            "media.uploaded",
            entity_type="MediaAsset",
            entity_id=asset.id,
            meta={"product_id": product.id, "path": asset.storage_path, "is_primary": asset.is_primary},
        )
        return Response(MediaAssetSerializer(asset, context={"request": request}).data, status=201)

    @action(detail=True, methods=["post"], url_path="media/reorder")
    def reorder_product_media(self, request, slug=None):
        product = self.get_object()
        ids = request.data.get("ordered_ids") or request.data.get("ids") or []
        if not isinstance(ids, list) or not all(str(i).isdigit() for i in ids):
            return Response({"detail": "ordered_ids must be a list of integers"}, status=400)
        try:
            assets = reorder_media(product, [int(i) for i in ids])
        except MediaUploadError as exc:
            return Response({"detail": exc.message}, status=exc.status)
        return Response(MediaAssetSerializer(assets, many=True, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="mappings")
    def create_mapping(self, request, slug=None):
        product = self.get_object()
        supplier_id = request.data.get("supplier_id")
        external_product_id = str(request.data.get("external_product_id") or "").strip()
        variant_id = request.data.get("variant_id")
        if not supplier_id or not external_product_id:
            return Response({"detail": "supplier_id and external_product_id are required"}, status=400)
        supplier = Supplier.objects.filter(pk=supplier_id).first()
        if not supplier:
            return Response({"detail": "Supplier not found"}, status=404)
        variant = None
        if variant_id:
            variant = ProductVariant.objects.filter(product=product, pk=variant_id).first()
            if not variant:
                return Response({"detail": "Variant not found on this product"}, status=400)
        if SupplierProductMapping.objects.filter(supplier=supplier, external_product_id=external_product_id).exists():
            return Response({"detail": "Supplier product mapping already exists"}, status=400)
        from suppliers.services.mapping import mapping_payload

        options, error = _mapping_options(request.data)
        if error:
            return Response({"detail": error}, status=400)
        catalog_item = None
        if request.data.get("catalog_item_id"):
            from suppliers.models import SupplierCatalogItem

            catalog_item = SupplierCatalogItem.objects.filter(supplier=supplier, pk=request.data.get("catalog_item_id")).first()
            if catalog_item is None:
                return Response({"detail": "1Epin catalog item not found"}, status=404)
        mapping = SupplierProductMapping.objects.create(
            supplier=supplier,
            product=product,
            variant=variant,
            external_product_id=external_product_id,
            external_name=str(request.data.get("external_name") or (catalog_item.product_name if catalog_item else "")),
            ignored=bool(request.data.get("ignored", False)),
            catalog_item=catalog_item,
            category_type=catalog_item.category_type if catalog_item else "",
            **options,
        )
        AuditLog.objects.create(
            actor=request.user,
            action="supplier.mapping.created",
            entity_type="SupplierProductMapping",
            entity_id=str(mapping.id),
            meta={
                "product_id": product.id,
                "variant_id": variant.id if variant else None,
                "supplier_id": supplier.id,
                "external_product_id": external_product_id,
            },
        )
        return Response(mapping_payload(mapping), status=201)


class AdminMediaAssetView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "catalog.write"

    def patch(self, request, media_id: int):
        asset = MediaAsset.objects.filter(pk=media_id).select_related("product").first()
        if not asset:
            return Response({"detail": "Not found"}, status=404)
        if "alt" in request.data:
            asset.alt = str(request.data.get("alt") or "")
            asset.save(update_fields=["alt"])
        if str(request.data.get("is_primary", "")).lower() in {"1", "true", "yes"}:
            try:
                set_primary_media(asset)
            except MediaUploadError as exc:
                return Response({"detail": exc.message}, status=exc.status)
        if "sort_order" in request.data and str(request.data.get("sort_order")).lstrip("-").isdigit():
            asset.sort_order = int(request.data["sort_order"])
            asset.save(update_fields=["sort_order"])
        asset.refresh_from_db()
        record_audit(
            request.user,
            "media.updated",
            entity_type="MediaAsset",
            entity_id=asset.id,
            meta={"product_id": asset.product_id, "fields": sorted(k for k in ("alt", "is_primary", "sort_order") if k in request.data)},
        )
        return Response(MediaAssetSerializer(asset, context={"request": request}).data)

    def delete(self, request, media_id: int):
        asset = MediaAsset.objects.filter(pk=media_id).select_related("product").first()
        if not asset:
            return Response({"detail": "Not found"}, status=404)
        meta = {"product_id": asset.product_id, "path": asset.storage_path}
        delete_media(asset)
        record_audit(request.user, "media.deleted", entity_type="MediaAsset", entity_id=media_id, meta=meta)
        return Response(status=204)



_MAPPING_BOOL_OPTIONS = ("prefer_supplier", "auto_buy", "allow_loss")


def _mapping_options(data) -> tuple[dict, str]:
    """Optional 1Epin mapping fields accepted by the product mapping endpoints."""
    from decimal import Decimal, InvalidOperation

    out: dict = {}
    for key in _MAPPING_BOOL_OPTIONS:
        if key in data:
            out[key] = str(data.get(key)).strip().lower() in {"1", "true", "yes", "on"}
    if "quantity_per_unit" in data:
        try:
            qpu = int(data.get("quantity_per_unit"))
        except (TypeError, ValueError):
            return {}, "quantity_per_unit must be a whole number"
        if qpu < 1 or qpu > 1000:
            return {}, "quantity_per_unit must be between 1 and 1000"
        out["quantity_per_unit"] = qpu
    if "max_cost_fils" in data:
        raw = data.get("max_cost_fils")
        if raw in (None, ""):
            out["max_cost_fils"] = None
        else:
            try:
                out["max_cost_fils"] = max(int(raw), 0)
            except (TypeError, ValueError):
                return {}, "max_cost_fils must be a whole number of fils"
    if "user_template" in data:
        out["user_template"] = str(data.get("user_template") or "")[:255]
    if "barem" in data:
        raw = data.get("barem")
        if raw in (None, ""):
            out["barem"] = None
        else:
            try:
                out["barem"] = Decimal(str(raw))
            except (InvalidOperation, ValueError):
                return {}, "barem must be a number"
    return out, ""


class AdminSupplierMappingDetailView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "suppliers.write"

    def patch(self, request, mapping_id: int):
        mapping = SupplierProductMapping.objects.select_related("supplier", "product", "variant").filter(
            pk=mapping_id
        ).first()
        if not mapping:
            return Response({"detail": "Not found"}, status=404)
        if "external_product_id" in request.data:
            mapping.external_product_id = str(request.data.get("external_product_id") or "").strip()
        if "external_name" in request.data:
            mapping.external_name = str(request.data.get("external_name") or "")
        if "ignored" in request.data:
            mapping.ignored = bool(request.data.get("ignored"))
        options, error = _mapping_options(request.data)
        if error:
            return Response({"detail": error}, status=400)
        for key, value in options.items():
            setattr(mapping, key, value)
        if "variant_id" in request.data:
            vid = request.data.get("variant_id")
            if vid in (None, "", "null"):
                mapping.variant = None
            else:
                variant = ProductVariant.objects.filter(product=mapping.product, pk=vid).first()
                if not variant:
                    return Response({"detail": "Variant not found on this product"}, status=400)
                mapping.variant = variant
        try:
            mapping.save()
        except Exception as exc:
            return Response({"detail": "Could not update mapping (possibly duplicate external id)"}, status=400)
        AuditLog.objects.create(
            actor=request.user,
            action="supplier.mapping.updated",
            entity_type="SupplierProductMapping",
            entity_id=str(mapping.id),
            meta={"product_id": mapping.product_id, "supplier_id": mapping.supplier_id},
        )
        from suppliers.services.mapping import mapping_payload

        return Response(mapping_payload(mapping))

    def delete(self, request, mapping_id: int):
        mapping = SupplierProductMapping.objects.filter(pk=mapping_id).first()
        if not mapping:
            return Response({"detail": "Not found"}, status=404)
        mid = mapping.id
        product_id = mapping.product_id
        mapping.delete()
        AuditLog.objects.create(
            actor=request.user,
            action="supplier.mapping.deleted",
            entity_type="SupplierProductMapping",
            entity_id=str(mid),
            meta={"product_id": product_id},
        )
        return Response(status=204)


class AdminVariantViewSet(AuditedModelViewSetMixin, ProtectedDestroyMixin, viewsets.ModelViewSet):
    audit_prefix = "catalog.variant"
    protected_detail = "This variant has order or code history and cannot be deleted. Unpublish it instead."
    permission_classes = [IsAdminUser, HasAdminPermission]
    serializer_class = VariantSerializer
    search_fields = ["sku", "name_en", "name_ar", "product__id", "product__slug", "product__name_en", "product__name_ar"]
    filterset_fields = ["stock_status", "published", "product"]

    def get_queryset(self):
        return annotate_stock(_variant_code_queryset())

    def get_permissions(self):
        if self.action in {"list", "retrieve"}:
            # RO-04 / RO-11: code import pickers and the codes page read variants too.
            self.admin_permission = ("catalog.read", "codes.read", "codes.manage")
        else:
            self.admin_permission = "catalog.write"
        return super().get_permissions()

    def get_queryset(self):
        qs = annotate_stock(_variant_code_queryset()).order_by("product_id", "sort_order", "price_fils", "id")
        ftype = (self.request.query_params.get("fulfillment_type") or "").upper()
        if ftype:
            qs = qs.filter(product__fulfillment_type=ftype)
        return qs

    def get_serializer_context(self):
        context = super().get_serializer_context()
        user = getattr(self.request, "user", None)
        if user is not None and user.is_authenticated and not has_permission(user, "catalog.read"):
            context["hide_cost"] = True
        return context

    def get_serializer_class(self):
        if self.action in {"create", "update", "partial_update"}:
            return VariantWriteSerializer
        return VariantSerializer

    def _audit_label(self, instance) -> dict:
        return {"sku": instance.sku, "product_id": instance.product_id}

    def perform_create(self, serializer):
        from catalog.serializers import fill_variant_defaults

        product = serializer.validated_data.get("product")
        if not product:
            raise ValidationError({"product": ["This field is required."]})
        serializer.validated_data.pop("delete", None)
        serializer.validated_data.pop("id", None)
        fill_variant_defaults(serializer.validated_data, product)
        super().perform_create(serializer)

    def perform_update(self, serializer):
        from catalog.serializers import fill_variant_defaults

        serializer.validated_data.pop("delete", None)
        serializer.validated_data.pop("id", None)
        fill_variant_defaults(serializer.validated_data, serializer.instance.product, serializer.instance)
        super().perform_update(serializer)

    def perform_destroy(self, instance):
        if _has_order_or_code_history(variant=instance):
            raise ConflictError(detail=self.protected_detail)
        super().perform_destroy(instance)


def tracked_code_variants_queryset():
    """D24 inventory rule: published CODE variants of non-archived products."""
    return annotate_stock(_variant_code_queryset()).filter(
        published=True, product__fulfillment_type="CODE"
    ).exclude(product__status=PublishStatus.ARCHIVED)


def tracked_variant_effective_statuses() -> tuple[list, list[str]]:
    """(tracked variants, their effective sellable stock status) — shared by Inventory and the dashboard."""
    tracked_rows = list(tracked_code_variants_queryset())
    tracked_net = available_code_counts([v.pk for v in tracked_rows])
    return tracked_rows, [variant_stock(v, net_available=tracked_net)[0] for v in tracked_rows]


def effective_out_of_stock_count() -> int:
    return sum(1 for status_ in tracked_variant_effective_statuses()[1] if status_ == StockStatus.OUT_OF_STOCK)


class AdminInventoryView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "codes.read"

    def get(self, request):
        """D24: low stock = published CODE variants (of non-archived products) with
        ``codes_available <= low_stock_threshold``; each row carries ``effective_stock_status``."""
        settings_obj = SiteSettings.load()
        threshold = settings_obj.low_stock_threshold
        tracked = tracked_code_variants_queryset()
        low_qs = tracked.filter(codes_available__lte=threshold)
        low_stock_count = low_qs.count()
        low_stock = list(low_qs.order_by("codes_available", "sku")[:100])
        net = available_code_counts([v.pk for v in low_stock])
        tracked_rows, effective = tracked_variant_effective_statuses()
        code_counts = {
            "available": DigitalCode.objects.filter(status=DigitalCodeStatus.AVAILABLE).count(),
            "reserved": DigitalCode.objects.filter(status=DigitalCodeStatus.RESERVED).count(),
            "delivered": DigitalCode.objects.filter(status=DigitalCodeStatus.DELIVERED).count(),
            "unavailable": DigitalCode.objects.filter(status=DigitalCodeStatus.UNAVAILABLE).count(),
            "total": DigitalCode.objects.count(),
        }
        return Response(
            {
                "stats": {
                    "variants_total": ProductVariant.objects.count(),
                    "out_of_stock": ProductVariant.objects.filter(stock_status=StockStatus.OUT_OF_STOCK).count(),
                    "in_stock": ProductVariant.objects.filter(stock_status=StockStatus.IN_STOCK).count(),
                    # D24: published CODE variants by effective (sellable) status.
                    "tracked_variants": len(tracked_rows),
                    "effective_in_stock": sum(1 for e in effective if e == StockStatus.IN_STOCK),
                    "effective_out_of_stock": sum(1 for e in effective if e == StockStatus.OUT_OF_STOCK),
                    "low_stock": low_stock_count,
                    "low_stock_rule": "available <= threshold",
                    "codes_available": code_counts["available"],
                    "codes_reserved": code_counts["reserved"],
                    "codes_delivered": code_counts["delivered"],
                    "codes_unavailable": code_counts["unavailable"],
                    "codes_total": code_counts["total"],
                    "low_stock_threshold": threshold,
                },
                "low_stock_variants": VariantSerializer(
                    low_stock, many=True, context={"net_available": net, "low_stock_threshold": threshold}
                ).data,
            }
        )


class AdminMediaUploadView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "catalog.write"
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        upload = request.FILES.get("file") or request.FILES.get("image")
        if not upload:
            return Response({"detail": "file is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            path, url, mime = save_upload(upload, getattr(upload, "name", "") or "")
        except MediaUploadError as exc:
            return Response({"detail": exc.message}, status=exc.status)
        record_audit(
            request.user,
            "media.uploaded",
            entity_type="Media",
            entity_id=path[-64:],
            meta={"path": path, "mime_type": mime, "purpose": str(request.data.get("purpose") or "")[:32]},
        )
        return Response(
            {"url": absolute_media_url(request, url), "path": path, "mime_type": mime},
            status=status.HTTP_201_CREATED,
        )
