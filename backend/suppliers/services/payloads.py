"""JSON shapes for supplier orders (admin API + admin order page)."""

from __future__ import annotations

from catalog.models import FulfillmentType
from commerce.models import DigitalCodeStatus
from commerce.services.orders import PAID_UNREFUNDED
from suppliers.models import IN_FLIGHT_STATUSES, SupplierOrder, SupplierStatus
from suppliers.services.config import fils_display, trading_disabled_reason, trading_enabled


def supplier_order_payload(so: SupplierOrder) -> dict:
    return {
        "id": so.id,
        "order_id": so.order_id,
        "order_number": so.order.order_number if so.order_id else None,
        "order_item_id": so.order_item_id,
        "attempt": so.attempt,
        "external_order_number": so.supplier_ref,
        "environment": so.environment,
        "external_product_id": so.external_product_id,
        "product_name": so.product_name,
        "kind": so.kind,
        "quantity": so.quantity,
        "units": so.units,
        "player_user": so.player_user,
        "status": so.status,
        "status_label": SupplierStatus(so.status).label if so.status in SupplierStatus.values else so.status,
        "placed": so.placed,
        "result_code": so.result_code,
        "order_status_code": so.order_status_code,
        "message": so.message,
        "unit_price": f"{so.unit_price:.4f}" if so.unit_price is not None else None,
        "cost": f"{so.cost:.4f}" if so.cost is not None else None,
        "currency": so.currency,
        "cost_fils": so.cost_fils,
        "cost_jod": fils_display(so.cost_fils),
        "balance_after": f"{so.balance_after:.2f}" if so.balance_after is not None else None,
        "pins_received": so.pins_received,
        "codes_delivered": so.codes_delivered,
        "submit_count": so.submit_count,
        "check_count": so.check_count,
        "retry_after": so.retry_after,
        "submitted_at": so.submitted_at,
        "last_checked_at": so.last_checked_at,
        "completed_at": so.completed_at,
        "created_by": so.created_by.email if so.created_by_id else None,
        "created_at": so.created_at,
        "updated_at": so.updated_at,
    }


def _action(enabled: bool, reason: str = "", **extra) -> dict:
    return {"enabled": bool(enabled), "disabled_reason": "" if enabled else reason, **extra}


def item_supplier_payload(item, *, order=None) -> dict | None:
    """``supplier_order`` block of an admin order item (None when the item has nothing to do with 1Epin)."""
    from suppliers.services.fulfillment import buy_now_quote, definitively_failed, item_supplier_mapping

    order = order or item.order
    latest = SupplierOrder.objects.filter(order_item_id=item.id).order_by("-attempt", "-id").first()
    mapping = item_supplier_mapping(item)
    if latest is None and mapping is None:
        return None
    is_code = item.product.fulfillment_type == FulfillmentType.CODE
    if is_code:
        live = [c for c in item.codes.all() if c.status != DigitalCodeStatus.UNAVAILABLE]
        delivered = len(live) >= item.quantity
    else:
        delivered = item.delivered_at is not None
    paid = order.payment_status in PAID_UNREFUNDED and order.fulfillment_status != "CANCELLED"
    can_trade = trading_enabled()
    trade_reason = trading_disabled_reason()
    attempts = SupplierOrder.objects.filter(order_item_id=item.id).count()

    if latest is None:
        check = _action(False, "No supplier order yet")
    elif latest.status == SupplierStatus.COMPLETED:
        check = _action(False, "Already completed")
    elif not latest.placed and definitively_failed(latest):
        check = _action(False, "1Epin never accepted this order")
    else:
        check = _action(True)

    def purchase_reason(require_latest: bool) -> str:
        if not paid:
            return "Order is not paid"
        if delivered:
            return "Item already delivered"
        if mapping is None:
            return "Not mapped to a 1Epin product"
        if not can_trade:
            return trade_reason or "Supplier purchasing is disabled"
        if require_latest and latest is None:
            return "Nothing to retry"
        if latest is not None and not definitively_failed(latest):
            if latest.status == SupplierStatus.COMPLETED:
                return "Already delivered by 1Epin"
            return "A supplier order is still open - use Check now"
        return ""

    retry_reason = purchase_reason(True)
    buy_reason = purchase_reason(False)
    if not buy_reason and latest is not None and latest.status != SupplierStatus.MANUAL_REVIEW:
        buy_reason = "Use Retry with supplier"
    quote = buy_now_quote(item) if mapping is not None and not delivered else {}
    return {
        "supplier_order_id": latest.id if latest else None,
        "status": latest.status if latest else None,
        "status_label": (SupplierStatus(latest.status).label if latest else "Not ordered from 1Epin"),
        "external_order_number": latest.supplier_ref if latest else None,
        "message": latest.message if latest else "",
        "cost": f"{latest.cost:.4f}" if latest and latest.cost is not None else None,
        "cost_currency": latest.currency if latest else None,
        "cost_fils": latest.cost_fils if latest else None,
        "cost_jod": fils_display(latest.cost_fils) if latest else None,
        "in_flight": bool(latest and latest.status in IN_FLIGHT_STATUSES),
        "attempts": attempts,
        "mapped": mapping is not None,
        "mapping_id": mapping.id if mapping else None,
        "updated_at": latest.updated_at if latest else None,
        "actions": {
            "check": check,
            "retry": _action(not retry_reason, retry_reason, requires_confirmation=True),
            "buy_now": _action(not buy_reason, buy_reason, requires_confirmation=True, quote=quote or None),
        },
    }
