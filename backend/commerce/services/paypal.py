"""PayPal checkout: create, capture, webhook reconciliation, and refunds.

The browser never supplies the amount. Totals come from the stored order.
PayPal is charged in PAYPAL_CURRENCY. When that is not the order currency,
PAYPAL_FX_RATE converts 1 order-currency major unit into PayPal major units.
"""

from __future__ import annotations

import logging
import re
import secrets
import urllib.parse
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from commerce.models import Order, PayPalWebhookEvent, Payment, PaymentStatus
from commerce.services.orders import transition_order
from commerce.services.payment import PaymentError, mark_payment_verified
from commerce.services.paypal_client import PayPalApiError, PayPalClient, sdk_url

logger = logging.getLogger("commerce.paypal")

REUSABLE_REMOTE_STATUSES = {"CREATED", "APPROVED", "PAYER_ACTION_REQUIRED", "SAVED"}
THREE_DECIMAL_CURRENCIES = {"BHD", "JOD", "KWD", "OMR", "TND"}
PAYPAL_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
_SENSITIVE_KEYS = {"card", "number", "cvv", "cvc", "security_code", "pan", "expiry"}


def get_client() -> PayPalClient:
    return PayPalClient()


def assert_paypal_ready() -> None:
    if settings.PAYPAL_ENV not in {"sandbox", "live"}:
        raise PaymentError("PayPal environment is not configured", status=503, code="paypal_not_configured")
    if not settings.PAYPAL_CLIENT_ID or not settings.PAYPAL_CLIENT_SECRET:
        raise PaymentError("PayPal is not configured", status=503, code="paypal_not_configured")
    if not settings.PAYPAL_CURRENCY:
        raise PaymentError("PayPal currency is not configured", status=503, code="paypal_not_configured")


def public_config() -> dict[str, Any]:
    enabled = bool(settings.PAYPAL_CLIENT_ID and settings.PAYPAL_CLIENT_SECRET)
    return {
        "enabled": enabled,
        "environment": settings.PAYPAL_ENV,
        "client_id": settings.PAYPAL_CLIENT_ID if enabled else "",
        "currency": settings.PAYPAL_CURRENCY,
        "sdk_url": sdk_url(),
        "fx_rate": settings.PAYPAL_FX_RATE,
        "order_currency": "JOD",
    }


def quote_paypal_amount(total_fils: int, order_currency: str) -> tuple[str, str]:
    """Return the PayPal (value, currency) for an order total. Never reads the browser."""
    if total_fils <= 0:
        raise PaymentError("Order total must be greater than zero", status=400, code="invalid_amount")
    order_currency = (order_currency or "JOD").upper()
    paypal_currency = settings.PAYPAL_CURRENCY.upper()
    major = Decimal(total_fils) / Decimal(1000)
    if order_currency == paypal_currency:
        return _format_money(major, paypal_currency), paypal_currency
    rate_raw = str(settings.PAYPAL_FX_RATE or "").strip()
    if not rate_raw:
        raise PaymentError(
            f"PayPal is configured for {paypal_currency}, but this order is {order_currency}. "
            f"Set PAYPAL_FX_RATE, or use a PayPal account that supports {order_currency}.",
            status=503,
            code="paypal_currency",
        )
    try:
        rate = Decimal(rate_raw)
    except Exception as exc:
        raise PaymentError("PAYPAL_FX_RATE is invalid", status=503, code="paypal_currency") from exc
    if rate <= 0:
        raise PaymentError("PAYPAL_FX_RATE must be positive", status=503, code="paypal_currency")
    return _format_money(major * rate, paypal_currency), paypal_currency


