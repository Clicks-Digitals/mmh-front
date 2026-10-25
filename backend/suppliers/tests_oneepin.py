"""1Epin integration contract tests (D-1E-1..12). No network: a fake transport replays the
example payloads of the official API document (v1.0.5)."""

from __future__ import annotations

import copy
from datetime import timedelta
from decimal import Decimal
from io import StringIO

from django.core import mail
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from accounts.models import AdminRole
from accounts.tests_admin import auth_client, make_admin, seed_permissions
from audit.models import AuditLog
from catalog.models import (
    Category,
    FieldInputType,
    FulfillmentType,
    Platform,
    Product,
    ProductFieldDefinition,
    ProductKind,
    ProductVariant,
    PublishStatus,
)
from cms.models import SiteSettings
from commerce.crypto import code_identity, encode_code_payload, encrypt_code, fingerprint_code, mask_code, reveal_code
from commerce.models import (
    DigitalCode,
    DigitalCodeSource,
    DigitalCodeStatus,
    FulfillmentStatus,
    Order,
    OrderItem,
    PaymentStatus,
)
from suppliers.models import (
    SupplierAlert,
    SupplierApiLog,
    SupplierCatalogItem,
    SupplierOrder,
    SupplierProductMapping,
    SupplierStatus,
    SupplierWebhookEvent,
)
from suppliers.provider import TransportError, ensure_supplier, override_transport
from suppliers.services.catalog import sync_catalog
from suppliers.services.fulfillment import fulfill_from_supplier, staff_purchase
from suppliers.services.mapping import TemplateError, render_user
from suppliers.services.reconcile import reconcile_supplier_orders

# --- Official document examples (https://www.1epin.com/api/document.html, v1.0.5) --------------
DOC_BALANCE = {"ResultCode": "00", "ResultMessage": "Success", "Balance": 9999927.99}
DOC_WRONG_CREDENTIALS_BALANCE = {"ResultCode": "03", "ResultMessage": "Wrong Username/Password", "Balance": 0.0}
DOC_ALL_PRODUCTS = {
    "ResultCode": "00",
    "ResultMessage": "Success",
    "Products": [
        {"CategoryId": 131, "CategoryName": "PUBG Mobile", "CategoryType": "epin", "ProductId": 28, "ProductName": "PUBG Mobile 28 UC", "ProductPrice": 6.00},
        {"CategoryId": 131, "CategoryName": "PUBG Mobile", "CategoryType": "epin", "ProductId": 29, "ProductName": "PUBG Mobile 55 UC", "ProductPrice": 10.00},
        {"CategoryId": 131, "CategoryName": "PUBG Mobile", "CategoryType": "epin", "ProductId": 30, "ProductName": "PUBG Mobile 143 UC", "ProductPrice": 24.00},
    ],
}
DOC_ALL_PRODUCTS_WRONG = {"ResultCode": "03", "ResultMessage": "Wrong Username/Password", "Products": None}
DOC_ADD_ORDER_OK = {"ResultCode": "00", "ResultMessage": "Success", "Balance": 9999867.99}
DOC_ADD_ORDER_WRONG_PRODUCT = {"ResultCode": "06", "ResultMessage": "Product Not Found", "Balance": 0.0}
DOC_CHECK_NOT_FOUND = {
    "ResultCode": "08", "ResultMessage": "Order Not Found", "OrderStatusCode": 0,
    "OrderStatusMessage": "", "PinCodes": None, "OrderAmount": 0.0,
}
DOC_PINS = ["1EPIN-AAAA-1111", "1EPIN-BBBB-2222", "1EPIN-CCCC-3333", "1EPIN-DDDD-4444"]
DOC_CHECK_COMPLETED = {
    "ResultCode": "00", "ResultMessage": "Success", "OrderStatusCode": 1,
    "OrderStatusMessage": "Completed", "PinCodes": DOC_PINS, "OrderAmount": 0.25,
}
DOC_CHECK_FAILED = {
    "ResultCode": "00", "ResultMessage": "Success", "OrderStatusCode": 2,
    "OrderStatusMessage": "wrong_player_id", "PinCodes": [], "OrderAmount": 0.0,
}
DOC_CHECK_WAITING = {
    "ResultCode": "00", "ResultMessage": "Success", "OrderStatusCode": 0,
    "OrderStatusMessage": "Processing", "PinCodes": [], "OrderAmount": 0.0,
}
DOC_CALLBACK = {
    "OrderNumber": "test123456", "OrderStatusCode": 1, "OrderStatusMessage": "Completed",
    "PinCodes": DOC_PINS, "OrderAmount": 0.02300000,
}


def error(code: str, message: str) -> dict:
    return {"ResultCode": code, "ResultMessage": message}


class FakeTransport:
    """Scripted 1Epin: ``script[method]`` is a list of responses (dict or Exception); the last repeats."""

    def __init__(self, **script):
        self.script = {k: list(v) if isinstance(v, list) else [v] for k, v in script.items()}
        self.calls: list[tuple[str, dict]] = []

    def post_json(self, url, payload, timeout):
        method = url.rstrip("/").rsplit("/", 1)[-1]
        self.calls.append((method, dict(payload), url))
        seq = self.script.get(method)
        if not seq:
            raise AssertionError(f"unexpected 1Epin call {method}")
        resp = seq.pop(0) if len(seq) > 1 else seq[0]
        if isinstance(resp, Exception):
            raise resp
        return copy.deepcopy(resp)

    def get_json(self, url, timeout):
        return {"ip": "203.0.113.7"}

    def methods(self) -> list[str]:
        return [c[0] for c in self.calls]

    def bodies(self, method: str) -> list[dict]:
        return [c[1] for c in self.calls if c[0] == method]


TEST_SETTINGS = dict(
    SUPPLIER_MODE="test",
    ONEEPIN_ALLOW_LIVE=False,
    ONEEPIN_EMAIL="test@1epin.com",
    ONEEPIN_PASSWORD="test1234",
    ONEEPIN_CALLBACK_TOKEN="cb-token-0123456789",
    ONEEPIN_RECONCILE_TOKEN="rc-token",
    ONEEPIN_FX_TO_JOD="0.709",
    ONEEPIN_CURRENCY="USD",
    ONEEPIN_LOW_BALANCE="20",
    ONEEPIN_TEST_COUNTS_AS_STOCK=False,
    ONEEPIN_INLINE_FULFILLMENT=True,
    PUBLIC_API_URL="https://api.example.test",
    ALLOW_DEMO_AUTO_PAYMENT=False,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    SITE_URL="https://shop.test",
)


