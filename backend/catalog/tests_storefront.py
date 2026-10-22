"""Effective stock, public catalog visibility/filters, admin writable fields, archive & deletes."""

from __future__ import annotations

from io import BytesIO

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from PIL import Image

from accounts.models import AdminRole
from accounts.tests_admin import auth_client, make_admin, seed_permissions
from audit.models import AuditLog
from catalog.models import (
    Category,
    FulfillmentType,
    Platform,
    Product,
    ProductKind,
    ProductVariant,
    PublishStatus,
    Region,
    StockStatus,
)
from catalog.stock import available_code_counts, compute_effective_status, effective_stock_status
from cms.models import SiteSettings
from commerce.crypto import encrypt_code
from commerce.models import DigitalCode, DigitalCodeStatus, Order, OrderItem, PaymentStatus
from config.pagination import LargePageNumberPagination
from suppliers.models import Supplier, SupplierProductMapping

_counter = {"n": 0}


def add_code(variant, status=DigitalCodeStatus.AVAILABLE, order_item=None):
    _counter["n"] += 1
    ct, nonce, masked = encrypt_code(f"CODE-{_counter['n']}-XYZ")
    return DigitalCode.objects.create(
        variant=variant, status=status, ciphertext=ct, nonce=nonce, masked=masked, order_item=order_item
    )


def make_product(pid, category, platform, *, fulfillment=FulfillmentType.CODE, status=PublishStatus.PUBLISHED, **kw):
    return Product.objects.create(
        id=pid,
        slug=pid,
        kind=ProductKind.GIFT_CARD,
        fulfillment_type=fulfillment,
        category=category,
        platform=platform,
        brand="B",
        artwork_key="a",
        status=status,
        name_en=pid.title(),
        **kw,
    )


def make_variant(product, sku, *, region=None, stock=StockStatus.IN_STOCK, price=1000, published=True):
    return ProductVariant.objects.create(
        product=product,
        sku=sku,
        denomination=10,
        package_value="10",
        package_currency="USD",
        price_fils=price,
        stock_status=stock,
        name_en=sku,
        region=region,
        published=published,
    )


def make_order_item(variant):
    order = Order.objects.create(
        order_number=f"T{variant.pk}X{_counter['n']}",
        email="o@example.com",
        full_name="O",
        total_fils=variant.price_fils,
        payment_status=PaymentStatus.PAID,
    )
    return OrderItem.objects.create(
        order=order,
        product=variant.product,
        variant=variant,
        quantity=1,
        unit_price_fils=variant.price_fils,
        line_total_fils=variant.price_fils,
        product_name=variant.product.name_en,
        variant_name=variant.name_en,
    )


