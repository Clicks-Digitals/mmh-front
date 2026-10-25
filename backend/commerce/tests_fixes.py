"""Fix-phase tests: product decisions D1-D13, D17, D22 and findings OR-*/ST-* owned by commerce/audit."""

from __future__ import annotations

import csv
import io
from datetime import timedelta
from unittest.mock import patch

from django.apps import apps as django_apps
from django.core import mail
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import AdminRole, User, UserKind
from accounts.tests_admin import auth_client, make_admin, seed_permissions
from audit.models import AuditLog
from catalog.models import ProductFieldDefinition
from cms.models import SiteSettings
from commerce.crypto import code_identity, encode_code_payload, encrypt_code, fingerprint_code, mask_code
from commerce.models import (
    CodeImportBatch,
    Coupon,
    DigitalCode,
    DigitalCodeSource,
    DigitalCodeStatus,
    FulfillmentStatus,
    Order,
    Payment,
    PaymentStatus,
    Refund,
)
from commerce.notifications import send_delivery_update
from commerce.services.checkout import create_storefront_order
from commerce.services.inventory import (
    PUBLIC_QUANTITY_CAP,
    allocate_codes,
    available_code_counts,
    available_quantity,
    raw_available_code_counts,
    reserve_order_stock,
)
from commerce.services.payment import mark_order_paid_manually, mark_payment_verified
from commerce.tests_delivery import BASE_SETTINGS, CatalogFixture
from commerce.tests_paypal import PAYPAL_SETTINGS, FakePayPal

PAYPAL_LIVE_STOCK = {**PAYPAL_SETTINGS, "ALLOW_DEMO_AUTO_PAYMENT": False, "EMAIL_BACKEND": BASE_SETTINGS["EMAIL_BACKEND"]}


class FixFixture(CatalogFixture):
    @classmethod
    def setUpTestData(cls):
        cls.build_catalog()
        seed_permissions()
        SiteSettings.load()
        cls.admin = make_admin("fix-admin@mmh.test", AdminRole.ADMIN)

    def setUp(self):
        cache.clear()

    def add_identity_codes(self, variant, values, *, pin=None, status=DigitalCodeStatus.AVAILABLE):
        rows = []
        for value in values:
            ct, nonce, _ = encrypt_code(encode_code_payload(value, pin))
            rows.append(
                DigitalCode.objects.create(
                    variant=variant,
                    status=status,
                    source=DigitalCodeSource.CSV_IMPORT,
                    code_fingerprint=fingerprint_code(value, pin),
                    code_identity=code_identity(value),
                    ciphertext=ct,
                    nonce=nonce,
                    masked=mask_code(value),
                )
            )
        return rows

    def admin_client(self):
        return auth_client(self.admin)

    def import_csv(self, variant, content: str, client=None):
        from django.core.files.uploadedfile import SimpleUploadedFile

        client = client or self.admin_client()
        upload = SimpleUploadedFile("codes.csv", content.encode("utf-8"), content_type="text/csv")
        preview = client.post(
            "/api/v1/admin/codes/import/preview/",
            {"file": upload, "mode": "SIMPLE", "variant_id": variant.id},
            format="multipart",
        )
        return preview


# --- D1: reuse of open orders + customer cancel / complete payment ---------------------


@override_settings(**BASE_SETTINGS)
class OpenOrderReuseTests(FixFixture, TestCase):
    def test_identical_cart_reuses_pending_order(self):
        self.add_codes(self.v10, 5)
        first = APIClient().post("/api/v1/checkout/orders/", self.order_data(), format="json")
        second = APIClient().post("/api/v1/checkout/orders/", self.order_data(), format="json")
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(first.json()["order_number"], second.json()["order_number"])
        self.assertEqual(Order.objects.count(), 1)

    def test_different_cart_or_email_creates_new_order(self):
        self.add_codes(self.v10, 5)
        base = create_storefront_order(data=self.order_data())
        qty2 = create_storefront_order(
            data=self.order_data([{"product_id": self.gift.id, "variant_id": self.v10.id, "quantity": 2}])
        )
        other = create_storefront_order(data=self.order_data(email="other@example.com"))
        self.assertEqual(len({base.pk, qty2.pk, other.pk}), 3)

    def test_paid_or_cancelled_orders_are_not_reused(self):
        self.add_codes(self.v10, 5)
        paid = self.paid_order()
        again = create_storefront_order(data=self.order_data())
        self.assertNotEqual(paid.pk, again.pk)
        auth_client(self.admin).post(f"/api/v1/admin/orders/{again.id}/cancel/", {}, format="json")
        third = create_storefront_order(data=self.order_data())
        self.assertNotIn(third.pk, {paid.pk, again.pk})

    def test_customer_cancel_with_access_token(self):
        self.add_codes(self.v10, 1)
        order = create_storefront_order(data=self.order_data())
        bad = APIClient().post(f"/api/v1/orders/{order.order_number}/cancel/", {"access_token": "x" * 32}, format="json")
        self.assertEqual(bad.status_code, 404)
        mail.outbox = []
        with self.captureOnCommitCallbacks(execute=True):
            res = APIClient().post(
                f"/api/v1/orders/{order.order_number}/cancel/", {"access_token": order.access_token}, format="json"
            )
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        self.assertEqual(body["payment_status"], "CANCELLED")
        self.assertEqual(body["fulfillment_status"], "CANCELLED")
        self.assertEqual(body["status"], "cancelled")
        self.assertFalse(body["can_pay"])
        self.assertFalse(body["can_cancel"])
        self.assertFalse(order.payments.exclude(status=PaymentStatus.CANCELLED).exists())
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("cancelled", mail.outbox[0].subject)
        self.assertTrue(AuditLog.objects.filter(action="orders.cancelled", meta__by="customer").exists())

    def test_customer_cancel_owner_jwt_and_paid_rejected(self):
        self.add_codes(self.v10, 2)
        customer = User.objects.create_user(email="owner@example.com", password="Xy7!pass-word", kind=UserKind.CUSTOMER)
        order = create_storefront_order(data=self.order_data(email="owner@example.com"), user=customer)
        client = auth_client(customer)
        self.assertEqual(client.post(f"/api/v1/orders/{order.order_number}/cancel/", {}, format="json").status_code, 200)
        paid = self.paid_order(email="owner@example.com")
        paid.user = customer
        paid.save(update_fields=["user"])
        res = client.post(f"/api/v1/orders/{paid.order_number}/cancel/", {}, format="json")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()["code"], "already_paid")
        # another customer cannot see it
        stranger = User.objects.create_user(email="s@example.com", password="Xy7!pass-word", kind=UserKind.CUSTOMER)
        self.assertEqual(
            auth_client(stranger).post(f"/api/v1/orders/{order.order_number}/cancel/", {}, format="json").status_code,
            404,
        )

    def test_my_orders_paid_only_filter(self):
        self.add_codes(self.v10, 3)
        customer = User.objects.create_user(email="mine@example.com", password="Xy7!pass-word", kind=UserKind.CUSTOMER)
        create_storefront_order(data=self.order_data(email="mine@example.com"), user=customer)
        paid = self.paid_order(email="mine@example.com", items=[{"product_id": self.gift.id, "variant_id": self.v10.id, "quantity": 2}])
        paid.user = customer
        paid.save(update_fields=["user"])
        client = auth_client(customer)
        all_rows = client.get("/api/v1/orders/mine/").json()
        rows = all_rows["results"] if isinstance(all_rows, dict) else all_rows
        self.assertEqual(len(rows), 2)
        paid_rows = client.get("/api/v1/orders/mine/?paid_only=1").json()
        paid_rows = paid_rows["results"] if isinstance(paid_rows, dict) else paid_rows
        self.assertEqual([r["order_number"] for r in paid_rows], [paid.order_number])
        waiting = client.get("/api/v1/orders/mine/?awaiting_payment=1").json()
        waiting = waiting["results"] if isinstance(waiting, dict) else waiting
        self.assertEqual(len(waiting), 1)
        self.assertTrue(waiting[0]["awaiting_payment"])
        self.assertTrue(waiting[0]["can_pay"])

    def test_disabled_customer_cannot_checkout(self):
        User.objects.create_user(email="banned@example.com", password="Xy7!pass-word", kind=UserKind.CUSTOMER, disabled=True)
        self.add_codes(self.v10, 1)
        res = APIClient().post("/api/v1/checkout/orders/", self.order_data(email="banned@example.com"), format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()["code"], "account_disabled")


