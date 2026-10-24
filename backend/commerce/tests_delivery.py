"""Delivery, customer access, e-mails, admin fulfillment and payment-safety tests (no network)."""

from __future__ import annotations

import re
import tempfile
import threading
from datetime import timedelta
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from django.core import mail
from django.core.cache import cache
from django.core.management import call_command
from django.db import connection, connections, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import AdminRole, User, UserKind
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
    Region,
    StockStatus,
)
from cms.models import SiteSettings
from commerce.crypto import encode_code_payload, encrypt_code, fingerprint_code, mask_code, reveal_code
from commerce.models import (
    CodeImportBatch,
    CodeImportBatchStatus,
    Coupon,
    DigitalCode,
    DigitalCodeSource,
    DigitalCodeStatus,
    FulfillmentStatus,
    Order,
    Payment,
    PaymentStatus,
)
from commerce.services.checkout import INVALID_COUPON_MESSAGE, CheckoutError, create_storefront_order, validate_coupon
from commerce.services.fulfillment import FulfillmentError
from commerce.services.inventory import allocate_codes, available_code_counts
from commerce.services.orders import transition_order
from commerce.services.payment import mark_payment_verified
from commerce.tests_paypal import PAYPAL_SETTINGS, FakePayPal

BASE_SETTINGS = dict(
    ALLOW_DEMO_AUTO_PAYMENT=False,
    IS_PRODUCTION=False,
    SITE_URL="https://shop.test",
    DEFAULT_FROM_EMAIL="MMH Test <no-reply@shop.test>",
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
)


class CatalogFixture:
    """Shared catalog: a CODE gift card (2 variants + hidden one) and a DIRECT_TOPUP product."""

    @classmethod
    def build_catalog(cls):
        cls.category = Category.objects.create(slug="dl-cat", name_en="Cards", status=PublishStatus.PUBLISHED)
        cls.platform = Platform.objects.create(slug="dl-plat", name_en="Steam", status=PublishStatus.PUBLISHED)
        cls.region = Region.objects.create(slug="dl-global", name_en="Global", currency="USD")
        cls.gift = Product.objects.create(
            id="dl-gift",
            slug="dl-gift",
            kind=ProductKind.GIFT_CARD,
            fulfillment_type=FulfillmentType.CODE,
            category=cls.category,
            platform=cls.platform,
            brand="Steam",
            artwork_key="steam",
            status=PublishStatus.PUBLISHED,
            name_en="Steam Card",
        )
        cls.v10 = ProductVariant.objects.create(
            product=cls.gift,
            region=cls.region,
            sku="DL-10",
            denomination=10,
            package_value="10",
            package_currency="USD",
            price_fils=10000,
            name_en="$10",
            external_id="ext-10",
        )
        cls.v20 = ProductVariant.objects.create(
            product=cls.gift,
            region=cls.region,
            sku="DL-20",
            denomination=20,
            package_value="20",
            package_currency="USD",
            price_fils=20000,
            min_quantity=1,
            max_quantity=3,
            name_en="$20",
            external_id="ext-20",
        )
        cls.v_hidden = ProductVariant.objects.create(
            product=cls.gift,
            sku="DL-HIDDEN",
            denomination=50,
            package_value="50",
            package_currency="USD",
            price_fils=50000,
            published=False,
            name_en="$50",
        )
        cls.topup = Product.objects.create(
            id="dl-topup",
            slug="dl-topup",
            kind=ProductKind.DIRECT_TOPUP,
            fulfillment_type=FulfillmentType.DIRECT_TOPUP,
            category=cls.category,
            platform=cls.platform,
            brand="Game",
            artwork_key="game",
            status=PublishStatus.PUBLISHED,
            name_en="Game Top-up",
        )
        cls.t1 = ProductVariant.objects.create(
            product=cls.topup,
            sku="DL-TOP-1",
            denomination=1,
            package_value="100",
            package_currency="UC",
            price_fils=5000,
            name_en="100 UC",
        )
        ProductFieldDefinition.objects.create(
            product=cls.topup, key="player_id", type=FieldInputType.TEXT, required=True, label_en="Player ID"
        )
        ProductFieldDefinition.objects.create(
            product=cls.topup, key="contact", type=FieldInputType.EMAIL, required=False, label_en="Contact email"
        )
        ProductFieldDefinition.objects.create(
            product=cls.topup, key="mobile", type=FieldInputType.TEL, required=False, label_en="Mobile"
        )
        cls.draft = Product.objects.create(
            id="dl-draft",
            slug="dl-draft",
            kind=ProductKind.GIFT_CARD,
            fulfillment_type=FulfillmentType.CODE,
            category=cls.category,
            platform=cls.platform,
            brand="Draft",
            artwork_key="d",
            status=PublishStatus.DRAFT,
            name_en="Draft Card",
        )
        cls.draft_variant = ProductVariant.objects.create(
            product=cls.draft,
            sku="DL-DRAFT",
            denomination=5,
            package_value="5",
            package_currency="USD",
            price_fils=5000,
            name_en="$5",
        )

    _code_seq = 0

    def add_codes(self, variant, count, *, pin=None):
        created = []
        for _ in range(count):
            CatalogFixture._code_seq += 1
            value = f"CODE-{variant.sku}-{CatalogFixture._code_seq:05d}-ZX{CatalogFixture._code_seq % 10}Q"
            ct, nonce, masked = encrypt_code(encode_code_payload(value, pin))
            created.append(
                DigitalCode.objects.create(
                    variant=variant,
                    status=DigitalCodeStatus.AVAILABLE,
                    source=DigitalCodeSource.CSV_IMPORT,
                    code_fingerprint=fingerprint_code(value, pin),
                    ciphertext=ct,
                    nonce=nonce,
                    masked=mask_code(value),
                )
            )
        return created

    def order_data(self, items=None, **extra):
        data = {
            "email": "buyer@example.com",
            "full_name": "Buyer One",
            "region_confirmed": True,
            "refund_confirmed": True,
            "items": items or [{"product_id": self.gift.id, "variant_id": self.v10.id, "quantity": 1}],
        }
        data.update(extra)
        return data

    def topup_item(self, **fields):
        return {
            "product_id": self.topup.id,
            "variant_id": self.t1.id,
            "quantity": 1,
            "fields": fields or {"player_id": "PLAYER-77"},
        }

    def paid_order(self, items=None, **extra):
        order = create_storefront_order(data=self.order_data(items, **extra))
        mark_payment_verified(order.payments.get(), external_ref="psp-test")
        order.refresh_from_db()
        return order

    def post_checkout(self, client=None, **payload):
        client = client or APIClient()
        return client.post("/api/v1/checkout/orders/", self.order_data(**payload), format="json")


