"""Digital-code stock and order delivery.

``allocate_codes`` assigns AVAILABLE inventory codes to paid CODE order items, and
``recompute_fulfillment`` derives the order fulfillment status from per-item delivery:

* every item delivered                      -> COMPLETED
* a CODE item is missing codes              -> MANUAL_REVIEW (partial assignments kept)
* otherwise (e.g. DIRECT_TOPUP not yet done) -> PROCESSING

Stock reservation (D2): when a PayPal order is created for a checkout, the order's CODE
quantities are held for ``RESERVATION_MINUTES`` (``Order.reserved_until``). Public
availability is AVAILABLE codes minus the quantities held by *other* open orders.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, Iterable

from django.db import transaction
from django.db.models import Count, Sum
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
from commerce.services.orders import PAID_UNREFUNDED, transition_order

logger = logging.getLogger("commerce")

RESERVATION_MINUTES = 30
PUBLIC_QUANTITY_CAP = 99
RESERVING_PAYMENT_STATUSES = [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED]


class InventoryError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = "fulfillment_error", extra: dict | None = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.extra = extra or {}


@dataclass
class AllocationResult:
    fulfillment_status: str
    assigned_code_ids: list[int] = field(default_factory=list)
    short_items: list[int] = field(default_factory=list)


# --- Availability ----------------------------------------------------------------------


def _ids(variant_ids: Iterable[int]) -> set[int]:
    return {int(v) for v in variant_ids if v}


def raw_available_code_counts(variant_ids: Iterable[int]) -> dict[int, int]:
    """AVAILABLE, unassigned codes per variant, ignoring reservations (missing variants -> 0)."""
    ids = _ids(variant_ids)
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


def reserved_code_counts(
    variant_ids: Iterable[int], *, exclude_order_id: int | None = None, now=None
) -> dict[int, int]:
    """Units held by open (PENDING/AUTHORIZED) orders whose PayPal order was created < 30 min ago."""
    ids = _ids(variant_ids)
    if not ids:
        return {}
    now = now or timezone.now()
    qs = OrderItem.objects.filter(
        variant_id__in=ids,
        product__fulfillment_type=FulfillmentType.CODE,
        order__payment_status__in=RESERVING_PAYMENT_STATUSES,
        order__reserved_until__gt=now,
    )
    if exclude_order_id:
        qs = qs.exclude(order_id=exclude_order_id)
    counts = {vid: 0 for vid in ids}
    for row in qs.values("variant_id").annotate(q=Sum("quantity")):
        counts[row["variant_id"]] = int(row["q"] or 0)
    return counts


def available_code_counts(variant_ids: Iterable[int], *, exclude_order_id: int | None = None) -> dict[int, int]:
    """Sellable codes per variant = AVAILABLE codes minus other orders' reservations (D2), >= 0.

    Signature-compatible with the original helper (``catalog.stock`` calls it with one arg).
    """
    ids = _ids(variant_ids)
    if not ids:
        return {}
    raw = raw_available_code_counts(ids)
    reserved = reserved_code_counts(ids, exclude_order_id=exclude_order_id)
    return {vid: max(raw.get(vid, 0) - reserved.get(vid, 0), 0) for vid in ids}


def available_quantity(variant_ids: Iterable[int]) -> dict[int, int]:
    """Public per-variant ``available_quantity``: max(0, available - reserved), capped at 99."""
    return {vid: min(count, PUBLIC_QUANTITY_CAP) for vid, count in available_code_counts(variant_ids).items()}


def available_quantity_for(variant_id: int) -> int:
    return available_quantity([variant_id]).get(int(variant_id), 0)


def supplier_backed_variant_ids(variant_ids: Iterable[int]) -> set[int]:
    """Variants a supplier can fulfil on demand (D18 rules live in catalog.stock when present)."""
    ids = _ids(variant_ids)
    if not ids:
        return set()
    try:
        from catalog.stock import active_mapping_variant_ids
    except ImportError:  # pragma: no cover - catalog.stock always exists
        active_mapping_variant_ids = None
    if active_mapping_variant_ids is not None:
        return set(active_mapping_variant_ids(ids))
    from suppliers.models import SupplierProductMapping

    return set(
        SupplierProductMapping.objects.filter(variant_id__in=ids, ignored=False, supplier__active=True)
        .values_list("variant_id", flat=True)
        .distinct()
    )


def stock_shortages(lines: list[dict[str, Any]], *, exclude_order_id: int | None = None) -> list[dict[str, Any]]:
    """Every CODE line whose quantity exceeds what can be sold (ST-07: all lines, with counts).

    ``lines`` items need ``product``, ``variant`` and ``qty``. Supplier-backed variants never fail.
    """
    requested: dict[int, int] = {}
    for line in lines:
        if line["product"].fulfillment_type != FulfillmentType.CODE:
            continue
        requested[line["variant"].id] = requested.get(line["variant"].id, 0) + int(line["qty"])
    if not requested:
        return []
    counts = available_code_counts(requested.keys(), exclude_order_id=exclude_order_id)
    short_ids = {vid for vid, qty in requested.items() if qty > counts.get(vid, 0)}
    if not short_ids:
        return []
    short_ids -= supplier_backed_variant_ids(short_ids)
    failures = []
    seen: set[int] = set()
    for line in lines:
        variant, product = line["variant"], line["product"]
        if variant.id not in short_ids or variant.id in seen:
            continue
        seen.add(variant.id)
        failures.append(
            {
                "product_id": product.id,
                "variant_id": variant.id,
                "product_name": product.name_en,
                "product_name_ar": product.name_ar or "",
                "variant_name": variant.name_en,
                "variant_name_ar": variant.name_ar or "",
                "requested": requested[variant.id],
                "available": min(counts.get(variant.id, 0), PUBLIC_QUANTITY_CAP),
            }
        )
    return failures


def shortage_message(failures: list[dict[str, Any]]) -> str:
    parts = []
    for item in failures:
        name = f"{item['product_name']} ({item['variant_name']})"
        if item["available"] <= 0:
            parts.append(f"{name} is out of stock")
        else:
            parts.append(f"only {item['available']} left of {name}")
    return "Not enough stock: " + "; ".join(parts) + "."


@transaction.atomic
def reserve_order_stock(order: Order) -> None:
    """Hold an open order's CODE quantities for RESERVATION_MINUTES (PayPal create-order)."""
    order = Order.objects.select_for_update().get(pk=order.pk)
    items = list(order.items.select_related("product", "variant"))
    lines = [{"product": i.product, "variant": i.variant, "qty": i.quantity} for i in items]
    from django.conf import settings

    # Demo checkout issues demo codes instead of inventory, so there is nothing to hold back.
    demo = bool(getattr(settings, "ALLOW_DEMO_AUTO_PAYMENT", False))
    failures = [] if demo else stock_shortages(lines, exclude_order_id=order.id)
    if failures:
        raise InventoryError(shortage_message(failures), status=409, code="out_of_stock", extra={"lines": failures})
    order.reserved_until = timezone.now() + timedelta(minutes=RESERVATION_MINUTES)
    order.save(update_fields=["reserved_until", "updated_at"])