@override_settings(**PAYPAL_LIVE_STOCK)
class PayPalReservationTests(FixFixture, TestCase):
    def setUp(self):
        super().setUp()
        self.fake = FakePayPal()
        patcher = patch("commerce.services.paypal.get_client", return_value=self.fake)
        patcher.start()
        self.addCleanup(patcher.stop)

    def checkout(self, **extra):
        return APIClient().post(
            "/api/v1/checkout/orders/", self.order_data(payment_provider="paypal", **extra), format="json"
        )

    def test_complete_payment_with_access_token_on_existing_order(self):
        self.add_codes(self.v10, 2)
        created = self.checkout().json()
        res = APIClient().post(
            "/api/v1/payments/paypal/create-order/",
            {"order_number": created["order_number"], "access_token": created["access_token"]},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.json()["paypal_order_id"])
        wrong = APIClient().post(
            "/api/v1/payments/paypal/create-order/",
            {"order_number": created["order_number"], "access_token": "nope"},
            format="json",
        )
        self.assertEqual(wrong.status_code, 403)

    def test_create_order_reserves_codes_for_30_minutes(self):
        self.add_codes(self.v10, 1)
        first = self.checkout().json()
        self.assertEqual(available_code_counts([self.v10.id])[self.v10.id], 1)  # checkout alone holds nothing
        res = APIClient().post(
            "/api/v1/payments/paypal/create-order/",
            {"order_number": first["order_number"], "checkout_token": first["checkout_token"]},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        order = Order.objects.get(order_number=first["order_number"])
        self.assertIsNotNone(order.reserved_until)
        self.assertEqual(available_code_counts([self.v10.id])[self.v10.id], 0)
        self.assertEqual(raw_available_code_counts([self.v10.id])[self.v10.id], 1)
        self.assertEqual(available_code_counts([self.v10.id], exclude_order_id=order.id)[self.v10.id], 1)
        # A second buyer cannot take the reserved code.
        second = self.checkout(email="second@example.com")
        self.assertEqual(second.status_code, 409, second.content)
        self.assertEqual(second.json()["code"], "out_of_stock")
        self.assertEqual(second.json()["lines"][0]["available"], 0)
        # The same order can re-open PayPal (its own reservation does not block it).
        again = APIClient().post(
            "/api/v1/payments/paypal/create-order/",
            {"order_number": first["order_number"], "access_token": first["access_token"]},
            format="json",
        )
        self.assertEqual(again.status_code, 200, again.content)
        # After 30 minutes the hold lapses.
        Order.objects.filter(pk=order.pk).update(reserved_until=timezone.now() - timedelta(seconds=1))
        self.assertEqual(available_code_counts([self.v10.id])[self.v10.id], 1)
        self.assertEqual(self.checkout(email="second@example.com").status_code, 201)

    def test_create_order_rejects_when_stock_taken_by_reservation(self):
        self.add_codes(self.v10, 1)
        a = self.checkout().json()
        b = self.checkout(email="b@example.com").json()
        ok = APIClient().post(
            "/api/v1/payments/paypal/create-order/",
            {"order_number": a["order_number"], "checkout_token": a["checkout_token"]},
            format="json",
        )
        self.assertEqual(ok.status_code, 200)
        blocked = APIClient().post(
            "/api/v1/payments/paypal/create-order/",
            {"order_number": b["order_number"], "checkout_token": b["checkout_token"]},
            format="json",
        )
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(blocked.json()["code"], "out_of_stock")
        self.assertEqual(len(self.fake.created), 1)  # PayPal never called for b

    def test_available_quantity_is_capped(self):
        self.add_codes(self.v10, 3)
        self.assertEqual(available_quantity([self.v10.id]), {self.v10.id: 3})
        with patch("commerce.services.inventory.raw_available_code_counts", return_value={self.v10.id: 500}):
            self.assertEqual(available_quantity([self.v10.id])[self.v10.id], PUBLIC_QUANTITY_CAP)


# --- ST-07 / D17 / ST-15 checkout validation ------------------------------------------


@override_settings(**BASE_SETTINGS)
class CheckoutFieldTests(FixFixture, TestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.topup.name_ar = "شحن اللعبة"
        cls.topup.save()
        cls.t1.name_ar = "١٠٠ شدة"
        cls.t1.save()
        ProductFieldDefinition.objects.filter(product=cls.topup, key="player_id").update(
            input_format="numeric", min_length=6, max_length=12, label_ar="معرف اللاعب"
        )
        ProductFieldDefinition.objects.create(
            product=cls.topup,
            key="server",
            type="SELECT",
            required=False,
            label_en="Server",
            label_ar="الخادم",
            options=[{"value": "eu", "label_en": "Europe", "label_ar": "أوروبا"}, {"value": "asia", "label_en": "Asia", "label_ar": "آسيا"}],
        )
        ProductFieldDefinition.objects.create(
            product=cls.topup, key="nick", required=False, label_en="Nickname", input_format="alphanumeric"
        )

    def post(self, **fields):
        return APIClient().post("/api/v1/checkout/orders/", self.order_data([self.topup_item(**fields)]), format="json")

    def test_numeric_and_length_rules(self):
        for value, fragment in (("12AB56", "digits only"), ("12345", "at least 6"), ("1234567890123", "at most 12")):
            res = self.post(player_id=value)
            self.assertEqual(res.status_code, 400, value)
            self.assertIn(fragment, res.json()["detail"])
            self.assertEqual(res.json()["field"], "player_id")
            self.assertEqual(res.json()["code"], "invalid_field")

    def test_options_and_alphanumeric(self):
        self.assertEqual(self.post(player_id="123456", server="mars").status_code, 400)
        self.assertEqual(self.post(player_id="123456", nick="bad nick!").status_code, 400)

    def test_arabic_digits_normalized_and_labels_stored(self):
        res = self.post(player_id="١٢٣٤٥٦٧", server="eu")
        self.assertEqual(res.status_code, 201, res.content)
        item = res.json()["items"][0]
        self.assertEqual(item["customer_fields"]["player_id"], "1234567")
        details = {d["key"]: d for d in item["field_details"]}
        self.assertEqual(details["player_id"]["label_en"], "Player ID")
        self.assertEqual(details["player_id"]["label_ar"], "معرف اللاعب")
        self.assertEqual(details["server"]["value_label_ar"], "أوروبا")
        self.assertEqual(item["product_name_ar"], "شحن اللعبة")
        self.assertEqual(item["variant_name_ar"], "١٠٠ شدة")

    def test_out_of_stock_lists_every_failing_line(self):
        self.add_codes(self.v10, 1)
        lines = [
            {"product_id": self.gift.id, "variant_id": self.v10.id, "quantity": 3},
            {"product_id": self.gift.id, "variant_id": self.v20.id, "quantity": 1},
        ]
        res = APIClient().post("/api/v1/checkout/orders/", self.order_data(lines), format="json")
        self.assertEqual(res.status_code, 409)
        body = res.json()
        self.assertEqual(body["code"], "out_of_stock")
        by_variant = {line["variant_id"]: line for line in body["lines"]}
        self.assertEqual(by_variant[self.v10.id]["available"], 1)
        self.assertEqual(by_variant[self.v10.id]["requested"], 3)
        self.assertEqual(by_variant[self.v20.id]["available"], 0)

    def test_customer_note_limit_and_locale(self):
        self.add_codes(self.v10, 1)
        too_long = APIClient().post("/api/v1/checkout/orders/", self.order_data(notes="x" * 501), format="json")
        self.assertEqual(too_long.status_code, 400)
        ok = APIClient().post(
            "/api/v1/checkout/orders/", self.order_data(notes="Please hurry", locale="ar"), format="json"
        )
        self.assertEqual(ok.status_code, 201, ok.content)
        self.assertEqual(ok.json()["locale"], "ar")
        self.assertEqual(Order.objects.get(order_number=ok.json()["order_number"]).notes, "Please hurry")


# --- D6 free orders + coupons ----------------------------------------------------------


@override_settings(**BASE_SETTINGS)
class FreeOrderTests(FixFixture, TestCase):
    def test_full_coupon_makes_order_paid_with_provider_free(self):
        Coupon.objects.create(code="ALLFREE", percent_off="100")
        self.add_codes(self.v10, 1)
        check = APIClient().post("/api/v1/coupons/validate/", {"code": "ALLFREE", "subtotal_fils": 10000}, format="json")
        self.assertTrue(check.json()["free_order"])
        mail.outbox = []
        with self.captureOnCommitCallbacks(execute=True):
            res = APIClient().post(
                "/api/v1/checkout/orders/", self.order_data(coupon_code="ALLFREE", payment_provider="paypal"), format="json"
            )
        self.assertEqual(res.status_code, 201, res.content)
        body = res.json()
        self.assertEqual(body["total_fils"], 0)
        self.assertEqual(body["payment_status"], "PAID")
        self.assertEqual(body["payment_provider"], "free")
        self.assertEqual(body["fulfillment_status"], "COMPLETED")
        self.assertTrue(body["free_order"])
        self.assertNotIn("checkout_token", body)
        self.assertEqual(Coupon.objects.get(code="ALLFREE").used_count, 1)
        self.assertEqual(len(mail.outbox), 2)

    def test_coupon_free_order_warning(self):
        client = self.admin_client()
        res = client.post("/api/v1/admin/coupons/", {"code": "BIG", "amount_off_fils": 6000}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertTrue(res.json()["free_order_risk"])
        self.assertIn("full price", res.json()["free_order_warning"])
        small = client.post("/api/v1/admin/coupons/", {"code": "SMALL", "percent_off": "10"}, format="json").json()
        self.assertFalse(small["free_order_risk"])
        self.assertEqual(small["status"], "active")

    def test_coupon_status_and_customer_limit_reason(self):
        now = timezone.now()
        Coupon.objects.create(code="LATER", percent_off="5", starts_at=now + timedelta(days=2))
        rows = {r["code"]: r for r in self.admin_client().get("/api/v1/admin/coupons/").json()["results"]}
        self.assertEqual(rows["LATER"]["status"], "scheduled")
        Coupon.objects.create(code="ONCEPP", percent_off="10", max_uses_per_customer=1)
        self.add_codes(self.v10, 3)
        self.paid_order(coupon_code="ONCEPP")
        res = APIClient().post(
            "/api/v1/coupons/validate/",
            {"code": "ONCEPP", "subtotal_fils": 10000, "email": "buyer@example.com"},
            format="json",
        )
        self.assertEqual(res.json()["code"], "coupon_customer_limit")

    def test_coupon_update_audits_only_changed_fields(self):
        coupon = Coupon.objects.create(code="EDIT", percent_off="10", description="x")
        client = self.admin_client()
        client.patch(f"/api/v1/admin/coupons/{coupon.id}/", {"percent_off": "10", "description": "x"}, format="json")
        self.assertFalse(AuditLog.objects.filter(action="coupons.update").exists())
        client.patch(f"/api/v1/admin/coupons/{coupon.id}/", {"percent_off": "15", "description": "x"}, format="json")
        entry = AuditLog.objects.get(action="coupons.update")
        self.assertEqual(entry.meta["changed"], ["percent_off"])
        self.assertEqual(entry.meta["changes"]["percent_off"], {"from": "10", "to": "15"})


# --- D3 auto-delivery after stock arrives, D10 duplicates, D22 search -------------------


@override_settings(**BASE_SETTINGS)
class StockArrivalTests(FixFixture, TestCase):
    def waiting_order(self, qty=1, **extra):
        """A PAID order stuck in MANUAL_REVIEW because its stock vanished before payment."""
        temp = self.add_codes(self.v10, qty)
        order = create_storefront_order(
            data=self.order_data([{"product_id": self.gift.id, "variant_id": self.v10.id, "quantity": qty}], **extra)
        )
        DigitalCode.objects.filter(pk__in=[c.pk for c in temp]).delete()
        mark_payment_verified(order.payments.get(), external_ref="psp-test")
        order.refresh_from_db()
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.MANUAL_REVIEW)
        return order

    def test_import_delivers_waiting_orders_oldest_first(self):
        old = self.waiting_order(email="old@example.com")
        Order.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(hours=5))
        new = self.waiting_order(email="new@example.com")
        preview = self.import_csv(self.v10, "code\nNEW-STOCK-AAA-1\n")
        self.assertEqual(preview.status_code, 201, preview.content)
        mail.outbox = []
        with self.captureOnCommitCallbacks(execute=True):
            res = self.admin_client().post(
                "/api/v1/admin/codes/import/confirm/", {"batch_id": preview.json()["batch"]["id"]}, format="json"
            )
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        self.assertEqual(body["waiting_orders"]["delivered"], 1)
        self.assertEqual(body["waiting_orders"]["order_numbers"], [old.order_number])
        self.assertEqual(body["auto_delivered_orders"], 1)
        self.assertIn("1 waiting order(s) were delivered", body["waiting_orders_message"])
        old.refresh_from_db()
        new.refresh_from_db()
        self.assertEqual(old.fulfillment_status, FulfillmentStatus.COMPLETED)
        self.assertEqual(new.fulfillment_status, FulfillmentStatus.MANUAL_REVIEW)
        self.assertTrue(any("your codes" in m.subject for m in mail.outbox))

    def test_manual_add_delivers_waiting_order(self):
        order = self.waiting_order()
        res = self.admin_client().post(
            "/api/v1/admin/codes/create/", {"variant_id": self.v10.id, "code": "HANDMADE-123456"}, format="json"
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()["waiting_orders"]["delivered"], 1)
        self.assertEqual(res.json()["status"], "DELIVERED")
        order.refresh_from_db()
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.COMPLETED)

    def test_import_duplicates_ignore_pin_and_name_location(self):
        self.add_identity_codes(self.v20, ["STOCK-DUP-0001"], pin="1111")
        preview = self.import_csv(
            self.v10,
            "code,pin\nFRESH-0001,1\nfresh-0001,2\nSTOCK-DUP-0001,9999\nbad,\n,\n",
        )
        batch = preview.json()["batch"]
        self.assertEqual(batch["valid_rows"], 2)  # FRESH-0001 + "bad"
        self.assertEqual(batch["duplicate_rows"], 2)
        self.assertEqual(batch["failed_rows"], 1)  # only the empty row
        errors = {e["row"]: e for e in batch["error_report"]}
        self.assertIn("same code as row 2", errors[3]["error"])
        self.assertEqual(errors[3]["type"], "duplicate")
        self.assertIn("already in stock", errors[4]["error"])
        self.assertIn("DL-20", errors[4]["error"])
        statuses = [r["status"] for r in batch["preview_rows"]]
        self.assertIn("ready", statuses)
        self.assertIn("duplicate", statuses)

    def test_attach_duplicate_names_the_order(self):
        self.add_identity_codes(self.v10, ["SHIPPED-CODE-77"])
        first = self.paid_order(email="first@example.com")
        self.assertEqual(first.fulfillment_status, FulfillmentStatus.COMPLETED)
        second = self.waiting_order(email="second@example.com")
        item = second.items.get()
        res = self.admin_client().post(
            f"/api/v1/admin/orders/{second.id}/items/{item.id}/codes/",
            {"code": "shipped-code-77", "pin": "different"},
            format="json",
        )
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()["code"], "duplicate_code")
        self.assertIn(first.order_number, res.json()["detail"])

    def test_full_code_search(self):
        self.add_identity_codes(self.v10, ["SEARCH-ME-ABCD-9876", "OTHER-CODE-0000-1111"])
        client = self.admin_client()
        res = client.get("/api/v1/admin/codes/", {"search": "search-me-abcd-9876"}).json()
        self.assertEqual(res["count"], 1)
        self.assertEqual(res["results"][0]["masked"], mask_code("SEARCH-ME-ABCD-9876"))
        tail = client.get("/api/v1/admin/codes/", {"search": "1111"}).json()
        self.assertEqual(tail["count"], 1)

    def test_identity_backfill_migration_function(self):
        codes = self.add_codes(self.v10, 2)  # legacy rows without identity
        self.assertIsNone(DigitalCode.objects.get(pk=codes[0].pk).code_identity)
        from importlib import import_module

        module = import_module("commerce.migrations.0008_backfill_code_identity_refunds_labels")
        module.backfill_code_identity(django_apps, None)
        self.assertTrue(all(DigitalCode.objects.filter(pk__in=[c.pk for c in codes]).values_list("code_identity", flat=True)))


