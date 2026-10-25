"""Admin-managed pictures for categories and platforms (upload / replace / remove, permissions, URLs)."""

from __future__ import annotations

import shutil
import tempfile
from io import BytesIO, StringIO
from pathlib import Path

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from PIL import Image

from accounts.models import AdminRole
from accounts.tests_admin import auth_client, make_admin, seed_permissions
from audit.models import AuditLog
from catalog.models import Category, Platform, PublishStatus
from catalog.services.media import MAX_BYTES


def png_upload(name="pic.png", size=(64, 64)) -> SimpleUploadedFile:
    buf = BytesIO()
    Image.new("RGB", size, (30, 60, 90)).save(buf, format="PNG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/png")


class _TempMediaMixin:
    def setUp(self):
        super().setUp()
        self._media = tempfile.mkdtemp(prefix="mmh-img-test-")
        self._override = override_settings(MEDIA_ROOT=self._media)
        self._override.enable()

    def tearDown(self):
        self._override.disable()
        shutil.rmtree(self._media, ignore_errors=True)
        super().tearDown()


class CategoryPlatformImageTests(_TempMediaMixin, TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        cls.catalog = make_admin("img-cat@mmh.test", AdminRole.CATALOG_MANAGER)
        cls.content = make_admin("img-content@mmh.test", AdminRole.CONTENT_MANAGER)
        cls.category = Category.objects.create(slug="gift-cards", name_en="Gift cards", status=PublishStatus.PUBLISHED)
        cls.platform = Platform.objects.create(slug="steam", name_en="Steam", status=PublishStatus.PUBLISHED)

    def test_category_upload_replace_remove(self):
        client = auth_client(self.catalog)
        url = f"/api/v1/admin/categories/{self.category.id}/image/"
        res = client.post(url, {"file": png_upload()}, format="multipart")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data["image"].startswith("/media/uploads/"))
        self.assertTrue(res.data["image_url"].startswith("http://testserver/media/uploads/"))
        stored = Path(self._media) / res.data["image"].removeprefix("/media/")
        self.assertTrue(stored.exists())
        self.assertTrue(AuditLog.objects.filter(action="catalog.category.image_uploaded", entity_id=str(self.category.id)).exists())

        # Public API exposes the absolute URL.
        public = self.client.get("/api/v1/catalog/categories/").json()
        row = next(c for c in public if c["slug"] == "gift-cards")
        self.assertEqual(row["image_url"], res.data["image_url"])

        first = res.data["image"]
        res = client.post(url, {"file": png_upload("again.png")}, format="multipart")
        self.assertEqual(res.status_code, 200)
        self.assertNotEqual(res.data["image"], first)

        res = client.delete(url)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["image"], "")
        self.assertEqual(res.data["image_url"], "")
        self.category.refresh_from_db()
        self.assertEqual(self.category.image, "")
        self.assertTrue(AuditLog.objects.filter(action="catalog.category.image_removed").exists())
        public = self.client.get("/api/v1/catalog/categories/").json()
        self.assertEqual(next(c for c in public if c["slug"] == "gift-cards")["image_url"], "")

    def test_platform_upload_and_public_url(self):
        client = auth_client(self.catalog)
        res = client.post(f"/api/v1/admin/platforms/{self.platform.id}/image/", {"image": png_upload()}, format="multipart")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data["image_url"].startswith("http://testserver/media/uploads/"))
        public = self.client.get("/api/v1/catalog/platforms/").json()
        self.assertEqual(next(p for p in public if p["slug"] == "steam")["image_url"], res.data["image_url"])
        listed = client.get("/api/v1/admin/platforms/").json()
        rows = listed["results"] if isinstance(listed, dict) else listed
        self.assertTrue(next(p for p in rows if p["slug"] == "steam")["image_url"].startswith("http://testserver/media/"))
        self.assertTrue(AuditLog.objects.filter(action="catalog.platform.image_uploaded").exists())

    def test_rejects_wrong_type_too_large_and_missing_file(self):
        client = auth_client(self.catalog)
        url = f"/api/v1/admin/categories/{self.category.id}/image/"
        svg = SimpleUploadedFile("x.svg", b"<svg xmlns='http://www.w3.org/2000/svg'/>", content_type="image/svg+xml")
        res = client.post(url, {"file": svg}, format="multipart")
        self.assertEqual(res.status_code, 400)
        self.assertIn("JPEG, PNG, WEBP, or GIF", res.data["detail"])
        fake = SimpleUploadedFile("x.png", b"not really a png at all", content_type="image/png")
        self.assertEqual(client.post(url, {"file": fake}, format="multipart").status_code, 400)
        big = SimpleUploadedFile("big.png", b"\x89PNG\r\n\x1a\n" + b"0" * (MAX_BYTES + 1), content_type="image/png")
        res = client.post(url, {"file": big}, format="multipart")
        self.assertEqual(res.status_code, 400)
        self.assertIn("5MB", res.data["detail"])
        res = client.post(url, {}, format="multipart")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["code"], "file_required")
        self.category.refresh_from_db()
        self.assertEqual(self.category.image, "")

    def test_huge_image_is_downscaled(self):
        client = auth_client(self.catalog)
        res = client.post(
            f"/api/v1/admin/categories/{self.category.id}/image/", {"file": png_upload(size=(2400, 1200))}, format="multipart"
        )
        self.assertEqual(res.status_code, 200, res.content)
        with Image.open(Path(self._media) / res.data["image"].removeprefix("/media/")) as img:
            self.assertLessEqual(max(img.size), 2000)

    def test_permissions(self):
        url = f"/api/v1/admin/categories/{self.category.id}/image/"
        # content manager only has catalog.read
        self.assertEqual(auth_client(self.content).post(url, {"file": png_upload()}, format="multipart").status_code, 403)
        self.assertEqual(auth_client(self.content).delete(url).status_code, 403)
        self.assertEqual(
            auth_client(self.content).post(f"/api/v1/admin/platforms/{self.platform.id}/image/", {"file": png_upload()}, format="multipart").status_code,
            403,
        )
        self.assertIn(self.client.post(url, {"file": png_upload()}, format="multipart").status_code, (401, 403))

    def test_image_is_not_writable_through_plain_update(self):
        client = auth_client(self.catalog)
        res = client.patch(f"/api/v1/admin/categories/{self.category.id}/", {"image": "/catalog/ps-plus.webp"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.category.refresh_from_db()
        self.assertEqual(self.category.image, "")

    def test_orphan_report_keeps_entity_images(self):
        client = auth_client(self.catalog)
        res = client.post(f"/api/v1/admin/categories/{self.category.id}/image/", {"file": png_upload()}, format="multipart")
        kept = Path(self._media) / res.data["image"].removeprefix("/media/")
        orphan = Path(self._media) / "uploads" / "orphan.png"
        orphan.write_bytes(b"x")
        call_command("report_orphan_media", "--delete", stdout=StringIO())
        self.assertTrue(kept.exists())
        self.assertFalse(orphan.exists())

