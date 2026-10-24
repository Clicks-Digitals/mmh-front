from __future__ import annotations

from datetime import timedelta
from io import BytesIO

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from PIL import Image

from accounts.models import AdminRole
from accounts.tests_admin import auth_client, make_admin, seed_permissions
from audit.models import AuditLog
from cms.models import Banner, ContentPage, FAQ, SiteSettings

BANNER_FIELDS = {
    "id",
    "placement",
    "title_en",
    "title_ar",
    "subtitle_en",
    "subtitle_ar",
    "kicker",
    "href",
    "tone",
    "desktop_image",
    "mobile_image",
    "sort_order",
}


class PublicBannerTests(TestCase):
    def test_only_published_within_window(self):
        now = timezone.now()
        Banner.objects.create(href="/a", title_en="always", published=True, sort_order=2)
        Banner.objects.create(
            href="/b", title_en="window", published=True, start_at=now - timedelta(days=1), end_at=now + timedelta(days=1)
        )
        Banner.objects.create(href="/c", title_en="future", published=True, start_at=now + timedelta(hours=1))
        Banner.objects.create(href="/d", title_en="expired", published=True, end_at=now - timedelta(minutes=1))
        Banner.objects.create(href="/e", title_en="draft", published=False)
        res = self.client.get("/api/v1/cms/banners/")
        self.assertEqual(res.status_code, 200)
        titles = [b["title_en"] for b in res.json()]
        self.assertEqual(titles, ["window", "always"])
        self.assertEqual(set(res.json()[0].keys()), BANNER_FIELDS)

    def test_placement_filter_and_absolute_media(self):
        Banner.objects.create(
            href="/a",
            title_en="home",
            published=True,
            placement="HOME",
            desktop_image="/media/uploads/d.png",
            mobile_image="/home/m.jpg",
        )
        Banner.objects.create(href="/b", title_en="shop", published=True, placement="SHOP")
        rows = self.client.get("/api/v1/cms/banners/?placement=home").json()
        self.assertEqual([r["title_en"] for r in rows], ["home"])
        self.assertEqual(rows[0]["desktop_image"], "http://testserver/media/uploads/d.png")
        self.assertEqual(rows[0]["mobile_image"], "/home/m.jpg")


class PublicPagesAndFaqTests(TestCase):
    def test_page_detail_and_list(self):
        ContentPage.objects.create(slug="terms", title_en="Terms", title_ar="الشروط", body_en="b", body_ar="ب")
        ContentPage.objects.create(slug="hidden", title_en="Hidden", body_en="x", published=False)
        res = self.client.get("/api/v1/cms/pages/terms/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(set(res.json()), {"slug", "title_en", "title_ar", "body_en", "body_ar", "updated_at"})
        self.assertEqual(self.client.get("/api/v1/cms/pages/hidden/").status_code, 404)
        rows = self.client.get("/api/v1/cms/pages/").json()
        self.assertEqual(
            rows,
            [{"slug": "terms", "title_en": "Terms", "title_ar": "الشروط", "show_in_footer": False, "sort_order": 0}],
        )

    def test_faq_fields(self):
        FAQ.objects.all().delete()  # drop the FAQs seeded by cms migration 0006
        FAQ.objects.create(question_en="Q", answer_en="A", published=True)
        FAQ.objects.create(question_en="Hidden", answer_en="A", published=False)
        rows = self.client.get("/api/v1/cms/faqs/").json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(set(rows[0]), {"id", "question_en", "question_ar", "answer_en", "answer_ar", "sort_order"})


class AdminCmsAuditTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        cls.content = make_admin("cms-content@mmh.test", AdminRole.CONTENT_MANAGER)
        cls.admin = make_admin("cms-admin@mmh.test", AdminRole.ADMIN)

    def test_banner_crud_audited(self):
        client = auth_client(self.content)
        res = client.post("/api/v1/admin/banners/", {"href": "/x", "title_en": "X", "published": True}, format="json")
        self.assertEqual(res.status_code, 201)
        bid = res.data["id"]
        self.assertIn("desktop_image_url", res.data)
        self.assertIn("start_at", res.data)
        client.patch(f"/api/v1/admin/banners/{bid}/", {"title_en": "Y"}, format="json")
        client.delete(f"/api/v1/admin/banners/{bid}/")
        actions = set(AuditLog.objects.filter(entity_type="Banner", entity_id=str(bid)).values_list("action", flat=True))
        self.assertEqual(actions, {"cms.banner.created", "cms.banner.updated", "cms.banner.deleted"})

    def test_banner_window_validation(self):
        now = timezone.now()
        res = auth_client(self.content).post(
            "/api/v1/admin/banners/",
            {"href": "/x", "title_en": "X", "start_at": now.isoformat(), "end_at": (now - timedelta(days=1)).isoformat()},
            format="json",
        )
        self.assertEqual(res.status_code, 400)

    def test_banner_image_upload(self):
        banner = Banner.objects.create(href="/x", title_en="X")
        buf = BytesIO()
        Image.new("RGB", (3, 3), (9, 9, 9)).save(buf, format="PNG")
        up = SimpleUploadedFile("b.png", buf.getvalue(), content_type="image/png")
        res = auth_client(self.content).post(
            f"/api/v1/admin/banners/{banner.pk}/image/", {"file": up, "target": "mobile"}, format="multipart"
        )
        self.assertEqual(res.status_code, 200, res.content)
        banner.refresh_from_db()
        self.assertTrue(banner.mobile_image.startswith("/media/uploads/"))
        self.assertTrue(res.data["mobile_image_url"].startswith("http://testserver/media/uploads/"))
        self.assertTrue(AuditLog.objects.filter(action="cms.banner.image_uploaded").exists())
        bad = auth_client(self.content).post(
            f"/api/v1/admin/banners/{banner.pk}/image/", {"target": "side"}, format="multipart"
        )
        self.assertEqual(bad.status_code, 400)

    def test_faq_and_page_crud_audited(self):
        client = auth_client(self.content)
        faq = client.post("/api/v1/admin/faqs/", {"question_en": "Q", "answer_en": "A"}, format="json")
        self.assertEqual(faq.status_code, 201)
        page = client.post("/api/v1/admin/pages/", {"slug": "about", "title_en": "About", "body_en": "b"}, format="json")
        self.assertEqual(page.status_code, 201)
        client.patch("/api/v1/admin/pages/about/", {"published": False}, format="json")
        self.assertTrue(AuditLog.objects.filter(action="cms.faq.created").exists())
        self.assertTrue(AuditLog.objects.filter(action="cms.page.created").exists())
        self.assertTrue(AuditLog.objects.filter(action="cms.page.updated").exists())

    def test_settings_changes_audited_and_currency_display_gone(self):
        client = auth_client(self.admin)
        res = client.patch(
            "/api/v1/admin/settings/", {"store_name": "MMH X", "currency_display": "USD"}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        self.assertNotIn("currency_display", res.data)
        entry = AuditLog.objects.get(action="settings.updated")
        self.assertEqual(entry.meta["fields"], ["store_name"])
        self.assertEqual(entry.meta["changes"]["store_name"]["to"], "MMH X")
        self.assertFalse(hasattr(SiteSettings.load(), "currency_display"))
        public = self.client.get("/api/v1/cms/settings/").json()
        self.assertEqual(public["store_name"], "MMH X")
        self.assertIs(public["maintenance_mode"], False)
        self.assertNotIn("low_stock_threshold", public)
