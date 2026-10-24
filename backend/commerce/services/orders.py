from __future__ import annotations

import logging

from django.db import transaction

from audit.models import AuditLog
from catalog.models import FulfillmentType
from commerce.models import DigitalCode, DigitalCodeStatus, FulfillmentStatus, Order, Payment, PaymentStatus

logger = logging.getLogger("commerce")

REFUND_FIRST = "This order is paid. Refund it first, then cancel."


class OrderTransitionError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = "invalid_transition"):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


PAYMENT_TRANSITIONS: dict[str, set[str]] = {
    PaymentStatus.PENDING: {
        PaymentStatus.PAID,
        PaymentStatus.FAILED,
        PaymentStatus.CANCELLED,
        PaymentStatus.AUTHORIZED,
    },
    PaymentStatus.AUTHORIZED: {
        PaymentStatus.PAID,
        PaymentStatus.FAILED,
        PaymentStatus.CANCELLED,
    },
    PaymentStatus.PAID: {
        PaymentStatus.REFUNDED,
        PaymentStatus.PARTIALLY_REFUNDED,
    },
    PaymentStatus.PARTIALLY_REFUNDED: {
        PaymentStatus.REFUNDED,
    },
    # A failed payment can still be cancelled (D7: one cancel action for every unpaid order).
    PaymentStatus.FAILED: {
        PaymentStatus.CANCELLED,
    },
}

FULFILLMENT_TRANSITIONS: dict[str, set[str]] = {
    FulfillmentStatus.NOT_STARTED: {
        FulfillmentStatus.QUEUED,
        FulfillmentStatus.CANCELLED,
    },
    FulfillmentStatus.QUEUED: {
        FulfillmentStatus.PROCESSING,
        FulfillmentStatus.CANCELLED,
    },
    FulfillmentStatus.PROCESSING: {
        FulfillmentStatus.COMPLETED,
        FulfillmentStatus.FAILED,
        FulfillmentStatus.MANUAL_REVIEW,
        FulfillmentStatus.CANCELLED,
    },
    FulfillmentStatus.MANUAL_REVIEW: {
        FulfillmentStatus.PROCESSING,
        FulfillmentStatus.COMPLETED,
        FulfillmentStatus.FAILED,
        FulfillmentStatus.CANCELLED,
    },
    FulfillmentStatus.FAILED: {
        FulfillmentStatus.QUEUED,
        FulfillmentStatus.MANUAL_REVIEW,
        FulfillmentStatus.CANCELLED,
    },
}

TERMINAL_FULFILLMENT = {
    FulfillmentStatus.COMPLETED,
    FulfillmentStatus.CANCELLED,
}


def _validate_payment_transition(current: str, next_status: str) -> None:
    allowed = PAYMENT_TRANSITIONS.get(current, set())
    if next_status not in allowed:
        raise OrderTransitionError(
            f"Invalid payment transition {current} → {next_status}",
            status=400,
        )


def _validate_fulfillment_transition(current: str, next_status: str) -> None:
    if current in TERMINAL_FULFILLMENT and next_status != current:
        raise OrderTransitionError(
            f"Fulfillment status {current} is terminal",
            status=400,
        )
    allowed = FULFILLMENT_TRANSITIONS.get(current, set())
    if next_status not in allowed:
        raise OrderTransitionError(
            f"Invalid fulfillment transition {current} → {next_status}",
            status=400,
        )


PAID_UNREFUNDED = {PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED}
UNPAID_CANCELLABLE = {PaymentStatus.PENDING, PaymentStatus.AUTHORIZED, PaymentStatus.FAILED}
# Fulfillment states that need a paid order (D8). NOT_STARTED and CANCELLED never do.
FULFILLMENT_NEEDS_PAYMENT = {
    FulfillmentStatus.QUEUED,
    FulfillmentStatus.PROCESSING,
    FulfillmentStatus.COMPLETED,
    FulfillmentStatus.FAILED,
    FulfillmentStatus.MANUAL_REVIEW,
}

