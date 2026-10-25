"""Fixes from the 1Epin verification pass (dashboard count, alerts, staff actions, wording...)."""

from __future__ import annotations

from django.test import override_settings

from accounts.tests_admin import auth_client
from audit.models import AuditLog
from catalog.stock import mapping_stock_reason
from commerce.models import DigitalCode, DigitalCodeStatus, FulfillmentStatus, Order, OrderItem, PaymentStatus
from suppliers.models import SupplierAlert, SupplierApiLog, SupplierCatalogItem, SupplierOrder, SupplierStatus
from suppliers.provider import ensure_supplier, override_transport, readable_order_status
from suppliers.services.catalog import sync_catalog
from suppliers.services.fulfillment import TOPUP_NOTE, TOPUP_NOTE_AR, needs_review_order_count
from suppliers.tests_oneepin import (
    DOC_ADD_ORDER_OK,
    DOC_CHECK_COMPLETED,
    DOC_CHECK_FAILED,
    DOC_CHECK_WAITING,
    DOC_PINS,
    FakeTransport,
    OneEpinBase,
)


class NeedsReviewCountTests(OneEpinBase):
    def _so(self, order, attempt=1, status=SupplierStatus.MANUAL_REVIEW, item=None):
        item = item or order.items.first()
        return SupplierOrder.objects.create(
            supplier=self.supplier, order=order, order_item_id=item.id, attempt=attempt,
            supplier_ref=f"MMH-{order.order_number}-{item.id}-{attempt}", status=status,
        )

    def test_counts_distinct_orders_that_still_need_action(self):
        a = self.paid_order()
        second = OrderItem.objects.create(
            order=a, product=self.uc28.product, variant=self.uc28, quantity=1, unit_price_fils=5000,
            line_total_fils=5000, product_name="PUBG", variant_name="28 UC",
        )
        self._so(a)
        self._so(a, item=second, status=SupplierStatus.FAILED)  # same order: counted once
        b = self.paid_order()
        self._so(b, status=SupplierStatus.FAILED)
        replaced = self.paid_order()  # a later attempt took over
        self._so(replaced, 1, SupplierStatus.FAILED)
        self._so(replaced, 2, SupplierStatus.PROCESSING)
        done = self.paid_order(status=FulfillmentStatus.COMPLETED)
        self._so(done)
        refunded = self.paid_order()
        Order.objects.filter(pk=refunded.pk).update(payment_status=PaymentStatus.REFUNDED)
        self._so(refunded)
        cancelled = self.paid_order()
        Order.objects.filter(pk=cancelled.pk).update(fulfillment_status=FulfillmentStatus.CANCELLED)
        self._so(cancelled)

        self.assertEqual(needs_review_order_count(), 2)
        dash = auth_client(self.admin).get("/api/v1/admin/dashboard/").data
        self.assertEqual(dash["oneepin"]["manual_review_orders"], 2)
        status = auth_client(self.admin).get("/api/v1/admin/1epin/status/").data
        self.assertEqual(status["orders_manual_review"], 2)
        rows = auth_client(self.admin).get("/api/v1/admin/1epin/orders/?needs_review=1").data["results"]
        self.assertEqual({r["order_number"] for r in rows}, {a.order_number, b.order_number})
        # The replaced attempt is shown as history in lists, not as "needs review".
        rows = auth_client(self.admin).get(f"/api/v1/admin/1epin/orders/?order={replaced.order_number}").data["results"]
        first = next(r for r in rows if r["attempt"] == 1)
        self.assertEqual(first["status_label"], "Replaced by attempt 2")
        self.assertTrue(first["superseded"])


class PingAndStockModeTests(OneEpinBase):
    def test_mock_test_connection_is_ok(self):
        with override_settings(SUPPLIER_MODE="mock", ONEEPIN_EMAIL="", ONEEPIN_PASSWORD="", ONEEPIN_MOCK_FULFILLMENT=True):
            res = auth_client(self.admin).post("/api/v1/admin/1epin/ping/")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertTrue(res.data["ok"])
        self.assertEqual(res.data["message"], "Simulator — no real 1Epin connection")

    def test_mock_mapping_counts_as_stock_in_development_only(self):
        mock = dict(SUPPLIER_MODE="mock", ONEEPIN_MOCK_FULFILLMENT=True, ONEEPIN_TEST_COUNTS_AS_STOCK=False)
        with override_settings(**mock, IS_DEVELOPMENT=True):
            self.supplier = ensure_supplier()
            sync_catalog()
            item = SupplierCatalogItem.objects.get(environment="MOCK", external_product_id="101")
            mapping = self.mapping(item=item)
            self.assertIsNone(mapping_stock_reason(mapping))
            variant = self.client.get(f"/api/v1/catalog/products/{self.pubg.slug}/").json()["variants"][0]
            self.assertEqual(variant["stock_status"], "IN_STOCK")
        with override_settings(**mock, IS_DEVELOPMENT=False):
            self.assertEqual(mapping_stock_reason(mapping), "live_disabled")
        # Test mode keeps its own switch.
        self.assertEqual(mapping_stock_reason(mapping), "live_disabled")


