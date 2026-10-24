"""Customer e-mails for orders (D9). Bilingual: every e-mail uses ``Order.locale`` (en|ar).

Sending never raises: failures are logged (without secrets). Each ``queue_*`` helper defers
the send to ``transaction.on_commit`` so a rolled-back state change never produces an
e-mail, and plaintext codes are read from the database only at send time.

E-mails: payment received, codes delivered (once per full delivery; one "X of Y ready"
e-mail for a partial delivery), top-up delivered, order cancelled, refund issued, order
expired. Staff delivery notes are customer-visible and appear as "Note from our team".
"""

from __future__ import annotations

import logging
from urllib.parse import quote

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone
from django.utils.html import escape

from commerce.services.money import format_jod

logger = logging.getLogger("commerce.notifications")

DEFAULT_FROM = "MMH <no-reply@mmhcard.com>"
DEFAULT_SITE_URL = "https://www.mmhcard.com"

# --- Copy --------------------------------------------------------------------------------

COPY = {
    "en": {
        "hi": "Hi {name},",
        "view_order": "View your order",
        "button_fallback": "If the button does not work, open: {link}",
        "subtotal": "Subtotal",
        "discount": "Discount",
        "discount_code": "Discount ({code})",
        "total": "Total",
        "paid_subject": "Order {number}: payment received",
        "paid_title": "Payment received — order {number}",
        "paid_intro": "Thank you! We received your payment for order {number}.",
        "paid_next_codes_account": "Your codes will appear in your account and on your order page, and we will e-mail them to you as soon as they are ready.",
        "paid_next_codes_guest": "Your codes will appear on your order page, and we will e-mail them to you as soon as they are ready.",
        "paid_next_topup": "We are now topping up the account you entered. We will e-mail you as soon as it is done.",
        "paid_next_mixed_account": "Your codes will appear in your account and on your order page, and we will top up the account you entered. We will e-mail you as each item is delivered.",
        "paid_next_mixed_guest": "Your codes will appear on your order page, and we will top up the account you entered. We will e-mail you as each item is delivered.",
        "track": "Track your order: {link}",
        "free_intro": "Thank you! Your order {number} is confirmed (total {total}).",
        "codes_subject": "Order {number}: your codes",
        "codes_title": "Your codes — order {number}",
        "codes_intro": "Your codes for order {number} are ready.",
        "partial_subject": "Order {number}: {ready} of {total} codes ready",
        "partial_title": "{ready} of {total} codes ready — order {number}",
        "partial_intro": "{ready} of your {total} codes for order {number} are ready. The rest is on the way — we will e-mail you again as soon as they are ready.",
        "code": "Code",
        "pin": "PIN",
        "keep_private": "Keep these codes private. You can view them any time on your order page.",
        "topup_subject": "Order {number}: top-up delivered",
        "topup_title": "Top-up delivered — order {number}",
        "topup_intro": "Your top-up {item} x{qty} for order {number} has been delivered to this account:",
        "team_note": "Note from our team",
        "cancel_subject": "Order {number}: cancelled",
        "cancel_title": "Order {number} cancelled",
        "cancel_intro": "Your order {number} has been cancelled. You have not been charged for it.",
        "cancel_again": "You can place a new order any time.",
        "refund_subject": "Order {number}: refund issued",
        "refund_title": "Refund issued — order {number}",
        "refund_intro": "We have issued a refund of {amount} for order {number}.",
        "refund_paypal": "The money goes back to your PayPal account. PayPal usually shows it within a few days.",
        "refund_manual": "Our team is returning the money to you directly. Contact us if you have any questions.",
        "refund_total": "Refunded so far: {refunded} of {paid}.",
        "expired_subject": "Order {number}: expired",
        "expired_title": "Order {number} expired",
        "expired_intro": "We did not receive payment for order {number}, so it has expired. You have not been charged.",
    },
    "ar": {
        "hi": "مرحباً {name}،",
        "view_order": "عرض طلبك",
        "button_fallback": "إذا لم يعمل الزر، افتح الرابط: {link}",
        "subtotal": "المجموع الفرعي",
        "discount": "الخصم",
        "discount_code": "الخصم ({code})",
        "total": "الإجمالي",
        "paid_subject": "الطلب {number}: تم استلام الدفع",
        "paid_title": "تم استلام الدفع — الطلب {number}",
        "paid_intro": "شكراً لك! استلمنا دفعتك للطلب {number}.",
        "paid_next_codes_account": "ستظهر أكوادك في حسابك وفي صفحة الطلب، وسنرسلها إليك بالبريد الإلكتروني فور جاهزيتها.",
        "paid_next_codes_guest": "ستظهر أكوادك في صفحة الطلب، وسنرسلها إليك بالبريد الإلكتروني فور جاهزيتها.",
        "paid_next_topup": "نقوم الآن بشحن الحساب الذي أدخلته، وسنرسل لك بريداً إلكترونياً فور الانتهاء.",
        "paid_next_mixed_account": "ستظهر أكوادك في حسابك وفي صفحة الطلب، وسنشحن الحساب الذي أدخلته. سنراسلك عند تسليم كل منتج.",
        "paid_next_mixed_guest": "ستظهر أكوادك في صفحة الطلب، وسنشحن الحساب الذي أدخلته. سنراسلك عند تسليم كل منتج.",
        "track": "تابع طلبك: {link}",
        "free_intro": "شكراً لك! تم تأكيد طلبك {number} (الإجمالي {total}).",
        "codes_subject": "الطلب {number}: أكوادك",
        "codes_title": "أكوادك — الطلب {number}",
        "codes_intro": "أكوادك للطلب {number} جاهزة.",
        "partial_subject": "الطلب {number}: {ready} من {total} أكواد جاهزة",
        "partial_title": "{ready} من {total} أكواد جاهزة — الطلب {number}",
        "partial_intro": "{ready} من أصل {total} أكواد للطلب {number} جاهزة. الباقي في الطريق — سنراسلك مرة أخرى فور جاهزيتها.",
        "code": "الكود",
        "pin": "الرقم السري",
        "keep_private": "احتفظ بهذه الأكواد بشكل خاص. يمكنك عرضها في أي وقت من صفحة الطلب.",
        "topup_subject": "الطلب {number}: تم الشحن",
        "topup_title": "تم الشحن — الطلب {number}",
        "topup_intro": "تم شحن {item} ×{qty} للطلب {number} إلى هذا الحساب:",
        "team_note": "ملاحظة من فريقنا",
        "cancel_subject": "الطلب {number}: تم الإلغاء",
        "cancel_title": "تم إلغاء الطلب {number}",
        "cancel_intro": "تم إلغاء طلبك {number}. لم يتم خصم أي مبلغ منك.",
        "cancel_again": "يمكنك تقديم طلب جديد في أي وقت.",
        "refund_subject": "الطلب {number}: تم إصدار استرداد",
        "refund_title": "تم إصدار استرداد — الطلب {number}",
        "refund_intro": "أصدرنا استرداداً بقيمة {amount} للطلب {number}.",
        "refund_paypal": "سيعود المبلغ إلى حسابك في PayPal، ويظهر عادة خلال أيام قليلة.",
        "refund_manual": "سيعيد فريقنا المبلغ إليك مباشرة. تواصل معنا إن كان لديك أي سؤال.",
        "refund_total": "إجمالي المسترد حتى الآن: {refunded} من {paid}.",
        "expired_subject": "الطلب {number}: انتهت صلاحيته",
        "expired_title": "انتهت صلاحية الطلب {number}",
        "expired_intro": "لم نستلم الدفع للطلب {number}، لذلك انتهت صلاحيته. لم يتم خصم أي مبلغ منك.",
    },
}


