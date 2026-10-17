from rest_framework import generics, serializers, viewsets
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.drf_permissions import HasAdminPermission, IsAdminUser
from cms.models import Banner, ContentPage, FAQ, SiteSettings


class BannerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Banner
        fields = "__all__"


class FAQSerializer(serializers.ModelSerializer):
    class Meta:
        model = FAQ
        fields = "__all__"


class ContentPageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContentPage
        fields = "__all__"


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
            "currency_display",
            "low_stock_threshold",
            "maintenance_mode",
            "updated_at",
        )
        read_only_fields = ("updated_at",)


PUBLIC_SETTINGS_FIELDS = (
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
)


class PublicSiteSettingsView(APIView):
    """Contact details for the storefront. Never add internal settings here."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        data = SiteSettingsSerializer(SiteSettings.load()).data
        return Response({key: data[key] for key in PUBLIC_SETTINGS_FIELDS})


class BannerListView(generics.ListAPIView):
    permission_classes = [AllowAny]
    serializer_class = BannerSerializer
    queryset = Banner.objects.filter(published=True)
    pagination_class = None


class FAQListView(generics.ListAPIView):
    permission_classes = [AllowAny]
    serializer_class = FAQSerializer
    queryset = FAQ.objects.filter(published=True)
    pagination_class = None


class ContentPageDetailView(generics.RetrieveAPIView):
    permission_classes = [AllowAny]
    serializer_class = ContentPageSerializer
    lookup_field = "slug"
    queryset = ContentPage.objects.filter(published=True)


class AdminBannerViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser, HasAdminPermission]
    serializer_class = BannerSerializer
    queryset = Banner.objects.all()
    search_fields = ["title_en", "title_ar", "href"]
    filterset_fields = ["published", "placement"]

    def get_permissions(self):
        self.admin_permission = "content.read" if self.action in {"list", "retrieve"} else "content.write"
        return super().get_permissions()


class AdminFAQViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser, HasAdminPermission]
    serializer_class = FAQSerializer
    queryset = FAQ.objects.all()
    search_fields = ["question_en", "question_ar"]
    filterset_fields = ["published"]

    def get_permissions(self):
        self.admin_permission = "content.read" if self.action in {"list", "retrieve"} else "content.write"
        return super().get_permissions()


class AdminContentPageViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser, HasAdminPermission]
    serializer_class = ContentPageSerializer
    queryset = ContentPage.objects.all()
    lookup_field = "slug"
    search_fields = ["slug", "title_en", "title_ar"]
    filterset_fields = ["published"]

    def get_permissions(self):
        self.admin_permission = "content.read" if self.action in {"list", "retrieve"} else "content.write"
        return super().get_permissions()


class AdminSiteSettingsView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "settings.manage"

    def get(self, request):
        return Response(SiteSettingsSerializer(SiteSettings.load()).data)

    def patch(self, request):
        settings_obj = SiteSettings.load()
        serializer = SiteSettingsSerializer(settings_obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


# Backward-compatible list/create alias used previously
class AdminBannerView(AdminBannerViewSet):
    pass