class CostLimitAndAlertTests(OneEpinBase):
    def test_cost_limit_parks_topup_order_in_manual_review(self):
        item = self.catalog_item("301", kind="topup", price="1.40")
        self.mapping(self.dia, item, max_cost_fils=100, user_template="{userId}({zoneId})")
        order = self.topup_order()
        fake = FakeTransport()
        self.run_supplier(order, fake)
        self.assertEqual(fake.calls, [])
        order.refresh_from_db()
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.MANUAL_REVIEW)
        so = SupplierOrder.objects.get()
        self.assertEqual((so.status, so.message), (SupplierStatus.MANUAL_REVIEW, "1Epin cost above your limit"))
        alerts = auth_client(self.admin).get("/api/v1/admin/1epin/alerts/").data["results"]
        self.assertEqual([(a["kind"], a["kind_label"]) for a in alerts], [("cost_limit", "Cost above limit")])
        payload = auth_client(self.admin).get(f"/api/v1/admin/orders/{order.order_number}/").data
        self.assertEqual(payload["items"][0]["review_reason"], "1Epin cost above your limit")

    def test_check_now_on_failed_order_does_not_bump_the_alert(self):
        self.mapping(self.dia, self.catalog_item("301", kind="topup", price="1.40"))
        order = self.topup_order()
        self.run_supplier(order, FakeTransport(addOrder=DOC_ADD_ORDER_OK, checkOrder=DOC_CHECK_FAILED))
        alert = SupplierAlert.objects.get(kind="order_failed")
        self.assertEqual(alert.occurrences, 1)
        item_id = order.items.get().id
        for _ in range(2):
            with override_transport(FakeTransport(checkOrder=DOC_CHECK_FAILED)):
                res = auth_client(self.admin).post(f"/api/v1/admin/orders/{order.order_number}/items/{item_id}/supplier/check/")
            self.assertEqual(res.status_code, 200, res.content)
        alert.refresh_from_db()
        self.assertEqual(alert.occurrences, 1)
        self.assertEqual(AuditLog.objects.filter(action="suppliers.order_failed").count(), 1)

    def test_order_alert_resolves_when_staff_deliver_the_item(self):
        self.mapping(max_cost_fils=1000)  # cost 4.254 JOD -> parked, cost_limit alert
        order = self.paid_order()
        self.run_supplier(order, FakeTransport())
        self.assertTrue(SupplierAlert.objects.filter(kind="cost_limit", resolved=False).exists())
        item_id = order.items.get().id
        res = auth_client(self.admin).post(
            f"/api/v1/admin/orders/{order.order_number}/items/{item_id}/codes/", {"code": "STAFF-CODE-0001"}, format="json"
        )
        self.assertEqual(res.status_code, 201, res.content)
        alert = SupplierAlert.objects.get(kind="cost_limit")
        self.assertTrue(alert.resolved)
        self.assertEqual(alert.resolution_note, "Item delivered")
        # Delivered: nothing to review any more.
        self.assertEqual(needs_review_order_count(), 0)


class ReadableReasonsAndLogsTests(OneEpinBase):
    def test_failed_order_reason_is_readable_and_raw_code_kept(self):
        self.assertEqual(readable_order_status("wrong_player_id"), "Wrong player ID - 1Epin could not find this game account")
        self.assertEqual(readable_order_status("some_new_reason"), "Some new reason")
        self.mapping(self.dia, self.catalog_item("301", kind="topup", price="1.40"))
        order = self.topup_order()
        self.run_supplier(order, FakeTransport(addOrder=DOC_ADD_ORDER_OK, checkOrder=DOC_CHECK_FAILED))
        block = auth_client(self.admin).get(f"/api/v1/admin/orders/{order.order_number}/").data["items"][0]["supplier_order"]
        self.assertIn("Wrong player ID", block["message"])
        self.assertEqual(block["raw_reason"], "wrong_player_id")
        self.assertEqual(block["player_user"], "12345")
        logs = auth_client(self.admin).get("/api/v1/admin/1epin/logs/").data
        messages = {row["action"]: row["message"] for row in logs}
        self.assertEqual(messages["checkOrder"], "Order failed: Wrong player ID - 1Epin could not find this game account")
        self.assertEqual(messages["addOrder"], "Order accepted by 1Epin")
        self.assertTrue(SupplierApiLog.objects.filter(action="checkOrder", ok=True).exists())

    def test_mapping_payload_has_product_slug(self):
        mapping = self.mapping()
        res = auth_client(self.admin).get(f"/api/v1/admin/1epin/mappings/{mapping.id}/")
        self.assertEqual(res.data["product_slug"], self.pubg.slug)