def _locale(order) -> str:
    return "ar" if (getattr(order, "locale", "") or "en") == "ar" else "en"


def _t(order, key: str, **kwargs) -> str:
    return COPY[_locale(order)][key].format(**kwargs)


def _money(order, fils: int) -> str:
    return format_jod(fils, _locale(order))


def _from_email() -> str:
    return getattr(settings, "DEFAULT_FROM_EMAIL", None) or DEFAULT_FROM


def site_url() -> str:
    return (getattr(settings, "SITE_URL", None) or DEFAULT_SITE_URL).rstrip("/")


def order_link(order) -> str:
    prefix = "/ar" if _locale(order) == "ar" and getattr(settings, "STORE_LOCALE_PREFIX", False) else ""
    return f"{site_url()}{prefix}/order/{quote(order.order_number)}?token={quote(order.access_token or '')}"


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


def _html_page(order, title: str, body_html: str, link: str) -> str:
    rtl = _locale(order) == "ar"
    direction = "rtl" if rtl else "ltr"
    align = "right" if rtl else "left"
    return (
        f"<!doctype html><html lang=\"{_locale(order)}\" dir=\"{direction}\"><body dir=\"{direction}\" "
        f"style=\"font-family:Arial,sans-serif;color:#111;max-width:560px;margin:0 auto;text-align:{align}\">"
        f"<h2 style=\"margin:16px 0\">{escape(title)}</h2>"
        f"{body_html}"
        f"<p style=\"margin-top:24px\"><a href=\"{escape(link)}\" "
        "style=\"background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none\">"
        f"{escape(_t(order, 'view_order'))}</a></p>"
        f"<p style=\"color:#666;font-size:12px\">{escape(_t(order, 'button_fallback', link=link))}</p>"
        "</body></html>"
    )