def prepare_paypal_checkout(order: Order) -> Payment:
    """Attach one pending PayPal payment to an order. Skips demo auto-pay."""
    assert_paypal_ready()
    if order.payment_status not in {PaymentStatus.PENDING, PaymentStatus.AUTHORIZED}:
        existing = order.payments.order_by("-id").first()
        if existing:
            return existing
        raise PaymentError("Order cannot be paid", status=409, code="order_not_payable")
    amount, currency = quote_paypal_amount(order.total_fils, order.currency)
    payment = order.payments.filter(provider="paypal").order_by("-id").first()
    if payment is None:
        payment = order.payments.filter(status=PaymentStatus.PENDING).order_by("-id").first()
    if payment is None:
        payment = Payment(order=order, provider="paypal", status=PaymentStatus.PENDING, amount_fils=order.total_fils)
    payment.provider = "paypal"
    payment.amount_fils = order.total_fils
    payment.provider_amount = amount
    payment.currency = currency
    if payment.status not in {PaymentStatus.PENDING, PaymentStatus.AUTHORIZED}:
        payment.status = PaymentStatus.PENDING
    if not payment.checkout_token:
        payment.checkout_token = secrets.token_urlsafe(24)
    payment.save()
    return payment


def create_checkout_order(*, order_number: str, checkout_token: str, user=None) -> dict[str, Any]:
    assert_paypal_ready()
    order = Order.objects.filter(order_number=order_number).first()
    if not order:
        raise PaymentError("Order not found", status=404, code="not_found")
    _assert_access(order, user)
    if order.payment_status == PaymentStatus.PAID:
        raise PaymentError("Order is already paid", status=409, code="already_paid")
    if order.payment_status not in {PaymentStatus.PENDING, PaymentStatus.AUTHORIZED}:
        raise PaymentError("Order cannot be paid", status=409, code="order_not_payable")

    with transaction.atomic():
        payment = (
            Payment.objects.select_for_update()
            .select_related("order")
            .filter(order=order, provider="paypal")
            .order_by("-id")
            .first()
        )
        if not payment or not _token_ok(payment.checkout_token, checkout_token):
            raise PaymentError("Checkout session is not valid", status=403, code="forbidden")
        if payment.status == PaymentStatus.PAID:
            raise PaymentError("Order is already paid", status=409, code="already_paid")
        order = Order.objects.select_for_update().get(pk=order.pk)
        if payment.amount_fils != order.total_fils:
            raise PaymentError("Payment amount does not match the order total", status=409, code="amount_mismatch")
        expected, currency = quote_paypal_amount(order.total_fils, order.currency)
        if payment.provider_amount != expected or (payment.currency or "").upper() != currency:
            raw = dict(payment.raw or {})
            raw["create_attempt"] = int(raw.get("create_attempt") or 1) + 1
            payment.raw = raw
            payment.provider_amount = expected
            payment.currency = currency
            payment.provider_order_id = None
            payment.save(
                update_fields=["provider_amount", "currency", "provider_order_id", "raw", "updated_at"]
            )

    paypal_order_id = _create_or_reuse_remote_order(payment.id)
    logger.info("PayPal order ready order=%s paypal_order_id=%s", order.order_number, paypal_order_id)
    return {"paypal_order_id": paypal_order_id, "payment_status": PaymentStatus.PENDING}


