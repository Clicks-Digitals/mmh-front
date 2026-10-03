from __future__ import annotations

import secrets
from decimal import Decimal
from typing import Any

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction

from catalog.models import Product, ProductVariant, StockStatus
from commerce.models import (
    Coupon,
    FulfillmentStatus,
    Order,
    OrderItem,
    PaymentStatus,
)
from commerce.services.payment import PaymentError, apply_demo_auto_payment, create_pending_payment

User = get_user_model()


class CheckoutError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def jod_to_fils(amount) -> int:
    return int(Decimal(str(amount)) * 1000)


def make_order_number() -> str:
    return secrets.token_hex(4).upper()


def coupon_unusable_reason(coupon: Coupon, *, now=None) -> str | None:
    """Return an error message if the coupon cannot be used, else None."""
    from django.utils import timezone

    now = now or timezone.now()
    if not coupon.active:
        return "Coupon is inactive"
    if coupon.starts_at and now < coupon.starts_at:
        return "Coupon is not active yet"
    if coupon.ends_at and now > coupon.ends_at:
        return "Coupon has expired"
    if coupon.max_uses is not None and coupon.used_count >= coupon.max_uses:
        return "Coupon usage limit reached"
    return None


def validate_coupon(code: str, subtotal_jod: float = 0) -> dict[str, Any]:
    coupon = Coupon.objects.filter(code__iexact=code.strip()).first()
    if not coupon:
        raise CheckoutError("Invalid coupon", status=404)
    err = coupon_unusable_reason(coupon)
    if err:
        raise CheckoutError(err, status=400)
    subtotal_fils = jod_to_fils(subtotal_jod or 0)
    discount = 0
    if coupon.percent_off is not None:
        discount = int(subtotal_fils * float(coupon.percent_off) / 100)
    elif coupon.amount_off_fils is not None:
        discount = coupon.amount_off_fils
    return {
        "valid": True,
        "code": coupon.code,
        "discount_fils": discount,
        "discount_jod": discount / 1000,
    }


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
    idem = data.get("idempotency_key") or ""
    if idem:
        existing = Order.objects.filter(idempotency_key=idem).first()
        if existing:
            if provider == "paypal" and existing.payment_status != PaymentStatus.PAID:
                _prepare_paypal(existing)
            return existing

    items = data.get("items") or []
    if not items:
        raise CheckoutError("Cart is empty")

    lines: list[tuple[Product, ProductVariant, dict]] = []
    subtotal = 0
    for raw in items:
        product = Product.objects.filter(id=raw["product_id"]).first()
        if not product:
            raise CheckoutError(f"Unknown product {raw['product_id']}")
        variant = None
        if raw.get("variant_id"):
            variant = ProductVariant.objects.filter(id=raw["variant_id"], product=product).first()
        elif raw.get("denomination_id"):
            variant = ProductVariant.objects.filter(product=product, external_id=raw["denomination_id"]).first()
        if not variant:
            variant = product.variants.filter(published=True).order_by("sort_order").first()
        if not variant:
            raise CheckoutError(f"No variant for {product.id}")
        if variant.stock_status == StockStatus.OUT_OF_STOCK:
            raise CheckoutError(f"{product.name_en} is out of stock")
        qty = raw["quantity"]
        line_total = variant.price_fils * qty
        subtotal += line_total
        lines.append((product, variant, {**raw, "line_total": line_total, "qty": qty}))

    discount = 0
    coupon = None
    if data.get("coupon_code"):
        coupon = Coupon.objects.filter(code__iexact=str(data["coupon_code"]).strip()).first()
        if not coupon:
            raise CheckoutError("Invalid coupon", status=400)
        err = coupon_unusable_reason(coupon)
        if err:
            raise CheckoutError(err, status=400)
        if coupon.percent_off is not None:
            discount = int(subtotal * float(coupon.percent_off) / 100)
        elif coupon.amount_off_fils is not None:
            discount = min(coupon.amount_off_fils, subtotal)

    total = max(subtotal - discount, 0)
    if provider == "paypal":
        from commerce.services.paypal import assert_paypal_ready, quote_paypal_amount

        try:
            assert_paypal_ready()
            quote_paypal_amount(total, "JOD")
        except PaymentError as exc:
            raise CheckoutError(exc.message, status=exc.status) from exc
    order_user = user if user is not None and getattr(user, "is_authenticated", False) else None

    order = Order.objects.create(
        order_number=make_order_number(),
        user=order_user,
        email=str(data["email"]).lower(),
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

    for product, variant, raw in lines:
        OrderItem.objects.create(
            order=order,
            product=product,
            variant=variant,
            quantity=raw["qty"],
            unit_price_fils=variant.price_fils,
            line_total_fils=raw["line_total"],
            product_name=product.name_en,
            variant_name=variant.name_en,
            customer_fields=raw.get("fields") or {},
            delivery_method=raw.get("delivery_method") or "",
            delivery_contact=raw.get("delivery_contact") or "",
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
        raise CheckoutError(exc.message, status=exc.status) from exc
