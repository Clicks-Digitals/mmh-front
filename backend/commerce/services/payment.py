from __future__ import annotations

import logging
import secrets
from typing import Any

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from audit.models import AuditLog
from commerce.models import Coupon, FulfillmentStatus, Order, Payment, PaymentStatus
from commerce.services.orders import OrderTransitionError, transition_order

logger = logging.getLogger("commerce")


class PaymentError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = "payment_error", extra: dict | None = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.extra = extra or {}


def create_pending_payment(*, order: Order, provider: str = "pending") -> Payment:
    """Create a PENDING payment row for an order (production checkout path)."""
    return Payment.objects.create(
        order=order,
        provider=provider,
        status=PaymentStatus.PENDING,
        amount_fils=order.total_fils,
        raw={},
    )


def _set_order_paid(order: Order, *, actor=None, reason: str = "") -> None:
    """PAID via the transition table; money that arrives for a non-payable order is still recorded."""
    try:
        transition_order(order, payment_status=PaymentStatus.PAID, actor=actor, reason=reason)
    except OrderTransitionError as exc:
        previous = order.payment_status
        order.payment_status = PaymentStatus.PAID
        order.save(update_fields=["payment_status", "updated_at"])
        AuditLog.objects.create(
            actor=actor,
            action="orders.payment_forced_paid",
            entity_type="Order",
            entity_id=str(order.id),
            meta={
                "order_number": order.order_number,
                "from": previous,
                "reason": reason or exc.message,
            },
        )
        logger.error(
            "Order %s received a verified payment while %s; recorded as PAID", order.order_number, previous
        )


def _safe_fulfill(order: Order, *, actor=None) -> None:
    """Run fulfillment without ever propagating errors into the payment transaction."""
    from commerce.services.fulfillment import FulfillmentError, flag_manual_review, fulfill_order

    order.refresh_from_db()
    if order.fulfillment_status == FulfillmentStatus.CANCELLED:
        flag_manual_review(order, reason="Payment received for a cancelled order", actor=actor)
        return
    try:
        with transaction.atomic():
            fulfill_order(order, actor=actor)
    except (FulfillmentError, OrderTransitionError) as exc:
        flag_manual_review(order, reason=f"Fulfillment failed: {exc.message}", actor=actor)
    except Exception as exc:  # pragma: no cover - defensive: a paid order must never 500
        logger.exception("Unexpected fulfillment error for order %s", order.order_number)
        flag_manual_review(order, reason=f"Unexpected fulfillment error: {exc.__class__.__name__}", actor=actor)
    # D-1E-5: buy what is still missing from 1Epin AFTER this transaction commits (never inside it).
    try:
        from suppliers.services.fulfillment import schedule_supplier_fulfillment

        schedule_supplier_fulfillment(order.id)
    except Exception:  # pragma: no cover - scheduling must never affect the paid order
        logger.exception("Could not schedule 1Epin fulfillment for order %s", order.order_number)


@transaction.atomic
def mark_payment_verified(
    payment: Payment,
    *,
    external_ref: str = "",
    provider_payload: dict[str, Any] | None = None,
    actor=None,
    reason: str = "",
) -> Payment:
    """
    Authoritative entry point after a payment provider has been verified server-side.

    Idempotent: if payment is already PAID, re-enters fulfillment safely (no double coupon).
    Fulfillment problems never propagate: the order goes to MANUAL_REVIEW instead.
    Payment developer must call this only after signature/amount/currency/order checks.
    """
    from commerce.notifications import queue_order_paid

    payment = Payment.objects.select_for_update().select_related("order").get(pk=payment.pk)
    order = Order.objects.select_for_update().get(pk=payment.order_id)

    if payment.status == PaymentStatus.PAID:
        if order.payment_status != PaymentStatus.PAID:
            _set_order_paid(order, actor=actor, reason=reason)
        _safe_fulfill(order, actor=actor)
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
    # OR-06: other open attempts (e.g. an abandoned PayPal order) can no longer settle.
    from commerce.services.orders import void_open_payments

    void_open_payments(order, keep_payment_id=payment.id, reason=f"order paid via {payment.provider}")
    if was_unpaid:
        _set_order_paid(order, actor=actor, reason=reason)
        if order.coupon_id:
            Coupon.objects.filter(pk=order.coupon_id).update(used_count=F("used_count") + 1)
        queue_order_paid(order.id)

    _safe_fulfill(order, actor=actor)
    logger.info("Payment verified for order %s (payment_id=%s)", order.order_number, payment.id)
    return payment


@transaction.atomic
def mark_order_paid_manually(order: Order, *, actor, reason: str) -> Payment:
    """Admin "-> PAID": goes through mark_payment_verified so coupon, Payment row and delivery run."""
    reason = (reason or "").strip()
    if not reason:
        raise PaymentError("A reason is required to mark an order paid manually", status=400, code="reason_required")
    order = Order.objects.select_for_update().get(pk=order.pk)
    if order.payment_status == PaymentStatus.PAID:
        raise PaymentError("Order is already paid", status=409, code="already_paid")
    if order.payment_status not in {PaymentStatus.PENDING, PaymentStatus.AUTHORIZED}:
        raise PaymentError(
            f"Invalid payment transition {order.payment_status} → PAID", status=400, code="invalid_transition"
        )
    payment = Payment.objects.create(
        order=order,
        provider="manual",
        status=PaymentStatus.PENDING,
        amount_fils=order.total_fils,
        currency=order.currency,
        raw={"manual_reason": reason[:500]},
    )
    payment = mark_payment_verified(
        payment,
        external_ref=f"manual-{secrets.token_hex(4)}",
        provider_payload={"reason": reason},
        actor=actor,
        reason=reason,
    )
    AuditLog.objects.create(
        actor=actor,
        action="orders.manual_paid",
        entity_type="Order",
        entity_id=str(order.id),
        meta={"order_number": order.order_number, "payment_id": payment.id, "reason": reason[:500]},
    )
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


@transaction.atomic
def settle_free_order(order: Order) -> Payment:
    """D6: total is 0 after the coupon -> paid immediately with provider "free", then delivery."""
    order = Order.objects.select_for_update().get(pk=order.pk)
    if order.total_fils != 0:
        raise PaymentError("Only orders with a zero total can be settled for free", status=409, code="not_free")
    payment = Payment.objects.create(
        order=order,
        provider="free",
        status=PaymentStatus.PENDING,
        amount_fils=0,
        currency=order.currency,
        raw={"free_order": True},
    )
    return mark_payment_verified(
        payment,
        external_ref=f"free-{order.order_number}",
        provider_payload={"free_order": True},
        reason="Free order (total 0 after coupon)",
    )
