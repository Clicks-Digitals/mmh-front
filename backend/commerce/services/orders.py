from __future__ import annotations

from django.db import transaction

from audit.models import AuditLog
from commerce.models import FulfillmentStatus, Order, PaymentStatus


class OrderTransitionError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


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


@transaction.atomic
def transition_order(
    order: Order,
    *,
    payment_status: str | None = None,
    fulfillment_status: str | None = None,
    actor=None,
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
            changes["fulfillment_status"] = f"{order.fulfillment_status}→{fulfillment_status}"
            order.fulfillment_status = fulfillment_status
            update_fields.append("fulfillment_status")

    if changes:
        order.save(update_fields=update_fields)
        AuditLog.objects.create(
            actor=actor,
            action="orders.transition",
            entity_type="Order",
            entity_id=str(order.id),
            meta={"order_number": order.order_number, "changes": changes},
        )
    return order