# --- Existing-code lookup (D10) --------------------------------------------------------


def code_location(code: DigitalCode) -> str:
    """Human description of where a code already is, e.g. 'delivered on order ABC123'."""
    variant = code.variant
    label = ""
    if variant is not None:
        product = getattr(variant, "product", None)
        name = f"{product.name_en} – {variant.name_en}" if product is not None else variant.name_en
        label = f"{name} (SKU {variant.sku})"
    order_number = ""
    if code.order_item_id and code.order_item is not None:
        order_number = code.order_item.order.order_number
    if order_number:
        return f"already delivered on order {order_number}" + (f" · {label}" if label else "")
    if code.status == DigitalCodeStatus.UNAVAILABLE:
        return "already exists as a deactivated code" + (f" for {label}" if label else "")
    return "already in stock" + (f" for {label}" if label else "")


def find_existing_codes(identities: Iterable[str]) -> dict[str, DigitalCode]:
    ids = [i for i in set(identities) if i]
    found: dict[str, DigitalCode] = {}
    for start in range(0, len(ids), 2000):
        chunk = ids[start : start + 2000]
        for code in DigitalCode.objects.filter(code_identity__in=chunk).select_related(
            "variant", "variant__product", "order_item", "order_item__order"
        ):
            found.setdefault(code.code_identity, code)
    return found


