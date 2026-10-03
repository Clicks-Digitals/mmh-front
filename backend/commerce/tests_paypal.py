from __future__ import annotations

import os
from decimal import Decimal
from unittest.mock import patch

from django.conf import settings
from django.test import TestCase, override_settings
from django.utils import timezone

from accounts.models import AdminRole
from accounts.tests_admin import auth_client, make_admin
from catalog.models import (
    Category,
    FulfillmentType,
    Platform,
    Product,
    ProductKind,
    ProductVariant,
    PublishStatus,
    Region,
    StockStatus,
)
from commerce.models import Coupon, FulfillmentStatus, Order, PayPalWebhookEvent, Payment, PaymentStatus
from commerce.services.checkout import create_storefront_order
from commerce.services.paypal_client import PayPalApiError

PAYPAL_SETTINGS = dict(
    PAYPAL_ENV="sandbox",
    PAYPAL_CLIENT_ID="paypal-client-id",
    PAYPAL_CLIENT_SECRET="paypal-client-secret-do-not-leak",
    PAYPAL_WEBHOOK_ID="WH-TEST",
    PAYPAL_CURRENCY="USD",
    PAYPAL_FX_RATE="1.41",
    PAYPAL_BRAND_NAME="MMH",
    ALLOW_DEMO_AUTO_PAYMENT=True,
    IS_PRODUCTION=False,
)


class FakePayPal:
    def __init__(self):
        self.created = []
        self.capture_calls = []
        self.refund_calls = []
        self.get_calls = []
        self.verify_ok = True
        self.fail_capture_issue = ""
        self.capture_amount = ""
        self.capture_currency = ""
        self.refund_status = "COMPLETED"
        self.orders: dict[str, dict] = {}

    def create_order(self, *, value, currency, order_number, invoice_id, request_id):
        oid = f"PAYPALORDER{len(self.created) + 1:05d}"
        body = {
            "id": oid,
            "status": "CREATED",
            "purchase_units": [
                {
                    "custom_id": order_number,
                    "invoice_id": invoice_id,
                    "amount": {"currency_code": currency, "value": value},
                }
            ],
        }
        self.orders[oid] = body
        self.created.append(
            {
                "value": value,
                "currency": currency,
                "order_number": order_number,
                "invoice_id": invoice_id,
                "request_id": request_id,
            }
        )
        return body

    def get_order(self, paypal_order_id):
        self.get_calls.append(paypal_order_id)
        if paypal_order_id not in self.orders:
            raise PayPalApiError("missing", http_status=404)
        return self.orders[paypal_order_id]

    def capture_order(self, paypal_order_id, *, request_id):
        self.capture_calls.append({"id": paypal_order_id, "request_id": request_id})
        if self.fail_capture_issue:
            raise PayPalApiError("declined", http_status=422, issue=self.fail_capture_issue)
        current = self.orders[paypal_order_id]
        unit = current["purchase_units"][0]
        amount = dict(unit["amount"])
        if self.capture_amount:
            amount = {
                "currency_code": self.capture_currency or amount["currency_code"],
                "value": self.capture_amount,
            }
        captured = {
            "id": paypal_order_id,
            "status": "COMPLETED",
            "purchase_units": [
                {
                    "custom_id": unit["custom_id"],
                    "amount": amount,
                    "payments": {
                        "captures": [
                            {
                                "id": f"CAPTURE{paypal_order_id[-6:]}",
                                "status": "COMPLETED",
                                "custom_id": unit["custom_id"],
                                "amount": amount,
                            }
                        ]
                    },
                }
            ],
        }
        self.orders[paypal_order_id] = captured
        return captured

    def refund_capture(self, capture_id, *, request_id, value=None, currency=None):
        self.refund_calls.append(
            {"capture_id": capture_id, "request_id": request_id, "value": value, "currency": currency}
        )
        return {
            "id": f"REFUND{len(self.refund_calls):05d}",
            "status": self.refund_status,
            "amount": {"value": value or "14.10", "currency_code": currency or "USD"},
        }

    def verify_webhook(self, *, headers, event):
        return self.verify_ok


