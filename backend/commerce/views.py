from __future__ import annotations

from django.db.models import Count, Q, Sum
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django_filters import rest_framework as filters
from rest_framework import generics, serializers, status, viewsets
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.drf_permissions import HasAdminPermission, IsAdminUser, IsCustomer
from accounts.models import CustomerProfile
from audit.models import AuditLog
from catalog.models import Product, ProductVariant, PublishStatus, StockStatus
from commerce.crypto import decrypt_code
from commerce.models import (
    CodeImportBatch,
    CodeImportBatchStatus,
    CodeImportMode,
    Coupon,
    DigitalCode,
    DigitalCodeStatus,
    FulfillmentStatus,
    Order,
    OrderItem,
    Payment,
    PaymentStatus,
)
from commerce.services.checkout import CheckoutError, create_storefront_order, validate_coupon
from commerce.services.code_import import (
    CodeImportError,
    MAX_ROWS,
    confirm_import,
    create_manual_code,
    deactivate_code,
    preview_import,
    template_csv,
)
from commerce.services.orders import OrderTransitionError, transition_order
from suppliers.models import Supplier


# --- Storefront serializers / views (unchanged contract) ---


class CouponValidateSerializer(serializers.Serializer):
    code = serializers.CharField()
    subtotal_jod = serializers.FloatField(required=False, default=0)


class CheckoutItemSerializer(serializers.Serializer):
    product_id = serializers.CharField()
    variant_id = serializers.IntegerField(required=False)
    denomination_id = serializers.CharField(required=False, allow_blank=True)
    quantity = serializers.IntegerField(min_value=1, max_value=5, default=1)
    fields = serializers.DictField(child=serializers.CharField(allow_blank=True), required=False)
    delivery_method = serializers.CharField(required=False, allow_blank=True)
    delivery_contact = serializers.CharField(required=False, allow_blank=True)


