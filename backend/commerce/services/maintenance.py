"""Scheduled housekeeping for orders (see management command ``run_scheduled_jobs``)."""

from __future__ import annotations

import logging
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from commerce.models import FulfillmentStatus, Order, Payment, PaymentStatus
from commerce.notifications import queue_order_expired
from commerce.services.orders import OrderTransitionError, cancel_order

logger = logging.getLogger("commerce")

EXPIRE_AFTER_HOURS = 72


def _in_flight_paypal(order: Order, now) -> bool:
    """A PayPal approval may still settle: an AUTHORIZED payment, or a PayPal order touched recently."""
    payments = order.payments.filter(provider="paypal")
    if payments.filter(status=PaymentStatus.AUTHORIZED).exists():
        return True
    return payments.filter(
        provider_order_id__isnull=False,
        status=PaymentStatus.PENDING,
        updated_at__gte=now - timedelta(hours=EXPIRE_AFTER_HOURS),
    ).exists()


def expire_stale_orders(*, older_than_hours: int = EXPIRE_AFTER_HOURS, limit: int = 500, dry_run: bool = False) -> dict[str, int]:
    """PENDING unpaid orders older than the cutoff -> payment CANCELLED, fulfillment CANCELLED."""
    now = timezone.now()
    cutoff = now - timedelta(hours=older_than_hours)
    candidates = Order.objects.filter(
        payment_status=PaymentStatus.PENDING,
        fulfillment_status__in=[FulfillmentStatus.NOT_STARTED, FulfillmentStatus.QUEUED],
        created_at__lt=cutoff,
    ).order_by("created_at")[:limit]
    counts = {"checked": 0, "expired": 0, "in_flight": 0, "errors": 0}
    for order in candidates:
        counts["checked"] += 1
        if _in_flight_paypal(order, now):
            counts["in_flight"] += 1
            continue
        if dry_run:
            counts["expired"] += 1
            continue
        try:
            with transaction.atomic():
                locked = Order.objects.select_for_update().get(pk=order.pk)
                if locked.payment_status != PaymentStatus.PENDING:
                    continue
                cancel_order(
                    locked,
                    reason=f"Expired: unpaid for more than {older_than_hours}h",
                    source="system",
                    notify=False,
                )
                queue_order_expired(locked.id)
            counts["expired"] += 1
        except OrderTransitionError as exc:
            counts["errors"] += 1
            logger.warning("Could not expire order %s: %s", order.order_number, exc.message)
    return counts
