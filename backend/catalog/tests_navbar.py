"""Navbar links: categories and products staff flag with show_in_navbar."""

from __future__ import annotations

from accounts.models import AdminRole
from accounts.tests_admin import auth_client, make_admin, seed_permissions
from catalog.models import Category, Platform, PublishStatus
from catalog.tests_storefront import make_product, make_variant
from cms.models import SiteSettings
from django.test import TestCase
from rest_framework.test import APIClient


class NavbarFlagTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        SiteSettings.load()
        cls.admin = make_admin("nav-admin@mmh.test", AdminRole.ADMIN)
        platform = Platform.objects.create(slug="nav-ps", name_en="PlayStation", status=PublishStatus.PUBLISHED)
        cls.category = Category.objects.create(slug="nav-cat", name_en="Cards", status=PublishStatus.PUBLISHED)
        cls.product = make_product("nav-prod", cls.category, platform)
        make_variant(cls.product, "NAV-1")

    def test_admin_sets_flag_and_store_reads_it(self):
        admin = auth_client(self.admin)
        res = admin.patch(f"/api/v1/admin/categories/{self.category.id}/", {"show_in_navbar": True}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        res = admin.patch("/api/v1/admin/products/nav-prod/", {"show_in_navbar": True}, format="json")
        self.assertEqual(res.status_code, 200, res.content)

        public = APIClient()
        cats = public.get("/api/v1/catalog/categories/").json()
        cats = cats["results"] if isinstance(cats, dict) else cats
        self.assertTrue(next(c for c in cats if c["slug"] == "nav-cat")["show_in_navbar"])
        prods = public.get("/api/v1/catalog/products/?page_size=100").json()
        prods = prods["results"] if isinstance(prods, dict) else prods
        self.assertTrue(next(p for p in prods if p["slug"] == "nav-prod")["show_in_navbar"])

    def test_defaults_off(self):
        self.assertFalse(Category.objects.get(slug="nav-cat").show_in_navbar)
        self.assertFalse(self.product.show_in_navbar)