class OneEpinBase(TestCase):
    _seq = 0

    @classmethod
    def setUpTestData(cls):
        seed_permissions()
        SiteSettings.load()
        cls.admin = make_admin("1e-admin@mmh.test", AdminRole.ADMIN)
        cls.viewer = make_admin("1e-viewer@mmh.test", AdminRole.VIEWER)
        cls.category = Category.objects.create(slug="1e-cat", name_en="Games", status=PublishStatus.PUBLISHED)
        cls.platform = Platform.objects.create(slug="1e-plat", name_en="Mobile", status=PublishStatus.PUBLISHED)
        cls.pubg = Product.objects.create(
            id="1e-pubg", slug="1e-pubg", kind=ProductKind.GIFT_CARD, fulfillment_type=FulfillmentType.CODE,
            category=cls.category, platform=cls.platform, brand="PUBG", artwork_key="pubg",
            status=PublishStatus.PUBLISHED, name_en="PUBG Mobile UC",
        )
        cls.uc28 = ProductVariant.objects.create(
            product=cls.pubg, sku="1E-UC28", denomination=28, package_value="28", package_currency="UC",
            price_fils=5000, name_en="28 UC",
        )
        cls.topup = Product.objects.create(
            id="1e-mlbb", slug="1e-mlbb", kind=ProductKind.DIRECT_TOPUP, fulfillment_type=FulfillmentType.DIRECT_TOPUP,
            category=cls.category, platform=cls.platform, brand="MLBB", artwork_key="mlbb",
            status=PublishStatus.PUBLISHED, name_en="Mobile Legends",
        )
        cls.dia = ProductVariant.objects.create(
            product=cls.topup, sku="1E-DIA86", denomination=86, package_value="86", package_currency="DIA",
            price_fils=5000, name_en="86 Diamonds",
        )
        ProductFieldDefinition.objects.create(product=cls.topup, key="userId", type=FieldInputType.TEXT, required=True, label_en="User ID")
        ProductFieldDefinition.objects.create(product=cls.topup, key="zoneId", type=FieldInputType.TEXT, required=True, label_en="Zone ID")

    def setUp(self):
        self._settings = override_settings(**TEST_SETTINGS)
        self._settings.enable()
        self.addCleanup(self._settings.disable)
        from django.core.cache import cache

        cache.clear()
        self.supplier = ensure_supplier()

    # -- fixtures --------------------------------------------------------------------------
    def catalog_item(self, pid="28", *, kind="epin", price="6.00", env="TEST", name=None, **extra):
        return SupplierCatalogItem.objects.create(
            supplier=self.supplier, environment=env, external_product_id=pid, product_name=name or f"P{pid}",
            category_type=kind, price=Decimal(price), last_seen_at=timezone.now(), currency="USD", **extra
        )

    def mapping(self, variant=None, item=None, **extra):
        variant = variant or self.uc28
        item = item or self.catalog_item()
        return SupplierProductMapping.objects.create(
            supplier=self.supplier, product=variant.product, variant=variant,
            external_product_id=item.external_product_id, catalog_item=item, category_type=item.category_type, **extra
        )

    def paid_order(self, variant=None, qty=1, fields=None, status=FulfillmentStatus.MANUAL_REVIEW):
        variant = variant or self.uc28
        OneEpinBase._seq += 1
        order = Order.objects.create(
            order_number=f"1E{OneEpinBase._seq:010d}", email="buyer@example.com", full_name="Buyer",
            subtotal_fils=variant.price_fils * qty, total_fils=variant.price_fils * qty,
            payment_status=PaymentStatus.PAID, fulfillment_status=status,
        )
        fields = fields or {}
        OrderItem.objects.create(
            order=order, product=variant.product, variant=variant, quantity=qty,
            unit_price_fils=variant.price_fils, line_total_fils=variant.price_fils * qty,
            product_name=variant.product.name_en, variant_name=variant.name_en, customer_fields=fields,
            field_details=[{"key": k, "label_en": k, "label_ar": "", "value": v} for k, v in fields.items()],
        )
        return order

    def topup_order(self, fields=None, qty=1):
        return self.paid_order(self.dia, qty=qty, fields=fields or {"userId": "12345", "zoneId": "678"}, status=FulfillmentStatus.PROCESSING)

    def run_supplier(self, order, transport):
        with override_transport(transport):
            return fulfill_from_supplier(order.id)

    def add_local_code(self, variant, value):
        ct, nonce, masked = encrypt_code(encode_code_payload(value, None))
        return DigitalCode.objects.create(
            variant=variant, status=DigitalCodeStatus.AVAILABLE, source=DigitalCodeSource.CSV_IMPORT,
            code_fingerprint=fingerprint_code(value), code_identity=code_identity(value),
            ciphertext=ct, nonce=nonce, masked=mask_code(value),
        )


