"""RO-17 follow-up: failed admin-portal logins for unknown e-mails are audited (actor null)."""

from __future__ import annotations

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import AdminRole
from accounts.tests_admin import auth_client, make_admin, seed_permissions
from accounts.tests_fixes import STRONG
from audit.models import AuditLog


def portal_login(email, password, portal=None):
    body = {"email": email, "password": password}
    if portal:
        body["portal"] = portal
    return APIClient(REMOTE_ADDR="10.9.8.7").post("/api/v1/auth/token/", body, format="json")


class UnknownEmailLoginAuditTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        cls.staff = make_admin("staff-final@mmh.test", AdminRole.VIEWER, password=STRONG)

    def setUp(self):
        cache.clear()

    def test_admin_portal_unknown_email_is_audited(self):
        res = portal_login("Ghost@Example.com", "Whatever-123!", portal="admin")
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.data["code"], "invalid_credentials")
        entry = AuditLog.objects.get(action="auth.login_failed")
        self.assertIsNone(entry.actor_id)
        self.assertEqual(entry.meta["reason"], "unknown_email")
        self.assertEqual(entry.meta["email"], "ghost@example.com")
        self.assertEqual(entry.meta["ip"], "10.9.8.7")
        self.assertNotIn("Whatever", str(entry.meta))
        # The audit API still renders an entry without a target user.
        admin = make_admin("auditor-final@mmh.test", AdminRole.ADMIN)
        res = auth_client(admin).get("/api/v1/admin/audit/", {"action": "auth.login_failed"})
        self.assertEqual(res.status_code, 200, res.content)

    def test_store_and_unspecified_logins_are_not_audited(self):
        portal_login("ghost@example.com", "Whatever-123!", portal="store")
        portal_login("ghost@example.com", "Whatever-123!")
        self.assertFalse(AuditLog.objects.filter(action__startswith="auth.login").exists())

    def test_admin_portal_wrong_password_for_staff_still_audited(self):
        portal_login("staff-final@mmh.test", "Wrong-pass-123", portal="admin")
        entry = AuditLog.objects.get(action="auth.login_failed")
        self.assertEqual(entry.meta["reason"], "invalid_credentials")