@override_settings(**BASE_SETTINGS)
class InventoryAllocationTests(CatalogFixture, TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.build_catalog()
        seed_permissions()
        SiteSettings.load()
        cls.admin = make_admin("dl-admin@mmh.test", AdminRole.ADMIN)

    def setUp(self):
        cache.clear()

    def test_available_counts_ignore_assigned_and_unavailable(self):
        codes = self.add_codes(self.v10, 3)
        codes[0].status = DigitalCodeStatus.UNAVAILABLE
        codes[0].save()
        self.assertEqual(available_code_counts([self.v10.id, self.v20.id]), {self.v10.id: 2, self.v20.id: 0})

    def test_full_allocation_completes_order(self):
        self.add_codes(self.v10, 3)
        order = self.paid_order([{"product_id": self.gift.id, "variant_id": self.v10.id, "quantity": 2}])
        self.assertEqual(order.payment_status, PaymentStatus.PAID)
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.COMPLETED)
        item = order.items.get()
        self.assertIsNotNone(item.delivered_at)
        codes = list(item.codes.all())
        self.assertEqual(len(codes), 2)
        for code in codes:
            self.assertEqual(code.status, DigitalCodeStatus.DELIVERED)
            self.assertIsNotNone(code.delivered_at)
        self.assertEqual(available_code_counts([self.v10.id])[self.v10.id], 1)
        self.assertTrue(AuditLog.objects.filter(action="orders.codes_allocated", entity_id=str(order.id)).exists())

    def test_partial_stock_goes_to_manual_review_and_admin_fulfill_completes(self):
        self.add_codes(self.v20, 1)
        order = create_storefront_order(
            data=self.order_data([{"product_id": self.gift.id, "variant_id": self.v20.id, "quantity": 1}])
        )
        # Another order consumes stock after checkout -> shortage at payment time.
        item = order.items.get()
        item.quantity = 2
        item.save()
        mark_payment_verified(order.payments.get(), external_ref="x")
        order.refresh_from_db()
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.MANUAL_REVIEW)
        self.assertEqual(item.codes.count(), 1, "partial assignment is kept")
        self.assertIsNone(order.items.get().delivered_at)

        self.add_codes(self.v20, 1)
        client = auth_client(self.admin)
        res = client.post(f"/api/v1/admin/orders/{order.id}/fulfill/")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["fulfillment_status"], FulfillmentStatus.COMPLETED)
        self.assertEqual(item.codes.count(), 2)
        self.assertTrue(res.json()["items"][0]["delivered"])

    def test_allocation_is_idempotent(self):
        self.add_codes(self.v10, 5)
        order = self.paid_order()
        first = list(order.items.get().codes.values_list("id", flat=True))
        result = allocate_codes(order)
        self.assertEqual(result.assigned_code_ids, [])
        mark_payment_verified(order.payments.get())  # webhook replay
        self.assertEqual(list(order.items.get().codes.values_list("id", flat=True)), first)
        self.assertEqual(available_code_counts([self.v10.id])[self.v10.id], 4)

    def test_allocation_uses_skip_locked(self):
        self.add_codes(self.v10, 2)
        order = create_storefront_order(data=self.order_data())
        Order.objects.filter(pk=order.pk).update(payment_status=PaymentStatus.PAID)
        with CaptureQueriesContext(connection) as ctx:
            allocate_codes(order)
        sql = " ".join(q["sql"] for q in ctx.captured_queries)
        self.assertIn("FOR UPDATE SKIP LOCKED", sql)

    def test_topup_waits_for_staff_then_completes(self):
        self.add_codes(self.v10, 1)
        order = self.paid_order(
            [{"product_id": self.gift.id, "variant_id": self.v10.id, "quantity": 1}, self.topup_item()]
        )
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.PROCESSING)
        topup = order.items.get(product=self.topup)
        client = auth_client(self.admin)
        mail.outbox = []
        with self.captureOnCommitCallbacks(execute=True):
            res = client.post(
                f"/api/v1/admin/orders/{order.id}/items/{topup.id}/mark-delivered/",
                {"note": "Sent 100 UC"},
                format="json",
            )
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        self.assertEqual(body["fulfillment_status"], FulfillmentStatus.COMPLETED)
        row = next(i for i in body["items"] if i["id"] == topup.id)
        self.assertTrue(row["delivered"])
        self.assertEqual(row["delivery_note"], "Sent 100 UC")
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("top-up delivered", mail.outbox[0].subject)
        self.assertTrue(AuditLog.objects.filter(action="orders.item_delivered").exists())
        # idempotent
        again = client.post(f"/api/v1/admin/orders/{order.id}/items/{topup.id}/mark-delivered/", {}, format="json")
        self.assertEqual(again.status_code, 200)

    def test_mark_delivered_rejects_code_items(self):
        self.add_codes(self.v10, 1)
        order = self.paid_order()
        item = order.items.get()
        res = auth_client(self.admin).post(f"/api/v1/admin/orders/{order.id}/items/{item.id}/mark-delivered/")
        self.assertEqual(res.status_code, 400)

    def test_manual_code_attach(self):
        # No stock for the variant: the paid order waits in MANUAL_REVIEW for staff.
        order = Order.objects.create(
            order_number="ATTACH000001", email="buyer@example.com", full_name="B", total_fils=10000
        )
        item = order.items.create(
            product=self.gift,
            variant=self.v10,
            quantity=1,
            unit_price_fils=10000,
            line_total_fils=10000,
            product_name="Steam Card",
            variant_name="$10",
        )
        transition_order(order, payment_status=PaymentStatus.PAID)
        allocate_codes(order)
        order.refresh_from_db()
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.MANUAL_REVIEW)

        support = make_admin("dl-support@mmh.test", AdminRole.SUPPORT_AGENT)
        denied = auth_client(support).post(
            f"/api/v1/admin/orders/{order.id}/items/{item.id}/codes/", {"code": "X"}, format="json"
        )
        self.assertEqual(denied.status_code, 403)

        client = auth_client(self.admin)
        mail.outbox = []
        with self.captureOnCommitCallbacks(execute=True):
            res = client.post(
                f"/api/v1/admin/orders/{order.order_number}/items/{item.id}/codes/",
                {"code": "HAND-TYPED-CODE-9Z9Z", "pin": "4321"},
                format="json",
            )
        self.assertEqual(res.status_code, 201, res.content)
        body = res.json()
        self.assertEqual(body["fulfillment_status"], FulfillmentStatus.COMPLETED)
        code_row = body["items"][0]["codes"][0]
        self.assertEqual(code_row["masked"], "••••••••9Z9Z")
        self.assertEqual(code_row["status"], DigitalCodeStatus.DELIVERED)
        self.assertEqual(code_row["source"], DigitalCodeSource.MANUAL)
        self.assertNotIn("HAND-TYPED-CODE-9Z9Z", res.content.decode())
        code = DigitalCode.objects.get(order_item=item)
        self.assertEqual(code.code_fingerprint, fingerprint_code("HAND-TYPED-CODE-9Z9Z", "4321"))
        self.assertTrue(AuditLog.objects.filter(action="orders.code_attached").exists())
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("HAND-TYPED-CODE-9Z9Z", mail.outbox[0].body)
        self.assertIn("4321", mail.outbox[0].body)

        full = client.post(
            f"/api/v1/admin/orders/{order.id}/items/{item.id}/codes/", {"code": "ANOTHER-1"}, format="json"
        )
        self.assertEqual(full.status_code, 409)

    def test_manual_code_attach_duplicate_is_409(self):
        existing = self.add_codes(self.v20, 1)[0]
        order = Order.objects.create(order_number="ATTACH000002", email="b@example.com", full_name="B", total_fils=10000)
        item = order.items.create(
            product=self.gift, variant=self.v10, quantity=1, unit_price_fils=1, line_total_fils=1,
            product_name="S", variant_name="$10",
        )
        transition_order(order, payment_status=PaymentStatus.PAID)
        plain, _ = reveal_code(existing)
        res = auth_client(self.admin).post(
            f"/api/v1/admin/orders/{order.id}/items/{item.id}/codes/", {"code": plain}, format="json"
        )
        self.assertEqual(res.status_code, 409)

    def test_admin_payload_shape(self):
        self.add_codes(self.v10, 3)
        order = self.paid_order(
            [{"product_id": self.gift.id, "variant_id": self.v10.id, "quantity": 1}, self.topup_item()],
            notes="Leave at door",
        )
        res = auth_client(self.admin).get(f"/api/v1/admin/orders/{order.id}/")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertNotIn("access_token", body)
        self.assertNotIn(order.access_token, res.content.decode())
        self.assertEqual(body["notes"], "Leave at door")
        self.assertFalse(body["can_cancel"])
        self.assertEqual(body["allowed_payment_transitions"], ["PARTIALLY_REFUNDED", "REFUNDED"])
        self.assertNotIn("CANCELLED", body["allowed_fulfillment_transitions"])
        self.assertEqual(body["refunds"], [])
        code_item = next(i for i in body["items"] if i["fulfillment_type"] == "CODE")
        top_item = next(i for i in body["items"] if i["fulfillment_type"] == "DIRECT_TOPUP")
        self.assertEqual(code_item["available_codes_for_variant"], 2)
        self.assertIsNone(top_item["available_codes_for_variant"])
        self.assertEqual(top_item["customer_fields"], {"player_id": "PLAYER-77"})
        for key in ("delivery_method", "delivery_contact", "delivered", "delivered_at", "delivery_note", "codes"):
            self.assertIn(key, code_item)
        self.assertEqual(
            set(code_item["codes"][0]),
            {
                "id",
                "masked",
                "status",
                "status_label",
                "source",
                "delivered_at",
                "revealed_at",
                "customer_revealed_at",
                "revealed_by_customer",
            },
        )

    def test_resend_email(self):
        self.add_codes(self.v10, 2, pin="777")
        order = self.paid_order()
        mail.outbox = []
        res = auth_client(self.admin).post(f"/api/v1/admin/orders/{order.id}/resend-email/")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["sent"], ["codes_delivered"])
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("777", mail.outbox[0].body)
        self.assertTrue(AuditLog.objects.filter(action="orders.resend_email").exists())

        unpaid = create_storefront_order(data=self.order_data(email="other@example.com"))
        self.assertEqual(
            auth_client(self.admin).post(f"/api/v1/admin/orders/{unpaid.id}/resend-email/").status_code, 409
        )

    def test_fulfill_requires_paid_order(self):
        self.add_codes(self.v10, 1)
        order = create_storefront_order(data=self.order_data())
        res = auth_client(self.admin).post(f"/api/v1/admin/orders/{order.id}/fulfill/")
        self.assertEqual(res.status_code, 409)