class CatalogAndBalanceTests(OneEpinBase):
    def test_sync_catalog_doc_example_upserts_and_deactivates(self):
        fake = FakeTransport(allProducts=DOC_ALL_PRODUCTS)
        with override_transport(fake):
            result = sync_catalog()
        self.assertTrue(result["ok"])
        self.assertEqual((result["created"], result["updated"], result["deactivated"], result["total"]), (3, 0, 0, 3))
        body = fake.bodies("allProducts")[0]
        self.assertEqual(body, {"emailAddress": "test@1epin.com", "password": "test1234"})
        self.assertTrue(fake.calls[0][2].startswith("https://www.1epin.com/api/test/allProducts/"))
        item = SupplierCatalogItem.objects.get(external_product_id="28")
        self.assertEqual((item.category_type, item.product_name, item.price, item.environment), ("epin", "PUBG Mobile 28 UC", Decimal("6.0000"), "TEST"))
        self.mapping(item=item)
        # 29 disappears; 28 price +16.7% on a mapped item -> price_change alert.
        second = copy.deepcopy(DOC_ALL_PRODUCTS)
        second["Products"] = [p for p in second["Products"] if p["ProductId"] != 29]
        second["Products"][0]["ProductPrice"] = 7.00
        with override_transport(FakeTransport(allProducts=second)):
            result = sync_catalog()
        self.assertEqual((result["created"], result["updated"], result["deactivated"]), (0, 1, 1))
        self.assertFalse(SupplierCatalogItem.objects.get(external_product_id="29").active)
        self.assertTrue(SupplierAlert.objects.filter(kind="price_change", resolved=False).exists())
        self.supplier.connection.refresh_from_db()
        self.assertIsNotNone(self.supplier.connection.last_catalog_sync_at)

    def test_sync_wrong_credentials_raises_config_alert(self):
        with override_transport(FakeTransport(allProducts=DOC_ALL_PRODUCTS_WRONG)):
            result = sync_catalog()
        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], "03")
        self.assertTrue(SupplierAlert.objects.filter(kind="config", resolved=False).exists())

    def test_balance_refresh_and_low_balance_alert(self):
        client = auth_client(self.admin)
        with override_transport(FakeTransport(checkBalance=DOC_BALANCE)):
            res = client.post("/api/v1/admin/1epin/balance/refresh/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["balance"], "9999927.99")
        self.assertFalse(res.data["low_balance"])
        with override_transport(FakeTransport(checkBalance={"ResultCode": "00", "ResultMessage": "Success", "Balance": 5.5})):
            res = client.post("/api/v1/admin/1epin/balance/refresh/")
        self.assertTrue(res.data["low_balance"])
        self.assertEqual(SupplierAlert.objects.filter(kind="low_balance", resolved=False).count(), 1)
        with override_transport(FakeTransport(checkBalance=DOC_BALANCE)):
            client.post("/api/v1/admin/1epin/balance/refresh/")
        self.assertFalse(SupplierAlert.objects.filter(kind="low_balance", resolved=False).exists())
        self.assertTrue(AuditLog.objects.filter(action="suppliers.1epin.balance_refresh").exists())

    def test_balance_wrong_credentials_502(self):
        with override_transport(FakeTransport(checkBalance=DOC_WRONG_CREDENTIALS_BALANCE)):
            res = auth_client(self.admin).post("/api/v1/admin/1epin/balance/refresh/")
        self.assertEqual(res.status_code, 502)
        self.assertEqual(res.data["code"], "03")

    def test_unauthorized_ip_02_readable(self):
        with override_transport(FakeTransport(checkBalance=error("02", "Unauthorized Ip Address (203.0.113.7)"))):
            res = auth_client(self.admin).post("/api/v1/admin/1epin/balance/refresh/")
        self.assertEqual(res.status_code, 502)
        self.assertIn("register", res.data["detail"])

    def test_password_never_logged_or_stored(self):
        self.mapping()
        order = self.paid_order(qty=4)
        self.run_supplier(order, FakeTransport(addOrder=DOC_ADD_ORDER_OK, checkOrder=DOC_CHECK_COMPLETED))
        for log in SupplierApiLog.objects.all():
            self.assertNotIn("test1234", log.message)
        so = SupplierOrder.objects.get()
        blob = str(so.request_payload) + str(so.response_payload)
        self.assertNotIn("test1234", blob)
        self.assertNotIn("test@1epin.com", blob)
        for pin in DOC_PINS:
            self.assertNotIn(pin, blob)
        logs = SupplierApiLog.objects.filter(order_number=so.supplier_ref)
        self.assertEqual(sorted(logs.values_list("action", flat=True)), ["addOrder", "checkOrder"])
        self.assertTrue(all(log.result_code == "00" for log in logs))


class FulfillmentContractTests(OneEpinBase):
    def test_epin_completed_delivers_encrypted_codes(self):
        self.mapping()
        order = self.paid_order(qty=4)
        item = order.items.get()
        fake = FakeTransport(addOrder=DOC_ADD_ORDER_OK, checkOrder=DOC_CHECK_COMPLETED)
        with self.captureOnCommitCallbacks(execute=True):
            self.run_supplier(order, fake)
        self.assertEqual(fake.methods(), ["addOrder", "checkOrder"])
        add = fake.bodies("addOrder")[0]
        self.assertEqual(add["product"], 28)
        self.assertEqual(add["quantity"], 4)
        self.assertEqual(add["orderNumber"], f"MMH-{order.order_number}-{item.id}-1")
        self.assertNotIn("user", add)
        self.assertNotIn("barem", add)
        so = SupplierOrder.objects.get()
        self.assertEqual(so.status, SupplierStatus.COMPLETED)
        self.assertTrue(so.placed)
        self.assertEqual(so.cost, Decimal("0.25"))
        self.assertEqual(so.balance_after, Decimal("9999867.99"))
        codes = list(item.codes.order_by("id"))
        self.assertEqual(len(codes), 4)
        self.assertEqual(sorted(reveal_code(c)[0] for c in codes), sorted(DOC_PINS))
        for c in codes:
            self.assertEqual(c.source, DigitalCodeSource.ONEEPIN)
            self.assertEqual(c.status, DigitalCodeStatus.DELIVERED)
            self.assertNotIn(c.ciphertext, DOC_PINS)
        order.refresh_from_db()
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.COMPLETED)
        self.assertEqual(self.supplier.connection.__class__.objects.get(pk=self.supplier.connection.pk).last_balance, "9999867.99")
        self.assertTrue(AuditLog.objects.filter(action="suppliers.order_placed").exists())
        self.assertTrue(AuditLog.objects.filter(action="suppliers.order_completed").exists())
        self.assertEqual(len(mail.outbox), 1)  # codes e-mail

    def test_processing_then_callback_confirmed_by_check_order(self):
        self.mapping()
        order = self.paid_order(qty=4)
        self.run_supplier(order, FakeTransport(addOrder=DOC_ADD_ORDER_OK, checkOrder=DOC_CHECK_WAITING))
        so = SupplierOrder.objects.get()
        self.assertEqual(so.status, SupplierStatus.PROCESSING)
        order.refresh_from_db()
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.PROCESSING)
        payload = dict(DOC_CALLBACK, OrderNumber=so.supplier_ref)
        # A forged/early callback says "Completed" but checkOrder says Processing: nothing applied.
        with override_transport(FakeTransport(checkOrder=DOC_CHECK_WAITING)):
            res = self.client.post(f"/api/v1/suppliers/1epin/callback/{TEST_SETTINGS['ONEEPIN_CALLBACK_TOKEN']}/", payload, content_type="application/json")
        self.assertEqual((res.status_code, res.content), (200, b"OK"))
        self.assertEqual(DigitalCode.objects.count(), 0)
        event = SupplierWebhookEvent.objects.get()
        for pin in DOC_PINS:
            self.assertNotIn(pin, str(event.payload))
        # Next callback (new dedupe key not needed: same key, re-confirmed) -> checkOrder completed.
        fake = FakeTransport(checkOrder=DOC_CHECK_COMPLETED)
        with override_transport(fake):
            res = self.client.post(
                "/api/v1/suppliers/1epin/callback/", payload, content_type="application/json",
                HTTP_X_CALLBACK_TOKEN=TEST_SETTINGS["ONEEPIN_CALLBACK_TOKEN"],
            )
        self.assertEqual(res.content, b"OK")
        self.assertEqual(fake.methods(), ["checkOrder"])
        so.refresh_from_db()
        self.assertEqual(so.status, SupplierStatus.COMPLETED)
        self.assertEqual(DigitalCode.objects.filter(order_item__order=order).count(), 4)

    def test_callback_unknown_order_and_bad_token(self):
        res = self.client.post(f"/api/v1/suppliers/1epin/callback/{TEST_SETTINGS['ONEEPIN_CALLBACK_TOKEN']}/", DOC_CALLBACK, content_type="application/json")
        self.assertEqual((res.status_code, res.content), (200, b"OK"))
        self.assertEqual(SupplierWebhookEvent.objects.get().reason, "no_matching_supplier_order")
        res = self.client.post("/api/v1/suppliers/1epin/callback/nope/", DOC_CALLBACK, content_type="application/json")
        self.assertEqual(res.status_code, 401)

    def test_topup_failed_wrong_player_id_then_staff_retry(self):
        item = self.catalog_item("301", kind="topup", price="1.40")
        self.mapping(self.dia, item, user_template="{userId}({zoneId})")
        order = self.topup_order()
        fake = FakeTransport(addOrder=DOC_ADD_ORDER_OK, checkOrder=DOC_CHECK_FAILED)
        self.run_supplier(order, fake)
        add = fake.bodies("addOrder")[0]
        self.assertEqual((add["user"], add["quantity"]), ("12345(678)", 1))
        so = SupplierOrder.objects.get()
        self.assertEqual(so.status, SupplierStatus.FAILED)
        self.assertIn("wrong_player_id", so.message)
        order.refresh_from_db()
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.MANUAL_REVIEW)
        self.assertTrue(SupplierAlert.objects.filter(kind="order_failed").exists())
        # Staff retry: attempt 2, new number, top-up delivered with the note.
        fake2 = FakeTransport(addOrder=DOC_ADD_ORDER_OK, checkOrder=dict(DOC_CHECK_COMPLETED, PinCodes=[]))
        with override_transport(fake2):
            res = auth_client(self.admin).post(
                f"/api/v1/admin/orders/{order.order_number}/items/{order.items.get().id}/supplier/retry/", {"confirm": True}, format="json"
            )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["supplier_action"]["supplier_order"]["attempt"], 2)
        self.assertTrue(fake2.bodies("addOrder")[0]["orderNumber"].endswith("-2"))
        topup_item = order.items.get()
        self.assertEqual(topup_item.delivery_note, "Your top-up has been added to your game account.")
        order.refresh_from_db()
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.COMPLETED)
        self.assertTrue(AuditLog.objects.filter(action="suppliers.staff_retry").exists())

    def test_add_order_refusals_go_to_manual_review(self):
        cases = {
            "01": "Missing Parameter", "05": "Category Not Found", "06": "Product Not Found",
            "09": "Product type is popup, must send user", "11": "Product not available for sale via API",
            "12": "Valid barem required", "13": "Barem out of range", "14": "Barem must be whole number",
            "15": "Product does not accept barem", "16": "Max quantity exceeded", "17": "Min quantity not met",
        }
        for code, message in cases.items():
            with self.subTest(code=code):
                SupplierProductMapping.objects.all().delete()
                SupplierCatalogItem.objects.all().delete()
                self.mapping()
                order = self.paid_order()
                response = DOC_ADD_ORDER_WRONG_PRODUCT if code == "06" else error(code, message)
                fake = FakeTransport(addOrder=response)
                self.run_supplier(order, fake)
                self.assertEqual(fake.methods(), ["addOrder"])  # no checkOrder, no retry
                so = SupplierOrder.objects.get(order=order)
                self.assertEqual((so.status, so.placed, so.result_code), (SupplierStatus.MANUAL_REVIEW, False, code))
                self.assertTrue(so.message)
                order.refresh_from_db()
                self.assertEqual(order.fulfillment_status, FulfillmentStatus.MANUAL_REVIEW)
                self.assertTrue(SupplierAlert.objects.filter(supplier_order=so, kind="order_failed").exists())
                if code == "12":
                    self.assertTrue(SupplierCatalogItem.objects.get(external_product_id="28").is_tiered)

    def test_no_balance_04_alert_and_no_auto_retry(self):
        self.mapping()
        order = self.paid_order()
        self.run_supplier(order, FakeTransport(addOrder=error("04", "No Balance")))
        so = SupplierOrder.objects.get()
        self.assertEqual(so.status, SupplierStatus.MANUAL_REVIEW)
        self.assertTrue(SupplierAlert.objects.filter(kind="low_balance", resolved=False).exists())
        SupplierOrder.objects.update(updated_at=timezone.now() - timedelta(hours=1))
        fake = FakeTransport()
        with override_transport(fake):
            reconcile_supplier_orders()
        self.assertEqual(fake.calls, [])

    def test_config_errors_02_03_alert(self):
        for code in ("02", "03"):
            with self.subTest(code=code):
                SupplierProductMapping.objects.all().delete()
                SupplierCatalogItem.objects.all().delete()
                self.mapping()
                order = self.paid_order()
                self.run_supplier(order, FakeTransport(addOrder=error(code, "Unauthorized Ip Address (1.2.3.4)")))
                so = SupplierOrder.objects.get(order=order)
                self.assertEqual(so.status, SupplierStatus.MANUAL_REVIEW)
                self.assertTrue(SupplierAlert.objects.filter(kind="config", dedupe_key=f"config:{code}").exists())

    def test_service_window_10_retried_by_reconcile_with_same_number(self):
        self.mapping()
        order = self.paid_order(qty=4)
        self.run_supplier(order, FakeTransport(addOrder=error("10", "Agreement time")))
        so = SupplierOrder.objects.get()
        self.assertEqual(so.status, SupplierStatus.WAITING)
        fake = FakeTransport()
        with override_transport(fake):
            reconcile_supplier_orders()  # still inside the window
        self.assertEqual(fake.calls, [])
        SupplierOrder.objects.update(retry_after=timezone.now() - timedelta(minutes=1))
        fake = FakeTransport(addOrder=DOC_ADD_ORDER_OK, checkOrder=DOC_CHECK_COMPLETED)
        with override_transport(fake):
            reconcile_supplier_orders()
        self.assertEqual(fake.bodies("addOrder")[0]["orderNumber"], so.supplier_ref)
        so.refresh_from_db()
        self.assertEqual(so.status, SupplierStatus.COMPLETED)

    def test_registered_order_number_07_is_checked_not_rebought(self):
        self.mapping()
        order = self.paid_order(qty=4)
        fake = FakeTransport(addOrder=error("07", "Registered OrderNumber"), checkOrder=DOC_CHECK_COMPLETED)
        self.run_supplier(order, fake)
        self.assertEqual(fake.methods(), ["addOrder", "checkOrder"])
        self.assertEqual(SupplierOrder.objects.get().status, SupplierStatus.COMPLETED)

    def test_timeout_is_unknown_then_reconciled_without_second_purchase(self):
        self.mapping()
        order = self.paid_order(qty=4)
        self.run_supplier(order, FakeTransport(addOrder=TransportError("timed out")))
        so = SupplierOrder.objects.get()
        self.assertEqual(so.status, SupplierStatus.UNKNOWN)
        # Fresh -> reconcile waits 2 minutes.
        fake = FakeTransport()
        with override_transport(fake):
            reconcile_supplier_orders()
        self.assertEqual(fake.calls, [])
        SupplierOrder.objects.update(updated_at=timezone.now() - timedelta(minutes=3))
        fake = FakeTransport(checkOrder=DOC_CHECK_COMPLETED)
        with override_transport(fake):
            summary = reconcile_supplier_orders()
        self.assertEqual(fake.methods(), ["checkOrder"])  # the order existed: never re-placed
        self.assertEqual(summary["completed"], 1)
        self.assertEqual(SupplierOrder.objects.get().status, SupplierStatus.COMPLETED)

    def test_timeout_then_08_resubmits_same_order_number(self):
        self.mapping()
        order = self.paid_order(qty=4)
        self.run_supplier(order, FakeTransport(addOrder=TransportError("connection reset")))
        so = SupplierOrder.objects.get()
        SupplierOrder.objects.update(updated_at=timezone.now() - timedelta(minutes=3))
        fake = FakeTransport(checkOrder=[DOC_CHECK_NOT_FOUND, DOC_CHECK_COMPLETED], addOrder=DOC_ADD_ORDER_OK)
        with override_transport(fake):
            reconcile_supplier_orders()
        self.assertEqual(fake.methods(), ["checkOrder", "addOrder", "checkOrder"])
        self.assertEqual({b["orderNumber"] for b in fake.bodies("addOrder")}, {so.supplier_ref})
        self.assertEqual(SupplierOrder.objects.count(), 1)
        self.assertEqual(SupplierOrder.objects.get().status, SupplierStatus.COMPLETED)

    def test_planning_is_idempotent(self):
        self.mapping()
        order = self.paid_order()
        fake = FakeTransport(addOrder=DOC_ADD_ORDER_OK, checkOrder=DOC_CHECK_WAITING)
        self.run_supplier(order, fake)
        self.run_supplier(order, fake)
        self.assertEqual(fake.methods().count("addOrder"), 1)
        # Staff cannot start another purchase while 1Epin may still deliver.
        with override_transport(fake):
            res = auth_client(self.admin).post(
                f"/api/v1/admin/orders/{order.order_number}/items/{order.items.get().id}/supplier/buy/", {"confirm": True}, format="json"
            )
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["code"], "supplier_order_active")

    def test_stuck_over_two_hours_goes_to_manual_review(self):
        self.mapping()
        order = self.paid_order()
        self.run_supplier(order, FakeTransport(addOrder=DOC_ADD_ORDER_OK, checkOrder=DOC_CHECK_WAITING))
        past = timezone.now() - timedelta(hours=3)
        SupplierOrder.objects.update(created_at=past, updated_at=past)
        with override_transport(FakeTransport(checkOrder=DOC_CHECK_WAITING)):
            summary = reconcile_supplier_orders()
        self.assertEqual(summary["stuck"], 1)
        so = SupplierOrder.objects.get()
        self.assertEqual(so.status, SupplierStatus.MANUAL_REVIEW)
        self.assertTrue(SupplierAlert.objects.filter(dedupe_key=f"stuck:{so.supplier_ref}").exists())
        order.refresh_from_db()
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.MANUAL_REVIEW)
        # Still checked later: it completes.
        SupplierOrder.objects.update(updated_at=past)
        with override_transport(FakeTransport(checkOrder=dict(DOC_CHECK_COMPLETED, PinCodes=DOC_PINS[:1]))):
            reconcile_supplier_orders()
        self.assertEqual(SupplierOrder.objects.get().status, SupplierStatus.COMPLETED)

    def test_duplicate_supplier_code_not_delivered_twice(self):
        self.mapping()
        self.add_local_code(self.pubg.variants.create(sku="1E-OTHER", denomination=1, package_value="1", package_currency="UC", price_fils=1, name_en="x"), DOC_PINS[0])
        order = self.paid_order(qty=4)
        self.run_supplier(order, FakeTransport(addOrder=DOC_ADD_ORDER_OK, checkOrder=DOC_CHECK_COMPLETED))
        so = SupplierOrder.objects.get()
        self.assertEqual(so.status, SupplierStatus.MANUAL_REVIEW)
        self.assertEqual(so.codes_delivered, 3)
        self.assertEqual(DigitalCode.objects.filter(code_identity=code_identity(DOC_PINS[0])).count(), 1)
        self.assertTrue(SupplierAlert.objects.filter(kind="duplicate_code").exists())
        order.refresh_from_db()
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.MANUAL_REVIEW)

    def test_money_guard_and_buy_now_override(self):
        # 6.00 USD * 0.709 = 4.254 JOD > max 4.000 JOD -> skipped.
        self.mapping(max_cost_fils=4000)
        order = self.paid_order()
        fake = FakeTransport()
        self.run_supplier(order, fake)
        self.assertEqual(fake.calls, [])
        so = SupplierOrder.objects.get()
        self.assertEqual((so.status, so.message), (SupplierStatus.MANUAL_REVIEW, "Supplier cost above limit"))
        self.assertEqual(so.cost_fils, 4254)
        # Staff "Buy from supplier now" after seeing the cost: guard overridden.
        payload = auth_client(self.admin).get(f"/api/v1/admin/orders/{order.order_number}/").data
        block = payload["items"][0]["supplier_order"]
        self.assertTrue(block["actions"]["buy_now"]["enabled"], block)
        self.assertEqual(block["actions"]["buy_now"]["quote"]["cost_fils"], 4254)
        res = auth_client(self.admin).post(
            f"/api/v1/admin/orders/{order.order_number}/items/{order.items.get().id}/supplier/buy/", {}, format="json"
        )
        self.assertEqual(res.data["code"], "confirmation_required")
        fake = FakeTransport(addOrder=DOC_ADD_ORDER_OK, checkOrder=dict(DOC_CHECK_COMPLETED, PinCodes=DOC_PINS[:1]))
        with override_transport(fake):
            res = auth_client(self.admin).post(
                f"/api/v1/admin/orders/{order.order_number}/items/{order.items.get().id}/supplier/buy/", {"confirm": True}, format="json"
            )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["fulfillment_status"], FulfillmentStatus.COMPLETED)
        self.assertTrue(AuditLog.objects.filter(action="suppliers.staff_buy_now").exists())

    def test_money_guard_loss_and_allow_loss(self):
        expensive = self.catalog_item("30", price="24.00")  # 17.016 JOD > 5.000 JOD sale price
        self.mapping(item=expensive)
        order = self.paid_order()
        self.run_supplier(order, FakeTransport())
        self.assertEqual(SupplierOrder.objects.get().message, "Supplier cost above limit")
        SupplierProductMapping.objects.update(allow_loss=True)
        order2 = self.paid_order()
        fake = FakeTransport(addOrder=DOC_ADD_ORDER_OK, checkOrder=DOC_CHECK_WAITING)
        self.run_supplier(order2, fake)
        self.assertEqual(fake.methods()[0], "addOrder")

    def test_user_templates(self):
        fields = {"userId": "12345", "zoneId": "678"}
        details = [{"key": "userId", "value": "12345"}, {"key": "zoneId", "value": "678"}]
        self.assertEqual(render_user("{userId}({zoneId})", fields, details), "12345(678)")
        self.assertEqual(render_user("", fields, details), "12345")
        self.assertEqual(render_user("", {"zone": "1", "player_id": "P9"}, [{"key": "zone", "value": "1"}, {"key": "player_id", "value": "P9"}]), "P9")
        with self.assertRaises(TemplateError):
            render_user("{userId}({zoneId})", {"userId": "1"}, [])
        # Missing field -> manual review, nothing sent.
        item = self.catalog_item("301", kind="topup", price="1.40")
        self.mapping(self.dia, item, user_template="{userId}({serverId})")
        order = self.topup_order()
        fake = FakeTransport()
        self.run_supplier(order, fake)
        self.assertEqual(fake.calls, [])
        self.assertIn("serverId", SupplierOrder.objects.get().message)

    def test_own_stock_first_then_supplier_for_the_rest(self):
        from commerce.services.inventory import allocate_codes

        self.mapping()
        self.add_local_code(self.uc28, "LOCAL-CODE-0001")
        order = self.paid_order(qty=2, status=FulfillmentStatus.NOT_STARTED)
        Order.objects.filter(pk=order.pk).update(fulfillment_status=FulfillmentStatus.NOT_STARTED)
        allocate_codes(order)
        fake = FakeTransport(addOrder=DOC_ADD_ORDER_OK, checkOrder=dict(DOC_CHECK_COMPLETED, PinCodes=DOC_PINS[:1]))
        self.run_supplier(order, fake)
        self.assertEqual(fake.bodies("addOrder")[0]["quantity"], 1)
        order.refresh_from_db()
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.COMPLETED)

    def test_prefer_supplier_skips_own_stock(self):
        from commerce.services.inventory import allocate_codes

        self.mapping(prefer_supplier=True)
        local = self.add_local_code(self.uc28, "LOCAL-CODE-0002")
        order = self.paid_order(qty=1, status=FulfillmentStatus.NOT_STARTED)
        allocate_codes(order)
        local.refresh_from_db()
        self.assertIsNone(local.order_item_id)
        fake = FakeTransport(addOrder=DOC_ADD_ORDER_OK, checkOrder=dict(DOC_CHECK_COMPLETED, PinCodes=DOC_PINS[:1]))
        self.run_supplier(order, fake)
        self.assertEqual(fake.bodies("addOrder")[0]["quantity"], 1)
        order.refresh_from_db()
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.COMPLETED)

    def test_quantity_per_unit_groups_pins(self):
        self.mapping(quantity_per_unit=2, allow_loss=True)
        order = self.paid_order(qty=2)
        fake = FakeTransport(addOrder=DOC_ADD_ORDER_OK, checkOrder=DOC_CHECK_COMPLETED)
        self.run_supplier(order, fake)
        self.assertEqual(fake.bodies("addOrder")[0]["quantity"], 4)
        codes = list(order.items.get().codes.order_by("id"))
        self.assertEqual(len(codes), 2)
        self.assertEqual(reveal_code(codes[0])[0], f"{DOC_PINS[0]} | {DOC_PINS[1]}")

    def test_payment_hook_runs_after_commit_and_never_breaks_payment(self):
        from commerce.models import Payment
        from commerce.services.payment import mark_payment_verified

        self.mapping()
        order = self.paid_order(qty=4)
        Order.objects.filter(pk=order.pk).update(payment_status=PaymentStatus.PENDING, fulfillment_status=FulfillmentStatus.NOT_STARTED)
        payment = Payment.objects.create(order=order, provider="paypal", amount_fils=order.total_fils)
        fake = FakeTransport(addOrder=DOC_ADD_ORDER_OK, checkOrder=DOC_CHECK_COMPLETED)
        with override_transport(fake):
            with self.captureOnCommitCallbacks(execute=False) as callbacks:
                mark_payment_verified(payment, external_ref="cap-1")
            self.assertEqual(fake.calls, [])  # nothing inside the payment transaction
            for cb in callbacks:
                cb()
        self.assertEqual(fake.methods(), ["addOrder", "checkOrder"])
        order.refresh_from_db()
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.COMPLETED)
        # A crashing supplier worker never affects the paid order.
        order2 = self.paid_order()
        Order.objects.filter(pk=order2.pk).update(payment_status=PaymentStatus.PENDING, fulfillment_status=FulfillmentStatus.NOT_STARTED)
        payment2 = Payment.objects.create(order=order2, provider="paypal", amount_fils=order2.total_fils)
        with override_transport(FakeTransport(addOrder=RuntimeError("boom"))):
            with self.captureOnCommitCallbacks(execute=True):
                mark_payment_verified(payment2, external_ref="cap-2")
        order2.refresh_from_db()
        self.assertEqual(order2.payment_status, PaymentStatus.PAID)

    def test_missed_order_picked_up_by_reconcile(self):
        self.mapping()
        order = self.paid_order(qty=4)
        Order.objects.filter(pk=order.pk).update(updated_at=timezone.now() - timedelta(minutes=10))
        fake = FakeTransport(addOrder=DOC_ADD_ORDER_OK, checkOrder=DOC_CHECK_COMPLETED)
        with override_transport(fake):
            summary = reconcile_supplier_orders()
        self.assertEqual(summary["missed_orders"], 1)
        self.assertEqual(SupplierOrder.objects.get().status, SupplierStatus.COMPLETED)

    def test_trading_disabled_without_credentials(self):
        self.mapping()
        order = self.paid_order()
        with override_settings(ONEEPIN_EMAIL="", ONEEPIN_PASSWORD=""):
            self.assertEqual(self.run_supplier(order, FakeTransport()), [])
        self.assertFalse(SupplierOrder.objects.exists())


