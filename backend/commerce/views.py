from __future__ import annotations

from urllib.parse import urlencode

import csv
import logging
import io
import secrets
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db.models import Count, Q, Sum
from django.db.models.functions import Coalesce
from django.http import HttpResponse
from django.utils import timezone
from django_filters import rest_framework as filters
from rest_framework import generics, serializers, status, viewsets
from rest_framework.exceptions import NotFound
from rest_framework.filters import OrderingFilter, SearchFilter
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.drf_permissions import HasAdminPermission, IsAdminUser, IsCustomer
from accounts.models import CustomerProfile
from accounts.permissions import has_permission
from audit.models import AuditLog
from catalog.models import FulfillmentType, Product, ProductVariant, PublishStatus, StockStatus
from commerce.crypto import code_identity, decrypt_code, reveal_code
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
    Refund,
    RefundStatus,
)
from commerce.services.checkout import (
    DELIVERY_METHODS,
    MAX_CUSTOMER_NOTE,
    MAX_LINES,
    MAX_QTY_PER_LINE,
    MAX_UNITS_PER_ORDER,
    CheckoutError,
    create_storefront_order,
    validate_coupon,
)
from commerce.services.code_import import (
    CodeImportError,
    MAX_ROWS,
    confirm_import,
    create_manual_code,
    deactivate_code,
    preview_import,
    template_csv,
)
from commerce.services.inventory import (
    InventoryError,
    allocate_codes,
    attach_manual_code,
    available_code_counts,
    mark_item_delivered,
    move_fulfillment,
    raw_available_code_counts,
)
from commerce.services.money import format_jod
from commerce.services.orders import (
    PAID_UNREFUNDED,
    REFUND_FIRST,
    UNPAID_CANCELLABLE,
    OrderTransitionError,
    allowed_fulfillment_transitions,
    allowed_payment_transitions,
    can_cancel,
    cancel_order,
    live_code_count,
    order_actions,
    transition_order,
)
from commerce.services.payment import PaymentError, mark_order_paid_manually
from commerce.services.refunds import issue_refund, refund_rows, refund_summary
from commerce.throttling import COMMERCE_THROTTLE_CLASSES
from suppliers.models import Supplier

PAID_LIKE = {PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED}


logger = logging.getLogger("commerce")

def _error(exc, *, default_code: str = "error") -> Response:
    body = {"detail": exc.message, "code": getattr(exc, "code", "") or default_code}
    if getattr(exc, "field", ""):
        body["field"] = exc.field
    body.update(getattr(exc, "extra", None) or {})
    return Response(body, status=exc.status)


# --- Storefront serializers / views ---


class CouponValidateSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=40)
    subtotal_jod = serializers.DecimalField(max_digits=12, decimal_places=3, required=False, min_value=0)
    subtotal_fils = serializers.IntegerField(required=False, min_value=0)
    email = serializers.EmailField(required=False, allow_blank=True)


def _validate_delivery_method_value(value: str) -> str:
    value = (value or "").strip().lower()
    if value and value not in DELIVERY_METHODS:
        raise serializers.ValidationError('Must be "account" or "email"')
    return value


class CheckoutItemSerializer(serializers.Serializer):
    product_id = serializers.CharField(max_length=64)
    variant_id = serializers.IntegerField(required=False, allow_null=True)
    denomination_id = serializers.CharField(required=False, allow_blank=True, max_length=64)
    quantity = serializers.IntegerField(min_value=1, max_value=MAX_QTY_PER_LINE, default=1)
    fields = serializers.DictField(child=serializers.CharField(allow_blank=True, max_length=255), required=False)
    delivery_method = serializers.CharField(required=False, allow_blank=True, max_length=32)
    delivery_contact = serializers.CharField(required=False, allow_blank=True, max_length=255)  # ignored

    def validate_delivery_method(self, value: str) -> str:
        return _validate_delivery_method_value(value)


class CheckoutSerializer(serializers.Serializer):
    email = serializers.EmailField()
    full_name = serializers.CharField(max_length=160)
    phone = serializers.CharField(max_length=40, required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=MAX_CUSTOMER_NOTE)
    coupon_code = serializers.CharField(required=False, allow_blank=True, max_length=40)
    idempotency_key = serializers.CharField(required=False, allow_blank=True, max_length=255)
    region_confirmed = serializers.BooleanField(default=False)
    refund_confirmed = serializers.BooleanField(default=False)
    payment_provider = serializers.CharField(required=False, allow_blank=True)
    delivery_method = serializers.CharField(required=False, allow_blank=True, max_length=32)
    locale = serializers.ChoiceField(choices=["en", "ar"], required=False, default="en")
    items = CheckoutItemSerializer(many=True, allow_empty=False, max_length=MAX_LINES)

    def validate_phone(self, value: str) -> str:
        """Same rules as the store / account phone: Arabic-Indic and Persian digits are
        converted to ASCII before the numeric checks (ST-11 API parity)."""
        from accounts.validators import normalize_phone

        try:
            return normalize_phone(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from exc

    def validate_payment_provider(self, value: str) -> str:
        value = (value or "").strip().lower()
        if value and value != "paypal":
            raise serializers.ValidationError("Unsupported payment provider")
        return value

    def validate_delivery_method(self, value: str) -> str:
        return _validate_delivery_method_value(value)

    def validate_items(self, items):
        if sum(int(item.get("quantity") or 1) for item in items) > MAX_UNITS_PER_ORDER:
            raise serializers.ValidationError(f"An order can contain at most {MAX_UNITS_PER_ORDER} items")
        return items


def _live_codes(item: OrderItem) -> list[DigitalCode]:
    return [code for code in item.codes.all() if code.status != DigitalCodeStatus.UNAVAILABLE]


def _item_delivered(item: OrderItem) -> bool:
    if item.product.fulfillment_type == FulfillmentType.CODE:
        return len(_live_codes(item)) >= item.quantity
    return item.delivered_at is not None


def _item_delivery_state(item: OrderItem) -> str:
    """delivered | partial | pending | retired_refunded (OR-23, ST-28)."""
    if item.product.fulfillment_type == FulfillmentType.CODE:
        codes = list(item.codes.all())
        live = [c for c in codes if c.status != DigitalCodeStatus.UNAVAILABLE]
        if item.order.payment_status == PaymentStatus.REFUNDED and codes and not live:
            return "retired_refunded"
        if len(live) >= item.quantity:
            return "delivered"
        return "partial" if live else "pending"
    if item.delivered_at is not None:
        return "delivered"
    return "pending"


class OrderItemSerializer(serializers.ModelSerializer):
    fulfillment_type = serializers.CharField(source="product.fulfillment_type", read_only=True)
    delivered = serializers.SerializerMethodField()
    delivery_state = serializers.SerializerMethodField()
    codes_delivered = serializers.SerializerMethodField()
    codes_pending = serializers.SerializerMethodField()
    codes = serializers.SerializerMethodField()

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
            "product_name_ar",
            "variant_name",
            "variant_name_ar",
            "fulfillment_type",
            "customer_fields",
            "field_details",
            "delivery_method",
            "delivery_contact",
            "region_name",
            "region_name_ar",
            "platform_name",
            "platform_name_ar",
            "delivered",
            "delivery_state",
            "codes_delivered",
            "codes_pending",
            "delivered_at",
            "delivery_note",
            "codes",
        )

    def get_delivered(self, obj: OrderItem) -> bool:
        return _item_delivered(obj)

    def get_delivery_state(self, obj: OrderItem) -> str:
        return _item_delivery_state(obj)

    def get_codes_delivered(self, obj: OrderItem):
        if obj.product.fulfillment_type != FulfillmentType.CODE:
            return None
        return min(len(_live_codes(obj)), obj.quantity)

    def get_codes_pending(self, obj: OrderItem):
        if obj.product.fulfillment_type != FulfillmentType.CODE:
            return None
        if obj.order.payment_status == PaymentStatus.REFUNDED:
            return 0
        return max(obj.quantity - len(_live_codes(obj)), 0)

    def get_codes(self, obj: OrderItem):
        """Customer view: masked only, delivered codes only. Plaintext needs POST .../codes/."""
        codes = sorted((c for c in obj.codes.all() if c.status == DigitalCodeStatus.DELIVERED), key=lambda c: c.id)
        return [{"id": code.id, "masked": code.masked} for code in codes]


def captured_provider(order: Order) -> str:
    """Provider of the payment that took the money, else of the latest attempt (OR-06)."""
    payments = sorted(order.payments.all(), key=lambda p: p.id)
    captured = [p for p in payments if p.status in PAID_LIKE]
    if captured:
        return captured[-1].provider
    return payments[-1].provider if payments else ""