def capture_paypal_order(*, paypal_order_id: str, user=None) -> dict[str, Any]:
    paypal_order_id = _clean_paypal_id(paypal_order_id)
    payment = (
        Payment.objects.select_related("order")
        .filter(provider="paypal", provider_order_id=paypal_order_id)
        .first()
    )
    if not payment:
        raise PaymentError("Unknown PayPal order", status=404, code="not_found")
    _assert_access(payment.order, user)
    if payment.status == PaymentStatus.PAID and payment.order.payment_status == PaymentStatus.PAID:
        return _result(payment)
    assert_paypal_ready()
    client = get_client()
    request_id = f"mmh-capture-{payment.order.order_number}-{paypal_order_id}"
    try:
        remote = client.capture_order(paypal_order_id, request_id=request_id)
    except PayPalApiError as exc:
        if exc.issue == "ORDER_ALREADY_CAPTURED":
            try:
                remote = client.get_order(paypal_order_id)
            except PayPalApiError as get_exc:
                raise _map_api_error(get_exc) from get_exc
        else:
            raise _map_api_error(exc) from exc
    payment = persist_captured_order(payment.id, remote)
    if payment.status != PaymentStatus.PAID:
        failure = str((payment.raw or {}).get("failure") or "")
        if failure == "amount_mismatch":
            raise PaymentError(
                "The PayPal amount did not match this order, so it was not fulfilled.",
                status=409,
                code="amount_mismatch",
            )
        if failure == "capture_failed" or payment.status == PaymentStatus.FAILED:
            raise PaymentError("PayPal capture was not completed", status=402, code="capture_failed")
        raise PaymentError("PayPal payment is not complete yet", status=409, code="capture_pending")
    logger.info(
        "PayPal capture stored order=%s paypal_order_id=%s capture_id=%s",
        payment.order.order_number,
        payment.provider_order_id,
        payment.provider_capture_id,
    )
    return _result(payment)


def persist_captured_order(payment_id: int, remote: dict[str, Any]) -> Payment:
    """Apply a completed capture exactly once. Safe for the sync capture and webhooks."""
    mismatch_capture_id = ""
    with transaction.atomic():
        payment = Payment.objects.select_for_update().select_related("order").get(pk=payment_id)
        order = Order.objects.select_for_update().get(pk=payment.order_id)
        if payment.status in {PaymentStatus.PAID, PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED}:
            return payment
        if order.payment_status == PaymentStatus.PAID and payment.status == PaymentStatus.PAID:
            return payment
        captures = _extract_captures(remote)
        completed = [item for item in captures if item.get("status") == "COMPLETED"]
        if not completed:
            pending = [item for item in captures if item.get("status") in {"PENDING", "APPROVED"}]
            payment.raw_capture_response = _redact(remote)
            if not pending:
                raw = dict(payment.raw or {})
                raw["failure"] = "capture_failed"
                payment.raw = raw
            payment.save(update_fields=["raw", "raw_capture_response", "updated_at"])
            return payment
        capture = completed[-1]
        capture_id = str(capture.get("id") or "")
        if not capture_id or not _capture_matches(payment, order, capture) or not _reference_ok(order, remote):
            mismatch_capture_id = capture_id
            _mark_failed(payment, order, remote, reason="amount_mismatch", capture_id=capture_id)
        else:
            payment.provider_capture_id = capture_id
            payment.external_ref = capture_id
            payment.raw_capture_response = _redact(remote)
            if payment.status == PaymentStatus.FAILED:
                payment.status = PaymentStatus.PENDING
            payment.save(
                update_fields=[
                    "provider_capture_id",
                    "external_ref",
                    "raw_capture_response",
                    "status",
                    "updated_at",
                ]
            )
            return mark_payment_verified(
                payment,
                external_ref=capture_id,
                provider_payload={"paypal_order_id": payment.provider_order_id, "paypal_capture_id": capture_id},
            )
    if mismatch_capture_id:
        _refund_mismatched_capture(payment_id, mismatch_capture_id)
    return Payment.objects.select_related("order").get(pk=payment_id)


