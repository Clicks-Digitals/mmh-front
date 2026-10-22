"""Customer e-mails for orders. Sending never raises: failures are logged (without secrets).

Each ``queue_*`` helper defers the send to ``transaction.on_commit`` so a rolled-back
state change never produces an e-mail, and plaintext codes are read from the database
only at send time.
"""

from __future__ import annotations

import logging
from urllib.parse import quote

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.utils.html import escape

logger = logging.getLogger("commerce.notifications")

DEFAULT_FROM = "MMH <no-reply@mmhcard.com>"
DEFAULT_SITE_URL = "https://www.mmhcard.com"


def _from_email() -> str:
    return getattr(settings, "DEFAULT_FROM_EMAIL", None) or DEFAULT_FROM


def site_url() -> str:
    return (getattr(settings, "SITE_URL", None) or DEFAULT_SITE_URL).rstrip("/")


def order_link(order) -> str:
    return f"{site_url()}/order/{quote(order.order_number)}?token={quote(order.access_token or '')}"


def _jod(fils: int) -> str:
    return f"{(fils or 0) / 1000:.3f} JOD"


def _send(subject: str, text: str, html: str, to: str, *, kind: str, order_number: str) -> bool:
    if not to:
        return False
    try:
        send_mail(subject, text, _from_email(), [to], html_message=html, fail_silently=False)
    except Exception as exc:  # never break checkout / fulfillment because of e-mail
        logger.error(
            "Order e-mail failed kind=%s order=%s error=%s", kind, order_number, exc.__class__.__name__
        )
        return False
    logger.info("Order e-mail sent kind=%s order=%s", kind, order_number)
    return True


def _html_page(title: str, body_html: str, link: str) -> str:
    return (
        "<!doctype html><html><body style=\"font-family:Arial,sans-serif;color:#111;max-width:560px;margin:0 auto;\">"
        f"<h2 style=\"margin:16px 0\">{escape(title)}</h2>"
        f"{body_html}"
        f"<p style=\"margin-top:24px\"><a href=\"{escape(link)}\" "
        "style=\"background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none\">"
        "View your order</a></p>"
        f"<p style=\"color:#666;font-size:12px\">If the button does not work, open: {escape(link)}</p>"
        "</body></html>"
    )


def _load_order(order_id: int):
    from commerce.models import Order

    return Order.objects.prefetch_related("items", "items__codes").filter(pk=order_id).first()


# --- Order paid ---------------------------------------------------------------------


def send_order_paid_email(order_id: int) -> bool:
    order = _load_order(order_id)
    if not order:
        return False
    link = order_link(order)
    lines = [f"- {item.product_name} ({item.variant_name}) x{item.quantity}: {_jod(item.line_total_fils)}" for item in order.items.all()]
    text = (
        f"Hi {order.full_name},\n\n"
        f"Thank you! We received your payment for order {order.order_number}.\n\n"
        + "\n".join(lines)
        + f"\n\nTotal: {_jod(order.total_fils)}\n\n"
        "Your codes are delivered to your account/order page and by e-mail as soon as they are ready.\n"
        f"Track your order: {link}\n"
    )
    rows = "".join(
        f"<tr><td>{escape(item.product_name)} ({escape(item.variant_name)}) x{item.quantity}</td>"
        f"<td style=\"text-align:right\">{escape(_jod(item.line_total_fils))}</td></tr>"
        for item in order.items.all()
    )
    html = _html_page(
        f"Payment received — order {order.order_number}",
        f"<p>Hi {escape(order.full_name)}, thank you! We received your payment.</p>"
        f"<table style=\"width:100%;border-collapse:collapse\">{rows}"
        f"<tr><td><strong>Total</strong></td><td style=\"text-align:right\"><strong>{escape(_jod(order.total_fils))}</strong></td></tr></table>",
        link,
    )
    return _send(
        f"Order {order.order_number}: payment received",
        text,
        html,
        order.email,
        kind="order_paid",
        order_number=order.order_number,
    )


# --- Codes delivered ----------------------------------------------------------------


