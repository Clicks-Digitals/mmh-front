"""Auth hardening, RBAC escalation rules, DB-backed role permissions, and throttling."""

from __future__ import annotations

import re
from unittest import mock

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework.throttling import SimpleRateThrottle

from accounts.models import AdminProfile, AdminRole, Permission, RolePermission, UserKind
from accounts.permissions import DEFAULT_ROLE_PERMISSIONS, role_permissions, user_permissions
from accounts.tests_admin import auth_client, make_admin, seed_permissions
from audit.models import AuditLog

User = get_user_model()

STRONG = "Zebra-Quartz-9184!"
STRONG_2 = "Nebula-Falcon-7731#"


def login(client: APIClient, email: str, password: str):
    return client.post("/api/v1/auth/token/", {"email": email, "password": password}, format="json")


class AuthFlowTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.customer = User.objects.create_user(email="Shopper@Example.com", password=STRONG, kind=UserKind.CUSTOMER)

    def setUp(self):
        cache.clear()

    def test_login_is_case_insensitive(self):
        res = login(APIClient(), "  shopper@EXAMPLE.com", STRONG)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIn("access", res.data)
        self.assertIn("refresh", res.data)
        self.assertEqual(res.data["user"]["email"], self.customer.email)

    def test_login_wrong_password_401(self):
        self.assertEqual(login(APIClient(), "shopper@example.com", "nope-nope").status_code, 401)

    def test_disabled_user_cannot_login(self):
        self.customer.disabled = True
        self.customer.save(update_fields=["disabled"])
        res = login(APIClient(), "shopper@example.com", STRONG)
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["code"], "account_disabled")
        # A wrong password never reveals that the account is disabled.
        res = login(APIClient(), "shopper@example.com", "wrong-password-1")
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.data["code"], "invalid_credentials")

    def test_disabled_user_blocked_mid_session(self):
        client = APIClient()
        res = login(client, "shopper@example.com", STRONG)
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
        self.assertEqual(client.get("/api/v1/auth/me/").status_code, 200)
        User.objects.filter(pk=self.customer.pk).update(disabled=True)
        blocked = client.get("/api/v1/auth/me/")
        self.assertEqual(blocked.status_code, 401)
        # Refresh is rejected too.
        refreshed = APIClient().post("/api/v1/auth/token/refresh/", {"refresh": res.data["refresh"]}, format="json")
        self.assertEqual(refreshed.status_code, 401)

    def test_inactive_user_blocked_mid_session(self):
        client = auth_client(self.customer)
        User.objects.filter(pk=self.customer.pk).update(is_active=False)
        self.assertEqual(client.get("/api/v1/auth/me/").status_code, 401)

    def test_refresh_rotates_and_blacklists_old_token(self):
        res = login(APIClient(), "shopper@example.com", STRONG)
        r1 = res.data["refresh"]
        rotated = APIClient().post("/api/v1/auth/token/refresh/", {"refresh": r1}, format="json")
        self.assertEqual(rotated.status_code, 200, rotated.content)
        self.assertIn("access", rotated.data)
        r2 = rotated.data["refresh"]
        self.assertNotEqual(r1, r2)
        reuse = APIClient().post("/api/v1/auth/token/refresh/", {"refresh": r1}, format="json")
        self.assertEqual(reuse.status_code, 401)
        again = APIClient().post("/api/v1/auth/token/refresh/", {"refresh": r2}, format="json")
        self.assertEqual(again.status_code, 200)

    def test_logout_blacklists_refresh(self):
        res = login(APIClient(), "shopper@example.com", STRONG)
        refresh = res.data["refresh"]
        out = APIClient().post("/api/v1/auth/logout/", {"refresh": refresh}, format="json")
        self.assertEqual(out.status_code, 200)
        self.assertEqual(out.data["detail"], "Logged out")
        # Idempotent.
        self.assertEqual(APIClient().post("/api/v1/auth/logout/", {"refresh": refresh}, format="json").status_code, 200)
        denied = APIClient().post("/api/v1/auth/token/refresh/", {"refresh": refresh}, format="json")
        self.assertEqual(denied.status_code, 401)

    def test_logout_invalid_token_400(self):
        self.assertEqual(
            APIClient().post("/api/v1/auth/logout/", {"refresh": "garbage"}, format="json").status_code, 400
        )
        self.assertEqual(APIClient().post("/api/v1/auth/logout/", {}, format="json").status_code, 400)

    def test_panel_token_endpoint_still_returns_user_payload(self):
        admin = make_admin("panel@mmh.test", AdminRole.VIEWER, password=STRONG)
        res = login(APIClient(), "PANEL@mmh.test", STRONG)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["user"]["role"], AdminRole.VIEWER)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
        self.assertEqual(client.get("/api/v1/admin/products/").status_code, 200)
        self.assertEqual(admin.email, "panel@mmh.test")


class RegistrationTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_register_lowercases_email(self):
        res = APIClient().post(
            "/api/v1/auth/register/",
            {"email": "New.User@Example.COM", "password": STRONG, "full_name": "New User"},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["email"], "new.user@example.com")
        self.assertTrue(User.objects.filter(email="new.user@example.com").exists())

    def test_register_rejects_weak_password_with_field_errors(self):
        res = APIClient().post(
            "/api/v1/auth/register/",
            {"email": "weak@example.com", "password": "password", "full_name": "Weak"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("password", res.data["detail"])
        self.assertTrue(res.data["detail"]["password"])
        self.assertFalse(User.objects.filter(email="weak@example.com").exists())

    def test_register_rejects_numeric_and_similar_passwords(self):
        res = APIClient().post(
            "/api/v1/auth/register/",
            {"email": "numeric@example.com", "password": "93817264503", "full_name": "N"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("password", res.data["detail"])

    def test_register_duplicate_email_case_insensitive(self):
        User.objects.create_user(email="dupe@example.com", password=STRONG)
        res = APIClient().post(
            "/api/v1/auth/register/",
            {"email": "DUPE@example.com", "password": STRONG, "full_name": "D"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("email", res.data["detail"])


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    SITE_URL="https://shop.example",
    DEFAULT_FROM_EMAIL="MMH <no-reply@example.com>",
)
class PasswordResetTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(email="reset@example.com", password=STRONG)
        cls.staff = make_admin("staff-reset@mmh.test", AdminRole.VIEWER, password=STRONG)

    def setUp(self):
        cache.clear()

    def _request(self, email):
        return APIClient().post("/api/v1/auth/password-reset/", {"email": email}, format="json")

    def _link_parts(self):
        self.assertEqual(len(mail.outbox), 1)
        body = mail.outbox[0].body
        match = re.search(r"https://shop\.example/reset-password\?uid=([\w-]+)&token=([\w-]+)", body)
        self.assertIsNotNone(match, body)
        return match.group(1), match.group(2)

    def test_unknown_email_returns_200_and_sends_nothing(self):
        res = self._request("nobody@example.com")
        self.assertEqual(res.status_code, 200)
        self.assertIn("detail", res.data)
        self.assertEqual(len(mail.outbox), 0)

    def test_same_response_for_known_and_unknown(self):
        a = self._request("nobody@example.com").data
        b = self._request("RESET@example.com").data
        self.assertEqual(a, b)

    def test_full_reset_flow(self):
        old_refresh = login(APIClient(), "reset@example.com", STRONG).data["refresh"]
        self.assertEqual(self._request("Reset@Example.com").status_code, 200)
        self.assertEqual(mail.outbox[0].to, ["reset@example.com"])
        self.assertEqual(mail.outbox[0].from_email, "MMH <no-reply@example.com>")
        uid, token = self._link_parts()

        weak = APIClient().post(
            "/api/v1/auth/password-reset/confirm/", {"uid": uid, "token": token, "password": "123"}, format="json"
        )
        self.assertEqual(weak.status_code, 400)
        self.assertIn("password", weak.data["detail"])

        ok = APIClient().post(
            "/api/v1/auth/password-reset/confirm/", {"uid": uid, "token": token, "password": STRONG_2}, format="json"
        )
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertEqual(login(APIClient(), "reset@example.com", STRONG_2).status_code, 200)
        self.assertEqual(login(APIClient(), "reset@example.com", STRONG).status_code, 401)
        # Token is single-use (password hash changed) and old sessions are revoked.
        reuse = APIClient().post(
            "/api/v1/auth/password-reset/confirm/", {"uid": uid, "token": token, "password": STRONG}, format="json"
        )
        self.assertEqual(reuse.status_code, 400)
        self.assertEqual(
            APIClient().post("/api/v1/auth/token/refresh/", {"refresh": old_refresh}, format="json").status_code, 401
        )

    def test_invalid_uid_or_token_400(self):
        res = APIClient().post(
            "/api/v1/auth/password-reset/confirm/", {"uid": "zzz", "token": "bad", "password": STRONG_2}, format="json"
        )
        self.assertEqual(res.status_code, 400)
        self._request("reset@example.com")
        uid, _ = self._link_parts()
        res = APIClient().post(
            "/api/v1/auth/password-reset/confirm/", {"uid": uid, "token": "1-bad", "password": STRONG_2}, format="json"
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["code"], "invalid_token")

    def test_staff_can_reset(self):
        self._request("staff-reset@mmh.test")
        uid, token = self._link_parts()
        res = APIClient().post(
            "/api/v1/auth/password-reset/confirm/", {"uid": uid, "token": token, "password": STRONG_2}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(login(APIClient(), "staff-reset@mmh.test", STRONG_2).status_code, 200)

    def test_disabled_user_gets_no_email(self):
        User.objects.filter(pk=self.user.pk).update(disabled=True)
        self.assertEqual(self._request("reset@example.com").status_code, 200)
        self.assertEqual(len(mail.outbox), 0)


class ThrottleTests(TestCase):
    def setUp(self):
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_login_scope_throttles(self):
        User.objects.create_user(email="t@example.com", password=STRONG)
        with mock.patch.dict(SimpleRateThrottle.THROTTLE_RATES, {"login": "2/min"}):
            client = APIClient()
            self.assertEqual(login(client, "t@example.com", "wrong").status_code, 401)
            self.assertEqual(login(client, "t@example.com", "wrong").status_code, 401)
            third = login(client, "t@example.com", STRONG)
            self.assertEqual(third.status_code, 429)

    def test_password_reset_scope_throttles(self):
        with mock.patch.dict(SimpleRateThrottle.THROTTLE_RATES, {"password_reset": "1/hour"}):
            client = APIClient()
            self.assertEqual(client.post("/api/v1/auth/password-reset/", {"email": "a@b.co"}).status_code, 200)
            self.assertEqual(client.post("/api/v1/auth/password-reset/", {"email": "a@b.co"}).status_code, 429)

    def test_register_scope_throttles(self):
        with mock.patch.dict(SimpleRateThrottle.THROTTLE_RATES, {"register": "1/hour"}):
            client = APIClient()
            client.post("/api/v1/auth/register/", {"email": "r1@example.com", "password": STRONG, "full_name": "R"})
            res = client.post("/api/v1/auth/register/", {"email": "r2@example.com", "password": STRONG, "full_name": "R"})
            self.assertEqual(res.status_code, 429)

    def test_all_scopes_have_rates(self):
        from django.conf import settings

        rates = settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]
        for scope in (
            "anon",
            "anon_read",
            "user",
            "login",
            "register",
            "password_reset",
            "password_reset_confirm",
            "token_refresh",
            "logout",
            "coupon",
            "checkout",
            "order_lookup",
            "code_reveal",
            "paypal",
            "contact",
            "supplier_callback",
        ):
            self.assertIn(scope, rates)
        self.assertEqual(settings.CACHES["default"]["BACKEND"].rsplit(".", 1)[-1], "LocMemCache")


class EscalationMatrixTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        cls.super_admin = make_admin("sa@mmh.test", AdminRole.SUPER_ADMIN, password=STRONG)
        cls.admin = make_admin("ad@mmh.test", AdminRole.ADMIN, password=STRONG)
        cls.admin2 = make_admin("ad2@mmh.test", AdminRole.ADMIN, password=STRONG)
        cls.viewer = make_admin("vw@mmh.test", AdminRole.VIEWER, password=STRONG)
        cls.catalog = make_admin("cm@mmh.test", AdminRole.CATALOG_MANAGER, password=STRONG)

    def setUp(self):
        cache.clear()

    def _create(self, actor, role, email):
        return auth_client(actor).post(
            "/api/v1/admin/administrators/",
            {"email": email, "password": STRONG, "full_name": "New Staff", "role": role},
            format="json",
        )

    def _patch(self, actor, target, data):
        return auth_client(actor).patch(f"/api/v1/admin/administrators/{target.pk}/", data, format="json")

    def test_create_matrix(self):
        self.assertEqual(self._create(self.admin, AdminRole.CATALOG_MANAGER, "c1@mmh.test").status_code, 201)
        self.assertEqual(self._create(self.admin, AdminRole.ADMIN, "c2@mmh.test").status_code, 403)
        self.assertEqual(self._create(self.admin, AdminRole.SUPER_ADMIN, "c3@mmh.test").status_code, 403)
        self.assertEqual(self._create(self.super_admin, AdminRole.ADMIN, "c4@mmh.test").status_code, 201)
        self.assertEqual(self._create(self.super_admin, AdminRole.SUPER_ADMIN, "c5@mmh.test").status_code, 201)
        # No admins.write at all.
        self.assertEqual(self._create(self.viewer, AdminRole.VIEWER, "c6@mmh.test").status_code, 403)
        self.assertEqual(self._create(self.catalog, AdminRole.VIEWER, "c7@mmh.test").status_code, 403)
        self.assertFalse(User.objects.filter(email__in=["c2@mmh.test", "c3@mmh.test"]).exists())
        entry = AuditLog.objects.get(action="admin.created", meta__email="c1@mmh.test")
        self.assertEqual(entry.actor, self.admin)

    def test_create_rejects_weak_password(self):
        res = auth_client(self.super_admin).post(
            "/api/v1/admin/administrators/",
            {"email": "weak@mmh.test", "password": "123456789012", "full_name": "W", "role": "VIEWER"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("password", res.data["detail"])

    def test_admin_can_manage_lower_roles_only(self):
        self.assertEqual(self._patch(self.admin, self.viewer, {"role": AdminRole.CATALOG_MANAGER}).status_code, 200)
        self.viewer.admin_profile.refresh_from_db()
        self.assertEqual(self.viewer.admin_profile.role, AdminRole.CATALOG_MANAGER)
        self.assertEqual(self._patch(self.admin, self.viewer, {"role": AdminRole.ADMIN}).status_code, 403)
        self.assertEqual(self._patch(self.admin, self.viewer, {"role": AdminRole.SUPER_ADMIN}).status_code, 403)
        self.assertEqual(self._patch(self.admin, self.admin2, {"disabled": True}).status_code, 403)
        self.assertEqual(self._patch(self.admin, self.admin2, {"role": AdminRole.VIEWER}).status_code, 403)
        self.assertEqual(self._patch(self.admin, self.super_admin, {"password": STRONG_2}).status_code, 403)
        self.assertEqual(self._patch(self.admin, self.super_admin, {"title": "x"}).status_code, 403)
        self.admin2.refresh_from_db()
        self.assertFalse(self.admin2.disabled)

    def test_non_writer_cannot_patch(self):
        self.assertEqual(self._patch(self.viewer, self.catalog, {"disabled": True}).status_code, 403)

    def test_super_admin_can_manage_admins(self):
        res = self._patch(self.super_admin, self.admin2, {"role": AdminRole.VIEWER})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["role"], AdminRole.VIEWER)
        self.assertTrue(AuditLog.objects.filter(action="admin.updated", entity_id=str(self.admin2.pk)).exists())
        res = self._patch(self.super_admin, self.admin2, {"role": AdminRole.SUPER_ADMIN})
        self.assertEqual(res.status_code, 200)

    def test_nobody_changes_own_role_or_disables_self(self):
        for actor in (self.super_admin, self.admin):
            res = self._patch(actor, actor, {"role": AdminRole.VIEWER})
            self.assertEqual(res.status_code, 400, actor.email)
            self.assertIn("role", res.data["detail"])
            res = self._patch(actor, actor, {"disabled": True})
            self.assertEqual(res.status_code, 400)
            self.assertIn("disabled", res.data["detail"])
        # Self title/name edits are allowed.
        self.assertEqual(self._patch(self.admin, self.admin, {"title": "Ops lead"}).status_code, 200)

    def test_last_super_admin_protected(self):
        from accounts.admin_views import _other_active_super_admins

        # A superuser demoted to VIEWER is not an effective super admin (D14 / RO-06).
        demoted = User.objects.create_user(
            email="root@mmh.test", password=STRONG, kind=UserKind.ADMIN, is_staff=True, is_superuser=True
        )
        AdminProfile.objects.create(user=demoted, role=AdminRole.VIEWER)
        self.assertEqual(self._patch(demoted, self.super_admin, {"role": AdminRole.ADMIN}).status_code, 403)
        self.assertEqual(_other_active_super_admins(self.super_admin), 0)
        # The last SUPER_ADMIN cannot be demoted or disabled.
        with mock.patch("accounts.admin_views._other_active_super_admins", return_value=0):
            other = make_admin("sa-x@mmh.test", AdminRole.SUPER_ADMIN)
            self.assertEqual(self._patch(other, self.super_admin, {"role": AdminRole.ADMIN}).status_code, 400)
            self.assertEqual(self._patch(other, self.super_admin, {"disabled": True}).status_code, 400)
        # A superuser without a profile counts as an effective SUPER_ADMIN.
        root = User.objects.create_user(
            email="root2@mmh.test", password=STRONG, kind=UserKind.ADMIN, is_staff=True, is_superuser=True
        )
        self.assertEqual(_other_active_super_admins(self.super_admin), 2)  # sa-x + root2
        res = self._patch(root, self.super_admin, {"role": AdminRole.ADMIN})
        self.assertEqual(res.status_code, 200, res.content)
        self.super_admin.refresh_from_db()
        self.assertFalse(self.super_admin.is_superuser)
        self.assertEqual(res.data["role"], AdminRole.ADMIN)
        # Promoting syncs is_superuser on.
        res = self._patch(root, self.viewer, {"role": AdminRole.SUPER_ADMIN})
        self.assertEqual(res.status_code, 200)
        self.viewer.refresh_from_db()
        self.assertTrue(self.viewer.is_superuser)
        self.assertEqual(res.data["permissions"], ["*"])

    def test_disable_enable_and_audit(self):
        old_refresh = login(APIClient(), "vw@mmh.test", STRONG).data["refresh"]
        res = self._patch(self.admin, self.viewer, {"disabled": True})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["disabled"])
        self.assertTrue(AuditLog.objects.filter(action="admin.disabled", entity_id=str(self.viewer.pk)).exists())
        self.assertEqual(login(APIClient(), "vw@mmh.test", STRONG).status_code, 403)
        self.assertEqual(
            APIClient().post("/api/v1/auth/token/refresh/", {"refresh": old_refresh}, format="json").status_code, 401
        )
        res = self._patch(self.admin, self.viewer, {"disabled": False})
        self.assertFalse(res.data["disabled"])
        self.assertTrue(AuditLog.objects.filter(action="admin.enabled", entity_id=str(self.viewer.pk)).exists())
        self.assertEqual(login(APIClient(), "vw@mmh.test", STRONG).status_code, 200)

    def test_set_password(self):
        weak = self._patch(self.super_admin, self.admin, {"password": "123456789012"})
        self.assertEqual(weak.status_code, 400)
        self.assertIn("password", weak.data["detail"])
        res = self._patch(self.super_admin, self.admin, {"password": STRONG_2})
        self.assertEqual(res.status_code, 200)
        self.assertNotIn("password", res.data)
        self.assertEqual(login(APIClient(), "ad@mmh.test", STRONG_2).status_code, 200)
        entry = AuditLog.objects.get(action="admin.password_reset", entity_id=str(self.admin.pk))
        self.assertNotIn(STRONG_2, str(entry.meta))
        # ADMIN may reset a lower role's password.
        self.assertEqual(self._patch(self.admin, self.catalog, {"password": STRONG_2}).status_code, 200)


class RolePermissionSourceOfTruthTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        cls.super_admin = make_admin("rsa@mmh.test", AdminRole.SUPER_ADMIN)
        cls.admin = make_admin("rad@mmh.test", AdminRole.ADMIN)
        cls.viewer = make_admin("rvw@mmh.test", AdminRole.VIEWER)
        cls.content = make_admin("rcm@mmh.test", AdminRole.CONTENT_MANAGER)

    def setUp(self):
        cache.clear()

    def _put(self, actor, role, perms):
        return auth_client(actor).put(f"/api/v1/admin/roles/{role}/permissions/", {"permissions": perms}, format="json")

    def test_migration_seeded_defaults(self):
        self.assertEqual(Permission.objects.count(), 19)
        for role, keys in DEFAULT_ROLE_PERMISSIONS.items():
            if role == AdminRole.SUPER_ADMIN:
                self.assertFalse(RolePermission.objects.filter(role=role).exists())
                continue
            self.assertEqual(role_permissions(role), set(keys), role)

    def test_db_rows_are_the_only_source(self):
        self.assertIn("content.write", user_permissions(self.content))
        RolePermission.objects.filter(role=AdminRole.CONTENT_MANAGER).delete()
        self.assertEqual(user_permissions(self.content), set())
        self.assertEqual(auth_client(self.content).get("/api/v1/admin/faqs/").status_code, 403)
        self.assertEqual(user_permissions(self.super_admin), {"*"})

    def test_only_super_admin_edits_role_permissions(self):
        self.assertEqual(self._put(self.admin, AdminRole.VIEWER, ["catalog.read"]).status_code, 403)
        self.assertEqual(self._put(self.viewer, AdminRole.VIEWER, ["catalog.read"]).status_code, 403)

    def test_super_admin_permissions_fixed(self):
        res = self._put(self.super_admin, AdminRole.SUPER_ADMIN, ["catalog.read"])
        self.assertEqual(res.status_code, 400)

    def test_validates_all_keys_before_writing(self):
        before = role_permissions(AdminRole.VIEWER)
        res = self._put(self.super_admin, AdminRole.VIEWER, ["catalog.read", "nope.one", "nope.two"])
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["unknown"], ["nope.one", "nope.two"])
        self.assertEqual(role_permissions(AdminRole.VIEWER), before)
        self.assertEqual(self._put(self.super_admin, AdminRole.VIEWER, "catalog.read").status_code, 400)

    def test_replace_is_atomic(self):
        before = role_permissions(AdminRole.VIEWER)
        with mock.patch.object(RolePermission.objects, "bulk_create", side_effect=RuntimeError("db down")):
            res = self._put(self.super_admin, AdminRole.VIEWER, ["catalog.read"])
        self.assertEqual(res.status_code, 500)
        self.assertEqual(role_permissions(AdminRole.VIEWER), before)

    def test_update_changes_effective_permissions_and_audits(self):
        self.assertEqual(auth_client(self.viewer).get("/api/v1/admin/audit/").status_code, 200)
        res = self._put(self.super_admin, AdminRole.VIEWER, ["catalog.read", "catalog.read"])
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data, {"role": "VIEWER", "permissions": ["catalog.read"]})
        self.assertEqual(user_permissions(self.viewer), {"catalog.read"})
        self.assertEqual(auth_client(self.viewer).get("/api/v1/admin/audit/").status_code, 403)
        entry = AuditLog.objects.get(action="role.permissions_updated", entity_id="VIEWER")
        self.assertIn("audit.read", entry.meta["removed"])
        me = auth_client(self.viewer).get("/api/v1/auth/me/")
        self.assertEqual(me.data["permissions"], ["catalog.read"])

    def test_roles_list_reflects_db(self):
        RolePermission.objects.filter(role=AdminRole.SUPPORT_AGENT).delete()
        res = auth_client(self.admin).get("/api/v1/admin/roles/")
        self.assertEqual(res.status_code, 200)
        rows = {r["role"]: r for r in res.data}
        self.assertEqual(rows["SUPER_ADMIN"]["permissions"], ["*"])
        self.assertFalse(rows["SUPER_ADMIN"]["editable"])
        self.assertEqual(rows["SUPPORT_AGENT"]["permissions"], [])
        self.assertTrue(rows["VIEWER"]["editable"])