def refund_paypal_payment(
    payment: Payment,
    *,
    actor=None,
    amount_fils: int | None = None,
) -> Payment:
    """Full refund when amount_fils is omitted. Partial when a smaller fils amount is given."""
    payment = Payment.objects.select_related("order").get(pk=payment.pk)
    if payment.provider != "paypal":
        raise PaymentError("Not a PayPal payment", status=400, code="not_paypal")
    if payment.status == PaymentStatus.REFUNDED and amount_fils is None:
        return payment
    if payment.status not in {PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED}:
        raise PaymentError("Only a paid PayPal payment can be refunded", status=409, code="not_refundable")
    if not payment.provider_capture_id:
        raise PaymentError("PayPal capture id is missing", status=409, code="missing_capture")
    assert_paypal_ready()

    value: str | None = None
    currency = payment.currency
    full = amount_fils is None
    if amount_fils is not None:
        if amount_fils <= 0 or amount_fils > payment.amount_fils:
            raise PaymentError("Invalid refund amount", status=400, code="invalid_amount")
        value, currency = quote_paypal_amount(amount_fils, payment.order.currency)
        if Decimal(value) >= Decimal(payment.provider_amount or "0"):
            value = None
            full = True
        else:
            full = False
    attempt = len(payment.refunds or []) + 1
    request_id = f"mmh-refund-{payment.order.order_number}-{attempt}-{'full' if value is None else value}"
    try:
        body = get_client().refund_capture(
            payment.provider_capture_id,
            request_id=request_id,
            value=value,
            currency=currency if value is not None else None,
        )
    except PayPalApiError as exc:
        raise _map_api_error(exc) from exc

    with transaction.atomic():
        payment = Payment.objects.select_for_update().select_related("order").get(pk=payment.pk)
        order = Order.objects.select_for_update().get(pk=payment.order_id)
        _append_refund(payment, body)
        payment.raw_refund_response = _redact(body)
        refund_status = str(body.get("status") or "")
        if refund_status == "COMPLETED":
            payment.status = PaymentStatus.REFUNDED if full else PaymentStatus.PARTIALLY_REFUNDED
            payment.save(update_fields=["status", "refunds", "raw_refund_response", "updated_at"])
            if order.payment_status != payment.status:
                transition_order(order, payment_status=payment.status, actor=actor)
            completed = True
        else:
            payment.save(update_fields=["refunds", "raw_refund_response", "updated_at"])
            completed = False
    if not completed:
        raise PaymentError("PayPal refund is not complete yet", status=409, code="refund_pending")
    logger.info(
        "PayPal refund stored order=%s capture_id=%s refund_id=%s status=%s",
        payment.order.order_number,
        payment.provider_capture_id,
        body.get("id"),
        payment.status,
    )
    return payment


def handle_webhook(*, headers: dict[str, str], event: dict[str, Any]) -> str:
    """Verify, store, and reconcile a PayPal webhook. Returns 'ok' or 'duplicate'."""
    if not settings.PAYPAL_WEBHOOK_ID:
        raise PaymentError("PayPal webhook is not configured", status=503, code="webhook_not_configured")
    _validate_webhook_headers(headers)
    assert_paypal_ready()
    try:
        verified = get_client().verify_webhook(headers=headers, event=event)
    except PayPalApiError as exc:
        raise _map_api_error(exc) from exc
    if not verified:
        raise PaymentError("PayPal webhook signature was rejected", status=400, code="invalid_webhook")

    event_id = str(event.get("id") or "")
    event_type = str(event.get("event_type") or "")
    if not event_id:
        raise PaymentError("PayPal webhook is missing an event id", status=400, code="invalid_webhook")

    summary = _event_summary(event)
    try:
        with transaction.atomic():
            row = PayPalWebhookEvent.objects.create(event_id=event_id, event_type=event_type, summary=summary)
    except IntegrityError:
        row = PayPalWebhookEvent.objects.get(event_id=event_id)
        if row.processed:
            logger.info("Duplicate PayPal webhook ignored event_id=%s type=%s", event_id, event_type)
            return "duplicate"

    with transaction.atomic():
        row = PayPalWebhookEvent.objects.select_for_update().get(pk=row.pk)
        if row.processed:
            return "duplicate"
        _dispatch_webhook(event_type, event.get("resource") or {})
        row.processed = True
        row.processed_at = timezone.now()
        row.summary = summary
        row.save(update_fields=["processed", "processed_at", "summary"])
    logger.info("PayPal webhook processed event_id=%s type=%s", event_id, event_type)
    return "ok"