def duplicate_code_message(code: str, pin: str | None = None) -> str | None:
    """'This code is already delivered on order X ...' or None when the code is new."""
    from commerce.crypto import code_identity, fingerprint_code

    identity = code_identity(code)
    existing = find_existing_codes([identity]).get(identity) if identity else None
    if existing is None:
        legacy = DigitalCode.objects.filter(code_fingerprint=fingerprint_code(code, pin)).select_related(
            "variant", "variant__product", "order_item", "order_item__order"
        ).first()
        existing = legacy
    if existing is None:
        return None
    return f"This code {code_location(existing)}."


# --- Delivery --------------------------------------------------------------------------


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


def move_fulfillment(order: Order, target: str, *, actor=None, reason: str = "") -> None:
    """Walk allowed transitions from the current status to ``target``."""
    current = order.fulfillment_status
    if current == target:
        return
    if target == FulfillmentStatus.CANCELLED:
        transition_order(order, fulfillment_status=target, actor=actor, reason=reason)
        return
    if current in {FulfillmentStatus.NOT_STARTED, FulfillmentStatus.FAILED}:
        transition_order(order, fulfillment_status=FulfillmentStatus.QUEUED, actor=actor, reason=reason)
        current = FulfillmentStatus.QUEUED
        if target == current:
            return
    if current == FulfillmentStatus.QUEUED:
        transition_order(order, fulfillment_status=FulfillmentStatus.PROCESSING, actor=actor, reason=reason)
        current = FulfillmentStatus.PROCESSING
    if current != target:
        transition_order(order, fulfillment_status=target, actor=actor, reason=reason)


_move_fulfillment = move_fulfillment  # back-compat


def _resolve_supplier_alerts(order: Order, delivered_ids: list[int], *, codes_complete: bool) -> None:
    """Delivered items close their open 1Epin alerts, whatever delivered them (never blocks)."""
    if not delivered_ids and not codes_complete:
        return
    try:
        from suppliers.services.alerts import resolve_delivered_item_alerts

        with transaction.atomic():
            resolve_delivered_item_alerts(order, delivered_ids, order_completed=codes_complete)
    except Exception:  # noqa: BLE001 - alerts are advisory
        logger.exception("Could not auto-resolve supplier alerts for order %s", order.order_number)


def supplier_busy_item_ids(items) -> set[int]:
    """Items with a 1Epin purchase in flight: own stock / staff codes must wait (never deliver twice)."""
    try:
        from suppliers.services.fulfillment import in_flight_item_ids

        return in_flight_item_ids([i.id for i in items])
    except Exception:  # noqa: BLE001 - supplier lookup must never block local delivery
        logger.exception("in-flight supplier lookup failed")
        return set()


def recompute_fulfillment(order: Order, *, actor=None) -> str:
    """Re-derive fulfillment status from item delivery. Must run inside a transaction."""
    order = Order.objects.select_for_update().get(pk=order.pk)
    if order.fulfillment_status in {FulfillmentStatus.COMPLETED, FulfillmentStatus.CANCELLED}:
        return order.fulfillment_status
    if order.payment_status not in PAID_UNREFUNDED:
        return order.fulfillment_status
    now = timezone.now()
    all_delivered = True
    code_short = False
    delivered_ids: list[int] = []
    items = list(order.items.select_related("product").order_by("id"))
    for item in items:
        if _item_type(item) == FulfillmentType.CODE:
            assigned = assigned_code_count(item)
            if assigned >= item.quantity:
                delivered_ids.append(item.id)
                if item.delivered_at is None:
                    item.delivered_at = now
                    item.save(update_fields=["delivered_at"])
            else:
                all_delivered = False
                code_short = True
        elif item.delivered_at is None:
            all_delivered = False
        else:
            delivered_ids.append(item.id)
    if not items:
        all_delivered = False
    _resolve_supplier_alerts(order, delivered_ids, codes_complete=not code_short and bool(items))
    if all_delivered:
        target = FulfillmentStatus.COMPLETED
    elif code_short:
        target = FulfillmentStatus.MANUAL_REVIEW
    else:
        target = FulfillmentStatus.PROCESSING
    move_fulfillment(order, target, actor=actor)
    return target


