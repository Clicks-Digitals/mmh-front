"""Data backfill for the fix phase.

* D10: ``DigitalCode.code_identity`` (code-only fingerprint) by decrypting every existing row.
  Rows that cannot be decrypted (wrong key) are left NULL and logged; duplicate checks then
  fall back to the legacy code+PIN fingerprint for them.
* D5: ``Refund`` ledger rows from the legacy ``Payment.refunds`` JSON (PayPal) and from
  fully refunded non-PayPal payments.
* ST-15 / OR-21: Arabic names and field labels on existing order items.
"""

from __future__ import annotations

import logging
from decimal import ROUND_HALF_UP, Decimal

from django.db import migrations

logger = logging.getLogger("commerce")


def backfill_code_identity(apps, schema_editor):
    from commerce.crypto import code_identity, decode_code_payload, decrypt_code

    DigitalCode = apps.get_model("commerce", "DigitalCode")
    failed = 0
    batch = []
    for code in DigitalCode.objects.filter(code_identity__isnull=True).only("id", "ciphertext", "nonce").iterator(chunk_size=500):
        try:
            plain, _pin = decode_code_payload(decrypt_code(code.ciphertext, code.nonce))
        except Exception:
            failed += 1
            continue
        code.code_identity = code_identity(plain)
        batch.append(code)
        if len(batch) >= 500:
            DigitalCode.objects.bulk_update(batch, ["code_identity"])
            batch = []
    if batch:
        DigitalCode.objects.bulk_update(batch, ["code_identity"])
    if failed:
        logger.warning("code_identity backfill: %s code(s) could not be decrypted", failed)


def _fils(payment, value) -> int:
    try:
        full = Decimal(payment.provider_amount or "0")
        part = Decimal(str(value or "0"))
    except Exception:
        return 0
    if full <= 0:
        return 0
    return int((part / full * Decimal(payment.amount_fils)).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def backfill_refunds(apps, schema_editor):
    Payment = apps.get_model("commerce", "Payment")
    Refund = apps.get_model("commerce", "Refund")
    for payment in Payment.objects.select_related("order").filter(status__in=["REFUNDED", "PARTIALLY_REFUNDED"]):
        if Refund.objects.filter(payment=payment).exists():
            continue
        rows = [r for r in (payment.refunds or []) if isinstance(r, dict)]
        if payment.provider == "paypal" and rows:
            total = 0
            completed = [r for r in rows if str(r.get("status") or "") == "COMPLETED"]
            for index, row in enumerate(completed):
                amount = _fils(payment, row.get("amount"))
                if payment.status == "REFUNDED" and index == len(completed) - 1:
                    amount = max(payment.amount_fils - total, 0)
                total += amount
                Refund.objects.create(
                    order=payment.order,
                    payment=payment,
                    provider="paypal",
                    status="COMPLETED",
                    amount_fils=amount,
                    currency=payment.order.currency,
                    provider_amount=str(row.get("amount") or ""),
                    provider_currency=str(row.get("currency") or ""),
                    provider_refund_id=str(row.get("id") or ""),
                    reason="Imported from the previous refund records",
                )
        elif payment.status == "REFUNDED":
            Refund.objects.create(
                order=payment.order,
                payment=payment,
                provider="manual",
                status="COMPLETED",
                amount_fils=payment.amount_fils,
                currency=payment.order.currency,
                reason="Imported from the previous refund records",
            )
        # PARTIALLY_REFUNDED non-PayPal payments had no recorded amount: nothing to import.


def backfill_item_labels(apps, schema_editor):
    OrderItem = apps.get_model("commerce", "OrderItem")
    ProductFieldDefinition = apps.get_model("catalog", "ProductFieldDefinition")
    for item in OrderItem.objects.select_related("product", "variant", "variant__region", "product__platform").iterator(chunk_size=500):
        changed = []
        pairs = (
            ("product_name_ar", getattr(item.product, "name_ar", "")),
            ("variant_name_ar", getattr(item.variant, "name_ar", "")),
            ("region_name_ar", getattr(getattr(item.variant, "region", None), "name_ar", "") or ""),
            ("platform_name_ar", getattr(getattr(item.product, "platform", None), "name_ar", "") or ""),
        )
        for name, value in pairs:
            if not getattr(item, name) and value:
                setattr(item, name, value)
                changed.append(name)
        if not item.field_details and item.customer_fields:
            definitions = {d.key: d for d in ProductFieldDefinition.objects.filter(product_id=item.product_id)}
            details = []
            for key, value in (item.customer_fields or {}).items():
                d = definitions.get(key)
                details.append(
                    {
                        "key": key,
                        "label_en": (d.label_en if d else "") or key,
                        "label_ar": (d.label_ar if d else "") or "",
                        "value": str(value),
                    }
                )
            item.field_details = details
            changed.append("field_details")
        if changed:
            item.save(update_fields=changed)


def forwards(apps, schema_editor):
    backfill_code_identity(apps, schema_editor)
    backfill_refunds(apps, schema_editor)
    backfill_item_labels(apps, schema_editor)


class Migration(migrations.Migration):
    dependencies = [
        ("commerce", "0007_order_locale_reservation_refund_ledger"),
        ("catalog", "0001_initial"),
    ]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