def customer_status(order: Order) -> str:
    """One customer-facing state: awaiting_payment | payment_failed | processing | delivered |
    partially_refunded | refunded | cancelled | expired."""
    if order.payment_status == PaymentStatus.REFUNDED:
        return "refunded"
    if order.fulfillment_status == FulfillmentStatus.CANCELLED or order.payment_status == PaymentStatus.CANCELLED:
        expired = AuditLog.objects.filter(
            action="orders.cancelled", entity_type="Order", entity_id=str(order.id), meta__by="system"
        ).exists()
        return "expired" if expired else "cancelled"
    if order.payment_status == PaymentStatus.PARTIALLY_REFUNDED:
        return "partially_refunded"
    if order.payment_status == PaymentStatus.PAID:
        return "delivered" if order.fulfillment_status == FulfillmentStatus.COMPLETED else "processing"
    if order.payment_status == PaymentStatus.FAILED:
        return "payment_failed"
    return "awaiting_payment"


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    total_jod = serializers.FloatField(read_only=True)
    payment_provider = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()
    awaiting_payment = serializers.SerializerMethodField()
    can_pay = serializers.SerializerMethodField()
    can_cancel = serializers.SerializerMethodField()
    refunded_fils = serializers.SerializerMethodField()
    coupon_code = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = (
            "id",
            "order_number",
            "email",
            "full_name",
            "phone",
            "notes",
            "locale",
            "coupon_code",
            "subtotal_fils",
            "discount_fils",
            "total_fils",
            "total_jod",
            "refunded_fils",
            "currency",
            "payment_status",
            "payment_provider",
            "fulfillment_status",
            "status",
            "awaiting_payment",
            "can_pay",
            "can_cancel",
            "created_at",
            "items",
        )

    def get_payment_provider(self, obj: Order) -> str:
        return captured_provider(obj)

    def get_status(self, obj: Order) -> str:
        return customer_status(obj)

    def get_awaiting_payment(self, obj: Order) -> bool:
        return customer_status(obj) == "awaiting_payment"

    def get_can_pay(self, obj: Order) -> bool:
        return (
            obj.payment_status == PaymentStatus.PENDING
            and obj.fulfillment_status in {FulfillmentStatus.NOT_STARTED, FulfillmentStatus.QUEUED}
            and obj.total_fils > 0
        )

    def get_can_cancel(self, obj: Order) -> bool:
        return obj.payment_status in {PaymentStatus.PENDING, PaymentStatus.FAILED} and can_cancel(obj)

    def get_refunded_fils(self, obj: Order) -> int:
        return sum(r.amount_fils for r in obj.refund_records.all() if r.status == RefundStatus.COMPLETED)

    def get_coupon_code(self, obj: Order):
        return obj.coupon.code if obj.coupon_id and obj.coupon else None


def _customer_order_qs():
    return Order.objects.select_related("coupon").prefetch_related(
        "items", "items__product", "items__codes", "items__order", "payments", "refund_records"
    )


def _token_matches(order: Order, provided: str | None) -> bool:
    provided = (provided or "").strip()
    stored = order.access_token or ""
    if not provided or not stored or len(provided) != len(stored):
        return False
    return secrets.compare_digest(provided.encode(), stored.encode())


def _is_owner(order: Order, user) -> bool:
    return bool(
        order.user_id
        and user is not None
        and getattr(user, "is_authenticated", False)
        and order.user_id == user.id
    )


def _not_found() -> Response:
    return Response({"detail": "Not found.", "code": "not_found"}, status=status.HTTP_404_NOT_FOUND)


class CouponValidateView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = COMMERCE_THROTTLE_CLASSES
    throttle_scope = "coupon"

    def post(self, request):
        serializer = CouponValidateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            payload = validate_coupon(
                data["code"],
                data.get("subtotal_jod") or 0,
                subtotal_fils=data.get("subtotal_fils"),
                email=(data.get("email") or "").strip().lower() or None,
            )
            return Response(payload)
        except CheckoutError as exc:
            return Response({"valid": False, "detail": exc.message, "code": exc.code}, status=exc.status)


def _new_order_payload(order: Order) -> dict:
    order = _customer_order_qs().get(pk=order.pk)
    data = OrderSerializer(order).data
    data["access_token"] = order.access_token
    payments = list(order.payments.all())
    payment = max(payments, key=lambda item: item.id) if payments else None
    if (
        payment
        and payment.provider == "paypal"
        and payment.checkout_token
        and order.payment_status not in PAID_LIKE
    ):
        data["checkout_token"] = payment.checkout_token
        data["paypal_amount"] = payment.provider_amount
        data["paypal_currency"] = payment.currency
    data["free_order"] = order.total_fils == 0 and order.payment_status == PaymentStatus.PAID
    return data


class CreateOrderView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = COMMERCE_THROTTLE_CLASSES
    throttle_scope = "checkout"

    def post(self, request):
        serializer = CheckoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            order = create_storefront_order(data=serializer.validated_data, user=request.user)
        except CheckoutError as exc:
            return _error(exc, default_code="checkout_error")
        return Response(_new_order_payload(order), status=status.HTTP_201_CREATED)


class MyOrdersView(generics.ListAPIView):
    """GET orders/mine/?paid_only=1 hides unpaid/cancelled orders (Codes page);
    ?awaiting_payment=1 lists only orders still waiting for payment."""

    permission_classes = [IsAuthenticated, IsCustomer]
    serializer_class = OrderSerializer

    def get_queryset(self):
        qs = _customer_order_qs().filter(user=self.request.user)
        params = self.request.query_params
        if params.get("paid_only") in {"1", "true", "yes"}:
            qs = qs.filter(payment_status__in=list(PAID_LIKE))
        if params.get("awaiting_payment") in {"1", "true", "yes"}:
            qs = qs.filter(
                payment_status=PaymentStatus.PENDING,
                fulfillment_status__in=[FulfillmentStatus.NOT_STARTED, FulfillmentStatus.QUEUED],
            )
        return qs


def _customer_can_access(request, order: Order, *, token: str | None = None, allow_email: bool = True) -> bool:
    if _is_owner(order, request.user):
        return True
    # The e-mailed access token works for every order (also account orders opened
    # while signed out); the e-mail-only lookup stays limited to guest orders.
    if _token_matches(order, token):
        return True
    if order.user_id:
        return False
    if not allow_email:
        return False
    email = (request.query_params.get("email") or "").strip().lower()
    return bool(email) and email == (order.email or "").lower()


class OrderDetailView(APIView):
    """Order lookup.

    * Any order: ``?access_token=`` (alias ``?token=``) from the order e-mail.
    * Order of a registered customer: also that customer (JWT).
    * Guest order: also ``?email=`` matching the order e-mail.
    Everything else is a 404 so order numbers cannot be probed.
    """

    permission_classes = [AllowAny]
    throttle_classes = COMMERCE_THROTTLE_CLASSES
    throttle_scope = "order_lookup"

    def get(self, request, order_number: str):
        order = _customer_order_qs().filter(order_number=order_number).first()
        params = request.query_params
        token = params.get("access_token") or params.get("token")
        if order is None or not _customer_can_access(request, order, token=token):
            return _not_found()
        return Response(OrderSerializer(order).data)


class CustomerOrderCancelSerializer(serializers.Serializer):
    access_token = serializers.CharField(required=False, allow_blank=True, max_length=128)


class CustomerOrderCancelView(APIView):
    """POST orders/<order_number>/cancel/ {access_token?} -> cancel an unpaid order (D1/D7)."""

    permission_classes = [AllowAny]
    throttle_classes = COMMERCE_THROTTLE_CLASSES
    throttle_scope = "order_lookup"

    def post(self, request, order_number: str):
        serializer = CustomerOrderCancelSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        order = Order.objects.filter(order_number=order_number).first()
        token = serializer.validated_data.get("access_token") or request.query_params.get("access_token")
        if order is None or not _customer_can_access(request, order, token=token, allow_email=False):
            return _not_found()
        if order.payment_status in PAID_UNREFUNDED or order.payment_status == PaymentStatus.REFUNDED:
            return Response(
                {"detail": "Paid orders cannot be cancelled here. Please contact support.", "code": "already_paid"},
                status=status.HTTP_409_CONFLICT,
            )
        try:
            cancel_order(
                order,
                actor=request.user if getattr(request.user, "is_authenticated", False) else None,
                reason="Cancelled by the customer",
                source="customer",
            )
        except OrderTransitionError as exc:
            return _error(exc)
        return Response(OrderSerializer(_customer_order_qs().get(pk=order.pk)).data)


class OrderCodesRevealSerializer(serializers.Serializer):
    access_token = serializers.CharField(required=False, allow_blank=True, max_length=128)


