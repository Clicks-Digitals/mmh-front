"""Final verification-pass fixes: e-mail link access to account orders, refund wording,
free-order e-mails, partial e-mail grammar, checkout phone digits, dashboard stock rule,
UTF-8 safe console e-mails."""

from __future__ import annotations

import io
from unittest.mock import patch

from django.core import mail
from django.core.mail import EmailMessage
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import User, UserKind
from accounts.tests_admin import auth_client
from catalog.models import StockStatus
from commerce.models import Coupon, Order
from commerce.notifications import partial_progress_kwargs
from commerce.services.checkout import create_storefront_order
from commerce.services.payment import mark_payment_verified
from commerce.tests_delivery import BASE_SETTINGS
from commerce.tests_fixes import PAYPAL_LIVE_STOCK, FixFixture
from commerce.tests_paypal import FakePayPal
from config.mail import EmailBackend as SafeConsoleBackend

PASSWORD = "Xy7!pass-word"


@override_settings(**BASE_SETTINGS)
class AccountOrderTokenAccessTests(FixFixture, TestCase):
    """The e-mailed /order/<n>?token=… link works for account orders while signed out."""

    def setUp(self):
        super().setUp()
        self.customer = User.objects.create_user(email="acct@example.com", password=PASSWORD, kind=UserKind.CUSTOMER)

    def account_order(self, *, paid: bool):
        self.add_codes(self.v10, 1)
        order = create_storefront_order(data=self.order_data(email="acct@example.com"), user=self.customer)
        if paid:
            mark_payment_verified(order.payments.get(), external_ref="psp-final")
            order.refresh_from_db()
        return order

    def test_detail_with_token_or_access_token_signed_out(self):
        order = self.account_order(paid=True)
        url = f"/api/v1/orders/{order.order_number}/"
        for param in ("token", "access_token"):
            res = APIClient().get(url, {param: order.access_token})
            self.assertEqual(res.status_code, 200, (param, res.content))
            self.assertEqual(res.json()["order_number"], order.order_number)
        self.assertEqual(APIClient().get(url, {"token": "x" * len(order.access_token)}).status_code, 404)
        self.assertEqual(APIClient().get(url).status_code, 404)

    def test_email_only_lookup_stays_guest_only(self):
        order = self.account_order(paid=True)
        res = APIClient().get(f"/api/v1/orders/{order.order_number}/", {"email": "acct@example.com"})
        self.assertEqual(res.status_code, 404)
        self.add_codes(self.v10, 1)
        guest = self.paid_order(email="guest@example.com")
        res = APIClient().get(f"/api/v1/orders/{guest.order_number}/", {"email": "guest@example.com"})
        self.assertEqual(res.status_code, 200)

    def test_other_signed_in_customer_with_token_can_open_it(self):
        order = self.account_order(paid=True)
        stranger = User.objects.create_user(email="other@example.com", password=PASSWORD, kind=UserKind.CUSTOMER)
        client = auth_client(stranger)
        self.assertEqual(client.get(f"/api/v1/orders/{order.order_number}/").status_code, 404)
        res = client.get(f"/api/v1/orders/{order.order_number}/", {"token": order.access_token})
        self.assertEqual(res.status_code, 200)

    def test_codes_reveal_with_access_token_signed_out(self):
        order = self.account_order(paid=True)
        url = f"/api/v1/orders/{order.order_number}/codes/"
        self.assertEqual(APIClient().post(url, {}, format="json").status_code, 404)
        res = APIClient().post(url, {"access_token": order.access_token}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.json()["items"][0]["codes"])

    def test_cancel_with_access_token_signed_out(self):
        order = self.account_order(paid=False)
        url = f"/api/v1/orders/{order.order_number}/cancel/"
        self.assertEqual(APIClient().post(url, {"access_token": "nope"}, format="json").status_code, 404)
        res = APIClient().post(url, {"access_token": order.access_token}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["status"], "cancelled")


