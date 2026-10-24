from django.urls import path

from commerce.paypal_views import (
    PayPalCaptureOrderView,
    PayPalConfigView,
    PayPalCreateOrderView,
    PayPalWebhookView,
)
from commerce.views import (
    CouponValidateView,
    CreateOrderView,
    CustomerOrderCancelView,
    MyOrdersView,
    OrderCodesView,
    OrderDetailView,
)

urlpatterns = [
    path("coupons/validate/", CouponValidateView.as_view()),
    path("checkout/orders/", CreateOrderView.as_view()),
    path("payments/paypal/config/", PayPalConfigView.as_view()),
    path("payments/paypal/create-order/", PayPalCreateOrderView.as_view()),
    path("payments/paypal/capture-order/", PayPalCaptureOrderView.as_view()),
    path("payments/paypal/webhook/", PayPalWebhookView.as_view()),
    path("orders/mine/", MyOrdersView.as_view()),
    path("orders/<str:order_number>/codes/", OrderCodesView.as_view()),
    path("orders/<str:order_number>/cancel/", CustomerOrderCancelView.as_view()),
    path("orders/<str:order_number>/", OrderDetailView.as_view()),
]