FULFILLMENT_ACTION_LABELS = {
    FulfillmentStatus.QUEUED: "Set status: Queued",
    FulfillmentStatus.PROCESSING: "Set status: Processing",
    FulfillmentStatus.COMPLETED: "Set status: Completed",
    FulfillmentStatus.FAILED: "Set status: Failed",
    FulfillmentStatus.MANUAL_REVIEW: "Set status: Needs review",
}
PAYMENT_ACTION_LABELS = {
    PaymentStatus.PAID: "Mark as paid (received outside PayPal)",
    PaymentStatus.AUTHORIZED: "Mark payment as approved (not yet captured)",
    PaymentStatus.FAILED: "Mark payment as failed",
}
NOT_PAID_REASON = "The order is not paid yet. Delivery can start once it is paid."


# --- Item delivery ---------------------------------------------------------------------


def live_code_count(item) -> int:
    """Codes assigned to an item that still count as delivered (retired/unavailable excluded)."""
    return sum(1 for code in item.codes.all() if code.status != DigitalCodeStatus.UNAVAILABLE)


def item_delivered(item) -> bool:
    if item.product.fulfillment_type == FulfillmentType.CODE:
        return live_code_count(item) >= item.quantity
    return item.delivered_at is not None


def undelivered_items(order: Order) -> list:
    items = list(order.items.select_related("product").prefetch_related("codes").order_by("id"))
    return [item for item in items if not item_delivered(item)]


def _completion_block_reason(order: Order) -> str:
    items = list(order.items.select_related("product").prefetch_related("codes").order_by("id"))
    if not items:
        return "The order has no items."
    pending = [item for item in items if not item_delivered(item)]
    if pending:
        return f"{len(pending)} of {len(items)} item(s) are not delivered yet. Deliver every item first."
    return ""


# --- Transition tables / UI actions ----------------------------------------------------


def allowed_payment_transitions(order: Order) -> list[str]:
    return sorted(PAYMENT_TRANSITIONS.get(order.payment_status, set()))


def _fulfillment_block_reason(order: Order, target: str, *, completion_reason: str | None = None) -> str:
    if target in FULFILLMENT_NEEDS_PAYMENT and order.payment_status not in PAID_UNREFUNDED:
        return NOT_PAID_REASON
    if target == FulfillmentStatus.COMPLETED:
        return completion_reason if completion_reason is not None else _completion_block_reason(order)
    return ""


def allowed_fulfillment_transitions(order: Order) -> list[str]:
    """Fulfillment targets staff can pick right now (D8 gating applied)."""
    if order.fulfillment_status in TERMINAL_FULFILLMENT:
        return []
    allowed = set(FULFILLMENT_TRANSITIONS.get(order.fulfillment_status, set()))
    if order.payment_status in PAID_UNREFUNDED:
        allowed.discard(FulfillmentStatus.CANCELLED)
    completion = None
    result = []
    for target in sorted(allowed):
        if target == FulfillmentStatus.COMPLETED and completion is None:
            completion = _completion_block_reason(order)
        if not _fulfillment_block_reason(order, target, completion_reason=completion):
            result.append(target)
    return result


def cancel_block_reason(order: Order) -> str:
    """Why the single "Cancel order" action is unavailable ('' when it is available)."""
    if order.payment_status in PAID_UNREFUNDED:
        return REFUND_FIRST
    if order.fulfillment_status == FulfillmentStatus.CANCELLED:
        if order.payment_status in UNPAID_CANCELLABLE:
            return ""
        return "The order is already cancelled."
    if order.fulfillment_status == FulfillmentStatus.COMPLETED:
        return "Completed orders cannot be cancelled."
    return ""


def can_cancel(order: Order) -> bool:
    """Cancel = payment CANCELLED + fulfillment CANCELLED. Never for paid, unrefunded orders."""
    return not cancel_block_reason(order)