@override_settings(**PAYPAL_LIVE_STOCK)
class AccountOrderPayPalTokenTests(FixFixture, TestCase):
    def setUp(self):
        super().setUp()
        patcher = patch("commerce.services.paypal.get_client", return_value=FakePayPal())
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_complete_payment_for_account_order_with_token(self):
        customer = User.objects.create_user(email="pp@example.com", password=PASSWORD, kind=UserKind.CUSTOMER)
        stranger = User.objects.create_user(email="pp2@example.com", password=PASSWORD, kind=UserKind.CUSTOMER)
        self.add_codes(self.v10, 1)
        res = auth_client(customer).post(
            "/api/v1/checkout/orders/",
            self.order_data(email="pp@example.com", payment_provider="paypal"),
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        number, token = res.json()["order_number"], res.json()["access_token"]
        url = "/api/v1/payments/paypal/create-order/"
        self.assertEqual(
            auth_client(stranger).post(url, {"order_number": number}, format="json").status_code, 403
        )
        signed_out = APIClient().post(url, {"order_number": number, "access_token": token}, format="json")
        self.assertEqual(signed_out.status_code, 200, signed_out.content)
        other_session = auth_client(stranger).post(url, {"order_number": number, "access_token": token}, format="json")
        self.assertEqual(other_session.status_code, 200, other_session.content)


@override_settings(**BASE_SETTINGS)
class RefundActionWordingTests(FixFixture, TestCase):
    def test_fully_refunded_order_says_nothing_left_to_refund(self):
        self.add_codes(self.v10, 1)
        order = self.paid_order()
        client = self.admin_client()
        before = client.get(f"/api/v1/admin/orders/{order.id}/").json()["actions"]["refund"]
        self.assertTrue(before["enabled"])
        res = client.post(f"/api/v1/admin/orders/{order.id}/refunds/", {"manual": True, "reason": "test"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        refund = res.json()["actions"]["refund"]
        self.assertFalse(refund["enabled"])
        self.assertEqual(refund["disabled_reason"], "Nothing left to refund")
        self.assertEqual(Order.objects.get(pk=order.pk).payment_status, "REFUNDED")

    def test_unpaid_order_keeps_paid_only_reason(self):
        self.add_codes(self.v10, 1)
        order = create_storefront_order(data=self.order_data())
        refund = self.admin_client().get(f"/api/v1/admin/orders/{order.id}/").json()["actions"]["refund"]
        self.assertEqual(refund["disabled_reason"], "Only paid orders can be refunded.")


@override_settings(**BASE_SETTINGS)
class FreeOrderEmailTests(FixFixture, TestCase):
    def place_free(self, locale: str):
        Coupon.objects.get_or_create(code="ALLFREE", defaults={"percent_off": "100"})
        self.add_codes(self.v10, 1)
        mail.outbox = []
        with self.captureOnCommitCallbacks(execute=True):
            res = APIClient().post(
                "/api/v1/checkout/orders/", self.order_data(coupon_code="ALLFREE", locale=locale), format="json"
            )
        self.assertEqual(res.status_code, 201, res.content)
        return res.json()

    def test_english_free_order_email(self):
        order = self.place_free("en")
        confirmed = next(m for m in mail.outbox if "free order is confirmed" in m.subject)
        self.assertIn(order["order_number"], confirmed.subject)
        self.assertNotIn("payment received", confirmed.subject.lower())
        self.assertIn("Your free order", confirmed.body)
        self.assertNotIn("received your payment", confirmed.body)
        self.assertIn("free order is confirmed", confirmed.alternatives[0][0])

    def test_arabic_free_order_email(self):
        self.place_free("ar")
        confirmed = next(m for m in mail.outbox if "طلبك المجاني" in m.subject)
        self.assertNotIn("تم استلام الدفع", confirmed.subject)
        self.assertIn("طلبك المجاني", confirmed.body)
        self.assertNotIn("استلمنا دفعتك", confirmed.body)


class PartialEmailGrammarTests(SimpleTestCase):
    def test_english_verb_agreement(self):
        one = partial_progress_kwargs(1, 2)
        self.assertEqual("{ready} of your {total} codes {verb} ready".format(**one), "1 of your 2 codes is ready")
        two = partial_progress_kwargs(2, 3)
        self.assertEqual("{ready} of your {total} codes {verb} ready".format(**two), "2 of your 3 codes are ready")

    def test_arabic_number_agreement(self):
        self.assertEqual(partial_progress_kwargs(1, 2)["ready_phrase"], "كود واحد")
        self.assertEqual(partial_progress_kwargs(1, 2)["total_phrase"], "كودين")
        self.assertEqual(partial_progress_kwargs(2, 3)["ready_phrase"], "كودان")
        self.assertEqual(partial_progress_kwargs(2, 3)["total_phrase"], "3 أكواد")
        self.assertEqual(partial_progress_kwargs(5, 12)["total_phrase"], "12 كوداً")


@override_settings(**BASE_SETTINGS)
class PartialEmailTests(FixFixture, TestCase):
    def test_partial_email_subject_grammar_en_and_ar(self):
        for locale, fragment in (("en", "1 of your 2 codes is ready"), ("ar", "جاهز الآن كود واحد من أصل كودين")):
            codes = self.add_codes(self.v10, 2)
            order = create_storefront_order(
                data=self.order_data(
                    [{"product_id": self.gift.id, "variant_id": self.v10.id, "quantity": 2}],
                    email=f"{locale}-partial@example.com",
                    locale=locale,
                )
            )
            codes[1].delete()
            mail.outbox = []
            with self.captureOnCommitCallbacks(execute=True):
                mark_payment_verified(order.payments.get(), external_ref=f"psp-{locale}")
            self.assertTrue(any(fragment in m.subject for m in mail.outbox), [m.subject for m in mail.outbox])


@override_settings(**BASE_SETTINGS)
class CheckoutPhoneDigitsTests(FixFixture, TestCase):
    def test_arabic_indic_and_persian_digits_in_phone(self):
        self.add_codes(self.v10, 2)
        res = APIClient().post(
            "/api/v1/checkout/orders/", self.order_data(phone="٠٧٩١٢٣٤٥٦٧"), format="json"
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(Order.objects.get(order_number=res.json()["order_number"]).phone, "0791234567")
        res = APIClient().post(
            "/api/v1/checkout/orders/",
            self.order_data(email="p2@example.com", phone="+۹۶۲ ۷۹۱ ۲۳۴ ۵۶۸"),
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(Order.objects.get(order_number=res.json()["order_number"]).phone, "+962791234568")

    def test_invalid_phone_rejected(self):
        res = APIClient().post("/api/v1/checkout/orders/", self.order_data(phone="call me"), format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("phone", str(res.json()))


@override_settings(**BASE_SETTINGS)
class DashboardStockRuleTests(FixFixture, TestCase):
    def test_out_of_stock_matches_inventory(self):
        self.add_codes(self.v10, 30)
        # Flagged out of stock but unpublished: the inventory rule ignores it.
        self.v_hidden.stock_status = StockStatus.OUT_OF_STOCK
        self.v_hidden.save(update_fields=["stock_status"])
        client = self.admin_client()
        dash = client.get("/api/v1/admin/dashboard/").json()
        inv = client.get("/api/v1/admin/inventory/").json()["stats"]
        self.assertEqual(dash["out_of_stock_variants"], inv["effective_out_of_stock"])
        self.assertGreaterEqual(dash["out_of_stock_variants"], 1)  # v20 has no codes


class SafeConsoleEmailTests(SimpleTestCase):
    def test_arabic_mail_on_legacy_code_page_console(self):
        raw = io.BytesIO()
        stream = io.TextIOWrapper(raw, encoding="cp1252")
        backend = SafeConsoleBackend(stream=stream)
        sent = backend.send_messages([EmailMessage("الطلب ١٢٣: تم تأكيد طلبك", "مرحباً", "a@x.test", ["b@x.test"])])
        stream.flush()
        self.assertEqual(sent, 1)
        self.assertTrue(raw.getvalue())

    def test_ascii_stream_without_buffer_uses_escapes(self):
        class Plain(io.StringIO):
            encoding = "ascii"

            def write(self, text):
                text.encode("ascii")
                return super().write(text)

        out = Plain()
        backend = SafeConsoleBackend(stream=out)
        backend.stream.write("مرحباً")
        self.assertIn("\\u", out.getvalue())