def _delivered_codes(order):
    from commerce.crypto import reveal_code
    from commerce.models import DigitalCodeStatus

    groups = []
    for item in order.items.all():
        codes = [c for c in item.codes.all() if c.status == DigitalCodeStatus.DELIVERED]
        if not codes:
            continue
        revealed = []
        for code in sorted(codes, key=lambda c: c.id):
            try:
                revealed.append(reveal_code(code))
            except Exception:
                logger.error("Could not decrypt code id=%s for e-mail order=%s", code.id, order.order_number)
        if revealed:
            groups.append((item, revealed))
    return groups


def send_codes_delivered_email(order_id: int) -> bool:
    order = _load_order(order_id)
    if not order:
        return False
    groups = _delivered_codes(order)
    if not groups:
        return False
    link = order_link(order)
    text_parts = [f"Hi {order.full_name},\n\nYour codes for order {order.order_number} are ready.\n"]
    html_parts = [f"<p>Hi {escape(order.full_name)}, your codes for order {escape(order.order_number)} are ready.</p>"]
    for item, codes in groups:
        text_parts.append(f"\n{item.product_name} ({item.variant_name}):")
        html_parts.append(f"<h3 style=\"margin:16px 0 8px\">{escape(item.product_name)} ({escape(item.variant_name)})</h3><ul>")
        for code, pin in codes:
            text_parts.append(f"  Code: {code}" + (f"  PIN: {pin}" if pin else ""))
            html_parts.append(
                f"<li style=\"font-family:monospace;font-size:15px\">{escape(code)}"
                + (f" &nbsp;PIN: {escape(pin)}" if pin else "")
                + "</li>"
            )
        html_parts.append("</ul>")
    text_parts.append(
        "\nKeep these codes private. You can view them any time on your order page:\n" f"{link}\n"
    )
    html_parts.append("<p>Keep these codes private. You can view them any time on your order page.</p>")
    return _send(
        f"Order {order.order_number}: your codes",
        "\n".join(text_parts),
        _html_page(f"Your codes — order {order.order_number}", "".join(html_parts), link),
        order.email,
        kind="codes_delivered",
        order_number=order.order_number,
    )


# --- Top-up delivered ---------------------------------------------------------------


def send_topup_delivered_email(order_id: int, item_id: int) -> bool:
    order = _load_order(order_id)
    if not order:
        return False
    item = next((i for i in order.items.all() if i.id == item_id), None)
    if not item:
        return False
    link = order_link(order)
    note = (item.delivery_note or "").strip()
    text = (
        f"Hi {order.full_name},\n\n"
        f"Your top-up {item.product_name} ({item.variant_name}) x{item.quantity} for order "
        f"{order.order_number} has been delivered.\n"
        + (f"\nNote: {note}\n" if note else "")
        + f"\nView your order: {link}\n"
    )
    html = _html_page(
        f"Top-up delivered — order {order.order_number}",
        f"<p>Hi {escape(order.full_name)}, your top-up <strong>{escape(item.product_name)} "
        f"({escape(item.variant_name)}) x{item.quantity}</strong> has been delivered.</p>"
        + (f"<p>Note: {escape(note)}</p>" if note else ""),
        link,
    )
    return _send(
        f"Order {order.order_number}: top-up delivered",
        text,
        html,
        order.email,
        kind="topup_delivered",
        order_number=order.order_number,
    )


# --- on_commit wrappers -------------------------------------------------------------


def _safe(fn, *args):
    def run():
        try:
            fn(*args)
        except Exception:
            logger.exception("Order e-mail task crashed (%s)", fn.__name__)

    return run


def queue_order_paid(order_id: int) -> None:
    transaction.on_commit(_safe(send_order_paid_email, order_id))


def queue_codes_delivered(order_id: int) -> None:
    transaction.on_commit(_safe(send_codes_delivered_email, order_id))


def queue_topup_delivered(order_id: int, item_id: int) -> None:
    transaction.on_commit(_safe(send_topup_delivered_email, order_id, item_id))