class ConcurrentAllocationTests(CatalogFixture, TransactionTestCase):
    """A code locked by another transaction is skipped, never double-assigned."""

    @override_settings(**BASE_SETTINGS)
    def test_locked_code_is_skipped(self):
        self.build_catalog()
        code = self.add_codes(self.v10, 1)[0]
        order = Order.objects.create(order_number="CONC00000001", email="c@example.com", full_name="C", total_fils=1)
        order.items.create(
            product=self.gift, variant=self.v10, quantity=1, unit_price_fils=1, line_total_fils=1,
            product_name="S", variant_name="$10",
        )
        Order.objects.filter(pk=order.pk).update(payment_status=PaymentStatus.PAID)
        locked = threading.Event()
        release = threading.Event()

        def hold_lock():
            try:
                with transaction.atomic():
                    list(DigitalCode.objects.select_for_update().filter(pk=code.pk))
                    locked.set()
                    release.wait(10)
            finally:
                connections.close_all()

        worker = threading.Thread(target=hold_lock)
        worker.start()
        try:
            self.assertTrue(locked.wait(10))
            result = allocate_codes(order)
        finally:
            release.set()
            worker.join(10)
        self.assertEqual(result.assigned_code_ids, [])
        self.assertEqual(result.fulfillment_status, FulfillmentStatus.MANUAL_REVIEW)
        code.refresh_from_db()
        self.assertEqual(code.status, DigitalCodeStatus.AVAILABLE)
        # Once the lock is gone the next run picks it up.
        self.assertEqual(allocate_codes(order).fulfillment_status, FulfillmentStatus.COMPLETED)


@override_settings(**BASE_SETTINGS)
class EmailTests(CatalogFixture, TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.build_catalog()

    def test_paid_and_codes_emails(self):
        self.add_codes(self.v10, 1, pin="9911")
        order = create_storefront_order(data=self.order_data())
        mail.outbox = []
        with self.captureOnCommitCallbacks(execute=True):
            mark_payment_verified(order.payments.get(), external_ref="psp")
        order.refresh_from_db()
        subjects = [m.subject for m in mail.outbox]
        self.assertEqual(len(mail.outbox), 2, subjects)
        paid = next(m for m in mail.outbox if "payment received" in m.subject)
        codes = next(m for m in mail.outbox if "your codes" in m.subject)
        link = f"https://shop.test/order/{order.order_number}?token={order.access_token}"
        self.assertIn(link, paid.body)
        self.assertIn("JOD 10.00", paid.body)
        self.assertEqual(paid.to, ["buyer@example.com"])
        self.assertEqual(paid.from_email, "MMH Test <no-reply@shop.test>")
        self.assertTrue(paid.alternatives and "text/html" in paid.alternatives[0][1])
        code = order.items.get().codes.get()
        plain, pin = reveal_code(code)
        self.assertIn(plain, codes.body)
        self.assertIn("9911", codes.body)
        self.assertIn(link, codes.body)
        self.assertIn(plain, codes.alternatives[0][0])

    def test_no_email_when_transaction_rolls_back(self):
        self.add_codes(self.v10, 1)
        order = create_storefront_order(data=self.order_data())
        mail.outbox = []
        with self.captureOnCommitCallbacks(execute=True):
            try:
                with transaction.atomic():
                    mark_payment_verified(order.payments.get())
                    raise RuntimeError("boom")
            except RuntimeError:
                pass
        self.assertEqual(mail.outbox, [])

    def test_send_failure_is_logged_not_raised(self):
        self.add_codes(self.v10, 1)
        order = create_storefront_order(data=self.order_data())
        with patch("commerce.notifications.send_mail", side_effect=OSError("smtp down")):
            with self.captureOnCommitCallbacks(execute=True):
                mark_payment_verified(order.payments.get())
        order.refresh_from_db()
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.COMPLETED)


