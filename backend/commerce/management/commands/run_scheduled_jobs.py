from __future__ import annotations

import logging

from django.conf import settings
from django.core.management.base import BaseCommand

from commerce.services.code_import import PENDING_PAYLOAD_TTL_HOURS, cleanup_pending_imports
from commerce.services.maintenance import EXPIRE_AFTER_HOURS, expire_stale_orders
from commerce.services.payment import PaymentError

logger = logging.getLogger("commerce")


class Command(BaseCommand):
    help = (
        "Run all periodic commerce jobs: PayPal reconciliation, code-import cleanup, and "
        "expiry of unpaid orders. Idempotent; safe to run every 10-15 minutes."
    )

    def add_arguments(self, parser):
        parser.add_argument("--expire-after-hours", type=int, default=EXPIRE_AFTER_HOURS)
        parser.add_argument("--skip-paypal", action="store_true")

    def handle(self, *args, **options):
        summary: dict[str, dict | str] = {}

        if options["skip_paypal"]:
            summary["reconcile_paypal"] = "skipped"
        elif not (getattr(settings, "PAYPAL_CLIENT_ID", "") and getattr(settings, "PAYPAL_CLIENT_SECRET", "")):
            summary["reconcile_paypal"] = "not_configured"
        else:
            from commerce.services.paypal import reconcile_pending_payments

            try:
                summary["reconcile_paypal"] = reconcile_pending_payments()
            except PaymentError as exc:
                summary["reconcile_paypal"] = f"error:{exc.code}"
            except Exception as exc:  # keep the other jobs running
                logger.exception("reconcile_paypal job failed")
                summary["reconcile_paypal"] = f"error:{exc.__class__.__name__}"

        try:
            summary["cleanup_code_imports"] = cleanup_pending_imports(older_than_hours=PENDING_PAYLOAD_TTL_HOURS)
        except Exception as exc:
            logger.exception("cleanup_code_imports job failed")
            summary["cleanup_code_imports"] = f"error:{exc.__class__.__name__}"

        try:
            summary["expire_orders"] = expire_stale_orders(older_than_hours=options["expire_after_hours"])
        except Exception as exc:
            logger.exception("expire_orders job failed")
            summary["expire_orders"] = f"error:{exc.__class__.__name__}"

        line = " | ".join(
            f"{job}: " + (" ".join(f"{k}={v}" for k, v in result.items()) if isinstance(result, dict) else result)
            for job, result in summary.items()
        )
        logger.info("Scheduled jobs finished %s", line)
        self.stdout.write(line)
