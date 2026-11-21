"""Store design: theme + home page sections (validation, admin edit, public settings, picture upload)."""

from __future__ import annotations

import io

from accounts.models import AdminRole
from accounts.tests_admin import auth_client, make_admin, seed_permissions
from cms.design import clean_home_layout, clean_theme
from cms.models import SiteSettings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient


def png_bytes() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (8, 8), (200, 30, 200)).save(out, format="PNG")
    return out.getvalue()


class CleanDesignTests(TestCase):
    def test_theme_defaults_and_validation(self):
        self.assertEqual(clean_theme({}), {})
        self.assertEqual(clean_theme({"neon": "full"})["primary"], "#f7c037")
        self.assertEqual(clean_theme({"primary": "#AABBCC"})["primary"], "#aabbcc")
        with self.assertRaises(ValueError):
            clean_theme({"primary": "red"})
        with self.assertRaises(ValueError):
            clean_theme({"neon": "max"})

    def test_layout_rules(self):
        rows = clean_home_layout(
            [
                {"type": "banners"},
                {"type": "products", "id": "row1", "source": "category", "category": "playstation", "title_en": "PS"},
                {"type": "suggested", "visible": False},
            ]
        )
        self.assertEqual([r["id"] for r in rows], ["banners", "row1", "suggested"])
        self.assertFalse(rows[2]["visible"])
        self.assertEqual(rows[1]["limit"], 8)
        with self.assertRaises(ValueError):
            clean_home_layout([{"type": "banners"}, {"type": "banners"}])
        with self.assertRaises(ValueError):
            clean_home_layout([{"type": "mystery"}])
        with self.assertRaises(ValueError):
            clean_home_layout([{"type": "products", "source": "products", "products": [], "title_en": "x"}])
        with self.assertRaises(ValueError):
            clean_home_layout([{"type": "image", "image": "javascript:alert(1)"}])
        with self.assertRaises(ValueError):
            clean_home_layout([{"type": "image", "image": "/media/a.png", "href": "javascript:x"}])


@override_settings(MEDIA_URL="/media/")
class DesignApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        SiteSettings.load()
        cls.admin = make_admin("design-admin@mmh.test", AdminRole.SUPER_ADMIN)

    def test_admin_saves_design_and_store_reads_it(self):
        res = auth_client(self.admin).patch(
            "/api/v1/admin/settings/",
            {
                "theme": {"primary": "#00e5ff", "secondary": "#ff2bd6", "background": "#0b0b1a", "neon": "full"},
                "home_layout": [
                    {"type": "products", "id": "deals", "source": "deals", "title_en": "Deals", "title_ar": "عروض"},
                    {"type": "banners"},
                ],
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        public = APIClient().get("/api/v1/cms/settings/").json()
        self.assertEqual(public["theme"]["neon"], "full")
        self.assertEqual([s["type"] for s in public["home_layout"]], ["products", "banners"])

    def test_bad_layout_is_rejected(self):
        res = auth_client(self.admin).patch("/api/v1/admin/settings/", {"home_layout": [{"type": "nope"}]}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_upload_section_picture(self):
        upload = SimpleUploadedFile("pic.png", png_bytes(), content_type="image/png")
        res = auth_client(self.admin).post("/api/v1/admin/settings/design-image/", {"file": upload}, format="multipart")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertIn("/media/uploads/", res.json()["url"])
        self.assertEqual(APIClient().post("/api/v1/admin/settings/design-image/", {}).status_code, 401)
