from __future__ import annotations

import logging
import re
import secrets
from datetime import timedelta
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from catalog.models import FieldInputType, FulfillmentType, Product, ProductVariant, PublishStatus, StockStatus
from commerce.models import (
    Coupon,
    FulfillmentStatus,
    Order,
    OrderItem,
    PaymentStatus,
)
from commerce.services.payment import PaymentError, apply_demo_auto_payment, create_pending_payment

User = get_user_model()
logger = logging.getLogger("commerce")

INVALID_COUPON_MESSAGE = "This coupon code is not valid."
MAX_LINES = 20
MAX_UNITS_PER_ORDER = 10
MAX_QTY_PER_LINE = 5
PENDING_COUPON_WINDOW_MINUTES = 60
DELIVERY_METHODS = {"account", "email"}
ORDER_NUMBER_ATTEMPTS = 5
MAX_FIELD_LENGTH = 255
TEL_RE = re.compile(r"^\+?[0-9][0-9\s\-().]{4,24}$")
REUSABLE_PAYMENT_STATUSES = {PaymentStatus.PENDING, PaymentStatus.AUTHORIZED}
REUSABLE_FULFILLMENT_STATUSES = {FulfillmentStatus.NOT_STARTED, FulfillmentStatus.QUEUED}


class CheckoutError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = "checkout_error", field: str = ""):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.field = field