@override_settings(**BASE_SETTINGS)
class CustomerAccessTests(CatalogFixture, TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.build_catalog()
        cls.customer = User.objects.create_user(email="owner@example.com", password="Pass12345!", kind=UserKind.CUSTOMER)
        cls.other = User.objects.create_user(email="other@example.com", password="Pass12345!", kind=UserKind.CUSTOMER)

    def setUp(self):
        cache.clear()

    def test_mask_shows_only_last_four(self):
        self.assertEqual(mask_code("ABCD-EFGH-IJKL-AB12"), "••••••••AB12")
        self.assertEqual(mask_code("SHORT"), "••••••••HORT")
        self.assertEqual(mask_code("ABC"), "••••")

    def test_migration_remasks_legacy_values_without_plaintext(self):
        import importlib

        remask = importlib.import_module("commerce.migrations.0006_delivery_access_tokens")._remask
        self.assertEqual(remask("ABCD••••••••WXYZ"), "••••••••WXYZ")
        self.assertEqual(remask("AB••YZ"), "••••••••YZ")
        self.assertEqual(remask("****"), "••••")
        self.assertEqual(remask("••••••••WXYZ"), "••••••••WXYZ")

    def test_access_token_only_in_checkout_response(self):
        self.add_codes(self.v10, 1)
        res = self.post_checkout()
        self.assertEqual(res.status_code, 201, res.content)
        token = res.json()["access_token"]
        self.assertEqual(len(token), 32)
        order = Order.objects.get(order_number=res.json()["order_number"])
        self.assertEqual(order.access_token, token)
        self.assertTrue(re.fullmatch(r"[0-9A-F]{12}", order.order_number))
        lookup = APIClient().get(f"/api/v1/orders/{order.order_number}/?email=buyer@example.com")
        self.assertEqual(lookup.status_code, 200)
        self.assertNotIn("access_token", lookup.json())
        self.assertNotIn(token, lookup.content.decode())

    def test_guest_lookup_rules(self):
        self.add_codes(self.v10, 1)
        order = self.paid_order()
        client = APIClient()
        url = f"/api/v1/orders/{order.order_number}/"
        self.assertEqual(client.get(url).status_code, 404)
        self.assertEqual(client.get(url + "?email=wrong@example.com").status_code, 404)
        ok = client.get(url + "?email=BUYER@example.com")
        self.assertEqual(ok.status_code, 200)
        item = ok.json()["items"][0]
        self.assertEqual(item["fulfillment_type"], "CODE")
        self.assertTrue(item["delivered"])
        self.assertIsNotNone(item["delivered_at"])
        self.assertEqual(len(item["codes"]), 1)
        self.assertEqual(set(item["codes"][0]), {"id", "masked"})
        self.assertTrue(item["codes"][0]["masked"].startswith("••••••••"))
        self.assertEqual(client.get(url + f"?access_token={order.access_token}").status_code, 200)
        self.assertEqual(client.get(url + f"?token={order.access_token}").status_code, 200)
        self.assertEqual(client.get(url + "?access_token=" + "x" * 32).status_code, 404)

    def test_registered_user_order_only_visible_to_owner(self):
        self.add_codes(self.v10, 1)
        res = self.post_checkout(client=auth_client(self.customer), email="owner@example.com")
        self.assertEqual(res.status_code, 201, res.content)
        number = res.json()["order_number"]
        token = res.json()["access_token"]
        url = f"/api/v1/orders/{number}/"
        self.assertEqual(APIClient().get(url + "?email=owner@example.com").status_code, 404)
        self.assertEqual(APIClient().get(url + f"?email=owner@example.com&access_token={token}").status_code, 404)
        self.assertEqual(auth_client(self.other).get(url + "?email=owner@example.com").status_code, 404)
        self.assertEqual(auth_client(self.customer).get(url).status_code, 200)
        mine = auth_client(self.customer).get("/api/v1/orders/mine/")
        self.assertEqual(mine.status_code, 200)
        rows = mine.json().get("results", mine.json())
        self.assertEqual(rows[0]["order_number"], number)
        self.assertIn("codes", rows[0]["items"][0])

    def test_reveal_codes_owner_token_and_forbidden(self):
        self.add_codes(self.v10, 2, pin="5150")
        res = self.post_checkout(
            client=auth_client(self.customer),
            email="owner@example.com",
            items=[{"product_id": self.gift.id, "variant_id": self.v10.id, "quantity": 2}],
        )
        order = Order.objects.get(order_number=res.json()["order_number"])
        url = f"/api/v1/orders/{order.order_number}/codes/"

        unpaid = auth_client(self.customer).post(url, {}, format="json")
        self.assertEqual(unpaid.status_code, 409)

        mark_payment_verified(order.payments.get())
        owner = auth_client(self.customer).post(url, {}, format="json")
        self.assertEqual(owner.status_code, 200, owner.content)
        items = owner.json()["items"]
        self.assertEqual(len(items[0]["codes"]), 2)
        self.assertEqual(items[0]["codes"][0]["pin"], "5150")
        self.assertTrue(items[0]["codes"][0]["code"].startswith("CODE-DL-10-"))
        self.assertEqual(items[0]["product_name"], "Steam Card")

        via_token = APIClient().post(url, {"access_token": order.access_token}, format="json")
        self.assertEqual(via_token.status_code, 200)
        self.assertEqual(APIClient().post(url, {"access_token": "nope"}, format="json").status_code, 404)
        self.assertEqual(APIClient().post(url, {}, format="json").status_code, 404)
        self.assertEqual(auth_client(self.other).post(url, {}, format="json").status_code, 404)
        self.assertEqual(APIClient().post("/api/v1/orders/NOPE00000000/codes/", {}, format="json").status_code, 404)

        logs = AuditLog.objects.filter(action="codes.customer_reveal", entity_id=str(order.id))
        self.assertEqual(logs.count(), 2)
        self.assertEqual({log.meta["via"] for log in logs}, {"owner", "access_token"})
        for log in logs:
            self.assertNotIn(items[0]["codes"][0]["code"], str(log.meta))

    def test_throttle_scopes_are_declared(self):
        from commerce.paypal_views import PayPalCaptureOrderView, PayPalCreateOrderView
        from commerce.throttling import CommerceScopedRateThrottle
        from commerce.views import CouponValidateView, CreateOrderView, OrderCodesView, OrderDetailView

        expected = {
            CreateOrderView: "checkout",
            CouponValidateView: "coupon",
            OrderDetailView: "order_lookup",
            OrderCodesView: "code_reveal",
            PayPalCreateOrderView: "paypal",
            PayPalCaptureOrderView: "paypal",
        }
        for view, scope in expected.items():
            self.assertEqual(view.throttle_scope, scope)
            self.assertIn(CommerceScopedRateThrottle, view.throttle_classes)

    def test_reveal_is_throttled_when_rate_configured(self):
        from rest_framework.settings import api_settings

        from commerce.throttling import CommerceScopedRateThrottle

        with patch.object(CommerceScopedRateThrottle, "THROTTLE_RATES", {**api_settings.DEFAULT_THROTTLE_RATES, "code_reveal": "2/min"}):
            url = "/api/v1/orders/NOPE00000000/codes/"
            codes = [APIClient().post(url, {}, format="json").status_code for _ in range(3)]
        self.assertEqual(codes, [404, 404, 429])


@override_settings(**{**PAYPAL_SETTINGS, **BASE_SETTINGS})
class PayPalSafetyTests(CatalogFixture, TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.build_catalog()

    def setUp(self):
        cache.clear()
        self.fake = FakePayPal()
        patcher = patch("commerce.services.paypal.get_client", return_value=self.fake)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.add_codes(self.v10, 2)

    def _paypal_order(self):
        created = self.post_checkout(payment_provider="paypal").json()
        paypal = self.client.post(
            "/api/v1/payments/paypal/create-order/",
            {"order_number": created["order_number"], "checkout_token": created["checkout_token"]},
            content_type="application/json",
        )
        self.assertEqual(paypal.status_code, 200, paypal.content)
        return created, paypal.json()["paypal_order_id"]

    def _capture(self, paypal_order_id):
        return self.client.post(
            "/api/v1/payments/paypal/capture-order/",
            {"paypal_order_id": paypal_order_id},
            content_type="application/json",
        )

    def test_capture_delivers_inventory_codes(self):
        created, pid = self._paypal_order()
        res = self._capture(pid)
        self.assertEqual(res.status_code, 200, res.content)
        order = Order.objects.get(order_number=created["order_number"])
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.COMPLETED)
        self.assertEqual(order.items.get().codes.get().source, DigitalCodeSource.CSV_IMPORT)

    def test_capture_never_500_when_fulfillment_fails(self):
        created, pid = self._paypal_order()
        with patch("commerce.services.fulfillment.fulfill_order", side_effect=FulfillmentError("supplier down")):
            res = self._capture(pid)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["payment_status"], "PAID")
        order = Order.objects.get(order_number=created["order_number"])
        payment = order.payments.get()
        self.assertEqual(order.payment_status, PaymentStatus.PAID)
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.MANUAL_REVIEW)
        self.assertTrue(payment.provider_capture_id)
        self.assertEqual(payment.status, PaymentStatus.PAID)
        self.assertTrue(AuditLog.objects.filter(action="orders.manual_review", entity_id=str(order.id)).exists())

    def test_capture_never_500_when_verification_crashes(self):
        created, pid = self._paypal_order()
        with patch("commerce.services.paypal.mark_payment_verified", side_effect=RuntimeError("db hiccup")):
            res = self._capture(pid)
        self.assertEqual(res.status_code, 200, res.content)
        order = Order.objects.get(order_number=created["order_number"])
        self.assertEqual(order.payment_status, PaymentStatus.PAID)
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.MANUAL_REVIEW)
        self.assertTrue(order.payments.get().provider_capture_id)

    def test_unpayable_orders_are_blocked_before_capture(self):
        created, pid = self._paypal_order()
        order = Order.objects.get(order_number=created["order_number"])
        transition_order(order, fulfillment_status=FulfillmentStatus.CANCELLED)
        res = self._capture(pid)
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()["code"], "order_not_payable")
        self.assertEqual(self.fake.capture_calls, [])
        again = self.client.post(
            "/api/v1/payments/paypal/create-order/",
            {"order_number": created["order_number"], "checkout_token": created["checkout_token"]},
            content_type="application/json",
        )
        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.json()["code"], "order_not_payable")

    def test_manual_review_order_blocked(self):
        created, pid = self._paypal_order()
        Order.objects.filter(order_number=created["order_number"]).update(
            fulfillment_status=FulfillmentStatus.MANUAL_REVIEW
        )
        self.assertEqual(self._capture(pid).status_code, 409)

    def test_webhook_capture_for_expired_order_is_recorded_for_review(self):
        created, pid = self._paypal_order()
        order = Order.objects.get(order_number=created["order_number"])
        transition_order(
            order, payment_status=PaymentStatus.CANCELLED, fulfillment_status=FulfillmentStatus.CANCELLED
        )
        Payment.objects.filter(order=order).update(status=PaymentStatus.CANCELLED)
        payment = order.payments.get()
        event = {
            "id": "WH-LATE-1",
            "event_type": "PAYMENT.CAPTURE.COMPLETED",
            "resource": {
                "id": "CAPTURELATE1",
                "status": "COMPLETED",
                "custom_id": order.order_number,
                "amount": {"currency_code": "USD", "value": payment.provider_amount},
                "supplementary_data": {"related_ids": {"order_id": pid}},
            },
        }
        res = self.client.post(
            "/api/v1/payments/paypal/webhook/",
            event,
            content_type="application/json",
            HTTP_PAYPAL_AUTH_ALGO="SHA256withRSA",
            HTTP_PAYPAL_CERT_URL="https://api.sandbox.paypal.com/v1/notifications/certs/CERT",
            HTTP_PAYPAL_TRANSMISSION_ID="tx",
            HTTP_PAYPAL_TRANSMISSION_SIG="sig",
            HTTP_PAYPAL_TRANSMISSION_TIME=timezone.now().isoformat(),
        )
        self.assertEqual(res.status_code, 200, res.content)
        order.refresh_from_db()
        payment.refresh_from_db()
        self.assertEqual(payment.status, PaymentStatus.PAID)
        self.assertEqual(payment.provider_capture_id, "CAPTURELATE1")
        self.assertEqual(order.payment_status, PaymentStatus.PAID)
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.MANUAL_REVIEW)
        self.assertFalse(order.items.get().codes.exists(), "cancelled order is not auto-delivered")
        self.assertTrue(AuditLog.objects.filter(action="orders.payment_forced_paid").exists())


