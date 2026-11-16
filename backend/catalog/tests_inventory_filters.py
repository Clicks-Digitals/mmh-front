"""Inventory filters: options by category (with sub-categories) and by region."""

from __future__ import annotations

from accounts.models import AdminRole
from accounts.tests_admin import auth_client, make_admin, seed_permissions
from catalog.models import Category, Platform, PublishStatus, Region
from catalog.tests_storefront import make_product, make_variant
from cms.models import SiteSettings
from django.test import TestCase


class VariantFilterTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        SiteSettings.load()
        cls.admin = make_admin("inv-admin@mmh.test", AdminRole.ADMIN)
        platform = Platform.objects.create(slug="inv-ps", name_en="PlayStation", status=PublishStatus.PUBLISHED)
        top = Category.objects.create(slug="inv-ps-top", name_en="PlayStation", status=PublishStatus.PUBLISHED)
        child = Category.objects.create(slug="inv-ps-cards", name_en="Cards", parent=top, status=PublishStatus.PUBLISHED)
        other = Category.objects.create(slug="inv-other", name_en="Other", status=PublishStatus.PUBLISHED)
        cls.us = Region.objects.create(slug="inv-us", currency="USD", name_en="US")
        cls.uae = Region.objects.create(slug="inv-uae", currency="USD", name_en="UAE")
        cls.ps_card = make_product("inv-psn", child, platform)
        cls.other = make_product("inv-other-p", other, platform)
        make_variant(cls.ps_card, "INV-US", region=cls.us)
        make_variant(cls.ps_card, "INV-UAE", region=cls.uae)
        make_variant(cls.other, "INV-OTHER")

    def skus(self, query: str) -> set[str]:
        res = auth_client(self.admin).get(f"/api/v1/admin/variants/?page_size=100&{query}")
        self.assertEqual(res.status_code, 200, res.content)
        rows = res.data["results"] if isinstance(res.data, dict) else res.data
        return {row["sku"] for row in rows if str(row["sku"]).startswith("INV-")}

    def test_category_includes_sub_categories(self):
        self.assertEqual(self.skus("category=inv-ps-top"), {"INV-US", "INV-UAE"})
        self.assertEqual(self.skus("category=inv-other"), {"INV-OTHER"})

    def test_region_by_slug_id_and_none(self):
        self.assertEqual(self.skus("region=inv-uae"), {"INV-UAE"})
        self.assertEqual(self.skus(f"region={self.us.id}"), {"INV-US"})
        self.assertEqual(self.skus("region=none"), {"INV-OTHER"})

    def test_category_and_region_together(self):
        self.assertEqual(self.skus("category=inv-ps-top&region=inv-us"), {"INV-US"})
