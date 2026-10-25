"""E2E fix-phase tests: D17, D18, D20, D24, CA-15/18/19/20/21, RO-04/RO-11, ST-16, ST-20, stock quantity."""

from __future__ import annotations

import importlib
from decimal import Decimal

from django.apps import apps as global_apps
from django.test import TestCase, override_settings

from accounts.models import AdminRole
from accounts.tests_admin import auth_client, make_admin, seed_permissions
from catalog.models import (
    Category,
    FulfillmentType,
    Platform,
    Product,
    ProductFieldDefinition,
    ProductKind,
    ProductVariant,
    PublishStatus,
    Region,
    StockStatus,
)
from catalog.tests_storefront import add_code, make_product, make_variant
from cms.models import SiteSettings
from suppliers.models import Supplier, SupplierConnection, SupplierProductMapping


class FixBase(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        SiteSettings.load()
        cls.admin = make_admin("fx-admin@mmh.test", AdminRole.ADMIN)
        cls.viewer = make_admin("fx-viewer@mmh.test", AdminRole.VIEWER)
        cls.orders = make_admin("fx-orders@mmh.test", AdminRole.ORDER_MANAGER)
        cls.support = make_admin("fx-support@mmh.test", AdminRole.SUPPORT_AGENT)
        cls.content = make_admin("fx-content@mmh.test", AdminRole.CONTENT_MANAGER)
        cls.category = Category.objects.create(slug="fx-cards", name_en="Cards", status=PublishStatus.PUBLISHED)
        cls.platform = Platform.objects.create(slug="fx-steam", name_en="Steam", status=PublishStatus.PUBLISHED)
        cls.region = Region.objects.create(slug="fx-eu", currency="EUR", name_en="Europe")

    def product_payload(self, **kw):
        data = {"category_id": self.category.id, "platform_id": self.platform.id, "name_en": "Fancy Card"}
        data.update(kw)
        return data


class ProductCreateDefaultsTests(FixBase):
    def test_minimal_create_derives_id_slug_kind_brand(self):
        res = auth_client(self.admin).post("/api/v1/admin/products/", self.product_payload(), format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["slug"], "fancy-card")
        self.assertEqual(res.data["id"], "fancy-card")
        self.assertEqual(res.data["kind"], ProductKind.GIFT_CARD)
        self.assertEqual(res.data["fulfillment_type"], FulfillmentType.CODE)
        self.assertEqual(res.data["brand"], "Steam")
        self.assertEqual(res.data["artwork_key"], "")
        again = auth_client(self.admin).post("/api/v1/admin/products/", self.product_payload(), format="json")
        self.assertEqual(again.status_code, 201)
        self.assertEqual(again.data["slug"], "fancy-card-2")

    def test_arabic_only_name_gets_fallback_slug(self):
        res = auth_client(self.admin).post(
            "/api/v1/admin/products/", self.product_payload(name_en="بطاقة"), format="json"
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertTrue(res.data["slug"].startswith("product-"))

    def test_topup_defaults_and_consistency(self):
        res = auth_client(self.admin).post(
            "/api/v1/admin/products/",
            self.product_payload(name_en="Gems", fulfillment_type=FulfillmentType.DIRECT_TOPUP),
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["kind"], ProductKind.DIRECT_TOPUP)
        bad = auth_client(self.admin).post(
            "/api/v1/admin/products/",
            self.product_payload(name_en="Bad", kind=ProductKind.GIFT_CARD, fulfillment_type=FulfillmentType.DIRECT_TOPUP),
            format="json",
        )
        self.assertEqual(bad.status_code, 400)
        self.assertIn("kind", bad.data["detail"])
        ok = auth_client(self.admin).post(
            "/api/v1/admin/products/",
            self.product_payload(name_en="Coins", kind=ProductKind.GAME_CURRENCY, fulfillment_type=FulfillmentType.DIRECT_TOPUP),
            format="json",
        )
        self.assertEqual(ok.status_code, 201)
        bad2 = auth_client(self.admin).post(
            "/api/v1/admin/products/",
            self.product_payload(name_en="Bad2", kind=ProductKind.DIRECT_TOPUP, fulfillment_type=FulfillmentType.CODE),
            format="json",
        )
        self.assertEqual(bad2.status_code, 400)
        # Partial update is validated against the stored values.
        patch = auth_client(self.admin).patch(
            f"/api/v1/admin/products/{res.data['slug']}/", {"kind": ProductKind.GIFT_CARD}, format="json"
        )
        self.assertEqual(patch.status_code, 400)

    def test_duplicate_explicit_id_rejected(self):
        auth_client(self.admin).post("/api/v1/admin/products/", self.product_payload(id="dup-id"), format="json")
        res = auth_client(self.admin).post(
            "/api/v1/admin/products/", self.product_payload(id="dup-id", name_en="Other"), format="json"
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("id", res.data["detail"])


class VariantDefaultsTests(FixBase):
    def setUp(self):
        self.product = make_product("fx-prod", self.category, self.platform)

    def test_nested_variant_derivation(self):
        res = auth_client(self.admin).patch(
            "/api/v1/admin/products/fx-prod/",
            {"variants": [{"name_en": "€25 card", "price_fils": 21000, "region": self.region.id}, {"name_en": "1,000 Coins", "price_fils": 9000}]},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        v1 = ProductVariant.objects.get(product=self.product, name_en="€25 card")
        self.assertEqual(v1.denomination, Decimal("25"))
        self.assertEqual(v1.package_value, "25")
        self.assertEqual(v1.package_currency, "EUR")
        self.assertTrue(v1.published)  # CA-20 default
        self.assertTrue(v1.sku.startswith("fx-prod-"))
        v2 = ProductVariant.objects.get(product=self.product, name_en="1,000 Coins")
        self.assertEqual(v2.denomination, Decimal("1000"))
        self.assertEqual(v2.package_currency, "USD")
        self.assertNotEqual(v1.sku, v2.sku)

    def test_variant_endpoint_derivation_and_no_digits(self):
        res = auth_client(self.admin).post(
            "/api/v1/admin/variants/", {"product": "fx-prod", "name_en": "Premium", "price_fils": 5000}, format="json"
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(Decimal(res.data["denomination"]), Decimal("0"))
        self.assertEqual(res.data["package_value"], "Premium")
        self.assertEqual(res.data["package_currency"], "USD")
        # Explicit values are kept.
        res = auth_client(self.admin).post(
            "/api/v1/admin/variants/",
            {"product": "fx-prod", "name_en": "$10", "price_fils": 9000, "denomination": "12.50", "package_value": "X", "package_currency": "GBP", "sku": "FX-EXPLICIT"},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual((res.data["package_value"], res.data["package_currency"], res.data["sku"]), ("X", "GBP", "FX-EXPLICIT"))


class ProductListPublishedOnlyTests(FixBase):
    def test_price_range_and_regions_from_published_variants(self):
        product = make_product("fx-list", self.category, self.platform)
        make_variant(product, "FX-L1", price=5000, region=self.region)
        make_variant(product, "FX-L2", price=100, published=False, region=Region.objects.create(slug="fx-us", currency="USD", name_en="USA"))
        res = auth_client(self.admin).get("/api/v1/admin/products/?q=fx-list")
        row = res.data["results"][0]
        self.assertEqual(row["price_min_fils"], 5000)
        self.assertEqual(row["price_max_fils"], 5000)
        self.assertEqual(row["region_labels"], ["Europe"])

    def test_publish_without_published_variants_warns(self):
        product = make_product("fx-warn", self.category, self.platform, status=PublishStatus.DRAFT)
        make_variant(product, "FX-W1", published=False)
        res = auth_client(self.admin).patch("/api/v1/admin/products/fx-warn/", {"status": "PUBLISHED"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "PUBLISHED")
        self.assertEqual(res.data["warnings"], ["no_published_variants"])
        ProductVariant.objects.filter(sku="FX-W1").update(published=True)
        self.assertEqual(auth_client(self.admin).get("/api/v1/admin/products/fx-warn/").data["warnings"], [])


class FieldDefinitionTests(FixBase):
    def setUp(self):
        self.product = make_product("fx-topup", self.category, self.platform, fulfillment=FulfillmentType.DIRECT_TOPUP)
        Product.objects.filter(pk="fx-topup").update(kind=ProductKind.DIRECT_TOPUP)
        make_variant(self.product, "FX-T1")

    def _patch(self, fields):
        return auth_client(self.admin).patch("/api/v1/admin/products/fx-topup/", {"fields": fields}, format="json")

    def test_key_auto_derived_and_unique(self):
        res = self._patch([{"label_en": "Player ID", "input_format": "numeric", "min_length": 6, "max_length": 12}, {"label_en": "Player ID"}, {"label_en": "معرف"}])
        self.assertEqual(res.status_code, 200, res.content)
        keys = sorted(f["key"] for f in res.data["fields"])
        self.assertEqual(keys, ["field", "player_id", "player_id_2"])
        field = ProductFieldDefinition.objects.get(product=self.product, key="player_id")
        self.assertEqual((field.input_format, field.min_length, field.max_length), ("numeric", 6, 12))

    def test_validation(self):
        self.assertEqual(self._patch([{"label_en": "Server", "type": "SELECT"}]).status_code, 400)
        self.assertEqual(self._patch([{"label_en": "X", "min_length": 5, "max_length": 2}]).status_code, 400)
        self.assertEqual(self._patch([{"label_en": "X", "input_format": "hex"}]).status_code, 400)
        self.assertEqual(self._patch([{"label_en": "X", "key": "9bad key"}]).status_code, 400)
        self.assertEqual(
            self._patch([{"label_en": "S", "type": "SELECT", "options": [{"value": "a", "label_en": "A"}, {"value": "a", "label_en": "B"}]}]).status_code,
            400,
        )
        self.assertEqual(self._patch([{"label_en": "S", "type": "SELECT", "options": [{"value": "a"}]}]).status_code, 400)
        self.assertEqual(self._patch([{"key": "x"}]).status_code, 400)  # label required on create

    def test_select_options_normalised_and_public(self):
        res = self._patch([{"label_en": "Server", "type": "SELECT", "options": [{"label_en": "Europe", "label_ar": "أوروبا"}, {"value": "na", "label_en": "North America"}]}])
        self.assertEqual(res.status_code, 200, res.content)
        public = self.client.get("/api/v1/catalog/products/fx-topup/").json()
        field = public["fields"][0]
        self.assertEqual(field["key"], "server")
        self.assertEqual(field["input_format"], "text")
        self.assertEqual(
            field["options"],
            [{"value": "europe", "label_en": "Europe", "label_ar": "أوروبا"}, {"value": "na", "label_en": "North America", "label_ar": ""}],
        )
        self.assertIn("min_length", field)
        self.assertIn("max_length", field)
        # Updating an existing field by id keeps its key.
        fid = res.data["fields"][0]["id"]
        res = self._patch([{"id": fid, "label_en": "Region server"}])
        self.assertEqual(res.data["fields"][0]["key"], "server")
        # Removing all options of a SELECT is rejected.
        self.assertEqual(self._patch([{"id": fid, "options": []}]).status_code, 400)

    def test_duplicate_copies_new_field_attributes(self):
        ProductFieldDefinition.objects.create(
            product=self.product, key="pid", label_en="Player ID", input_format="numeric", min_length=5, max_length=9
        )
        res = auth_client(self.admin).post("/api/v1/admin/products/fx-topup/duplicate/", {}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual((res.data["fields"][0]["input_format"], res.data["fields"][0]["max_length"]), ("numeric", 9))


class CategoryTests(FixBase):
    def test_auto_slug_and_show_in_menu(self):
        res = auth_client(self.admin).post(
            "/api/v1/admin/categories/", {"name_en": "Mobile Games", "show_in_menu": True}, format="json"
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["slug"], "mobile-games")
        self.assertTrue(res.data["show_in_menu"])
        dup = auth_client(self.admin).post("/api/v1/admin/categories/", {"name_en": "Mobile Games", "slug": ""}, format="json")
        self.assertEqual(dup.data["slug"], "mobile-games-2")
        taken = auth_client(self.admin).post(
            "/api/v1/admin/categories/", {"name_en": "X", "slug": "mobile-games"}, format="json"
        )
        self.assertEqual(taken.status_code, 400)

    def test_delete_with_children_is_409(self):
        parent = Category.objects.create(slug="fx-parent", name_en="Parent")
        Category.objects.create(slug="fx-child-b", name_en="Beta", parent=parent, sort_order=2)
        Category.objects.create(slug="fx-child-a", name_en="Alpha", parent=parent, sort_order=1)
        res = auth_client(self.admin).delete(f"/api/v1/admin/categories/{parent.id}/")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["code"], "has_children")
        self.assertIn("Alpha, Beta", res.data["detail"])
        self.assertEqual([c["slug"] for c in res.data["children"]], ["fx-child-a", "fx-child-b"])
        self.assertTrue(Category.objects.filter(pk=parent.pk).exists())
        leaf = Category.objects.create(slug="fx-leaf", name_en="Leaf")
        self.assertEqual(auth_client(self.admin).delete(f"/api/v1/admin/categories/{leaf.id}/").status_code, 204)

    def test_ordering_and_public_fields(self):
        Category.objects.all().delete()
        Category.objects.create(slug="b", name_en="Bravo", sort_order=1, show_in_menu=True, description_en="Desc")
        Category.objects.create(slug="a", name_en="Alpha", sort_order=1)
        top = Category.objects.create(slug="z", name_en="Zulu", sort_order=0, show_in_menu=True)
        Category.objects.create(slug="c", name_en="Child", sort_order=5, parent=top)
        admin_rows = auth_client(self.admin).get("/api/v1/admin/categories/").data["results"]
        self.assertEqual([r["slug"] for r in admin_rows], ["z", "a", "b", "c"])
        public = self.client.get("/api/v1/catalog/categories/").json()
        self.assertEqual([r["slug"] for r in public], ["z", "a", "b", "c"])
        bravo = next(r for r in public if r["slug"] == "b")
        self.assertTrue(bravo["show_in_menu"])
        self.assertEqual(bravo["description_en"], "Desc")
        self.assertEqual(next(r for r in public if r["slug"] == "c")["parent"], "z")
        menu = self.client.get("/api/v1/catalog/categories/?menu=1").json()
        self.assertEqual([r["slug"] for r in menu], ["z", "b"])


class AutoSlugOtherModelsTests(FixBase):
    def test_platform_region_supplier(self):
        res = auth_client(self.admin).post("/api/v1/admin/platforms/", {"name_en": "Epic Games"}, format="json")
        self.assertEqual((res.status_code, res.data["slug"]), (201, "epic-games"))
        res = auth_client(self.admin).post(
            "/api/v1/admin/regions/", {"name_en": "Saudi Arabia", "currency": "SAR", "slug": ""}, format="json"
        )
        self.assertEqual((res.status_code, res.data["slug"]), (201, "saudi-arabia"))
        res = auth_client(self.admin).post("/api/v1/admin/suppliers/", {"name": "Like Card"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["slug"], "like-card")


class PermissionsForPickersTests(FixBase):
    def test_codes_roles_can_read_product_and_variant_lists(self):
        product = make_product("fx-pick", self.category, self.platform)
        make_variant(product, "FX-P1")
        self.assertEqual(auth_client(self.orders).get("/api/v1/admin/products/").status_code, 200)
        res = auth_client(self.orders).get("/api/v1/admin/variants/?fulfillment_type=CODE")
        self.assertEqual(res.status_code, 200)
        self.assertNotIn("cost_fils", res.data["results"][0])
        self.assertEqual(auth_client(self.support).get("/api/v1/admin/variants/").status_code, 200)
        self.assertEqual(auth_client(self.support).get("/api/v1/admin/products/").status_code, 403)
        self.assertIn("cost_fils", auth_client(self.viewer).get("/api/v1/admin/variants/").data["results"][0])
        # Still read-only.
        self.assertEqual(
            auth_client(self.orders).patch("/api/v1/admin/products/fx-pick/", {"name_en": "x"}, format="json").status_code,
            403,
        )
        self.assertEqual(auth_client(self.orders).post("/api/v1/admin/variants/", {}, format="json").status_code, 403)

    def test_catalog_roles_can_list_suppliers(self):
        supplier = Supplier.objects.create(slug="fx-sup", name="Sup")
        self.assertEqual(auth_client(self.content).get("/api/v1/admin/suppliers/").status_code, 200)
        self.assertEqual(auth_client(self.content).get(f"/api/v1/admin/suppliers/{supplier.id}/").status_code, 403)
        self.assertEqual(auth_client(self.support).get("/api/v1/admin/suppliers/").status_code, 403)


class SupplierMappingStockRuleTests(FixBase):
    def setUp(self):
        self.product = make_product("fx-map", self.category, self.platform)
        self.variant = make_variant(self.product, "FX-M1")
        from django.utils import timezone

        from suppliers.models import SupplierCatalogItem

        # D-1E-10: only the 1Epin supplier, live mode + switch + credentials, fresh catalog item.
        self.supplier = Supplier.objects.create(slug="1epin", name="Live sup", active=True)
        SupplierConnection.objects.create(supplier=self.supplier, environment="LIVE")
        for pid in ("E1", "E2"):
            SupplierCatalogItem.objects.create(
                supplier=self.supplier, environment="LIVE", external_product_id=pid, product_name=pid,
                category_type="epin", price="1.00", last_seen_at=timezone.now(),
            )
        self.mapping = SupplierProductMapping.objects.create(
            supplier=self.supplier, product=self.product, variant=self.variant, external_product_id="E1"
        )

    def _mapping_row(self):
        return auth_client(self.admin).get("/api/v1/admin/products/fx-map/").data["supplier_mappings"][0]

    def _public_variant(self):
        return self.client.get("/api/v1/catalog/products/fx-map/").json()["variants"][0]

    @override_settings(ONEEPIN_ALLOW_LIVE=False, SUPPLIER_MODE="mock", ONEEPIN_MOCK_FULFILLMENT=False)
    def test_live_disabled(self):
        row = self._mapping_row()
        self.assertFalse(row["counts_as_stock"])
        self.assertEqual(row["counts_as_stock_reason"], "live_disabled")
        self.assertTrue(row["counts_as_stock_message"])
        self.assertEqual(self._public_variant()["stock_status"], "OUT_OF_STOCK")

    @override_settings(ONEEPIN_ALLOW_LIVE=True, SUPPLIER_MODE="live", ONEEPIN_EMAIL="ops@mmh.test", ONEEPIN_PASSWORD="x")
    def test_live_connection_counts(self):
        row = self._mapping_row()
        self.assertTrue(row["counts_as_stock"])
        self.assertIsNone(row["counts_as_stock_reason"])
        variant = self._public_variant()
        self.assertEqual(variant["stock_status"], "IN_STOCK")
        self.assertEqual(variant["available_quantity"], 5)  # supplier-backed: per-order max
        Supplier.objects.filter(pk=self.supplier.pk).update(active=False)
        self.assertEqual(self._mapping_row()["counts_as_stock_reason"], "supplier_inactive")
        self.assertEqual(self._public_variant()["stock_status"], "OUT_OF_STOCK")

    @override_settings(ONEEPIN_ALLOW_LIVE=True, SUPPLIER_MODE="live", ONEEPIN_EMAIL="ops@mmh.test", ONEEPIN_PASSWORD="x")
    def test_mapping_endpoints_and_supplier_detail_expose_rule(self):
        res = auth_client(self.admin).patch(
            f"/api/v1/admin/supplier-mappings/{self.mapping.id}/", {"ignored": True}, format="json"
        )
        self.assertEqual(res.data["counts_as_stock_reason"], "ignored")
        detail = auth_client(self.admin).get(f"/api/v1/admin/suppliers/{self.supplier.id}/").data
        self.assertEqual(detail["mappings"][0]["counts_as_stock"], False)
        self.assertTrue(detail["live_purchasing"])
        res = auth_client(self.admin).post(
            "/api/v1/admin/products/fx-map/mappings/",
            {"supplier_id": self.supplier.id, "external_product_id": "E2", "variant_id": self.variant.id},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertTrue(res.data["counts_as_stock"])


class AvailableQuantityTests(FixBase):
    def test_public_available_quantity(self):
        product = make_product("fx-qty", self.category, self.platform)
        variant = make_variant(product, "FX-Q1")
        for _ in range(3):
            add_code(variant)
        topup = make_product("fx-qty-top", self.category, self.platform, fulfillment=FulfillmentType.DIRECT_TOPUP)
        make_variant(topup, "FX-Q2")
        body = self.client.get("/api/v1/catalog/products/fx-qty/").json()
        self.assertEqual(body["variants"][0]["available_quantity"], 3)
        listing = self.client.get("/api/v1/catalog/products/?q=fx-qty").json()["results"]
        by_slug = {p["slug"]: p for p in listing}
        self.assertEqual(by_slug["fx-qty"]["variants"][0]["available_quantity"], 3)
        self.assertIsNone(by_slug["fx-qty-top"]["variants"][0]["available_quantity"])
        empty = make_product("fx-qty-none", self.category, self.platform)
        make_variant(empty, "FX-Q3")
        self.assertEqual(self.client.get("/api/v1/catalog/products/fx-qty-none/").json()["variants"][0]["available_quantity"], 0)

    def test_quantity_capped_at_99(self):
        from catalog import stock

        product = make_product("fx-cap", self.category, self.platform)
        variant = make_variant(product, "FX-C1")
        from unittest import mock

        with mock.patch.object(stock, "available_code_counts", return_value={variant.pk: 500}):
            with mock.patch("commerce.services.inventory.available_quantity", side_effect=ImportError):
                self.assertEqual(stock.available_quantities([variant.pk]), {variant.pk: 99})


class InventoryLowStockTests(FixBase):
    def test_only_published_code_variants_and_lte_threshold(self):
        SiteSettings.objects.filter(pk=1).update(low_stock_threshold=2)
        code_p = make_product("fx-inv", self.category, self.platform)
        at_threshold = make_variant(code_p, "FX-I1")
        add_code(at_threshold)
        add_code(at_threshold)
        above = make_variant(code_p, "FX-I2")
        for _ in range(3):
            add_code(above)
        make_variant(code_p, "FX-I3", published=False)
        topup = make_product("fx-inv-top", self.category, self.platform, fulfillment=FulfillmentType.DIRECT_TOPUP)
        make_variant(topup, "FX-I4")
        res = auth_client(self.orders).get("/api/v1/admin/inventory/")
        self.assertEqual(res.status_code, 200)
        skus = [v["sku"] for v in res.data["low_stock_variants"]]
        self.assertEqual(skus, ["FX-I1"])
        self.assertEqual(res.data["low_stock_variants"][0]["effective_stock_status"], "IN_STOCK")
        self.assertTrue(res.data["low_stock_variants"][0]["low_stock"])
        self.assertEqual(res.data["stats"]["low_stock"], 1)
        self.assertEqual(res.data["stats"]["low_stock_rule"], "available <= threshold")
        self.assertEqual(res.data["stats"]["tracked_variants"], 2)
        # Admin variant list uses the same rule.
        variant_rows = {v["sku"]: v for v in auth_client(self.admin).get("/api/v1/admin/variants/?product=fx-inv").data["results"]}
        self.assertTrue(variant_rows["FX-I1"]["low_stock"])
        self.assertFalse(variant_rows["FX-I2"]["low_stock"])


class DataMigrationTests(TestCase):
    def setUp(self):
        self.mod = importlib.import_module("catalog.migrations.0005_storefront_data_fixes")
        self.platform = Platform.objects.create(slug="dm-p", name_en="P")
        self.top_ups = Category.objects.get_or_create(slug="game-top-ups", defaults={"name_en": "Game top-ups"})[0]

    def test_menu_flags(self):
        Category.objects.update(show_in_menu=False)
        top = Category.objects.create(slug="dm-top", name_en="Top")
        child = Category.objects.create(slug="dm-child", name_en="Child", parent=top)
        draft = Category.objects.create(slug="dm-draft", name_en="Draft", status=PublishStatus.DRAFT)
        self.mod.flag_menu_categories(global_apps, None)
        top.refresh_from_db(), child.refresh_from_db(), draft.refresh_from_db()
        self.assertTrue(top.show_in_menu)
        self.assertFalse(child.show_in_menu)
        self.assertFalse(draft.show_in_menu)

    def test_code_products_moved_out_of_top_ups(self):
        code = make_product("valorant-points", self.top_ups, self.platform)
        topup = make_product("pubg-uc", self.top_ups, self.platform, fulfillment=FulfillmentType.DIRECT_TOPUP)
        self.mod.move_code_products_out_of_top_ups(global_apps, None)
        code.refresh_from_db(), topup.refresh_from_db()
        self.assertEqual(code.category.slug, "game-currencies")
        self.assertEqual(code.category.status, PublishStatus.PUBLISHED)
        self.assertEqual(topup.category.slug, "game-top-ups")

    def test_numeric_player_ids(self):
        product = make_product("pubg-uc", self.top_ups, self.platform, fulfillment=FulfillmentType.DIRECT_TOPUP)
        f = ProductFieldDefinition.objects.create(product=product, key="playerId", label_en="Player ID")
        other = ProductFieldDefinition.objects.create(product=product, key="note", label_en="Note")
        self.mod.numeric_player_ids(global_apps, None)
        f.refresh_from_db(), other.refresh_from_db()
        self.assertEqual((f.input_format, f.min_length, f.max_length), ("numeric", 6, 12))
        self.assertEqual(other.input_format, "text")

    def test_arabic_variant_names_only_when_copied(self):
        product = make_product("pubg-uc", self.top_ups, self.platform, fulfillment=FulfillmentType.DIRECT_TOPUP)
        v1 = make_variant(product, "pubg-uc-60")
        ProductVariant.objects.filter(pk=v1.pk).update(name_en="60 UC", name_ar="60 UC")
        v2 = make_variant(product, "pubg-uc-325")
        ProductVariant.objects.filter(pk=v2.pk).update(name_en="325 UC", name_ar="مخصص")
        self.mod.arabic_variant_names(global_apps, None)
        v1.refresh_from_db(), v2.refresh_from_db()
        self.assertEqual(v1.name_ar, "60 شدة")
        self.assertEqual(v2.name_ar, "مخصص")


class SeedCatalogTests(TestCase):
    def test_seed_uses_new_rules(self):
        from django.core.management import call_command

        call_command("seed_catalog", verbosity=0)
        self.assertEqual(Product.objects.get(id="valorant-points").category.slug, "game-currencies")
        self.assertFalse(Product.objects.filter(category__slug="game-top-ups", fulfillment_type="CODE").exists())
        field = ProductFieldDefinition.objects.get(product_id="mlbb-diamonds", key="zoneId")
        self.assertEqual((field.input_format, field.min_length, field.max_length), ("numeric", 3, 6))
        self.assertEqual(ProductVariant.objects.get(sku="free-fire-100").name_ar, "100 جوهرة")
        self.assertTrue(Category.objects.get(slug="gift-cards").show_in_menu)
        from django.db.models import F

        self.assertFalse(ProductVariant.objects.filter(name_ar=F("name_en")).exists())
