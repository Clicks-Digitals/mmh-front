from django.urls import include, path
from rest_framework.routers import DefaultRouter

from commerce.views import (
    AdminCodeDeactivateView,
    AdminCodeImportBatchDetailView,
    AdminCodeImportBatchListView,
    AdminCodeImportConfirmView,
    AdminCodeImportErrorsView,
    AdminCodeImportPreviewView,
    AdminCodeImportTemplateView,
    AdminCouponViewSet,
    AdminDashboardView,
    AdminDigitalCodeListView,
    AdminManualCodeCreateView,
    AdminOrderCancelView,
    AdminOrderFulfillView,
    AdminOrderHistoryView,
    AdminOrderRefundView,
    AdminOrderStaffNotesView,
    AdminPaymentExportView,
    AdminOrderItemCodeView,
    AdminOrderItemCustomerFieldsView,
    AdminOrderItemDeliveredView,
    AdminOrderResendEmailView,
    AdminOrderTransitionView,
    AdminOrderViewSet,
    AdminPaymentListView,
    RevealCodeView,
)

router = DefaultRouter()
router.register("orders", AdminOrderViewSet, basename="admin-orders")
router.register("coupons", AdminCouponViewSet, basename="admin-coupons")

urlpatterns = [
    path("dashboard/", AdminDashboardView.as_view()),
    path("codes/", AdminDigitalCodeListView.as_view()),
    path("codes/create/", AdminManualCodeCreateView.as_view()),
    path("codes/<int:code_id>/reveal/", RevealCodeView.as_view()),
    path("codes/<int:code_id>/deactivate/", AdminCodeDeactivateView.as_view()),
    path("codes/import/preview/", AdminCodeImportPreviewView.as_view()),
    path("codes/import/confirm/", AdminCodeImportConfirmView.as_view()),
    path("codes/import/template/", AdminCodeImportTemplateView.as_view()),
    path("codes/imports/", AdminCodeImportBatchListView.as_view()),
    path("codes/imports/<int:pk>/", AdminCodeImportBatchDetailView.as_view()),
    path("codes/imports/<int:batch_id>/errors/", AdminCodeImportErrorsView.as_view()),
    path("payments/", AdminPaymentListView.as_view()),
    path("payments/export/", AdminPaymentExportView.as_view()),
    path("orders/<str:pk>/cancel/", AdminOrderCancelView.as_view()),
    path("orders/<str:pk>/refunds/", AdminOrderRefundView.as_view()),
    path("orders/<str:pk>/staff-notes/", AdminOrderStaffNotesView.as_view()),
    path("orders/<str:pk>/history/", AdminOrderHistoryView.as_view()),
    path("orders/<str:pk>/transition/", AdminOrderTransitionView.as_view()),
    path("orders/<str:pk>/fulfill/", AdminOrderFulfillView.as_view()),
    path("orders/<str:pk>/items/<int:item_id>/codes/", AdminOrderItemCodeView.as_view()),
    path("orders/<str:pk>/items/<int:item_id>/mark-delivered/", AdminOrderItemDeliveredView.as_view()),
    path("orders/<str:pk>/items/<int:item_id>/customer-fields/", AdminOrderItemCustomerFieldsView.as_view()),
    path("orders/<str:pk>/resend-email/", AdminOrderResendEmailView.as_view()),
    path("", include(router.urls)),
]