class OrderCodesView(APIView):
    """POST orders/<order_number>/codes/ -> plaintext codes for the owner or the access-token holder."""

    permission_classes = [AllowAny]
    throttle_classes = COMMERCE_THROTTLE_CLASSES
    throttle_scope = "code_reveal"

    def post(self, request, order_number: str):
        serializer = OrderCodesRevealSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        order = _customer_order_qs().filter(order_number=order_number).first()
        via = ""
        if order is not None:
            if _is_owner(order, request.user):
                via = "owner"
            elif _token_matches(order, serializer.validated_data.get("access_token")):
                via = "access_token"
        if not via:
            return _not_found()
        if order.payment_status not in PAID_UNREFUNDED:
            return Response(
                {"detail": "Codes are available once the order is paid.", "code": "not_paid"},
                status=status.HTTP_409_CONFLICT,
            )
        items = []
        code_ids: list[int] = []
        first_reveal: list[int] = []
        for item in order.items.all():
            if item.product.fulfillment_type != FulfillmentType.CODE:
                continue
            revealed = []
            delivered = sorted(
                (c for c in item.codes.all() if c.status == DigitalCodeStatus.DELIVERED), key=lambda c: c.id
            )
            for code in delivered:
                plain, pin = reveal_code(code)
                revealed.append({"id": code.id, "code": plain, "pin": pin})
                code_ids.append(code.id)
                if code.customer_revealed_at is None:
                    first_reveal.append(code.id)
            items.append(
                {
                    "item_id": item.id,
                    "product_name": item.product_name,
                    "product_name_ar": item.product_name_ar,
                    "variant_name": item.variant_name,
                    "variant_name_ar": item.variant_name_ar,
                    "quantity": item.quantity,
                    "codes_pending": max(item.quantity - len(delivered), 0),
                    "codes": revealed,
                }
            )
        if first_reveal:
            DigitalCode.objects.filter(id__in=first_reveal, customer_revealed_at__isnull=True).update(
                customer_revealed_at=timezone.now()
            )
        user = request.user if getattr(request.user, "is_authenticated", False) else None
        AuditLog.objects.create(
            actor=user,
            action="codes.customer_reveal",
            entity_type="Order",
            entity_id=str(order.id),
            meta={
                "order_number": order.order_number,
                "email": order.email,
                "via": via,
                "code_ids": code_ids,
                "first_reveal_code_ids": first_reveal,
                "ip": (request.META.get("REMOTE_ADDR") or "")[:64],
            },
        )
        return Response({"order_number": order.order_number, "items": items})


# --- Admin serializers ---


class AdminMaskedCodeSerializer(serializers.ModelSerializer):
    order_number = serializers.CharField(source="order_item.order.order_number", read_only=True, allow_null=True)
    variant_sku = serializers.CharField(source="variant.sku", read_only=True, allow_null=True)
    variant_name = serializers.CharField(source="variant.name_en", read_only=True, allow_null=True)
    product_id = serializers.CharField(source="variant.product_id", read_only=True, allow_null=True)
    product_name = serializers.CharField(source="variant.product.name_en", read_only=True, allow_null=True)
    revealed_by_email = serializers.CharField(source="revealed_by.email", read_only=True, allow_null=True)
    revealed_by_customer = serializers.SerializerMethodField()
    status_label = serializers.SerializerMethodField()

    class Meta:
        model = DigitalCode
        fields = (
            "id",
            "masked",
            "status",
            "status_label",
            "source",
            "variant",
            "variant_sku",
            "variant_name",
            "product_id",
            "product_name",
            "order_item",
            "order_number",
            "created_at",
            "delivered_at",
            "revealed_at",
            "revealed_by_email",
            "customer_revealed_at",
            "revealed_by_customer",
        )

    def get_revealed_by_customer(self, obj: DigitalCode) -> bool:
        return obj.customer_revealed_at is not None

    def get_status_label(self, obj: DigitalCode) -> str:
        return code_status_label(obj)


def code_status_label(code: DigitalCode) -> str:
    if code.status == DigitalCodeStatus.UNAVAILABLE:
        order = code.order_item.order if code.order_item_id and code.order_item else None
        if order is not None and order.payment_status == PaymentStatus.REFUNDED:
            return "Retired (refunded)"
        return "Deactivated"
    return {
        DigitalCodeStatus.AVAILABLE: "In stock",
        DigitalCodeStatus.RESERVED: "Reserved",
        DigitalCodeStatus.DELIVERED: "Delivered",
    }.get(code.status, code.status)


class AdminPaymentSerializer(serializers.ModelSerializer):
    order_number = serializers.CharField(source="order.order_number", read_only=True)
    provider_currency = serializers.CharField(source="currency", read_only=True)
    capture_id = serializers.CharField(source="provider_capture_id", read_only=True, allow_null=True)
    amount_display = serializers.SerializerMethodField()
    refunded_fils = serializers.SerializerMethodField()
    refunded_display = serializers.SerializerMethodField()
    voided = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = (
            "id",
            "order",
            "order_number",
            "provider",
            "status",
            "amount_fils",
            "amount_display",
            "currency",
            "provider_amount",
            "provider_currency",
            "provider_order_id",
            "provider_capture_id",
            "capture_id",
            "external_ref",
            "refunded_fils",
            "refunded_display",
            "voided",
            "paid_at",
            "created_at",
            "updated_at",
        )

    def get_amount_display(self, obj: Payment) -> str:
        return format_jod(obj.amount_fils)

    def get_refunded_fils(self, obj: Payment) -> int:
        value = getattr(obj, "_refunded_fils", None)
        if value is None:
            value = sum(r.amount_fils for r in obj.refund_records.all() if r.status == RefundStatus.COMPLETED)
        return int(value or 0)

    def get_refunded_display(self, obj: Payment) -> str:
        return format_jod(self.get_refunded_fils(obj))

    def get_voided(self, obj: Payment) -> bool:
        return bool((obj.raw or {}).get("voided"))


class AdminOrderItemSerializer(OrderItemSerializer):
    available_codes_for_variant = serializers.SerializerMethodField()
    sellable_codes_for_variant = serializers.SerializerMethodField()
    delivery_note_customer_visible = serializers.SerializerMethodField()
    show_delivery_method = serializers.SerializerMethodField()
    delivery_state_label = serializers.SerializerMethodField()
    supplier_order = serializers.SerializerMethodField()

    class Meta(OrderItemSerializer.Meta):
        fields = OrderItemSerializer.Meta.fields + (
            "delivery_note_customer_visible",
            "show_delivery_method",
            "delivery_state_label",
            "available_codes_for_variant",
            "sellable_codes_for_variant",
            "supplier_order",
        )

    def get_supplier_order(self, obj: OrderItem):
        """1Epin status + staff actions for this item (None when the item is not supplier-related)."""
        from suppliers.services.payloads import item_supplier_payload

        try:
            return item_supplier_payload(obj, order=obj.order)
        except Exception:  # noqa: BLE001 - the order page must render even if supplier data is broken
            logger.exception("Could not build supplier payload for order item %s", obj.pk)
            return None

    def get_codes(self, obj: OrderItem):
        codes = sorted(obj.codes.all(), key=lambda c: c.id)
        return [
            {
                "id": code.id,
                "masked": code.masked,
                "status": code.status,
                "status_label": code_status_label(code),
                "source": code.source,
                "delivered_at": code.delivered_at,
                "revealed_at": code.revealed_at,
                "customer_revealed_at": code.customer_revealed_at,
                "revealed_by_customer": code.customer_revealed_at is not None,
            }
            for code in codes
        ]

    def get_delivery_note_customer_visible(self, obj: OrderItem) -> bool:
        return True  # D9: the staff delivery note is shown to the customer (page + e-mail)

    def get_show_delivery_method(self, obj: OrderItem) -> bool:
        return obj.product.fulfillment_type == FulfillmentType.CODE  # OR-21: hidden for top-ups

    def get_delivery_state_label(self, obj: OrderItem) -> str:
        return {
            "delivered": "Delivered",
            "partial": "Partly delivered",
            "pending": "Not delivered",
            "retired_refunded": "Retired (refunded)",
        }[_item_delivery_state(obj)]

    def get_available_codes_for_variant(self, obj: OrderItem):
        if obj.product.fulfillment_type != FulfillmentType.CODE:
            return None
        counts = self.context.get("available_counts")
        if counts is None:
            counts = raw_available_code_counts([obj.variant_id])
        return counts.get(obj.variant_id, 0)

    def get_sellable_codes_for_variant(self, obj: OrderItem):
        if obj.product.fulfillment_type != FulfillmentType.CODE:
            return None
        counts = self.context.get("sellable_counts")
        if counts is None:
            counts = available_code_counts([obj.variant_id])
        return counts.get(obj.variant_id, 0)