def order_actions(order: Order) -> dict:
    """Every status action with enabled flag and disabled reason, for the admin order page (D8, OR-26)."""
    completion = _completion_block_reason(order)
    fulfillment = []
    if order.fulfillment_status not in TERMINAL_FULFILLMENT:
        for target in sorted(FULFILLMENT_TRANSITIONS.get(order.fulfillment_status, set())):
            if target == FulfillmentStatus.CANCELLED:
                continue  # covered by the single cancel action
            reason = _fulfillment_block_reason(order, target, completion_reason=completion)
            fulfillment.append(
                {
                    "status": target,
                    "label": FULFILLMENT_ACTION_LABELS.get(target, target),
                    "enabled": not reason,
                    "disabled_reason": reason,
                }
            )
    payment = []
    for target in sorted(PAYMENT_TRANSITIONS.get(order.payment_status, set())):
        if target in {PaymentStatus.CANCELLED, PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED}:
            continue  # covered by the cancel / refund actions
        payment.append(
            {
                "status": target,
                "label": PAYMENT_ACTION_LABELS.get(target, target),
                "enabled": True,
                "disabled_reason": "",
                "advanced": target in {PaymentStatus.AUTHORIZED, PaymentStatus.FAILED},
                "requires_reason": target == PaymentStatus.PAID,
            }
        )
    if order.fulfillment_status == FulfillmentStatus.COMPLETED:
        complete_reason = "The order is already completed."
    elif order.fulfillment_status == FulfillmentStatus.CANCELLED:
        complete_reason = "The order is cancelled."
    else:
        complete_reason = _fulfillment_block_reason(order, FulfillmentStatus.COMPLETED, completion_reason=completion)
        if not complete_reason and FulfillmentStatus.COMPLETED not in FULFILLMENT_TRANSITIONS.get(
            order.fulfillment_status, set()
        ):
            complete_reason = ""  # reachable through the automatic Queued -> Processing steps
    cancel_reason = cancel_block_reason(order)
    return {
        "fulfillment": fulfillment,
        "payment": payment,
        "cancel": {"label": "Cancel order", "enabled": not cancel_reason, "disabled_reason": cancel_reason},
        "complete": {
            "label": "Set status: Completed",
            "enabled": not complete_reason,
            "disabled_reason": complete_reason,
        },
    }


def retire_refunded_codes(order: Order, *, actor=None) -> int:
    """Refunded orders: their delivered codes must never be resold or revealed again."""
    qs = DigitalCode.objects.filter(order_item__order=order).exclude(status=DigitalCodeStatus.UNAVAILABLE)
    ids = list(qs.values_list("id", flat=True))
    if not ids:
        return 0
    DigitalCode.objects.filter(id__in=ids).update(status=DigitalCodeStatus.UNAVAILABLE)
    AuditLog.objects.create(
        actor=actor,
        action="codes.refund_retired",
        entity_type="Order",
        entity_id=str(order.id),
        meta={"order_number": order.order_number, "code_ids": ids},
    )
    logger.info("Order %s refunded; %s code(s) marked UNAVAILABLE", order.order_number, len(ids))
    return len(ids)


@transaction.atomic
def transition_order(
    order: Order,
    *,
    payment_status: str | None = None,
    fulfillment_status: str | None = None,
    actor=None,
    reason: str = "",
) -> Order:
    if payment_status is None and fulfillment_status is None:
        raise OrderTransitionError("Provide payment_status and/or fulfillment_status")

    changes: dict[str, str] = {}
    update_fields: list[str] = ["updated_at"]

    if payment_status is not None:
        if payment_status not in PaymentStatus.values:
            raise OrderTransitionError(f"Unknown payment_status: {payment_status}")
        if payment_status != order.payment_status:
            _validate_payment_transition(order.payment_status, payment_status)
            changes["payment_status"] = f"{order.payment_status}→{payment_status}"
            order.payment_status = payment_status
            update_fields.append("payment_status")

    if fulfillment_status is not None:
        if fulfillment_status not in FulfillmentStatus.values:
            raise OrderTransitionError(f"Unknown fulfillment_status: {fulfillment_status}")
        if fulfillment_status != order.fulfillment_status:
            _validate_fulfillment_transition(order.fulfillment_status, fulfillment_status)
            if fulfillment_status in FULFILLMENT_NEEDS_PAYMENT and order.payment_status not in PAID_UNREFUNDED:
                raise OrderTransitionError(NOT_PAID_REASON, status=409, code="not_paid")
            if fulfillment_status == FulfillmentStatus.COMPLETED:
                blocked = _completion_block_reason(order)
                if blocked:
                    raise OrderTransitionError(blocked, status=409, code="items_not_delivered")
            changes["fulfillment_status"] = f"{order.fulfillment_status}→{fulfillment_status}"
            order.fulfillment_status = fulfillment_status
            update_fields.append("fulfillment_status")

    if changes:
        order.save(update_fields=update_fields)
        meta = {"order_number": order.order_number, "changes": changes}
        if reason:
            meta["reason"] = reason[:500]
        AuditLog.objects.create(
            actor=actor,
            action="orders.transition",
            entity_type="Order",
            entity_id=str(order.id),
            meta=meta,
        )
        if "payment_status" in changes and order.payment_status == PaymentStatus.REFUNDED:
            retire_refunded_codes(order, actor=actor)
    return order


