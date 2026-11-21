from django.urls import include, path
from rest_framework.routers import DefaultRouter

from cms.views import (
    AdminBannerViewSet,
    AdminContentPageViewSet,
    AdminDesignImageView,
    AdminFAQViewSet,
    AdminHomeTileViewSet,
    AdminSiteSettingsImageView,
    AdminSiteSettingsView,
)

router = DefaultRouter()
router.register("banners", AdminBannerViewSet, basename="admin-banners")
router.register("faqs", AdminFAQViewSet, basename="admin-faqs")
router.register("pages", AdminContentPageViewSet, basename="admin-pages")
router.register("home-tiles", AdminHomeTileViewSet, basename="admin-home-tiles")

urlpatterns = [
    path("settings/", AdminSiteSettingsView.as_view()),
    path("settings/image/", AdminSiteSettingsImageView.as_view()),
    path("settings/design-image/", AdminDesignImageView.as_view()),
    path("", include(router.urls)),
]
