from __future__ import annotations

import logging
import secrets

from django.conf import settings
from django.db import transaction

from commerce.crypto import encrypt_code, fingerprint_code
from commerce.models import (
    DigitalCode,
    DigitalCodeSource,
    DigitalCodeStatus,
    FulfillmentStatus,
    Order,
    PaymentStatus,
)
from commerce.services.orders import transition_order

logger = logging.getLogger("commerce")


class FulfillmentError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def _advance_fulfillment(order: Order, target: str, *, actor=None) -> Order:
    """Walk allowed transitions toward target (NOT_STARTED→QUEUED→PROCESSING→COMPLETED)."""
    path = [
        FulfillmentStatus.NOT_STARTED,
        FulfillmentStatus.QUEUED,
        FulfillmentStatus.PROCESSING,
        FulfillmentStatus.COMPLETED,
    ]
    if target not in path:
        raise FulfillmentError(f"Unsupported fulfillment target {target}")
    order.refresh_from_db()
    while order.fulfillment_status != target:
        cur = order.fulfillment_status
        if cur == FulfillmentStatus.COMPLETED:
            break
        if cur not in path:
            raise FulfillmentError(f"Cannot advance from {cur}")
        idx = path.index(cur)
        nxt = path[idx + 1]
        transition_order(order, fulfillment_status=nxt, actor=actor)
        order.refresh_from_db()
        if nxt == target:
            break
    return order


@transaction.atomic
def fulfill_order(order: Order, *, actor=None) -> Order:
    """
    Idempotent fulfillment entry point after payment is PAID.

    - Already COMPLETED -> no-op (safe for webhook replay).
    - ALLOW_DEMO_AUTO_PAYMENT -> issue encrypted CHECKOUT_DEMO codes, mark COMPLETED.
    - Otherwise -> assign inventory codes (commerce.services.inventory.allocate_codes):
      COMPLETED when everything is delivered, MANUAL_REVIEW when codes are short,
      PROCESSING while DIRECT_TOPUP items wait for staff. Live supplier purchase is never
      performed here.
    """
    from commerce.services.inventory import InventoryError, allocate_codes

    order = Order.objects.select_for_update().prefetch_related("items").get(pk=order.pk)

    if order.fulfillment_status == FulfillmentStatus.COMPLETED:
        return order

    if order.payment_status != PaymentStatus.PAID:
        raise FulfillmentError(
            f"Order {order.order_number} is not paid (payment_status={order.payment_status})",
            status=409,
        )

    if getattr(settings, "ALLOW_DEMO_AUTO_PAYMENT", False):
        _advance_fulfillment(order, FulfillmentStatus.PROCESSING, actor=actor)
        _fulfill_demo_codes(order)
        _advance_fulfillment(order, FulfillmentStatus.COMPLETED, actor=actor)
        logger.info("Demo fulfillment completed for order %s", order.order_number)
        return order

    try:
        result = allocate_codes(order, actor=actor)
    except InventoryError as exc:
        raise FulfillmentError(exc.message, status=exc.status) from exc
    logger.info(
        "Order %s paid; fulfillment %s (%s code(s) assigned)",
        order.order_number,
        result.fulfillment_status,
        len(result.assigned_code_ids),
    )
    order.refresh_from_db()
    return order


def flag_manual_review(order: Order, *, reason: str, actor=None) -> None:
    """Force MANUAL_REVIEW without transition rules (used when automation fails on a paid order)."""
    from audit.models import AuditLog

    current = Order.objects.filter(pk=order.pk).values_list("fulfillment_status", flat=True).first()
    if current in {None, FulfillmentStatus.COMPLETED, FulfillmentStatus.MANUAL_REVIEW}:
        return
    Order.objects.filter(pk=order.pk).update(fulfillment_status=FulfillmentStatus.MANUAL_REVIEW)
    AuditLog.objects.create(
        actor=actor,
        action="orders.manual_review",
        entity_type="Order",
        entity_id=str(order.pk),
        meta={
            "order_number": order.order_number,
            "from": current,
            "reason": (reason or "")[:500],
        },
    )
    logger.error("Order %s moved to MANUAL_REVIEW: %s", order.order_number, reason)


def _fulfill_demo_codes(order: Order) -> None:
    from django.utils import timezone

    now = timezone.now()
    for item in order.items.all():
        if item.delivered_at is None:
            item.delivered_at = now
            item.save(update_fields=["delivered_at"])
        existing = DigitalCode.objects.filter(order_item=item).count()
        need = max(item.quantity - existing, 0)
        for _ in range(need):
            demo_pin = f"MMH-{secrets.token_hex(4).upper()}"
            ciphertext, nonce, masked = encrypt_code(demo_pin)
            DigitalCode.objects.create(
                order_item=item,
                variant=item.variant,
                status=DigitalCodeStatus.DELIVERED,
                source=DigitalCodeSource.CHECKOUT_DEMO,
                code_fingerprint=fingerprint_code(demo_pin),
                ciphertext=ciphertext,
                nonce=nonce,
                masked=masked,
                delivered_at=now,
            )
