"""Storefront display currencies: defaults, admin edits, validation, public list."""

from __future__ import annotations

from accounts.models import AdminRole
from accounts.tests_admin import auth_client, make_admin, seed_permissions
from cms.models import SiteSettings
from django.test import TestCase
from rest_framework.test import APIClient


class CurrencyRatesTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        SiteSettings.load()
        cls.admin = make_admin("cur-admin@mmh.test", AdminRole.SUPER_ADMIN)

    def public(self):
        return APIClient().get("/api/v1/cms/settings/").json()["currencies"]

    def test_defaults_include_gulf_levant_and_usd(self):
        codes = {c["code"] for c in self.public()}
        self.assertTrue({"JOD", "USD", "SAR", "AED", "KWD", "QAR", "BHD", "OMR", "LBP", "SYP", "ILS", "IQD"} <= codes)
        jod = next(c for c in self.public() if c["code"] == "JOD")
        self.assertEqual(jod["rate"], 1.0)

    def test_admin_changes_rate_and_switches_off(self):
        res = auth_client(self.admin).patch(
            "/api/v1/admin/settings/",
            {"currency_rates": {"SAR": {"rate": 5.3, "enabled": True}, "SYP": {"rate": 18000, "enabled": False}}},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        rows = {c["code"]: c for c in self.public()}
        self.assertEqual(rows["SAR"]["rate"], 5.3)
        self.assertNotIn("SYP", rows)

    def test_rejects_unknown_code_and_bad_rate(self):
        client = auth_client(self.admin)
        self.assertEqual(client.patch("/api/v1/admin/settings/", {"currency_rates": {"XXX": {"rate": 1}}}, format="json").status_code, 400)
        self.assertEqual(client.patch("/api/v1/admin/settings/", {"currency_rates": {"SAR": {"rate": 0}}}, format="json").status_code, 400)

    def test_jod_cannot_be_changed(self):
        auth_client(self.admin).patch("/api/v1/admin/settings/", {"currency_rates": {"JOD": {"rate": 2, "enabled": False}}}, format="json")
        jod = next(c for c in self.public() if c["code"] == "JOD")
        self.assertEqual((jod["rate"], jod["enabled"]), (1.0, True))
