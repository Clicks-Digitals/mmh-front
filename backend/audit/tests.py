from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from django.test import TestCase

from audit.services import record_audit

User = get_user_model()


class RecordAuditTests(TestCase):
    def test_records_actor_and_normalises(self):
        user = User.objects.create_user(email="audit@example.com", password="x")
        entry = record_audit(user, "thing.done", entity_type="Thing", entity_id=42, meta={"a": 1})
        self.assertEqual(entry.actor, user)
        self.assertEqual(entry.entity_id, "42")
        self.assertEqual(entry.meta, {"a": 1})

    def test_anonymous_actor_stored_as_null(self):
        self.assertIsNone(record_audit(AnonymousUser(), "x").actor)
        self.assertIsNone(record_audit(None, "y", entity_id=None).actor)


class AuditDisplayAndSearchTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        from accounts.models import AdminRole
        from accounts.tests_admin import make_admin, seed_permissions

        seed_permissions()
        cls.admin = make_admin("audit-admin@mmh.test", AdminRole.ADMIN)
        cls.viewer = make_admin("audit-viewer@mmh.test", AdminRole.SUPPORT_AGENT)

    def test_entity_labels(self):
        from audit.services import actor_label, entity_label

        order = record_audit(self.admin, "orders.transition", entity_type="Order", entity_id=5, meta={"order_number": "AB12"})
        coupon = record_audit(None, "coupons.update", entity_type="Coupon", entity_id=1, meta={"code": "SAVE"})
        code = record_audit(None, "codes.reveal", entity_type="DigitalCode", entity_id=9, meta={"masked": "••••AB12", "order_number": "XY"})
        user = record_audit(None, "admins.update", entity_type="User", entity_id=self.viewer.pk)
        self.assertEqual(entity_label(order), "Order AB12")
        self.assertEqual(entity_label(coupon), "Coupon SAVE")
        self.assertEqual(entity_label(code), "Code ••••AB12 (order XY)")
        self.assertEqual(entity_label(user), "User audit-viewer@mmh.test")
        self.assertIn("audit-admin@mmh.test", actor_label(order))
        self.assertEqual(actor_label(coupon), "")

    def test_search_covers_meta_and_requires_audit_read(self):
        from accounts.tests_admin import auth_client

        record_audit(self.admin, "orders.refund", entity_type="Order", entity_id=1, meta={"order_number": "ZZ9911", "email": "x@buyer.test"})
        record_audit(self.admin, "orders.refund", entity_type="Order", entity_id=2, meta={"order_number": "OTHER"})
        client = auth_client(self.admin)
        for term in ("ZZ9911", "x@buyer.test", "zz99"):
            body = client.get("/api/v1/admin/audit/", {"search": term}).json()
            self.assertEqual(body["count"], 1, term)
            self.assertEqual(body["results"][0]["entity_label"], "Order ZZ9911")
        self.assertEqual(client.get("/api/v1/admin/audit/", {"order_number": "zz9911"}).json()["count"], 1)
        self.assertEqual(auth_client(self.viewer).get("/api/v1/admin/audit/").status_code, 403)