# --- D4 / D5 refunds ------------------------------------------------------------------


@override_settings(**BASE_SETTINGS)
class RefundLedgerTests(FixFixture, TestCase):
    def refund(self, order, **body):
        return self.admin_client().post(f"/api/v1/admin/orders/{order.id}/refunds/", body, format="json")

    def test_multiple_partial_refunds_until_remaining_zero(self):
        self.add_codes(self.v10, 1)
        order = self.paid_order()
        mail.outbox = []
        with self.captureOnCommitCallbacks(execute=True):
            first = self.refund(order, amount_fils=3000, reason="goodwill")
        self.assertEqual(first.status_code, 201, first.content)
        body = first.json()
        self.assertEqual(body["payment_status"], "PARTIALLY_REFUNDED")
        self.assertEqual(body["refunded_fils"], 3000)
        self.assertEqual(body["refund_remaining_fils"], 7000)
        self.assertEqual(body["display"]["refunded"], "JOD 3.00")
        self.assertEqual(body["display"]["refund_remaining"], "JOD 7.00")
        self.assertEqual(body["refunds"][0]["provider"], "manual")
        self.assertEqual(body["refunds"][0]["amount_display"], "JOD 3.00")
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("refund", mail.outbox[0].subject)
        self.assertIn("JOD 3.00", mail.outbox[0].body)
        audit = AuditLog.objects.get(action="orders.refund")
        self.assertEqual(audit.meta["amount_fils"], 3000)
        self.assertEqual(audit.meta["amount"], "JOD 3.00")

        too_much = self.refund(order, amount_fils=7001)
        self.assertEqual(too_much.status_code, 400)
        self.assertEqual(too_much.json()["code"], "refund_exceeds_remaining")
        self.assertIn("JOD 7.00", too_much.json()["detail"])

        self.assertEqual(self.refund(order, amount_fils=2000).status_code, 201)
        rest = self.refund(order)  # no amount = everything that remains
        self.assertEqual(rest.status_code, 201)
        self.assertEqual(rest.json()["payment_status"], "REFUNDED")
        self.assertEqual(Refund.objects.filter(order=order).count(), 3)
        self.assertEqual(sum(Refund.objects.filter(order=order).values_list("amount_fils", flat=True)), 10000)
        self.assertEqual(order.items.get().codes.get().status, DigitalCodeStatus.UNAVAILABLE)
        nothing = self.refund(order, amount_fils=1)
        self.assertEqual(nothing.status_code, 409)
        payload = self.admin_client().get(f"/api/v1/admin/orders/{order.id}/").json()
        item = payload["items"][0]
        self.assertEqual(item["delivery_state"], "retired_refunded")
        self.assertEqual(item["delivery_state_label"], "Retired (refunded)")
        self.assertEqual(item["codes"][0]["status_label"], "Retired (refunded)")
        self.assertIsNotNone(item["delivered_at"])

    def test_partially_refunded_counts_as_paid(self):
        self.add_codes(self.v10, 1)
        order = self.paid_order([{"product_id": self.gift.id, "variant_id": self.v10.id, "quantity": 1}, self.topup_item()])
        self.refund(order, amount_fils=1000)
        order.refresh_from_db()
        self.assertEqual(order.payment_status, PaymentStatus.PARTIALLY_REFUNDED)
        reveal = APIClient().post(
            f"/api/v1/orders/{order.order_number}/codes/", {"access_token": order.access_token}, format="json"
        )
        self.assertEqual(reveal.status_code, 200, reveal.content)
        topup = order.items.get(product=self.topup)
        delivered = self.admin_client().post(
            f"/api/v1/admin/orders/{order.id}/items/{topup.id}/mark-delivered/", {"note": "Done"}, format="json"
        )
        self.assertEqual(delivered.status_code, 200, delivered.content)
        self.assertEqual(delivered.json()["fulfillment_status"], "COMPLETED")
        resend = self.admin_client().post(f"/api/v1/admin/orders/{order.id}/resend-email/")
        self.assertEqual(resend.status_code, 200, resend.content)

    def test_dashboard_net_revenue(self):
        self.add_codes(self.v10, 2)
        a = self.paid_order()
        self.paid_order(email="b@example.com")
        self.refund(a, amount_fils=4000)
        body = self.admin_client().get("/api/v1/admin/dashboard/").json()
        self.assertEqual(body["revenue_fils"], 16000)
        self.assertEqual(body["gross_revenue_fils"], 20000)
        self.assertEqual(body["refunds_fils"], 4000)
        self.assertEqual(body["today"]["orders"], 2)
        self.assertEqual(body["today"]["revenue_fils"], 16000)
        self.assertEqual(body["links"]["awaiting_delivery"], "needs_action=1")

    def test_customer_spend_helper_is_net(self):
        from commerce.services.customers import customer_order_stats, customer_total_spent_fils

        customer = User.objects.create_user(email="spend@example.com", password="Xy7!pass-word", kind=UserKind.CUSTOMER)
        self.add_codes(self.v10, 3)
        guest = self.paid_order(email="spend@example.com")
        self.refund(guest, amount_fils=2500)
        create_storefront_order(data=self.order_data(email="spend@example.com", items=[{"product_id": self.gift.id, "variant_id": self.v10.id, "quantity": 2}]))
        self.assertEqual(customer_total_spent_fils(user=customer), 7500)
        stats = customer_order_stats([customer])[customer.pk]
        self.assertEqual(stats, {"orders_count": 2, "guest_orders_count": 2, "total_spent_fils": 7500})


