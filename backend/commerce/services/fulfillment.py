from __future__ import annotations

import logging
import secrets

from django.conf import settings
from django.db import transaction

from commerce.crypto import code_identity, encrypt_code, fingerprint_code
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

    if order.payment_status not in {PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED}:
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


OUT_OF_STOCK_AFTER_PAYMENT = "Out of stock after payment — deliver manually or refund"


def flag_out_of_stock_after_payment(order: Order, *, actor=None) -> list[int]:
    """Paid, but some CODE items could not get codes (stock sold out between checkout and capture).

    Items that 1Epin will buy now (active auto-buy mapping while trading is possible) are left to the
    supplier path; every other short item puts the order in MANUAL_REVIEW with a clear reason and one
    staff alert. Idempotent (a replayed capture/webhook never raises a second alert). Returns the
    item ids that need a person.
    """
    from catalog.models import FulfillmentType
    from commerce.services.inventory import assigned_code_count, move_fulfillment

    order = Order.objects.get(pk=order.pk)
    if order.payment_status not in {PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED}:
        return []
    if order.fulfillment_status in {FulfillmentStatus.COMPLETED, FulfillmentStatus.CANCELLED}:
        return []
    short = [
        item
        for item in order.items.select_related("product").order_by("id")
        if item.product.fulfillment_type == FulfillmentType.CODE and assigned_code_count(item) < item.quantity
    ]
    if not short:
        return []
    try:
        from suppliers.services.config import trading_enabled
        from suppliers.services.mapping import active_mapping_for_variant

        can_buy = trading_enabled()
        unhandled = [i for i in short if not (can_buy and active_mapping_for_variant(i.variant_id) is not None)]
    except Exception:  # noqa: BLE001 - supplier lookup problems mean a person must look
        logger.exception("Supplier lookup failed for order %s", order.order_number)
        unhandled = short
    if not unhandled:
        return []
    names = ", ".join(f"{i.product_name}" + (f" ({i.variant_name})" if i.variant_name else "") for i in unhandled)
    if order.fulfillment_status != FulfillmentStatus.MANUAL_REVIEW:
        move_fulfillment(order, FulfillmentStatus.MANUAL_REVIEW, actor=actor, reason=OUT_OF_STOCK_AFTER_PAYMENT)
    try:
        from suppliers.models import AlertKind, SupplierAlert
        from suppliers.provider import ensure_supplier
        from suppliers.services.alerts import raise_alert

        key = f"out_of_stock:{order.order_number}"
        if not SupplierAlert.objects.filter(dedupe_key=key).exists():
            from audit.models import AuditLog

            AuditLog.objects.create(
                actor=actor,
                action="orders.out_of_stock_after_payment",
                entity_type="Order",
                entity_id=str(order.pk),
                meta={
                    "order_number": order.order_number,
                    "item_ids": [i.id for i in unhandled],
                    "reason": OUT_OF_STOCK_AFTER_PAYMENT,
                },
            )
            raise_alert(
                ensure_supplier(),
                AlertKind.OUT_OF_STOCK,
                f"{order.order_number}: {OUT_OF_STOCK_AFTER_PAYMENT}. Sold out: {names}."[:500],
                dedupe_key=key,
                order_number=order.order_number,
                meta={"order_id": order.pk, "item_ids": [i.id for i in unhandled]},
            )
    except Exception:  # noqa: BLE001 - the alert is advisory; the order is already in manual review
        logger.exception("Could not raise the out-of-stock alert for order %s", order.order_number)
    logger.warning("Order %s paid but out of stock for item(s) %s", order.order_number, [i.id for i in unhandled])
    return [i.id for i in unhandled]


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
                code_identity=code_identity(demo_pin),
                ciphertext=ciphertext,
                nonce=nonce,
                masked=masked,
                delivered_at=now,
            )
