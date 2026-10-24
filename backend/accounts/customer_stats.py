"""Customer order statistics for the admin customers pages (D15 / OR-16).

* An order belongs to a customer when it is linked to the account (``Order.user``) **or**
  it is a guest order (``user`` is null) placed with the same email (case-insensitive).
* ``total_spent_fils`` is net: ``total_fils - refunded`` over PAID and PARTIALLY_REFUNDED
  orders. Refunds come from ``commerce.models.Refund`` (``order``, ``amount_fils``) when that
  ledger exists; otherwise PARTIALLY_REFUNDED orders count at their full total.
* If commerce exposes ``commerce.services.customers.customer_order_stats(users)`` returning
  ``{user_id: {"orders_count", "total_spent_fils", ...}}`` it is used instead.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable

from django.db.models import Q, Sum

NET_PAID_STATUSES = ("PAID", "PARTIALLY_REFUNDED")


def _refunded_by_order(order_ids: list[int]) -> dict[int, int]:
    if not order_ids:
        return {}
    try:
        from commerce.models import Refund  # type: ignore[attr-defined]
    except ImportError:
        return {}
    try:
        rows = Refund.objects.filter(order_id__in=order_ids, status="COMPLETED").values("order_id").annotate(total=Sum("amount_fils"))
        return {row["order_id"]: int(row["total"] or 0) for row in rows}
    except Exception:  # noqa: BLE001 — schema mismatch: fall back to gross totals
        return {}


def customer_orders_queryset(user):
    from commerce.models import Order

    return Order.objects.filter(Q(user=user) | Q(user__isnull=True, email__iexact=user.email))


def customer_order_stats(users: Iterable) -> dict[int, dict]:
    """``{user_id: {"orders_count", "guest_orders_count", "total_spent_fils"}}``."""
    users = [u for u in users if u is not None]
    if not users:
        return {}
    try:
        from commerce.services.customers import customer_order_stats as commerce_stats  # type: ignore
    except ImportError:
        commerce_stats = None
    if commerce_stats is not None:
        try:
            result = commerce_stats(users)
            if isinstance(result, dict):
                return {
                    u.pk: {
                        "orders_count": int((result.get(u.pk) or {}).get("orders_count", 0)),
                        "guest_orders_count": int((result.get(u.pk) or {}).get("guest_orders_count", 0)),
                        "total_spent_fils": int((result.get(u.pk) or {}).get("total_spent_fils", 0)),
                    }
                    for u in users
                }
        except Exception:  # noqa: BLE001
            pass

    from commerce.models import Order

    by_id = {u.pk: u for u in users}
    by_email = defaultdict(list)
    for u in users:
        by_email[(u.email or "").lower()].append(u.pk)
    email_q = Q()
    for email in by_email:
        email_q |= Q(email__iexact=email)
    orders = list(
        Order.objects.filter(Q(user_id__in=list(by_id)) | (Q(user__isnull=True) & email_q)).values(
            "id", "user_id", "email", "payment_status", "total_fils"
        )
    )
    refunded = _refunded_by_order([o["id"] for o in orders if o["payment_status"] in NET_PAID_STATUSES])
    stats = {uid: {"orders_count": 0, "guest_orders_count": 0, "total_spent_fils": 0} for uid in by_id}
    for o in orders:
        if o["user_id"] in by_id:
            owners, guest = [o["user_id"]], False
        else:
            owners, guest = by_email.get((o["email"] or "").lower(), []), True
        for uid in owners:
            row = stats[uid]
            row["orders_count"] += 1
            if guest:
                row["guest_orders_count"] += 1
            if o["payment_status"] in NET_PAID_STATUSES:
                row["total_spent_fils"] += max(0, int(o["total_fils"] or 0) - refunded.get(o["id"], 0))
    return stats