@override_settings(**PAYPAL_SETTINGS)
class PayPalCheckoutTests(TestCase):
    def setUp(self):
        self.fake = FakePayPal()
        patcher = patch("commerce.services.paypal.get_client", return_value=self.fake)
        patcher.start()
        self.addCleanup(patcher.stop)
        cat = Category.objects.create(slug="cards", name_en="Cards", status=PublishStatus.PUBLISHED)
        plat = Platform.objects.create(slug="steam", name_en="Steam", status=PublishStatus.PUBLISHED)
        region = Region.objects.create(slug="global", name_en="Global", currency="JOD")
        self.product = Product.objects.create(
            id="paypal-card",
            slug="paypal-card",
            kind=ProductKind.GIFT_CARD,
            fulfillment_type=FulfillmentType.CODE,
            category=cat,
            platform=plat,
            brand="MMH",
            artwork_key="card",
            status=PublishStatus.PUBLISHED,
            name_en="PayPal Card",
        )
        self.variant = ProductVariant.objects.create(
            product=self.product,
            region=region,
            sku="PAYPAL-10",
            denomination="10",
            package_value="10",
            package_currency="JOD",
            price_fils=10000,
            stock_status=StockStatus.IN_STOCK,
            published=True,
            name_en="10",
            external_id="10",
        )

    def _checkout(self, **extra):
        payload = {
            "email": "buyer@example.com",
            "full_name": "Buyer",
            "phone": "+962790000000",
            "idempotency_key": extra.pop("idempotency_key", "paypal-checkout-1"),
            "region_confirmed": True,
            "refund_confirmed": True,
            "payment_provider": "paypal",
            "items": [{"product_id": self.product.id, "variant_id": self.variant.id, "quantity": 1}],
        }
        payload.update(extra)
        return self.client.post("/api/v1/checkout/orders/", payload, content_type="application/json")

    def _create_paypal(self, order):
        return self.client.post(
            "/api/v1/payments/paypal/create-order/",
            {
                "order_number": order["order_number"],
                "checkout_token": order["checkout_token"],
                "amount": "0.01",
                "currency": "USD",
            },
            content_type="application/json",
        )

    def test_config_hides_secret(self):
        response = self.client.get("/api/v1/payments/paypal/config/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["enabled"])
        self.assertEqual(body["client_id"], "paypal-client-id")
        self.assertEqual(body["currency"], "USD")
        self.assertNotIn("paypal-client-secret-do-not-leak", response.content.decode())
        self.assertIn("sandbox.paypal.com", body["sdk_url"])

    def test_paypal_checkout_skips_demo_auto_pay(self):
        response = self._checkout()
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(body["payment_status"], "PENDING")
        self.assertEqual(body["payment_provider"], "paypal")
        self.assertEqual(body["paypal_amount"], "14.10")
        self.assertEqual(body["paypal_currency"], "USD")
        self.assertTrue(body["checkout_token"])
        order = Order.objects.get(order_number=body["order_number"])
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.NOT_STARTED)
        self.assertFalse(order.items.first().codes.exists())

    def test_create_order_uses_server_total_and_reuses_paypal_order(self):
        created = self._checkout().json()
        first = self._create_paypal(created)
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(self.fake.created[0]["value"], "14.10")
        self.assertEqual(self.fake.created[0]["currency"], "USD")
        second = self._create_paypal(created)
        self.assertEqual(second.status_code, 200, second.content)
        self.assertEqual(first.json()["paypal_order_id"], second.json()["paypal_order_id"])
        self.assertEqual(len(self.fake.created), 1)
        self.assertEqual(self.fake.get_calls, [first.json()["paypal_order_id"]])
        payment = Payment.objects.get(provider_order_id=first.json()["paypal_order_id"])
        self.assertEqual(payment.amount_fils, 10000)
        self.assertIsNotNone(payment.raw_create_response)

    def test_wrong_checkout_token_is_rejected(self):
        created = self._checkout().json()
        response = self.client.post(
            "/api/v1/payments/paypal/create-order/",
            {"order_number": created["order_number"], "checkout_token": "not-the-token"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(len(self.fake.created), 0)

    def test_capture_marks_paid_once_and_replay_does_not_charge_again(self):
        coupon = Coupon.objects.create(code="TEN", active=True, percent_off="10.00", max_uses=3, used_count=0)
        created = self._checkout(coupon_code="TEN", idempotency_key="paypal-coupon").json()
        self.assertEqual(created["paypal_amount"], "12.69")
        paypal = self._create_paypal(created).json()
        capture = self.client.post(
            "/api/v1/payments/paypal/capture-order/",
            {"paypal_order_id": paypal["paypal_order_id"]},
            content_type="application/json",
        )
        self.assertEqual(capture.status_code, 200, capture.content)
        self.assertEqual(capture.json()["payment_status"], "PAID")
        order = Order.objects.get(order_number=created["order_number"])
        payment = order.payments.get()
        self.assertEqual(order.payment_status, PaymentStatus.PAID)
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.COMPLETED)
        self.assertEqual(payment.provider_capture_id, capture.json()["paypal_capture_id"])
        self.assertIsNotNone(payment.paid_at)
        self.assertIsNotNone(payment.raw_capture_response)
        self.assertEqual(order.items.first().codes.count(), 1)
        coupon.refresh_from_db()
        self.assertEqual(coupon.used_count, 1)

        again = self.client.post(
            "/api/v1/payments/paypal/capture-order/",
            {"paypal_order_id": paypal["paypal_order_id"]},
            content_type="application/json",
        )
        self.assertEqual(again.status_code, 200, again.content)
        self.assertEqual(len(self.fake.capture_calls), 1)
        coupon.refresh_from_db()
        self.assertEqual(coupon.used_count, 1)
        self.assertEqual(order.items.first().codes.count(), 1)

    def test_unapproved_capture_leaves_order_unpaid(self):
        created = self._checkout(idempotency_key="paypal-cancel").json()
        paypal = self._create_paypal(created).json()
        self.fake.fail_capture_issue = "ORDER_NOT_APPROVED"
        response = self.client.post(
            "/api/v1/payments/paypal/capture-order/",
            {"paypal_order_id": paypal["paypal_order_id"]},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "not_approved")
        order = Order.objects.get(order_number=created["order_number"])
        self.assertEqual(order.payment_status, PaymentStatus.PENDING)
        self.assertEqual(order.payments.get().status, PaymentStatus.PENDING)
        self.assertFalse(order.items.first().codes.exists())

    def test_amount_mismatch_does_not_fulfill_and_refunds(self):
        created = self._checkout(idempotency_key="paypal-mismatch").json()
        paypal = self._create_paypal(created).json()
        self.fake.capture_amount = "1.00"
        response = self.client.post(
            "/api/v1/payments/paypal/capture-order/",
            {"paypal_order_id": paypal["paypal_order_id"]},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "amount_mismatch")
        order = Order.objects.get(order_number=created["order_number"])
        payment = order.payments.get()
        self.assertEqual(order.payment_status, PaymentStatus.FAILED)
        self.assertNotEqual(order.fulfillment_status, FulfillmentStatus.COMPLETED)
        self.assertEqual(payment.status, PaymentStatus.REFUNDED)
        self.assertEqual(len(self.fake.refund_calls), 1)
        self.assertFalse(order.items.first().codes.exists())

    def test_webhook_is_idempotent_and_rejects_bad_signatures(self):
        created = self._checkout(idempotency_key="paypal-webhook").json()
        paypal = self._create_paypal(created).json()
        payment = Payment.objects.get(order__order_number=created["order_number"])
        event = {
            "id": "WH-EVENT-1",
            "event_type": "PAYMENT.CAPTURE.COMPLETED",
            "resource": {
                "id": "CAPTUREWEBHOOK1",
                "status": "COMPLETED",
                "custom_id": created["order_number"],
                "amount": {"currency_code": "USD", "value": payment.provider_amount},
                "supplementary_data": {"related_ids": {"order_id": paypal["paypal_order_id"]}},
            },
        }
        headers = {
            "HTTP_PAYPAL_AUTH_ALGO": "SHA256withRSA",
            "HTTP_PAYPAL_CERT_URL": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT",
            "HTTP_PAYPAL_TRANSMISSION_ID": "tx-1",
            "HTTP_PAYPAL_TRANSMISSION_SIG": "sig",
            "HTTP_PAYPAL_TRANSMISSION_TIME": timezone.now().isoformat(),
        }
        self.fake.verify_ok = False
        rejected = self.client.post("/api/v1/payments/paypal/webhook/", event, content_type="application/json", **headers)
        self.assertEqual(rejected.status_code, 400)
        self.assertFalse(PayPalWebhookEvent.objects.exists())
        order = Order.objects.get(order_number=created["order_number"])
        self.assertEqual(order.payment_status, PaymentStatus.PENDING)

        self.fake.verify_ok = True
        accepted = self.client.post("/api/v1/payments/paypal/webhook/", event, content_type="application/json", **headers)
        self.assertEqual(accepted.status_code, 200, accepted.content)
        order.refresh_from_db()
        self.assertEqual(order.payment_status, PaymentStatus.PAID)
        duplicate = self.client.post("/api/v1/payments/paypal/webhook/", event, content_type="application/json", **headers)
        self.assertEqual(duplicate.status_code, 200)
        self.assertEqual(duplicate.json()["status"], "duplicate")
        self.assertEqual(order.items.first().codes.count(), 1)
        self.assertEqual(PayPalWebhookEvent.objects.filter(event_id="WH-EVENT-1", processed=True).count(), 1)

    def test_webhook_requires_configuration_and_paypal_cert(self):
        with override_settings(PAYPAL_WEBHOOK_ID=""):
            response = self.client.post(
                "/api/v1/payments/paypal/webhook/",
                {"id": "WH-2", "event_type": "PAYMENT.CAPTURE.COMPLETED", "resource": {}},
                content_type="application/json",
                HTTP_PAYPAL_AUTH_ALGO="SHA256withRSA",
                HTTP_PAYPAL_CERT_URL="https://api.sandbox.paypal.com/cert",
                HTTP_PAYPAL_TRANSMISSION_ID="tx",
                HTTP_PAYPAL_TRANSMISSION_SIG="sig",
                HTTP_PAYPAL_TRANSMISSION_TIME="time",
            )
        self.assertEqual(response.status_code, 503)
        bad_cert = self.client.post(
            "/api/v1/payments/paypal/webhook/",
            {"id": "WH-3", "event_type": "PAYMENT.CAPTURE.COMPLETED", "resource": {}},
            content_type="application/json",
            HTTP_PAYPAL_AUTH_ALGO="SHA256withRSA",
            HTTP_PAYPAL_CERT_URL="https://evil.example/cert",
            HTTP_PAYPAL_TRANSMISSION_ID="tx",
            HTTP_PAYPAL_TRANSMISSION_SIG="sig",
            HTTP_PAYPAL_TRANSMISSION_TIME="time",
        )
        self.assertEqual(bad_cert.status_code, 400)

    @override_settings(PAYPAL_CURRENCY="JOD", PAYPAL_FX_RATE="")
    def test_matching_currency_uses_order_fils(self):
        created = self._checkout(idempotency_key="paypal-jod").json()
        self.assertEqual(created["paypal_currency"], "JOD")
        self.assertEqual(created["paypal_amount"], "10.000")
        paypal = self._create_paypal(created)
        self.assertEqual(paypal.status_code, 200, paypal.content)
        self.assertEqual(self.fake.created[-1]["currency"], "JOD")
        self.assertEqual(self.fake.created[-1]["value"], "10.000")

    def test_admin_full_refund_is_idempotent_and_partial_needs_an_amount(self):
        admin = make_admin("paypal-admin@mmh.test", AdminRole.SUPER_ADMIN)
        client = auth_client(admin)
        created = self._checkout(idempotency_key="paypal-refund").json()
        paypal = self._create_paypal(created).json()
        capture = self.client.post(
            "/api/v1/payments/paypal/capture-order/",
            {"paypal_order_id": paypal["paypal_order_id"]},
            content_type="application/json",
        )
        self.assertEqual(capture.status_code, 200, capture.content)
        order = Order.objects.get(order_number=created["order_number"])
        missing = client.post(
            f"/api/v1/admin/orders/{order.id}/transition/",
            {"payment_status": "PARTIALLY_REFUNDED"},
            content_type="application/json",
        )
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(len(self.fake.refund_calls), 0)

        partial = client.post(
            f"/api/v1/admin/orders/{order.id}/transition/",
            {"payment_status": "PARTIALLY_REFUNDED", "refund_amount_fils": 5000},
            content_type="application/json",
        )
        self.assertEqual(partial.status_code, 200, partial.content)
        self.assertEqual(partial.json()["payment_status"], "PARTIALLY_REFUNDED")
        self.assertEqual(self.fake.refund_calls[0]["value"], "7.05")
        order.refresh_from_db()
        self.assertEqual(order.payments.get().status, PaymentStatus.PARTIALLY_REFUNDED)

        full = client.post(
            f"/api/v1/admin/orders/{order.id}/transition/",
            {"payment_status": "REFUNDED"},
            content_type="application/json",
        )
        self.assertEqual(full.status_code, 200, full.content)
        order.refresh_from_db()
        self.assertEqual(order.payment_status, PaymentStatus.REFUNDED)
        self.assertEqual(len(self.fake.refund_calls), 2)
        again = client.post(
            f"/api/v1/admin/orders/{order.id}/transition/",
            {"payment_status": "REFUNDED"},
            content_type="application/json",
        )
        self.assertEqual(again.status_code, 200, again.content)
        self.assertEqual(len(self.fake.refund_calls), 2)


class PayPalSandboxIntegrationTests(TestCase):
    def setUp(self):
        if os.getenv("PAYPAL_SANDBOX_INTEGRATION") != "1":
            self.skipTest("Set PAYPAL_SANDBOX_INTEGRATION=1 to call the PayPal sandbox")
        if not settings.PAYPAL_CLIENT_ID or not settings.PAYPAL_CLIENT_SECRET:
            self.skipTest("PayPal sandbox credentials are not configured")
        cat = Category.objects.create(slug="live-cards", name_en="Cards", status=PublishStatus.PUBLISHED)
        plat = Platform.objects.create(slug="live-steam", name_en="Steam", status=PublishStatus.PUBLISHED)
        region = Region.objects.create(slug="jo", name_en="Jordan", currency="JOD")
        product = Product.objects.create(
            id="paypal-live-card",
            slug="paypal-live-card",
            kind=ProductKind.GIFT_CARD,
            fulfillment_type=FulfillmentType.CODE,
            category=cat,
            platform=plat,
            brand="MMH",
            artwork_key="card",
            status=PublishStatus.PUBLISHED,
            name_en="Sandbox Card",
        )
        self.variant = ProductVariant.objects.create(
            product=product,
            region=region,
            sku="SANDBOX-10",
            denomination="10",
            package_value="10",
            package_currency="JOD",
            price_fils=10000,
            stock_status=StockStatus.IN_STOCK,
            published=True,
            name_en="10",
            external_id="10",
        )
        self.product = product

    def test_sandbox_order_amount_matches_and_unapproved_capture_stays_unpaid(self):
        created = self.client.post(
            "/api/v1/checkout/orders/",
            {
                "email": "sandbox-buyer@example.com",
                "full_name": "Sandbox Buyer",
                "phone": "+962790000001",
                "idempotency_key": f"sandbox-{timezone.now().timestamp()}",
                "region_confirmed": True,
                "refund_confirmed": True,
                "payment_provider": "paypal",
                "items": [{"product_id": self.product.id, "variant_id": self.variant.id, "quantity": 1}],
            },
            content_type="application/json",
        )
        self.assertEqual(created.status_code, 201, created.content)
        order_body = created.json()
        self.assertEqual(order_body["payment_status"], "PENDING")
        self.assertNotIn(settings.PAYPAL_CLIENT_SECRET, created.content.decode())
        paypal = self.client.post(
            "/api/v1/payments/paypal/create-order/",
            {
                "order_number": order_body["order_number"],
                "checkout_token": order_body["checkout_token"],
            },
            content_type="application/json",
        )
        self.assertEqual(paypal.status_code, 200, paypal.content)
        paypal_order_id = paypal.json()["paypal_order_id"]
        from commerce.services.paypal import get_client

        remote = get_client().get_order(paypal_order_id)
        amount = remote["purchase_units"][0]["amount"]
        payment = Payment.objects.get(provider_order_id=paypal_order_id)
        self.assertEqual(amount["currency_code"], payment.currency)
        self.assertEqual(Decimal(amount["value"]), Decimal(payment.provider_amount))
        self.assertEqual(remote["purchase_units"][0]["custom_id"], order_body["order_number"])
        capture = self.client.post(
            "/api/v1/payments/paypal/capture-order/",
            {"paypal_order_id": paypal_order_id},
            content_type="application/json",
        )
        self.assertEqual(capture.status_code, 409)
        self.assertEqual(capture.json()["code"], "not_approved")
        order = Order.objects.get(order_number=order_body["order_number"])
        self.assertEqual(order.payment_status, PaymentStatus.PENDING)
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.NOT_STARTED)
