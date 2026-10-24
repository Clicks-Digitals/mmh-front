"""Effective stock rules shared by the storefront, admin and checkout.

* CODE variants are in stock only when there is at least one sellable code (AVAILABLE,
  unassigned, minus other orders' reservations - see ``commerce.services.inventory``) **or**
  a supplier mapping that counts as stock (D18), and the manual ``stock_status`` override
  is not ``OUT_OF_STOCK``.
* A supplier mapping counts as stock only when it is not ignored, the supplier is active
  and live purchasing is enabled: ``ONEEPIN_ALLOW_LIVE`` is true **and** the supplier runs
  live (``SUPPLIER_MODE=live`` or its connection environment is LIVE). Mock/test/locked
  suppliers never make a variant sellable.
* DIRECT_TOPUP variants follow the manual ``stock_status`` only.
"""

from __future__ import annotations

from collections.abc import Iterable

from django.conf import settings
from django.db.models import BooleanField, Count, Exists, OuterRef, Q, QuerySet, Value

from catalog.models import FulfillmentType, ProductVariant, StockStatus

AVAILABLE = "AVAILABLE"
PUBLIC_QUANTITY_CAP = 99

MAPPING_REASON_MESSAGES = {
    None: "Counts as stock: the supplier can deliver this variant on demand.",
    "ignored": "Ignored mapping - it does not count as stock.",
    "unmapped_variant": "Not linked to a variant - it does not count as stock.",
    "supplier_inactive": "Supplier is inactive - this mapping does not count as stock.",
    "live_disabled": "Live purchasing is disabled (mock/test mode) - this mapping does not count as stock.",
}


def _inline_available_code_counts(variant_ids: Iterable[int]) -> dict[int, int]:
    from commerce.models import DigitalCode

    ids = [int(v) for v in variant_ids if v is not None]
    if not ids:
        return {}
    rows = (
        DigitalCode.objects.filter(variant_id__in=ids, status=AVAILABLE, order_item__isnull=True)
        .values("variant_id")
        .annotate(n=Count("id"))
    )
    counts = {vid: 0 for vid in ids}
    counts.update({row["variant_id"]: row["n"] for row in rows})
    return counts


def available_code_counts(variant_ids: Iterable[int]) -> dict[int, int]:
    """Sellable code count per variant id (missing ids map to 0).

    Delegates to ``commerce.services.inventory.available_code_counts`` (reservation-aware)
    when it exists so there is one definition; falls back to the raw inline query otherwise.
    """
    ids = [int(v) for v in variant_ids if v is not None]
    try:
        from commerce.services.inventory import available_code_counts as commerce_counts
    except ImportError:
        commerce_counts = None
    if commerce_counts is not None and getattr(commerce_counts, "__module__", "") != __name__:
        counts = {int(k): int(v) for k, v in dict(commerce_counts(ids)).items()}
        for vid in ids:
            counts.setdefault(vid, 0)
        return counts
    return _inline_available_code_counts(ids)


def available_quantities(variant_ids: Iterable[int]) -> dict[int, int]:
    """Public ``available_quantity`` per variant: min(net available, 99)."""
    ids = [int(v) for v in variant_ids if v is not None]
    if not ids:
        return {}
    try:
        from commerce.services.inventory import available_quantity as commerce_quantity
    except ImportError:
        commerce_quantity = None
    if commerce_quantity is not None:
        try:
            result = commerce_quantity(ids)
            if isinstance(result, dict):
                out = {int(k): min(max(int(v), 0), PUBLIC_QUANTITY_CAP) for k, v in result.items()}
                for vid in ids:
                    out.setdefault(vid, 0)
                return out
        except Exception:  # noqa: BLE001 - fall back to the count helper
            pass
    return {vid: min(max(n, 0), PUBLIC_QUANTITY_CAP) for vid, n in available_code_counts(ids).items()}


# --- D18: supplier mappings ------------------------------------------------------------


def live_purchasing_allowed() -> bool:
    return bool(getattr(settings, "ONEEPIN_ALLOW_LIVE", False))


def supplier_is_live(supplier) -> bool:
    if not live_purchasing_allowed():
        return False
    if (getattr(settings, "SUPPLIER_MODE", "mock") or "").lower() == "live":
        return True
    connection = getattr(supplier, "connection", None) if supplier is not None else None
    try:
        return bool(connection is not None and connection.environment == "LIVE")
    except Exception:  # noqa: BLE001 - missing related object
        return False