class AdminOrderSerializer(serializers.ModelSerializer):
    items = AdminOrderItemSerializer(many=True, read_only=True)
    payments = AdminPaymentSerializer(many=True, read_only=True)
    total_jod = serializers.FloatField(read_only=True)
    coupon_code = serializers.CharField(source="coupon.code", read_only=True, allow_null=True)
    payment_provider = serializers.SerializerMethodField()
    refunds = serializers.SerializerMethodField()
    refund_summary = serializers.SerializerMethodField()
    refunded_fils = serializers.SerializerMethodField()
    refund_remaining_fils = serializers.SerializerMethodField()
    can_cancel = serializers.SerializerMethodField()
    allowed_payment_transitions = serializers.SerializerMethodField()
    allowed_fulfillment_transitions = serializers.SerializerMethodField()
    actions = serializers.SerializerMethodField()
    display = serializers.SerializerMethodField()
    customer_status = serializers.SerializerMethodField()

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
            "staff_notes",
            "locale",
            "coupon",
            "coupon_code",
            "subtotal_fils",
            "discount_fils",
            "total_fils",
            "total_jod",
            "refunded_fils",
            "refund_remaining_fils",
            "currency",
            "payment_status",
            "payment_provider",
            "fulfillment_status",
            "customer_status",
            "region_confirmed",
            "refund_confirmed",
            "reserved_until",
            "created_at",
            "updated_at",
            "items",
            "payments",
            "refunds",
            "refund_summary",
            "can_cancel",
            "allowed_payment_transitions",
            "allowed_fulfillment_transitions",
            "actions",
            "display",
        )

    def _summary(self, obj: Order) -> dict:
        cache = self.context.setdefault("_refund_summary", {})
        if obj.pk not in cache:
            cache[obj.pk] = refund_summary(obj)
        return cache[obj.pk]

    def get_payment_provider(self, obj: Order) -> str:
        return captured_provider(obj)

    def get_refunds(self, obj: Order):
        return refund_rows(obj)

    def get_refund_summary(self, obj: Order) -> dict:
        summary = dict(self._summary(obj))
        summary["can_refund"] = obj.payment_status in PAID_UNREFUNDED and summary["remaining_fils"] > 0
        return summary

    def get_refunded_fils(self, obj: Order) -> int:
        return self._summary(obj)["refunded_fils"]

    def get_refund_remaining_fils(self, obj: Order) -> int:
        return self._summary(obj)["remaining_fils"] if obj.payment_status in PAID_UNREFUNDED else 0

    def get_can_cancel(self, obj: Order) -> bool:
        return can_cancel(obj)

    def get_allowed_payment_transitions(self, obj: Order) -> list[str]:
        return allowed_payment_transitions(obj)

    def get_allowed_fulfillment_transitions(self, obj: Order) -> list[str]:
        return allowed_fulfillment_transitions(obj)

    def get_actions(self, obj: Order) -> dict:
        actions = order_actions(obj)
        summary = self._summary(obj)
        if obj.payment_status == PaymentStatus.REFUNDED or (
            obj.payment_status in PAID_UNREFUNDED and summary["remaining_fils"] <= 0
        ):
            refund_reason = "Nothing left to refund"
        elif obj.payment_status not in PAID_UNREFUNDED:
            refund_reason = "Only paid orders can be refunded."
        else:
            refund_reason = ""
        actions["refund"] = {
            "label": "Refund",
            "enabled": not refund_reason,
            "disabled_reason": refund_reason,
            "remaining_fils": summary["remaining_fils"],
            "remaining_display": summary["remaining_display"],
            "via": "paypal" if summary["provider"] == "paypal" else "manual",
        }
        return actions

    def get_display(self, obj: Order) -> dict:
        summary = self._summary(obj)
        return {
            "subtotal": format_jod(obj.subtotal_fils),
            "discount": format_jod(-obj.discount_fils) if obj.discount_fils else format_jod(0),
            "total": format_jod(obj.total_fils),
            "refunded": summary["refunded_display"],
            "refund_remaining": summary["remaining_display"],
        }

    def get_customer_status(self, obj: Order) -> str:
        return customer_status(obj)


def admin_order_payload(order: Order) -> dict:
    order = (
        Order.objects.select_related("coupon", "user")
        .prefetch_related(
            "items",
            "items__product",
            "items__codes",
            "items__codes__order_item__order",
            "items__order",
            "payments",
            "payments__refund_records",
        )
        .get(pk=order.pk)
    )
    code_variants = [i.variant_id for i in order.items.all() if i.product.fulfillment_type == FulfillmentType.CODE]
    context = {
        "available_counts": raw_available_code_counts(code_variants),
        "sellable_counts": available_code_counts(code_variants),
    }
    return AdminOrderSerializer(order, context=context).data


def _needs_action_q() -> Q:
    return Q(payment_status__in=list(PAID_UNREFUNDED)) & ~Q(
        fulfillment_status__in=[FulfillmentStatus.COMPLETED, FulfillmentStatus.CANCELLED]
    )


class AdminOrderListSerializer(serializers.ModelSerializer):
    total_jod = serializers.FloatField(read_only=True)
    total_display = serializers.SerializerMethodField()
    item_count = serializers.SerializerMethodField()
    payment_provider = serializers.SerializerMethodField()
    needs_action = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = (
            "id",
            "order_number",
            "email",
            "full_name",
            "total_fils",
            "total_jod",
            "total_display",
            "currency",
            "payment_status",
            "payment_provider",
            "fulfillment_status",
            "needs_action",
            "locale",
            "created_at",
            "item_count",
        )

    def get_item_count(self, obj):
        return len(obj.items.all())

    def get_total_display(self, obj) -> str:
        return format_jod(obj.total_fils)

    def get_payment_provider(self, obj) -> str:
        return captured_provider(obj)

    def get_needs_action(self, obj) -> bool:
        return obj.payment_status in PAID_UNREFUNDED and obj.fulfillment_status not in {
            FulfillmentStatus.COMPLETED,
            FulfillmentStatus.CANCELLED,
        }


class OrderTransitionSerializer(serializers.Serializer):
    payment_status = serializers.ChoiceField(choices=PaymentStatus.choices, required=False)
    fulfillment_status = serializers.ChoiceField(choices=FulfillmentStatus.choices, required=False)
    refund_amount_fils = serializers.IntegerField(required=False, min_value=1)
    manual_refund = serializers.BooleanField(required=False, default=False)
    reason = serializers.CharField(required=False, allow_blank=True, max_length=500)

    def validate(self, attrs):
        if "payment_status" not in attrs and "fulfillment_status" not in attrs:
            raise serializers.ValidationError("Provide payment_status and/or fulfillment_status")
        return attrs


def coupon_status(coupon: Coupon, now=None) -> str:
    """scheduled | active | expired | inactive | used_up (OR-24)."""
    now = now or timezone.now()
    if not coupon.active:
        return "inactive"
    if coupon.ends_at and now > coupon.ends_at:
        return "expired"
    if coupon.starts_at and now < coupon.starts_at:
        return "scheduled"
    if coupon.max_uses is not None and coupon.used_count >= coupon.max_uses:
        return "used_up"
    return "active"


def coupon_free_order_warning(coupon: Coupon) -> str:
    """D6: warn when the coupon can make orders free."""
    if coupon.percent_off is not None and coupon.percent_off >= 100:
        return "This coupon makes every order free (100% off). Free orders are delivered without payment."
    if coupon.amount_off_fils:
        prices = ProductVariant.objects.filter(published=True, product__status=PublishStatus.PUBLISHED)
        covered = prices.filter(price_fils__lte=coupon.amount_off_fils).count()
        if covered:
            return (
                f"This coupon covers the full price of {covered} product option(s) (up to "
                f"{format_jod(coupon.amount_off_fils)}). Orders it fully covers are free and delivered without payment."
            )
    return ""