@override_settings(**BASE_SETTINGS)
class AdminTransitionTests(CatalogFixture, TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.build_catalog()
        seed_permissions()
        cls.admin = make_admin("dl-trans@mmh.test", AdminRole.ADMIN)

    def _transition(self, order, **body):
        return auth_client(self.admin).post(f"/api/v1/admin/orders/{order.id}/transition/", body, format="json")

    def test_manual_paid_requires_reason_and_runs_full_flow(self):
        self.add_codes(self.v10, 1)
        coupon = Coupon.objects.create(code="MANUAL5", percent_off="5.00")
        order = create_storefront_order(data=self.order_data(coupon_code="MANUAL5"))
        missing = self._transition(order, payment_status="PAID")
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(missing.json()["code"], "reason_required")
        blank = self._transition(order, payment_status="PAID", reason="   ")
        self.assertEqual(blank.status_code, 400)

        res = self._transition(order, payment_status="PAID", reason="Bank transfer ref 123")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["payment_status"], "PAID")
        self.assertEqual(res.json()["fulfillment_status"], "COMPLETED")
        order.refresh_from_db()
        manual = order.payments.get(provider="manual")
        self.assertEqual(manual.status, PaymentStatus.PAID)
        self.assertEqual(manual.amount_fils, order.total_fils)
        coupon.refresh_from_db()
        self.assertEqual(coupon.used_count, 1)
        self.assertEqual(order.items.get().codes.count(), 1)
        audit = AuditLog.objects.get(action="orders.manual_paid", entity_id=str(order.id))
        self.assertEqual(audit.meta["reason"], "Bank transfer ref 123")
        self.assertTrue(
            AuditLog.objects.filter(
                action="orders.transition", entity_id=str(order.id), meta__reason="Bank transfer ref 123"
            ).exists()
        )

    def test_cancel_paid_order_is_rejected(self):
        self.add_codes(self.v10, 1)
        order = self.paid_order()
        for body in ({"fulfillment_status": "CANCELLED"}, {"payment_status": "CANCELLED"}):
            res = self._transition(order, **body)
            self.assertEqual(res.status_code, 409)
            self.assertEqual(res.json()["code"], "refund_first")
            self.assertIn("Refund it first", res.json()["detail"])

    def test_cancel_unpaid_order_allowed(self):
        self.add_codes(self.v10, 1)
        order = create_storefront_order(data=self.order_data())
        res = self._transition(order, payment_status="CANCELLED", fulfillment_status="CANCELLED", reason="dup")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(res.json()["can_cancel"])

    def test_refund_retires_codes_and_partial_to_full(self):
        self.add_codes(self.v10, 1)
        order = self.paid_order()
        partial = self._transition(
            order, payment_status="PARTIALLY_REFUNDED", reason="goodwill", refund_amount_fils=2000
        )
        self.assertEqual(partial.status_code, 200, partial.content)
        self.assertEqual(order.items.get().codes.get().status, DigitalCodeStatus.DELIVERED)
        full = self._transition(order, payment_status="REFUNDED", reason="customer request")
        self.assertEqual(full.status_code, 200, full.content)
        self.assertEqual(full.json()["payment_status"], "REFUNDED")
        self.assertEqual(order.items.get().codes.get().status, DigitalCodeStatus.UNAVAILABLE)
        self.assertTrue(AuditLog.objects.filter(action="codes.refund_retired", entity_id=str(order.id)).exists())
        self.assertEqual(order.payments.get().status, PaymentStatus.REFUNDED)
        reveal = APIClient().post(
            f"/api/v1/orders/{order.order_number}/codes/", {"access_token": order.access_token}, format="json"
        )
        self.assertEqual(reveal.status_code, 409)
        # Refunded orders are no longer guarded by "refund first"; a completed order cannot be cancelled.
        res = self._transition(order, fulfillment_status="CANCELLED")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()["code"], "not_cancellable")


