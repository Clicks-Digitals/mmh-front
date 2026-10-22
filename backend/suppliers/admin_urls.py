from django.urls import include, path
from rest_framework.routers import DefaultRouter

from suppliers.views import (
    AdminSupplierViewSet,
    SupplierBalanceRefreshView,
    SupplierBalanceView,
    SupplierLogsView,
    SupplierPingView,
    SupplierStatusView,
    SupplierSyncView,
)

router = DefaultRouter()
router.register("suppliers", AdminSupplierViewSet, basename="admin-suppliers")

urlpatterns = [
    path("1epin/status/", SupplierStatusView.as_view()),
    path("1epin/ping/", SupplierPingView.as_view()),
    path("1epin/balance/", SupplierBalanceView.as_view()),
    path("1epin/balance/refresh/", SupplierBalanceRefreshView.as_view()),
    path("1epin/sync/", SupplierSyncView.as_view()),
    path("1epin/logs/", SupplierLogsView.as_view()),
    path("", include(router.urls)),
]
