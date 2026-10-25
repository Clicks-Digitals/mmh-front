"""Home tiles (MMH suggests grid) + logo / hero pictures managed in the admin panel."""

from __future__ import annotations

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase

from accounts.models import AdminRole
from accounts.tests_admin import auth_client, make_admin, seed_permissions
from audit.models import AuditLog
from catalog.tests_entity_images import _TempMediaMixin, png_upload
from cms.models import HomeTile, SiteSettings


class HomeTileTests(_TempMediaMixin, TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        cls.content = make_admin("tile-content@mmh.test", AdminRole.CONTENT_MANAGER)
        cls.viewer = make_admin("tile-viewer@mmh.test", AdminRole.VIEWER)
        cls.support = make_admin("tile-support@mmh.test", AdminRole.SUPPORT_AGENT)

    def test_migration_seeds_suggested_tiles_without_pictures(self):
        rows = self.client.get("/api/v1/cms/home-tiles/?section=SUGGESTED").json()
        self.assertEqual(len(rows), 12)
        self.assertEqual(rows[0]["title_en"], "PlayStation Store")
        self.assertTrue(rows[0]["title_ar"])
        self.assertEqual(rows[0]["artwork_key"], "card-psn")
        self.assertTrue(all(row["image_url"] == "" for row in rows))
        self.assertNotIn("published", rows[0])

    def test_crud_upload_remove_and_public_list(self):
        HomeTile.objects.all().delete()
        client = auth_client(self.content)
        res = client.post(
            "/api/v1/admin/home-tiles/",
            {"title_en": "Steam", "title_ar": "ستيم", "href": "/category/steam", "artwork_key": "card-steam", "sort_order": 2},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        tile_id = res.data["id"]
        self.assertEqual(res.data["image_url"], "")
        client.post("/api/v1/admin/home-tiles/", {"title_en": "Hidden", "href": "/deals", "published": False}, format="json")
        self.assertEqual(client.post("/api/v1/admin/home-tiles/", {"title_en": "Bad", "href": "javascript:alert(1)"}, format="json").status_code, 400)

        res = client.post(f"/api/v1/admin/home-tiles/{tile_id}/image/", {"file": png_upload()}, format="multipart")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data["image_url"].startswith("http://testserver/media/uploads/"))
        self.assertTrue(AuditLog.objects.filter(action="cms.home_tile.image_uploaded", entity_id=str(tile_id)).exists())

        public = self.client.get("/api/v1/cms/home-tiles/").json()
        self.assertEqual([row["title_en"] for row in public], ["Steam"])
        self.assertEqual(public[0]["image_url"], res.data["image_url"])

        res = client.delete(f"/api/v1/admin/home-tiles/{tile_id}/image/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["image_url"], "")
        self.assertTrue(AuditLog.objects.filter(action="cms.home_tile.image_removed").exists())

        bad = SimpleUploadedFile("x.txt", b"hello", content_type="text/plain")
        self.assertEqual(client.post(f"/api/v1/admin/home-tiles/{tile_id}/image/", {"file": bad}, format="multipart").status_code, 400)

    def test_permissions(self):
        tile = HomeTile.objects.first()
        url = f"/api/v1/admin/home-tiles/{tile.id}/image/"
        # viewer: content.read only; support agent: no content permission at all
        self.assertEqual(auth_client(self.viewer).post(url, {"file": png_upload()}, format="multipart").status_code, 403)
        self.assertEqual(auth_client(self.viewer).delete(url).status_code, 403)
        self.assertEqual(auth_client(self.viewer).get("/api/v1/admin/home-tiles/").status_code, 200)
        self.assertEqual(auth_client(self.support).get("/api/v1/admin/home-tiles/").status_code, 403)
        self.assertEqual(auth_client(self.content).get("/api/v1/admin/home-tiles/").status_code, 200)


class SiteImageTests(_TempMediaMixin, TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        cls.admin = make_admin("brand-admin@mmh.test", AdminRole.SUPER_ADMIN)
        cls.content = make_admin("brand-content@mmh.test", AdminRole.CONTENT_MANAGER)
        SiteSettings.load()

    def test_logo_and_hero_upload_remove(self):
        client = auth_client(self.admin)
        self.assertEqual(client.post("/api/v1/admin/settings/image/", {"file": png_upload()}, format="multipart").status_code, 400)
        res = client.post("/api/v1/admin/settings/image/", {"file": png_upload(), "target": "logo"}, format="multipart")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data["logo_image_url"].startswith("http://testserver/media/uploads/"))
        res = client.post("/api/v1/admin/settings/image/?target=hero", {"file": png_upload()}, format="multipart")
        self.assertEqual(res.status_code, 200, res.content)
        public = self.client.get("/api/v1/cms/settings/").json()
        self.assertTrue(public["logo_image_url"].startswith("http://testserver/media/"))
        self.assertTrue(public["hero_image_url"].startswith("http://testserver/media/"))
        self.assertNotIn("low_stock_threshold", public)

        res = client.delete("/api/v1/admin/settings/image/?target=logo")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["logo_image_url"], "")
        self.assertEqual(self.client.get("/api/v1/cms/settings/").json()["logo_image_url"], "")
        self.assertTrue(AuditLog.objects.filter(action="settings.image_uploaded").exists())
        self.assertTrue(AuditLog.objects.filter(action="settings.image_removed").exists())

        # Plain PATCH cannot point the logo at an arbitrary picture.
        client.patch("/api/v1/admin/settings/", {"logo_image": "/catalog/ps-plus.webp"}, format="json")
        self.assertEqual(SiteSettings.load().logo_image, "")

    def test_requires_settings_manage(self):
        res = auth_client(self.content).post("/api/v1/admin/settings/image/?target=logo", {"file": png_upload()}, format="multipart")
        self.assertEqual(res.status_code, 403)