def jod_to_fils(amount) -> int:
    try:
        return int((Decimal(str(amount or 0)) * 1000).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    except InvalidOperation as exc:
        raise CheckoutError("Invalid amount") from exc


def make_order_number() -> str:
    return secrets.token_hex(6).upper()


# --- Coupons --------------------------------------------------------------------------


def _coupon_use_counts(coupon: Coupon, *, email: str | None = None, now=None) -> tuple[int, int]:
    """(total uses, PAID uses by this email).

    The global limit counts PAID uses plus PENDING orders from the last hour (so parallel
    checkouts cannot oversubscribe). The per-customer limit counts PAID orders only, so a
    customer's own abandoned attempt never locks them out.
    """
    now = now or timezone.now()
    recent_pending = Q(
        payment_status__in=[PaymentStatus.PENDING, PaymentStatus.AUTHORIZED],
        created_at__gte=now - timedelta(minutes=PENDING_COUPON_WINDOW_MINUTES),
    )
    paid = Q(payment_status__in=[PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED])
    orders = Order.objects.filter(coupon=coupon)
    pending_total = orders.filter(recent_pending).count()
    paid_total = max(coupon.used_count, orders.filter(paid).count())
    by_email = 0
    if email:
        by_email = orders.filter(email__iexact=email.strip()).filter(paid).count()
    return paid_total + pending_total, by_email


def coupon_unusable_reason(coupon: Coupon, *, now=None, email: str | None = None) -> str | None:
    """Internal reason a coupon cannot be used (for logs only), else None."""
    now = now or timezone.now()
    if not coupon.active:
        return "inactive"
    if coupon.starts_at and now < coupon.starts_at:
        return "not_started"
    if coupon.ends_at and now > coupon.ends_at:
        return "expired"
    if coupon.max_uses is not None or (email and coupon.max_uses_per_customer is not None):
        total, by_email = _coupon_use_counts(coupon, email=email, now=now)
        if coupon.max_uses is not None and total >= coupon.max_uses:
            return "usage_limit"
        if email and coupon.max_uses_per_customer is not None and by_email >= coupon.max_uses_per_customer:
            return "customer_limit"
    return None


def coupon_discount_fils(coupon: Coupon, subtotal_fils: int) -> int:
    subtotal_fils = max(int(subtotal_fils or 0), 0)
    if coupon.percent_off is not None:
        percent = Decimal(str(coupon.percent_off))
        discount = (Decimal(subtotal_fils) * percent / Decimal(100)).quantize(Decimal(1), rounding=ROUND_DOWN)
        return min(int(discount), subtotal_fils)
    if coupon.amount_off_fils is not None:
        return min(max(int(coupon.amount_off_fils), 0), subtotal_fils)
    return 0


def resolve_coupon(code: str, *, subtotal_fils: int, email: str | None = None) -> tuple[Coupon, int]:
    """Look up and validate a coupon. Every failure gets the same message (no enumeration)."""
    cleaned = (code or "").strip()
    coupon = Coupon.objects.filter(code__iexact=cleaned).first() if cleaned else None
    reason = "not_found" if coupon is None else coupon_unusable_reason(coupon, email=email)
    if reason:
        logger.info("Coupon rejected code=%r reason=%s", cleaned[:40], reason)
        raise CheckoutError(INVALID_COUPON_MESSAGE, status=400, code="invalid_coupon", field="coupon_code")
    return coupon, coupon_discount_fils(coupon, subtotal_fils)


def validate_coupon(
    code: str,
    subtotal_jod: Any = 0,
    *,
    subtotal_fils: int | None = None,
    email: str | None = None,
) -> dict[str, Any]:
    if subtotal_fils is None:
        subtotal_fils = jod_to_fils(subtotal_jod or 0)
    coupon, discount = resolve_coupon(code, subtotal_fils=subtotal_fils, email=email)
    total = max(subtotal_fils - discount, 0)
    return {
        "valid": True,
        "code": coupon.code,
        "percent_off": str(coupon.percent_off) if coupon.percent_off is not None else None,
        "amount_off_fils": coupon.amount_off_fils,
        "subtotal_fils": subtotal_fils,
        "discount_fils": discount,
        "discount_jod": discount / 1000,
        "total_fils": total,
        "total_jod": total / 1000,
    }


# --- Line validation ------------------------------------------------------------------


def _resolve_variant(product: Product, raw: dict[str, Any]) -> ProductVariant:
    variants = product.variants.all()
    variant = None
    if raw.get("variant_id") not in (None, ""):
        variant = variants.filter(id=raw["variant_id"]).first()
    elif str(raw.get("denomination_id") or "").strip():
        denom = str(raw["denomination_id"]).strip()
        match = Q(external_id=denom)
        if denom.isdigit():
            match |= Q(id=int(denom))
        found = list(variants.filter(match)[:2])
        # Prefer an exact external_id match over an id match when both exist.
        exact = [v for v in found if v.external_id == denom]
        variant = (exact or found or [None])[0]
    else:
        raise CheckoutError(f"Choose an option for {product.name_en}", field="variant_id")
    if variant is None:
        raise CheckoutError(f"The selected option for {product.name_en} is not available", field="variant_id")
    if not variant.published:
        raise CheckoutError(f"{product.name_en} ({variant.name_en}) is not available", field="variant_id")
    return variant


def _validate_fields(product: Product, submitted: dict[str, Any] | None) -> dict[str, str]:
    submitted = submitted or {}
    cleaned: dict[str, str] = {}
    for definition in product.fields.all():
        label = definition.label_en or definition.key
        value = str(submitted.get(definition.key) or "").strip()
        if not value:
            if definition.required:
                raise CheckoutError(f"{label} is required", field=definition.key)
            continue
        if len(value) > MAX_FIELD_LENGTH:
            raise CheckoutError(f"{label} is too long", field=definition.key)
        if definition.type == FieldInputType.EMAIL:
            try:
                validate_email(value)
            except DjangoValidationError as exc:
                raise CheckoutError(f"{label} must be a valid email address", field=definition.key) from exc
        elif definition.type == FieldInputType.TEL:
            if not TEL_RE.match(value):
                raise CheckoutError(f"{label} must be a valid phone number", field=definition.key)
        cleaned[definition.key] = value
    return cleaned


def _has_supplier_mapping(variant: ProductVariant) -> bool:
    try:
        from suppliers.models import SupplierProductMapping
    except Exception:  # pragma: no cover - suppliers app always installed
        return False
    return SupplierProductMapping.objects.filter(variant=variant, ignored=False, supplier__active=True).exists()


def _normalize_delivery_method(value: Any) -> str:
    method = str(value or "").strip().lower() or "account"
    if method not in DELIVERY_METHODS:
        raise CheckoutError('delivery_method must be "account" or "email"', field="delivery_method")
    return method


def _build_lines(items: list[dict[str, Any]], *, default_delivery: str) -> list[dict[str, Any]]:
    from commerce.services.inventory import available_code_counts

    if not items:
        raise CheckoutError("Cart is empty")
    if len(items) > MAX_LINES:
        raise CheckoutError(f"A cart can have at most {MAX_LINES} lines")

    lines: list[dict[str, Any]] = []
    total_units = 0
    for raw in items:
        product = (
            Product.objects.filter(id=str(raw.get("product_id") or ""), status=PublishStatus.PUBLISHED)
            .select_related("platform")
            .prefetch_related("fields")
            .first()
        )
        if not product:
            raise CheckoutError("A product in your cart is no longer available", field="product_id")
        variant = _resolve_variant(product, raw)
        qty = int(raw.get("quantity") or 1)
        min_q = max(int(variant.min_quantity or 1), 1)
        max_q = min(int(variant.max_quantity or MAX_QTY_PER_LINE), MAX_QTY_PER_LINE)
        if qty < min_q or qty > max_q:
            raise CheckoutError(
                f"Quantity for {product.name_en} ({variant.name_en}) must be between {min_q} and {max_q}",
                field="quantity",
            )
        total_units += qty
        fields = _validate_fields(product, raw.get("fields"))
        lines.append(
            {
                "product": product,
                "variant": variant,
                "qty": qty,
                "line_total": variant.price_fils * qty,
                "fields": fields,
                "delivery_method": _normalize_delivery_method(raw.get("delivery_method") or default_delivery),
            }
        )
    if total_units > MAX_UNITS_PER_ORDER:
        raise CheckoutError(f"An order can contain at most {MAX_UNITS_PER_ORDER} items")

    _check_stock(lines, available_code_counts)
    return lines


def _check_stock(lines: list[dict[str, Any]], available_code_counts) -> None:
    demo = bool(getattr(settings, "ALLOW_DEMO_AUTO_PAYMENT", False))
    requested: dict[int, int] = {}
    for line in lines:
        product, variant = line["product"], line["variant"]
        if product.fulfillment_type == FulfillmentType.DIRECT_TOPUP:
            if variant.stock_status == StockStatus.OUT_OF_STOCK:
                raise CheckoutError(
                    f"Out of stock: {product.name_en} ({variant.name_en})", status=409, code="out_of_stock"
                )
            continue
        requested[variant.id] = requested.get(variant.id, 0) + line["qty"]
    if demo or not requested:
        return  # demo checkout issues demo codes instead of inventory
    counts = available_code_counts(requested.keys())
    for line in lines:
        variant = line["variant"]
        if variant.id not in requested:
            continue
        if requested[variant.id] <= counts.get(variant.id, 0):
            continue
        if _has_supplier_mapping(variant):
            continue
        raise CheckoutError(
            f"Out of stock: {line['product'].name_en} ({variant.name_en})", status=409, code="out_of_stock"
        )


# --- Orders ---------------------------------------------------------------------------


def _reusable_order(idem: str, email: str) -> Order | None:
    if not idem:
        return None
    return (
        Order.objects.filter(
            idempotency_key=idem,
            email__iexact=email,
            payment_status__in=REUSABLE_PAYMENT_STATUSES,
            fulfillment_status__in=REUSABLE_FULFILLMENT_STATUSES,
        )
        .order_by("-id")
        .first()
    )


def _create_order_row(**fields) -> Order:
    for attempt in range(ORDER_NUMBER_ATTEMPTS):
        try:
            with transaction.atomic():
                return Order.objects.create(order_number=make_order_number(), **fields)
        except IntegrityError:
            if attempt == ORDER_NUMBER_ATTEMPTS - 1:
                raise
            logger.warning("Order number collision; retrying (attempt %s)", attempt + 2)
    raise CheckoutError("Could not allocate an order number", status=503)  # pragma: no cover


@transaction.atomic
def create_storefront_order(*, data: dict[str, Any], user=None) -> Order:
    """
    Create a storefront order.

    Always creates Order + PENDING Payment first.

    DEVELOPMENT/DEMO (ALLOW_DEMO_AUTO_PAYMENT=true):
      applies placeholder auto-pay → fulfillment issues demo codes.

    PRODUCTION / when demo auto-pay is disabled:
      leaves payment PENDING; no codes; coupon not consumed until payment verified.
      Real PSP integration must call commerce.services.payment.mark_payment_verified.
    """
    provider = str(data.get("payment_provider") or "").strip().lower()
    email = str(data["email"]).strip().lower()
    idem = str(data.get("idempotency_key") or "").strip()

    existing = _reusable_order(idem, email)
    if existing:
        if provider == "paypal":
            _prepare_paypal(existing)
        return existing
    if idem and Order.objects.filter(idempotency_key=idem).exists():
        # Key collides with another customer's order or a finished order: ignore it.
        idem = ""

    default_delivery = _normalize_delivery_method(data.get("delivery_method"))
    lines = _build_lines(list(data.get("items") or []), default_delivery=default_delivery)
    subtotal = sum(line["line_total"] for line in lines)

    discount = 0
    coupon = None
    if str(data.get("coupon_code") or "").strip():
        coupon, discount = resolve_coupon(str(data["coupon_code"]), subtotal_fils=subtotal, email=email)

    total = max(subtotal - discount, 0)
    if provider == "paypal":
        from commerce.services.paypal import assert_paypal_ready, quote_paypal_amount

        try:
            assert_paypal_ready()
            quote_paypal_amount(total, "JOD")
        except PaymentError as exc:
            raise CheckoutError(exc.message, status=exc.status, code=exc.code) from exc
    order_user = user if user is not None and getattr(user, "is_authenticated", False) else None

    order = _create_order_row(
        user=order_user,
        email=email,
        full_name=data["full_name"],
        phone=data.get("phone") or "",
        notes=data.get("notes") or "",
        coupon=coupon,
        subtotal_fils=subtotal,
        discount_fils=discount,
        total_fils=total,
        idempotency_key=idem,
        region_confirmed=data.get("region_confirmed", False),
        refund_confirmed=data.get("refund_confirmed", False),
        payment_status=PaymentStatus.PENDING,
        fulfillment_status=FulfillmentStatus.NOT_STARTED,
    )

    for line in lines:
        product, variant = line["product"], line["variant"]
        method = line["delivery_method"]
        OrderItem.objects.create(
            order=order,
            product=product,
            variant=variant,
            quantity=line["qty"],
            unit_price_fils=variant.price_fils,
            line_total_fils=line["line_total"],
            product_name=product.name_en,
            variant_name=variant.name_en,
            customer_fields=line["fields"],
            delivery_method=method,
            delivery_contact=email if method == "email" else "",
            region_name=variant.region.name_en if variant.region else "",
            platform_name=product.platform.name_en,
        )

    if provider == "paypal":
        _prepare_paypal(order)
        return order

    create_pending_payment(order=order, provider="pending")

    allow_demo = bool(getattr(settings, "ALLOW_DEMO_AUTO_PAYMENT", False))
    if getattr(settings, "IS_PRODUCTION", False) and allow_demo:
        raise CheckoutError("Demo auto-payment is forbidden in production", status=403)

    if allow_demo:
        try:
            apply_demo_auto_payment(order)
        except PaymentError as exc:
            raise CheckoutError(exc.message, status=exc.status) from exc
        order.refresh_from_db()
        return order

    # Production / staging without demo: pending payment only — no codes, no coupon burn.
    return order


def _prepare_paypal(order: Order) -> None:
    from commerce.services.paypal import prepare_paypal_checkout

    try:
        prepare_paypal_checkout(order)
    except PaymentError as exc:
        raise CheckoutError(exc.message, status=exc.status, code=exc.code) from exc