class CheckoutSerializer(serializers.Serializer):
    email = serializers.EmailField()
    full_name = serializers.CharField(max_length=160)
    phone = serializers.CharField(max_length=40, required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    coupon_code = serializers.CharField(required=False, allow_blank=True)
    idempotency_key = serializers.CharField(required=False, allow_blank=True)
    region_confirmed = serializers.BooleanField(default=False)
    refund_confirmed = serializers.BooleanField(default=False)
    payment_provider = serializers.CharField(required=False, allow_blank=True)
    items = CheckoutItemSerializer(many=True)

    def validate_payment_provider(self, value: str) -> str:
        value = (value or "").strip().lower()
        if value and value != "paypal":
            raise serializers.ValidationError("Unsupported payment provider")
        return value


class OrderItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderItem
        fields = (
            "id",
            "product_id",
            "variant_id",
            "quantity",
            "unit_price_fils",
            "line_total_fils",
            "product_name",
            "variant_name",
            "customer_fields",
            "delivery_method",
            "delivery_contact",
            "region_name",
            "platform_name",
        )


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    total_jod = serializers.FloatField(read_only=True)
    payment_provider = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = (
            "id",
            "order_number",
            "email",
            "full_name",
            "phone",
            "notes",
            "subtotal_fils",
            "discount_fils",
            "total_fils",
            "total_jod",
            "currency",
            "payment_status",
            "payment_provider",
            "fulfillment_status",
            "created_at",
            "items",
        )

    def get_payment_provider(self, obj: Order) -> str:
        payments = list(obj.payments.all())
        if not payments:
            return ""
        return max(payments, key=lambda payment: payment.id).provider


class CouponValidateView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = CouponValidateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            payload = validate_coupon(
                serializer.validated_data["code"],
                serializer.validated_data.get("subtotal_jod") or 0,
            )
            return Response(payload)
        except CheckoutError as exc:
            return Response({"valid": False, "detail": exc.message}, status=exc.status)


def _new_order_payload(order: Order) -> dict:
    data = OrderSerializer(order).data
    payments = list(order.payments.all())
    payment = max(payments, key=lambda item: item.id) if payments else None
    if (
        payment
        and payment.provider == "paypal"
        and payment.checkout_token
        and order.payment_status != PaymentStatus.PAID
    ):
        data["checkout_token"] = payment.checkout_token
        data["paypal_amount"] = payment.provider_amount
        data["paypal_currency"] = payment.currency
    return data


class CreateOrderView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = CheckoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            order = create_storefront_order(data=serializer.validated_data, user=request.user)
        except CheckoutError as exc:
            return Response({"detail": exc.message, "code": "checkout_error"}, status=exc.status)
        return Response(_new_order_payload(order), status=status.HTTP_201_CREATED)


class MyOrdersView(generics.ListAPIView):
    permission_classes = [IsAuthenticated, IsCustomer]
    serializer_class = OrderSerializer

    def get_queryset(self):
        return Order.objects.filter(user=self.request.user).prefetch_related("items", "payments")


class OrderDetailView(generics.RetrieveAPIView):
    permission_classes = [AllowAny]
    serializer_class = OrderSerializer
    lookup_field = "order_number"

    def get_queryset(self):
        return Order.objects.prefetch_related("items", "payments")


# --- Admin serializers ---


class AdminMaskedCodeSerializer(serializers.ModelSerializer):
    order_number = serializers.CharField(source="order_item.order.order_number", read_only=True, allow_null=True)
    variant_sku = serializers.CharField(source="variant.sku", read_only=True, allow_null=True)
    variant_name = serializers.CharField(source="variant.name_en", read_only=True, allow_null=True)
    product_id = serializers.CharField(source="variant.product_id", read_only=True, allow_null=True)

    class Meta:
        model = DigitalCode
        fields = (
            "id",
            "masked",
            "status",
            "source",
            "variant",
            "variant_sku",
            "variant_name",
            "product_id",
            "order_item",
            "order_number",
            "created_at",
            "revealed_at",
        )


class AdminPaymentSerializer(serializers.ModelSerializer):
    order_number = serializers.CharField(source="order.order_number", read_only=True)

    class Meta:
        model = Payment
        fields = (
            "id",
            "order",
            "order_number",
            "provider",
            "status",
            "amount_fils",
            "currency",
            "provider_amount",
            "provider_order_id",
            "provider_capture_id",
            "external_ref",
            "paid_at",
            "created_at",
            "updated_at",
        )


class AdminOrderItemSerializer(OrderItemSerializer):
    codes = AdminMaskedCodeSerializer(many=True, read_only=True)

    class Meta(OrderItemSerializer.Meta):
        fields = OrderItemSerializer.Meta.fields + ("codes",)


class AdminOrderSerializer(serializers.ModelSerializer):
    items = AdminOrderItemSerializer(many=True, read_only=True)
    payments = AdminPaymentSerializer(many=True, read_only=True)
    total_jod = serializers.FloatField(read_only=True)

    class Meta:
        model = Order
        fields = (
            "id",
            "order_number",
            "user",
            "email",
            "full_name",
            "phone",
            "notes",
            "coupon",
            "subtotal_fils",
            "discount_fils",
            "total_fils",
            "total_jod",
            "currency",
            "payment_status",
            "fulfillment_status",
            "region_confirmed",
            "refund_confirmed",
            "created_at",
            "updated_at",
            "items",
            "payments",
        )


class AdminOrderListSerializer(serializers.ModelSerializer):
    total_jod = serializers.FloatField(read_only=True)
    item_count = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = (
            "id",
            "order_number",
            "email",
            "full_name",
            "total_fils",
            "total_jod",
            "currency",
            "payment_status",
            "fulfillment_status",
            "created_at",
            "item_count",
        )

    def get_item_count(self, obj):
        return obj.items.count()


class OrderTransitionSerializer(serializers.Serializer):
    payment_status = serializers.ChoiceField(choices=PaymentStatus.choices, required=False)
    fulfillment_status = serializers.ChoiceField(choices=FulfillmentStatus.choices, required=False)
    refund_amount_fils = serializers.IntegerField(required=False, min_value=1)

    def validate(self, attrs):
        if "payment_status" not in attrs and "fulfillment_status" not in attrs:
            raise serializers.ValidationError("Provide payment_status and/or fulfillment_status")
        return attrs


class CouponSerializer(serializers.ModelSerializer):
    class Meta:
        model = Coupon
        fields = (
            "id",
            "code",
            "description",
            "percent_off",
            "amount_off_fils",
            "active",
            "starts_at",
            "ends_at",
            "max_uses",
            "used_count",
            "created_at",
        )
        read_only_fields = ("used_count", "created_at")


class OrderFilter(filters.FilterSet):
    payment_status = filters.CharFilter()
    fulfillment_status = filters.CharFilter()
    search = filters.CharFilter(method="filter_search")

    class Meta:
        model = Order
        fields = ["payment_status", "fulfillment_status"]

    def filter_search(self, queryset, name, value):
        return queryset.filter(
            Q(order_number__icontains=value)
            | Q(email__icontains=value)
            | Q(full_name__icontains=value)
            | Q(phone__icontains=value)
        )


class DigitalCodeFilter(filters.FilterSet):
    status = filters.CharFilter()
    variant = filters.NumberFilter(field_name="variant_id")

    class Meta:
        model = DigitalCode
        fields = ["status", "variant"]


# --- Admin views ---


class AdminDashboardView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "orders.read"

    def get(self, request):
        paid = Order.objects.filter(payment_status=PaymentStatus.PAID)
        revenue = paid.aggregate(total=Coalesce(Sum("total_fils"), 0))["total"] or 0
        status_breakdown = list(
            Order.objects.values("payment_status", "fulfillment_status").annotate(count=Count("id")).order_by()
        )
        top_products = list(
            OrderItem.objects.filter(order__payment_status=PaymentStatus.PAID)
            .values("product_id", "product_name")
            .annotate(quantity=Sum("quantity"), revenue_fils=Sum("line_total_fils"), orders=Count("order", distinct=True))
            .order_by("-quantity")[:10]
        )
        recent_orders = AdminOrderListSerializer(
            Order.objects.prefetch_related("items")[:10], many=True
        ).data
        recent_audit = list(
            AuditLog.objects.select_related("actor").values(
                "id", "action", "entity_type", "entity_id", "created_at", "actor_id"
            )[:10]
        )
        return Response(
            {
                "revenue_fils": revenue,
                "orders_count": Order.objects.count(),
                "customers_count": CustomerProfile.objects.count(),
                "products_count": Product.objects.count(),
                "active_products": Product.objects.filter(status=PublishStatus.PUBLISHED).count(),
                "codes_available": DigitalCode.objects.filter(status=DigitalCodeStatus.AVAILABLE).count(),
                "low_stock_variants": ProductVariant.objects.filter(stock_status=StockStatus.OUT_OF_STOCK).count(),
                "pending_orders": Order.objects.filter(payment_status=PaymentStatus.PENDING).count(),
                "failed_fulfillment": Order.objects.filter(fulfillment_status=FulfillmentStatus.FAILED).count(),
                "active_suppliers": Supplier.objects.filter(active=True).count(),
                "order_status_breakdown": status_breakdown,
                "top_products": top_products,
                "recent_orders": recent_orders,
                "recent_audit": recent_audit,
            }
        )


class AdminOrderViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "orders.read"
    filterset_class = OrderFilter
    search_fields = ["order_number", "email", "full_name", "phone"]
    ordering_fields = ["created_at", "total_fils", "order_number"]
    queryset = Order.objects.prefetch_related("items__codes", "payments").select_related("coupon", "user")
    lookup_value_regex = r"[^/]+"

    def get_serializer_class(self):
        if self.action == "list":
            return AdminOrderListSerializer
        return AdminOrderSerializer

    def get_object(self):
        lookup = self.kwargs.get(self.lookup_field or "pk")
        qs = self.filter_queryset(self.get_queryset())
        if str(lookup).isdigit():
            obj = qs.filter(Q(pk=lookup) | Q(order_number=lookup)).first()
        else:
            obj = qs.filter(order_number=lookup).first()
        if not obj:
            from rest_framework.exceptions import NotFound

            raise NotFound()
        self.check_object_permissions(self.request, obj)
        return obj


class AdminOrderTransitionView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "orders.write"

    def post(self, request, pk):
        order = get_object_or_404(Order, pk=pk) if str(pk).isdigit() else get_object_or_404(Order, order_number=pk)
        serializer = OrderTransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payment_status = serializer.validated_data.get("payment_status")
        fulfillment_status = serializer.validated_data.get("fulfillment_status")
        if payment_status in {PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED}:
            paypal_statuses = [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED]
            paypal_payment = (
                order.payments.filter(provider="paypal", status__in=paypal_statuses).order_by("-id").first()
            )
            if paypal_payment:
                if payment_status == PaymentStatus.PARTIALLY_REFUNDED and not serializer.validated_data.get(
                    "refund_amount_fils"
                ):
                    return Response(
                        {"detail": "Provide refund_amount_fils for a partial PayPal refund"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                from commerce.services.payment import PaymentError
                from commerce.services.paypal import refund_paypal_payment

                try:
                    refund_paypal_payment(
                        paypal_payment,
                        actor=request.user,
                        amount_fils=(
                            serializer.validated_data.get("refund_amount_fils")
                            if payment_status == PaymentStatus.PARTIALLY_REFUNDED
                            else None
                        ),
                    )
                except PaymentError as exc:
                    return Response({"detail": exc.message, "code": exc.code}, status=exc.status)
                order.refresh_from_db()
                payment_status = None
        try:
            if payment_status or fulfillment_status:
                order = transition_order(
                    order,
                    payment_status=payment_status,
                    fulfillment_status=fulfillment_status,
                    actor=request.user,
                )
        except OrderTransitionError as exc:
            return Response({"detail": exc.message}, status=exc.status)
        return Response(AdminOrderSerializer(order).data)


class AdminDigitalCodeListView(generics.ListAPIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "codes.read"
    serializer_class = AdminMaskedCodeSerializer
    filterset_class = DigitalCodeFilter
    search_fields = ["masked", "variant__sku", "order_item__order__order_number"]
    queryset = DigitalCode.objects.select_related(
        "variant", "variant__product", "order_item", "order_item__order"
    )


class RevealCodeView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "codes.reveal"

    def post(self, request, code_id: int):
        code = DigitalCode.objects.select_related("order_item").filter(id=code_id).first()
        if not code:
            return Response({"detail": "Not found"}, status=404)
        plaintext = decrypt_code(code.ciphertext, code.nonce)
        code.revealed_at = timezone.now()
        code.revealed_by = request.user
        code.save(update_fields=["revealed_at", "revealed_by"])
        AuditLog.objects.create(
            actor=request.user,
            action="codes.reveal",
            entity_type="DigitalCode",
            entity_id=str(code.id),
            meta={"order_item_id": code.order_item_id, "masked": code.masked},
        )
        return Response({"id": code.id, "code": plaintext, "masked": code.masked})


class AdminPaymentListView(generics.ListAPIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "orders.read"
    serializer_class = AdminPaymentSerializer
    search_fields = [
        "external_ref",
        "order__order_number",
        "provider",
        "provider_order_id",
        "provider_capture_id",
    ]
    filterset_fields = ["status", "provider"]
    queryset = Payment.objects.select_related("order").order_by("-created_at")


class AdminCouponViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser, HasAdminPermission]
    serializer_class = CouponSerializer
    queryset = Coupon.objects.all()
    search_fields = ["code", "description"]
    filterset_fields = ["active"]

    def get_permissions(self):
        self.admin_permission = "orders.read" if self.action in {"list", "retrieve"} else "orders.write"
        return super().get_permissions()


# --- Bulk digital-code import ---


class CodeImportBatchSerializer(serializers.ModelSerializer):
    uploaded_by_email = serializers.CharField(source="uploaded_by.email", read_only=True, allow_null=True)
    variant_sku = serializers.CharField(source="variant.sku", read_only=True, allow_null=True)
    product_id = serializers.CharField(source="variant.product_id", read_only=True, allow_null=True)

    class Meta:
        model = CodeImportBatch
        fields = (
            "id",
            "filename",
            "mode",
            "status",
            "variant",
            "variant_sku",
            "product_id",
            "uploaded_by",
            "uploaded_by_email",
            "total_rows",
            "valid_rows",
            "imported_rows",
            "duplicate_rows",
            "failed_rows",
            "preview_rows",
            "error_report",
            "created_at",
            "completed_at",
        )


class AdminCodeImportPreviewView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "codes.manage"
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request):
        upload = request.FILES.get("file")
        if not upload:
            return Response({"detail": "file is required"}, status=status.HTTP_400_BAD_REQUEST)
        mode = (request.data.get("mode") or CodeImportMode.SIMPLE).upper()
        variant_raw = request.data.get("variant_id")
        variant_id = int(variant_raw) if str(variant_raw or "").isdigit() else None
        try:
            raw = upload.read()
            batch = preview_import(
                uploaded_by=request.user,
                filename=getattr(upload, "name", "upload.csv") or "upload.csv",
                raw=raw,
                mode=mode,
                variant_id=variant_id,
            )
        except CodeImportError as exc:
            return Response({"detail": exc.message}, status=exc.status)
        return Response(
            {
                "batch": CodeImportBatchSerializer(batch).data,
                "max_rows": MAX_ROWS,
            },
            status=status.HTTP_201_CREATED,
        )


class AdminCodeImportConfirmView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "codes.manage"

    def post(self, request):
        batch_id = request.data.get("batch_id")
        if not str(batch_id or "").isdigit():
            return Response({"detail": "batch_id is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            batch = confirm_import(batch_id=int(batch_id), actor=request.user)
        except CodeImportError as exc:
            return Response({"detail": exc.message}, status=exc.status)
        AuditLog.objects.create(
            actor=request.user,
            action="codes.import.completed",
            entity_type="CodeImportBatch",
            entity_id=str(batch.id),
            meta={
                "filename": batch.filename,
                "variant_id": batch.variant_id,
                "total_rows": batch.total_rows,
                "imported_rows": batch.imported_rows,
                "duplicate_rows": batch.duplicate_rows,
                "failed_rows": batch.failed_rows,
                "status": batch.status,
            },
        )
        return Response(CodeImportBatchSerializer(batch).data)


class AdminCodeImportBatchListView(generics.ListAPIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "codes.manage"
    serializer_class = CodeImportBatchSerializer
    queryset = CodeImportBatch.objects.select_related("uploaded_by", "variant", "variant__product")


class AdminCodeImportBatchDetailView(generics.RetrieveAPIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "codes.manage"
    serializer_class = CodeImportBatchSerializer
    queryset = CodeImportBatch.objects.select_related("uploaded_by", "variant", "variant__product")


class AdminCodeImportErrorsView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "codes.manage"

    def get(self, request, batch_id: int):
        batch = CodeImportBatch.objects.filter(pk=batch_id).first()
        if not batch:
            return Response({"detail": "Not found"}, status=404)
        # Safe CSV: row + error only (no plaintext codes)
        import csv
        import io

        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["row", "sku", "error"])
        for item in batch.error_report or []:
            writer.writerow([item.get("row", ""), item.get("sku", ""), item.get("error", "")])
        from django.http import HttpResponse

        response = HttpResponse(buf.getvalue(), content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="import-{batch.id}-errors.csv"'
        return response


class AdminCodeImportTemplateView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "codes.manage"

    def get(self, request):
        mode = (request.query_params.get("mode") or CodeImportMode.SIMPLE).upper()
        if mode not in {CodeImportMode.SIMPLE, CodeImportMode.ADVANCED}:
            mode = CodeImportMode.SIMPLE
        from django.http import HttpResponse

        content = template_csv(mode)
        response = HttpResponse(content, content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="code-import-{mode.lower()}.csv"'
        return response


class AdminManualCodeCreateView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "codes.manage"

    def post(self, request):
        variant_id = request.data.get("variant_id")
        code = request.data.get("code")
        pin = request.data.get("pin")
        if not str(variant_id or "").isdigit():
            return Response({"detail": "variant_id is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            obj = create_manual_code(
                variant_id=int(variant_id),
                code=str(code or ""),
                pin=str(pin) if pin not in (None, "") else None,
                actor=request.user,
            )
        except CodeImportError as exc:
            return Response({"detail": exc.message}, status=exc.status)
        AuditLog.objects.create(
            actor=request.user,
            action="codes.manual_create",
            entity_type="DigitalCode",
            entity_id=str(obj.id),
            meta={"variant_id": obj.variant_id, "masked": obj.masked, "source": obj.source},
        )
        return Response(AdminMaskedCodeSerializer(obj).data, status=status.HTTP_201_CREATED)


class AdminCodeDeactivateView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "codes.manage"

    def post(self, request, code_id: int):
        try:
            obj = deactivate_code(code_id=code_id, actor=request.user)
        except CodeImportError as exc:
            return Response({"detail": exc.message}, status=exc.status)
        AuditLog.objects.create(
            actor=request.user,
            action="codes.deactivate",
            entity_type="DigitalCode",
            entity_id=str(obj.id),
            meta={"variant_id": obj.variant_id, "masked": obj.masked},
        )
        return Response(AdminMaskedCodeSerializer(obj).data)
