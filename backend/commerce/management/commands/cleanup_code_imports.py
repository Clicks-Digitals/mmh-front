from __future__ import annotations

from django.core.management.base import BaseCommand

from commerce.services.code_import import PENDING_PAYLOAD_TTL_HOURS, cleanup_pending_imports


class Command(BaseCommand):
    help = (
        "Expire encrypted pending code-import payloads and delete legacy plaintext upload files "
        "under MEDIA_ROOT/code_imports. Never logs plaintext."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--older-than-hours",
            type=int,
            default=PENDING_PAYLOAD_TTL_HOURS,
            help=f"Expire unconfirmed previews older than this many hours (default {PENDING_PAYLOAD_TTL_HOURS})",
        )
        parser.add_argument("--dry-run", action="store_true", help="Report only; change nothing")

    def handle(self, *args, **options):
        counts = cleanup_pending_imports(older_than_hours=options["older_than_hours"], dry_run=options["dry_run"])
        prefix = "DRY-RUN " if options["dry_run"] else ""
        self.stdout.write(self.style.SUCCESS(prefix + " ".join(f"{k}={v}" for k, v in counts.items())))
