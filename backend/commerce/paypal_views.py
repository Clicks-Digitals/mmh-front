from __future__ import annotations

from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from commerce.services.payment import PaymentError
from commerce.services.paypal import capture_paypal_order, create_checkout_order, handle_webhook, public_config


class PayPalCreateOrderSerializer(serializers.Serializer):
    order_number = serializers.CharField(max_length=32)
    checkout_token = serializers.CharField(max_length=64)


class PayPalCaptureSerializer(serializers.Serializer):
    paypal_order_id = serializers.CharField(max_length=64)


class PayPalConfigView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        return Response(public_config())


class PayPalCreateOrderView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PayPalCreateOrderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            payload = create_checkout_order(
                order_number=serializer.validated_data["order_number"],
                checkout_token=serializer.validated_data["checkout_token"],
                user=request.user,
            )
        except PaymentError as exc:
            return Response({"detail": exc.message, "code": exc.code}, status=exc.status)
        return Response(payload)


class PayPalCaptureOrderView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PayPalCaptureSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            payload = capture_paypal_order(
                paypal_order_id=serializer.validated_data["paypal_order_id"],
                user=request.user,
            )
        except PaymentError as exc:
            return Response({"detail": exc.message, "code": exc.code}, status=exc.status)
        return Response(payload)


class PayPalWebhookView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        event = request.data if isinstance(request.data, dict) else None
        if not event:
            return Response({"detail": "Invalid webhook payload"}, status=status.HTTP_400_BAD_REQUEST)
        headers = {
            "auth_algo": request.headers.get("Paypal-Auth-Algo", ""),
            "cert_url": request.headers.get("Paypal-Cert-Url", ""),
            "transmission_id": request.headers.get("Paypal-Transmission-Id", ""),
            "transmission_sig": request.headers.get("Paypal-Transmission-Sig", ""),
            "transmission_time": request.headers.get("Paypal-Transmission-Time", ""),
        }
        try:
            result = handle_webhook(headers=headers, event=event)
        except PaymentError as exc:
            return Response({"detail": exc.message, "code": exc.code}, status=exc.status)
        return Response({"status": result})