def _load_order(order_id: int):
    from commerce.models import Order

    return (
        Order.objects.select_related("coupon")
        .prefetch_related("items", "items__codes", "items__product")
        .filter(pk=order_id)
        .first()
    )


def item_title(order, item) -> str:
    """Product + variant name in the order language (falls back to English)."""
    if _locale(order) == "ar":
        product = item.product_name_ar or item.product_name
        variant = item.variant_name_ar or item.variant_name
    else:
        product, variant = item.product_name, item.variant_name
    return f"{product} ({variant})" if variant else product


def field_lines(order, item) -> list[tuple[str, str]]:
    """Labelled account fields (e.g. 'Player ID: 5123...') captured at checkout."""
    ar = _locale(order) == "ar"
    rows = []
    for detail in item.field_details or []:
        label = (detail.get("label_ar") if ar else "") or detail.get("label_en") or detail.get("key") or ""
        value = (detail.get("value_label_ar") if ar else detail.get("value_label_en")) or detail.get("value") or ""
        rows.append((str(label), str(value)))
    if not rows:
        rows = [(str(k), str(v)) for k, v in (item.customer_fields or {}).items()]
    return rows


def _is_topup(item) -> bool:
    from catalog.models import FulfillmentType

    return item.product.fulfillment_type == FulfillmentType.DIRECT_TOPUP


def _totals(order) -> list[tuple[str, str]]:
    rows = [(_t(order, "subtotal"), _money(order, order.subtotal_fils))]
    if order.discount_fils:
        label = _t(order, "discount_code", code=order.coupon.code) if order.coupon_id else _t(order, "discount")
        rows.append((label, "-" + _money(order, order.discount_fils)))
    rows.append((_t(order, "total"), _money(order, order.total_fils)))
    return rows


# --- Order paid ----------------------------------------------------------------------


