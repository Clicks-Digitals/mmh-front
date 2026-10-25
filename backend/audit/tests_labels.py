"""Readable labels for the panel: audit targets, variant names in code/import/mapping payloads, duplicate messages."""

from __future__ import annotations

from django.test import TestCase

from accounts.models import AdminRole
from accounts.tests_admin import auth_client, make_admin, seed_permissions
from audit.services import entity_label, record_audit, variant_display_name
from catalog.models import Category, Platform, PublishStatus
from catalog.tests_storefront import add_code, make_product, make_variant
from commerce.models import CodeImportBatch
from suppliers.models import Supplier, SupplierProductMapping


class PanelLabelTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        cls.admin = make_admin("labels-admin@mmh.test", AdminRole.ADMIN)
        cls.category = Category.objects.create(slug="lcat", name_en="LCat", status=PublishStatus.PUBLISHED)
        cls.platform = Platform.objects.create(slug="lplat", name_en="LPlat", status=PublishStatus.PUBLISHED)
        cls.product = make_product("pubg-mobile", cls.category, cls.platform)
        cls.product.name_en = "PUBG Mobile"
        cls.product.save(update_fields=["name_en"])
        cls.variant = make_variant(cls.product, "PUBG-60")
        cls.variant.name_en = "60 UC"
        cls.variant.save(update_fields=["name_en"])
        cls.variant_b = make_variant(cls.product, "PUBG-325")
        cls.variant_b.name_en = "325 UC"
        cls.variant_b.save(update_fields=["name_en"])

    def test_variant_display_name(self):
        self.assertEqual(variant_display_name("PUBG Mobile", "60 UC"), "PUBG Mobile – 60 UC")
        self.assertEqual(variant_display_name("", "60 UC"), "60 UC")
        self.assertEqual(variant_display_name("PUBG Mobile", ""), "PUBG Mobile")

    def test_variant_entity_label_uses_product_and_option_names(self):
        one = record_audit(self.admin, "catalog.variant.updated", entity_type="ProductVariant", entity_id=self.variant.pk)
        self.assertEqual(entity_label(one), "PUBG Mobile – 60 UC")
        several = record_audit(
            None,
            "orders.waiting_delivered",
            entity_type="ProductVariant",
            entity_id=f"{self.variant.pk},{self.variant_b.pk}",
        )
        self.assertEqual(entity_label(several), "PUBG Mobile – 60 UC, PUBG Mobile – 325 UC")

    def test_deleted_variant_falls_back_to_meta_or_id(self):
        gone = record_audit(
            None,
            "catalog.variant.deleted",
            entity_type="ProductVariant",
            entity_id=999999,
            meta={"product_name": "Free Fire", "name_en": "100 Diamonds"},
        )
        self.assertEqual(entity_label(gone), "Free Fire – 100 Diamonds")
        bare = record_audit(None, "catalog.variant.deleted", entity_type="ProductVariant", entity_id=999998)
        self.assertEqual(entity_label(bare), "Product option #999998")

    def test_audit_api_returns_variant_label(self):
        record_audit(self.admin, "catalog.variant.updated", entity_type="ProductVariant", entity_id=self.variant.pk)
        res = auth_client(self.admin).get("/api/v1/admin/audit/?entity_type=ProductVariant")
        self.assertEqual(res.status_code, 200)
        labels = [row["entity_label"] for row in res.json()["results"]]
        self.assertIn("PUBG Mobile – 60 UC", labels)

    def test_codes_and_import_batches_include_product_name(self):
        add_code(self.variant)
        CodeImportBatch.objects.create(filename="codes.csv", variant=self.variant, uploaded_by=self.admin)
        client = auth_client(self.admin)
        codes = client.get(f"/api/v1/admin/codes/?variant={self.variant.pk}").json()["results"]
        self.assertEqual(codes[0]["product_name"], "PUBG Mobile")
        self.assertEqual(codes[0]["variant_name"], "60 UC")
        batches = client.get("/api/v1/admin/codes/imports/").json()["results"]
        self.assertEqual(batches[0]["product_name"], "PUBG Mobile")
        self.assertEqual(batches[0]["variant_name"], "60 UC")
        self.assertEqual(batches[0]["variant_sku"], "PUBG-60")

    def test_supplier_detail_mappings_include_names(self):
        supplier = Supplier.objects.create(slug="lsup", name="LSup", active=True)
        SupplierProductMapping.objects.create(
            supplier=supplier, product=self.product, variant=self.variant, external_product_id="X-60"
        )
        SupplierProductMapping.objects.create(supplier=supplier, product=self.product, external_product_id="X-ALL")
        res = auth_client(self.admin).get(f"/api/v1/admin/suppliers/{supplier.pk}/")
        self.assertEqual(res.status_code, 200)
        rows = {row["external_product_id"]: row for row in res.json()["mappings"]}
        self.assertEqual(rows["X-60"]["product_name"], "PUBG Mobile")
        self.assertEqual(rows["X-60"]["variant_name"], "60 UC")
        self.assertEqual(rows["X-60"]["variant_sku"], "PUBG-60")
        self.assertIsNone(rows["X-ALL"]["variant_name"])

    def test_duplicate_product_slug_message_is_plain(self):
        res = auth_client(self.admin).post(
            "/api/v1/admin/products/",
            {
                "id": "another-id",
                "slug": "pubg-mobile",
                "kind": "GIFT_CARD",
                "fulfillment_type": "CODE",
                "category_id": self.category.id,
                "platform_id": self.platform.id,
                "brand": "X",
                "artwork_key": "x",
                "name_en": "Dup",
                "status": "DRAFT",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("Another product already uses this web address.", res.content.decode())
        self.assertNotIn("product with this slug already exists", res.content.decode())
