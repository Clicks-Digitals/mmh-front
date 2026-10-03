from __future__ import annotations

import logging
import secrets
from typing import Any

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from commerce.models import Coupon, Order, Payment, PaymentStatus
from commerce.services.orders import transition_order

logger = logging.getLogger("commerce")


class PaymentError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = "payment_error"):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


def create_pending_payment(*, order: Order, provider: str = "pending") -> Payment:
    """Create a PENDING payment row for an order (production checkout path)."""
    return Payment.objects.create(
        order=order,
        provider=provider,
        status=PaymentStatus.PENDING,
        amount_fils=order.total_fils,
        raw={},
    )


@transaction.atomic
def mark_payment_verified(
    payment: Payment,
    *,
    external_ref: str = "",
    provider_payload: dict[str, Any] | None = None,
    actor=None,
) -> Payment:
    """
    Authoritative entry point after a payment provider has been verified server-side.

    Idempotent: if payment is already PAID, re-enters fulfillment safely (no double coupon).
    Payment developer must call this only after signature/amount/currency/order checks.
    """
    payment = Payment.objects.select_for_update().select_related("order").get(pk=payment.pk)
    order = Order.objects.select_for_update().get(pk=payment.order_id)

    if payment.status == PaymentStatus.PAID:
        from commerce.services.fulfillment import fulfill_order

        if order.payment_status != PaymentStatus.PAID:
            transition_order(order, payment_status=PaymentStatus.PAID, actor=actor)
        fulfill_order(order, actor=actor)
        return payment

    if payment.amount_fils != order.total_fils:
        raise PaymentError(
            f"Payment amount {payment.amount_fils} does not match order total {order.total_fils}",
            status=409,
        )

    if payment.status not in {PaymentStatus.PENDING, PaymentStatus.AUTHORIZED}:
        raise PaymentError(f"Cannot verify payment in status {payment.status}", status=409)

    payment.status = PaymentStatus.PAID
    if external_ref:
        payment.external_ref = external_ref
    payment.paid_at = timezone.now()
    safe_meta = {"verified_at": payment.paid_at.isoformat()}
    if provider_payload:
        safe_meta["provider_keys"] = sorted(str(k) for k in provider_payload.keys())[:40]
    payment.raw = {**(payment.raw or {}), **safe_meta}
    payment.save(update_fields=["status", "external_ref", "raw", "paid_at", "updated_at"])

    was_unpaid = order.payment_status != PaymentStatus.PAID
    if was_unpaid:
        transition_order(order, payment_status=PaymentStatus.PAID, actor=actor)
        if order.coupon_id:
            Coupon.objects.filter(pk=order.coupon_id).update(used_count=F("used_count") + 1)

    from commerce.services.fulfillment import fulfill_order

    fulfill_order(order, actor=actor)
    logger.info("Payment verified for order %s (payment_id=%s)", order.order_number, payment.id)
    return payment


@transaction.atomic
def apply_demo_auto_payment(order: Order) -> Payment:
    """
    DEVELOPMENT / DEMO ONLY.

    Marks placeholder payment PAID and triggers demo fulfillment.
    Refused unless ALLOW_DEMO_AUTO_PAYMENT is true (hard-blocked in production settings).
    """
    if not getattr(settings, "ALLOW_DEMO_AUTO_PAYMENT", False):
        raise PaymentError(
            "Demo auto-payment is disabled. Real payment verification is required.",
            status=403,
        )
    if getattr(settings, "IS_PRODUCTION", False):
        raise PaymentError("Demo auto-payment is forbidden in production", status=403)

    payment = (
        order.payments.select_for_update().filter(status=PaymentStatus.PENDING).order_by("-id").first()
    )
    if not payment:
        payment = Payment.objects.create(
            order=order,
            provider="placeholder",
            status=PaymentStatus.PENDING,
            amount_fils=order.total_fils,
            raw={},
        )
    else:
        payment.provider = "placeholder"
        payment.save(update_fields=["provider", "updated_at"])

    return mark_payment_verified(
        payment,
        external_ref=f"demo-{secrets.token_hex(4)}",
        provider_payload={"note": "demo auto-pay"},
    )