@override_settings(**BASE_SETTINGS)
class CheckoutValidationTests(CatalogFixture, TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.build_catalog()

    def setUp(self):
        cache.clear()
        self.add_codes(self.v10, 10)
        self.add_codes(self.v20, 10)

    def assertCheckoutError(self, res, status_code, fragment=""):
        self.assertEqual(res.status_code, status_code, res.content)
        if fragment:
            self.assertIn(fragment, str(res.json()))

    def test_unpublished_product_and_variant(self):
        self.assertCheckoutError(
            self.post_checkout(items=[{"product_id": self.draft.id, "variant_id": self.draft_variant.id}]), 400
        )
        self.assertCheckoutError(
            self.post_checkout(items=[{"product_id": self.gift.id, "variant_id": self.v_hidden.id}]),
            400,
            "not available",
        )

    def test_variant_resolution_is_strict(self):
        self.assertCheckoutError(
            self.post_checkout(items=[{"product_id": self.gift.id, "variant_id": self.t1.id}]), 400
        )
        self.assertCheckoutError(
            self.post_checkout(items=[{"product_id": self.gift.id, "denomination_id": "nope"}]), 400
        )
        self.assertCheckoutError(self.post_checkout(items=[{"product_id": self.gift.id}]), 400, "Choose an option")
        by_external = self.post_checkout(items=[{"product_id": self.gift.id, "denomination_id": "ext-20"}])
        self.assertEqual(by_external.status_code, 201, by_external.content)
        self.assertEqual(by_external.json()["items"][0]["variant_id"], self.v20.id)
        by_id = self.post_checkout(
            items=[{"product_id": self.gift.id, "denomination_id": str(self.v10.id)}], email="b2@example.com"
        )
        self.assertEqual(by_id.status_code, 201, by_id.content)
        self.assertEqual(by_id.json()["items"][0]["variant_id"], self.v10.id)

    def test_quantity_limits(self):
        ProductVariant.objects.filter(pk=self.v10.pk).update(min_quantity=2)
        self.assertCheckoutError(
            self.post_checkout(items=[{"product_id": self.gift.id, "variant_id": self.v10.id, "quantity": 1}]),
            400,
            "between 2 and 5",
        )
        self.assertCheckoutError(
            self.post_checkout(items=[{"product_id": self.gift.id, "variant_id": self.v20.id, "quantity": 4}]),
            400,
            "between 1 and 3",
        )
        self.assertCheckoutError(
            self.post_checkout(items=[{"product_id": self.gift.id, "variant_id": self.v20.id, "quantity": 6}]), 400
        )

    def test_line_and_unit_caps(self):
        line = {"product_id": self.gift.id, "variant_id": self.v10.id, "quantity": 1}
        self.assertCheckoutError(self.post_checkout(items=[line] * 21), 400)
        big = {"product_id": self.gift.id, "variant_id": self.v10.id, "quantity": 4}
        self.assertCheckoutError(self.post_checkout(items=[big, big, big]), 400, "at most 10")

    def test_required_customer_fields(self):
        missing = self.post_checkout(items=[self.topup_item(contact="")])
        self.assertCheckoutError(missing, 400, "Player ID is required")
        self.assertEqual(missing.json()["field"], "player_id")
        self.assertCheckoutError(
            self.post_checkout(items=[self.topup_item(player_id="P1", contact="not-an-email")]),
            400,
            "Contact email must be a valid email",
        )
        self.assertCheckoutError(
            self.post_checkout(items=[self.topup_item(player_id="P1", mobile="abc")]), 400, "Mobile"
        )
        ok = self.post_checkout(items=[self.topup_item(player_id=" P1 ", mobile="+962 79 000 0000", junk="x")])
        self.assertEqual(ok.status_code, 201, ok.content)
        self.assertEqual(ok.json()["items"][0]["customer_fields"], {"player_id": "P1", "mobile": "+962 79 000 0000"})

    def test_stock_rules(self):
        DigitalCode.objects.filter(variant=self.v20).delete()
        res = self.post_checkout(items=[{"product_id": self.gift.id, "variant_id": self.v20.id}])
        self.assertCheckoutError(res, 409, "out of stock")
        self.assertEqual(res.json()["code"], "out_of_stock")
        # Two lines of the same variant are summed against stock.
        self.add_codes(self.v20, 1)
        line = {"product_id": self.gift.id, "variant_id": self.v20.id, "quantity": 1}
        self.assertCheckoutError(self.post_checkout(items=[line, line]), 409)
        # A supplier-mapped variant may be sold without local stock.
        from suppliers.models import Supplier, SupplierProductMapping

        supplier = Supplier.objects.create(slug="dl-sup", name="Sup", active=True)
        SupplierProductMapping.objects.create(
            supplier=supplier, product=self.gift, variant=self.v20, external_product_id="EXT-20"
        )
        # D18: a mock/test supplier mapping does not count as stock...
        self.assertEqual(self.post_checkout(items=[line, line]).status_code, 409)
        # ...a live-purchasing one does.
        from django.db.models import Q

        with patch("catalog.stock._stock_mapping_filter", return_value=Q(ignored=False, supplier__active=True)):
            self.assertEqual(self.post_checkout(items=[line, line]).status_code, 201)
        # DIRECT_TOPUP respects stock_status.
        ProductVariant.objects.filter(pk=self.t1.pk).update(stock_status=StockStatus.OUT_OF_STOCK)
        self.assertCheckoutError(self.post_checkout(items=[self.topup_item()]), 409, "out of stock")

    def test_delivery_method(self):
        bad = self.post_checkout(
            items=[{"product_id": self.gift.id, "variant_id": self.v10.id, "delivery_method": "sms"}]
        )
        self.assertEqual(bad.status_code, 400)
        default = self.post_checkout()
        self.assertEqual(default.json()["items"][0]["delivery_method"], "account")
        email = self.post_checkout(
            items=[{"product_id": self.gift.id, "variant_id": self.v10.id, "delivery_method": "email"}],
            email="mail@example.com",
        )
        self.assertEqual(email.json()["items"][0]["delivery_method"], "email")
        self.assertEqual(email.json()["items"][0]["delivery_contact"], "mail@example.com")

    def test_order_number_collision_retries(self):
        Order.objects.create(order_number="AAAAAAAAAAAA", email="x@example.com", full_name="X")
        numbers = iter(["AAAAAAAAAAAA", "BBBBBBBBBBBB"])
        with patch("commerce.services.checkout.make_order_number", side_effect=lambda: next(numbers)):
            res = self.post_checkout()
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()["order_number"], "BBBBBBBBBBBB")

    def test_idempotency_scoping(self):
        first = self.post_checkout(idempotency_key="key-1")
        same = self.post_checkout(idempotency_key="key-1", email="BUYER@example.com")
        self.assertEqual(first.json()["order_number"], same.json()["order_number"])
        other_email = self.post_checkout(idempotency_key="key-1", email="intruder@example.com")
        self.assertEqual(other_email.status_code, 201)
        self.assertNotEqual(other_email.json()["order_number"], first.json()["order_number"])
        self.assertNotEqual(other_email.json()["access_token"], first.json()["access_token"])
        self.assertEqual(Order.objects.get(order_number=other_email.json()["order_number"]).idempotency_key, "")
        order = Order.objects.get(order_number=first.json()["order_number"])
        mark_payment_verified(order.payments.get())
        after_paid = self.post_checkout(idempotency_key="key-1")
        self.assertNotEqual(after_paid.json()["order_number"], first.json()["order_number"])


