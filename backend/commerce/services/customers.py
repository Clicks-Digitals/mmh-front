"""Customer spend helpers (OR-16). Net = order total - COMPLETED refunds, over PAID and
PARTIALLY_REFUNDED orders. An order belongs to a customer when it is linked to the account
or is a guest order placed with the same e-mail (case-insensitive)."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable

from django.db.models import Q, Sum

from commerce.models import Order, PaymentStatus, Refund, RefundStatus

NET_PAID_STATUSES = (PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED)


def refunded_by_order(order_ids: Iterable[int]) -> dict[int, int]:
    ids = list(order_ids)
    if not ids:
        return {}
    rows = (
        Refund.objects.filter(order_id__in=ids, status=RefundStatus.COMPLETED)
        .values("order_id")
        .annotate(total=Sum("amount_fils"))
    )
    return {row["order_id"]: int(row["total"] or 0) for row in rows}


def net_spent_fils(orders) -> int:
    """Net spend over an Order queryset (only PAID / PARTIALLY_REFUNDED orders count)."""
    rows = list(orders.filter(payment_status__in=NET_PAID_STATUSES).values("id", "total_fils"))
    refunded = refunded_by_order([r["id"] for r in rows])
    return sum(max(0, int(r["total_fils"] or 0) - refunded.get(r["id"], 0)) for r in rows)


def customer_total_spent_fils(*, user=None, email: str | None = None) -> int:
    q = Q()
    if user is not None:
        q |= Q(user=user) | Q(user__isnull=True, email__iexact=user.email)
    if email:
        q |= Q(email__iexact=email.strip())
    if not q:
        return 0
    return net_spent_fils(Order.objects.filter(q))


def customer_order_stats(users: Iterable) -> dict[int, dict]:
    """``{user_id: {"orders_count", "guest_orders_count", "total_spent_fils"}}`` (accounts calls this)."""
    users = [u for u in users if u is not None]
    if not users:
        return {}
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
    refunded = refunded_by_order([o["id"] for o in orders if o["payment_status"] in NET_PAID_STATUSES])
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