class StockRuleTests(OneEpinBase):
    def _counts(self):
        from catalog.stock import active_mapping_variant_ids

        return self.uc28.id in active_mapping_variant_ids([self.uc28.id])

    def test_test_mode_counts_only_with_flag(self):
        self.mapping()
        self.assertFalse(self._counts())
        with override_settings(ONEEPIN_TEST_COUNTS_AS_STOCK=True):
            self.assertTrue(self._counts())

    def test_live_requires_switch_credentials_and_fresh_catalog(self):
        item = self.catalog_item(env="LIVE")
        self.mapping(item=item)
        with override_settings(SUPPLIER_MODE="live", ONEEPIN_ALLOW_LIVE=False):
            self.assertFalse(self._counts())
        with override_settings(SUPPLIER_MODE="live", ONEEPIN_ALLOW_LIVE=True):
            self.assertTrue(self._counts())
            SupplierCatalogItem.objects.filter(pk=item.pk).update(last_seen_at=timezone.now() - timedelta(hours=49))
            self.assertFalse(self._counts())
            SupplierCatalogItem.objects.filter(pk=item.pk).update(last_seen_at=timezone.now(), active=False)
            self.assertFalse(self._counts())
            SupplierCatalogItem.objects.filter(pk=item.pk).update(active=True)
            SupplierProductMapping.objects.update(auto_buy=False)
            self.assertFalse(self._counts())
        with override_settings(SUPPLIER_MODE="live", ONEEPIN_ALLOW_LIVE=True, ONEEPIN_EMAIL=""):
            SupplierProductMapping.objects.update(auto_buy=True)
            self.assertFalse(self._counts())