def _dispatch_webhook(event_type: str, resource: dict[str, Any]) -> None:
    if event_type == "PAYMENT.CAPTURE.COMPLETED":
        _reconcile_capture_resource(resource)
        return
    if event_type == "CHECKOUT.ORDER.COMPLETED":
        payment = _payment_for_order_resource(resource)
        if payment:
            persist_captured_order(payment.id, resource)
        return
    if event_type == "CHECKOUT.ORDER.APPROVED":
        _mark_authorized(resource)
        return
    if event_type == "PAYMENT.CAPTURE.DENIED":
        payment = _payment_for_capture_resource(resource)
        if payment and payment.status not in {PaymentStatus.PAID, PaymentStatus.REFUNDED}:
            with transaction.atomic():
                payment = Payment.objects.select_for_update().select_related("order").get(pk=payment.pk)
                order = Order.objects.select_for_update().get(pk=payment.order_id)
                _mark_failed(payment, order, resource, reason="capture_denied")
        return
    if event_type in {"PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"}:
        _apply_refund_resource(resource, reversed_payment=event_type.endswith("REVERSED"))


def _reconcile_capture_resource(resource: dict[str, Any]) -> None:
    payment = _payment_for_capture_resource(resource)
    if not payment:
        logger.info("PayPal capture webhook did not match a local payment")
        return
    persist_captured_order(payment.id, resource)


def _mark_authorized(resource: dict[str, Any]) -> None:
    payment = _payment_for_order_resource(resource)
    if not payment or payment.status != PaymentStatus.PENDING:
        return
    with transaction.atomic():
        payment = Payment.objects.select_for_update().select_related("order").get(pk=payment.pk)
        order = Order.objects.select_for_update().get(pk=payment.order_id)
        if payment.status != PaymentStatus.PENDING or order.payment_status != PaymentStatus.PENDING:
            return
        payment.status = PaymentStatus.AUTHORIZED
        payment.save(update_fields=["status", "updated_at"])
        transition_order(order, payment_status=PaymentStatus.AUTHORIZED)


def _apply_refund_resource(resource: dict[str, Any], *, reversed_payment: bool) -> None:
    capture_id = _capture_id_from_refund(resource)
    payment = Payment.objects.filter(provider="paypal", provider_capture_id=capture_id).first() if capture_id else None
    if not payment:
        return
    with transaction.atomic():
        payment = Payment.objects.select_for_update().select_related("order").get(pk=payment.pk)
        order = Order.objects.select_for_update().get(pk=payment.order_id)
        if payment.status == PaymentStatus.REFUNDED:
            return
        _append_refund(payment, resource)
        payment.raw_refund_response = _redact(resource)
        amount = (resource.get("amount") or {}) if isinstance(resource, dict) else {}
        try:
            refunded_value = Decimal(str(amount.get("value") or "0"))
            full_value = Decimal(payment.provider_amount or "0")
            full = reversed_payment or (full_value > 0 and refunded_value >= full_value)
        except Exception:
            full = reversed_payment
        if payment.status in {PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.AUTHORIZED}:
            payment.status = PaymentStatus.REFUNDED if full else PaymentStatus.PARTIALLY_REFUNDED
            payment.save(update_fields=["status", "refunds", "raw_refund_response", "updated_at"])
            if order.payment_status in {PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED} and order.payment_status != payment.status:
                transition_order(order, payment_status=payment.status)
        else:
            payment.save(update_fields=["refunds", "raw_refund_response", "updated_at"])


def _submit_paypal_order(client, payment: Payment, order: Order, attempt: int) -> dict[str, Any]:
    invoice_id = order.order_number if attempt <= 1 else f"{order.order_number}-{attempt}"
    try:
        return client.create_order(
            value=payment.provider_amount,
            currency=payment.currency,
            order_number=order.order_number,
            invoice_id=invoice_id,
            request_id=f"mmh-create-{order.order_number}-{attempt}",
        )
    except PayPalApiError as exc:
        raise _map_api_error(exc) from exc


