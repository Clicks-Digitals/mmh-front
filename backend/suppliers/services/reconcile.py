"""Scheduled 1Epin jobs (D-1E-7): reconcile supplier orders, retry the service window, daily sync."""

from __future__ import annotations

import logging
from datetime import timedelta

from django.db.models import Q
from django.utils import timezone

from commerce.models import FulfillmentStatus, Order
from commerce.services.orders import PAID_UNREFUNDED
from suppliers.models import AlertKind, SupplierOrder, SupplierProductMapping, SupplierStatus
from suppliers.provider import SupplierError, ensure_supplier, get_supplier_provider, to_decimal
from suppliers.services.alerts import raise_alert, record_balance
from suppliers.services.catalog import sync_catalog, sync_due
from suppliers.services.config import current_environment, trading_enabled
from suppliers.services.fulfillment import (
    definitively_failed,
    fulfill_from_supplier,
    refresh_order_status,
    sync_supplier_order,
)

logger = logging.getLogger("suppliers")

RECONCILE_AFTER = timedelta(minutes=2)
STUCK_AFTER = timedelta(hours=2)
KEEP_CHECKING_FOR = timedelta(hours=72)
MISSED_ORDER_WINDOW = timedelta(days=3)
BALANCE_EVERY = timedelta(hours=1)
BATCH = 50


def _mark_stuck(so: SupplierOrder) -> None:
    SupplierOrder.objects.filter(pk=so.pk).update(
        status=SupplierStatus.MANUAL_REVIEW,
        stuck_alerted=True,
        message="1Epin has not completed this order for over 2 hours - check it on 1Epin",
        updated_at=timezone.now(),
    )
    raise_alert(
        so.supplier,
        AlertKind.ORDER_FAILED,
        f"1Epin order {so.supplier_ref} is stuck for over 2 hours",
        dedupe_key=f"stuck:{so.supplier_ref}",
        supplier_order=so,
    )
    if so.order_id:
        refresh_order_status(so.order_id)


def reconcile_supplier_orders(*, now=None) -> dict:
    now = now or timezone.now()
    env = current_environment()
    summary = {"checked": 0, "completed": 0, "failed": 0, "retried": 0, "stuck": 0, "missed_orders": 0, "errors": 0}
    try:
        get_supplier_provider()
    except SupplierError as exc:
        return {"skipped": str(exc)}
    base = SupplierOrder.objects.filter(environment=env).select_related("supplier", "order")

    # Service window (10): retry once the window is over.
    for so in base.filter(status=SupplierStatus.WAITING, retry_after__lte=now)[:BATCH]:
        result = _safe_sync(so, summary)
        summary["retried"] += 1
        _count(summary, result)

    # In flight for > 2 minutes (PROCESSING / UNKNOWN / crashed SUBMITTING / unsent NOT_SUBMITTED).
    in_flight = base.filter(
        status__in=[
            SupplierStatus.PROCESSING,
            SupplierStatus.UNKNOWN,
            SupplierStatus.SUBMITTING,
            SupplierStatus.NOT_SUBMITTED,
        ],
        updated_at__lte=now - RECONCILE_AFTER,
    ).order_by("updated_at")[:BATCH]
    for so in in_flight:
        result = _safe_sync(so, summary)
        _count(summary, result)
        so.refresh_from_db()
        if so.status in {SupplierStatus.PROCESSING, SupplierStatus.UNKNOWN, SupplierStatus.SUBMITTING} and (
            so.created_at <= now - STUCK_AFTER
        ) and not so.stuck_alerted:
            _mark_stuck(so)
            summary["stuck"] += 1

    # Stuck orders already in manual review keep being checked (they may still complete).
    for so in base.filter(
        status=SupplierStatus.MANUAL_REVIEW,
        stuck_alerted=True,
        created_at__gte=now - KEEP_CHECKING_FOR,
        updated_at__lte=now - RECONCILE_AFTER,
    ).filter(Q(order_status_code__isnull=True) | Q(order_status_code=0))[:BATCH]:
        if definitively_failed(so):
            continue
        _count(summary, _safe_sync(so, summary))

    # Paid orders whose supplier purchase was never planned (e.g. the process died after payment).
    if trading_enabled():
        mapped_variants = SupplierProductMapping.objects.filter(
            ignored=False, auto_buy=True, supplier__slug="1epin", supplier__active=True, variant__isnull=False
        ).values_list("variant_id", flat=True)
        candidates = (
            Order.objects.filter(
                payment_status__in=list(PAID_UNREFUNDED),
                fulfillment_status__in=[
                    FulfillmentStatus.MANUAL_REVIEW,
                    FulfillmentStatus.PROCESSING,
                    FulfillmentStatus.QUEUED,
                ],
                created_at__gte=now - MISSED_ORDER_WINDOW,
                items__variant_id__in=mapped_variants,
            )
            .distinct()
            .order_by("created_at")[:BATCH]
        )
        for order in candidates:
            item_ids = list(order.items.filter(variant_id__in=mapped_variants).values_list("id", flat=True))
            if SupplierOrder.objects.filter(order_item_id__in=item_ids).count() >= len(item_ids):
                continue
            if order.updated_at > now - RECONCILE_AFTER:
                continue  # the inline worker may still be running
            try:
                placed = fulfill_from_supplier(order.id)
            except Exception:  # noqa: BLE001
                logger.exception("1Epin missed-order fulfillment failed for %s", order.order_number)
                summary["errors"] += 1
                continue
            if placed:
                summary["missed_orders"] += 1
    return summary