@override_settings(**PAYPAL_LIVE_STOCK)
class PayPalRefundLedgerTests(FixFixture, TestCase):
    def setUp(self):
        super().setUp()
        self.fake = FakePayPal()
        patcher = patch("commerce.services.paypal.get_client", return_value=self.fake)
        patcher.start()
        self.addCleanup(patcher.stop)

    def paid_paypal_order(self):
        self.add_codes(self.v10, 1)
        created = APIClient().post(
            "/api/v1/checkout/orders/", self.order_data(payment_provider="paypal"), format="json"
        ).json()
        paypal = APIClient().post(
            "/api/v1/payments/paypal/create-order/",
            {"order_number": created["order_number"], "checkout_token": created["checkout_token"]},
            format="json",
        ).json()
        APIClient().post("/api/v1/payments/paypal/capture-order/", {"paypal_order_id": paypal["paypal_order_id"]}, format="json")
        order = Order.objects.get(order_number=created["order_number"])
        self.assertEqual(order.payment_status, PaymentStatus.PAID)
        return order

    def test_paypal_partials_recorded_in_jod_and_provider_currency(self):
        order = self.paid_paypal_order()
        res = self.admin_client().post(
            f"/api/v1/admin/orders/{order.id}/refunds/", {"amount_fils": 2500, "reason": "late"}, format="json"
        )
        self.assertEqual(res.status_code, 201, res.content)
        refund = Refund.objects.get(order=order)
        self.assertEqual(refund.provider, "paypal")
        self.assertEqual(refund.amount_fils, 2500)
        self.assertEqual(refund.provider_currency, "USD")
        self.assertTrue(refund.provider_refund_id)
        self.assertEqual(res.json()["payment_provider"], "paypal")
        self.assertEqual(res.json()["actions"]["refund"]["via"], "paypal")
        rest = self.admin_client().post(f"/api/v1/admin/orders/{order.id}/refunds/", {}, format="json")
        self.assertEqual(rest.json()["payment_status"], "REFUNDED")
        self.assertEqual(sum(Refund.objects.filter(order=order).values_list("amount_fils", flat=True)), 10000)
        self.assertIsNone(self.fake.refund_calls[-1]["value"])  # remaining = full remaining refund

    def test_manual_refund_on_paypal_order(self):
        order = self.paid_paypal_order()
        res = self.admin_client().post(
            f"/api/v1/admin/orders/{order.id}/refunds/", {"amount_fils": 1000, "manual": True}, format="json"
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(self.fake.refund_calls, [])
        self.assertEqual(Refund.objects.get(order=order).provider, "manual")

    def test_manual_payment_voids_stale_paypal_row(self):
        self.add_codes(self.v10, 1)
        created = APIClient().post(
            "/api/v1/checkout/orders/", self.order_data(payment_provider="paypal"), format="json"
        ).json()
        order = Order.objects.get(order_number=created["order_number"])
        mark_order_paid_manually(order, actor=self.admin, reason="Bank transfer")
        paypal_row = order.payments.get(provider="paypal")
        self.assertEqual(paypal_row.status, PaymentStatus.CANCELLED)
        self.assertTrue(paypal_row.raw["voided"])
        payload = self.admin_client().get(f"/api/v1/admin/orders/{order.id}/").json()
        self.assertEqual(payload["payment_provider"], "manual")
        listing = self.admin_client().get("/api/v1/admin/payments/").json()
        self.assertEqual([p["provider"] for p in listing["results"]], ["manual"])
        with_voided = self.admin_client().get("/api/v1/admin/payments/?include_voided=1").json()
        self.assertEqual(len(with_voided["results"]), 2)


# --- D7 / D8 / D12 / D13 admin order actions ------------------------------------------


@override_settings(**BASE_SETTINGS)
class AdminOrderActionTests(FixFixture, TestCase):
    def test_staff_cancel_is_one_action(self):
        self.add_codes(self.v10, 1)
        order = create_storefront_order(data=self.order_data())
        mail.outbox = []
        with self.captureOnCommitCallbacks(execute=True):
            res = self.admin_client().post(f"/api/v1/admin/orders/{order.id}/cancel/", {"reason": "dup"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        self.assertEqual((body["payment_status"], body["fulfillment_status"]), ("CANCELLED", "CANCELLED"))
        self.assertTrue(all(p["status"] == "CANCELLED" for p in body["payments"]))
        self.assertFalse(body["actions"]["cancel"]["enabled"])
        self.assertFalse(any(a["enabled"] for a in body["actions"]["fulfillment"]))
        self.assertFalse(body["actions"]["complete"]["enabled"])
        self.assertEqual(len(mail.outbox), 1)
        # mark delivered on a cancelled order is impossible (OR-01)
        topup_order = create_storefront_order(data=self.order_data([self.topup_item()], email="t@example.com"))
        self.admin_client().post(f"/api/v1/admin/orders/{topup_order.id}/cancel/", {}, format="json")
        item = topup_order.items.get()
        res = self.admin_client().post(f"/api/v1/admin/orders/{topup_order.id}/items/{item.id}/mark-delivered/", {}, format="json")
        self.assertEqual(res.status_code, 409)

    def test_failed_payment_can_be_cancelled(self):
        self.add_codes(self.v10, 1)
        order = create_storefront_order(data=self.order_data())
        Order.objects.filter(pk=order.pk).update(payment_status=PaymentStatus.FAILED)
        res = self.admin_client().post(f"/api/v1/admin/orders/{order.id}/cancel/", {}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["payment_status"], "CANCELLED")

    def test_unpaid_order_cannot_advance_fulfillment(self):
        order = create_storefront_order(data=self.order_data([self.topup_item()]))
        res = self.admin_client().post(
            f"/api/v1/admin/orders/{order.id}/transition/", {"fulfillment_status": "QUEUED"}, format="json"
        )
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()["code"], "not_paid")
        payload = self.admin_client().get(f"/api/v1/admin/orders/{order.id}/").json()
        queued = next(a for a in payload["actions"]["fulfillment"] if a["status"] == "QUEUED")
        self.assertFalse(queued["enabled"])
        self.assertIn("not paid", queued["disabled_reason"])
        self.assertEqual(payload["allowed_fulfillment_transitions"], ["CANCELLED"])

    def test_complete_requires_every_item_delivered(self):
        self.add_codes(self.v10, 1)
        order = self.paid_order([{"product_id": self.gift.id, "variant_id": self.v10.id, "quantity": 1}, self.topup_item()])
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.PROCESSING)
        payload = self.admin_client().get(f"/api/v1/admin/orders/{order.id}/").json()
        self.assertFalse(payload["actions"]["complete"]["enabled"])
        self.assertEqual(payload["actions"]["complete"]["label"], "Set status: Completed")
        self.assertIn("1 of 2", payload["actions"]["complete"]["disabled_reason"])
        res = self.admin_client().post(
            f"/api/v1/admin/orders/{order.id}/transition/", {"fulfillment_status": "COMPLETED"}, format="json"
        )
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()["code"], "items_not_delivered")
        topup = order.items.get(product=self.topup)
        topup.delivered_at = timezone.now()
        topup.save(update_fields=["delivered_at"])
        res = self.admin_client().post(
            f"/api/v1/admin/orders/{order.id}/transition/", {"fulfillment_status": "COMPLETED"}, format="json"
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["fulfillment_status"], "COMPLETED")

    def test_staff_notes_patch_is_audited(self):
        order = create_storefront_order(data=self.order_data([self.topup_item()]))
        res = self.admin_client().patch(
            f"/api/v1/admin/orders/{order.id}/staff-notes/", {"staff_notes": "Called the customer"}, format="json"
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["staff_notes"], "Called the customer")
        entry = AuditLog.objects.get(action="orders.staff_notes")
        self.assertEqual(entry.meta["after"], "Called the customer")
        # customers never see staff notes
        public = APIClient().get(f"/api/v1/orders/{order.order_number}/", {"access_token": order.access_token}).json()
        self.assertNotIn("staff_notes", public)
        viewer = make_admin("fix-viewer@mmh.test", AdminRole.VIEWER)
        denied = auth_client(viewer).patch(f"/api/v1/admin/orders/{order.id}/staff-notes/", {"staff_notes": "x"}, format="json")
        self.assertEqual(denied.status_code, 403)

    def test_resend_email_allows_orders_notify(self):
        self.add_codes(self.v10, 1)
        order = self.paid_order()
        support = make_admin("fix-support@mmh.test", AdminRole.SUPPORT_AGENT)
        res = auth_client(support).post(f"/api/v1/admin/orders/{order.id}/resend-email/")
        self.assertEqual(res.status_code, 200, res.content)
        viewer = make_admin("fix-viewer2@mmh.test", AdminRole.VIEWER)
        self.assertEqual(auth_client(viewer).post(f"/api/v1/admin/orders/{order.id}/resend-email/").status_code, 403)

    def test_history_timeline(self):
        self.add_codes(self.v10, 1)
        order = self.paid_order()
        APIClient().post(f"/api/v1/orders/{order.order_number}/codes/", {"access_token": order.access_token}, format="json")
        res = self.admin_client().get(f"/api/v1/admin/orders/{order.order_number}/history/")
        self.assertEqual(res.status_code, 200)
        rows = res.json()["results"]
        actions = [r["action"] for r in rows]
        self.assertIn("orders.codes_allocated", actions)
        self.assertIn("codes.customer_reveal", actions)
        reveal = next(r for r in rows if r["action"] == "codes.customer_reveal")
        self.assertEqual(reveal["actor_name"], "Customer")
        self.assertEqual(reveal["entity_label"], f"Order {order.order_number}")
        self.assertEqual(rows, sorted(rows, key=lambda r: r["created_at"]))

    def test_customer_reveal_tracking(self):
        self.add_codes(self.v10, 1)
        order = self.paid_order()
        code = order.items.get().codes.get()
        self.assertIsNone(code.customer_revealed_at)
        APIClient().post(f"/api/v1/orders/{order.order_number}/codes/", {"access_token": order.access_token}, format="json")
        code.refresh_from_db()
        first = code.customer_revealed_at
        self.assertIsNotNone(first)
        APIClient().post(f"/api/v1/orders/{order.order_number}/codes/", {"access_token": order.access_token}, format="json")
        code.refresh_from_db()
        self.assertEqual(code.customer_revealed_at, first)
        payload = self.admin_client().get(f"/api/v1/admin/orders/{order.id}/").json()
        self.assertTrue(payload["items"][0]["codes"][0]["revealed_by_customer"])
        listing = self.admin_client().get("/api/v1/admin/codes/").json()
        self.assertTrue(listing["results"][0]["revealed_by_customer"])


