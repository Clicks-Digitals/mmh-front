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
    PublicProductSerializer,
    RegionSerializer,
    VariantSerializer,
    VariantWriteSerializer,
)
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
    def perform_destroy(self, instance):
        try:
            instance.delete()
        except ProtectedError as exc:
            raise ConflictError(
                detail="Cannot delete because related products or records still reference it."
            ) from exc


class ProductFilter(filters.FilterSet):
    category = filters.CharFilter(method="filter_category")
    platform = filters.CharFilter(method="filter_platform")
    region = filters.CharFilter(field_name="variants__region__slug")
    supplier = filters.CharFilter(field_name="supplier_mappings__supplier__slug")
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
            return qs.filter(_codes_available__gt=0, _codes_available__lt=threshold)
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
    permission_classes = [AllowAny]
    serializer_class = CategorySerializer
    queryset = Category.objects.filter(status=PublishStatus.PUBLISHED)
    pagination_class = None


class PlatformListView(generics.ListAPIView):
    permission_classes = [AllowAny]
    serializer_class = PlatformSerializer
    queryset = Platform.objects.filter(status=PublishStatus.PUBLISHED)
    pagination_class = None


class RegionListView(generics.ListAPIView):
    permission_classes = [AllowAny]
    serializer_class = RegionSerializer
    queryset = Region.objects.all()
    pagination_class = None


def _public_product_queryset():
    return (
        Product.objects.filter(status=PublishStatus.PUBLISHED)
        .select_related("category", "platform")
        .prefetch_related("variants__region", "fields", "media")
    )


class ProductListView(generics.ListAPIView):
    permission_classes = [AllowAny]
    serializer_class = PublicProductSerializer
    filterset_class = ProductFilter
    search_fields = ["name_en", "name_ar", "slug", "brand"]
    ordering_fields = ["sort_order", "rating", "created_at", "name_en"]

    def get_queryset(self):
        return _public_product_queryset()


class ProductDetailView(generics.RetrieveAPIView):
    permission_classes = [AllowAny]
    serializer_class = PublicProductSerializer
    lookup_field = "slug"

    def get_queryset(self):
        return _public_product_queryset()


class AdminCategoryViewSet(ProtectedDestroyMixin, viewsets.ModelViewSet):
    permission_classes = [IsAdminUser, HasAdminPermission]
    serializer_class = CategorySerializer
    queryset = Category.objects.annotate(products_count=Count("products")).all()
    search_fields = ["slug", "name_en", "name_ar"]
    ordering_fields = ["sort_order", "slug", "created_at"]
    filterset_fields = ["status"]

    def get_permissions(self):
        self.admin_permission = "catalog.read" if self.action in {"list", "retrieve"} else "catalog.write"
        return super().get_permissions()


class AdminPlatformViewSet(ProtectedDestroyMixin, viewsets.ModelViewSet):
    permission_classes = [IsAdminUser, HasAdminPermission]
    serializer_class = PlatformSerializer
    queryset = Platform.objects.annotate(products_count=Count("products")).all()
    search_fields = ["slug", "name_en", "name_ar"]
    ordering_fields = ["sort_order", "slug", "created_at"]
    filterset_fields = ["status"]

    def get_permissions(self):
        self.admin_permission = "catalog.read" if self.action in {"list", "retrieve"} else "catalog.write"
        return super().get_permissions()


class AdminRegionViewSet(ProtectedDestroyMixin, viewsets.ModelViewSet):
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
            Prefetch("variants", queryset=_variant_code_queryset()),
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
            price_min_fils=Min("variants__price_fils"),
            price_max_fils=Max("variants__price_fils"),
        )
    )


class AdminProductViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser, HasAdminPermission]
    queryset = _product_admin_queryset()
    lookup_field = "slug"
    search_fields = ["name_en", "name_ar", "slug", "brand", "id", "variants__sku"]
    filterset_class = ProductFilter
    ordering_fields = ["updated_at", "created_at", "name_en", "sort_order", "status"]
    ordering = ["-updated_at"]

    def get_permissions(self):
        if self.action in {"list", "retrieve"}:
            self.admin_permission = "catalog.read"
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
        AuditLog.objects.create(
            actor=self.request.user,
            action="product.created",
            entity_type="Product",
            entity_id=str(product.id),
            meta={"slug": product.slug, "status": product.status},
        )

    def perform_update(self, serializer):
        product = serializer.save()
        AuditLog.objects.create(
            actor=self.request.user,
            action="product.updated",
            entity_type="Product",
            entity_id=str(product.id),
            meta={"slug": product.slug, "status": product.status},
        )

    def destroy(self, request, *args, **kwargs):
        product = self.get_object()
        from commerce.models import OrderItem

        if OrderItem.objects.filter(product=product).exists() or DigitalCode.objects.filter(
            variant__product=product
        ).exists():
            product.status = PublishStatus.ARCHIVED
            product.save(update_fields=["status", "updated_at"])
            AuditLog.objects.create(
                actor=request.user,
                action="product.archived",
                entity_type="Product",
                entity_id=str(product.id),
                meta={"slug": product.slug, "reason": "has_orders_or_codes"},
            )
            return Response(
                {
                    "detail": "Product has order or code history and was archived instead of deleted.",
                    "status": product.status,
                    "slug": product.slug,
                }
            )
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError as exc:
            raise ConflictError(
                detail="Cannot delete this product because related records still reference it. Archive it instead."
            ) from exc

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
        mapping = SupplierProductMapping.objects.create(
            supplier=supplier,
            product=product,
            variant=variant,
            external_product_id=external_product_id,
            external_name=str(request.data.get("external_name") or ""),
            ignored=bool(request.data.get("ignored", False)),
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
        return Response(
            {
                "id": mapping.id,
                "supplier_id": supplier.id,
                "supplier_slug": supplier.slug,
                "supplier_name": supplier.name,
                "product": product.id,
                "variant": variant.id if variant else None,
                "external_product_id": mapping.external_product_id,
                "external_name": mapping.external_name,
                "ignored": mapping.ignored,
            },
            status=201,
        )


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
        return Response(MediaAssetSerializer(asset, context={"request": request}).data)

    def delete(self, request, media_id: int):
        asset = MediaAsset.objects.filter(pk=media_id).select_related("product").first()
        if not asset:
            return Response({"detail": "Not found"}, status=404)
        delete_media(asset)
        return Response(status=204)


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
        return Response(
            {
                "id": mapping.id,
                "supplier_id": mapping.supplier_id,
                "supplier_slug": mapping.supplier.slug,
                "supplier_name": mapping.supplier.name,
                "product": mapping.product_id,
                "variant": mapping.variant_id,
                "external_product_id": mapping.external_product_id,
                "external_name": mapping.external_name,
                "ignored": mapping.ignored,
            }
        )

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


class AdminVariantViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser, HasAdminPermission]
    serializer_class = VariantSerializer
    queryset = _variant_code_queryset()
    search_fields = ["sku", "name_en", "product__id", "product__slug"]
    filterset_fields = ["stock_status", "published", "product"]

    def get_permissions(self):
        self.admin_permission = "catalog.read" if self.action in {"list", "retrieve"} else "catalog.write"
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action in {"create", "update", "partial_update"}:
            return VariantWriteSerializer
        return VariantSerializer


class AdminInventoryView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "codes.read"

    def get(self, request):
        settings_obj = SiteSettings.load()
        threshold = settings_obj.low_stock_threshold
        annotated = _variant_code_queryset()
        low_stock = list(annotated.filter(codes_available__lt=threshold).order_by("codes_available", "sku")[:100])
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
                    "codes_available": code_counts["available"],
                    "codes_reserved": code_counts["reserved"],
                    "codes_delivered": code_counts["delivered"],
                    "codes_unavailable": code_counts["unavailable"],
                    "codes_total": code_counts["total"],
                    "low_stock_threshold": threshold,
                },
                "low_stock_variants": VariantSerializer(low_stock, many=True).data,
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
        return Response(
            {"url": absolute_media_url(request, url), "path": path, "mime_type": mime},
            status=status.HTTP_201_CREATED,
        )
