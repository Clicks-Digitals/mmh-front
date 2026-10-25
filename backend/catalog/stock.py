"""Effective stock rules shared by the storefront, admin and checkout.

* CODE variants are in stock only when there is at least one sellable code (AVAILABLE,
  unassigned, minus other orders' reservations - see ``commerce.services.inventory``) **or**
  a supplier mapping that counts as stock (D18), and the manual ``stock_status`` override
  is not ``OUT_OF_STOCK``.
* A supplier mapping counts as stock (D-1E-10) only when it is not ignored, linked to a
  variant, its supplier is the active 1Epin supplier, ``auto_buy`` is on, the mapped product is
  active in the synced 1Epin catalog of the current mode and was seen by a sync < 48 h ago, and
  the mode can really buy: ``SUPPLIER_MODE=live`` + ``ONEEPIN_ALLOW_LIVE`` + credentials, or
  test/mock mode with ``ONEEPIN_TEST_COUNTS_AS_STOCK=true`` (staging rehearsals).
* DIRECT_TOPUP variants follow the manual ``stock_status`` only.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import timedelta

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
    "unsupported_supplier": "Only 1Epin mappings can be bought automatically - it does not count as stock.",
    "auto_buy_off": "Auto-buy is off - this mapping does not count as stock.",
    "catalog_missing": "Not in the synced 1Epin catalog (or no longer sold) - it does not count as stock.",
    "catalog_stale": "The 1Epin catalog was not synced in the last 48 hours - it does not count as stock.",
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


# --- D18 / D-1E-10: supplier mappings ---------------------------------------------------


def live_purchasing_allowed() -> bool:
    """Supplier mappings may count as stock in the current mode (see module docstring)."""
    from suppliers.services.config import mapping_stock_mode_ok

    return mapping_stock_mode_ok()


def supplier_is_live(supplier) -> bool:
    """True when this supplier buys for real right now (live mode, switch on, credentials)."""
    from suppliers.provider import SUPPLIER_SLUG
    from suppliers.services.config import credentials_configured, live_enabled

    if supplier is None or getattr(supplier, "slug", None) != SUPPLIER_SLUG:
        return False
    return live_enabled() and credentials_configured()


def _catalog_cutoff():
    from django.utils import timezone

    from suppliers.services.config import CATALOG_MAX_AGE_HOURS

    return timezone.now() - timedelta(hours=CATALOG_MAX_AGE_HOURS)


def mapping_stock_reason(mapping) -> str | None:
    """``None`` when the mapping counts as stock, else a reason code (see MAPPING_REASON_MESSAGES)."""
    from suppliers.provider import SUPPLIER_SLUG
    from suppliers.services.mapping import mapping_catalog_item

    if mapping.ignored:
        return "ignored"
    if not mapping.variant_id:
        return "unmapped_variant"
    if not mapping.supplier.active:
        return "supplier_inactive"
    if mapping.supplier.slug != SUPPLIER_SLUG:
        return "unsupported_supplier"
    if not live_purchasing_allowed():
        return "live_disabled"
    if not getattr(mapping, "auto_buy", True):
        return "auto_buy_off"
    item = mapping_catalog_item(mapping)
    if item is None or not item.active:
        return "catalog_missing"
    if item.last_seen_at is None or item.last_seen_at < _catalog_cutoff():
        return "catalog_stale"
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
    from suppliers.models import SupplierCatalogItem
    from suppliers.provider import SUPPLIER_SLUG
    from suppliers.services.config import current_environment

    fresh_item = SupplierCatalogItem.objects.filter(
        supplier_id=OuterRef("supplier_id"),
        environment=current_environment(),
        external_product_id=OuterRef("external_product_id"),
        active=True,
        last_seen_at__gte=_catalog_cutoff(),
    )
    return Q(
        Exists(fresh_item),
        ignored=False,
        auto_buy=True,
        supplier__active=True,
        supplier__slug=SUPPLIER_SLUG,
        variant__isnull=False,
    )


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