class AdminApiTests(OneEpinBase):
    def test_status_payload(self):
        with override_transport(FakeTransport()):
            res = auth_client(self.admin).get("/api/v1/admin/1epin/status/?refresh_ip=1")
        self.assertEqual(res.status_code, 200)
        data = res.data
        self.assertEqual((data["mode"], data["environment"]), ("test", "TEST"))
        self.assertTrue(data["credentials_configured"])
        self.assertEqual(data["callback_url"], "https://api.example.test/api/v1/suppliers/1epin/callback/cb-token-0123456789/")
        self.assertEqual(data["outgoing_ip"], "203.0.113.7")
        self.assertFalse(data["live_enabled"])
        self.assertTrue(data["trading_enabled"])
        viewer = auth_client(self.viewer).get("/api/v1/admin/1epin/status/").data
        self.assertNotIn("cb-token", viewer["callback_url"])
        self.assertNotIn("test1234", str(viewer))

    def test_catalog_list_filters(self):
        with override_transport(FakeTransport(allProducts=DOC_ALL_PRODUCTS)):
            res = auth_client(self.admin).post("/api/v1/admin/1epin/catalog/sync/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["created"], 3)
        self.assertEqual(auth_client(self.viewer).post("/api/v1/admin/1epin/catalog/sync/").status_code, 403)
        item = SupplierCatalogItem.objects.get(external_product_id="28")
        self.mapping(item=item)
        client = auth_client(self.viewer)
        data = client.get("/api/v1/admin/1epin/catalog/?search=55").data
        self.assertEqual([r["external_product_id"] for r in data["results"]], ["29"])
        mapped = client.get("/api/v1/admin/1epin/catalog/?mapped=true").data["results"]
        self.assertEqual([r["external_product_id"] for r in mapped], ["28"])
        self.assertEqual(mapped[0]["mappings"][0]["variant"], self.uc28.id)
        self.assertEqual(mapped[0]["cost_fils"], 4254)
        self.assertEqual(client.get("/api/v1/admin/1epin/catalog/?type=topup").data["count"], 0)
        self.assertEqual(client.get("/api/v1/admin/1epin/catalog/?category=131").data["count"], 3)
        self.assertEqual(client.get("/api/v1/admin/1epin/catalog/categories/").data[0]["products"], 3)

    def test_mapping_crud_with_cost_and_margin(self):
        item = self.catalog_item("30", price="24.00")
        client = auth_client(self.admin)
        self.assertEqual(
            auth_client(self.viewer).post("/api/v1/admin/1epin/mappings/", {"variant_id": self.uc28.id, "catalog_item_id": item.id}, format="json").status_code,
            403,
        )
        res = client.post(
            "/api/v1/admin/1epin/mappings/",
            {"variant_id": self.uc28.id, "catalog_item_id": item.id, "max_cost_fils": 20000, "prefer_supplier": True},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        body = res.data
        self.assertEqual((body["cost_fils"], body["sale_price_fils"], body["margin_fils"]), (17016, 5000, -12016))
        self.assertIn("loss", body["warning"])
        self.assertTrue(body["prefer_supplier"])
        dup = client.post("/api/v1/admin/1epin/mappings/", {"variant_id": self.uc28.id, "catalog_item_id": item.id}, format="json")
        self.assertEqual((dup.status_code, dup.data["code"]), (409, "variant_already_mapped"))
        topup_item = self.catalog_item("301", kind="topup")
        wrong = client.post("/api/v1/admin/1epin/mappings/", {"variant_id": self.uc28.id + 999999, "catalog_item_id": topup_item.id}, format="json")
        self.assertEqual(wrong.status_code, 404)
        mismatch = client.post("/api/v1/admin/1epin/mappings/", {"variant_id": self.dia.id, "catalog_item_id": item.id}, format="json")
        self.assertEqual(mismatch.data["code"], "type_mismatch")
        mid = body["id"]
        cheap = self.catalog_item("28")
        res = client.patch(f"/api/v1/admin/1epin/mappings/{mid}/", {"catalog_item_id": cheap.id, "user_template": "", "auto_buy": False}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual((res.data["external_product_id"], res.data["margin_fils"], res.data["auto_buy"]), ("28", 746, False))
        self.assertEqual(auth_client(self.viewer).get("/api/v1/admin/1epin/mappings/").data["count"], 1)
        # Product editor shows the same shape.
        product = client.get(f"/api/v1/admin/products/{self.pubg.slug}/").data
        self.assertEqual(product["supplier_mappings"][0]["cost_fils"], 4254)
        self.assertEqual(client.delete(f"/api/v1/admin/1epin/mappings/{mid}/").status_code, 204)
        actions = set(AuditLog.objects.filter(entity_type="SupplierProductMapping").values_list("action", flat=True))
        self.assertEqual(actions, {"supplier.mapping.created", "supplier.mapping.updated", "supplier.mapping.deleted"})

    def test_supplier_orders_list_detail_check_and_order_payload(self):
        self.mapping()
        order = self.paid_order(qty=4)
        self.run_supplier(order, FakeTransport(addOrder=DOC_ADD_ORDER_OK, checkOrder=DOC_CHECK_WAITING))
        so = SupplierOrder.objects.get()
        viewer = auth_client(self.viewer)
        rows = viewer.get("/api/v1/admin/1epin/orders/?status=PROCESSING").data
        self.assertEqual(rows["count"], 1)
        self.assertEqual(rows["results"][0]["external_order_number"], so.supplier_ref)
        self.assertEqual(rows["results"][0]["item"]["quantity"], 4)
        self.assertEqual(viewer.get("/api/v1/admin/1epin/orders/?status=COMPLETED").data["count"], 0)
        self.assertEqual(viewer.get(f"/api/v1/admin/1epin/orders/?order={order.order_number}").data["count"], 1)
        detail = viewer.get(f"/api/v1/admin/1epin/orders/{so.id}/").data
        self.assertEqual([log["action"] for log in detail["api_logs"]], ["checkOrder", "addOrder"])
        self.assertNotIn("password", str(detail["request"]))
        block = auth_client(self.admin).get(f"/api/v1/admin/orders/{order.order_number}/").data["items"][0]["supplier_order"]
        self.assertEqual(block["status"], "PROCESSING")
        self.assertEqual(block["external_order_number"], so.supplier_ref)
        self.assertTrue(block["actions"]["check"]["enabled"])
        self.assertFalse(block["actions"]["retry"]["enabled"])
        self.assertFalse(block["actions"]["buy_now"]["enabled"])
        self.assertEqual(viewer.post(f"/api/v1/admin/orders/{order.order_number}/items/{so.order_item_id}/supplier/check/").status_code, 403)
        with override_transport(FakeTransport(checkOrder=DOC_CHECK_COMPLETED)):
            res = auth_client(self.admin).post(f"/api/v1/admin/orders/{order.order_number}/items/{so.order_item_id}/supplier/check/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["supplier_action"]["result"], "completed")
        self.assertEqual(res.data["fulfillment_status"], FulfillmentStatus.COMPLETED)
        with override_transport(FakeTransport()):
            res = auth_client(self.admin).post(f"/api/v1/admin/1epin/orders/{so.id}/check/")
        self.assertEqual(res.data["result"], "completed")
        self.assertTrue(AuditLog.objects.filter(action="suppliers.order_checked").exists())

    def test_alerts_list_and_resolve(self):
        self.mapping()
        self.run_supplier(self.paid_order(), FakeTransport(addOrder=error("04", "No Balance")))
        rows = auth_client(self.viewer).get("/api/v1/admin/1epin/alerts/").data["results"]
        self.assertEqual(rows[0]["kind"], "low_balance")
        aid = rows[0]["id"]
        self.assertEqual(auth_client(self.viewer).post(f"/api/v1/admin/1epin/alerts/{aid}/resolve/").status_code, 403)
        res = auth_client(self.admin).post(f"/api/v1/admin/1epin/alerts/{aid}/resolve/", {"note": "topped up"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["resolved"])
        self.assertEqual(auth_client(self.admin).post(f"/api/v1/admin/1epin/alerts/{aid}/resolve/").status_code, 409)
        self.assertEqual(auth_client(self.viewer).get("/api/v1/admin/1epin/alerts/?status=open").data["count"], 0)
        self.assertTrue(AuditLog.objects.filter(action="suppliers.alert_resolved").exists())

    def test_reconcile_endpoint_and_scheduled_job(self):
        self.assertEqual(self.client.post("/api/v1/suppliers/1epin/reconcile/").status_code, 401)
        with override_transport(FakeTransport(allProducts=DOC_ALL_PRODUCTS, checkBalance=DOC_BALANCE)):
            res = self.client.post("/api/v1/suppliers/1epin/reconcile/", HTTP_AUTHORIZATION="Bearer rc-token")
            self.assertEqual(res.status_code, 200)
            out = StringIO()
            call_command("run_scheduled_jobs", "--skip-paypal", stdout=out)
        self.assertIn("oneepin", out.getvalue())
        self.assertEqual(SupplierCatalogItem.objects.count(), 3)  # daily sync ran
        self.supplier.connection.refresh_from_db()
        self.assertEqual(self.supplier.connection.last_balance, "9999927.99")
        # Second run the same day: no new sync.
        fake = FakeTransport()
        with override_transport(fake):
            call_command("run_scheduled_jobs", "--skip-paypal", stdout=StringIO())
        self.assertEqual(fake.calls, [])


@override_settings(SUPPLIER_MODE="mock", ONEEPIN_MOCK_FULFILLMENT=True, ONEEPIN_TEST_COUNTS_AS_STOCK=True)
class MockEndToEndTests(OneEpinBase):
    def setUp(self):
        super().setUp()
        self._mock = override_settings(SUPPLIER_MODE="mock", ONEEPIN_MOCK_FULFILLMENT=True, ONEEPIN_TEST_COUNTS_AS_STOCK=True)
        self._mock.enable()
        self.addCleanup(self._mock.disable)
        self.supplier = ensure_supplier()

    def test_paid_order_without_stock_is_delivered_by_mock_supplier(self):
        from commerce.services.checkout import create_storefront_order
        from commerce.services.payment import mark_payment_verified

        result = sync_catalog()
        self.assertTrue(result["ok"])
        item = SupplierCatalogItem.objects.get(environment="MOCK", external_product_id="101")
        self.mapping(item=item)
        self.assertEqual(DigitalCode.objects.filter(variant=self.uc28).count(), 0)
        order = create_storefront_order(
            data={
                "email": "buyer@example.com", "full_name": "Buyer", "region_confirmed": True, "refund_confirmed": True,
                "items": [{"product_id": self.pubg.id, "variant_id": self.uc28.id, "quantity": 2}],
            }
        )
        with self.captureOnCommitCallbacks(execute=True):
            mark_payment_verified(order.payments.get(), external_ref="psp-mock")
        order.refresh_from_db()
        self.assertEqual(order.payment_status, PaymentStatus.PAID)
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.COMPLETED)
        codes = list(DigitalCode.objects.filter(order_item__order=order))
        self.assertEqual(len(codes), 2)
        self.assertTrue(all(reveal_code(c)[0].startswith("MOCK-") for c in codes))
        so = SupplierOrder.objects.get()
        self.assertEqual((so.environment, so.status), ("MOCK", SupplierStatus.COMPLETED))
        subjects = [m.subject for m in mail.outbox]
        self.assertEqual(len(subjects), 2, subjects)  # payment received + codes delivered
        # Mock wallet went down by the cost.
        res = auth_client(self.admin).post("/api/v1/admin/1epin/balance/refresh/")
        self.assertEqual(res.data["balance"], "998.22")

    def test_mock_failure_scenario(self):
        sync_catalog()
        item = SupplierCatalogItem.objects.get(environment="MOCK", external_product_id="9001")
        self.mapping(self.dia, item, allow_loss=True)
        order = self.topup_order()
        fulfill_from_supplier(order.id)
        self.assertEqual(SupplierOrder.objects.get().status, SupplierStatus.FAILED)

    def test_mock_never_buys_outside_development(self):
        with override_settings(ONEEPIN_MOCK_FULFILLMENT=False):
            self.mapping(item=self.catalog_item(env="MOCK", pid="101", price="0.89"))
            order = self.paid_order()
            self.assertEqual(fulfill_from_supplier(order.id), [])
            with self.assertRaises(Exception):
                staff_purchase(order, order.items.get().id, actor=self.admin, mode="buy_now")