class CouponSerializer(serializers.ModelSerializer):
    status = serializers.SerializerMethodField()
    free_order_risk = serializers.SerializerMethodField()
    free_order_warning = serializers.SerializerMethodField()

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
            "max_uses_per_customer",
            "used_count",
            "created_at",
            "status",
            "free_order_risk",
            "free_order_warning",
        )
        read_only_fields = ("used_count", "created_at")

    def get_status(self, obj: Coupon) -> str:
        return coupon_status(obj)

    def get_free_order_warning(self, obj: Coupon) -> str:
        return coupon_free_order_warning(obj)

    def get_free_order_risk(self, obj: Coupon) -> bool:
        return bool(coupon_free_order_warning(obj))

    def _current(self, attrs, name):
        if name in attrs:
            return attrs[name]
        return getattr(self.instance, name, None) if self.instance is not None else None

    def validate_code(self, value: str) -> str:
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("Code is required")
        qs = Coupon.objects.filter(code__iexact=value)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("A coupon with this code already exists")
        return value

    def validate(self, attrs):
        percent = self._current(attrs, "percent_off")
        amount = self._current(attrs, "amount_off_fils")
        if (percent is None) == (amount is None):
            raise serializers.ValidationError(
                {"percent_off": "Set exactly one of percent_off or amount_off_fils."}
            )
        if percent is not None and not (0 < percent <= 100):
            raise serializers.ValidationError({"percent_off": "Must be greater than 0 and at most 100."})
        if amount is not None and amount <= 0:
            raise serializers.ValidationError({"amount_off_fils": "Must be greater than 0."})
        for name in ("max_uses", "max_uses_per_customer"):
            value = self._current(attrs, name)
            if value is not None and value < 1:
                raise serializers.ValidationError({name: "Must be at least 1 (or empty for unlimited)."})
        starts, ends = self._current(attrs, "starts_at"), self._current(attrs, "ends_at")
        if starts and ends and ends <= starts:
            raise serializers.ValidationError({"ends_at": "Must be after starts_at."})
        return attrs


def _truthy(value) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


class OrderFilter(filters.FilterSet):
    payment_status = filters.CharFilter()
    fulfillment_status = filters.CharFilter()
    search = filters.CharFilter(method="filter_search")
    needs_action = filters.CharFilter(method="filter_needs_action")
    awaiting_payment_24h = filters.CharFilter(method="filter_awaiting_payment_24h")
    created_from = filters.IsoDateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_to = filters.IsoDateTimeFilter(field_name="created_at", lookup_expr="lte")

    class Meta:
        model = Order
        fields = ["payment_status", "fulfillment_status"]

    def filter_search(self, queryset, name, value):
        value = (value or "").strip()
        if not value:
            return queryset
        return queryset.filter(
            Q(order_number__icontains=value)
            | Q(email__icontains=value)
            | Q(full_name__icontains=value)
            | Q(phone__icontains=value)
        )

    def filter_needs_action(self, queryset, name, value):
        """Paid / partially refunded orders that are not completed or cancelled (OR-12)."""
        return queryset.filter(_needs_action_q()) if _truthy(value) else queryset

    def filter_awaiting_payment_24h(self, queryset, name, value):
        """Unpaid (PENDING) orders created in the last 24 hours."""
        if not _truthy(value):
            return queryset
        return queryset.filter(
            payment_status=PaymentStatus.PENDING, created_at__gte=timezone.now() - timedelta(hours=24)
        )


class DigitalCodeFilter(filters.FilterSet):
    status = filters.CharFilter()
    variant = filters.NumberFilter(field_name="variant_id")

    class Meta:
        model = DigitalCode
        fields = ["status", "variant"]


class CodeSearchFilter(SearchFilter):
    """D22: a full code finds its row via the code-only fingerprint; otherwise masked tail/SKU/order."""

    def filter_queryset(self, request, queryset, view):
        term = (request.query_params.get(self.search_param) or "").strip()
        if len(term) >= 6:
            identity = code_identity(term)
            if identity:
                matched = queryset.filter(code_identity=identity)
                if matched.exists():
                    return matched
        return super().filter_queryset(request, queryset, view)


# --- Admin views ---


def _low_stock_variant_count(threshold: int) -> int:
    """Published CODE variants whose AVAILABLE codes are at or below the threshold (D24)."""
    return (
        ProductVariant.objects.filter(
            product__fulfillment_type=FulfillmentType.CODE,
            published=True,
            product__status=PublishStatus.PUBLISHED,
        )
        .annotate(
            codes_available=Count(
                "digital_codes",
                filter=Q(digital_codes__status=DigitalCodeStatus.AVAILABLE, digital_codes__order_item__isnull=True),
            )
        )
        .filter(codes_available__lte=threshold)
        .count()
    )


STORE_TZ_NAME = "Asia/Amman"


def store_today_start():
    tz = ZoneInfo(getattr(settings, "STORE_TIME_ZONE", STORE_TZ_NAME) or STORE_TZ_NAME)
    local_now = timezone.now().astimezone(tz)
    return datetime.combine(local_now.date(), time.min, tzinfo=tz)


def net_revenue_fils(orders) -> dict[str, int]:
    """Net revenue over paid + partially refunded orders: totals minus completed refunds (OR-12)."""
    paid = orders.filter(payment_status__in=list(PAID_UNREFUNDED))
    gross = paid.aggregate(total=Coalesce(Sum("total_fils"), 0))["total"] or 0
    refunds = (
        Refund.objects.filter(order__in=paid, status=RefundStatus.COMPLETED).aggregate(
            total=Coalesce(Sum("amount_fils"), 0)
        )["total"]
        or 0
    )
    return {"gross": int(gross), "refunds": int(refunds), "net": int(gross) - int(refunds)}


def audit_entry_payload(entry: AuditLog) -> dict:
    from audit.services import actor_label, entity_label

    return {
        "id": entry.id,
        "action": entry.action,
        "entity_type": entry.entity_type,
        "entity_id": entry.entity_id,
        "entity_label": entity_label(entry),
        "order_number": (entry.meta or {}).get("order_number") or None,
        "actor_id": entry.actor_id,
        "actor_email": entry.actor.email if entry.actor_id else None,
        "actor_name": actor_label(entry),
        "meta": entry.meta,
        "created_at": entry.created_at,
    }


def _oneepin_dashboard() -> dict | None:
    """1Epin balance warning for the dashboard (D-1E-8). Cached values only, no network."""
    try:
        from suppliers.models import SupplierAlert, SupplierOrder, SupplierStatus
        from suppliers.provider import to_decimal
        from suppliers.services.alerts import is_low
        from suppliers.services.config import supplier_mode

        supplier = Supplier.objects.select_related("connection").filter(slug="1epin").first()
        connection = getattr(supplier, "connection", None) if supplier else None
        balance = connection.last_balance if connection else ""
        return {
            "mode": supplier_mode(),
            "balance": balance or None,
            "currency": ((connection.meta or {}).get("balance_currency") if connection else "") or None,
            "balance_checked_at": connection.last_checked_at if connection else None,
            "low_balance": is_low(to_decimal(balance)),
            "open_alerts": SupplierAlert.objects.filter(resolved=False).count(),
            "manual_review_orders": SupplierOrder.objects.filter(status=SupplierStatus.MANUAL_REVIEW).count(),
        }
    except Exception:  # noqa: BLE001 - the dashboard must render
        logger.exception("Could not build the 1Epin dashboard block")
        return None


class AdminDashboardView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "orders.read"

    def get(self, request):
        from catalog.views import effective_out_of_stock_count
        from cms.models import SiteSettings

        threshold = SiteSettings.load().low_stock_threshold
        now = timezone.now()
        revenue = net_revenue_fils(Order.objects.all())
        today_start = store_today_start()
        today_orders = Order.objects.filter(created_at__gte=today_start)
        today_revenue = net_revenue_fils(today_orders)
        status_breakdown = list(
            Order.objects.values("payment_status", "fulfillment_status").annotate(count=Count("id")).order_by()
        )
        top_products = list(
            OrderItem.objects.filter(order__payment_status__in=list(PAID_UNREFUNDED))
            .values("product_id", "product_name")
            .annotate(quantity=Sum("quantity"), revenue_fils=Sum("line_total_fils"), orders=Count("order", distinct=True))
            .order_by("-quantity")[:10]
        )
        recent_orders = AdminOrderListSerializer(
            Order.objects.prefetch_related("items", "payments")[:10], many=True
        ).data
        payload = {
            "revenue_fils": revenue["net"],
            "revenue_display": format_jod(revenue["net"]),
            "gross_revenue_fils": revenue["gross"],
            "refunds_fils": revenue["refunds"],
            "today": {
                "orders": today_orders.count(),
                "paid_orders": today_orders.filter(payment_status__in=list(PAID_UNREFUNDED)).count(),
                "revenue_fils": today_revenue["net"],
                "revenue_display": format_jod(today_revenue["net"]),
                "since": today_start.isoformat(),
            },
            "orders_count": Order.objects.count(),
            "customers_count": CustomerProfile.objects.count(),
            "products_count": Product.objects.count(),
            "active_products": Product.objects.filter(status=PublishStatus.PUBLISHED).count(),
            "codes_available": DigitalCode.objects.filter(
                status=DigitalCodeStatus.AVAILABLE, order_item__isnull=True
            ).count(),
            "low_stock_variants": _low_stock_variant_count(threshold),
            "low_stock_threshold": threshold,
            # Same rule as the Inventory page: published CODE variants of non-archived
            # products whose effective (sellable) stock is out.
            "out_of_stock_variants": effective_out_of_stock_count(),
            "pending_orders": Order.objects.filter(payment_status=PaymentStatus.PENDING).count(),
            "pending_payment_24h": Order.objects.filter(
                payment_status=PaymentStatus.PENDING, created_at__gte=now - timedelta(hours=24)
            ).count(),
            "awaiting_delivery": Order.objects.filter(_needs_action_q()).count(),
            "manual_review": Order.objects.filter(fulfillment_status=FulfillmentStatus.MANUAL_REVIEW).count(),
            "failed_fulfillment": Order.objects.filter(fulfillment_status=FulfillmentStatus.FAILED).count(),
            "active_suppliers": Supplier.objects.filter(active=True).count(),
            "oneepin": _oneepin_dashboard(),
            "order_status_breakdown": status_breakdown,
            "top_products": top_products,
            "recent_orders": recent_orders,
            # Query strings for the orders list that match each card exactly.
            "links": {
                "awaiting_delivery": "needs_action=1",
                "pending_payment_24h": "awaiting_payment_24h=1",
                "pending_orders": "payment_status=PENDING",
                "manual_review": "fulfillment_status=MANUAL_REVIEW",
                "failed_fulfillment": "fulfillment_status=FAILED",
                "today": urlencode({"created_from": today_start.isoformat()}),
            },
        }
        # RO-10: the activity feed is audit data.
        if has_permission(request.user, "audit.read"):
            payload["recent_audit"] = [
                audit_entry_payload(entry) for entry in AuditLog.objects.select_related("actor")[:10]
            ]
        else:
            payload["recent_audit"] = None
        return Response(payload)