@transaction.atomic
def allocate_codes(order: Order, actor=None) -> AllocationResult:
    """Assign inventory codes to every CODE item of a paid order. Idempotent and concurrency-safe.

    Rows are claimed with ``SELECT ... FOR UPDATE SKIP LOCKED`` so two workers never hand out
    the same code; a worker that finds codes locked by another simply gets fewer rows and the
    order goes to MANUAL_REVIEW until the next run. Paid orders ignore reservations held by
    unpaid checkouts (money already received wins).
    """
    from commerce.notifications import queue_delivery_update
    from commerce.services.code_import import sync_variant_stock

    order = Order.objects.select_for_update().get(pk=order.pk)
    if order.payment_status not in PAID_UNREFUNDED:
        raise InventoryError(f"Order {order.order_number} is not paid", status=409, code="not_paid")
    if order.fulfillment_status == FulfillmentStatus.CANCELLED:
        raise InventoryError(f"Order {order.order_number} is cancelled", status=409, code="cancelled")

    now = timezone.now()
    assigned: list[int] = []
    short: list[int] = []
    touched_variants: set[int] = set()
    items = list(order.items.select_related("product").order_by("id"))
    try:
        from suppliers.services.fulfillment import prefer_supplier_item_ids

        supplier_first = prefer_supplier_item_ids(items)
    except Exception:  # noqa: BLE001 - supplier lookup must never block local delivery
        logger.exception("prefer_supplier lookup failed for order %s", order.order_number)
        supplier_first = set()
    supplier_busy = supplier_busy_item_ids(items)
    for item in items:
        if _item_type(item) != FulfillmentType.CODE:
            continue
        have = assigned_code_count(item)
        need = item.quantity - have
        if item.id in supplier_first or item.id in supplier_busy:
            # prefer_supplier: 1Epin delivers this item (own stock is the fallback); in flight: a
            # 1Epin purchase may still deliver these codes - wait for it instead of delivering twice.
            need = 0
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
        queue_delivery_update(order.id)
    if order.reserved_until is not None:
        Order.objects.filter(pk=order.pk).update(reserved_until=None)
    if short:
        logger.warning(
            "Order %s is short of codes for item(s) %s; manual review required", order.order_number, short
        )
    status = recompute_fulfillment(order, actor=actor)
    return AllocationResult(fulfillment_status=status, assigned_code_ids=assigned, short_items=short)


def deliver_waiting_orders(variant_ids: Iterable[int], *, actor=None) -> dict[str, Any]:
    """D3: after stock arrives, deliver PAID orders waiting in MANUAL_REVIEW (oldest first).

    Returns {"delivered": n, "partially_delivered": m, "order_numbers": [...]}; "delivered"
    counts orders whose code items are now complete.
    """
    ids = _ids(variant_ids)
    result: dict[str, Any] = {"delivered": 0, "partially_delivered": 0, "order_numbers": []}
    if not ids:
        return result
    order_ids = list(
        Order.objects.filter(
            payment_status__in=list(PAID_UNREFUNDED),
            fulfillment_status=FulfillmentStatus.MANUAL_REVIEW,
            items__variant_id__in=ids,
            items__product__fulfillment_type=FulfillmentType.CODE,
        )
        .order_by("created_at", "id")
        .values_list("id", flat=True)
        .distinct()
    )
    seen: set[int] = set()
    for order_id in order_ids:
        if order_id in seen:
            continue
        seen.add(order_id)
        if not any(raw_available_code_counts(ids).values()):
            break
        order = Order.objects.get(pk=order_id)
        try:
            with transaction.atomic():
                allocation = allocate_codes(order, actor=actor)
        except InventoryError as exc:
            logger.info("Waiting order %s not delivered: %s", order.order_number, exc.message)
            continue
        if not allocation.assigned_code_ids:
            continue
        if allocation.short_items:
            result["partially_delivered"] += 1
        else:
            result["delivered"] += 1
            result["order_numbers"].append(order.order_number)
    if result["delivered"] or result["partially_delivered"]:
        AuditLog.objects.create(
            actor=actor if getattr(actor, "is_authenticated", False) else None,
            action="orders.waiting_delivered",
            entity_type="ProductVariant",
            entity_id=",".join(str(v) for v in sorted(ids))[:64],
            meta={k: v for k, v in result.items()},
        )
    return result