# --- OR-12 / OR-13 / OR-14 / OR-15 lists, dashboard, audit, payments -------------------


@override_settings(**BASE_SETTINGS)
class AdminListTests(FixFixture, TestCase):
    def test_orders_filters_search_and_ordering(self):
        self.add_codes(self.v10, 5)
        paid_waiting = self.paid_order([self.topup_item()], email="needs@example.com")
        self.paid_order(email="done@example.com")
        create_storefront_order(data=self.order_data(email="pending@example.com"))
        stale = create_storefront_order(data=self.order_data(email="stale@example.com"))
        Order.objects.filter(pk=stale.pk).update(created_at=timezone.now() - timedelta(hours=30))
        client = self.admin_client()
        needs = client.get("/api/v1/admin/orders/?needs_action=1").json()
        self.assertEqual([r["order_number"] for r in needs["results"]], [paid_waiting.order_number])
        self.assertTrue(needs["results"][0]["needs_action"])
        recent = client.get("/api/v1/admin/orders/?awaiting_payment_24h=1").json()
        self.assertEqual([r["email"] for r in recent["results"]], ["pending@example.com"])
        search = client.get("/api/v1/admin/orders/?search=done@").json()
        self.assertEqual([r["email"] for r in search["results"]], ["done@example.com"])
        by_number = client.get(f"/api/v1/admin/orders/?search={paid_waiting.order_number[:6]}").json()
        self.assertIn(paid_waiting.order_number, [r["order_number"] for r in by_number["results"]])
        asc = client.get("/api/v1/admin/orders/?ordering=created_at").json()["results"]
        self.assertEqual(asc[0]["email"], "stale@example.com")
        by_total = client.get("/api/v1/admin/orders/?ordering=-total_fils").json()["results"]
        self.assertEqual(by_total[0]["total_fils"], 10000)
        self.assertEqual(client.get("/api/v1/admin/orders/?ordering=payment_status").status_code, 200)
        self.assertEqual(client.get("/api/v1/admin/orders/?ordering=-fulfillment_status").status_code, 200)
        self.assertEqual(asc[0]["total_display"], "JOD 10.00")

    def test_dashboard_recent_audit_requires_audit_read(self):
        AuditLog.objects.create(actor=self.admin, action="orders.transition", entity_type="Order", entity_id="1", meta={"order_number": "ABC"})
        admin_body = self.admin_client().get("/api/v1/admin/dashboard/").json()
        self.assertEqual(admin_body["recent_audit"][0]["actor_email"], "fix-admin@mmh.test")
        self.assertEqual(admin_body["recent_audit"][0]["entity_label"], "Order ABC")
        manager = make_admin("fix-om@mmh.test", AdminRole.ORDER_MANAGER)
        self.assertIsNone(auth_client(manager).get("/api/v1/admin/dashboard/").json()["recent_audit"])

    def test_audit_search_meta_and_labels(self):
        self.add_codes(self.v10, 1)
        order = self.paid_order(email="findme@example.com")
        client = self.admin_client()
        by_number = client.get("/api/v1/admin/audit/", {"search": order.order_number}).json()
        self.assertTrue(by_number["count"] >= 1)
        self.assertTrue(all(order.order_number in str(r["meta"]) for r in by_number["results"]))
        self.assertEqual(by_number["results"][0]["entity_label"], f"Order {order.order_number}")
        self.assertEqual(by_number["results"][0]["order_number"], order.order_number)
        exact = client.get("/api/v1/admin/audit/", {"order_number": order.order_number}).json()
        self.assertEqual(exact["count"], by_number["count"])
        client.patch(f"/api/v1/admin/orders/{order.id}/staff-notes/", {"staff_notes": "n"}, format="json")
        by_email = client.get("/api/v1/admin/audit/", {"search": "findme@example.com"}).json()
        self.assertIn("orders.staff_notes", [r["action"] for r in by_email["results"]])

    def test_payments_fields_filters_and_csv(self):
        self.add_codes(self.v10, 2)
        a = self.paid_order()
        create_storefront_order(data=self.order_data(email="unpaid@example.com"))
        self.admin_client().post(f"/api/v1/admin/orders/{a.id}/refunds/", {"amount_fils": 1500}, format="json")
        client = self.admin_client()
        rows = client.get("/api/v1/admin/payments/?status=PARTIALLY_REFUNDED").json()["results"]
        self.assertEqual(len(rows), 1)
        row = rows[0]
        for key in ("order_number", "provider", "status", "amount_fils", "provider_amount", "provider_currency", "capture_id", "paid_at", "refunded_fils"):
            self.assertIn(key, row)
        self.assertEqual(row["refunded_fils"], 1500)
        self.assertEqual(row["order_number"], a.order_number)
        today = timezone.now().date().isoformat()
        self.assertEqual(len(client.get(f"/api/v1/admin/payments/?date_from={today}&date_to={today}").json()["results"]), 2)
        self.assertEqual(len(client.get("/api/v1/admin/payments/?date_to=2000-01-01").json()["results"]), 0)
        self.assertEqual(len(client.get("/api/v1/admin/payments/?provider=pending").json()["results"]), 2)
        export = client.get("/api/v1/admin/payments/export/?status=PARTIALLY_REFUNDED")
        self.assertEqual(export.status_code, 200)
        self.assertEqual(export["Content-Type"], "text/csv")
        lines = list(csv.reader(io.StringIO(export.content.decode())))
        self.assertEqual(lines[0][0], "order_number")
        self.assertEqual(lines[1][0], a.order_number)
        self.assertEqual(lines[1][8], "1.500")


