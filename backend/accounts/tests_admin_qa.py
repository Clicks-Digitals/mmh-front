"""Expanded admin QA tests — no external network calls."""

from __future__ import annotations

from datetime import timedelta
from io import BytesIO

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import AdminProfile, AdminRole, UserKind
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
    StockStatus,
)
from cms.models import Banner, FAQ, ContentPage, SiteSettings
from commerce.crypto import encrypt_code
from commerce.models import (
    Coupon,
    DigitalCode,
    DigitalCodeStatus,
    FulfillmentStatus,
    Order,
    OrderItem,
    Payment,
    PaymentStatus,
)
from commerce.services.checkout import CheckoutError, create_storefront_order, validate_coupon
from suppliers.models import Supplier, SupplierConnection, SupplierEnvironment
from suppliers.provider import SupplierError, assert_live_locked, get_supplier_provider

User = get_user_model()


class AdminQaTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        cls.super_admin = make_admin("qa-super@mmh.test", AdminRole.SUPER_ADMIN)
        cls.super_admin.is_superuser = True
        cls.super_admin.save(update_fields=["is_superuser"])
        cls.admin = make_admin("qa-admin@mmh.test", AdminRole.ADMIN)
        cls.viewer = make_admin("qa-viewer@mmh.test", AdminRole.VIEWER)
        cls.catalog_mgr = make_admin("qa-catalog@mmh.test", AdminRole.CATALOG_MANAGER)
        cls.order_mgr = make_admin("qa-orders@mmh.test", AdminRole.ORDER_MANAGER)
        cls.content_mgr = make_admin("qa-content@mmh.test", AdminRole.CONTENT_MANAGER)
        cls.customer = User.objects.create_user(
            email="qa-customer@mmh.test",
            password="CustomerPass1!",
            kind=UserKind.CUSTOMER,
        )

        cls.category = Category.objects.create(slug="qa-cat", name_en="QA Cat", status=PublishStatus.PUBLISHED)
        cls.platform = Platform.objects.create(slug="qa-plat", name_en="QA Plat", status=PublishStatus.PUBLISHED)
        cls.product = Product.objects.create(
            id="qa-prod",
            slug="qa-prod",
            kind=ProductKind.GIFT_CARD,
            fulfillment_type=FulfillmentType.CODE,
            category=cls.category,
            platform=cls.platform,
            brand="QA",
            artwork_key="qa",
            status=PublishStatus.PUBLISHED,
            name_en="QA Product",
        )
        cls.variant = ProductVariant.objects.create(
            product=cls.product,
            sku="QA-1",
            denomination=10,
            package_value="10",
            package_currency="USD",
            price_fils=5000,
            stock_status=StockStatus.IN_STOCK,
            name_en="10",
        )
        ct, nonce, masked = encrypt_code("QA-SECRET-999")
        cls.code = DigitalCode.objects.create(
            variant=cls.variant,
            status=DigitalCodeStatus.AVAILABLE,
            ciphertext=ct,
            nonce=nonce,
            masked=masked,
        )
        cls.supplier = Supplier.objects.create(slug="1epin", name="1Epin", active=True)
        SupplierConnection.objects.create(
            supplier=cls.supplier,
            environment=SupplierEnvironment.MOCK,
            email_configured=True,
            password_configured=True,
        )
        SiteSettings.load()

    def test_customer_token_cannot_access_admin(self):
        client = auth_client(self.customer)
        res = client.get("/api/v1/admin/products/")
        self.assertEqual(res.status_code, 403)

    def test_catalog_manager_can_create_category(self):
        client = auth_client(self.catalog_mgr)
        res = client.post(
            "/api/v1/admin/categories/",
            {"slug": "qa-new", "name_en": "New", "status": "PUBLISHED"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)

    def test_catalog_manager_cannot_reveal_codes(self):
        client = auth_client(self.catalog_mgr)
        res = client.post(f"/api/v1/admin/codes/{self.code.id}/reveal/")
        self.assertEqual(res.status_code, 403)

    def test_order_manager_can_reveal_and_audit(self):
        client = auth_client(self.order_mgr)
        before = AuditLog.objects.filter(action="codes.reveal").count()
        res = client.post(f"/api/v1/admin/codes/{self.code.id}/reveal/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["code"], "QA-SECRET-999")
        self.assertNotIn("ciphertext", res.data)
        self.assertEqual(AuditLog.objects.filter(action="codes.reveal").count(), before + 1)
        audit = AuditLog.objects.filter(action="codes.reveal").latest("created_at")
        self.assertNotIn("QA-SECRET-999", str(audit.meta))

    def test_codes_list_never_returns_secrets(self):
        client = auth_client(self.order_mgr)
        res = client.get("/api/v1/admin/codes/")
        self.assertEqual(res.status_code, 200)
        row = res.data["results"][0]
        self.assertIn("masked", row)
        self.assertNotIn("ciphertext", row)
        self.assertNotIn("nonce", row)
        self.assertNotIn("code", row)

    def test_protected_category_delete_returns_409(self):
        client = auth_client(self.admin)
        res = client.delete(f"/api/v1/admin/categories/{self.category.id}/")
        self.assertEqual(res.status_code, 409)
        self.assertIn("code", res.data)

    def test_coupon_window_enforced(self):
        Coupon.objects.create(
            code="FUTURE",
            active=True,
            percent_off="10.00",
            starts_at=timezone.now() + timedelta(days=1),
        )
        with self.assertRaises(CheckoutError):
            validate_coupon("FUTURE", 10)

        Coupon.objects.create(
            code="EXPIRED",
            active=True,
            percent_off="10.00",
            ends_at=timezone.now() - timedelta(days=1),
        )
        with self.assertRaises(CheckoutError):
            validate_coupon("EXPIRED", 10)

        Coupon.objects.create(
            code="MAXED",
            active=True,
            percent_off="10.00",
            max_uses=1,
            used_count=1,
        )
        with self.assertRaises(CheckoutError):
            validate_coupon("MAXED", 10)

    @override_settings(ALLOW_DEMO_AUTO_PAYMENT=True)
    def test_checkout_increments_coupon_usage_and_marks_paid(self):
        coupon = Coupon.objects.create(code="OK10", active=True, percent_off="10.00", max_uses=5, used_count=0)
        order = create_storefront_order(
            data={
                "email": "buyer@example.com",
                "full_name": "Buyer",
                "coupon_code": "OK10",
                "region_confirmed": True,
                "refund_confirmed": True,
                "items": [{"product_id": "qa-prod", "variant_id": self.variant.id, "quantity": 1}],
            }
        )
        self.assertEqual(order.payment_status, PaymentStatus.PAID)
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.COMPLETED)
        coupon.refresh_from_db()
        self.assertEqual(coupon.used_count, 1)
        payment = Payment.objects.get(order=order)
        self.assertEqual(payment.status, PaymentStatus.PAID)
        self.assertEqual(payment.provider, "placeholder")

    def test_invalid_order_transition(self):
        order = Order.objects.create(
            order_number="TR1",
            email="a@b.com",
            full_name="A",
            total_fils=1000,
            payment_status=PaymentStatus.PENDING,
            fulfillment_status=FulfillmentStatus.NOT_STARTED,
        )
        client = auth_client(self.order_mgr)
        res = client.post(
            f"/api/v1/admin/orders/{order.id}/transition/",
            {"fulfillment_status": "COMPLETED"},
            format="json",
        )
        self.assertIn(res.status_code, {400, 409})

    def test_valid_order_transition(self):
        order = Order.objects.create(
            order_number="TR2",
            email="a@b.com",
            full_name="A",
            total_fils=1000,
            payment_status=PaymentStatus.PENDING,
            fulfillment_status=FulfillmentStatus.NOT_STARTED,
        )
        client = auth_client(self.order_mgr)
        res = client.post(
            f"/api/v1/admin/orders/{order.id}/transition/",
            {"payment_status": "PAID"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.payment_status, PaymentStatus.PAID)

    def test_supplier_get_hides_credentials(self):
        client = auth_client(self.admin)
        res = client.get(f"/api/v1/admin/suppliers/{self.supplier.id}/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("password_configured", res.data)
        self.assertTrue(isinstance(res.data["password_configured"], bool))
        self.assertNotIn("password", res.data)
        self.assertNotIn("api_key", res.data)
        self.assertNotIn("api_secret", res.data)

    def test_oneepin_live_locked(self):
        with override_settings(SUPPLIER_MODE="live", ONEEPIN_ALLOW_LIVE=False):
            with self.assertRaises(SupplierError):
                get_supplier_provider()
        with override_settings(SUPPLIER_MODE="mock", ONEEPIN_ALLOW_LIVE=True):
            with self.assertRaises(SupplierError):
                assert_live_locked()
        # Mock mode must remain available
        with override_settings(SUPPLIER_MODE="mock", ONEEPIN_ALLOW_LIVE=False):
            provider = get_supplier_provider()
            self.assertTrue(provider.check_connection()["ok"])
    def test_content_manager_cms_crud(self):
        client = auth_client(self.content_mgr)
        res = client.post(
            "/api/v1/admin/faqs/",
            {
                "question_en": "Q?",
                "answer_en": "A",
                "published": True,
                "sort_order": 1,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        res = client.post(
            "/api/v1/admin/banners/",
            {
                "href": "/shop",
                "title_en": "Banner",
                "published": True,
                "sort_order": 0,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201)

    def test_viewer_cannot_patch_settings(self):
        client = auth_client(self.viewer)
        res = client.patch("/api/v1/admin/settings/", {"store_name": "Hacked"}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_admin_can_patch_settings(self):
        client = auth_client(self.admin)
        res = client.patch("/api/v1/admin/settings/", {"store_name": "MMH QA"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["store_name"], "MMH QA")

    def test_media_rejects_non_image(self):
        client = auth_client(self.catalog_mgr)
        bad = SimpleUploadedFile("evil.exe", b"MZ\x90\x00notanimage", content_type="application/octet-stream")
        res = client.post("/api/v1/admin/media/upload/", {"file": bad}, format="multipart")
        self.assertEqual(res.status_code, 400)

    def test_media_accepts_png(self):
        client = auth_client(self.catalog_mgr)
        buf = BytesIO()
        Image.new("RGB", (1, 1), (255, 0, 0)).save(buf, format="PNG")
        upload = SimpleUploadedFile("ok.png", buf.getvalue(), content_type="image/png")
        res = client.post("/api/v1/admin/media/upload/", {"file": upload}, format="multipart")
        self.assertEqual(res.status_code, 201)
        self.assertIn("url", res.data)

    def test_dashboard_revenue_paid_only(self):
        Order.objects.create(
            order_number="PAID1",
            email="p@e.com",
            full_name="P",
            total_fils=9000,
            payment_status=PaymentStatus.PAID,
            fulfillment_status=FulfillmentStatus.COMPLETED,
        )
        Order.objects.create(
            order_number="PEND1",
            email="x@e.com",
            full_name="X",
            total_fils=99999,
            payment_status=PaymentStatus.PENDING,
            fulfillment_status=FulfillmentStatus.QUEUED,
        )
        client = auth_client(self.admin)
        res = client.get("/api/v1/admin/dashboard/")
        self.assertEqual(res.status_code, 200)
        self.assertGreaterEqual(res.data["revenue_fils"], 9000)
        self.assertLess(res.data["revenue_fils"], 99999)

    def test_audit_list_requires_permission(self):
        client = auth_client(self.content_mgr)
        res = client.get("/api/v1/admin/audit/")
        self.assertEqual(res.status_code, 403)
        client = auth_client(self.admin)
        res = client.get("/api/v1/admin/audit/")
        self.assertEqual(res.status_code, 200)

    def test_product_create_with_fils_price(self):
        client = auth_client(self.catalog_mgr)
        res = client.post(
            "/api/v1/admin/products/",
            {
                "id": "qa-priced",
                "slug": "qa-priced",
                "kind": "GIFT_CARD",
                "fulfillment_type": "CODE",
                "category_id": self.category.id,
                "platform_id": self.platform.id,
                "brand": "QA",
                "artwork_key": "qa",
                "name_en": "Priced",
                "status": "DRAFT",
                "variants": [
                    {
                        "sku": "QA-P-1",
                        "denomination": "5",
                        "package_value": "5",
                        "package_currency": "USD",
                        "price_fils": 5000,
                        "name_en": "5 USD",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        variant = ProductVariant.objects.get(sku="QA-P-1")
        self.assertEqual(variant.price_fils, 5000)
