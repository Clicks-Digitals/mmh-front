"""E2E fix-phase tests: D19, CA-24, CA-25 (WhatsApp), ST-31."""

from __future__ import annotations

import importlib
from datetime import timedelta

from django.apps import apps as global_apps
from django.test import TestCase
from django.utils import timezone

from accounts.models import AdminRole
from accounts.tests_admin import auth_client, make_admin, seed_permissions
from audit.models import AuditLog
from cms.models import FAQ, Banner, ContentPage, SiteSettings


class ContentPageTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        cls.content = make_admin("pg-content@mmh.test", AdminRole.CONTENT_MANAGER)

    def test_footer_flag_sort_and_any_slug_reachable(self):
        ContentPage.objects.all().delete()
        client = auth_client(self.content)
        res = client.post(
            "/api/v1/admin/pages/",
            {"slug": "Shipping-Info", "title_en": "Shipping", "body_en": "b", "show_in_footer": True, "sort_order": 2},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["slug"], "shipping-info")
        client.post("/api/v1/admin/pages/", {"slug": "about", "title_en": "About", "body_en": "b", "sort_order": 1}, format="json")
        client.post(
            "/api/v1/admin/pages/", {"slug": "draft-page", "title_en": "D", "body_en": "b", "published": False}, format="json"
        )
        rows = self.client.get("/api/v1/cms/pages/").json()
        self.assertEqual(
            rows,
            [
                {"slug": "about", "title_en": "About", "title_ar": "", "show_in_footer": False, "sort_order": 1},
                {"slug": "shipping-info", "title_en": "Shipping", "title_ar": "", "show_in_footer": True, "sort_order": 2},
            ],
        )
        self.assertEqual(self.client.get("/api/v1/cms/pages/shipping-info/").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/cms/pages/draft-page/").status_code, 404)

    def test_slug_validation(self):
        client = auth_client(self.content)
        for bad in ("bad slug", "trailing-", "a--b", "عربي"):
            res = client.post("/api/v1/admin/pages/", {"slug": bad, "title_en": "T", "body_en": "b"}, format="json")
            self.assertEqual(res.status_code, 400, bad)
        client.post("/api/v1/admin/pages/", {"slug": "dup", "title_en": "T", "body_en": "b"}, format="json")
        res = client.post("/api/v1/admin/pages/", {"slug": "DUP", "title_en": "T", "body_en": "b"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_footer_migration_flags_builtin_pages(self):
        ContentPage.objects.all().delete()
        ContentPage.objects.create(slug="terms", title_en="Terms", body_en="b")
        ContentPage.objects.create(slug="custom", title_en="C", body_en="b")
        importlib.import_module("cms.migrations.0006_footer_pages_and_faqs").forwards(global_apps, None)
        self.assertTrue(ContentPage.objects.get(slug="terms").show_in_footer)
        self.assertFalse(ContentPage.objects.get(slug="custom").show_in_footer)


class BannerTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        cls.content = make_admin("bn-content@mmh.test", AdminRole.CONTENT_MANAGER)

    def test_status_computed(self):
        now = timezone.now()
        Banner.objects.create(href="/a", title_en="Live", published=True)
        Banner.objects.create(href="/b", title_en="Soon", published=True, start_at=now + timedelta(days=1))
        Banner.objects.create(href="/c", title_en="Old", published=True, end_at=now - timedelta(days=1))
        Banner.objects.create(href="/d", title_en="Off", published=False, end_at=now - timedelta(days=1))
        rows = auth_client(self.content).get("/api/v1/admin/banners/").data["results"]
        self.assertEqual(
            {r["title_en"]: r["status"] for r in rows},
            {"Live": "live", "Soon": "scheduled", "Old": "expired", "Off": "unpublished"},
        )

    def test_remove_image(self):
        banner = Banner.objects.create(href="/a", title_en="B", desktop_image="/media/uploads/a.png", mobile_image="/media/uploads/m.png")
        client = auth_client(self.content)
        self.assertEqual(client.delete(f"/api/v1/admin/banners/{banner.id}/image/").status_code, 400)
        self.assertEqual(client.delete(f"/api/v1/admin/banners/{banner.id}/image/?target=side").status_code, 400)
        res = client.delete(f"/api/v1/admin/banners/{banner.id}/image/?target=mobile")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["mobile_image"], "")
        self.assertEqual(res.data["mobile_image_url"], "")
        banner.refresh_from_db()
        self.assertEqual(banner.desktop_image, "/media/uploads/a.png")
        self.assertEqual(banner.mobile_image, "")
        self.assertTrue(AuditLog.objects.filter(action="cms.banner.image_removed").exists())
        viewer = make_admin("bn-viewer@mmh.test", AdminRole.VIEWER)
        self.assertEqual(
            auth_client(viewer).delete(f"/api/v1/admin/banners/{banner.id}/image/?target=desktop").status_code, 403
        )


class SettingsWhatsappTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        cls.admin = make_admin("st-admin@mmh.test", AdminRole.ADMIN)

    def test_whatsapp_validated(self):
        client = auth_client(self.admin)
        bad = client.patch("/api/v1/admin/settings/", {"whatsapp_number": "call us"}, format="json")
        self.assertEqual(bad.status_code, 400)
        self.assertIn("whatsapp_number", bad.data["detail"])
        ok = client.patch("/api/v1/admin/settings/", {"whatsapp_number": "+٩٦٢ ٧٩ ١٢٣ ٤٥٦٧"}, format="json")
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.data["whatsapp_number"], "962791234567")
        self.assertEqual(SiteSettings.load().whatsapp_number, "962791234567")
        cleared = client.patch("/api/v1/admin/settings/", {"whatsapp_number": ""}, format="json")
        self.assertEqual(cleared.data["whatsapp_number"], "")


class FaqSeedTests(TestCase):
    def test_migrated_db_has_bilingual_faqs(self):
        faqs = FAQ.objects.filter(published=True)
        self.assertGreaterEqual(faqs.count(), 8)
        self.assertFalse(faqs.filter(question_ar="").exists())
        self.assertFalse(faqs.filter(answer_ar="").exists())
        self.assertTrue(faqs.filter(answer_en__icontains="PayPal").exists())
        self.assertTrue(faqs.filter(answer_en__icontains="USD").exists())

    def test_migration_skips_when_faqs_exist_and_never_duplicates(self):
        mod = importlib.import_module("cms.migrations.0006_footer_pages_and_faqs")
        before = FAQ.objects.count()
        mod.forwards(global_apps, None)
        self.assertEqual(FAQ.objects.count(), before)
        FAQ.objects.all().delete()
        FAQ.objects.create(question_en="How fast is delivery?", answer_en="Fast.", published=True)
        mod.forwards(global_apps, None)
        self.assertEqual(FAQ.objects.filter(question_en="How fast is delivery?").count(), 1)
        self.assertEqual(FAQ.objects.count(), len(mod.FAQS))
