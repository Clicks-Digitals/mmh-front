from django.urls import path

from cms.views import (
    BannerListView,
    ContentPageDetailView,
    ContentPageListView,
    FAQListView,
    HomeTileListView,
    PublicSiteSettingsView,
)

urlpatterns = [
    path("banners/", BannerListView.as_view()),
    path("faqs/", FAQListView.as_view()),
    path("home-tiles/", HomeTileListView.as_view()),
    path("pages/", ContentPageListView.as_view()),
    path("pages/<slug:slug>/", ContentPageDetailView.as_view()),
    path("settings/", PublicSiteSettingsView.as_view()),
]