def void_open_payments(order: Order, *, keep_payment_id: int | None = None, reason: str = "") -> int:
    """Cancel PENDING/AUTHORIZED payment rows that can no longer settle (OR-06)."""
    qs = Payment.objects.filter(order=order, status__in=[PaymentStatus.PENDING, PaymentStatus.AUTHORIZED])
    if keep_payment_id:
        qs = qs.exclude(pk=keep_payment_id)
    count = 0
    for payment in qs:
        raw = dict(payment.raw or {})
        raw["voided"] = reason or "order settled another way"
        payment.raw = raw
        payment.status = PaymentStatus.CANCELLED
        payment.save(update_fields=["status", "raw", "updated_at"])
        count += 1
    return count


@transaction.atomic
def cancel_order(order: Order, *, actor=None, reason: str = "", source: str = "staff", notify: bool = True) -> Order:
    """D7: one action. Payment CANCELLED, fulfillment CANCELLED, open payment rows voided.

    ``source`` is "staff", "customer" or "system". Paid orders must be refunded first (409).
    Idempotent for an order that is already fully cancelled.
    """
    order = Order.objects.select_for_update().get(pk=order.pk)
    if order.payment_status in PAID_UNREFUNDED:
        raise OrderTransitionError(REFUND_FIRST, status=409, code="refund_first")
    if source == "customer":
        if order.payment_status == PaymentStatus.AUTHORIZED:
            raise OrderTransitionError(
                "Your payment is being confirmed right now, so this order cannot be cancelled.",
                status=409,
                code="payment_in_progress",
            )
        if order.payment_status not in UNPAID_CANCELLABLE:
            raise OrderTransitionError("This order cannot be cancelled.", status=409, code="not_cancellable")
    if order.fulfillment_status == FulfillmentStatus.CANCELLED and order.payment_status not in UNPAID_CANCELLABLE:
        return order
    blocked = cancel_block_reason(order)
    if blocked:
        raise OrderTransitionError(blocked, status=409, code="not_cancellable")
    payment_target = PaymentStatus.CANCELLED if order.payment_status in UNPAID_CANCELLABLE else None
    transition_order(
        order,
        payment_status=payment_target,
        fulfillment_status=FulfillmentStatus.CANCELLED,
        actor=actor,
        reason=reason or f"Cancelled by {source}",
    )
    voided = void_open_payments(order, reason=f"order cancelled by {source}")
    if order.reserved_until is not None:
        order.reserved_until = None
        order.save(update_fields=["reserved_until", "updated_at"])
    AuditLog.objects.create(
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        action="orders.cancelled",
        entity_type="Order",
        entity_id=str(order.id),
        meta={
            "order_number": order.order_number,
            "email": order.email,
            "by": source,
            "reason": (reason or "")[:500],
            "voided_payments": voided,
        },
    )
    if notify:
        from commerce.notifications import queue_order_cancelled

        queue_order_cancelled(order.id)
    return order
