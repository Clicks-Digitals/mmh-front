"""Refund ledger (D5).

Every refund (PayPal or recorded by staff) is a ``Refund`` row in JOD fils. The order's
refunded total / remaining amount and its REFUNDED vs PARTIALLY_REFUNDED status are derived
from the COMPLETED rows, so several partial refunds add up until nothing remains.
"""

from __future__ import annotations

import logging
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from django.db import transaction
from django.db.models import Sum

from audit.models import AuditLog
from commerce.models import Order, Payment, PaymentStatus, Refund, RefundStatus
from commerce.services.money import format_jod
from commerce.services.orders import PAID_UNREFUNDED, transition_order
from commerce.services.payment import PaymentError

logger = logging.getLogger("commerce")

CAPTURED_STATUSES = [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED]


def captured_payment(order: Order) -> Payment | None:
    """The payment that actually took the money (latest captured one)."""
    return (
        Payment.objects.filter(order=order, status__in=CAPTURED_STATUSES)
        .order_by("-paid_at", "-id")
        .first()
    )


def refunded_fils(order: Order) -> int:
    return int(
        Refund.objects.filter(order=order, status=RefundStatus.COMPLETED).aggregate(s=Sum("amount_fils"))["s"] or 0
    )


def refund_summary(order: Order) -> dict[str, Any]:
    payment = captured_payment(order)
    if payment is not None:
        paid = int(payment.amount_fils or 0)
    elif order.payment_status in {*PAID_UNREFUNDED, PaymentStatus.REFUNDED}:
        paid = int(order.total_fils or 0)
    else:
        paid = 0
    refunded = refunded_fils(order)
    pending = int(
        Refund.objects.filter(order=order, status=RefundStatus.PENDING).aggregate(s=Sum("amount_fils"))["s"] or 0
    )
    remaining = max(paid - refunded, 0)
    return {
        "paid_fils": paid,
        "refunded_fils": refunded,
        "pending_refund_fils": pending,
        "remaining_fils": remaining,
        "paid_display": format_jod(paid),
        "refunded_display": format_jod(refunded),
        "remaining_display": format_jod(remaining),
        "provider": payment.provider if payment else "",
    }


