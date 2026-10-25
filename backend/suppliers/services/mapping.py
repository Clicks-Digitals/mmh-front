"""Mapping helpers (D4): cost / margin in JOD, top-up user templates, mapping lookup."""

from __future__ import annotations

import re
from decimal import Decimal

from suppliers.models import SupplierCatalogItem, SupplierProductMapping
from suppliers.provider import SUPPLIER_SLUG
from suppliers.services.config import current_environment, fils_display, to_fils

PLAYER_KEY_RE = re.compile(r"^(player[_\- ]?id|user[_\- ]?id|uid|account[_\- ]?id|game[_\- ]?id|id)$", re.I)
TEMPLATE_KEY_RE = re.compile(r"\{([^{}]+)\}")


class TemplateError(ValueError):
    pass


def mapping_catalog_item(mapping: SupplierProductMapping, environment: str | None = None) -> SupplierCatalogItem | None:
    """Cached catalog row for the mapping in the given (default: current) environment."""
    env = environment or current_environment()
    item = mapping.catalog_item if mapping.catalog_item_id else None
    if item is not None and item.environment == env:
        return item
    return SupplierCatalogItem.objects.filter(
        supplier_id=mapping.supplier_id, environment=env, external_product_id=str(mapping.external_product_id)
    ).first()


def active_mapping_for_variant(variant_id: int, *, require_auto_buy: bool = True) -> SupplierProductMapping | None:
    qs = SupplierProductMapping.objects.select_related("supplier", "catalog_item", "variant").filter(
        variant_id=variant_id, ignored=False, supplier__slug=SUPPLIER_SLUG, supplier__active=True
    )
    if require_auto_buy:
        qs = qs.filter(auto_buy=True)
    return qs.order_by("id").first()


def unit_cost(mapping: SupplierProductMapping, item: SupplierCatalogItem | None) -> Decimal | None:
    """Supplier-currency cost of ONE of our units."""
    if item is None:
        return None
    return Decimal(item.price) * max(int(mapping.quantity_per_unit or 1), 1)


def default_player_key(field_details: list | None, customer_fields: dict | None) -> str | None:
    keys = [str(f.get("key")) for f in (field_details or []) if isinstance(f, dict) and f.get("key")]
    keys += [k for k in (customer_fields or {}) if k not in keys]
    for key in keys:
        if PLAYER_KEY_RE.match(key.strip()):
            return key
    return keys[0] if keys else None


def render_user(template: str, customer_fields: dict | None, field_details: list | None = None) -> str:
    """Render the 1Epin ``user`` value from the item's customer fields.

    ``template`` like ``"{userId}({zoneId})"``; blank -> ``"{<player id field>}"``.
    """
    values = {str(k): str(v).strip() for k, v in (customer_fields or {}).items() if v not in (None, "")}
    for field in field_details or []:
        if isinstance(field, dict) and field.get("key") and field.get("value") not in (None, ""):
            values.setdefault(str(field["key"]), str(field["value"]).strip())
    template = (template or "").strip()
    if not template:
        key = default_player_key(field_details, customer_fields)
        if not key:
            raise TemplateError("The order item has no player id field")
        template = "{" + key + "}"
    lowered = {k.lower(): v for k, v in values.items()}
    missing: list[str] = []

    def repl(match):
        key = match.group(1).strip()
        value = values.get(key, lowered.get(key.lower()))
        if not value:
            missing.append(key)
            return ""
        return value

    rendered = TEMPLATE_KEY_RE.sub(repl, template).strip()
    if missing:
        raise TemplateError(f"Missing customer field(s): {', '.join(missing)}")
    if not rendered:
        raise TemplateError("The player id is empty")
    return rendered[:255]


def mapping_payload(mapping: SupplierProductMapping) -> dict:
    """Shared admin shape for a mapping (catalog product tab and the 1Epin page)."""
    from catalog.stock import mapping_stock_payload

    item = mapping_catalog_item(mapping)
    cost = unit_cost(mapping, item)
    cost_fils = to_fils(cost)
    variant = mapping.variant if mapping.variant_id else None
    sale_fils = variant.price_fils if variant is not None else None
    margin_fils = (sale_fils - cost_fils) if (sale_fils is not None and cost_fils is not None) else None
    margin_pct = round(margin_fils * 100 / sale_fils, 2) if (margin_fils is not None and sale_fils) else None
    warnings: list[str] = []
    if margin_fils is not None and margin_fils < 0:
        warnings.append("Supplier cost is above the sale price (selling at a loss).")
    if mapping.max_cost_fils is not None and cost_fils is not None and cost_fils > mapping.max_cost_fils:
        warnings.append("Supplier cost is above the max cost limit: auto-buy will be skipped.")
    if item is None:
        warnings.append("Not found in the synced 1Epin catalog for this mode: sync the catalog.")
    elif not item.active:
        warnings.append("1Epin no longer lists this product.")
    return {
        "id": mapping.id,
        "supplier_id": mapping.supplier_id,
        "supplier_slug": mapping.supplier.slug,
        "supplier_name": mapping.supplier.name,
        "product": mapping.product_id,
        "product_name": mapping.product.name_en if mapping.product_id else None,
        "product_slug": mapping.product.slug if mapping.product_id else None,
        "variant": mapping.variant_id,
        "variant_name": variant.name_en if variant is not None else None,
        "variant_sku": variant.sku if variant is not None else None,
        "external_product_id": mapping.external_product_id,
        "external_name": mapping.external_name,
        "ignored": mapping.ignored,
        "created_at": mapping.created_at,
        "catalog_item_id": item.id if item is not None else None,
        "catalog_item": catalog_item_brief(item),
        "category_type": mapping.category_type or (item.category_type if item else ""),
        "quantity_per_unit": mapping.quantity_per_unit,
        "prefer_supplier": mapping.prefer_supplier,
        "auto_buy": mapping.auto_buy,
        "allow_loss": mapping.allow_loss,
        "max_cost_fils": mapping.max_cost_fils,
        "user_template": mapping.user_template,
        "barem": str(mapping.barem) if mapping.barem is not None else None,
        "cost": f"{cost:.4f}" if cost is not None else None,
        "cost_currency": item.currency if item is not None else None,
        "cost_fils": cost_fils,
        "cost_jod": fils_display(cost_fils),
        "sale_price_fils": sale_fils,
        "sale_price_jod": fils_display(sale_fils),
        "margin_fils": margin_fils,
        "margin_jod": fils_display(margin_fils),
        "margin_pct": margin_pct,
        "warning": warnings[0] if warnings else "",
        "warnings": warnings,
        **mapping_stock_payload(mapping),
    }


def catalog_item_brief(item: SupplierCatalogItem | None) -> dict | None:
    if item is None:
        return None
    cost_fils = to_fils(Decimal(item.price))
    return {
        "id": item.id,
        "environment": item.environment,
        "external_product_id": item.external_product_id,
        "external_category_id": item.external_category_id,
        "category_name": item.category_name,
        "category_type": item.category_type,
        "product_name": item.product_name,
        "price": f"{item.price:.4f}",
        "previous_price": f"{item.previous_price:.4f}" if item.previous_price is not None else None,
        "currency": item.currency,
        "cost_fils": cost_fils,
        "cost_jod": fils_display(cost_fils),
        "is_tiered": item.is_tiered,
        "active": item.active,
        "last_seen_at": item.last_seen_at,
    }
