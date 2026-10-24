"""E2E fix-phase tests: D13, D14, D15, D16, RO-01, RO-06, RO-08, RO-17."""

from __future__ import annotations

import importlib

from django.apps import apps as global_apps
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import AdminProfile, AdminRole, CustomerProfile, Permission, RolePermission, UserKind
from accounts.permissions import user_permissions
from accounts.tests_admin import auth_client, make_admin, seed_permissions
from accounts.validators import MinimumDistinctCharactersValidator, normalize_phone, normalize_whatsapp
from audit.models import AuditLog
from commerce.models import Order, PaymentStatus

User = get_user_model()

STRONG = "Zebra-Quartz-9184!"
STRONG_2 = "Nebula-Falcon-7731#"


def login(email, password, client=None):
    return (client or APIClient()).post("/api/v1/auth/token/", {"email": email, "password": password}, format="json")


def bearer(access: str) -> APIClient:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
    return client


class ValidatorTests(TestCase):
    def test_phone_normalisation(self):
        self.assertEqual(normalize_phone("+962 79-123 4567"), "+962791234567")
        self.assertEqual(normalize_phone("00962791234567"), "+962791234567")
        self.assertEqual(normalize_phone("٠٧٩١٢٣٤٥٦٧"), "0791234567")
        self.assertEqual(normalize_phone("۰۷۹۱۲۳۴۵۶۷"), "0791234567")
        self.assertEqual(normalize_phone(""), "")
        for bad in ("abc", "123", "+0123456789", "+9627912345678901", "07912x4567"):
            with self.assertRaises(ValueError, msg=bad):
                normalize_phone(bad)

    def test_whatsapp_normalisation(self):
        self.assertEqual(normalize_whatsapp("+962 7912 34567"), "962791234567")
        self.assertEqual(normalize_whatsapp("٩٦٢٧٩١٢٣٤٥٦٧"), "962791234567")
        self.assertEqual(normalize_whatsapp(""), "")
        for bad in ("call me", "1234567", "9627912345678901"):
            with self.assertRaises(ValueError):
                normalize_whatsapp(bad)

    def test_distinct_characters_validator(self):
        v = MinimumDistinctCharactersValidator(5)
        from django.core.exceptions import ValidationError

        for bad in ("aaaaaaaaaaaa", "abababababab", "abcdabcdabcd"):
            with self.assertRaises(ValidationError):
                v.validate(bad)
        v.validate("abcdeabcdeab")
        self.assertIn("5", v.get_help_text())

    def test_registration_rejects_low_variety_password(self):
        res = APIClient().post(
            "/api/v1/auth/register/",
            {"email": "rep@example.com", "password": "qwqwqwqwqwqw", "full_name": "Rep"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("password", res.data["detail"])

    def test_registration_normalises_arabic_phone(self):
        res = APIClient().post(
            "/api/v1/auth/register/",
            {"email": "ar@example.com", "password": STRONG, "full_name": "A", "phone": "٠٧٩١٢٣٤٥٦٧"},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["phone"], "0791234567")
        bad = APIClient().post(
            "/api/v1/auth/register/",
            {"email": "ar2@example.com", "password": STRONG, "full_name": "A", "phone": "not a phone"},
            format="json",
        )
        self.assertEqual(bad.status_code, 400)
        self.assertIn("phone", bad.data["detail"])


class LoginOutcomeTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        cls.staff = make_admin("staff@mmh.test", AdminRole.VIEWER, password=STRONG)
        cls.customer = User.objects.create_user(email="c@example.com", password=STRONG, kind=UserKind.CUSTOMER)

    def setUp(self):
        cache.clear()

    def test_unknown_email_and_wrong_password_are_401_invalid_credentials(self):
        for email, pw in (("nobody@example.com", STRONG), ("c@example.com", "Wrong-pass-123")):
            res = login(email, pw)
            self.assertEqual(res.status_code, 401)
            self.assertEqual(res.data["code"], "invalid_credentials")
            self.assertTrue(res.data["detail"])

    def test_disabled_only_revealed_with_correct_password(self):
        User.objects.filter(pk=self.customer.pk).update(disabled=True)
        self.assertEqual(login("c@example.com", "Wrong-pass-123").data["code"], "invalid_credentials")
        res = login("c@example.com", STRONG)
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["code"], "account_disabled")
        User.objects.filter(pk=self.customer.pk).update(disabled=False, is_active=False)
        self.assertEqual(login("c@example.com", STRONG).status_code, 403)

    def test_staff_login_success_failure_and_logout_audited(self):
        res = login("staff@mmh.test", STRONG, APIClient(REMOTE_ADDR="10.1.2.3"))
        self.assertEqual(res.status_code, 200)
        entry = AuditLog.objects.get(action="auth.login")
        self.assertEqual(entry.actor_id, self.staff.pk)
        self.assertEqual(entry.meta["email"], "staff@mmh.test")
        self.assertEqual(entry.meta["ip"], "10.1.2.3")
        login("staff@mmh.test", "Wrong-pass-123")
        failed = AuditLog.objects.get(action="auth.login_failed")
        self.assertIsNone(failed.actor_id)
        self.assertEqual(failed.meta["reason"], "invalid_credentials")
        self.assertNotIn("Wrong-pass", str(failed.meta))
        APIClient().post("/api/v1/auth/logout/", {"refresh": res.data["refresh"]}, format="json")
        self.assertTrue(AuditLog.objects.filter(action="auth.logout", actor=self.staff).exists())

    def test_customer_logins_not_audited(self):
        login("c@example.com", STRONG)
        login("c@example.com", "Wrong-pass-123")
        self.assertFalse(AuditLog.objects.filter(action__startswith="auth.login").exists())


class TokenVersionTests(TestCase):
    """D14 / RO-01: access tokens die immediately on password change/reset, disable, role change."""

    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        cls.super_admin = make_admin("tv-sa@mmh.test", AdminRole.SUPER_ADMIN, password=STRONG)
        cls.target = make_admin("tv-cm@mmh.test", AdminRole.CATALOG_MANAGER, password=STRONG)

    def setUp(self):
        cache.clear()

    def _session(self):
        res = login("tv-cm@mmh.test", STRONG)
        self.assertEqual(res.status_code, 200, res.content)
        return res.data

    def _admin_patch(self, data):
        return auth_client(self.super_admin).patch(
            f"/api/v1/admin/administrators/{self.target.pk}/", data, format="json"
        )

    def test_claim_present_and_legacy_tokens_without_claim_still_work(self):
        from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

        session = self._session()
        self.assertEqual(AccessToken(session["access"])["tv"], 0)
        legacy = str(RefreshToken.for_user(self.target).access_token)
        self.assertEqual(bearer(legacy).get("/api/v1/auth/me/").status_code, 200)

    def test_password_reset_by_admin_kills_access_token(self):
        session = self._session()
        self.assertEqual(bearer(session["access"]).get("/api/v1/admin/products/").status_code, 200)
        self.assertEqual(self._admin_patch({"password": STRONG_2}).status_code, 200)
        res = bearer(session["access"]).get("/api/v1/admin/products/")
        self.assertEqual(res.status_code, 401)
        refresh = APIClient().post("/api/v1/auth/token/refresh/", {"refresh": session["refresh"]}, format="json")
        self.assertEqual(refresh.status_code, 401)

    def test_disable_kills_access_token(self):
        session = self._session()
        self.assertEqual(self._admin_patch({"disabled": True}).status_code, 200)
        self.assertEqual(bearer(session["access"]).get("/api/v1/auth/me/").status_code, 401)
        self.assertEqual(self._admin_patch({"disabled": False}).status_code, 200)
        # Re-enabling does not resurrect old tokens.
        self.assertEqual(bearer(session["access"]).get("/api/v1/auth/me/").status_code, 401)

    def test_role_change_kills_access_but_refresh_reissues_current_permissions(self):
        session = self._session()
        self.assertEqual(self._admin_patch({"role": AdminRole.VIEWER}).status_code, 200)
        self.assertEqual(bearer(session["access"]).get("/api/v1/auth/me/").status_code, 401)
        refreshed = APIClient().post("/api/v1/auth/token/refresh/", {"refresh": session["refresh"]}, format="json")
        self.assertEqual(refreshed.status_code, 200, refreshed.content)
        me = bearer(refreshed.data["access"]).get("/api/v1/auth/me/")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.data["role"], AdminRole.VIEWER)
        self.assertNotIn("catalog.write", me.data["permissions"])

    def test_password_reset_via_email_bumps_version(self):
        from accounts.views import password_reset_token_generator
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode

        session = self._session()
        uid = urlsafe_base64_encode(force_bytes(self.target.pk))
        token = password_reset_token_generator.make_token(User.objects.get(pk=self.target.pk))
        res = APIClient().post(
            "/api/v1/auth/password-reset/confirm/", {"uid": uid, "token": token, "password": STRONG_2}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(bearer(session["access"]).get("/api/v1/auth/me/").status_code, 401)
        entry = AuditLog.objects.get(action="admin.password_reset_via_email")
        self.assertEqual(entry.meta["email"], "tv-cm@mmh.test")


class SuperuserSyncTests(TestCase):
    """RO-06: demoting a Django superuser removes ``*``; promoting sets is_superuser."""

    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        cls.owner = make_admin("owner@mmh.test", AdminRole.SUPER_ADMIN, password=STRONG)
        cls.root = User.objects.create_superuser(email="root@mmh.test", password=STRONG)

    def test_superuser_without_profile_is_super_admin(self):
        self.assertEqual(user_permissions(self.root), {"*"})

    def test_demote_superuser_drops_star_and_flag(self):
        res = auth_client(self.owner).patch(
            f"/api/v1/admin/administrators/{self.root.pk}/", {"role": AdminRole.VIEWER}, format="json"
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.root.refresh_from_db()
        self.assertFalse(self.root.is_superuser)
        self.assertNotIn("*", user_permissions(self.root))
        self.assertEqual(res.data["role"], AdminRole.VIEWER)
        self.assertEqual(res.data["role_label"], "Viewer")
        entry = AuditLog.objects.filter(action="admin.updated").latest("id")
        self.assertEqual(entry.meta["email"], "root@mmh.test")
        self.assertEqual(entry.meta["role"]["from_label"], "Super admin")
        self.assertEqual(entry.meta["role"]["to_label"], "Viewer")

    def test_create_super_admin_sets_flag(self):
        res = auth_client(self.owner).post(
            "/api/v1/admin/administrators/",
            {"email": "new-sa@mmh.test", "password": STRONG, "full_name": "New SA", "role": AdminRole.SUPER_ADMIN},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertTrue(User.objects.get(email="new-sa@mmh.test").is_superuser)
        entry = AuditLog.objects.get(action="admin.created")
        self.assertEqual(entry.meta["role_label"], "Super admin")
        self.assertEqual(entry.meta["name"], "New SA")

    def test_sync_migration(self):
        mod = importlib.import_module("accounts.migrations.0005_sync_superuser_role")
        demoted = User.objects.create_user(
            email="demoted@mmh.test", password=STRONG, kind=UserKind.ADMIN, is_staff=True, is_superuser=True
        )
        AdminProfile.objects.create(user=demoted, role=AdminRole.ORDER_MANAGER)
        flagless = make_admin("flagless@mmh.test", AdminRole.SUPER_ADMIN)
        mod.forwards(global_apps, None)
        demoted.refresh_from_db()
        flagless.refresh_from_db()
        self.root.refresh_from_db()
        self.assertFalse(demoted.is_superuser)
        self.assertTrue(flagless.is_superuser)
        self.assertEqual(self.root.admin_profile.role, AdminRole.SUPER_ADMIN)

    def test_sync_migration_never_leaves_zero_super_admins(self):
        mod = importlib.import_module("accounts.migrations.0005_sync_superuser_role")
        User.objects.exclude(pk=self.root.pk).delete()
        AdminProfile.objects.create(user=self.root, role=AdminRole.VIEWER)
        mod.forwards(global_apps, None)
        self.root.refresh_from_db()
        self.assertTrue(self.root.is_superuser)
        self.assertEqual(self.root.admin_profile.role, AdminRole.SUPER_ADMIN)


class OrdersNotifyPermissionTests(TestCase):
    def test_migration_grants_existing_roles_only(self):
        mod = importlib.import_module("accounts.migrations.0004_orders_notify_permission")
        seed_permissions()
        Permission.objects.filter(key="orders.notify").delete()
        read = Permission.objects.get(key="orders.read")
        RolePermission.objects.filter(role__in=["SUPPORT_AGENT", "ORDER_MANAGER", "ADMIN"]).delete()
        RolePermission.objects.create(role="SUPPORT_AGENT", permission=read)
        RolePermission.objects.create(role="ADMIN", permission=read)
        mod.forwards(global_apps, None)
        perm = Permission.objects.get(key="orders.notify")
        self.assertEqual(perm.description, "Resend order emails to customers")
        roles = set(RolePermission.objects.filter(permission=perm).values_list("role", flat=True))
        self.assertEqual(roles, {"SUPPORT_AGENT", "ADMIN"})

    def test_migrated_db_has_notify_for_support(self):
        # The test DB is built by migrations: default roles got the new key.
        self.assertTrue(RolePermission.objects.filter(role="SUPPORT_AGENT", permission__key="orders.notify").exists())
        self.assertTrue(RolePermission.objects.filter(role="ORDER_MANAGER", permission__key="orders.notify").exists())
        self.assertFalse(RolePermission.objects.filter(role="VIEWER", permission__key="orders.notify").exists())


class PermissionDeniedAuditTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        cls.viewer = make_admin("pd-viewer@mmh.test", AdminRole.CONTENT_MANAGER)
        cls.customer = User.objects.create_user(email="pd-c@example.com", password=STRONG, kind=UserKind.CUSTOMER)

    def test_403_on_admin_api_recorded(self):
        res = auth_client(self.viewer).get("/api/v1/admin/customers/")
        self.assertEqual(res.status_code, 403)
        entry = AuditLog.objects.get(action="auth.permission_denied")
        self.assertEqual(entry.actor_id, self.viewer.pk)
        self.assertEqual(entry.meta["permission"], "customers.read")
        self.assertEqual(entry.meta["path"], "/api/v1/admin/customers/")
        self.assertEqual(entry.meta["method"], "GET")
        auth_client(self.customer).get("/api/v1/admin/customers/")
        self.assertEqual(AuditLog.objects.filter(action="auth.permission_denied").count(), 2)

    def test_anonymous_not_recorded(self):
        APIClient().get("/api/v1/admin/customers/")
        self.assertFalse(AuditLog.objects.filter(action="auth.permission_denied").exists())


class AdministratorsListTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        cls.sa = make_admin("list-sa@mmh.test", AdminRole.SUPER_ADMIN)
        for i in range(4):
            make_admin(f"agent{i}@mmh.test", AdminRole.SUPPORT_AGENT)
        u = make_admin("zed@mmh.test", AdminRole.VIEWER)
        u.first_name, u.last_name = "Zed", "Khalil"
        u.save()

    def test_plain_array_by_default_and_search(self):
        client = auth_client(self.sa)
        res = client.get("/api/v1/admin/administrators/")
        self.assertIsInstance(res.data, list)
        self.assertEqual(len(res.data), 6)
        self.assertEqual([r["email"] for r in client.get("/api/v1/admin/administrators/?search=khalil").data], ["zed@mmh.test"])
        self.assertEqual(len(client.get("/api/v1/admin/administrators/?q=AGENT").data), 4)
        self.assertEqual(len(client.get("/api/v1/admin/administrators/?role=SUPPORT_AGENT").data), 4)
        self.assertEqual(len(client.get("/api/v1/admin/administrators/?role=SUPER_ADMIN").data), 1)

    def test_paging(self):
        res = auth_client(self.sa).get("/api/v1/admin/administrators/?page=2&page_size=4")
        self.assertEqual(res.data["count"], 6)
        self.assertEqual(len(res.data["results"]), 2)
        self.assertIn("role_label", res.data["results"][0])


class CustomerAdminTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        cls.admin = make_admin("cust-admin@mmh.test", AdminRole.ADMIN)
        cls.support = make_admin("cust-support@mmh.test", AdminRole.SUPPORT_AGENT)
        cls.user = User.objects.create_user(
            email="Buyer@example.com", password=STRONG, first_name="Buyer", kind=UserKind.CUSTOMER
        )
        cls.profile = CustomerProfile.objects.create(user=cls.user, phone="")
        n = 0

        def order(total, status, *, user=None, email="buyer@example.com"):
            nonlocal n
            n += 1
            return Order.objects.create(
                order_number=f"CUST{n}", user=user, email=email, full_name="B", total_fils=total, payment_status=status
            )

        order(10000, PaymentStatus.PAID, user=cls.user)
        cls.partial = order(5000, PaymentStatus.PARTIALLY_REFUNDED, user=cls.user)
        order(7000, PaymentStatus.PENDING, user=cls.user)
        order(3000, PaymentStatus.PAID, email="BUYER@example.com")  # guest, same email
        order(9999, PaymentStatus.PAID, email="someone-else@example.com")
        try:
            from commerce.models import Refund

            Refund.objects.create(order=cls.partial, amount_fils=2000)
            cls.refund_ledger = True
        except ImportError:  # pragma: no cover
            cls.refund_ledger = False

    def test_list_includes_counts_and_net_total(self):
        res = auth_client(self.admin).get("/api/v1/admin/customers/")
        row = next(r for r in res.data["results"] if r["email"] == "Buyer@example.com")
        self.assertEqual(row["orders_count"], 4)
        self.assertEqual(row["guest_orders_count"], 1)
        expected = 10000 + 3000 + (3000 if self.refund_ledger else 5000)
        self.assertEqual(row["total_spent_fils"], expected)

    def test_detail_includes_guest_orders(self):
        res = auth_client(self.admin).get(f"/api/v1/admin/customers/{self.profile.pk}/")
        numbers = {o["order_number"]: o["is_guest"] for o in res.data["recent_orders"]}
        self.assertEqual(len(numbers), 4)
        self.assertTrue(numbers["CUST4"])
        self.assertFalse(numbers["CUST1"])
        self.assertNotIn("CUST5", numbers)

    def test_disable_customer_blocks_session_and_login(self):
        cache.clear()
        session = login("buyer@example.com", STRONG).data
        self.assertEqual(
            auth_client(self.support).patch(f"/api/v1/admin/customers/{self.profile.pk}/", {"disabled": True}).status_code,
            403,
        )
        res = auth_client(self.admin).patch(
            f"/api/v1/admin/customers/{self.profile.pk}/", {"disabled": True}, format="json"
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data["disabled"])
        self.assertEqual(bearer(session["access"]).get("/api/v1/auth/me/").status_code, 401)
        self.assertEqual(
            APIClient().post("/api/v1/auth/token/refresh/", {"refresh": session["refresh"]}, format="json").status_code,
            401,
        )
        self.assertEqual(login("buyer@example.com", STRONG).data["code"], "account_disabled")
        entry = AuditLog.objects.get(action="customer.disabled")
        self.assertEqual(entry.meta["email"], "Buyer@example.com")
        res = auth_client(self.admin).patch(
            f"/api/v1/admin/customers/{self.profile.pk}/", {"disabled": False}, format="json"
        )
        self.assertFalse(res.data["disabled"])
        self.assertTrue(AuditLog.objects.filter(action="customer.enabled").exists())
        self.assertEqual(login("buyer@example.com", STRONG).status_code, 200)

    def test_phone_validated_and_normalised(self):
        url = f"/api/v1/admin/customers/{self.profile.pk}/"
        bad = auth_client(self.admin).patch(url, {"phone": "hello"}, format="json")
        self.assertEqual(bad.status_code, 400)
        self.assertIn("phone", bad.data["detail"])
        ok = auth_client(self.admin).patch(url, {"phone": "+٩٦٢ ٧٩ ١٢٣ ٤٥٦٧", "name": "Buyer B"}, format="json")
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.data["phone"], "+962791234567")
        self.assertEqual(ok.data["name"], "Buyer B")

    def test_disabled_filter(self):
        User.objects.filter(pk=self.user.pk).update(disabled=True)
        res = auth_client(self.admin).get("/api/v1/admin/customers/?disabled=true")
        self.assertEqual([r["email"] for r in res.data["results"]], ["Buyer@example.com"])


class SelfServiceTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(email="self@example.com", password=STRONG, kind=UserKind.CUSTOMER)
        seed_permissions()
        cls.staff = make_admin("self-staff@mmh.test", AdminRole.VIEWER, password=STRONG)

    def setUp(self):
        cache.clear()

    def test_patch_me(self):
        client = auth_client(self.user)
        res = client.patch(
            "/api/v1/auth/me/", {"first_name": "Sara", "last_name": "Ali", "phone": "٠٧٩٠٠٠٠٠٠٠"}, format="json"
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.data["first_name"], res.data["last_name"], res.data["phone"]), ("Sara", "Ali", "0790000000"))
        self.assertEqual(client.patch("/api/v1/auth/me/", {"phone": "nope"}, format="json").status_code, 400)
        self.assertEqual(client.patch("/api/v1/auth/me/", {"first_name": ""}, format="json").status_code, 400)
        self.assertEqual(client.patch("/api/v1/auth/me/", {"email": "x@y.z"}, format="json").data["email"], "self@example.com")
        self.assertEqual(APIClient().patch("/api/v1/auth/me/", {"first_name": "X"}, format="json").status_code, 401)

    def test_staff_cannot_set_phone(self):
        res = auth_client(self.staff).patch("/api/v1/auth/me/", {"phone": "0791234567"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_change_password(self):
        session = login("self@example.com", STRONG).data
        client = bearer(session["access"])
        wrong = client.post(
            "/api/v1/auth/change-password/", {"current_password": "nope", "new_password": STRONG_2}, format="json"
        )
        self.assertEqual(wrong.status_code, 400)
        self.assertIn("current_password", wrong.data["detail"])
        weak = client.post(
            "/api/v1/auth/change-password/", {"current_password": STRONG, "new_password": "aaaaaaaaaaaa"}, format="json"
        )
        self.assertEqual(weak.status_code, 400)
        self.assertIn("new_password", weak.data["detail"])
        same = client.post(
            "/api/v1/auth/change-password/", {"current_password": STRONG, "new_password": STRONG}, format="json"
        )
        self.assertEqual(same.status_code, 400)
        ok = client.post(
            "/api/v1/auth/change-password/", {"current_password": STRONG, "new_password": STRONG_2}, format="json"
        )
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertEqual(set(ok.data) >= {"access", "refresh", "user", "detail"}, True)
        # Old session is dead, the returned one works.
        self.assertEqual(client.get("/api/v1/auth/me/").status_code, 401)
        self.assertEqual(
            APIClient().post("/api/v1/auth/token/refresh/", {"refresh": session["refresh"]}, format="json").status_code,
            401,
        )
        self.assertEqual(bearer(ok.data["access"]).get("/api/v1/auth/me/").status_code, 200)
        self.assertEqual(login("self@example.com", STRONG_2).status_code, 200)

    def test_staff_password_change_audited(self):
        res = auth_client(self.staff).post(
            "/api/v1/auth/change-password/", {"current_password": STRONG, "new_password": STRONG_2}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(AuditLog.objects.filter(action="auth.password_changed", actor=self.staff).exists())