def send_order_paid_email(order_id: int) -> bool:
    order = _load_order(order_id)
    if not order:
        return False
    link = order_link(order)
    items = list(order.items.all())
    has_topup = any(_is_topup(i) for i in items)
    has_codes = any(not _is_topup(i) for i in items)
    guest = order.user_id is None
    if has_topup and has_codes:
        next_key = "paid_next_mixed_guest" if guest else "paid_next_mixed_account"
    elif has_topup:
        next_key = "paid_next_topup"
    else:
        next_key = "paid_next_codes_guest" if guest else "paid_next_codes_account"
    intro = (
        _t(order, "free_intro", number=order.order_number, total=_money(order, 0))
        if order.total_fils == 0
        else _t(order, "paid_intro", number=order.order_number)
    )
    lines = [f"- {item_title(order, i)} x{i.quantity}: {_money(order, i.line_total_fils)}" for i in items]
    totals = _totals(order)
    text = (
        _t(order, "hi", name=order.full_name)
        + "\n\n"
        + intro
        + "\n\n"
        + "\n".join(lines)
        + "\n\n"
        + "\n".join(f"{label}: {value}" for label, value in totals)
        + "\n\n"
        + _t(order, next_key)
        + "\n"
        + _t(order, "track", link=link)
        + "\n"
    )
    rows = "".join(
        f"<tr><td>{escape(item_title(order, i))} x{i.quantity}</td>"
        f"<td style=\"text-align:end\">{escape(_money(order, i.line_total_fils))}</td></tr>"
        for i in items
    )
    rows += "".join(
        f"<tr><td>{'<strong>' if n == len(totals) - 1 else ''}{escape(label)}{'</strong>' if n == len(totals) - 1 else ''}</td>"
        f"<td style=\"text-align:end\">{escape(value)}</td></tr>"
        for n, (label, value) in enumerate(totals)
    )
    html = _html_page(
        order,
        _t(order, "paid_title", number=order.order_number),
        f"<p>{escape(_t(order, 'hi', name=order.full_name))} {escape(intro)}</p>"
        f"<table style=\"width:100%;border-collapse:collapse\">{rows}</table>"
        f"<p>{escape(_t(order, next_key))}</p>",
        link,
    )
    return _send(
        _t(order, "paid_subject", number=order.order_number),
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


def code_progress(order) -> tuple[int, int]:
    """(delivered code units, total code units) over the order's CODE items."""
    from commerce.models import DigitalCodeStatus

    ready = total = 0
    for item in order.items.all():
        if _is_topup(item):
            continue
        total += item.quantity
        ready += min(item.quantity, sum(1 for c in item.codes.all() if c.status == DigitalCodeStatus.DELIVERED))
    return ready, total


def send_codes_delivered_email(order_id: int) -> bool:
    """Codes e-mail. Full delivery -> 'your codes'; partial -> 'X of Y ready, the rest is on the way'."""
    order = _load_order(order_id)
    if not order:
        return False
    groups = _delivered_codes(order)
    if not groups:
        return False
    ready, total = code_progress(order)
    partial = ready < total
    link = order_link(order)
    number = order.order_number
    if partial:
        subject = _t(order, "partial_subject", number=number, ready=ready, total=total)
        title = _t(order, "partial_title", number=number, ready=ready, total=total)
        intro = _t(order, "partial_intro", number=number, ready=ready, total=total)
    else:
        subject = _t(order, "codes_subject", number=number)
        title = _t(order, "codes_title", number=number)
        intro = _t(order, "codes_intro", number=number)
    code_label, pin_label = _t(order, "code"), _t(order, "pin")
    text_parts = [_t(order, "hi", name=order.full_name) + "\n\n" + intro + "\n"]
    html_parts = [f"<p>{escape(_t(order, 'hi', name=order.full_name))} {escape(intro)}</p>"]
    for item, codes in groups:
        text_parts.append(f"\n{item_title(order, item)}:")
        html_parts.append(f"<h3 style=\"margin:16px 0 8px\">{escape(item_title(order, item))}</h3><ul>")
        for code, pin in codes:
            text_parts.append(f"  {code_label}: {code}" + (f"  {pin_label}: {pin}" if pin else ""))
            html_parts.append(
                f"<li dir=\"ltr\" style=\"font-family:monospace;font-size:15px\">{escape(code)}"
                + (f" &nbsp;{escape(pin_label)}: {escape(pin)}" if pin else "")
                + "</li>"
            )
        html_parts.append("</ul>")
    text_parts.append("\n" + _t(order, "keep_private") + "\n" + link + "\n")
    html_parts.append(f"<p>{escape(_t(order, 'keep_private'))}</p>")
    return _send(
        subject,
        "\n".join(text_parts),
        _html_page(order, title, "".join(html_parts), link),
        order.email,
        kind="codes_partial" if partial else "codes_delivered",
        order_number=number,
    )


def send_delivery_update(order_id: int) -> str:
    """Once-only codes e-mails: full delivery once; partial delivery at most once before that.

    Returns "full", "partial" or "" (nothing sent).
    """
    from commerce.models import Order

    order = _load_order(order_id)
    if not order:
        return ""
    ready, total = code_progress(order)
    if ready <= 0 or total <= 0:
        return ""
    now = timezone.now()
    if ready >= total:
        claimed = Order.objects.filter(pk=order.pk, codes_email_sent_at__isnull=True).update(codes_email_sent_at=now)
        if not claimed:
            return ""
        if send_codes_delivered_email(order.pk):
            return "full"
        Order.objects.filter(pk=order.pk).update(codes_email_sent_at=None)
        return ""
    claimed = Order.objects.filter(
        pk=order.pk, partial_email_sent_at__isnull=True, codes_email_sent_at__isnull=True
    ).update(partial_email_sent_at=now)
    if not claimed:
        return ""
    if send_codes_delivered_email(order.pk):
        return "partial"
    Order.objects.filter(pk=order.pk).update(partial_email_sent_at=None)
    return ""


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
    fields = field_lines(order, item)
    intro = _t(order, "topup_intro", item=item_title(order, item), qty=item.quantity, number=order.order_number)
    text = (
        _t(order, "hi", name=order.full_name)
        + "\n\n"
        + intro
        + "\n"
        + "".join(f"  {label}: {value}\n" for label, value in fields)
        + (f"\n{_t(order, 'team_note')}: {note}\n" if note else "")
        + "\n"
        + _t(order, "track", link=link)
        + "\n"
    )
    field_html = "".join(
        f"<li><strong>{escape(label)}:</strong> <span dir=\"ltr\">{escape(value)}</span></li>" for label, value in fields
    )
    html = _html_page(
        order,
        _t(order, "topup_title", number=order.order_number),
        f"<p>{escape(_t(order, 'hi', name=order.full_name))} {escape(intro)}</p>"
        + (f"<ul>{field_html}</ul>" if field_html else "")
        + (f"<p><strong>{escape(_t(order, 'team_note'))}:</strong> {escape(note)}</p>" if note else ""),
        link,
    )
    return _send(
        _t(order, "topup_subject", number=order.order_number),
        text,
        html,
        order.email,
        kind="topup_delivered",
        order_number=order.order_number,
    )


# --- Cancelled / refunded / expired ---------------------------------------------------


def _simple_email(order, *, kind: str, subject_key: str, title_key: str, paragraphs: list[str]) -> bool:
    link = order_link(order)
    text = _t(order, "hi", name=order.full_name) + "\n\n" + "\n\n".join(paragraphs) + "\n\n" + _t(order, "track", link=link) + "\n"
    html = _html_page(
        order,
        _t(order, title_key, number=order.order_number),
        f"<p>{escape(_t(order, 'hi', name=order.full_name))}</p>" + "".join(f"<p>{escape(p)}</p>" for p in paragraphs),
        link,
    )
    return _send(
        _t(order, subject_key, number=order.order_number),
        text,
        html,
        order.email,
        kind=kind,
        order_number=order.order_number,
    )


def send_order_cancelled_email(order_id: int) -> bool:
    order = _load_order(order_id)
    if not order:
        return False
    return _simple_email(
        order,
        kind="order_cancelled",
        subject_key="cancel_subject",
        title_key="cancel_title",
        paragraphs=[_t(order, "cancel_intro", number=order.order_number), _t(order, "cancel_again")],
    )


def send_order_expired_email(order_id: int) -> bool:
    order = _load_order(order_id)
    if not order:
        return False
    return _simple_email(
        order,
        kind="order_expired",
        subject_key="expired_subject",
        title_key="expired_title",
        paragraphs=[_t(order, "expired_intro", number=order.order_number), _t(order, "cancel_again")],
    )


def send_refund_issued_email(order_id: int, refund_id: int) -> bool:
    from commerce.models import Refund
    from commerce.services.refunds import refund_summary

    order = _load_order(order_id)
    refund = Refund.objects.filter(pk=refund_id, order_id=order_id).first() if order else None
    if not order or not refund:
        return False
    summary = refund_summary(order)
    channel = "refund_paypal" if refund.provider == "paypal" else "refund_manual"
    paragraphs = [
        _t(order, "refund_intro", amount=_money(order, refund.amount_fils), number=order.order_number),
        _t(order, channel),
        _t(
            order,
            "refund_total",
            refunded=_money(order, summary["refunded_fils"]),
            paid=_money(order, summary["paid_fils"]),
        ),
    ]
    return _simple_email(
        order, kind="refund_issued", subject_key="refund_subject", title_key="refund_title", paragraphs=paragraphs
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


def queue_delivery_update(order_id: int) -> None:
    transaction.on_commit(_safe(send_delivery_update, order_id))


# Back-compat name: codes e-mails now go through the once-only delivery update.
queue_codes_delivered = queue_delivery_update


def queue_topup_delivered(order_id: int, item_id: int) -> None:
    transaction.on_commit(_safe(send_topup_delivered_email, order_id, item_id))


def queue_order_cancelled(order_id: int) -> None:
    transaction.on_commit(_safe(send_order_cancelled_email, order_id))


def queue_order_expired(order_id: int) -> None:
    transaction.on_commit(_safe(send_order_expired_email, order_id))


def queue_refund_issued(order_id: int, refund_id: int) -> None:
    transaction.on_commit(_safe(send_refund_issued_email, order_id, refund_id))
