from __future__ import annotations

from unittest import mock

from django.test import TestCase, override_settings

from accounts.models import AdminRole
from accounts.tests_admin import auth_client, make_admin, seed_permissions
from audit.models import AuditLog
from suppliers.models import SupplierApiLog, Supplier, SupplierConnection, SupplierOrder, SupplierWebhookEvent
from suppliers.provider import BalanceResult, SupplierError

STATUS_KEYS = {
    "supplier",
    "mode",
    "environment",
    "base_url",
    "email_configured",
    "password_configured",
    "callback_configured",
    "credentials_configured",
    "last_balance",
    "last_balance_currency",
    "last_checked_at",
    "balance",
    "low_balance",
    "low_balance_threshold",
    "live_enabled",
    "live_purchasing",
    "live_locked",
    "trading_enabled",
    "trading_disabled_reason",
    "mappings_count_as_stock",
    "callback_url",
    "callback_token_configured",
    "api_settings_url",
    "proxy_configured",
    "outgoing_ip",
    "outgoing_ip_checked_at",
    "outgoing_ip_error",
    "last_catalog_sync",
    "last_catalog_sync_result",
    "catalog_items",
    "mappings",
    "open_alerts",
    "orders_in_flight",
    "orders_manual_review",
    "fx_to_jod",
    "currency",
}


@override_settings(ONEEPIN_CALLBACK_TOKEN="cb-secret-token", ONEEPIN_RECONCILE_TOKEN="rc-token")
class CallbackTests(TestCase):
    def test_url_token_accepted(self):
        res = self.client.post(
            "/api/v1/suppliers/1epin/callback/cb-secret-token/",
            {"OrderNumber": "ON-1", "OrderStatusCode": 1},
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.content, b"OK")  # D-1E-6: plain-text OK
        event = SupplierWebhookEvent.objects.get(supplier_ref="ON-1")
        self.assertFalse(event.processed)
        self.assertEqual(event.reason, "no_matching_supplier_order")

    def test_header_token_accepted(self):
        supplier = Supplier.objects.create(slug="1epin", name="1Epin")
        SupplierOrder.objects.create(supplier=supplier, order_item_id=1, supplier_ref="ON-2", status="COMPLETED")
        res = self.client.post(
            "/api/v1/suppliers/1epin/callback/",
            {"OrderNumber": "ON-2", "OrderStatusCode": 1},
            content_type="application/json",
            HTTP_X_CALLBACK_TOKEN="cb-secret-token",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.content, b"OK")
        self.assertEqual(SupplierWebhookEvent.objects.get(supplier_ref="ON-2").reason, "confirmed_by_check_order:completed")

    def test_wrong_or_missing_token_rejected(self):
        for url, headers in (
            ("/api/v1/suppliers/1epin/callback/wrong/", {}),
            ("/api/v1/suppliers/1epin/callback/", {}),
            ("/api/v1/suppliers/1epin/callback/", {"HTTP_X_CALLBACK_TOKEN": "cb-secret-tokeN"}),
        ):
            res = self.client.post(url, {"OrderNumber": "X"}, content_type="application/json", **headers)
            self.assertEqual(res.status_code, 401, url)
        self.assertFalse(SupplierWebhookEvent.objects.exists())

    def test_missing_order_number_reason(self):
        res = self.client.post(
            "/api/v1/suppliers/1epin/callback/", {}, content_type="application/json", HTTP_X_CALLBACK_TOKEN="cb-secret-token"
        )
        self.assertEqual(res.content, b"OK")
        self.assertEqual(SupplierWebhookEvent.objects.get().reason, "missing_order_number")

    @override_settings(ONEEPIN_CALLBACK_TOKEN="")
    def test_unconfigured_token_rejects_everything(self):
        res = self.client.post("/api/v1/suppliers/1epin/callback/", {}, content_type="application/json", HTTP_X_CALLBACK_TOKEN="")
        self.assertEqual(res.status_code, 401)

    def test_compare_digest_used(self):
        with mock.patch("suppliers.views.secrets.compare_digest", return_value=False) as cd:
            res = self.client.post(
                "/api/v1/suppliers/1epin/callback/cb-secret-token/", {}, content_type="application/json"
            )
        self.assertEqual(res.status_code, 401)
        cd.assert_called_once()

    def test_reconcile_token(self):
        self.assertEqual(self.client.post("/api/v1/suppliers/1epin/reconcile/").status_code, 401)
        res = self.client.post("/api/v1/suppliers/1epin/reconcile/", HTTP_AUTHORIZATION="Bearer rc-token")
        self.assertEqual(res.status_code, 200)


class AdminSupplierEndpointTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        cls.admin = make_admin("sup-admin@mmh.test", AdminRole.ADMIN)
        cls.viewer = make_admin("sup-viewer@mmh.test", AdminRole.VIEWER)

    def test_status_shape(self):
        res = auth_client(self.viewer).get("/api/v1/admin/1epin/status/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(set(res.data), STATUS_KEYS)

    def test_ping_without_credentials_is_not_ok(self):
        with override_settings(ONEEPIN_EMAIL="", ONEEPIN_PASSWORD=""):
            res = auth_client(self.admin).post("/api/v1/admin/1epin/ping/")
        self.assertEqual(res.status_code, 409)
        self.assertFalse(res.data["ok"])
        self.assertEqual(res.data["code"], "not_configured")
        self.assertIn("ONEEPIN_EMAIL", res.data["message"])
        self.assertFalse(res.data["credentials_configured"])
        self.assertTrue(SupplierApiLog.objects.filter(action="ping", ok=False).exists())

    @override_settings(ONEEPIN_EMAIL="ops@mmh.test", ONEEPIN_PASSWORD="secret")
    def test_ping_returns_status_shape_plus_message(self):
        res = auth_client(self.admin).post("/api/v1/admin/1epin/ping/")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(STATUS_KEYS <= set(res.data))
        self.assertIn("message", res.data)
        self.assertTrue(res.data["ok"])
        self.assertIsNotNone(res.data["last_checked_at"])
        with mock.patch("suppliers.views.get_supplier_provider", side_effect=SupplierError("down")):
            res = auth_client(self.admin).post("/api/v1/admin/1epin/ping/")
        self.assertEqual(res.status_code, 502)
        self.assertFalse(res.data["ok"])
        self.assertTrue(STATUS_KEYS <= set(res.data))

    def test_balance_get_is_read_only(self):
        with mock.patch("suppliers.views.get_supplier_provider", side_effect=AssertionError("must not call")):
            res = auth_client(self.viewer).get("/api/v1/admin/1epin/balance/")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["cached"])
        self.assertIsNone(res.data["balance"])
        self.assertFalse(res.data["ok"])
        connection = Supplier.objects.get(slug="1epin").connection
        self.assertIsNone(connection.last_checked_at)

    def test_balance_refresh_in_mock_mode_uses_simulated_wallet(self):
        # D-1E-1: mock mode simulates 1Epin, including a balance.
        with override_settings(SUPPLIER_MODE="mock"):
            res = auth_client(self.admin).post("/api/v1/admin/1epin/balance/refresh/")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["ok"])
        self.assertEqual(res.data["balance"], "1000.00")

    @override_settings(SUPPLIER_MODE="test")
    def test_balance_refresh_stores_and_get_returns_cache(self):
        self.assertEqual(auth_client(self.viewer).post("/api/v1/admin/1epin/balance/refresh/").status_code, 403)
        provider = mock.Mock()
        provider.get_balance.return_value = BalanceResult(amount="42.50", currency="USD", message="ok", ok=True)
        with mock.patch("suppliers.views.get_supplier_provider", return_value=provider):
            res = auth_client(self.admin).post("/api/v1/admin/1epin/balance/refresh/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["balance"], "42.50")
        self.assertEqual(res.data["amount"], "42.50")
        self.assertEqual(res.data["currency"], "USD")
        self.assertFalse(res.data["cached"])
        cached = auth_client(self.viewer).get("/api/v1/admin/1epin/balance/")
        self.assertEqual(cached.data["balance"], "42.50")
        self.assertTrue(cached.data["ok"])
        self.assertTrue(cached.data["cached"])

    @override_settings(SUPPLIER_MODE="test")
    def test_balance_refresh_failure_502(self):
        with mock.patch("suppliers.views.get_supplier_provider", side_effect=SupplierError("1Epin HTTP 500")):
            res = auth_client(self.admin).post("/api/v1/admin/1epin/balance/refresh/")
        self.assertEqual(res.status_code, 502)
        self.assertFalse(res.data["ok"])
        self.assertIn("detail", res.data)
        provider = mock.Mock()
        provider.get_balance.return_value = BalanceResult(amount="0", currency="USD", message="bad creds", ok=False)
        with mock.patch("suppliers.views.get_supplier_provider", return_value=provider):
            res = auth_client(self.admin).post("/api/v1/admin/1epin/balance/refresh/")
        self.assertEqual(res.status_code, 502)
        self.assertEqual(res.data["detail"], "bad creds")

    def test_sync_mock_ok_and_failure_502(self):
        res = auth_client(self.admin).post("/api/v1/admin/1epin/sync/")
        self.assertEqual(res.status_code, 200)  # mock catalog sync (D-1E-1/3)
        self.assertTrue(res.data["ok"])
        self.assertGreater(res.data["total"], 0)
        with mock.patch("suppliers.views.get_supplier_provider", side_effect=SupplierError("timeout")):
            res = auth_client(self.admin).post("/api/v1/admin/1epin/sync/")
        self.assertEqual(res.status_code, 502)
        self.assertEqual(res.data, {"ok": False, "detail": "timeout", "message": "timeout"})
        provider = mock.Mock()
        provider.sync_catalog.return_value = {"ok": False, "imported": 0, "message": "remote error"}
        with mock.patch("suppliers.views.get_supplier_provider", return_value=provider):
            res = auth_client(self.admin).post("/api/v1/admin/1epin/sync/")
        self.assertEqual(res.status_code, 502)
        provider.sync_catalog.return_value = {"ok": True, "imported": 3, "message": "done"}
        with mock.patch("suppliers.views.get_supplier_provider", return_value=provider):
            res = auth_client(self.admin).post("/api/v1/admin/1epin/sync/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["imported"], 3)

    def test_supplier_crud_audited(self):
        client = auth_client(self.admin)
        res = client.post("/api/v1/admin/suppliers/", {"slug": "acme", "name": "Acme"}, format="json")
        self.assertEqual(res.status_code, 201)
        supplier = Supplier.objects.get(slug="acme")
        self.assertTrue(SupplierConnection.objects.filter(supplier=supplier).exists())
        client.patch(f"/api/v1/admin/suppliers/{supplier.pk}/", {"active": False}, format="json")
        client.delete(f"/api/v1/admin/suppliers/{supplier.pk}/")
        actions = set(AuditLog.objects.filter(entity_type="Supplier").values_list("action", flat=True))
        self.assertEqual(actions, {"supplier.created", "supplier.updated", "supplier.deleted"})


class SupplierDeleteTests(TestCase):
    def test_supplier_with_orders_returns_409_not_500(self):
        admin = make_admin("sup-delete@mmh.test", AdminRole.SUPER_ADMIN)
        supplier = Supplier.objects.create(slug="busy-supplier", name="Busy")
        SupplierOrder.objects.create(supplier=supplier, order_item_id=1, supplier_ref="BUSY-1")

        res = auth_client(admin).delete(f"/api/v1/admin/suppliers/{supplier.id}/")

        self.assertEqual(res.status_code, 409, res.content)
        self.assertTrue(Supplier.objects.filter(pk=supplier.pk).exists())

    def test_unused_supplier_can_be_deleted(self):
        admin = make_admin("sup-delete2@mmh.test", AdminRole.SUPER_ADMIN)
        supplier = Supplier.objects.create(slug="idle-supplier", name="Idle")

        res = auth_client(admin).delete(f"/api/v1/admin/suppliers/{supplier.id}/")

        self.assertEqual(res.status_code, 204, res.content)
