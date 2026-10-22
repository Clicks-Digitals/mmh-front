"""Digital-code stock and order delivery.

``allocate_codes`` assigns AVAILABLE inventory codes to paid CODE order items, and
``recompute_fulfillment`` derives the order fulfillment status from per-item delivery:

* every item delivered                      -> COMPLETED
* a CODE item is missing codes              -> MANUAL_REVIEW (partial assignments kept)
* otherwise (e.g. DIRECT_TOPUP not yet done) -> PROCESSING
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Iterable

from django.db import transaction
from django.db.models import Count
from django.utils import timezone

from audit.models import AuditLog
from catalog.models import FulfillmentType
from commerce.models import (
    DigitalCode,
    DigitalCodeStatus,
    FulfillmentStatus,
    Order,
    OrderItem,
    PaymentStatus,
)
from commerce.services.orders import transition_order

logger = logging.getLogger("commerce")


class InventoryError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


@dataclass
class AllocationResult:
    fulfillment_status: str
    assigned_code_ids: list[int] = field(default_factory=list)
    short_items: list[int] = field(default_factory=list)


def available_code_counts(variant_ids: Iterable[int]) -> dict[int, int]:
    """AVAILABLE, unassigned codes per variant (missing variants -> 0)."""
    ids = {int(v) for v in variant_ids if v}
    if not ids:
        return {}
    counts = {vid: 0 for vid in ids}
    rows = (
        DigitalCode.objects.filter(
            variant_id__in=ids, status=DigitalCodeStatus.AVAILABLE, order_item__isnull=True
        )
        .values("variant_id")
        .annotate(c=Count("id"))
    )
    for row in rows:
        counts[row["variant_id"]] = row["c"]
    return counts


def _item_type(item: OrderItem) -> str:
    return item.product.fulfillment_type


def assigned_code_count(item: OrderItem) -> int:
    return item.codes.exclude(status=DigitalCodeStatus.UNAVAILABLE).count()


def item_is_delivered(item: OrderItem, *, assigned: int | None = None) -> bool:
    if _item_type(item) == FulfillmentType.CODE:
        if assigned is None:
            assigned = assigned_code_count(item)
        return assigned >= item.quantity
    return item.delivered_at is not None


def _move_fulfillment(order: Order, target: str, *, actor=None) -> None:
    """Walk allowed transitions from the current status to ``target``."""
    current = order.fulfillment_status
    if current == target:
        return
    if current in {FulfillmentStatus.NOT_STARTED, FulfillmentStatus.FAILED}:
        transition_order(order, fulfillment_status=FulfillmentStatus.QUEUED, actor=actor)
        current = FulfillmentStatus.QUEUED
    if current == FulfillmentStatus.QUEUED:
        transition_order(order, fulfillment_status=FulfillmentStatus.PROCESSING, actor=actor)
        current = FulfillmentStatus.PROCESSING
    if current != target:
        transition_order(order, fulfillment_status=target, actor=actor)


def recompute_fulfillment(order: Order, *, actor=None) -> str:
    """Re-derive fulfillment status from item delivery. Must run inside a transaction."""
    order = Order.objects.select_for_update().get(pk=order.pk)
    if order.fulfillment_status in {FulfillmentStatus.COMPLETED, FulfillmentStatus.CANCELLED}:
        return order.fulfillment_status
    if order.payment_status != PaymentStatus.PAID:
        return order.fulfillment_status
    now = timezone.now()
    all_delivered = True
    code_short = False
    items = list(order.items.select_related("product").order_by("id"))
    for item in items:
        if _item_type(item) == FulfillmentType.CODE:
            assigned = assigned_code_count(item)
            if assigned >= item.quantity:
                if item.delivered_at is None:
                    item.delivered_at = now
                    item.save(update_fields=["delivered_at"])
            else:
                all_delivered = False
                code_short = True
        elif item.delivered_at is None:
            all_delivered = False
    if not items:
        all_delivered = False
    if all_delivered:
        target = FulfillmentStatus.COMPLETED
    elif code_short:
        target = FulfillmentStatus.MANUAL_REVIEW
    else:
        target = FulfillmentStatus.PROCESSING
    _move_fulfillment(order, target, actor=actor)
    return target


@transaction.atomic
def allocate_codes(order: Order, actor=None) -> AllocationResult:
    """Assign inventory codes to every CODE item of a paid order. Idempotent and concurrency-safe.

    Rows are claimed with ``SELECT ... FOR UPDATE SKIP LOCKED`` so two workers never hand out
    the same code; a worker that finds codes locked by another simply gets fewer rows and the
    order goes to MANUAL_REVIEW until the next run.
    """
    from commerce.notifications import queue_codes_delivered
    from commerce.services.code_import import sync_variant_stock

    order = Order.objects.select_for_update().get(pk=order.pk)
    if order.payment_status != PaymentStatus.PAID:
        raise InventoryError(f"Order {order.order_number} is not paid", status=409)
    if order.fulfillment_status == FulfillmentStatus.CANCELLED:
        raise InventoryError(f"Order {order.order_number} is cancelled", status=409)

    now = timezone.now()
    assigned: list[int] = []
    short: list[int] = []
    touched_variants: set[int] = set()
    items = list(order.items.select_related("product").order_by("id"))
    for item in items:
        if _item_type(item) != FulfillmentType.CODE:
            continue
        have = assigned_code_count(item)
        need = item.quantity - have
        if need > 0:
            claimed = list(
                DigitalCode.objects.select_for_update(skip_locked=True)
                .filter(
                    variant_id=item.variant_id,
                    status=DigitalCodeStatus.AVAILABLE,
                    order_item__isnull=True,
                )
                .order_by("id")
                .values_list("id", flat=True)[:need]
            )
            if claimed:
                DigitalCode.objects.filter(id__in=claimed).update(
                    order_item=item, status=DigitalCodeStatus.DELIVERED, delivered_at=now
                )
                assigned.extend(claimed)
                touched_variants.add(item.variant_id)
                have += len(claimed)
        if have < item.quantity:
            short.append(item.id)

    if assigned:
        AuditLog.objects.create(
            actor=actor,
            action="orders.codes_allocated",
            entity_type="Order",
            entity_id=str(order.id),
            meta={"order_number": order.order_number, "code_ids": assigned, "short_item_ids": short},
        )
        sync_variant_stock(touched_variants)
        queue_codes_delivered(order.id)
    if short:
        logger.warning(
            "Order %s is short of codes for item(s) %s; manual review required", order.order_number, short
        )
    status = recompute_fulfillment(order, actor=actor)
    return AllocationResult(fulfillment_status=status, assigned_code_ids=assigned, short_items=short)


def _locked_paid_item(order: Order, item_id: int) -> tuple[Order, OrderItem]:
    order = Order.objects.select_for_update().get(pk=order.pk)
    item = order.items.select_related("product", "variant").filter(pk=item_id).first()
    if item is None:
        raise InventoryError("Order item not found", status=404)
    if order.payment_status != PaymentStatus.PAID:
        raise InventoryError("Order is not paid", status=409)
    if order.fulfillment_status == FulfillmentStatus.CANCELLED:
        raise InventoryError("Order is cancelled", status=409)
    return order, item


@transaction.atomic
def attach_manual_code(order: Order, item_id: int, *, code: str, pin: str | None = None, actor=None) -> DigitalCode:
    """Attach a staff-entered code to a CODE item (e.g. bought from a supplier by hand)."""
    from commerce.crypto import encode_code_payload, encrypt_code, fingerprint_code, mask_code
    from commerce.models import DigitalCodeSource
    from commerce.notifications import queue_codes_delivered
    from commerce.services.code_import import MAX_CODE_LEN, MAX_PIN_LEN

    order, item = _locked_paid_item(order, item_id)
    if _item_type(item) != FulfillmentType.CODE:
        raise InventoryError("Codes can only be attached to code items; mark top-ups delivered instead")
    code = (code or "").strip()
    pin = (pin or "").strip() or None
    if not code:
        raise InventoryError("Code is required")
    if len(code) > MAX_CODE_LEN:
        raise InventoryError("Code exceeds maximum length")
    if pin and len(pin) > MAX_PIN_LEN:
        raise InventoryError("PIN exceeds maximum length")
    if assigned_code_count(item) >= item.quantity:
        raise InventoryError("This item already has all of its codes", status=409)
    fingerprint = fingerprint_code(code, pin)
    if DigitalCode.objects.filter(code_fingerprint=fingerprint).exists():
        raise InventoryError("This code already exists in inventory", status=409)
    ciphertext, nonce, _ = encrypt_code(encode_code_payload(code, pin))
    obj = DigitalCode.objects.create(
        order_item=item,
        variant=item.variant,
        status=DigitalCodeStatus.DELIVERED,
        source=DigitalCodeSource.MANUAL,
        code_fingerprint=fingerprint,
        imported_by=actor,
        ciphertext=ciphertext,
        nonce=nonce,
        masked=mask_code(code),
        delivered_at=timezone.now(),
    )
    AuditLog.objects.create(
        actor=actor,
        action="orders.code_attached",
        entity_type="Order",
        entity_id=str(order.id),
        meta={"order_number": order.order_number, "item_id": item.id, "code_id": obj.id, "masked": obj.masked},
    )
    recompute_fulfillment(order, actor=actor)
    if assigned_code_count(item) >= item.quantity:
        queue_codes_delivered(order.id)
    return obj


@transaction.atomic
def mark_item_delivered(order: Order, item_id: int, *, note: str = "", actor=None) -> OrderItem:
    """Staff confirms a DIRECT_TOPUP item was delivered. Idempotent."""
    from commerce.notifications import queue_topup_delivered

    order, item = _locked_paid_item(order, item_id)
    if _item_type(item) != FulfillmentType.DIRECT_TOPUP:
        raise InventoryError("Only direct top-up items can be marked delivered; attach codes instead")
    note = (note or "").strip()[:2000]
    if item.delivered_at is not None:
        if note and note != item.delivery_note:
            item.delivery_note = note
            item.save(update_fields=["delivery_note"])
        return item
    item.delivered_at = timezone.now()
    item.delivery_note = note
    item.save(update_fields=["delivered_at", "delivery_note"])
    AuditLog.objects.create(
        actor=actor,
        action="orders.item_delivered",
        entity_type="Order",
        entity_id=str(order.id),
        meta={"order_number": order.order_number, "item_id": item.id, "note": note[:500]},
    )
    recompute_fulfillment(order, actor=actor)
    queue_topup_delivered(order.id, item.id)
    return item
