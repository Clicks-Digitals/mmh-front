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