class Base(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        SiteSettings.load()
        cls.admin = make_admin("sf-admin@mmh.test", AdminRole.ADMIN)
        cls.category = Category.objects.create(slug="cards", name_en="Cards", status=PublishStatus.PUBLISHED)
        cls.platform = Platform.objects.create(slug="steam", name_en="Steam", status=PublishStatus.PUBLISHED)
        cls.region = Region.objects.create(slug="us", currency="USD", name_en="United States", name_ar="أمريكا")
        cls.supplier = Supplier.objects.create(slug="1epin", name="1Epin", active=True)


class EffectiveStockTests(Base):
    def setUp(self):
        self.product = make_product("stock-p", self.category, self.platform)
        self.variant = make_variant(self.product, "STOCK-1", region=self.region)

    def _public(self):
        res = self.client.get(f"/api/v1/catalog/products/{self.product.slug}/")
        self.assertEqual(res.status_code, 200)
        return res.json()

    def test_code_variant_without_codes_is_out_of_stock(self):
        body = self._public()
        v = body["variants"][0]
        self.assertEqual(v["stock_status"], "OUT_OF_STOCK")
        self.assertFalse(v["available"])
        self.assertFalse(body["in_stock"])

    def test_available_code_makes_in_stock(self):
        add_code(self.variant)
        body = self._public()
        self.assertEqual(body["variants"][0]["stock_status"], "IN_STOCK")
        self.assertTrue(body["variants"][0]["available"])
        self.assertTrue(body["in_stock"])

    def test_assigned_or_non_available_codes_do_not_count(self):
        add_code(self.variant, status=DigitalCodeStatus.DELIVERED)
        add_code(self.variant, status=DigitalCodeStatus.RESERVED)
        add_code(self.variant, order_item=make_order_item(self.variant))
        self.assertEqual(available_code_counts([self.variant.pk]), {self.variant.pk: 0})
        self.assertEqual(self._public()["variants"][0]["stock_status"], "OUT_OF_STOCK")

    def test_manual_out_of_stock_wins(self):
        add_code(self.variant)
        ProductVariant.objects.filter(pk=self.variant.pk).update(stock_status=StockStatus.OUT_OF_STOCK)
        body = self._public()
        self.assertEqual(body["variants"][0]["stock_status"], "OUT_OF_STOCK")
        self.assertFalse(body["in_stock"])

    def test_active_supplier_mapping_makes_in_stock(self):
        mapping = SupplierProductMapping.objects.create(
            supplier=self.supplier, product=self.product, variant=self.variant, external_product_id="X1"
        )
        self.assertEqual(self._public()["variants"][0]["stock_status"], "IN_STOCK")
        mapping.ignored = True
        mapping.save()
        self.assertEqual(self._public()["variants"][0]["stock_status"], "OUT_OF_STOCK")
        mapping.ignored = False
        mapping.save()
        Supplier.objects.filter(pk=self.supplier.pk).update(active=False)
        self.assertEqual(self._public()["variants"][0]["stock_status"], "OUT_OF_STOCK")

    def test_direct_topup_uses_manual_status(self):
        topup = make_product("topup-p", self.category, self.platform, fulfillment=FulfillmentType.DIRECT_TOPUP)
        v = make_variant(topup, "TOPUP-1")
        self.assertEqual(effective_stock_status(v), StockStatus.IN_STOCK)
        res = self.client.get("/api/v1/catalog/products/topup-p/").json()
        self.assertTrue(res["variants"][0]["available"])
        ProductVariant.objects.filter(pk=v.pk).update(stock_status=StockStatus.OUT_OF_STOCK)
        res = self.client.get("/api/v1/catalog/products/topup-p/").json()
        self.assertEqual(res["variants"][0]["stock_status"], "OUT_OF_STOCK")
        self.assertFalse(res["in_stock"])

    def test_compute_rules(self):
        f = compute_effective_status
        self.assertEqual(f(fulfillment_type="CODE", manual_status="IN_STOCK", available_codes=0, has_supplier_mapping=False), "OUT_OF_STOCK")
        self.assertEqual(f(fulfillment_type="CODE", manual_status="UNKNOWN", available_codes=2, has_supplier_mapping=False), "IN_STOCK")
        self.assertEqual(f(fulfillment_type="CODE", manual_status="OUT_OF_STOCK", available_codes=2, has_supplier_mapping=True), "OUT_OF_STOCK")

    def test_public_variant_exposes_region_currency(self):
        v = self._public()["variants"][0]
        self.assertEqual(v["region"], {"slug": "us", "name_en": "United States", "name_ar": "أمريكا", "currency": "USD"})
        self.assertEqual(v["region_slug"], "us")
        self.assertNotIn("cost_fils", v)

    def test_admin_variant_stock_fields(self):
        add_code(self.variant)
        client = auth_client(self.admin)
        res = client.get(f"/api/v1/admin/variants/{self.variant.pk}/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["available_codes"], 1)
        self.assertEqual(res.data["effective_stock_status"], "IN_STOCK")
        res = client.patch(f"/api/v1/admin/variants/{self.variant.pk}/", {"stock_status": "OUT_OF_STOCK"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["stock_status"], "OUT_OF_STOCK")
        self.assertEqual(res.data["effective_stock_status"], "OUT_OF_STOCK")
        self.assertEqual(res.data["available_codes"], 1)
        detail = client.get(f"/api/v1/admin/products/{self.product.slug}/").data
        self.assertEqual(detail["variants"][0]["effective_stock_status"], "OUT_OF_STOCK")


class PublicCatalogTests(Base):
    def test_region_filter_is_distinct(self):
        p = make_product("multi-region", self.category, self.platform)
        make_variant(p, "MR-1", region=self.region)
        make_variant(p, "MR-2", region=self.region)
        res = self.client.get("/api/v1/catalog/products/?region=us").json()
        self.assertEqual([r["slug"] for r in res["results"]], ["multi-region"])
        self.assertEqual(res["count"], 1)

    def test_supplier_and_stock_filters_ignored_publicly(self):
        p = make_product("plain", self.category, self.platform)
        make_variant(p, "PL-1")
        res = self.client.get("/api/v1/catalog/products/?supplier=nope&stock=out_of_stock&status=DRAFT").json()
        self.assertEqual(res["count"], 1)

    def test_hidden_when_category_or_platform_not_published(self):
        archived_cat = Category.objects.create(slug="old", name_en="Old", status=PublishStatus.ARCHIVED)
        draft_plat = Platform.objects.create(slug="draftp", name_en="D", status=PublishStatus.DRAFT)
        make_product("in-archived-cat", archived_cat, self.platform)
        make_product("in-draft-plat", self.category, draft_plat)
        make_product("visible", self.category, self.platform)
        slugs = [r["slug"] for r in self.client.get("/api/v1/catalog/products/").json()["results"]]
        self.assertEqual(slugs, ["visible"])
        self.assertEqual(self.client.get("/api/v1/catalog/products/in-archived-cat/").status_code, 404)
        self.assertEqual(self.client.get("/api/v1/catalog/products/in-draft-plat/").status_code, 404)
        plats = [p["slug"] for p in self.client.get("/api/v1/catalog/platforms/").json()]
        self.assertNotIn("draftp", plats)

    def test_draft_and_archived_products_hidden(self):
        make_product("draft-p", self.category, self.platform, status=PublishStatus.DRAFT)
        make_product("arch-p", self.category, self.platform, status=PublishStatus.ARCHIVED)
        self.assertEqual(self.client.get("/api/v1/catalog/products/").json()["count"], 0)

    def test_pagination_page_size_up_to_200_and_next(self):
        for i in range(3):
            make_product(f"pg-{i}", self.category, self.platform)
        res = self.client.get("/api/v1/catalog/products/?page_size=2").json()
        self.assertEqual(len(res["results"]), 2)
        self.assertIsNotNone(res["next"])
        self.assertIn("page=2", res["next"])
        nxt = self.client.get(res["next"]).json()
        self.assertEqual(len(nxt["results"]), 1)
        self.assertIsNone(nxt["next"])
        self.assertEqual(LargePageNumberPagination.max_page_size, 200)
        self.assertEqual(len(self.client.get("/api/v1/catalog/products/?page_size=150").json()["results"]), 3)

    def test_platforms_sorted_by_sort_order(self):
        Platform.objects.create(slug="aaa", name_en="A", sort_order=5)
        Platform.objects.create(slug="zzz", name_en="Z", sort_order=-1)
        slugs = [p["slug"] for p in self.client.get("/api/v1/catalog/platforms/").json()]
        self.assertEqual(slugs, ["zzz", "steam", "aaa"])
        self.assertIn("sort_order", self.client.get("/api/v1/catalog/platforms/").json()[0])

    def test_primary_image_url_empty_without_media(self):
        make_product("noimg", self.category, self.platform)
        make_product("withimg", self.category, self.platform, image_url="/catalog/psn.webp")
        rows = {r["slug"]: r for r in self.client.get("/api/v1/catalog/products/").json()["results"]}
        self.assertEqual(rows["noimg"]["primary_image_url"], "")
        self.assertEqual(rows["withimg"]["primary_image_url"], "/catalog/psn.webp")

    def test_public_category_shape(self):
        parent = self.category
        child = Category.objects.create(
            slug="psn-cards",
            name_en="PSN",
            name_ar="بلايستيشن",
            description_en="d-en",
            description_ar="d-ar",
            parent=parent,
            artwork_url="/media/uploads/c.png",
            sort_order=3,
        )
        rows = {c["slug"]: c for c in self.client.get("/api/v1/catalog/categories/").json()}
        c = rows["psn-cards"]
        self.assertEqual(c["parent"], "cards")
        self.assertEqual(c["name_ar"], "بلايستيشن")
        self.assertEqual(c["description_ar"], "d-ar")
        self.assertEqual(c["href"], "/category/psn-cards")
        self.assertTrue(c["artwork_url"].startswith("http://testserver/media/"))
        self.assertIsNone(rows["cards"]["parent"])
        self.assertNotIn("products_count", c)
        self.assertEqual(child.parent_id, parent.id)


class AdminProductTests(Base):
    def setUp(self):
        self.product = make_product("adm-p", self.category, self.platform)
        self.variant = make_variant(self.product, "ADM-1")
        self.client_admin = auth_client(self.admin)

    def test_all_storefront_fields_writable(self):
        payload = {
            "name_ar": "منتج",
            "short_description_ar": "قصير",
            "description_ar": "وصف",
            "instructions_en": "Do this",
            "instructions_ar": "افعل",
            "how_to_use_en": ["Step 1", "Step 2"],
            "how_to_use_ar": ["خطوة"],
            "region_warning_en": "US only",
            "region_warning_ar": "أمريكا فقط",
            "region_restrictions_en": "No EU",
            "region_restrictions_ar": "لا أوروبا",
            "delivery_estimate_en": "Instant",
            "delivery_estimate_ar": "فوري",
            "refund_policy_en": "No refunds",
            "refund_policy_ar": "لا استرجاع",
            "refundable": True,
            "badges": ["instant"],
            "tags": ["steam", "pc"],
            "sort_order": 7,
            "image_url": "/catalog/x.webp",
            "variants": [
                {
                    "id": self.variant.pk,
                    "compare_at_price_fils": 1500,
                    "denomination": "25.00",
                    "package_value": "25",
                    "package_currency": "EUR",
                    "min_quantity": 2,
                    "max_quantity": 9,
                    "published": False,
                    "stock_status": "OUT_OF_STOCK",
                    "cost_fils": 700,
                    "region": self.region.pk,
                }
            ],
        }
        res = self.client_admin.patch(f"/api/v1/admin/products/{self.product.slug}/", payload, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        p = Product.objects.get(pk=self.product.pk)
        for key, value in payload.items():
            if key != "variants":
                self.assertEqual(getattr(p, key), value, key)
        v = ProductVariant.objects.get(pk=self.variant.pk)
        self.assertEqual(v.compare_at_price_fils, 1500)
        self.assertEqual(str(v.denomination), "25.00")
        self.assertEqual((v.package_value, v.package_currency), ("25", "EUR"))
        self.assertEqual((v.min_quantity, v.max_quantity), (2, 9))
        self.assertFalse(v.published)
        self.assertEqual(v.stock_status, StockStatus.OUT_OF_STOCK)
        self.assertEqual(v.cost_fils, 700)
        self.assertEqual(v.region_id, self.region.pk)
        self.assertTrue(AuditLog.objects.filter(action="product.updated", entity_id="adm-p").exists())

    def test_min_greater_than_max_rejected(self):
        res = self.client_admin.patch(
            f"/api/v1/admin/products/{self.product.slug}/",
            {"variants": [{"id": self.variant.pk, "min_quantity": 6, "max_quantity": 2}]},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        res = self.client_admin.patch(f"/api/v1/admin/variants/{self.variant.pk}/", {"min_quantity": 9}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_archive_and_unarchive(self):
        res = self.client_admin.post(f"/api/v1/admin/products/{self.product.slug}/archive/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "ARCHIVED")
        self.assertTrue(AuditLog.objects.filter(action="product.archived", entity_id="adm-p").exists())
        self.assertEqual(self.client.get("/api/v1/catalog/products/adm-p/").status_code, 404)
        res = self.client_admin.post(f"/api/v1/admin/products/{self.product.slug}/unarchive/")
        self.assertEqual(res.data["status"], "DRAFT")
        self.assertTrue(AuditLog.objects.filter(action="product.unarchived", entity_id="adm-p").exists())
        viewer = make_admin("sf-viewer@mmh.test", AdminRole.VIEWER)
        self.assertEqual(auth_client(viewer).post(f"/api/v1/admin/products/{self.product.slug}/archive/").status_code, 403)

    def test_delete_with_history_is_409(self):
        add_code(self.variant)
        res = self.client_admin.delete(f"/api/v1/admin/products/{self.product.slug}/")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["code"], "conflict")
        self.assertTrue(Product.objects.filter(pk=self.product.pk).exists())
        self.assertEqual(Product.objects.get(pk=self.product.pk).status, PublishStatus.PUBLISHED)

    def test_delete_with_order_history_is_409(self):
        make_order_item(self.variant)
        self.assertEqual(self.client_admin.delete(f"/api/v1/admin/products/{self.product.slug}/").status_code, 409)

    def test_delete_without_history(self):
        res = self.client_admin.delete(f"/api/v1/admin/products/{self.product.slug}/")
        self.assertEqual(res.status_code, 204)
        self.assertFalse(Product.objects.filter(pk="adm-p").exists())
        self.assertTrue(AuditLog.objects.filter(action="product.deleted", entity_id="adm-p").exists())

    def test_variant_delete_protected(self):
        add_code(self.variant)
        res = self.client_admin.delete(f"/api/v1/admin/variants/{self.variant.pk}/")
        self.assertEqual(res.status_code, 409)
        self.assertIn("detail", res.data)
        other = make_variant(self.product, "ADM-2")
        make_order_item(other)
        self.assertEqual(self.client_admin.delete(f"/api/v1/admin/variants/{other.pk}/").status_code, 409)
        free = make_variant(self.product, "ADM-3")
        self.assertEqual(self.client_admin.delete(f"/api/v1/admin/variants/{free.pk}/").status_code, 204)
        self.assertTrue(AuditLog.objects.filter(action="catalog.variant.deleted", entity_id=str(free.pk)).exists())

    def test_variant_create_via_variants_endpoint(self):
        res = self.client_admin.post(
            "/api/v1/admin/variants/",
            {
                "product": self.product.pk,
                "sku": "ADM-NEW",
                "denomination": "5",
                "package_value": "5",
                "package_currency": "USD",
                "price_fils": 4000,
                "name_en": "5",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["sku"], "ADM-NEW")
        self.assertIn("effective_stock_status", res.data)
        self.assertTrue(AuditLog.objects.filter(action="catalog.variant.created").exists())
        missing = self.client_admin.post(
            "/api/v1/admin/variants/",
            {"sku": "ADM-X", "denomination": "5", "package_value": "5", "package_currency": "USD", "price_fils": 1, "name_en": "x"},
            format="json",
        )
        self.assertEqual(missing.status_code, 400)

    def test_category_admin_fields_and_audit(self):
        res = self.client_admin.post(
            "/api/v1/admin/categories/",
            {
                "slug": "sub",
                "name_en": "Sub",
                "name_ar": "فرعي",
                "description_en": "en",
                "description_ar": "ar",
                "parent": self.category.pk,
                "artwork_key": "art",
                "artwork_url": "/media/uploads/a.png",
                "sort_order": 4,
                "status": "PUBLISHED",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["parent"], self.category.pk)
        self.assertEqual(res.data["parent_slug"], "cards")
        sub_id = res.data["id"]
        self.assertTrue(AuditLog.objects.filter(action="catalog.category.created", entity_id=str(sub_id)).exists())
        cycle = self.client_admin.patch(f"/api/v1/admin/categories/{self.category.pk}/", {"parent": sub_id}, format="json")
        self.assertEqual(cycle.status_code, 400)
        self.client_admin.patch(f"/api/v1/admin/categories/{sub_id}/", {"name_ar": "x"}, format="json")
        self.assertTrue(AuditLog.objects.filter(action="catalog.category.updated", entity_id=str(sub_id)).exists())
        self.assertEqual(self.client_admin.delete(f"/api/v1/admin/categories/{sub_id}/").status_code, 204)
        self.assertTrue(AuditLog.objects.filter(action="catalog.category.deleted", entity_id=str(sub_id)).exists())

    def test_platform_and_region_crud_audited(self):
        res = self.client_admin.post("/api/v1/admin/platforms/", {"slug": "xbox", "name_en": "Xbox"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertTrue(AuditLog.objects.filter(action="catalog.platform.created").exists())
        res = self.client_admin.post("/api/v1/admin/regions/", {"slug": "eu", "name_en": "EU", "currency": "EUR"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertTrue(AuditLog.objects.filter(action="catalog.region.created").exists())

    def test_product_create_audited(self):
        res = self.client_admin.post(
            "/api/v1/admin/products/",
            {
                "id": "new-p",
                "slug": "new-p",
                "kind": "GIFT_CARD",
                "fulfillment_type": "CODE",
                "category_id": self.category.pk,
                "platform_id": self.platform.pk,
                "brand": "B",
                "artwork_key": "a",
                "name_en": "New",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertTrue(AuditLog.objects.filter(action="product.created", entity_id="new-p").exists())

    def test_media_upload_and_delete_audited(self):
        buf = BytesIO()
        Image.new("RGB", (4, 4), (1, 2, 3)).save(buf, format="PNG")
        up = SimpleUploadedFile("m.png", buf.getvalue(), content_type="image/png")
        res = self.client_admin.post(f"/api/v1/admin/products/{self.product.slug}/media/", {"file": up}, format="multipart")
        self.assertEqual(res.status_code, 201)
        self.assertTrue(res.data["url"].startswith("http://testserver/media/"))
        media_id = res.data["id"]
        self.assertTrue(AuditLog.objects.filter(action="media.uploaded", entity_id=str(media_id)).exists())
        self.assertEqual(self.client_admin.delete(f"/api/v1/admin/media/{media_id}/").status_code, 204)
        self.assertTrue(AuditLog.objects.filter(action="media.deleted", entity_id=str(media_id)).exists())
        buf.seek(0)
        up2 = SimpleUploadedFile("n.png", buf.getvalue(), content_type="image/png")
        self.assertEqual(self.client_admin.post("/api/v1/admin/media/upload/", {"file": up2}, format="multipart").status_code, 201)
        self.assertEqual(AuditLog.objects.filter(action="media.uploaded").count(), 2)

    def test_admin_product_page_size_200(self):
        res = self.client_admin.get("/api/v1/admin/products/?page_size=150")
        self.assertEqual(res.status_code, 200)


class SeedCatalogTests(TestCase):
    def test_seed_has_no_fake_ratings_and_dev_only_demo_data(self):
        from commerce.models import Coupon
        from django.contrib.auth import get_user_model

        with override_settings(IS_DEVELOPMENT=False, IS_PRODUCTION=False, SEED_DEMO_CUSTOMER=True):
            call_command("seed_catalog", stdout=BytesIO_text())
        self.assertTrue(Product.objects.exists())
        self.assertFalse(Product.objects.exclude(rating=0).exists())
        self.assertFalse(Product.objects.exclude(review_count=0).exists())
        self.assertFalse(Coupon.objects.filter(code="MMH10").exists())
        self.assertFalse(get_user_model().objects.filter(email="demo@mmh.local").exists())

        with override_settings(IS_DEVELOPMENT=True, IS_PRODUCTION=False, SEED_DEMO_CUSTOMER=True):
            call_command("seed_catalog", stdout=BytesIO_text())
        self.assertTrue(Coupon.objects.filter(code="MMH10").exists())
        self.assertTrue(get_user_model().objects.filter(email="demo@mmh.local").exists())


def BytesIO_text():
    import io

    return io.StringIO()
