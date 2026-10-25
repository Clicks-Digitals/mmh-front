"""1Epin purchasing for paid orders (D-1E-5 .. 7).

Flow per order item (one SupplierOrder per item per attempt, ``orderNumber`` =
``MMH-<order_number>-<item_id>-<attempt>``):

1. ``plan`` (DB transaction, order row locked): create the SupplierOrder row (NOT_SUBMITTED) or
   park it in MANUAL_REVIEW when a guard fails (catalog, type, player id, money guard). The row is
   committed BEFORE any network call so a crash can never lose track of a purchase.
2. ``submit``: addOrder. 00/07 -> placed + PROCESSING; network error -> UNKNOWN (reconciled with
   checkOrder later, never re-placed under a new number); 10 -> WAITING (retried after the
   service window); 04/02/03/06/09/11-17/... -> MANUAL_REVIEW with a readable reason + alert.
3. ``check``: checkOrder. 1 -> deliver (encrypted codes / top-up delivered), 0 -> keep waiting,
   2 -> FAILED (staff may retry = attempt + 1), 08 on an unplaced order -> safe re-submit with
   the SAME orderNumber.

Callbacks never apply their payload: they trigger ``sync_supplier_order`` which asks checkOrder.
Nothing here runs inside the payment transaction: ``schedule_supplier_fulfillment`` defers the
work to ``transaction.on_commit`` and swallows every error.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.db.models import Exists, F, Max, OuterRef
from django.utils import timezone

from audit.services import record_audit
from catalog.models import FulfillmentType
from commerce.models import DigitalCode, DigitalCodeSource, DigitalCodeStatus, FulfillmentStatus, Order, OrderItem
from commerce.services.orders import PAID_UNREFUNDED
from suppliers.models import (
    IN_FLIGHT_STATUSES,
    AlertKind,
    SupplierOrder,
    SupplierProductMapping,
    SupplierStatus,
)
from suppliers.provider import (
    OneEpinResult,
    SupplierError,
    get_supplier_provider,
    readable_order_status,
    sanitize_payload,
    to_decimal,
)
from suppliers.services.alerts import raise_alert, record_balance
from suppliers.services.config import current_environment, to_fils, trading_disabled_reason, trading_enabled
from suppliers.services.mapping import (
    TemplateError,
    active_mapping_for_variant,
    mapping_catalog_item,
    render_user,
)

logger = logging.getLogger("suppliers")

SERVICE_WINDOW_RETRY = timedelta(minutes=20)
MAX_RESUBMITS = 3
# Customer-visible (order page + e-mail): never name the supplier.
TOPUP_NOTE = "Your top-up has been added to your game account."
TOPUP_NOTE_AR = "تمت إضافة الشحن إلى حساب اللعبة الخاص بك."
COST_LIMIT_REASON = "1Epin cost above your limit"
LOSS_REASON = "1Epin cost above our sale price"
IN_FLIGHT_ACTION_REASON = "A 1Epin purchase is in progress — check it first"
# Supplier orders that need a person (the latest attempt of an item only).
NEEDS_REVIEW_STATUSES = (SupplierStatus.MANUAL_REVIEW, SupplierStatus.FAILED)


def topup_note(order: Order | None) -> str:
    return TOPUP_NOTE_AR if getattr(order, "locale", "en") == "ar" else TOPUP_NOTE


def _supplier_named(note: str) -> bool:
    return "1epin" in (note or "").lower()
CONFIG_CODES = {"02", "03"}


class SupplierActionError(Exception):
    def __init__(self, message: str, status: int = 409, code: str = "supplier_error"):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


# --- helpers -----------------------------------------------------------------------------


def supplier_order_number(order: Order, item: OrderItem, attempt: int) -> str:
    return f"MMH-{order.order_number}-{item.id}-{attempt}"


def _item_kind(item: OrderItem) -> str:
    return "topup" if item.product.fulfillment_type == FulfillmentType.DIRECT_TOPUP else "epin"


def _assigned(item: OrderItem) -> int:
    return item.codes.exclude(status=DigitalCodeStatus.UNAVAILABLE).count()


def latest_supplier_order(item_id: int) -> SupplierOrder | None:
    return SupplierOrder.objects.filter(order_item_id=item_id).order_by("-attempt", "-id").first()


def in_flight_item_ids(item_ids) -> set[int]:
    """Items whose latest supplier attempt may still be bought / delivered by 1Epin right now."""
    ids = [int(i) for i in item_ids if i]
    if not ids:
        return set()
    out: set[int] = set()
    seen: set[int] = set()
    for so in SupplierOrder.objects.filter(order_item_id__in=ids).order_by("order_item_id", "-attempt", "-id"):
        if so.order_item_id in seen:
            continue
        seen.add(so.order_item_id)
        if so.status in IN_FLIGHT_STATUSES:
            out.add(so.order_item_id)
    return out


def needs_review_supplier_orders():
    """Latest attempts in MANUAL_REVIEW/FAILED of paid orders that still need action, for items that
    are not delivered yet. Shared by the dashboard count and the 1Epin orders ``needs_review`` filter."""
    later = SupplierOrder.objects.filter(order_item_id=OuterRef("order_item_id"), attempt__gt=OuterRef("attempt"))
    undelivered = OrderItem.objects.filter(pk=OuterRef("order_item_id"), delivered_at__isnull=True)
    return (
        SupplierOrder.objects.filter(status__in=list(NEEDS_REVIEW_STATUSES), order__isnull=False)
        .filter(order__payment_status__in=list(PAID_UNREFUNDED))
        .exclude(order__fulfillment_status__in=[FulfillmentStatus.COMPLETED, FulfillmentStatus.CANCELLED])
        .filter(~Exists(later), Exists(undelivered))
    )


def needs_review_order_count() -> int:
    """Number of ORDERS (distinct) with a 1Epin purchase waiting for a person."""
    return needs_review_supplier_orders().values("order_id").distinct().count()


def is_unresolved_placed(so: SupplierOrder) -> bool:
    """1Epin accepted the order and has not told us it failed: it may still deliver (never re-buy)."""
    return so.placed and so.status != SupplierStatus.COMPLETED and so.order_status_code != 2


# addOrder/checkOrder answers that prove 1Epin did not (and will not) charge this orderNumber.
REFUSAL_CODES = {"01", "02", "03", "04", "05", "06", "08", "09", "11", "12", "13", "14", "15", "16", "17", "MODE"}


def definitively_failed(so: SupplierOrder) -> bool:
    """No purchase is (or will be) charged for this attempt: a new attempt is safe."""
    if so.status in IN_FLIGHT_STATUSES or so.status == SupplierStatus.COMPLETED:
        return False
    if so.order_status_code == 2:
        return True
    if so.placed:
        return False
    if so.submit_count == 0:
        return True  # never sent (guard)
    return so.result_code in REFUSAL_CODES


def _save(so: SupplierOrder, **fields) -> SupplierOrder:
    for key, value in fields.items():
        setattr(so, key, value)
    so.save(update_fields=list(fields) + ["updated_at"])
    return so


def _audit(actor, action: str, so: SupplierOrder, **extra) -> None:
    record_audit(
        actor,
        action,
        entity_type="SupplierOrder",
        entity_id=so.pk,
        meta={
            "order_number": so.order.order_number if so.order_id else "",
            "item_id": so.order_item_id,
            "supplier_order_number": so.supplier_ref,
            "external_product_id": so.external_product_id,
            "quantity": so.quantity,
            "status": so.status,
            "result_code": so.result_code,
            "cost": f"{so.cost}" if so.cost is not None else None,
            "cost_fils": so.cost_fils,
            "environment": so.environment,
            **extra,
        },
    )


def _alert_for(so: SupplierOrder, kind: str, message: str, *, dedupe_key: str = "") -> None:
    raise_alert(
        so.supplier,
        kind,
        message,
        dedupe_key=dedupe_key or f"{kind}:{so.supplier_ref}",
        supplier_order=so,
        meta={"supplier_order_number": so.supplier_ref, "item_id": so.order_item_id},
    )


# --- order status -------------------------------------------------------------------------


def refresh_order_status(order_id: int, *, actor=None) -> str | None:
    """Re-derive fulfillment status: COMPLETED when all delivered, PROCESSING while 1Epin is still
    working (or top-ups wait for staff), MANUAL_REVIEW when an item needs a person."""
    from commerce.services.inventory import move_fulfillment, recompute_fulfillment

    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order_id)
        if order.payment_status not in PAID_UNREFUNDED or order.fulfillment_status in {
            FulfillmentStatus.CANCELLED,
            FulfillmentStatus.COMPLETED,
        }:
            return order.fulfillment_status
        target = recompute_fulfillment(order, actor=actor)
        if target == FulfillmentStatus.COMPLETED:
            return target
        needs_staff = False
        for item in order.items.select_related("product").order_by("id"):
            kind = _item_kind(item)
            delivered = _assigned(item) >= item.quantity if kind == "epin" else item.delivered_at is not None
            if delivered:
                continue
            latest = latest_supplier_order(item.id)
            if latest is not None and (latest.status in IN_FLIGHT_STATUSES or is_unresolved_placed(latest)) and latest.status != SupplierStatus.MANUAL_REVIEW:
                continue
            if kind == "epin":
                needs_staff = True
            elif latest is not None and latest.status in {SupplierStatus.MANUAL_REVIEW, SupplierStatus.FAILED}:
                needs_staff = True
        desired = FulfillmentStatus.MANUAL_REVIEW if needs_staff else FulfillmentStatus.PROCESSING
        order.refresh_from_db()
        if order.fulfillment_status != desired:
            move_fulfillment(order, desired, actor=actor, reason="1Epin supplier status")
        return desired


# --- prefer_supplier (used by inventory.allocate_codes) ------------------------------------


def prefer_supplier_item_ids(items) -> set[int]:
    """CODE items that should be bought from 1Epin instead of using own stock (mapping.prefer_supplier).

    Only while trading is possible and no earlier supplier attempt for the item failed.
    """
    if not trading_enabled():
        return set()
    out: set[int] = set()
    for item in items:
        if item.product.fulfillment_type != FulfillmentType.CODE:
            continue
        mapping = active_mapping_for_variant(item.variant_id)
        if mapping is None or not mapping.prefer_supplier:
            continue
        latest = latest_supplier_order(item.id)
        if latest is not None and latest.status in {SupplierStatus.FAILED, SupplierStatus.MANUAL_REVIEW}:
            continue
        out.add(item.id)
    return out


# --- planning --------------------------------------------------------------------------------


def _plan_item(
    order: Order,
    item: OrderItem,
    mapping: SupplierProductMapping,
    *,
    actor=None,
    override_money_guard: bool = False,
) -> SupplierOrder | None:
    """Create the next SupplierOrder for an item (caller holds the order lock). None = nothing to buy."""
    kind = _item_kind(item)
    if kind == "epin":
        units = item.quantity - _assigned(item)
    else:
        units = 0 if item.delivered_at else item.quantity
    if units <= 0:
        return None
    supplier = mapping.supplier
    env = current_environment()
    attempt = (SupplierOrder.objects.filter(order_item_id=item.id).aggregate(m=Max("attempt"))["m"] or 0) + 1
    qpu = max(int(mapping.quantity_per_unit or 1), 1)
    catalog_item = mapping_catalog_item(mapping, env)
    quantity = units * qpu
    unit_price = Decimal(catalog_item.price) if catalog_item is not None else None
    cost = unit_price * quantity if unit_price is not None else None
    so = SupplierOrder(
        supplier=supplier,
        order=order,
        order_item_id=item.id,
        attempt=attempt,
        supplier_ref=supplier_order_number(order, item, attempt),
        environment=env,
        mapping=mapping,
        catalog_item=catalog_item,
        external_product_id=str(mapping.external_product_id),
        product_name=(catalog_item.product_name if catalog_item else mapping.external_name)[:255],
        kind=kind,
        quantity=quantity,
        units=units,
        status=SupplierStatus.NOT_SUBMITTED,
        unit_price=unit_price,
        cost=cost,
        currency=catalog_item.currency if catalog_item else "",
        cost_fils=to_fils(cost),
        created_by=actor if getattr(actor, "is_authenticated", False) else None,
    )
    reason = ""
    if catalog_item is None or not catalog_item.active:
        reason = "Not in the synced 1Epin catalog for this mode (sync the catalog or fix the mapping)"
    elif catalog_item.category_type not in {"epin", "topup"}:
        reason = f"Unsupported 1Epin product type {catalog_item.category_type or '?'!r}"
    elif catalog_item.category_type != kind:
        reason = (
            "1Epin product is a top-up but this item expects codes"
            if kind == "epin"
            else "1Epin product is an e-pin but this item is a direct top-up"
        )
    elif kind == "topup" and quantity != 1:
        reason = "Top-up quantity above 1 must be handled manually"
    elif catalog_item.is_tiered and mapping.barem is None:
        reason = "Tiered 1Epin product needs a barem on the mapping"
    if not reason and kind == "topup":
        try:
            so.player_user = render_user(mapping.user_template, item.customer_fields, item.field_details)
        except TemplateError as exc:
            reason = f"Player id missing: {exc}"
    if not reason and not override_money_guard and so.cost_fils is not None:
        unit_cost_fils = to_fils(unit_price * qpu)
        sale_fils = item.unit_price_fils * units
        if mapping.max_cost_fils is not None and unit_cost_fils > mapping.max_cost_fils:
            reason = COST_LIMIT_REASON
        elif so.cost_fils > sale_fils and not mapping.allow_loss:
            reason = LOSS_REASON
    so.request_payload = {
        "product": so.external_product_id,
        "quantity": so.quantity,
        "orderNumber": so.supplier_ref,
        **({"user": so.player_user} if so.player_user else {}),
        **({"barem": f"{mapping.barem}"} if mapping.barem is not None else {}),
    }
    if reason:
        so.status = SupplierStatus.MANUAL_REVIEW
        so.message = reason[:500]
    so.save()
    if reason:
        if reason in {COST_LIMIT_REASON, LOSS_REASON}:
            limit = (
                f" (limit {Decimal(mapping.max_cost_fils) / 1000:.3f} JOD)" if mapping.max_cost_fils is not None else ""
            )
            cost = f"{Decimal(so.cost_fils) / 1000:.3f} JOD" if so.cost_fils is not None else "?"
            _alert_for(
                so,
                AlertKind.COST_LIMIT,
                f"{order.order_number}: {reason} - 1Epin cost {cost}{limit}. Not bought automatically: "
                "use 'Buy from 1Epin now' to buy anyway, or deliver another way.",
            )
        else:
            _alert_for(so, AlertKind.ORDER_FAILED, f"{order.order_number}: {reason}")
        _audit(actor, "suppliers.order_skipped", so, reason=reason[:300])
    return so


def plan_supplier_orders(order_id: int, *, actor=None) -> list[int]:
    """Create SupplierOrders for every eligible item without one (auto path). Returns ids to submit."""
    return _plan_supplier_orders(order_id, actor=actor)[0]


def _plan_supplier_orders(order_id: int, *, actor=None) -> tuple[list[int], int]:
    """(ids to submit, number of items parked in MANUAL_REVIEW by a guard)."""
    to_submit: list[int] = []
    parked = 0
    with transaction.atomic():
        order = Order.objects.select_for_update().filter(pk=order_id).first()
        if order is None or order.payment_status not in PAID_UNREFUNDED:
            return [], 0
        if order.fulfillment_status in {FulfillmentStatus.CANCELLED, FulfillmentStatus.COMPLETED}:
            return [], 0
        for item in order.items.select_related("product", "variant").order_by("id"):
            if SupplierOrder.objects.filter(order_item_id=item.id).exists():
                continue  # the auto path never buys twice; staff use retry / buy now
            mapping = active_mapping_for_variant(item.variant_id, require_auto_buy=True)
            if mapping is None:
                continue
            so = _plan_item(order, item, mapping, actor=actor)
            if so is not None and so.status == SupplierStatus.NOT_SUBMITTED:
                to_submit.append(so.id)
            elif so is not None:
                parked += 1
    return to_submit, parked


# --- submit / check ------------------------------------------------------------------------


def _provider_for(so: SupplierOrder):
    provider = get_supplier_provider()
    if provider.environment != so.environment:
        raise SupplierError(
            f"Supplier mode changed (order placed in {so.environment}, now {provider.environment}); check it on 1Epin"
        )
    return provider


def submit_supplier_order(so_id: int, *, actor=None, from_statuses=(SupplierStatus.NOT_SUBMITTED, SupplierStatus.WAITING)) -> SupplierOrder:
    """addOrder for a planned SupplierOrder. Claims the row first so two workers never both submit."""
    now = timezone.now()
    claimed = SupplierOrder.objects.filter(pk=so_id, status__in=list(from_statuses)).update(
        status=SupplierStatus.SUBMITTING, submit_count=F("submit_count") + 1, submitted_at=now, updated_at=now
    )
    so = SupplierOrder.objects.select_related("supplier", "supplier__connection", "order", "mapping").get(pk=so_id)
    if not claimed:
        return so
    try:
        provider = _provider_for(so)
    except SupplierError as exc:
        _save(so, status=SupplierStatus.MANUAL_REVIEW, result_code="MODE", message=str(exc)[:500])
        _alert_for(so, AlertKind.CONFIG, str(exc))
        return so
    barem = so.mapping.barem if so.mapping_id else None
    res = provider.client.add_order(
        product=so.external_product_id,
        order_number=so.supplier_ref,
        quantity=so.quantity,
        user=so.player_user or None,
        barem=barem,
    )
    _apply_add_result(so, res, actor=actor)
    return so


def _apply_add_result(so: SupplierOrder, res: OneEpinResult, *, actor=None) -> None:
    supplier = so.supplier
    response = sanitize_payload(res.data) if res.data else {"network_error": res.network_error}
    base = {"result_code": res.code, "response_payload": {"addOrder": response}}
    if res.network_error:
        _save(
            so,
            status=SupplierStatus.UNKNOWN,
            message=f"{res.readable} - will confirm with checkOrder"[:500],
            **base,
        )
        _audit(actor, "suppliers.order_unknown", so)
        return
    code = res.code
    if code in {"00", "07"}:
        balance = to_decimal(res.data.get("Balance"))
        fields = dict(
            status=SupplierStatus.PROCESSING,
            placed=True,
            message=("Order placed at 1Epin" if code == "00" else "1Epin already has this order number - checking it")[:500],
            **base,
        )
        if balance is not None:
            fields["balance_after"] = balance
        _save(so, **fields)
        record_balance(supplier, balance)
        _audit(actor, "suppliers.order_placed", so)
        return
    if code == "10":
        _save(so, status=SupplierStatus.WAITING, retry_after=timezone.now() + SERVICE_WINDOW_RETRY, message=res.readable, **base)
        _audit(actor, "suppliers.order_deferred", so)
        return
    # Definitive refusal: nothing was bought.
    _save(so, status=SupplierStatus.MANUAL_REVIEW, message=res.readable, **base)
    order_number = so.order.order_number if so.order_id else ""
    if code == "04":
        raise_alert(
            supplier,
            AlertKind.LOW_BALANCE,
            f"1Epin refused order {so.supplier_ref}: not enough balance. Top up the 1Epin wallet, then use 'Buy from supplier'.",
            dedupe_key="low_balance",
            supplier_order=so,
        )
    elif code in CONFIG_CODES:
        raise_alert(supplier, AlertKind.CONFIG, res.readable, dedupe_key=f"config:{code}", supplier_order=so)
    else:
        if code == "12" and so.catalog_item_id:
            so.catalog_item.__class__.objects.filter(pk=so.catalog_item_id).update(is_tiered=True)
        _alert_for(so, AlertKind.ORDER_FAILED, f"{order_number}: {res.readable}")
    _audit(actor, "suppliers.order_refused", so)
    refresh_order_status(so.order_id) if so.order_id else None


def check_supplier_order(so: SupplierOrder, *, actor=None) -> str:
    """checkOrder + apply. Returns 'completed' | 'processing' | 'failed' | 'not_found' | 'error'."""
    try:
        provider = _provider_for(so)
    except SupplierError as exc:
        _save(so, message=str(exc)[:500])
        return "error"
    res = provider.client.check_order(so.supplier_ref)
    so.refresh_from_db()
    previous_status, previous_code = so.status, so.order_status_code
    now = timezone.now()
    so.check_count += 1
    so.last_checked_at = now
    so.save(update_fields=["check_count", "last_checked_at", "updated_at"])
    if res.network_error:
        if so.status == SupplierStatus.SUBMITTING:
            _save(so, status=SupplierStatus.UNKNOWN)
        _save(so, message=f"{res.readable} - will retry"[:500])
        return "error"
    if res.code == "08":
        if not so.placed:
            _save(so, result_code="08")
            return "not_found"
        already = previous_status == SupplierStatus.MANUAL_REVIEW and so.result_code == "08"
        _save(so, status=SupplierStatus.MANUAL_REVIEW, result_code="08", message="1Epin cannot find this order")
        if not already:
            _alert_for(so, AlertKind.ORDER_FAILED, f"1Epin cannot find order {so.supplier_ref}")
        refresh_order_status(so.order_id)
        return "failed"
    if res.code != "00":
        if res.code in CONFIG_CODES:
            raise_alert(so.supplier, AlertKind.CONFIG, res.readable, dedupe_key=f"config:{res.code}", supplier_order=so)
        _save(so, message=res.readable)
        return "error"
    data = res.data
    try:
        status_code = int(data.get("OrderStatusCode"))
    except (TypeError, ValueError):
        status_code = None
    amount = to_decimal(data.get("OrderAmount"))
    payload = dict(so.response_payload or {})
    payload["checkOrder"] = sanitize_payload(data)
    fields = {"placed": True, "order_status_code": status_code, "response_payload": payload}
    if amount is not None and amount > 0:
        fields["cost"] = amount
        fields["cost_fils"] = to_fils(amount)
    _save(so, **fields)
    if status_code == 1:
        pins = data.get("PinCodes") or []
        pins = [str(p).strip() for p in pins if str(p or "").strip()] if isinstance(pins, list) else []
        apply_completed(so.pk, pins, actor=actor)
        return "completed"
    if status_code == 2:
        raw = str(data.get("OrderStatusMessage") or "failed")[:200]
        reason = readable_order_status(raw)
        # "Check now" on an order that already failed: nothing new, so no new alert occurrence.
        already = previous_status == SupplierStatus.FAILED and previous_code == 2
        _save(so, status=SupplierStatus.FAILED, message=f"1Epin order failed: {reason}"[:500])
        if not already:
            _alert_for(so, AlertKind.ORDER_FAILED, f"1Epin order {so.supplier_ref} failed: {reason}")
            _audit(actor, "suppliers.order_failed", so, raw_reason=raw)
        refresh_order_status(so.order_id)
        return "failed"
    message = str(data.get("OrderStatusMessage") or "Processing")[:200]
    if so.status != SupplierStatus.MANUAL_REVIEW:
        _save(so, status=SupplierStatus.PROCESSING, message=f"1Epin: {message}"[:500])
        refresh_order_status(so.order_id)
    return "processing"


def sync_supplier_order(so: SupplierOrder, *, actor=None) -> str:
    """Bring one SupplierOrder up to date (callback, reconcile, staff "Check now").

    Returns 'completed' | 'processing' | 'failed' | 'not_found' | 'waiting' | 'disabled' |
    'error' | 'manual_review' | <lower-case status>.
    """
    so = SupplierOrder.objects.select_related("supplier", "supplier__connection", "order", "mapping").get(pk=so.pk)
    if so.status == SupplierStatus.COMPLETED:
        return "completed"
    if not so.placed and so.status in {SupplierStatus.FAILED, SupplierStatus.MANUAL_REVIEW} and definitively_failed(so):
        return "manual_review"  # 1Epin never accepted it: nothing to check
    if so.status == SupplierStatus.NOT_SUBMITTED or (so.status == SupplierStatus.WAITING and not so.placed):
        if so.status == SupplierStatus.WAITING and so.retry_after and so.retry_after > timezone.now():
            return "waiting"
        if not trading_enabled():
            return "disabled"
        so = submit_supplier_order(so.pk, actor=actor)
        if not so.placed:
            return so.status.lower()
    result = check_supplier_order(so, actor=actor)
    if result != "not_found":
        return result
    so.refresh_from_db()
    if so.status not in {SupplierStatus.UNKNOWN, SupplierStatus.SUBMITTING}:
        # e.g. a stuck order already in manual review: tell staff, never re-buy on our own.
        _save(so, message="1Epin has no order with this number: nothing was charged. Use 'Retry with supplier'.")
        return "not_found"
    # Never accepted by 1Epin: safe to send the SAME orderNumber again (07 protects us).
    if so.submit_count >= MAX_RESUBMITS:
        _save(so, status=SupplierStatus.MANUAL_REVIEW, message="1Epin never registered this order after several tries")
        _alert_for(so, AlertKind.ORDER_FAILED, f"1Epin never registered order {so.supplier_ref}")
        refresh_order_status(so.order_id)
        return "failed"
    if not trading_enabled():
        return "disabled"
    so = submit_supplier_order(so.pk, actor=actor, from_statuses=(SupplierStatus.UNKNOWN, SupplierStatus.SUBMITTING))
    if so.placed:
        return check_supplier_order(so, actor=actor)
    return so.status.lower()


# --- completion ------------------------------------------------------------------------------


def _existing_identity(identities: list[str]) -> bool:
    ids = [i for i in identities if i]
    return bool(ids) and DigitalCode.objects.filter(code_identity__in=ids).exists()


def apply_completed(so_id: int, pins: list[str], *, actor=None) -> SupplierOrder:
    """Deliver a completed 1Epin order. Idempotent (a COMPLETED order is never applied twice)."""
    from commerce.crypto import code_identity, encode_code_payload, encrypt_code, fingerprint_code, mask_code
    from commerce.notifications import queue_delivery_update, queue_topup_delivered
    from commerce.services.code_import import sync_variant_stock

    delivered_codes = 0
    extra_codes = 0
    duplicates: list[str] = []
    with transaction.atomic():
        so = SupplierOrder.objects.select_for_update(of=("self",)).select_related("supplier", "order", "mapping").get(pk=so_id)
        if so.status == SupplierStatus.COMPLETED:
            return so
        order = Order.objects.select_for_update().get(pk=so.order_id) if so.order_id else None
        item = OrderItem.objects.select_related("product", "variant").filter(pk=so.order_item_id).first()
        now = timezone.now()
        if item is None or order is None:
            _save(so, status=SupplierStatus.MANUAL_REVIEW, message="Order item no longer exists", pins_received=len(pins))
            return so
        if so.kind == "topup":
            if item.delivered_at is None:
                item.delivered_at = now
                if not item.delivery_note or _supplier_named(item.delivery_note):
                    item.delivery_note = topup_note(order)
                item.save(update_fields=["delivered_at", "delivery_note"])
                queue_topup_delivered(order.id, item.id)
            _save(so, status=SupplierStatus.COMPLETED, completed_at=now, message="Top-up delivered by 1Epin")
            _audit(actor, "suppliers.order_completed", so)
        else:
            qpu = max(int(so.mapping.quantity_per_unit if so.mapping_id else 1), 1)
            groups = [pins[i : i + qpu] for i in range(0, len(pins), qpu)]
            needed = max(item.quantity - _assigned(item), 0)
            for group in groups:
                text = " | ".join(group)
                identities = [code_identity(p) for p in group] + ([code_identity(text)] if len(group) > 1 else [])
                fingerprint = fingerprint_code(text)
                if _existing_identity(identities) or DigitalCode.objects.filter(code_fingerprint=fingerprint).exists():
                    duplicates.append(mask_code(text))
                    continue
                ciphertext, nonce, _ = encrypt_code(encode_code_payload(text, None))
                partial = len(group) < qpu
                attach = not partial and delivered_codes < needed
                DigitalCode.objects.create(
                    order_item=item if attach else None,
                    variant=item.variant,
                    status=(
                        DigitalCodeStatus.DELIVERED
                        if attach
                        else (DigitalCodeStatus.UNAVAILABLE if partial else DigitalCodeStatus.AVAILABLE)
                    ),
                    source=DigitalCodeSource.ONEEPIN,
                    code_fingerprint=fingerprint,
                    code_identity=code_identity(text),
                    ciphertext=ciphertext,
                    nonce=nonce,
                    masked=mask_code(text),
                    delivered_at=now if attach else None,
                )
                if attach:
                    delivered_codes += 1
                elif not partial:
                    extra_codes += 1
            expected = so.units
            problems: list[str] = []
            if duplicates:
                problems.append(f"{len(duplicates)} code(s) from 1Epin already exist in our system")
            if len(pins) < so.quantity:
                problems.append(f"1Epin returned {len(pins)} of {so.quantity} PIN(s)")
            status = SupplierStatus.MANUAL_REVIEW if problems else SupplierStatus.COMPLETED
            message = "; ".join(problems) or f"{delivered_codes} code(s) delivered from 1Epin"
            if extra_codes:
                message += f"; {extra_codes} extra code(s) added to stock"
            _save(
                so,
                status=status,
                completed_at=now,
                pins_received=len(pins),
                codes_delivered=delivered_codes,
                message=message[:500],
            )
            if duplicates:
                raise_alert(
                    so.supplier,
                    AlertKind.DUPLICATE_CODE,
                    f"1Epin order {so.supplier_ref} returned code(s) that already exist: {', '.join(duplicates[:5])}. Not delivered twice.",
                    dedupe_key=f"duplicate:{so.supplier_ref}",
                    supplier_order=so,
                    meta={"masked": duplicates[:20]},
                )
            elif problems:
                _alert_for(so, AlertKind.ORDER_FAILED, f"{order.order_number}: {message}")
            _audit(actor, "suppliers.order_completed", so, codes_delivered=delivered_codes, extra_codes=extra_codes, duplicates=len(duplicates))
            if delivered_codes:
                queue_delivery_update(order.id)
            if extra_codes:
                sync_variant_stock({item.variant_id})
    refresh_order_status(so.order_id, actor=actor)
    so.refresh_from_db()
    return so


# --- entry points ---------------------------------------------------------------------------


def fulfill_from_supplier(order_id: int, *, actor=None, check: bool = True) -> list[SupplierOrder]:
    """Plan + place supplier orders for a paid order, then one immediate checkOrder each."""
    if not trading_enabled():
        return []
    ids, parked = _plan_supplier_orders(order_id, actor=actor)
    results: list[SupplierOrder] = []
    for so_id in ids:
        so = submit_supplier_order(so_id, actor=actor)
        if check and so.placed:
            check_supplier_order(so, actor=actor)
            so.refresh_from_db()
        results.append(so)
    if ids or parked:
        # A guard (e.g. the cost limit) parked an item: the order must show "Needs review", never
        # stay in "Processing" waiting for a purchase that will not happen.
        refresh_order_status(order_id, actor=actor)
    return results


def run_supplier_fulfillment_safely(order_id: int) -> None:
    if not getattr(settings, "ONEEPIN_INLINE_FULFILLMENT", True):
        return
    try:
        fulfill_from_supplier(order_id)
    except Exception:  # noqa: BLE001 - the paid order is safe; reconcile picks it up later
        logger.exception("1Epin fulfillment failed for order id %s (reconcile will retry)", order_id)


def schedule_supplier_fulfillment(order_id: int) -> None:
    """Called inside the payment transaction: runs after COMMIT, never inside it."""
    if not trading_enabled():
        return
    transaction.on_commit(lambda: run_supplier_fulfillment_safely(order_id))


# --- staff actions ----------------------------------------------------------------------------


def _staff_item(order: Order, item_id: int) -> OrderItem:
    item = order.items.select_related("product", "variant").filter(pk=item_id).first()
    if item is None:
        raise SupplierActionError("Order item not found", status=404, code="not_found")
    return item


def item_supplier_mapping(item: OrderItem) -> SupplierProductMapping | None:
    return active_mapping_for_variant(item.variant_id, require_auto_buy=False)


def staff_check(order: Order, item_id: int, *, actor) -> SupplierOrder:
    _staff_item(order, item_id)
    so = latest_supplier_order(item_id)
    if so is None:
        raise SupplierActionError("This item has no supplier order yet", code="no_supplier_order")
    try:
        result = sync_supplier_order(so, actor=actor)
    except SupplierError as exc:
        raise SupplierActionError(str(exc), status=409, code="supplier_disabled") from exc
    so.refresh_from_db()
    _audit(actor, "suppliers.order_checked", so, result=result)
    return so


def staff_purchase(order: Order, item_id: int, *, actor, mode: str) -> SupplierOrder:
    """``mode``: ``retry`` (after a definitive failure) or ``buy_now`` (manual review; money guard
    overridden because staff confirmed the cost)."""
    if not trading_enabled():
        raise SupplierActionError(
            trading_disabled_reason() or "Supplier purchasing is disabled", code="supplier_disabled"
        )
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order.pk)
        if order.payment_status not in PAID_UNREFUNDED:
            raise SupplierActionError("Only paid orders can be bought from the supplier", code="not_paid")
        if order.fulfillment_status == FulfillmentStatus.CANCELLED:
            raise SupplierActionError("Order is cancelled", code="cancelled")
        item = _staff_item(order, item_id)
        mapping = item_supplier_mapping(item)
        if mapping is None:
            raise SupplierActionError("This product option is not mapped to a 1Epin product", code="not_mapped")
        latest = latest_supplier_order(item.id)
        if latest is not None and not definitively_failed(latest):
            if latest.status == SupplierStatus.COMPLETED:
                raise SupplierActionError("The supplier already delivered this item", code="already_completed")
            raise SupplierActionError(
                "A supplier order for this item may still be charged/delivered; use 'Check now' first",
                code="supplier_order_active",
            )
        if mode == "retry" and latest is None:
            raise SupplierActionError("Nothing to retry: use 'Buy from supplier' instead", code="no_supplier_order")
        so = _plan_item(order, item, mapping, actor=actor, override_money_guard=(mode == "buy_now"))
        if so is None:
            raise SupplierActionError("This item is already delivered", code="item_complete")
        _audit(actor, f"suppliers.staff_{mode}", so)
    if so.status != SupplierStatus.NOT_SUBMITTED:
        raise SupplierActionError(so.message or "The supplier order could not be placed", code="guard_failed")
    so = submit_supplier_order(so.pk, actor=actor)
    if so.placed:
        check_supplier_order(so, actor=actor)
        so.refresh_from_db()
    refresh_order_status(order.pk, actor=actor)
    return so


def buy_now_quote(item: OrderItem) -> dict:
    """Expected cost of buying the item's missing units now (for the confirm dialog)."""
    mapping = item_supplier_mapping(item)
    if mapping is None:
        return {}
    catalog_item = mapping_catalog_item(mapping)
    kind = _item_kind(item)
    units = (item.quantity - _assigned(item)) if kind == "epin" else (0 if item.delivered_at else item.quantity)
    qty = max(units, 0) * max(int(mapping.quantity_per_unit or 1), 1)
    cost = Decimal(catalog_item.price) * qty if catalog_item is not None else None
    cost_fils = to_fils(cost)
    return {
        "mapping_id": mapping.id,
        "external_product_id": mapping.external_product_id,
        "product_name": catalog_item.product_name if catalog_item else mapping.external_name,
        "units": max(units, 0),
        "quantity": qty,
        "cost": f"{cost:.4f}" if cost is not None else None,
        "currency": catalog_item.currency if catalog_item else None,
        "cost_fils": cost_fils,
        "cost_jod": f"{Decimal(cost_fils) / 1000:.3f} JOD" if cost_fils is not None else None,
        "sale_fils": item.unit_price_fils * max(units, 0),
        # Limit for the whole purchase (max_cost_fils is per one of our units).
        "max_cost_fils": (mapping.max_cost_fils * max(units, 0)) if mapping.max_cost_fils else None,
        "over_limit": bool(
            mapping.max_cost_fils and cost_fils is not None and cost_fils > mapping.max_cost_fils * max(units, 0)
        ),
    }