def get_admin_order(pk) -> Order:
    """Resolve an admin order by numeric id or order number."""
    value = str(pk)
    order = None
    if value.isdigit() and len(value) <= 9:
        order = Order.objects.filter(pk=int(value)).first()
    if order is None:
        order = Order.objects.filter(order_number=value).first()
    if order is None:
        raise NotFound()
    return order


class AdminOrderViewSet(viewsets.ReadOnlyModelViewSet):
    """GET admin/orders/?search=&payment_status=&fulfillment_status=&needs_action=1&awaiting_payment_24h=1
    &created_from=&created_to=&ordering=(-)created_at|total_fils|payment_status|fulfillment_status|order_number
    """

    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "orders.read"
    filterset_class = OrderFilter
    filter_backends = [filters.DjangoFilterBackend, OrderingFilter]
    ordering_fields = ["created_at", "total_fils", "order_number", "payment_status", "fulfillment_status"]
    ordering = ["-created_at"]
    queryset = Order.objects.prefetch_related("items", "items__codes", "payments").select_related("coupon", "user")
    lookup_value_regex = r"[^/]+"

    def get_serializer_class(self):
        if self.action == "list":
            return AdminOrderListSerializer
        return AdminOrderSerializer

    def get_object(self):
        lookup = self.kwargs.get(self.lookup_field or "pk")
        qs = self.get_queryset()
        if str(lookup).isdigit():
            obj = qs.filter(Q(pk=lookup) | Q(order_number=lookup)).first() if len(str(lookup)) <= 9 else None
            obj = obj or qs.filter(order_number=lookup).first()
        else:
            obj = qs.filter(order_number=lookup).first()
        if not obj:
            raise NotFound()
        self.check_object_permissions(self.request, obj)
        return obj

    def retrieve(self, request, *args, **kwargs):
        return Response(admin_order_payload(self.get_object()))