def _create_or_reuse_remote_order(payment_id: int) -> str:
    payment = Payment.objects.select_related("order").get(pk=payment_id)
    order = payment.order
    client = get_client()
    if payment.provider_order_id:
        try:
            remote = client.get_order(payment.provider_order_id)
        except PayPalApiError as exc:
            if exc.http_status != 404:
                raise _map_api_error(exc) from exc
            remote = None
        if remote:
            status = str(remote.get("status") or "")
            if status in REUSABLE_REMOTE_STATUSES and _remote_amount_matches(remote, payment) and _reference_ok(order, remote):
                return payment.provider_order_id
            if status == "COMPLETED":
                updated = persist_captured_order(payment.id, remote)
                if updated.status == PaymentStatus.PAID:
                    raise PaymentError("Order is already paid", status=409, code="already_paid")
            attempt = int((payment.raw or {}).get("create_attempt") or 1) + 1
        else:
            attempt = int((payment.raw or {}).get("create_attempt") or 1) + 1
    else:
        attempt = int((payment.raw or {}).get("create_attempt") or 1)

    remote = _submit_paypal_order(client, payment, order, attempt)
    # PayPal replays the first response for a repeated PayPal-Request-Id. If that
    # replay belongs to a different local order, ask for a new order once.
    if not _reference_ok(order, remote):
        attempt += 1
        remote = _submit_paypal_order(client, payment, order, attempt)
    if not _remote_amount_matches(remote, payment) or not _reference_ok(order, remote):
        confirmed = client.get_order(str(remote.get("id") or ""))
        if _remote_amount_matches(confirmed, payment) and _reference_ok(order, confirmed):
            remote = confirmed
        else:
            raise PaymentError(
                "PayPal did not accept the server-calculated amount",
                status=502,
                code="amount_mismatch",
            )
    paypal_order_id = str(remote.get("id") or "")
    if not paypal_order_id:
        raise PaymentError("PayPal did not return an order id", status=502, code="paypal_error")
    raw = dict(payment.raw or {})
    raw["create_attempt"] = attempt
    payment.provider_order_id = paypal_order_id
    payment.external_ref = paypal_order_id
    payment.raw_create_response = _redact(remote)
    payment.raw = raw
    payment.save(
        update_fields=[
            "provider_order_id",
            "external_ref",
            "raw_create_response",
            "raw",
            "updated_at",
        ]
    )
    return paypal_order_id


def _mark_failed(
    payment: Payment,
    order: Order,
    remote: dict[str, Any],
    *,
    reason: str,
    capture_id: str = "",
) -> None:
    raw = dict(payment.raw or {})
    raw["failure"] = reason
    payment.raw = raw
    payment.raw_capture_response = _redact(remote)
    payment.status = PaymentStatus.FAILED
    update_fields = ["status", "raw", "raw_capture_response", "updated_at"]
    if capture_id and not payment.provider_capture_id:
        payment.provider_capture_id = capture_id
        update_fields.append("provider_capture_id")
    payment.save(update_fields=update_fields)
    if order.payment_status in {PaymentStatus.PENDING, PaymentStatus.AUTHORIZED}:
        transition_order(order, payment_status=PaymentStatus.FAILED)


def _refund_mismatched_capture(payment_id: int, capture_id: str) -> None:
    try:
        body = get_client().refund_capture(
            capture_id,
            request_id=f"mmh-mismatch-{payment_id}-{capture_id}",
        )
    except PayPalApiError as exc:
        logger.error(
            "PayPal mismatch refund failed payment_id=%s capture_id=%s issue=%s debug_id=%s",
            payment_id,
            capture_id,
            exc.issue,
            exc.debug_id,
        )
        return
    with transaction.atomic():
        payment = Payment.objects.select_for_update().get(pk=payment_id)
        _append_refund(payment, body)
        payment.raw_refund_response = _redact(body)
        if str(body.get("status") or "") == "COMPLETED":
            payment.status = PaymentStatus.REFUNDED
        payment.save(update_fields=["status", "refunds", "raw_refund_response", "updated_at"])