# --- D9 e-mails -----------------------------------------------------------------------


@override_settings(**BASE_SETTINGS)
class EmailCopyTests(FixFixture, TestCase):
    def test_arabic_paid_email_with_discount_and_guest_wording(self):
        Coupon.objects.create(code="TEN", percent_off="10")
        self.add_codes(self.v10, 1)
        mail.outbox = []
        with self.captureOnCommitCallbacks(execute=True):
            self.paid_order(coupon_code="TEN", locale="ar")
        paid = next(m for m in mail.outbox if "تم استلام الدفع" in m.subject)
        self.assertIn("الخصم (TEN)", paid.body)
        self.assertIn("-1.00 د.أ", paid.body)
        self.assertIn("9.00 د.أ", paid.body)
        self.assertNotIn("حسابك", paid.body)  # guest: no "account" wording
        self.assertIn('dir="rtl"', paid.alternatives[0][0])
        codes = next(m for m in mail.outbox if "أكوادك" in m.subject)
        self.assertIn("الكود", codes.body)

    def test_english_paid_email_lists_discount(self):
        Coupon.objects.create(code="FIVE", amount_off_fils=500)
        self.add_codes(self.v10, 1)
        mail.outbox = []
        with self.captureOnCommitCallbacks(execute=True):
            self.paid_order(coupon_code="FIVE")
        paid = next(m for m in mail.outbox if "payment received" in m.subject)
        self.assertIn("Subtotal: JOD 10.00", paid.body)
        self.assertIn("Discount (FIVE): -JOD 0.50", paid.body)
        self.assertIn("Total: JOD 9.50", paid.body)
        self.assertIn("appear on your order page", paid.body)  # guest wording
        self.assertNotIn("your account", paid.body)

    def test_partial_then_full_codes_emails_once_each(self):
        codes = self.add_codes(self.v10, 2)
        order = create_storefront_order(
            data=self.order_data([{"product_id": self.gift.id, "variant_id": self.v10.id, "quantity": 2}])
        )
        codes[1].delete()
        mail.outbox = []
        with self.captureOnCommitCallbacks(execute=True):
            mark_payment_verified(order.payments.get(), external_ref="psp-test")
        partial = [m for m in mail.outbox if "1 of your 2 codes is ready" in m.subject]
        self.assertEqual(len(partial), 1)
        self.assertIn("rest is on the way", partial[0].body)
        mail.outbox = []
        self.assertEqual(send_delivery_update(order.id), "")  # no second partial e-mail
        self.add_codes(self.v10, 1)
        with self.captureOnCommitCallbacks(execute=True):
            allocate_codes(order)
        full = [m for m in mail.outbox if "your codes" in m.subject]
        self.assertEqual(len(full), 1)
        mail.outbox = []
        self.assertEqual(send_delivery_update(order.id), "")
        self.assertEqual(mail.outbox, [])

    def test_topup_email_repeats_labelled_fields_and_team_note(self):
        order = self.paid_order([self.topup_item(player_id="5123456")])
        item = order.items.get()
        mail.outbox = []
        with self.captureOnCommitCallbacks(execute=True):
            self.admin_client().post(
                f"/api/v1/admin/orders/{order.id}/items/{item.id}/mark-delivered/", {"note": "Sent 100 UC"}, format="json"
            )
        msg = mail.outbox[0]
        self.assertIn("Player ID: 5123456", msg.body)
        self.assertIn("Note from our team: Sent 100 UC", msg.body)
        payload = self.admin_client().get(f"/api/v1/admin/orders/{order.id}/").json()
        self.assertTrue(payload["items"][0]["delivery_note_customer_visible"])
        self.assertFalse(payload["items"][0]["show_delivery_method"])

    def test_paid_email_for_topup_only_has_no_codes_wording(self):
        mail.outbox = []
        with self.captureOnCommitCallbacks(execute=True):
            self.paid_order([self.topup_item()])
        paid = mail.outbox[0]
        self.assertIn("topping up the account", paid.body)
        self.assertNotIn("codes", paid.body.lower())

    def test_expired_order_email_and_status(self):
        from commerce.services.maintenance import expire_stale_orders

        self.add_codes(self.v10, 1)
        order = create_storefront_order(data=self.order_data())
        Order.objects.filter(pk=order.pk).update(created_at=timezone.now() - timedelta(hours=80))
        mail.outbox = []
        with self.captureOnCommitCallbacks(execute=True):
            counts = expire_stale_orders()
        self.assertEqual(counts["expired"], 1)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("expired", mail.outbox[0].subject)
        public = APIClient().get(f"/api/v1/orders/{order.order_number}/", {"access_token": order.access_token}).json()
        self.assertEqual(public["status"], "expired")
