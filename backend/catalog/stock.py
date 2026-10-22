"""Effective stock rules shared by the storefront, admin and checkout.

* CODE variants are in stock only when there is at least one AVAILABLE, unassigned
  digital code **or** an active supplier mapping (supplier can fulfil on demand), and
  the manual ``stock_status`` override is not ``OUT_OF_STOCK``.
* DIRECT_TOPUP variants follow the manual ``stock_status`` only.
"""

from __future__ import annotations

from collections.abc import Iterable

from django.db.models import Count, Exists, OuterRef, Q, QuerySet

from catalog.models import FulfillmentType, ProductVariant, StockStatus

AVAILABLE = "AVAILABLE"


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
    """AVAILABLE, unassigned code count per variant id (missing ids map to 0).

    Delegates to ``commerce.services.inventory.available_code_counts`` when it exists so
    there is one definition; falls back to the identical inline query otherwise.
    """
    ids = list(variant_ids)
    try:
        from commerce.services.inventory import available_code_counts as commerce_counts
    except ImportError:
        commerce_counts = None
    if commerce_counts is not None and getattr(commerce_counts, "__module__", "") != __name__:
        counts = dict(commerce_counts(ids))
        for vid in ids:
            counts.setdefault(int(vid), 0)
        return counts
    return _inline_available_code_counts(ids)


def active_mapping_variant_ids(variant_ids: Iterable[int]) -> set[int]:
    from suppliers.models import SupplierProductMapping

    ids = [int(v) for v in variant_ids if v is not None]
    if not ids:
        return set()
    return set(
        SupplierProductMapping.objects.filter(variant_id__in=ids, ignored=False, supplier__active=True)
        .values_list("variant_id", flat=True)
        .distinct()
    )


def annotate_stock(queryset: QuerySet) -> QuerySet:
    """Annotate a ProductVariant queryset with ``_available_codes`` and ``_has_supplier_mapping``."""
    from suppliers.models import SupplierProductMapping

    return queryset.annotate(
        _available_codes=Count(
            "digital_codes",
            filter=Q(digital_codes__status=AVAILABLE, digital_codes__order_item__isnull=True),
            distinct=True,
        ),
        _has_supplier_mapping=Exists(
            SupplierProductMapping.objects.filter(variant_id=OuterRef("pk"), ignored=False, supplier__active=True)
        ),
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


def variant_stock(variant: ProductVariant, *, fulfillment_type: str | None = None) -> tuple[str, int]:
    """(effective_status, available_codes) for one variant, using annotations when present."""
    ftype = fulfillment_type or variant.product.fulfillment_type
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
    return variant_stock(variant)[0]


def is_variant_available(variant: ProductVariant) -> bool:
    """True when the variant can be sold right now (used by checkout)."""
    return effective_stock_status(variant) == StockStatus.IN_STOCK
