from __future__ import annotations

from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from catalog.models import MediaAsset


def referenced_entity_image_paths() -> set[str]:
    """Storage paths (relative to MEDIA_ROOT) referenced by entity picture fields, not MediaAsset rows."""
    from catalog.models import Category, Platform, Product
    from cms.models import Banner, HomeTile, SiteSettings

    sources = [
        (Category, ("image", "artwork_url")),
        (Platform, ("image",)),
        (Product, ("image_url",)),
        (HomeTile, ("image",)),
        (Banner, ("desktop_image", "mobile_image")),
        (SiteSettings, ("logo_image", "hero_image")),
    ]
    prefix = settings.MEDIA_URL
    paths: set[str] = set()
    for model, fields in sources:
        for row in model.objects.values_list(*fields):
            for value in row:
                value = (value or "").split("?", 1)[0]
                if "://" in value:
                    value = "/" + value.split("://", 1)[1].split("/", 1)[-1]
                if value.startswith(prefix):
                    paths.add(Path(value[len(prefix):]).as_posix())
    return paths


class Command(BaseCommand):
    help = (
        "Report local media files under MEDIA_ROOT that are not referenced by MediaAsset.storage_path "
        "or by an entity picture field (category, platform, home tile, banner, logo/hero). "
        "Dry-run by default; never auto-deletes."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--delete",
            action="store_true",
            help="Actually delete orphan files (off by default)",
        )

    def handle(self, *args, **options):
        do_delete = options["delete"]
        root = Path(settings.MEDIA_ROOT)
        if not root.exists():
            self.stdout.write("MEDIA_ROOT does not exist; nothing to report.")
            return

        referenced = {
            Path(p).as_posix()
            for p in MediaAsset.objects.exclude(storage_path="").values_list("storage_path", flat=True)
        }
        # Single-picture fields (categories, platforms, home tiles, banners, logo/hero) store MEDIA_URL paths.
        referenced |= referenced_entity_image_paths()
        # Also ignore code-import temp dirs actively tracked
        from commerce.models import CodeImportBatch

        for p in CodeImportBatch.objects.exclude(pending_file_path="").values_list("pending_file_path", flat=True):
            referenced.add(Path(p).as_posix())

        orphans: list[Path] = []
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            rel = path.relative_to(root).as_posix()
            if rel in referenced:
                continue
            orphans.append(path)

        for path in orphans:
            rel = path.relative_to(root).as_posix()
            if do_delete:
                path.unlink(missing_ok=True)
                self.stdout.write(f"Deleted orphan: {rel}")
            else:
                self.stdout.write(f"Orphan: {rel}")

        self.stdout.write(
            self.style.SUCCESS(
                f"Found {len(orphans)} orphan file(s)"
                + (" (deleted)" if do_delete else " (report only; pass --delete to remove)")
            )
        )