def _locked_paid_item(order: Order, item_id: int) -> tuple[Order, OrderItem]:
    order = Order.objects.select_for_update().get(pk=order.pk)
    item = order.items.select_related("product", "variant").filter(pk=item_id).first()
    if item is None:
        raise InventoryError("Order item not found", status=404, code="not_found")
    if order.payment_status not in PAID_UNREFUNDED:
        raise InventoryError("Order is not paid", status=409, code="not_paid")
    if order.fulfillment_status == FulfillmentStatus.CANCELLED:
        raise InventoryError("Order is cancelled", status=409, code="cancelled")
    return order, item


def _assert_supplier_idle(item: OrderItem) -> None:
    if item.id in supplier_busy_item_ids([item]):
        from suppliers.services.fulfillment import IN_FLIGHT_ACTION_REASON

        raise InventoryError(IN_FLIGHT_ACTION_REASON, status=409, code="supplier_in_flight")


@transaction.atomic
def attach_manual_code(order: Order, item_id: int, *, code: str, pin: str | None = None, actor=None) -> DigitalCode:
    """Attach a staff-entered code to a CODE item (e.g. bought from a supplier by hand)."""
    from commerce.crypto import code_identity, encode_code_payload, encrypt_code, fingerprint_code, mask_code
    from commerce.models import DigitalCodeSource
    from commerce.notifications import queue_delivery_update
    from commerce.services.code_import import MAX_CODE_LEN, MAX_PIN_LEN

    order, item = _locked_paid_item(order, item_id)
    if _item_type(item) != FulfillmentType.CODE:
        raise InventoryError("Codes can only be attached to code items; mark top-ups delivered instead")
    _assert_supplier_idle(item)
    code = (code or "").strip()
    pin = (pin or "").strip() or None
    if not code:
        raise InventoryError("Code is required")
    if len(code) > MAX_CODE_LEN:
        raise InventoryError("Code exceeds maximum length")
    if pin and len(pin) > MAX_PIN_LEN:
        raise InventoryError("PIN exceeds maximum length")
    if assigned_code_count(item) >= item.quantity:
        raise InventoryError("This item already has all of its codes", status=409, code="item_complete")
    duplicate = duplicate_code_message(code, pin)
    if duplicate:
        raise InventoryError(duplicate, status=409, code="duplicate_code")
    fingerprint = fingerprint_code(code, pin)
    ciphertext, nonce, _ = encrypt_code(encode_code_payload(code, pin))
    obj = DigitalCode.objects.create(
        order_item=item,
        variant=item.variant,
        status=DigitalCodeStatus.DELIVERED,
        source=DigitalCodeSource.MANUAL,
        code_fingerprint=fingerprint,
        code_identity=code_identity(code),
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
    queue_delivery_update(order.id)
    return obj


@transaction.atomic
def mark_item_delivered(order: Order, item_id: int, *, note: str = "", actor=None) -> OrderItem:
    """Staff confirms a DIRECT_TOPUP item was delivered. Idempotent.

    ``note`` is CUSTOMER-VISIBLE: it is shown on the order page and in the top-up e-mail.
    """
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
