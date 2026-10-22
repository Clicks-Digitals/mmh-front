from django.db.models import Q
from django.utils import timezone
from rest_framework import generics, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.drf_permissions import HasAdminPermission, IsAdminUser
from audit.services import AuditedModelViewSetMixin, record_audit
from catalog.serializers import media_absolute_url
from cms.models import Banner, ContentPage, FAQ, SiteSettings

BANNER_PUBLIC_FIELDS = (
    "id",
    "placement",
    "title_en",
    "title_ar",
    "subtitle_en",
    "subtitle_ar",
    "kicker",
    "href",
    "tone",
    "desktop_image",
    "mobile_image",
    "sort_order",
)

BANNER_IMAGE_FIELDS = ("desktop_image", "mobile_image")


class _BannerImageUrlsMixin:
    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        for key in BANNER_IMAGE_FIELDS:
            if key in data:
                data[key] = media_absolute_url(request, data[key] or "")
        return data


class PublicBannerSerializer(_BannerImageUrlsMixin, serializers.ModelSerializer):
    class Meta:
        model = Banner
        fields = BANNER_PUBLIC_FIELDS
        read_only_fields = BANNER_PUBLIC_FIELDS


class AdminBannerSerializer(serializers.ModelSerializer):
    """Stores image values as given; ``*_image_url`` are the absolute display URLs."""

    desktop_image_url = serializers.SerializerMethodField()
    mobile_image_url = serializers.SerializerMethodField()

    class Meta:
        model = Banner
        fields = BANNER_PUBLIC_FIELDS + (
            "desktop_image_url",
            "mobile_image_url",
            "published",
            "start_at",
            "end_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def get_desktop_image_url(self, obj) -> str:
        return media_absolute_url(self.context.get("request"), obj.desktop_image)

    def get_mobile_image_url(self, obj) -> str:
        return media_absolute_url(self.context.get("request"), obj.mobile_image)

    def validate(self, attrs):
        start = attrs.get("start_at", getattr(self.instance, "start_at", None))
        end = attrs.get("end_at", getattr(self.instance, "end_at", None))
        if start and end and end <= start:
            raise serializers.ValidationError({"end_at": "End must be after start"})
        return attrs


# Backwards-compatible name.
BannerSerializer = AdminBannerSerializer


class PublicFAQSerializer(serializers.ModelSerializer):
    class Meta:
        model = FAQ
        fields = ("id", "question_en", "question_ar", "answer_en", "answer_ar", "sort_order")
        read_only_fields = fields


class AdminFAQSerializer(serializers.ModelSerializer):
    class Meta:
        model = FAQ
        fields = ("id", "question_en", "question_ar", "answer_en", "answer_ar", "sort_order", "published")
        read_only_fields = ("id",)


FAQSerializer = AdminFAQSerializer


class PublicContentPageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContentPage
        fields = ("slug", "title_en", "title_ar", "body_en", "body_ar", "updated_at")
        read_only_fields = fields


class PublicContentPageListSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContentPage
        fields = ("slug", "title_en", "title_ar")
        read_only_fields = fields


class AdminContentPageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContentPage
        fields = ("id", "slug", "title_en", "title_ar", "body_en", "body_ar", "published", "updated_at")
        read_only_fields = ("id", "updated_at")


ContentPageSerializer = AdminContentPageSerializer


class SiteSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = SiteSettings
        fields = (
            "store_name",
            "support_email",
            "support_phone",
            "business_hours",
            "whatsapp_number",
            "telegram_url",
            "instagram_url",
            "facebook_url",
            "tiktok_url",
            "youtube_url",
            "low_stock_threshold",
            "maintenance_mode",
            "updated_at",
        )
        read_only_fields = ("updated_at",)

    def validate_low_stock_threshold(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError("Must be zero or greater")
        return value


PUBLIC_SETTINGS_FIELDS = (
    "store_name",
    "maintenance_mode",
    "support_email",
    "support_phone",
    "business_hours",
    "whatsapp_number",
    "telegram_url",
    "instagram_url",
    "facebook_url",
    "tiktok_url",
    "youtube_url",
)


class PublicSiteSettingsView(APIView):
    """Storefront-safe settings. Never add internal settings (thresholds, etc.) here."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        data = SiteSettingsSerializer(SiteSettings.load()).data
        return Response({key: data[key] for key in PUBLIC_SETTINGS_FIELDS})


def active_banners_queryset(now=None):
    now = now or timezone.now()
    return (
        Banner.objects.filter(published=True)
        .filter(Q(start_at__isnull=True) | Q(start_at__lte=now))
        .filter(Q(end_at__isnull=True) | Q(end_at__gt=now))
        .order_by("sort_order", "-created_at")
    )


class BannerListView(generics.ListAPIView):
    """Published banners inside their optional start/end window. Optional ?placement=HOME."""

    permission_classes = [AllowAny]
    serializer_class = PublicBannerSerializer
    pagination_class = None
    filter_backends: list = []

    def get_queryset(self):
        qs = active_banners_queryset()
        placement = (self.request.query_params.get("placement") or "").strip().upper()
        if placement:
            qs = qs.filter(placement=placement)
        return qs


class FAQListView(generics.ListAPIView):
    permission_classes = [AllowAny]
    serializer_class = PublicFAQSerializer
    queryset = FAQ.objects.filter(published=True).order_by("sort_order", "id")
    pagination_class = None
    filter_backends: list = []


class ContentPageListView(generics.ListAPIView):
    permission_classes = [AllowAny]
    serializer_class = PublicContentPageListSerializer
    queryset = ContentPage.objects.filter(published=True).order_by("slug")
    pagination_class = None
    filter_backends: list = []


class ContentPageDetailView(generics.RetrieveAPIView):
    permission_classes = [AllowAny]
    serializer_class = PublicContentPageSerializer
    lookup_field = "slug"
    queryset = ContentPage.objects.filter(published=True)


class _ContentPermissionMixin:
    def get_permissions(self):
        self.admin_permission = "content.read" if self.action in {"list", "retrieve"} else "content.write"
        return super().get_permissions()


class AdminBannerViewSet(_ContentPermissionMixin, AuditedModelViewSetMixin, viewsets.ModelViewSet):
    audit_prefix = "cms.banner"
    permission_classes = [IsAdminUser, HasAdminPermission]
    serializer_class = AdminBannerSerializer
    queryset = Banner.objects.all()
    search_fields = ["title_en", "title_ar", "href"]
    filterset_fields = ["published", "placement"]

    @action(
        detail=True,
        methods=["post"],
        url_path="image",
        parser_classes=[MultiPartParser, FormParser, JSONParser],
    )
    def upload_image(self, request, pk=None):
        """Upload an image file and store its URL on ``desktop_image`` or ``mobile_image``."""
        from catalog.services.media import MediaUploadError, save_upload

        banner = self.get_object()
        target = str(request.data.get("target") or "desktop").lower()
        field = {"desktop": "desktop_image", "mobile": "mobile_image"}.get(target)
        if not field:
            return Response({"detail": "target must be 'desktop' or 'mobile'"}, status=status.HTTP_400_BAD_REQUEST)
        upload = request.FILES.get("file") or request.FILES.get("image")
        if not upload:
            return Response({"detail": "file is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            path, url, mime = save_upload(upload, getattr(upload, "name", "") or "")
        except MediaUploadError as exc:
            return Response({"detail": exc.message}, status=exc.status)
        setattr(banner, field, url)
        banner.save(update_fields=[field, "updated_at"])
        record_audit(
            request.user,
            "cms.banner.image_uploaded",
            entity_type="Banner",
            entity_id=banner.pk,
            meta={"field": field, "path": path, "mime_type": mime},
        )
        return Response(AdminBannerSerializer(banner, context={"request": request}).data)


class AdminFAQViewSet(_ContentPermissionMixin, AuditedModelViewSetMixin, viewsets.ModelViewSet):
    audit_prefix = "cms.faq"
    permission_classes = [IsAdminUser, HasAdminPermission]
    serializer_class = AdminFAQSerializer
    queryset = FAQ.objects.all()
    search_fields = ["question_en", "question_ar"]
    filterset_fields = ["published"]


class AdminContentPageViewSet(_ContentPermissionMixin, AuditedModelViewSetMixin, viewsets.ModelViewSet):
    audit_prefix = "cms.page"
    permission_classes = [IsAdminUser, HasAdminPermission]
    serializer_class = AdminContentPageSerializer
    queryset = ContentPage.objects.all().order_by("slug")
    lookup_field = "slug"
    search_fields = ["slug", "title_en", "title_ar"]
    filterset_fields = ["published"]


class AdminSiteSettingsView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "settings.manage"

    def get(self, request):
        return Response(SiteSettingsSerializer(SiteSettings.load()).data)

    def patch(self, request):
        settings_obj = SiteSettings.load()
        before = SiteSettingsSerializer(settings_obj).data
        serializer = SiteSettingsSerializer(settings_obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        after = serializer.data
        changed = sorted(k for k in after if k != "updated_at" and before.get(k) != after.get(k))
        record_audit(
            request.user,
            "settings.updated",
            entity_type="SiteSettings",
            entity_id=1,
            meta={"fields": changed, "changes": {k: {"from": before.get(k), "to": after.get(k)} for k in changed}},
        )
        return Response(after)


# Backward-compatible list/create alias used previously
class AdminBannerView(AdminBannerViewSet):
    pass
