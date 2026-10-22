from __future__ import annotations

from django.test import TestCase, override_settings

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
from commerce.models import Coupon, FulfillmentStatus, Order, Payment, PaymentStatus
from commerce.services.checkout import create_storefront_order
from commerce.services.payment import PaymentError, apply_demo_auto_payment, mark_payment_verified


class ProductionSafetyTests(TestCase):
    def setUp(self):
        cat = Category.objects.create(slug="c", name_en="C", status=PublishStatus.PUBLISHED)
        plat = Platform.objects.create(slug="p", name_en="P", status=PublishStatus.PUBLISHED)
        region = Region.objects.create(slug="us", name_en="US", currency="USD")
        self.product = Product.objects.create(
            id="prod-safe",
            slug="prod-safe",
            kind=ProductKind.GIFT_CARD,
            fulfillment_type=FulfillmentType.CODE,
            category=cat,
            platform=plat,
            brand="B",
            artwork_key="a",
            status=PublishStatus.PUBLISHED,
            name_en="Safe Product",
        )
        self.variant = ProductVariant.objects.create(
            product=self.product,
            region=region,
            sku="SAFE-1",
            denomination="10",
            package_value="10",
            package_currency="USD",
            price_fils=10000,
            stock_status=StockStatus.IN_STOCK,
            published=True,
            name_en="10",
            external_id="10",
        )
        # Non-demo checkout requires inventory for CODE products.
        from commerce.crypto import encrypt_code, fingerprint_code
        from commerce.models import DigitalCode, DigitalCodeStatus

        for value in ("SAFE-STOCK-0001", "SAFE-STOCK-0002"):
            ct, nonce, masked = encrypt_code(value)
            DigitalCode.objects.create(
                variant=self.variant,
                status=DigitalCodeStatus.AVAILABLE,
                code_fingerprint=fingerprint_code(value),
                ciphertext=ct,
                nonce=nonce,
                masked=masked,
            )

    def _order_payload(self, coupon=None):
        data = {
            "email": "buyer@example.com",
            "full_name": "Buyer",
            "region_confirmed": True,
            "refund_confirmed": True,
            "items": [{"product_id": self.product.id, "variant_id": self.variant.id, "quantity": 1}],
        }
        if coupon:
            data["coupon_code"] = coupon
        return data

    @override_settings(ALLOW_DEMO_AUTO_PAYMENT=True, IS_PRODUCTION=False)
    def test_demo_auto_pay_fulfills(self):
        order = create_storefront_order(data=self._order_payload())
        self.assertEqual(order.payment_status, PaymentStatus.PAID)
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.COMPLETED)

    @override_settings(ALLOW_DEMO_AUTO_PAYMENT=False, IS_PRODUCTION=False)
    def test_without_demo_leaves_pending_no_codes(self):
        order = create_storefront_order(data=self._order_payload())
        self.assertEqual(order.payment_status, PaymentStatus.PENDING)
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.NOT_STARTED)
        self.assertFalse(order.items.first().codes.exists())
        payment = Payment.objects.get(order=order)
        self.assertEqual(payment.status, PaymentStatus.PENDING)

    @override_settings(ALLOW_DEMO_AUTO_PAYMENT=False, IS_PRODUCTION=False)
    def test_coupon_not_consumed_until_paid(self):
        coupon = Coupon.objects.create(code="SAVE", active=True, percent_off="10.00", max_uses=5, used_count=0)
        order = create_storefront_order(data=self._order_payload(coupon="SAVE"))
        coupon.refresh_from_db()
        self.assertEqual(coupon.used_count, 0)
        payment = order.payments.get()
        mark_payment_verified(payment, external_ref="psp-1")
        coupon.refresh_from_db()
        self.assertEqual(coupon.used_count, 1)
        order.refresh_from_db()
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.COMPLETED)
        self.assertEqual(order.items.first().codes.count(), 1)
        # Idempotent replay
        mark_payment_verified(payment, external_ref="psp-1")
        coupon.refresh_from_db()
        self.assertEqual(coupon.used_count, 1)

    @override_settings(ALLOW_DEMO_AUTO_PAYMENT=False, IS_PRODUCTION=True)
    def test_demo_auto_pay_refused_when_production_flag(self):
        order = Order.objects.create(
            order_number="X1",
            email="a@b.com",
            full_name="A",
            total_fils=1000,
            payment_status=PaymentStatus.PENDING,
            fulfillment_status=FulfillmentStatus.NOT_STARTED,
        )
        with self.assertRaises(PaymentError):
            apply_demo_auto_payment(order)

    def test_health_endpoints(self):
        self.assertEqual(self.client.get("/health/").status_code, 200)
        self.assertEqual(self.client.get("/api/health/").json()["status"], "ok")
        ready = self.client.get("/api/ready/")
        self.assertEqual(ready.status_code, 200)
        self.assertEqual(ready.json()["database"], "ok")
