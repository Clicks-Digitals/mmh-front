from django.core.management.base import BaseCommand, CommandError

from commerce.services.payment import PaymentError
from commerce.services.paypal import reconcile_pending_payments


class Command(BaseCommand):
    help = (
        "Settle PayPal orders that were approved but never captured by the browser. "
        "Run on a schedule (e.g. every 10 minutes); safe alongside webhooks."
    )

    def add_arguments(self, parser):
        parser.add_argument("--min-age-minutes", type=int, default=10)
        parser.add_argument("--max-age-hours", type=int, default=72)
        parser.add_argument("--limit", type=int, default=200)

    def handle(self, *args, **options):
        try:
            counts = reconcile_pending_payments(
                min_age_minutes=options["min_age_minutes"],
                max_age_hours=options["max_age_hours"],
                limit=options["limit"],
            )
        except PaymentError as exc:
            raise CommandError(exc.message) from exc
        self.stdout.write(" ".join(f"{key}={value}" for key, value in counts.items()))
