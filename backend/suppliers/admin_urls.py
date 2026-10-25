from django.urls import include, path
from rest_framework.routers import DefaultRouter

from suppliers.views import (
    AdminSupplierViewSet,
    OrderItemSupplierBuyView,
    OrderItemSupplierCheckView,
    OrderItemSupplierPurchaseView,
    SupplierAlertListView,
    SupplierAlertResolveView,
    SupplierBalanceRefreshView,
    SupplierBalanceView,
    SupplierCatalogCategoriesView,
    SupplierCatalogListView,
    SupplierLogsView,
    SupplierMappingDetailView,
    SupplierMappingListView,
    SupplierOrderCheckView,
    SupplierOrderDetailView,
    SupplierOrderListView,
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
    path("1epin/sync/", SupplierSyncView.as_view()),  # alias of catalog/sync/
    path("1epin/catalog/sync/", SupplierSyncView.as_view()),
    path("1epin/catalog/categories/", SupplierCatalogCategoriesView.as_view()),
    path("1epin/catalog/", SupplierCatalogListView.as_view()),
    path("1epin/mappings/", SupplierMappingListView.as_view()),
    path("1epin/mappings/<int:mapping_id>/", SupplierMappingDetailView.as_view()),
    path("1epin/orders/", SupplierOrderListView.as_view()),
    path("1epin/orders/<int:so_id>/", SupplierOrderDetailView.as_view()),
    path("1epin/orders/<int:so_id>/check/", SupplierOrderCheckView.as_view()),
    path("1epin/alerts/", SupplierAlertListView.as_view()),
    path("1epin/alerts/<int:alert_id>/resolve/", SupplierAlertResolveView.as_view()),
    path("1epin/logs/", SupplierLogsView.as_view()),
    # Per order item (admin order page).
    path("orders/<str:pk>/items/<int:item_id>/supplier/check/", OrderItemSupplierCheckView.as_view()),
    path("orders/<str:pk>/items/<int:item_id>/supplier/retry/", OrderItemSupplierPurchaseView.as_view()),
    path("orders/<str:pk>/items/<int:item_id>/supplier/buy/", OrderItemSupplierBuyView.as_view()),
    path("", include(router.urls)),
]
