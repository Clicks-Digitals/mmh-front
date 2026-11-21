import re

from django.db.models import Q
from django.utils import timezone
from rest_framework import generics, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.drf_permissions import HasAdminPermission, IsAdminUser
from accounts.validators import normalize_whatsapp
from audit.services import AuditedModelViewSetMixin, record_audit
from catalog.serializers import media_absolute_url
from catalog.services.entity_images import entity_image_response
from cms.currencies import clean_currency_rates, effective_currencies
from cms.design import clean_home_layout, clean_theme
from cms.models import Banner, ContentPage, FAQ, HomeTile, SiteSettings

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


def banner_status(banner, now=None) -> str:
    """CA-24: ``unpublished`` | ``scheduled`` (starts later) | ``expired`` (ended) | ``live``."""
    if not banner.published:
        return "unpublished"
    now = now or timezone.now()
    if banner.start_at and banner.start_at > now:
        return "scheduled"
    if banner.end_at and banner.end_at <= now:
        return "expired"
    return "live"


class AdminBannerSerializer(serializers.ModelSerializer):
    """Stores image values as given; ``*_image_url`` are the absolute display URLs."""

    desktop_image_url = serializers.SerializerMethodField()
    mobile_image_url = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()

    class Meta:
        model = Banner
        fields = BANNER_PUBLIC_FIELDS + (
            "desktop_image_url",
            "mobile_image_url",
            "status",
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

    def get_status(self, obj) -> str:
        return banner_status(obj)

    def validate(self, attrs):
        start = attrs.get("start_at", getattr(self.instance, "start_at", None))
        end = attrs.get("end_at", getattr(self.instance, "end_at", None))
        if start and end and end <= start:
            raise serializers.ValidationError({"end_at": "End must be after start"})
        return attrs


# Backwards-compatible name.
BannerSerializer = AdminBannerSerializer


HOME_TILE_PUBLIC_FIELDS = (
    "id",
    "section",
    "title_en",
    "title_ar",
    "href",
    "image_url",
    "artwork_key",
    "sort_order",
)


class PublicHomeTileSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = HomeTile
        fields = HOME_TILE_PUBLIC_FIELDS
        read_only_fields = HOME_TILE_PUBLIC_FIELDS

    def get_image_url(self, obj) -> str:
        """Uploaded tile picture (absolute) or "" -> the store shows built-in artwork for artwork_key."""
        return media_absolute_url(self.context.get("request"), obj.image)


class AdminHomeTileSerializer(PublicHomeTileSerializer):
    class Meta:
        model = HomeTile
        fields = HOME_TILE_PUBLIC_FIELDS + ("image", "published", "created_at", "updated_at")
        # ``image`` is set only through POST/DELETE admin/home-tiles/<id>/image/.
        read_only_fields = ("id", "image", "image_url", "created_at", "updated_at")

    def validate_href(self, value: str) -> str:
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("Enter the link, e.g. /product/steam-wallet.")
        if not (value.startswith("/") or value.startswith("https://")):
            raise serializers.ValidationError(
                "Use a store path starting with / (e.g. /category/steam) or a full https:// link."
            )
        return value


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
        fields = ("slug", "title_en", "title_ar", "show_in_footer", "sort_order")
        read_only_fields = fields


PAGE_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class AdminContentPageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContentPage
        fields = (
            "id",
            "slug",
            "title_en",
            "title_ar",
            "body_en",
            "body_ar",
            "published",
            "show_in_footer",
            "sort_order",
            "updated_at",
        )
        read_only_fields = ("id", "updated_at")

    def validate_slug(self, value: str) -> str:
        value = (value or "").strip().lower()
        if not PAGE_SLUG_RE.fullmatch(value):
            raise serializers.ValidationError(
                "Use lowercase letters, digits and single hyphens only (e.g. shipping-info)."
            )
        qs = ContentPage.objects.filter(slug=value)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("A page with this slug already exists")
        return value


ContentPageSerializer = AdminContentPageSerializer


class SiteSettingsSerializer(serializers.ModelSerializer):
    logo_image_url = serializers.SerializerMethodField()
    hero_image_url = serializers.SerializerMethodField()
    currencies = serializers.SerializerMethodField()

    def get_currencies(self, obj) -> list[dict]:
        return effective_currencies(obj.currency_rates)

    def get_logo_image_url(self, obj) -> str:
        return media_absolute_url(self.context.get("request"), obj.logo_image)

    def get_hero_image_url(self, obj) -> str:
        return media_absolute_url(self.context.get("request"), obj.hero_image)

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
            "currency_rates",
            "currencies",
            "theme",
            "home_layout",
            "logo_image",
            "logo_image_url",
            "hero_image",
            "hero_image_url",
            "updated_at",
        )
        # Pictures are set only through POST/DELETE admin/settings/image/?target=logo|hero.
        read_only_fields = ("logo_image", "hero_image", "updated_at")

    def validate_whatsapp_number(self, value):
        try:
            return normalize_whatsapp(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from exc

    def validate_currency_rates(self, value):
        try:
            return clean_currency_rates(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from exc

    def validate_theme(self, value):
        try:
            return clean_theme(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from exc

    def validate_home_layout(self, value):
        try:
            return clean_home_layout(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from exc

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
    "logo_image_url",
    "hero_image_url",
    "theme",
    "home_layout",
)


class PublicSiteSettingsView(APIView):
    """Storefront-safe settings. Never add internal settings (thresholds, etc.) here."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        data = SiteSettingsSerializer(SiteSettings.load(), context={"request": request}).data
        body = {key: data[key] for key in PUBLIC_SETTINGS_FIELDS}
        body["currencies"] = [c for c in data["currencies"] if c["enabled"]]
        return Response(body)


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


class HomeTileListView(generics.ListAPIView):
    """Published home tiles (sort_order). Optional ?section=SUGGESTED."""

    permission_classes = [AllowAny]
    serializer_class = PublicHomeTileSerializer
    pagination_class = None
    filter_backends: list = []

    def get_queryset(self):
        qs = HomeTile.objects.filter(published=True).order_by("section", "sort_order", "id")
        section = (self.request.query_params.get("section") or "").strip().upper()
        if section:
            qs = qs.filter(section=section)
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
    queryset = ContentPage.objects.filter(published=True).order_by("sort_order", "slug")
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
        methods=["post", "delete"],
        url_path="image",
        parser_classes=[MultiPartParser, FormParser, JSONParser],
    )
    def upload_image(self, request, pk=None):
        """POST: upload an image file into ``desktop_image`` / ``mobile_image`` (``target``).

        DELETE ``?target=desktop|mobile``: clear that image (CA-24).
        """
        from catalog.services.media import MediaUploadError, save_upload

        banner = self.get_object()
        raw_target = request.query_params.get("target") if request.method == "DELETE" else None
        target = str(raw_target or request.data.get("target") or ("" if request.method == "DELETE" else "desktop")).lower()
        field = {"desktop": "desktop_image", "mobile": "mobile_image"}.get(target)
        if not field:
            return Response(
                {"detail": "target must be 'desktop' or 'mobile'", "code": "validation_error"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if request.method == "DELETE":
            previous = getattr(banner, field)
            setattr(banner, field, "")
            banner.save(update_fields=[field, "updated_at"])
            record_audit(
                request.user,
                "cms.banner.image_removed",
                entity_type="Banner",
                entity_id=banner.pk,
                meta={"field": field, "previous": previous[:200], "title_en": banner.title_en},
            )
            return Response(AdminBannerSerializer(banner, context={"request": request}).data)
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


class AdminHomeTileViewSet(_ContentPermissionMixin, AuditedModelViewSetMixin, viewsets.ModelViewSet):
    audit_prefix = "cms.home_tile"
    permission_classes = [IsAdminUser, HasAdminPermission]
    serializer_class = AdminHomeTileSerializer
    queryset = HomeTile.objects.all().order_by("section", "sort_order", "id")
    search_fields = ["title_en", "title_ar", "href"]
    ordering_fields = ["sort_order", "title_en", "created_at"]
    filterset_fields = ["published", "section"]

    @action(
        detail=True,
        methods=["post", "delete"],
        url_path="image",
        parser_classes=[MultiPartParser, FormParser, JSONParser],
    )
    def image(self, request, pk=None):
        """POST multipart ``file``: set the tile picture. DELETE: remove it (built-in artwork again)."""
        tile = self.get_object()
        return entity_image_response(
            request,
            tile,
            audit_prefix="cms.home_tile",
            entity_type="HomeTile",
            label=tile.title_en,
            serialize=lambda obj: AdminHomeTileSerializer(obj, context={"request": request}).data,
        )


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
        return Response(SiteSettingsSerializer(SiteSettings.load(), context={"request": request}).data)

    def patch(self, request):
        settings_obj = SiteSettings.load()
        before = SiteSettingsSerializer(settings_obj, context={"request": request}).data
        serializer = SiteSettingsSerializer(settings_obj, data=request.data, partial=True, context={"request": request})
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


SETTINGS_IMAGE_TARGETS = {"logo": "logo_image", "hero": "hero_image"}


class AdminSiteSettingsImageView(APIView):
    """POST (multipart ``file`` + ``target``) / DELETE ``?target=logo|hero``: store logo / home hero picture."""

    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "settings.manage"
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def _handle(self, request):
        raw = request.query_params.get("target") or (request.data.get("target") if request.method == "POST" else "")
        field = SETTINGS_IMAGE_TARGETS.get(str(raw or "").lower())
        if not field:
            return Response(
                {"detail": "target must be 'logo' or 'hero'", "code": "validation_error"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return entity_image_response(
            request,
            SiteSettings.load(),
            field=field,
            audit_prefix="settings",
            entity_type="SiteSettings",
            label=field,
            serialize=lambda obj: SiteSettingsSerializer(obj, context={"request": request}).data,
        )

    def post(self, request):
        return self._handle(request)

    def delete(self, request):
        return self._handle(request)


class AdminDesignImageView(APIView):
    """POST multipart ``file``: store a picture for a home page image section; returns {url}."""

    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "settings.manage"
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        from catalog.services.media import MediaUploadError, save_upload

        upload = request.FILES.get("file")
        if not upload:
            return Response({"detail": "Choose a picture.", "code": "validation_error"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            _path, url, _mime = save_upload(upload, upload.name)
        except MediaUploadError as exc:
            return Response({"detail": str(exc), "code": "validation_error"}, status=status.HTTP_400_BAD_REQUEST)
        record_audit(request.user, "settings.design_image_uploaded", entity_type="SiteSettings", entity_id=1, meta={"url": url})
        return Response({"url": url, "absolute_url": media_absolute_url(request, url)}, status=status.HTTP_201_CREATED)


# Backward-compatible list/create alias used previously
class AdminBannerView(AdminBannerViewSet):
    pass