def mapping_stock_reason(mapping) -> str | None:
    """``None`` when the mapping counts as stock, else a reason code (see MAPPING_REASON_MESSAGES)."""
    if mapping.ignored:
        return "ignored"
    if not mapping.variant_id:
        return "unmapped_variant"
    if not mapping.supplier.active:
        return "supplier_inactive"
    if not supplier_is_live(mapping.supplier):
        return "live_disabled"
    return None


def mapping_stock_payload(mapping) -> dict:
    reason = mapping_stock_reason(mapping)
    return {
        "counts_as_stock": reason is None,
        "counts_as_stock_reason": reason,
        "counts_as_stock_message": MAPPING_REASON_MESSAGES.get(reason, ""),
    }


def _stock_mapping_filter() -> Q | None:
    """Q over SupplierProductMapping for mappings that count as stock; None = none can."""
    if not live_purchasing_allowed():
        return None
    q = Q(ignored=False, supplier__active=True)
    if (getattr(settings, "SUPPLIER_MODE", "mock") or "").lower() != "live":
        q &= Q(supplier__connection__environment="LIVE")
    return q


def active_mapping_variant_ids(variant_ids: Iterable[int]) -> set[int]:
    """Variant ids with a supplier mapping that counts as stock (D18)."""
    from suppliers.models import SupplierProductMapping

    ids = [int(v) for v in variant_ids if v is not None]
    rule = _stock_mapping_filter()
    if not ids or rule is None:
        return set()
    return set(
        SupplierProductMapping.objects.filter(rule, variant_id__in=ids).values_list("variant_id", flat=True).distinct()
    )


def annotate_stock(queryset: QuerySet) -> QuerySet:
    """Annotate a ProductVariant queryset with ``_available_codes`` and ``_has_supplier_mapping``.

    ``_available_codes`` is the raw AVAILABLE count; ``variant_stock`` replaces it with the
    reservation-aware figure when a ``net_available`` map is supplied.
    """
    from suppliers.models import SupplierProductMapping

    rule = _stock_mapping_filter()
    if rule is None:
        mapping_expr = Value(False, output_field=BooleanField())
    else:
        mapping_expr = Exists(SupplierProductMapping.objects.filter(rule, variant_id=OuterRef("pk")))
    return queryset.annotate(
        _available_codes=Count(
            "digital_codes",
            filter=Q(digital_codes__status=AVAILABLE, digital_codes__order_item__isnull=True),
            distinct=True,
        ),
        _has_supplier_mapping=mapping_expr,
    )


def compute_effective_status(
    *, fulfillment_type: str, manual_status: str, available_codes: int, has_supplier_mapping: bool
) -> str:
    if manual_status == StockStatus.OUT_OF_STOCK:
        return StockStatus.OUT_OF_STOCK
    if fulfillment_type == FulfillmentType.DIRECT_TOPUP:
        return StockStatus.IN_STOCK if manual_status == StockStatus.IN_STOCK else manual_status
    if available_codes > 0 or has_supplier_mapping:
        return StockStatus.IN_STOCK
    return StockStatus.OUT_OF_STOCK


def variant_stock(
    variant: ProductVariant, *, fulfillment_type: str | None = None, net_available: dict[int, int] | None = None
) -> tuple[str, int]:
    """(effective_status, sellable_codes) for one variant.

    ``net_available`` (from :func:`available_code_counts`) wins over the raw annotation so
    reserved codes are not sold twice; without it the annotation (or one query) is used.
    """
    ftype = fulfillment_type or variant.product.fulfillment_type
    if net_available is not None and variant.pk in net_available:
        available = net_available[variant.pk]
    else:
        available = getattr(variant, "_available_codes", None)
        if available is None:
            available = available_code_counts([variant.pk]).get(variant.pk, 0)
    has_mapping = getattr(variant, "_has_supplier_mapping", None)
    if has_mapping is None:
        has_mapping = variant.pk in active_mapping_variant_ids([variant.pk])
    status = compute_effective_status(
        fulfillment_type=ftype,
        manual_status=variant.stock_status,
        available_codes=int(available or 0),
        has_supplier_mapping=bool(has_mapping),
    )
    return status, int(available or 0)


def effective_stock_status(variant: ProductVariant) -> str:
    return variant_stock(variant, net_available=available_code_counts([variant.pk]))[0]


def is_variant_available(variant: ProductVariant) -> bool:
    """True when the variant can be sold right now (used by checkout)."""
    return effective_stock_status(variant) == StockStatus.IN_STOCK
