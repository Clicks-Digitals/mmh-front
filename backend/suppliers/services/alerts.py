"""Supplier alerts (D8) and balance tracking."""

from __future__ import annotations

import logging
from decimal import Decimal

from django.db.models import F
from django.utils import timezone

from suppliers.models import AlertKind, Supplier, SupplierAlert
from suppliers.services.config import currency, low_balance_threshold

logger = logging.getLogger("suppliers")

SEVERITY = {
    AlertKind.LOW_BALANCE: "error",
    AlertKind.CONFIG: "error",
    AlertKind.ORDER_FAILED: "warning",
    AlertKind.PRICE_CHANGE: "info",
    AlertKind.DUPLICATE_CODE: "error",
}


def raise_alert(
    supplier: Supplier,
    kind: str,
    message: str,
    *,
    dedupe_key: str = "",
    supplier_order=None,
    order_number: str = "",
    meta: dict | None = None,
) -> SupplierAlert:
    """Create an open alert, or bump the open one with the same ``dedupe_key``."""
    if dedupe_key:
        existing = SupplierAlert.objects.filter(supplier=supplier, dedupe_key=dedupe_key, resolved=False).first()
        if existing is not None:
            SupplierAlert.objects.filter(pk=existing.pk).update(
                occurrences=F("occurrences") + 1, message=message[:500], updated_at=timezone.now()
            )
            existing.refresh_from_db()
            return existing
    alert = SupplierAlert.objects.create(
        supplier=supplier,
        kind=kind,
        severity=SEVERITY.get(kind, "warning"),
        message=message[:500],
        dedupe_key=dedupe_key[:160],
        supplier_order=supplier_order,
        order_number=(order_number or (supplier_order.order.order_number if supplier_order and supplier_order.order_id else ""))[:32],
        meta=meta or {},
    )
    logger.warning("1Epin alert [%s] %s", kind, message)
    return alert


def auto_resolve(supplier: Supplier, dedupe_key: str, note: str) -> int:
    return SupplierAlert.objects.filter(supplier=supplier, dedupe_key=dedupe_key, resolved=False).update(
        resolved=True, resolved_at=timezone.now(), resolution_note=note[:500], updated_at=timezone.now()
    )


def resolve_alert(alert: SupplierAlert, *, actor=None, note: str = "") -> SupplierAlert:
    if not alert.resolved:
        alert.resolved = True
        alert.resolved_at = timezone.now()
        alert.resolved_by = actor if getattr(actor, "is_authenticated", False) else None
        alert.resolution_note = (note or "")[:500]
        alert.save(update_fields=["resolved", "resolved_at", "resolved_by", "resolution_note", "updated_at"])
    return alert


def is_low(balance: Decimal | None) -> bool:
    return balance is not None and balance < low_balance_threshold()


def record_balance(supplier: Supplier, balance: Decimal | None) -> None:
    """Store the latest balance (checkBalance or addOrder response) and raise/resolve the low alert."""
    if balance is None:
        return
    connection = supplier.connection
    connection.last_balance = f"{balance:.2f}"
    connection.last_checked_at = timezone.now()
    meta = dict(connection.meta or {})
    meta["balance_currency"] = currency()
    meta["balance_checked_at"] = connection.last_checked_at.isoformat()
    connection.meta = meta
    connection.save(update_fields=["last_balance", "last_checked_at", "meta", "updated_at"])
    if is_low(balance):
        raise_alert(
            supplier,
            AlertKind.LOW_BALANCE,
            f"1Epin balance is low: {balance:.2f} {currency()} (threshold {low_balance_threshold()}).",
            dedupe_key="low_balance",
            meta={"balance": f"{balance:.2f}"},
        )
    else:
        auto_resolve(supplier, "low_balance", f"Balance back to {balance:.2f} {currency()}")