def _safe_sync(so: SupplierOrder, summary: dict) -> str:
    try:
        return sync_supplier_order(so)
    except Exception:  # noqa: BLE001 - one bad order must not stop the job
        logger.exception("1Epin reconcile failed for %s", so.supplier_ref)
        summary["errors"] += 1
        return "error"


def _count(summary: dict, result: str) -> None:
    summary["checked"] += 1
    if result == "completed":
        summary["completed"] += 1
    elif result == "failed":
        summary["failed"] += 1


def refresh_balance_if_due(*, now=None) -> dict | str:
    now = now or timezone.now()
    supplier = ensure_supplier()
    try:
        provider = get_supplier_provider()
    except SupplierError as exc:
        return f"skipped:{exc}"
    if not provider.can_authenticate:
        return "not_configured"
    last = supplier.connection.last_checked_at
    if last is not None and now - last < BALANCE_EVERY:
        return "fresh"
    res = provider.client.check_balance()
    if not res.ok:
        if res.code in {"02", "03"}:
            raise_alert(supplier, AlertKind.CONFIG, res.readable, dedupe_key=f"config:{res.code}")
        return f"error:{res.code or 'network'}"
    balance = to_decimal(res.data.get("Balance"))
    record_balance(supplier, balance)
    return {"balance": f"{balance:.2f}" if balance is not None else ""}


def run_oneepin_jobs() -> dict:
    """Everything the 10-minute cron does for 1Epin. Never raises."""
    out: dict = {}
    supplier = ensure_supplier()
    env = current_environment()
    try:
        out["reconcile"] = reconcile_supplier_orders()
    except Exception as exc:  # noqa: BLE001
        logger.exception("1Epin reconcile job failed")
        out["reconcile"] = f"error:{exc.__class__.__name__}"
    try:
        if sync_due(supplier, env):
            result = sync_catalog()
            out["catalog_sync"] = {k: result.get(k) for k in ("ok", "created", "updated", "deactivated", "total", "code")}
        else:
            out["catalog_sync"] = "fresh"
    except Exception as exc:  # noqa: BLE001
        logger.exception("1Epin catalog sync job failed")
        out["catalog_sync"] = f"error:{exc.__class__.__name__}"
    try:
        out["balance"] = refresh_balance_if_due()
    except Exception as exc:  # noqa: BLE001
        logger.exception("1Epin balance job failed")
        out["balance"] = f"error:{exc.__class__.__name__}"
    return out