def _proportional_fils(payment: Payment, provider_value: str) -> int:
    try:
        value = Decimal(str(provider_value or "0"))
        full = Decimal(payment.provider_amount or "0")
    except Exception:
        return 0
    if full <= 0:
        return 0
    return int((value / full * Decimal(payment.amount_fils)).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def record_provider_refund(
    payment: Payment,
    body: dict[str, Any],
    *,
    amount_fils: int | None = None,
    actor=None,
    reason: str = "",
) -> Refund:
    """Create/update the ledger row for a PayPal refund response or webhook resource."""
    refund_id = str(body.get("id") or "")
    status_raw = str(body.get("status") or "").upper()
    status = {
        "COMPLETED": RefundStatus.COMPLETED,
        "PENDING": RefundStatus.PENDING,
        "FAILED": RefundStatus.FAILED,
        "CANCELLED": RefundStatus.FAILED,
    }.get(status_raw, RefundStatus.PENDING)
    amount = body.get("amount") or {}
    existing = (
        Refund.objects.select_for_update().filter(payment=payment, provider_refund_id=refund_id).first()
        if refund_id
        else None
    )
    if existing:
        if existing.status != status:
            existing.status = status
            existing.save(update_fields=["status"])
        return existing
    if amount_fils is None:
        amount_fils = _proportional_fils(payment, amount.get("value") or "")
        remaining = max(int(payment.amount_fils or 0) - refunded_fils(payment.order), 0)
        amount_fils = min(amount_fils, remaining) if status == RefundStatus.COMPLETED else amount_fils
    return Refund.objects.create(
        order=payment.order,
        payment=payment,
        provider=payment.provider,
        status=status,
        amount_fils=int(amount_fils or 0),
        currency=payment.order.currency,
        provider_amount=str(amount.get("value") or ""),
        provider_currency=str(amount.get("currency_code") or ""),
        provider_refund_id=refund_id,
        reason=(reason or "")[:500],
        actor=actor if getattr(actor, "is_authenticated", False) else None,
    )


def apply_refund_totals(order: Order, *, actor=None, provider_full: bool = False) -> str:
    """Derive REFUNDED / PARTIALLY_REFUNDED from the ledger. Call inside a transaction."""
    order = Order.objects.select_for_update().get(pk=order.pk)
    summary = refund_summary(order)
    if provider_full and summary["remaining_fils"] > 0:
        # The provider says everything is refunded: absorb FX rounding in the last row.
        last = Refund.objects.filter(order=order, status=RefundStatus.COMPLETED).order_by("-id").first()
        if last:
            last.amount_fils += summary["remaining_fils"]
            last.save(update_fields=["amount_fils"])
            summary = refund_summary(order)
    if summary["refunded_fils"] <= 0:
        return order.payment_status
    full = summary["paid_fils"] > 0 and summary["refunded_fils"] >= summary["paid_fils"]
    target = PaymentStatus.REFUNDED if full else PaymentStatus.PARTIALLY_REFUNDED
    payment = captured_payment(order)
    if payment and payment.status != target:
        payment.status = target
        payment.save(update_fields=["status", "updated_at"])
    if order.payment_status in PAID_UNREFUNDED and order.payment_status != target:
        transition_order(order, payment_status=target, actor=actor)
    return target


def issue_refund(
    order: Order,
    *,
    amount_fils: int | None = None,
    reason: str = "",
    actor=None,
    manual: bool = False,
) -> Refund:
    """Refund ``amount_fils`` (default: everything that remains).

    PayPal payments are refunded through PayPal unless ``manual`` is set; any other payment
    (manual, free, legacy) is recorded in the ledger as a manual refund.
    """
    reason = (reason or "").strip()[:500]
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order.pk)
        if order.payment_status not in PAID_UNREFUNDED:
            raise PaymentError("Only paid orders can be refunded.", status=409, code="not_refundable")
        summary = refund_summary(order)
        remaining = summary["remaining_fils"]
        if remaining <= 0:
            raise PaymentError("Nothing is left to refund on this order.", status=409, code="nothing_to_refund")
        amount = remaining if amount_fils is None else int(amount_fils)
        if amount <= 0:
            raise PaymentError("The refund amount must be greater than zero.", status=400, code="invalid_amount")
        if amount > remaining:
            raise PaymentError(
                f"The refund ({format_jod(amount)}) is more than the amount that can still be refunded "
                f"({format_jod(remaining)}).",
                status=400,
                code="refund_exceeds_remaining",
            )
        payment = captured_payment(order)
        use_paypal = bool(payment and payment.provider == "paypal" and not manual)
        refund = None
        if not use_paypal:
            refund = Refund.objects.create(
                order=order,
                payment=payment,
                provider="manual",
                status=RefundStatus.COMPLETED,
                amount_fils=amount,
                currency=order.currency,
                reason=reason,
                actor=actor if getattr(actor, "is_authenticated", False) else None,
            )
            apply_refund_totals(order, actor=actor)
    if use_paypal:
        from commerce.services.paypal import refund_paypal_payment

        refund_paypal_payment(
            payment,
            actor=actor,
            amount_fils=None if amount >= remaining and amount_fils is None else amount,
            reason=reason,
        )
        refund = Refund.objects.filter(payment=payment).order_by("-id").first()
    order.refresh_from_db()
    after = refund_summary(order)
    AuditLog.objects.create(
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        action="orders.refund",
        entity_type="Order",
        entity_id=str(order.id),
        meta={
            "order_number": order.order_number,
            "email": order.email,
            "refund_id": refund.id if refund else None,
            "amount_fils": amount,
            "amount": format_jod(amount),
            "provider": refund.provider if refund else "",
            "provider_amount": refund.provider_amount if refund else "",
            "provider_currency": refund.provider_currency if refund else "",
            "reason": reason,
            "refunded_fils": after["refunded_fils"],
            "remaining_fils": after["remaining_fils"],
            "status": order.payment_status,
        },
    )
    if refund is not None and refund.status == RefundStatus.COMPLETED:
        from commerce.notifications import queue_refund_issued

        queue_refund_issued(order.id, refund.id)
    return refund


def refund_rows(order: Order) -> list[dict[str, Any]]:
    rows = []
    for refund in Refund.objects.filter(order=order).select_related("actor").order_by("created_at", "id"):
        rows.append(
            {
                "id": refund.id,
                "payment_id": refund.payment_id,
                "provider": refund.provider,
                "status": refund.status,
                "amount_fils": refund.amount_fils,
                "amount_display": format_jod(refund.amount_fils),
                "currency": refund.currency,
                "provider_amount": refund.provider_amount,
                "provider_currency": refund.provider_currency,
                "provider_refund_id": refund.provider_refund_id,
                "reason": refund.reason,
                "actor_email": refund.actor.email if refund.actor_id else None,
                "created_at": refund.created_at,
                # Back-compat with the old JSON rows the panel already renders.
                "amount": refund.provider_amount or f"{refund.amount_fils / 1000:.3f}",
            }
        )
    return rows