@override_settings(**BASE_SETTINGS)
class CouponTests(CatalogFixture, TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.build_catalog()
        seed_permissions()
        cls.admin = make_admin("dl-coupon@mmh.test", AdminRole.ADMIN)

    def setUp(self):
        cache.clear()

    def test_decimal_percent_and_fixed_clamp(self):
        Coupon.objects.create(code="EIGHTH", percent_off="12.50")
        Coupon.objects.create(code="HUGE", amount_off_fils=50000)
        self.assertEqual(validate_coupon("eighth", subtotal_fils=12345)["discount_fils"], 1543)
        clamp = validate_coupon("HUGE", "10.000")
        self.assertEqual(clamp["discount_fils"], 10000)
        self.assertEqual(clamp["total_fils"], 0)

    def test_specific_reasons_for_existing_coupons_generic_for_unknown(self):
        """OR-17/OR-25: unknown + inactive stay generic; existing coupons say why."""
        now = timezone.now()
        Coupon.objects.create(code="OFF", percent_off="5", active=False)
        Coupon.objects.create(code="OLD", percent_off="5", ends_at=now - timedelta(days=1))
        Coupon.objects.create(code="SOON", percent_off="5", starts_at=now + timedelta(days=1))
        Coupon.objects.create(code="FULL", percent_off="5", max_uses=1, used_count=1)
        expected = {
            "MISSING": "invalid_coupon",
            "OFF": "invalid_coupon",
            "OLD": "coupon_expired",
            "SOON": "coupon_not_started",
            "FULL": "coupon_limit_reached",
        }
        for code, error_code in expected.items():
            res = APIClient().post("/api/v1/coupons/validate/", {"code": code, "subtotal_fils": 10000}, format="json")
            self.assertEqual(res.status_code, 400, code)
            self.assertEqual(res.json()["code"], error_code, code)
            self.assertFalse(res.json()["valid"])
            if error_code == "invalid_coupon":
                self.assertEqual(res.json()["detail"], INVALID_COUPON_MESSAGE)

    def test_validate_endpoint_accepts_fils_and_jod(self):
        Coupon.objects.create(code="TEN", percent_off="10")
        by_fils = APIClient().post("/api/v1/coupons/validate/", {"code": "TEN", "subtotal_fils": 25000}, format="json")
        self.assertEqual(by_fils.json()["discount_fils"], 2500)
        by_jod = APIClient().post("/api/v1/coupons/validate/", {"code": "TEN", "subtotal_jod": "25.5"}, format="json")
        self.assertEqual(by_jod.json()["discount_fils"], 2550)

    def test_pending_orders_count_towards_max_uses(self):
        coupon = Coupon.objects.create(code="ONCE", percent_off="10", max_uses=1)
        self.add_codes(self.v10, 3)
        create_storefront_order(data=self.order_data(coupon_code="ONCE"))
        with self.assertRaises(CheckoutError) as ctx:
            create_storefront_order(data=self.order_data(coupon_code="ONCE", email="second@example.com"))
        self.assertEqual(ctx.exception.code, "coupon_limit_reached")
        Order.objects.filter(coupon=coupon).update(created_at=timezone.now() - timedelta(hours=2))
        self.assertTrue(validate_coupon("ONCE", subtotal_fils=10000)["valid"])

    def test_max_uses_per_customer(self):
        Coupon.objects.create(code="PERCUST", percent_off="10", max_uses_per_customer=1)
        self.add_codes(self.v10, 3)
        self.paid_order(coupon_code="PERCUST")
        with self.assertRaises(CheckoutError):
            validate_coupon("PERCUST", subtotal_fils=10000, email="Buyer@Example.com")
        with self.assertRaises(CheckoutError):
            create_storefront_order(data=self.order_data(coupon_code="PERCUST"))
        self.assertTrue(validate_coupon("PERCUST", subtotal_fils=10000, email="new@example.com")["valid"])
        res = APIClient().post(
            "/api/v1/coupons/validate/",
            {"code": "PERCUST", "subtotal_fils": 10000, "email": "buyer@example.com"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)

    def test_admin_crud_rules(self):
        client = auth_client(self.admin)
        both = client.post(
            "/api/v1/admin/coupons/", {"code": "BOTH", "percent_off": "5", "amount_off_fils": 100}, format="json"
        )
        self.assertEqual(both.status_code, 400)
        neither = client.post("/api/v1/admin/coupons/", {"code": "NONE"}, format="json")
        self.assertEqual(neither.status_code, 400)
        created = client.post(
            "/api/v1/admin/coupons/", {"code": "NEW1", "percent_off": "5", "max_uses_per_customer": 2}, format="json"
        )
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.json()["max_uses_per_customer"], 2)
        cid = created.json()["id"]
        dup = client.post("/api/v1/admin/coupons/", {"code": "new1", "percent_off": "5"}, format="json")
        self.assertEqual(dup.status_code, 400)
        upd = client.patch(f"/api/v1/admin/coupons/{cid}/", {"description": "Spring"}, format="json")
        self.assertEqual(upd.status_code, 200, upd.content)
        switch = client.patch(f"/api/v1/admin/coupons/{cid}/", {"amount_off_fils": 500}, format="json")
        self.assertEqual(switch.status_code, 400)
        ok_switch = client.patch(
            f"/api/v1/admin/coupons/{cid}/", {"amount_off_fils": 500, "percent_off": None}, format="json"
        )
        self.assertEqual(ok_switch.status_code, 200, ok_switch.content)

        used = Coupon.objects.create(code="USED", percent_off="5")
        Order.objects.create(order_number="CPN000000001", email="a@example.com", full_name="A", coupon=used)
        blocked = client.delete(f"/api/v1/admin/coupons/{used.id}/")
        self.assertEqual(blocked.status_code, 409)
        self.assertIn("Deactivate", blocked.json()["detail"])
        deleted = client.delete(f"/api/v1/admin/coupons/{cid}/")
        self.assertEqual(deleted.status_code, 204)
        actions = set(AuditLog.objects.filter(entity_type="Coupon").values_list("action", flat=True))
        self.assertEqual(actions, {"coupons.create", "coupons.update", "coupons.delete"})


@override_settings(**BASE_SETTINGS, PAYPAL_CLIENT_ID="", PAYPAL_CLIENT_SECRET="")
class ScheduledJobsTests(CatalogFixture, TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.build_catalog()

    def _order(self, number, *, age_hours):
        order = Order.objects.create(order_number=number, email="j@example.com", full_name="J", total_fils=1000)
        Payment.objects.create(order=order, provider="pending", amount_fils=1000)
        Order.objects.filter(pk=order.pk).update(created_at=timezone.now() - timedelta(hours=age_hours))
        return order

    def test_expires_old_unpaid_orders_only(self):
        old = self._order("JOB000000001", age_hours=80)
        recent = self._order("JOB000000002", age_hours=10)
        in_flight = self._order("JOB000000003", age_hours=80)
        Payment.objects.filter(order=in_flight).update(provider="paypal", provider_order_id="PAYPALINFLIGHT1")
        authorized = self._order("JOB000000004", age_hours=80)
        Payment.objects.filter(order=authorized).update(provider="paypal", status=PaymentStatus.AUTHORIZED)

        with tempfile.TemporaryDirectory() as media:
            legacy = Path(media) / "code_imports"
            legacy.mkdir()
            (legacy / "old-upload.csv").write_text("code\nPLAINTEXT-1\n")
            with override_settings(MEDIA_ROOT=media):
                out = StringIO()
                call_command("run_scheduled_jobs", stdout=out)
                self.assertFalse((legacy / "old-upload.csv").exists())
        text = out.getvalue()
        self.assertIn("reconcile_paypal: not_configured", text)
        self.assertIn("expired=1", text)
        self.assertIn("legacy_files_deleted=1", text)
        old.refresh_from_db()
        self.assertEqual(old.payment_status, PaymentStatus.CANCELLED)
        self.assertEqual(old.fulfillment_status, FulfillmentStatus.CANCELLED)
        self.assertEqual(old.payments.get().status, PaymentStatus.CANCELLED)
        for order in (recent, in_flight, authorized):
            order.refresh_from_db()
            self.assertEqual(order.payment_status, PaymentStatus.PENDING)
        self.assertTrue(AuditLog.objects.filter(action="orders.transition", meta__reason__startswith="Expired").exists())

        again = StringIO()
        call_command("run_scheduled_jobs", stdout=again)
        self.assertIn("expired=0", again.getvalue())

    def test_reconcile_paypal_still_standalone(self):
        from django.core.management import get_commands

        self.assertIn("reconcile_paypal", get_commands())
        self.assertIn("run_scheduled_jobs", get_commands())


@override_settings(**BASE_SETTINGS)
class CodeImportPayloadTests(CatalogFixture, TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.build_catalog()
        seed_permissions()
        cls.admin = make_admin("dl-import@mmh.test", AdminRole.ADMIN)

    def test_preview_payload_is_encrypted_in_db_not_on_disk(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        with tempfile.TemporaryDirectory() as media, override_settings(MEDIA_ROOT=media):
            upload = SimpleUploadedFile("codes.csv", b"code,pin\nPLAIN-SECRET-0001,1234\n", content_type="text/csv")
            client = auth_client(self.admin)
            res = client.post(
                "/api/v1/admin/codes/import/preview/",
                {"file": upload, "mode": "SIMPLE", "variant_id": self.v10.id},
                format="multipart",
            )
            self.assertEqual(res.status_code, 201, res.content)
            self.assertEqual(list(Path(media).rglob("*")), [])
            batch = CodeImportBatch.objects.get(pk=res.json()["batch"]["id"])
            self.assertTrue(batch.pending_payload)
            self.assertNotIn("PLAIN-SECRET-0001", batch.pending_payload)
            self.assertEqual(batch.pending_file_path, "")
            self.assertNotIn("pending_payload", res.json()["batch"])
            self.assertNotIn("PLAIN-SECRET-0001", res.content.decode())

            confirm = client.post("/api/v1/admin/codes/import/confirm/", {"batch_id": batch.id}, format="json")
            self.assertEqual(confirm.status_code, 200, confirm.content)
            batch.refresh_from_db()
            self.assertEqual(batch.pending_payload, "")
            self.assertEqual(batch.pending_payload_nonce, "")
            self.assertEqual(available_code_counts([self.v10.id])[self.v10.id], 1)

    def test_cleanup_expires_stale_previews(self):
        from commerce.services.code_import import cleanup_pending_imports, preview_import

        batch = preview_import(
            uploaded_by=self.admin, filename="c.csv", raw=b"code\nSTALE-0001\n", mode="SIMPLE", variant_id=self.v10.id
        )
        fresh = preview_import(
            uploaded_by=self.admin, filename="d.csv", raw=b"code\nFRESH-0001\n", mode="SIMPLE", variant_id=self.v10.id
        )
        CodeImportBatch.objects.filter(pk=batch.pk).update(created_at=timezone.now() - timedelta(hours=30))
        with tempfile.TemporaryDirectory() as media, override_settings(MEDIA_ROOT=media):
            counts = cleanup_pending_imports()
        self.assertEqual(counts["batches_expired"], 1)
        batch.refresh_from_db()
        fresh.refresh_from_db()
        self.assertEqual(batch.pending_payload, "")
        self.assertEqual(batch.status, CodeImportBatchStatus.FAILED)
        self.assertTrue(fresh.pending_payload)
        res = auth_client(self.admin).post("/api/v1/admin/codes/import/confirm/", {"batch_id": batch.id}, format="json")
        self.assertEqual(res.status_code, 400)


@override_settings(**BASE_SETTINGS)
class DashboardTests(CatalogFixture, TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.build_catalog()
        seed_permissions()
        cls.admin = make_admin("dl-dash@mmh.test", AdminRole.ADMIN)

    def test_dashboard_delivery_metrics(self):
        settings_obj = SiteSettings.load()
        settings_obj.low_stock_threshold = 3
        settings_obj.save()
        self.add_codes(self.v10, 5)
        self.add_codes(self.v20, 1)
        self.paid_order([self.topup_item()])  # PAID + PROCESSING -> awaiting delivery
        create_storefront_order(data=self.order_data(email="p@example.com"))  # pending, recent
        stale = create_storefront_order(data=self.order_data(email="q@example.com"))
        Order.objects.filter(pk=stale.pk).update(created_at=timezone.now() - timedelta(hours=30))
        res = auth_client(self.admin).get("/api/v1/admin/dashboard/")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["awaiting_delivery"], 1)
        self.assertEqual(body["pending_payment_24h"], 1)
        self.assertEqual(body["pending_orders"], 2)
        # D24: published CODE variants with available <= 3: v20 (1). v_hidden is unpublished; v10 has 5.
        self.assertEqual(body["low_stock_variants"], 1)
        self.assertEqual(body["low_stock_threshold"], 3)
        for key in ("revenue_fils", "orders_count", "codes_available", "recent_orders", "top_products"):
            self.assertIn(key, body)