class AdminOrderTransitionView(APIView):
    """POST admin/orders/<id>/transition/ {payment_status?, fulfillment_status?, reason?, refund_amount_fils?,
    manual_refund?}. Cancel -> D7 single cancel; refunds -> D5 ledger; COMPLETED -> D8 gating."""

    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "orders.write"

    def post(self, request, pk):
        from django.db import transaction

        order = get_admin_order(pk)
        serializer = OrderTransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        payment_status = data.get("payment_status")
        fulfillment_status = data.get("fulfillment_status")
        reason = (data.get("reason") or "").strip()

        cancelling = payment_status == PaymentStatus.CANCELLED or fulfillment_status == FulfillmentStatus.CANCELLED
        if cancelling:
            if order.payment_status in PAID_UNREFUNDED:
                return Response({"detail": REFUND_FIRST, "code": "refund_first"}, status=status.HTTP_409_CONFLICT)
            try:
                cancel_order(order, actor=request.user, reason=reason, source="staff")
            except OrderTransitionError as exc:
                return _error(exc)
            return Response(admin_order_payload(order))

        if payment_status == PaymentStatus.PAID:
            if order.payment_status != PaymentStatus.PAID:
                if not reason:
                    return Response(
                        {
                            "detail": "A reason is required to mark an order paid manually.",
                            "code": "reason_required",
                            "field": "reason",
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                try:
                    mark_order_paid_manually(order, actor=request.user, reason=reason)
                except PaymentError as exc:
                    return _error(exc)
                order.refresh_from_db()
            payment_status = None

        if payment_status in {PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED}:
            if payment_status == PaymentStatus.REFUNDED and order.payment_status == PaymentStatus.REFUNDED:
                return Response(admin_order_payload(order))  # idempotent
            amount = data.get("refund_amount_fils")
            if payment_status == PaymentStatus.PARTIALLY_REFUNDED and not amount:
                return Response(
                    {
                        "detail": "Enter the amount to refund (refund_amount_fils).",
                        "code": "amount_required",
                        "field": "refund_amount_fils",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            try:
                issue_refund(
                    order,
                    amount_fils=amount if payment_status == PaymentStatus.PARTIALLY_REFUNDED else None,
                    reason=reason,
                    actor=request.user,
                    manual=bool(data.get("manual_refund")),
                )
            except PaymentError as exc:
                return _error(exc)
            order.refresh_from_db()
            payment_status = None
        try:
            with transaction.atomic():
                if fulfillment_status == FulfillmentStatus.COMPLETED and order.fulfillment_status != fulfillment_status:
                    locked = Order.objects.select_for_update().get(pk=order.pk)
                    move_fulfillment(locked, FulfillmentStatus.COMPLETED, actor=request.user, reason=reason)
                    fulfillment_status = None
                if payment_status or fulfillment_status:
                    order = transition_order(
                        Order.objects.select_for_update().get(pk=order.pk),
                        payment_status=payment_status,
                        fulfillment_status=fulfillment_status,
                        actor=request.user,
                        reason=reason,
                    )
        except OrderTransitionError as exc:
            return _error(exc)
        return Response(admin_order_payload(order))


class AdminOrderCancelSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, max_length=500)


class AdminOrderCancelView(APIView):
    """POST admin/orders/<id>/cancel/ {reason?} -> D7 single cancel action (unpaid orders)."""

    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "orders.write"

    def post(self, request, pk):
        order = get_admin_order(pk)
        serializer = AdminOrderCancelSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            cancel_order(order, actor=request.user, reason=serializer.validated_data.get("reason") or "", source="staff")
        except OrderTransitionError as exc:
            return _error(exc)
        return Response(admin_order_payload(order))


class AdminRefundSerializer(serializers.Serializer):
    amount_fils = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    reason = serializers.CharField(required=False, allow_blank=True, max_length=500)
    manual = serializers.BooleanField(required=False, default=False)


class AdminOrderRefundView(APIView):
    """GET admin/orders/<id>/refunds/ -> ledger; POST {amount_fils?, reason?, manual?} -> refund (D5)."""

    permission_classes = [IsAdminUser, HasAdminPermission]

    def get_permissions(self):
        self.admin_permission = "orders.read" if self.request.method == "GET" else "orders.write"
        return super().get_permissions()

    def get(self, request, pk):
        order = get_admin_order(pk)
        return Response({"refunds": refund_rows(order), "summary": refund_summary(order)})

    def post(self, request, pk):
        order = get_admin_order(pk)
        serializer = AdminRefundSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            issue_refund(
                order,
                amount_fils=data.get("amount_fils"),
                reason=data.get("reason") or "",
                actor=request.user,
                manual=bool(data.get("manual")),
            )
        except PaymentError as exc:
            return _error(exc)
        return Response(admin_order_payload(order), status=status.HTTP_201_CREATED)


class AdminStaffNotesSerializer(serializers.Serializer):
    staff_notes = serializers.CharField(allow_blank=True, max_length=5000, trim_whitespace=False)


class AdminOrderStaffNotesView(APIView):
    """PATCH admin/orders/<id>/staff-notes/ {staff_notes} -> internal notes (D12), audited."""

    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "orders.write"

    def patch(self, request, pk):
        order = get_admin_order(pk)
        serializer = AdminStaffNotesSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new = serializer.validated_data["staff_notes"].strip()
        old = order.staff_notes or ""
        if new != old:
            order.staff_notes = new
            order.save(update_fields=["staff_notes", "updated_at"])
            AuditLog.objects.create(
                actor=request.user,
                action="orders.staff_notes",
                entity_type="Order",
                entity_id=str(order.id),
                meta={
                    "order_number": order.order_number,
                    "email": order.email,
                    "before": old[:500],
                    "after": new[:500],
                },
            )
        return Response(admin_order_payload(order))

    post = patch


ORDER_HISTORY_LABELS = {
    "orders.transition": "Status changed",
    "orders.cancelled": "Order cancelled",
    "orders.refund": "Refund issued",
    "orders.manual_paid": "Marked as paid manually",
    "orders.payment_forced_paid": "Payment received for a closed order",
    "orders.codes_allocated": "Codes delivered from stock",
    "orders.code_attached": "Code attached by staff",
    "orders.item_delivered": "Top-up marked delivered",
    "orders.fulfill": "Delivery re-run",
    "orders.manual_review": "Moved to needs review",
    "orders.resend_email": "Delivery e-mail resent",
    "orders.staff_notes": "Staff notes edited",
    "codes.customer_reveal": "Customer viewed codes",
    "codes.refund_retired": "Codes retired after refund",
    "codes.reveal": "Staff revealed a code",
}


class AdminOrderHistoryView(APIView):
    """GET admin/orders/<id>/history/ -> timeline of audit entries for this order (OR-14)."""

    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "orders.read"

    def get(self, request, pk):
        order = get_admin_order(pk)
        code_ids = [str(i) for i in DigitalCode.objects.filter(order_item__order=order).values_list("id", flat=True)]
        entries = (
            AuditLog.objects.filter(
                Q(entity_type="Order", entity_id=str(order.id))
                | Q(entity_type="DigitalCode", entity_id__in=code_ids)
            )
            .select_related("actor")
            .order_by("created_at", "id")
        )
        rows = []
        for entry in entries:
            row = audit_entry_payload(entry)
            row["label"] = ORDER_HISTORY_LABELS.get(entry.action, entry.action)
            if not row["actor_name"]:
                row["actor_name"] = "Customer" if entry.action == "codes.customer_reveal" else "System"
            rows.append(row)
        return Response({"order_number": order.order_number, "results": rows})


class _AdminFulfillBase(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "orders.fulfill"

    @staticmethod
    def _error(exc) -> Response:
        return _error(exc, default_code="fulfillment_error")


class AdminOrderFulfillView(_AdminFulfillBase):
    """POST admin/orders/<id>/fulfill/ -> re-run inventory allocation (e.g. after importing stock)."""

    def post(self, request, pk):
        order = get_admin_order(pk)
        try:
            result = allocate_codes(order, actor=request.user)
        except InventoryError as exc:
            return self._error(exc)
        AuditLog.objects.create(
            actor=request.user,
            action="orders.fulfill",
            entity_type="Order",
            entity_id=str(order.id),
            meta={
                "order_number": order.order_number,
                "assigned": len(result.assigned_code_ids),
                "short_item_ids": result.short_items,
                "fulfillment_status": result.fulfillment_status,
            },
        )
        return Response(admin_order_payload(order))


class AdminAttachCodeSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=512, trim_whitespace=True)
    pin = serializers.CharField(max_length=64, required=False, allow_blank=True, allow_null=True)


class AdminOrderItemCodeView(_AdminFulfillBase):
    """POST admin/orders/<id>/items/<item_id>/codes/ {code, pin?} -> attach a code typed in by staff."""

    def post(self, request, pk, item_id: int):
        order = get_admin_order(pk)
        serializer = AdminAttachCodeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            attach_manual_code(
                order,
                item_id,
                code=serializer.validated_data["code"],
                pin=serializer.validated_data.get("pin") or None,
                actor=request.user,
            )
        except InventoryError as exc:
            return self._error(exc)
        return Response(admin_order_payload(order), status=status.HTTP_201_CREATED)


class AdminMarkDeliveredSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True, max_length=2000)


class AdminOrderItemDeliveredView(_AdminFulfillBase):
    """POST admin/orders/<id>/items/<item_id>/mark-delivered/ {note?} -> DIRECT_TOPUP item done.
    The note is CUSTOMER-VISIBLE (order page + e-mail)."""

    def post(self, request, pk, item_id: int):
        order = get_admin_order(pk)
        serializer = AdminMarkDeliveredSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            mark_item_delivered(order, item_id, note=serializer.validated_data.get("note") or "", actor=request.user)
        except InventoryError as exc:
            return self._error(exc)
        return Response(admin_order_payload(order))


class AdminOrderResendEmailView(APIView):
    """POST admin/orders/<id>/resend-email/ -> resend the delivery e-mail(s). orders.notify OR orders.fulfill (D13)."""

    permission_classes = [IsAdminUser]

    def post(self, request, pk):
        from commerce.notifications import (
            send_codes_delivered_email,
            send_order_paid_email,
            send_topup_delivered_email,
        )

        if not (has_permission(request.user, "orders.notify") or has_permission(request.user, "orders.fulfill")):
            return Response(
                {"detail": "You do not have permission to resend order e-mails.", "code": "permission_denied"},
                status=status.HTTP_403_FORBIDDEN,
            )
        order = get_admin_order(pk)
        if order.payment_status not in PAID_UNREFUNDED:
            return Response(
                {"detail": "Only paid orders have delivery e-mails.", "code": "not_paid"},
                status=status.HTTP_409_CONFLICT,
            )
        items = list(order.items.select_related("product"))
        has_codes = DigitalCode.objects.filter(order_item__order=order, status=DigitalCodeStatus.DELIVERED).exists()
        topups = [
            i for i in items if i.product.fulfillment_type == FulfillmentType.DIRECT_TOPUP and i.delivered_at
        ]
        attempted: list[str] = []
        sent: list[str] = []
        if has_codes:
            attempted.append("codes_delivered")
            if send_codes_delivered_email(order.id):
                sent.append("codes_delivered")
        for item in topups:
            kind = f"topup_delivered:{item.id}"
            attempted.append(kind)
            if send_topup_delivered_email(order.id, item.id):
                sent.append(kind)
        if not attempted:
            attempted.append("order_paid")
            if send_order_paid_email(order.id):
                sent.append("order_paid")
        AuditLog.objects.create(
            actor=request.user,
            action="orders.resend_email",
            entity_type="Order",
            entity_id=str(order.id),
            meta={"order_number": order.order_number, "email": order.email, "attempted": attempted, "sent": sent},
        )
        if not sent:
            return Response(
                {"detail": "The e-mail could not be sent. Check the mail settings.", "code": "email_failed", "sent": []},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response({"detail": "E-mail sent.", "sent": sent, "to": order.email})


class AdminDigitalCodeListView(generics.ListAPIView):
    """GET admin/codes/?search=<full code | masked tail | SKU | order number>&status=&variant="""

    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "codes.read"
    serializer_class = AdminMaskedCodeSerializer
    filterset_class = DigitalCodeFilter
    filter_backends = [filters.DjangoFilterBackend, CodeSearchFilter, OrderingFilter]
    search_fields = ["masked", "variant__sku", "order_item__order__order_number"]
    ordering_fields = ["created_at", "delivered_at", "status"]
    queryset = DigitalCode.objects.select_related(
        "variant", "variant__product", "order_item", "order_item__order", "revealed_by"
    )


class RevealCodeView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "codes.reveal"

    def post(self, request, code_id: int):
        code = DigitalCode.objects.select_related("order_item", "order_item__order").filter(id=code_id).first()
        if not code:
            return Response({"detail": "Not found"}, status=404)
        plaintext = decrypt_code(code.ciphertext, code.nonce)
        code.revealed_at = timezone.now()
        code.revealed_by = request.user
        code.save(update_fields=["revealed_at", "revealed_by"])
        meta = {"order_item_id": code.order_item_id, "masked": code.masked}
        if code.order_item_id:
            meta["order_number"] = code.order_item.order.order_number
        AuditLog.objects.create(
            actor=request.user,
            action="codes.reveal",
            entity_type="DigitalCode",
            entity_id=str(code.id),
            meta=meta,
        )
        return Response({"id": code.id, "code": plaintext, "masked": code.masked})


class PaymentFilter(filters.FilterSet):
    status = filters.CharFilter()
    provider = filters.CharFilter()
    date_from = filters.DateFilter(field_name="created_at", lookup_expr="date__gte")
    date_to = filters.DateFilter(field_name="created_at", lookup_expr="date__lte")
    paid_from = filters.DateFilter(field_name="paid_at", lookup_expr="date__gte")
    paid_to = filters.DateFilter(field_name="paid_at", lookup_expr="date__lte")
    include_voided = filters.CharFilter(method="filter_include_voided")

    class Meta:
        model = Payment
        fields = ["status", "provider"]

    def filter_include_voided(self, queryset, name, value):
        return queryset  # handled in the view (voided rows are hidden unless requested)


def _payments_queryset(request):
    qs = (
        Payment.objects.select_related("order")
        .annotate(
            _refunded_fils=Coalesce(
                Sum("refund_records__amount_fils", filter=Q(refund_records__status=RefundStatus.COMPLETED)), 0
            )
        )
        .order_by("-created_at")
    )
    if not _truthy(request.query_params.get("include_voided")) and request.query_params.get("status") != "CANCELLED":
        qs = qs.exclude(status=PaymentStatus.CANCELLED, raw__has_key="voided")
    return qs


PAYMENT_SEARCH_FIELDS = ["external_ref", "order__order_number", "order__email", "provider", "provider_order_id", "provider_capture_id"]


class AdminPaymentListView(generics.ListAPIView):
    """GET admin/payments/?status=&provider=&date_from=YYYY-MM-DD&date_to=&paid_from=&paid_to=&search=&include_voided=1"""

    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "orders.read"
    serializer_class = AdminPaymentSerializer
    filterset_class = PaymentFilter
    search_fields = PAYMENT_SEARCH_FIELDS
    ordering_fields = ["created_at", "paid_at", "amount_fils", "status", "provider"]

    def get_queryset(self):
        return _payments_queryset(self.request)


class AdminPaymentExportView(AdminPaymentListView):
    """GET admin/payments/export/ (same filters) -> CSV for reconciliation (OR-15)."""

    pagination_class = None

    def list(self, request, *args, **kwargs):
        qs = self.filter_queryset(self.get_queryset())[:20000]
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(
            [
                "order_number",
                "provider",
                "status",
                "amount_jod",
                "provider_amount",
                "provider_currency",
                "capture_id",
                "paid_at",
                "refunded_jod",
                "created_at",
            ]
        )
        for payment in qs:
            writer.writerow(
                [
                    payment.order.order_number,
                    payment.provider,
                    payment.status,
                    f"{payment.amount_fils / 1000:.3f}",
                    payment.provider_amount,
                    payment.currency,
                    payment.provider_capture_id or "",
                    payment.paid_at.isoformat() if payment.paid_at else "",
                    f"{int(payment._refunded_fils or 0) / 1000:.3f}",
                    payment.created_at.isoformat(),
                ]
            )
        response = HttpResponse(buf.getvalue(), content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="payments-{timezone.now():%Y%m%d}.csv"'
        return response


def _coupon_audit_meta(coupon: Coupon) -> dict:
    return {
        "code": coupon.code,
        "percent_off": str(coupon.percent_off) if coupon.percent_off is not None else None,
        "amount_off_fils": coupon.amount_off_fils,
        "active": coupon.active,
        "max_uses": coupon.max_uses,
        "max_uses_per_customer": coupon.max_uses_per_customer,
    }


COUPON_AUDIT_FIELDS = (
    "code",
    "description",
    "percent_off",
    "amount_off_fils",
    "active",
    "starts_at",
    "ends_at",
    "max_uses",
    "max_uses_per_customer",
)


def _coupon_values(coupon: Coupon) -> dict:
    values = {}
    for name in COUPON_AUDIT_FIELDS:
        value = getattr(coupon, name)
        if value is not None and not isinstance(value, (bool, int, str)):
            value = str(value) if not hasattr(value, "isoformat") else value.isoformat()
        values[name] = value
    if values.get("percent_off") is not None:
        from decimal import Decimal

        values["percent_off"] = format(Decimal(str(coupon.percent_off)).normalize(), "f")
    return values


class AdminCouponViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser, HasAdminPermission]
    serializer_class = CouponSerializer
    queryset = Coupon.objects.all()
    search_fields = ["code", "description"]
    filterset_fields = ["active"]

    def get_permissions(self):
        self.admin_permission = "orders.read" if self.action in {"list", "retrieve"} else "orders.write"
        return super().get_permissions()

    def _audit(self, action: str, coupon: Coupon, **extra) -> None:
        AuditLog.objects.create(
            actor=self.request.user,
            action=action,
            entity_type="Coupon",
            entity_id=str(coupon.pk),
            meta={**_coupon_audit_meta(coupon), **extra},
        )

    def perform_create(self, serializer):
        coupon = serializer.save()
        self._audit("coupons.create", coupon)

    def perform_update(self, serializer):
        before = _coupon_values(serializer.instance)
        coupon = serializer.save()
        after = _coupon_values(coupon)
        changed = sorted(name for name in COUPON_AUDIT_FIELDS if before.get(name) != after.get(name))
        if not changed:
            return  # OR-14: nothing changed -> nothing to log
        AuditLog.objects.create(
            actor=self.request.user,
            action="coupons.update",
            entity_type="Coupon",
            entity_id=str(coupon.pk),
            meta={
                "code": coupon.code,
                "changed": changed,
                "changes": {name: {"from": before.get(name), "to": after.get(name)} for name in changed},
            },
        )

    def destroy(self, request, *args, **kwargs):
        coupon = self.get_object()
        if Order.objects.filter(coupon=coupon).exists():
            return Response(
                {
                    "detail": "This coupon has been used on orders and cannot be deleted. Deactivate it instead.",
                    "code": "coupon_in_use",
                },
                status=status.HTTP_409_CONFLICT,
            )
        self._audit("coupons.delete", coupon)
        coupon.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# --- Bulk digital-code import ---


class CodeImportBatchSerializer(serializers.ModelSerializer):
    uploaded_by_email = serializers.CharField(source="uploaded_by.email", read_only=True, allow_null=True)
    variant_sku = serializers.CharField(source="variant.sku", read_only=True, allow_null=True)
    variant_name = serializers.CharField(source="variant.name_en", read_only=True, allow_null=True)
    product_id = serializers.CharField(source="variant.product_id", read_only=True, allow_null=True)
    product_name = serializers.CharField(source="variant.product.name_en", read_only=True, allow_null=True)

    class Meta:
        model = CodeImportBatch
        fields = (
            "id",
            "filename",
            "mode",
            "status",
            "variant",
            "variant_sku",
            "variant_name",
            "product_id",
            "product_name",
            "uploaded_by",
            "uploaded_by_email",
            "total_rows",
            "valid_rows",
            "imported_rows",
            "duplicate_rows",
            "failed_rows",
            "auto_delivered_orders",
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
            return Response(
                {"detail": exc.message, "code": "duplicate_code" if exc.status == 409 else "import_error"},
                status=exc.status,
            )
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
            return Response(
                {"detail": exc.message, "code": "duplicate_code" if exc.status == 409 else "import_error"},
                status=exc.status,
            )
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
                "waiting_orders_delivered": getattr(batch, "waiting_orders", {}).get("delivered", 0),
            },
        )
        data = CodeImportBatchSerializer(batch).data
        waiting = getattr(batch, "waiting_orders", None) or {"delivered": 0, "partially_delivered": 0, "order_numbers": []}
        data["waiting_orders"] = waiting
        data["waiting_orders_message"] = (
            f"{waiting['delivered']} waiting order(s) were delivered." if waiting["delivered"] else ""
        )
        return Response(data)


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
            return Response(
                {"detail": exc.message, "code": "duplicate_code" if exc.status == 409 else "import_error"},
                status=exc.status,
            )
        AuditLog.objects.create(
            actor=request.user,
            action="codes.manual_create",
            entity_type="DigitalCode",
            entity_id=str(obj.id),
            meta={"variant_id": obj.variant_id, "masked": obj.masked, "source": obj.source},
        )
        data = AdminMaskedCodeSerializer(obj).data
        waiting = getattr(obj, "waiting_orders", None) or {"delivered": 0, "partially_delivered": 0, "order_numbers": []}
        data["waiting_orders"] = waiting
        data["waiting_orders_message"] = (
            f"{waiting['delivered']} waiting order(s) were delivered." if waiting["delivered"] else ""
        )
        return Response(data, status=status.HTTP_201_CREATED)


class AdminCodeDeactivateView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "codes.manage"

    def post(self, request, code_id: int):
        try:
            obj = deactivate_code(code_id=code_id, actor=request.user)
        except CodeImportError as exc:
            return Response(
                {"detail": exc.message, "code": "duplicate_code" if exc.status == 409 else "import_error"},
                status=exc.status,
            )
        AuditLog.objects.create(
            actor=request.user,
            action="codes.deactivate",
            entity_type="DigitalCode",
            entity_id=str(obj.id),
            meta={"variant_id": obj.variant_id, "masked": obj.masked},
        )
        return Response(AdminMaskedCodeSerializer(obj).data)