def _append_refund(payment: Payment, body: dict[str, Any]) -> None:
    refund_id = str(body.get("id") or "")
    refunds = list(payment.refunds or [])
    if refund_id and any(str(item.get("id") or "") == refund_id for item in refunds if isinstance(item, dict)):
        payment.refunds = refunds
        return
    amount = body.get("amount") or {}
    refunds.append(
        {
            "id": refund_id,
            "status": body.get("status") or "",
            "amount": amount.get("value") or "",
            "currency": amount.get("currency_code") or "",
        }
    )
    payment.refunds = refunds


def _payment_for_capture_resource(resource: dict[str, Any]) -> Payment | None:
    capture_id = str(resource.get("id") or "")
    if capture_id:
        found = Payment.objects.filter(provider="paypal", provider_capture_id=capture_id).first()
        if found:
            return found
    order_id = _related_order_id(resource)
    if order_id:
        found = Payment.objects.filter(provider="paypal", provider_order_id=order_id).first()
        if found:
            return found
    custom = str(resource.get("custom_id") or "")
    if not custom:
        invoice = str(resource.get("invoice_id") or "")
        custom = invoice.rsplit("-", 1)[0] if invoice else ""
    if custom:
        return Payment.objects.filter(provider="paypal", order__order_number=custom).order_by("-id").first()
    return None


def _payment_for_order_resource(resource: dict[str, Any]) -> Payment | None:
    paypal_order_id = str(resource.get("id") or "")
    if paypal_order_id:
        found = Payment.objects.filter(provider="paypal", provider_order_id=paypal_order_id).first()
        if found:
            return found
    units = resource.get("purchase_units") or []
    if units:
        custom = str(units[0].get("custom_id") or "")
        if custom:
            return Payment.objects.filter(provider="paypal", order__order_number=custom).order_by("-id").first()
    return None


def _related_order_id(resource: dict[str, Any]) -> str:
    supplementary = resource.get("supplementary_data") or {}
    related = supplementary.get("related_ids") or {}
    return str(related.get("order_id") or "")


def _capture_id_from_refund(resource: dict[str, Any]) -> str:
    for link in resource.get("links") or []:
        href = str(link.get("href") or "")
        if link.get("rel") == "up" and "/captures/" in href:
            return href.rstrip("/").split("/")[-1]
    return str(resource.get("capture_id") or "")


def _extract_captures(remote: dict[str, Any]) -> list[dict[str, Any]]:
    if remote.get("purchase_units"):
        found: list[dict[str, Any]] = []
        for unit in remote.get("purchase_units") or []:
            found.extend((unit.get("payments") or {}).get("captures") or [])
        return found
    if remote.get("amount") and remote.get("id") and remote.get("status"):
        return [remote]
    return []


def _capture_matches(payment: Payment, order: Order, capture: dict[str, Any]) -> bool:
    amount = capture.get("amount") or {}
    currency = str(amount.get("currency_code") or "").upper()
    value = str(amount.get("value") or "")
    if not payment.provider_amount or not payment.currency:
        return False
    if currency != payment.currency.upper():
        return False
    if payment.amount_fils != order.total_fils:
        return False
    try:
        return Decimal(value) == Decimal(payment.provider_amount)
    except Exception:
        return False


def _remote_amount_matches(remote: dict[str, Any], payment: Payment) -> bool:
    units = remote.get("purchase_units") or []
    if not units:
        return False
    amount = units[0].get("amount") or {}
    try:
        return (
            str(amount.get("currency_code") or "").upper() == payment.currency.upper()
            and Decimal(str(amount.get("value"))) == Decimal(payment.provider_amount)
        )
    except Exception:
        return False


def _reference_ok(order: Order, remote: dict[str, Any]) -> bool:
    if remote.get("purchase_units"):
        for unit in remote.get("purchase_units") or []:
            custom = str(unit.get("custom_id") or "")
            if custom and custom != order.order_number:
                return False
        return True
    custom = str(remote.get("custom_id") or "")
    if custom and custom != order.order_number:
        return False
    return True


