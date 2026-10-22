from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path

from config.health import HealthView, ReadinessView
from config.media import serve_media

urlpatterns = [
    path("health/", HealthView.as_view()),
    path("api/health/", HealthView.as_view()),
    path("api/ready/", ReadinessView.as_view()),
    path("api/v1/", include("config.api_urls")),
]

if settings.DJANGO_ADMIN_ENABLED:
    urlpatterns.append(path("django-admin/", admin.site.urls))

# Uploaded media is served in all environments (Railway volume at MEDIA_ROOT); code imports are refused.
_media_prefix = settings.MEDIA_URL.strip("/")
urlpatterns.append(re_path(rf"^{_media_prefix}/(?P<path>.+)$", serve_media, name="media"))