class CustomerFieldsEditTests(OneEpinBase):
    def test_staff_correct_player_id_then_retry_sends_it(self):
        self.mapping(self.dia, self.catalog_item("301", kind="topup", price="1.40"), user_template="{userId}({zoneId})")
        order = self.topup_order()
        self.run_supplier(order, FakeTransport(addOrder=DOC_ADD_ORDER_OK, checkOrder=DOC_CHECK_FAILED))
        item = order.items.get()
        url = f"/api/v1/admin/orders/{order.order_number}/items/{item.id}/customer-fields/"
        client = auth_client(self.admin)
        self.assertEqual(client.patch(url, {"fields": {"nope": "1"}}, format="json").status_code, 400)
        res = client.patch(url, {"fields": {"zoneId": ""}}, format="json")
        self.assertEqual((res.status_code, res.data["field"]), (400, "zoneId"))
        res = client.patch(url, {"fields": {"userId": "99999"}}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["items"][0]["supplier_order"]["player_user"], "99999(678)")
        item.refresh_from_db()
        self.assertEqual(item.customer_fields, {"userId": "99999", "zoneId": "678"})
        self.assertEqual({d["key"]: d["value"] for d in item.field_details}, {"userId": "99999", "zoneId": "678"})
        audit = AuditLog.objects.get(action="orders.customer_fields_changed")
        self.assertEqual(audit.meta["changes"], {"userId": {"from": "12345", "to": "99999"}})
        fake = FakeTransport(addOrder=DOC_ADD_ORDER_OK, checkOrder=dict(DOC_CHECK_COMPLETED, PinCodes=[]))
        with override_transport(fake):
            res = client.post(url.replace("customer-fields/", "supplier/retry/"), {"confirm": True}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(fake.bodies("addOrder")[0]["user"], "99999(678)")
        # Delivered: details are locked.
        self.assertEqual(client.patch(url, {"fields": {"userId": "1"}}, format="json").status_code, 409)

    def test_viewer_cannot_edit(self):
        order = self.topup_order()
        item = order.items.get()
        res = auth_client(self.viewer).patch(
            f"/api/v1/admin/orders/{order.order_number}/items/{item.id}/customer-fields/", {"fields": {"userId": "1"}}, format="json"
        )
        self.assertEqual(res.status_code, 403)


class InFlightStaffActionTests(OneEpinBase):
    def test_stock_actions_wait_for_an_open_1epin_purchase(self):
        self.mapping()
        order = self.paid_order()
        self.run_supplier(order, FakeTransport(addOrder=DOC_ADD_ORDER_OK, checkOrder=DOC_CHECK_WAITING))
        self.assertEqual(SupplierOrder.objects.get().status, SupplierStatus.PROCESSING)
        self.add_local_code(self.uc28, "LOCAL-CODE-0001")
        client = auth_client(self.admin)
        payload = client.get(f"/api/v1/admin/orders/{order.order_number}/").data
        reason = "A 1Epin purchase is in progress — check it first"
        self.assertEqual(payload["items"][0]["staff_actions"]["attach"], {"enabled": False, "disabled_reason": reason})
        self.assertEqual(payload["actions"]["deliver_from_stock"]["disabled_reason"], reason)
        res = client.post(f"/api/v1/admin/orders/{order.order_number}/fulfill/")
        self.assertEqual((res.status_code, res.data["code"]), (409, "supplier_in_flight"))
        item_id = order.items.get().id
        res = client.post(f"/api/v1/admin/orders/{order.order_number}/items/{item_id}/codes/", {"code": "X-1"}, format="json")
        self.assertEqual((res.status_code, res.data["code"]), (409, "supplier_in_flight"))
        self.assertEqual(DigitalCode.objects.filter(order_item__order=order).count(), 0)


class OutOfStockAfterPaymentTests(OneEpinBase):
    def _order_then_sell_out(self):
        from commerce.services.checkout import create_storefront_order

        code = self.add_local_code(self.uc28, "LAST-CODE-0001")
        order = create_storefront_order(
            data={
                "email": "buyer@example.com", "full_name": "Buyer", "region_confirmed": True, "refund_confirmed": True,
                "items": [{"product_id": self.pubg.id, "variant_id": self.uc28.id, "quantity": 1}],
            }
        )
        # Stock vanishes between PayPal create-order and capture.
        DigitalCode.objects.filter(pk=code.pk).update(status=DigitalCodeStatus.UNAVAILABLE)
        return order

    def test_unmapped_item_goes_to_manual_review_with_reason_and_one_alert(self):
        from commerce.services.payment import mark_payment_verified

        order = self._order_then_sell_out()
        with self.captureOnCommitCallbacks(execute=True):
            mark_payment_verified(order.payments.get(), external_ref="psp-1")
        order.refresh_from_db()
        self.assertEqual((order.payment_status, order.fulfillment_status), (PaymentStatus.PAID, FulfillmentStatus.MANUAL_REVIEW))
        alert = SupplierAlert.objects.get(kind="out_of_stock")
        self.assertIn("Out of stock after payment — deliver manually or refund", alert.message)
        self.assertIn("PUBG Mobile UC", alert.message)
        self.assertTrue(AuditLog.objects.filter(action="orders.out_of_stock_after_payment").exists())
        payload = auth_client(self.admin).get(f"/api/v1/admin/orders/{order.order_number}/").data
        self.assertEqual(payload["items"][0]["review_reason"], "Out of stock after payment — deliver manually or refund")
        # Replayed capture / webhook: no second alert.
        with self.captureOnCommitCallbacks(execute=True):
            mark_payment_verified(order.payments.get(), external_ref="psp-1")
        alert.refresh_from_db()
        self.assertEqual((SupplierAlert.objects.filter(kind="out_of_stock").count(), alert.occurrences), (1, 1))
        # Staff deliver by hand -> the alert closes.
        item_id = order.items.get().id
        res = auth_client(self.admin).post(
            f"/api/v1/admin/orders/{order.order_number}/items/{item_id}/codes/", {"code": "HAND-CODE-0001"}, format="json"
        )
        self.assertEqual(res.status_code, 201, res.content)
        alert.refresh_from_db()
        self.assertTrue(alert.resolved)

    def test_mapped_item_is_bought_from_1epin_instead(self):
        from commerce.services.payment import mark_payment_verified

        self.mapping()
        order = self._order_then_sell_out()
        fake = FakeTransport(addOrder=DOC_ADD_ORDER_OK, checkOrder=dict(DOC_CHECK_COMPLETED, PinCodes=DOC_PINS[:1]))
        with override_transport(fake), self.captureOnCommitCallbacks(execute=True):
            mark_payment_verified(order.payments.get(), external_ref="psp-2")
        order.refresh_from_db()
        self.assertEqual(order.fulfillment_status, FulfillmentStatus.COMPLETED)
        self.assertFalse(SupplierAlert.objects.filter(kind="out_of_stock").exists())
        self.assertEqual(fake.methods()[0], "addOrder")


class TopupWordingTests(OneEpinBase):
    def test_topup_note_never_names_the_supplier_and_follows_the_order_language(self):
        from commerce.views import customer_delivery_note

        self.mapping(self.dia, self.catalog_item("301", kind="topup", price="1.40"))
        order = self.topup_order()
        Order.objects.filter(pk=order.pk).update(locale="ar")
        self.run_supplier(order, FakeTransport(addOrder=DOC_ADD_ORDER_OK, checkOrder=dict(DOC_CHECK_COMPLETED, PinCodes=[])))
        item = order.items.get()
        self.assertEqual(item.delivery_note, TOPUP_NOTE_AR)
        # A legacy automatic note is shown neutrally (page + e-mail).
        OrderItem.objects.filter(pk=item.pk).update(delivery_note="Delivered via 1Epin")
        item = OrderItem.objects.select_related("order").get(pk=item.pk)
        self.assertEqual(customer_delivery_note(item), TOPUP_NOTE_AR)
        Order.objects.filter(pk=order.pk).update(locale="en")
        item = OrderItem.objects.select_related("order").get(pk=item.pk)
        self.assertEqual(customer_delivery_note(item), TOPUP_NOTE)
        self.assertNotIn("1epin", TOPUP_NOTE.lower())