def _result(payment: Payment) -> dict[str, str]:
    return {
        "payment_status": payment.status,
        "order_number": payment.order.order_number,
        "paypal_order_id": payment.provider_order_id or "",
        "paypal_capture_id": payment.provider_capture_id or "",
    }


def _assert_access(order: Order, user) -> None:
    if user is not None and getattr(user, "is_authenticated", False) and order.user_id and order.user_id != user.id:
        raise PaymentError("You cannot pay this order", status=403, code="forbidden")


def _token_ok(stored: str, provided: str) -> bool:
    if not stored or not provided or len(stored) != len(provided):
        return False
    return secrets.compare_digest(stored, provided)


def _clean_paypal_id(value: str) -> str:
    value = (value or "").strip()
    if not PAYPAL_ID_RE.match(value):
        raise PaymentError("Invalid PayPal order id", status=400, code="invalid_order")
    return value


def _format_money(amount: Decimal, currency: str) -> str:
    places = 3 if currency in THREE_DECIMAL_CURRENCIES else 2
    quant = Decimal("1").scaleb(-places)
    rounded = amount.quantize(quant, rounding=ROUND_HALF_UP)
    if rounded <= 0:
        raise PaymentError("PayPal amount must be greater than zero", status=400, code="invalid_amount")
    return f"{rounded:.{places}f}"


def _map_api_error(exc: PayPalApiError) -> PaymentError:
    logger.warning(
        "PayPal API error name=%s issue=%s status=%s debug_id=%s",
        exc.name,
        exc.issue,
        exc.http_status,
        exc.debug_id,
    )
    if exc.issue == "ORDER_NOT_APPROVED":
        return PaymentError("Approve the payment in PayPal before it can be confirmed.", status=409, code="not_approved")
    if exc.issue == "INSTRUMENT_DECLINED":
        return PaymentError(
            "PayPal could not charge the selected funding source. Choose another way to pay in PayPal.",
            status=409,
            code="instrument_declined",
        )
    if exc.issue == "CURRENCY_NOT_SUPPORTED":
        return PaymentError(
            "This PayPal account does not support the order currency.",
            status=502,
            code="paypal_currency",
        )
    if exc.http_status == 401:
        return PaymentError("PayPal authentication failed", status=502, code="paypal_auth")
    code = exc.issue if re.fullmatch(r"[A-Z0-9_]+", exc.issue or "") else "paypal_error"
    return PaymentError("PayPal could not complete the request", status=502, code=code)


def _validate_webhook_headers(headers: dict[str, str]) -> None:
    required = ("auth_algo", "cert_url", "transmission_id", "transmission_sig", "transmission_time")
    if any(not headers.get(key) for key in required):
        raise PaymentError("PayPal webhook headers are incomplete", status=400, code="invalid_webhook")
    parsed = urllib.parse.urlparse(headers["cert_url"])
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not (host == "paypal.com" or host.endswith(".paypal.com")):
        raise PaymentError("PayPal webhook certificate URL was rejected", status=400, code="invalid_webhook")


def _event_summary(event: dict[str, Any]) -> dict[str, Any]:
    resource = event.get("resource") or {}
    amount = resource.get("amount") or {}
    return {
        "id": event.get("id") or "",
        "event_type": event.get("event_type") or "",
        "resource_id": resource.get("id") or "",
        "status": resource.get("status") or "",
        "amount": amount.get("value") or "",
        "currency": amount.get("currency_code") or "",
        "custom_id": resource.get("custom_id") or "",
        "order_id": _related_order_id(resource),
    }


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        redacted = {}
        for key, item in value.items():
            if str(key).lower() in _SENSITIVE_KEYS:
                redacted[key] = "[redacted]"
            else:
                redacted[key] = _redact(item)
        return redacted
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return value
