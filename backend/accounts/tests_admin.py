from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import AdminProfile, AdminRole, Permission, RolePermission, UserKind
from accounts.permissions import ROLE_PERMISSIONS
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
from commerce.crypto import encrypt_code
from commerce.models import DigitalCode, DigitalCodeStatus, FulfillmentStatus, Order, PaymentStatus
from cms.models import SiteSettings

User = get_user_model()


def auth_client(user) -> APIClient:
    client = APIClient()
    token = RefreshToken.for_user(user).access_token
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return client


def make_admin(email: str, role: str, *, password: str = "TestPassword123!") -> User:
    user = User.objects.create_user(
        email=email,
        password=password,
        first_name=email.split("@")[0],
        kind=UserKind.ADMIN,
        is_staff=True,
    )
    AdminProfile.objects.create(user=user, role=role)
    return user


def seed_permissions() -> None:
    for key, desc in [
        ("catalog.read", "Read catalog"),
        ("catalog.write", "Write catalog"),
        ("orders.read", "Read orders"),
        ("orders.write", "Write orders"),
        ("orders.fulfill", "Fulfill"),
        ("codes.read", "Codes read"),
        ("codes.manage", "Codes manage"),
        ("codes.reveal", "Reveal"),
        ("customers.read", "Customers"),
        ("customers.write", "Customers write"),
        ("content.read", "Content"),
        ("content.write", "Content write"),
        ("suppliers.read", "Suppliers"),
        ("suppliers.write", "Suppliers write"),
        ("audit.read", "Audit"),
        ("admins.read", "Admins"),
        ("admins.write", "Admins write"),
        ("settings.manage", "Settings"),
    ]:
        Permission.objects.update_or_create(key=key, defaults={"description": desc})
    for role, keys in ROLE_PERMISSIONS.items():
        if "*" in keys:
            continue
        for key in keys:
            perm = Permission.objects.filter(key=key).first()
            if perm:
                RolePermission.objects.get_or_create(role=role, permission=perm)


class AdminApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        cls.super_admin = make_admin("super@mmh.test", AdminRole.SUPER_ADMIN)
        cls.super_admin.is_superuser = True
        cls.super_admin.save(update_fields=["is_superuser"])
        cls.viewer = make_admin("viewer@mmh.test", AdminRole.VIEWER)
        cls.admin = make_admin("admin@mmh.test", AdminRole.ADMIN)

        cls.category = Category.objects.create(
            slug="gift-cards",
            name_en="Gift Cards",
            status=PublishStatus.PUBLISHED,
        )
        cls.platform = Platform.objects.create(
            slug="steam",
            name_en="Steam",
            status=PublishStatus.PUBLISHED,
        )
        cls.product = Product.objects.create(
            id="steam-wallet",
            slug="steam-wallet",
            kind=ProductKind.WALLET,
            fulfillment_type=FulfillmentType.CODE,
            category=cls.category,
            platform=cls.platform,
            brand="Steam",
            artwork_key="card-steam",
            status=PublishStatus.PUBLISHED,
            name_en="Steam Wallet",
        )
        cls.variant = ProductVariant.objects.create(
            product=cls.product,
            sku="steam-wallet-10",
            denomination=10,
            package_value="10",
            package_currency="USD",
            cost_fils=7000,
            price_fils=8500,
            stock_status=StockStatus.IN_STOCK,
            name_en="$10",
        )
        ct, nonce, masked = encrypt_code("SECRET-CODE-1234")
        cls.code = DigitalCode.objects.create(
            variant=cls.variant,
            status=DigitalCodeStatus.AVAILABLE,
            ciphertext=ct,
            nonce=nonce,
            masked=masked,
        )
        cls.order = Order.objects.create(
            order_number="ABCD1234",
            email="buyer@example.com",
            full_name="Buyer",
            total_fils=8500,
            payment_status=PaymentStatus.PENDING,
            fulfillment_status=FulfillmentStatus.NOT_STARTED,
        )
        SiteSettings.load()

    def test_admin_jwt_required(self):
        client = APIClient()
        res = client.get("/api/v1/admin/products/")
        self.assertEqual(res.status_code, 401)

    def test_viewer_cannot_write_catalog(self):
        client = auth_client(self.viewer)
        res = client.post(
            "/api/v1/admin/categories/",
            {"slug": "blocked", "name_en": "Blocked", "status": "PUBLISHED"},
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_product_list_as_admin(self):
        client = auth_client(self.admin)
        res = client.get("/api/v1/admin/products/")
        self.assertEqual(res.status_code, 200)
        results = res.data.get("results", res.data)
        self.assertTrue(any(p["id"] == "steam-wallet" for p in results))

    def test_category_create(self):
        client = auth_client(self.admin)
        res = client.post(
            "/api/v1/admin/categories/",
            {
                "slug": "games",
                "name_en": "Games",
                "name_ar": "ألعاب",
                "status": "PUBLISHED",
                "sort_order": 1,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["slug"], "games")

    def test_code_reveal_permission_and_audit(self):
        client = auth_client(self.admin)
        res = client.post(f"/api/v1/admin/codes/{self.code.id}/reveal/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["code"], "SECRET-CODE-1234")
        self.assertTrue(AuditLog.objects.filter(action="codes.reveal", entity_id=str(self.code.id)).exists())

        viewer = auth_client(self.viewer)
        denied = viewer.post(f"/api/v1/admin/codes/{self.code.id}/reveal/")
        self.assertEqual(denied.status_code, 403)

    def test_order_transition_invalid_rejected(self):
        client = auth_client(self.admin)
        res = client.post(
            f"/api/v1/admin/orders/{self.order.id}/transition/",
            {"payment_status": "REFUNDED"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.order.refresh_from_db()
        self.assertEqual(self.order.payment_status, PaymentStatus.PENDING)

        ok = client.post(
            f"/api/v1/admin/orders/{self.order.id}/transition/",
            {"payment_status": "PAID", "reason": "Bank transfer confirmed"},
            format="json",
        )
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.data["payment_status"], "PAID")
        self.assertTrue(AuditLog.objects.filter(action="orders.transition").exists())

    def test_settings_requires_permission(self):
        viewer = auth_client(self.viewer)
        denied = viewer.get("/api/v1/admin/settings/")
        self.assertEqual(denied.status_code, 403)

        client = auth_client(self.admin)
        res = client.get("/api/v1/admin/settings/")
        self.assertEqual(res.status_code, 200)
        patch = client.patch(
            "/api/v1/admin/settings/",
            {"store_name": "MMH Test", "maintenance_mode": False},
            format="json",
        )
        self.assertEqual(patch.status_code, 200)
        self.assertEqual(patch.data["store_name"], "MMH Test")

    def test_codes_list_never_returns_plaintext(self):
        client = auth_client(self.admin)
        res = client.get("/api/v1/admin/codes/")
        self.assertEqual(res.status_code, 200)
        payload = str(res.data)
        self.assertNotIn("SECRET-CODE-1234", payload)
        self.assertNotIn("ciphertext", payload)
