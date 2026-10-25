"""Remote catalog cache (D3): 1Epin ``allProducts`` -> SupplierCatalogItem."""

from __future__ import annotations

import logging
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from suppliers.models import AlertKind, SupplierCatalogItem, SupplierProductMapping
from suppliers.provider import SupplierError, ensure_supplier, get_supplier_provider, to_decimal
from suppliers.services.alerts import raise_alert
from suppliers.services.config import currency

logger = logging.getLogger("suppliers")

PRICE_CHANGE_ALERT_RATIO = Decimal("0.10")
SYNC_INTERVAL = timedelta(hours=24)


def sync_catalog(*, provider=None) -> dict:
    """Upsert every product of the current environment; products no longer listed become inactive.

    Returns ``{ok, created, updated, deactivated, total, price_alerts, message, synced_at}``.
    Raises nothing: failures come back as ``ok: False`` with ``message`` (and ``code``).
    """
    supplier = ensure_supplier()
    if provider is None:
        try:
            provider = get_supplier_provider()
        except SupplierError as exc:
            return {"ok": False, "message": str(exc), "code": "disabled"}
    if not provider.can_authenticate:
        return {"ok": False, "message": "1Epin credentials are not configured", "code": "not_configured"}
    env = provider.environment
    res = provider.client.all_products()
    if not res.ok:
        if res.code in {"02", "03"}:
            raise_alert(supplier, AlertKind.CONFIG, res.readable, dedupe_key=f"config:{res.code}")
        return {"ok": False, "message": res.readable, "code": res.code or "network_error"}
    products = res.data.get("Products")
    if not isinstance(products, list):
        return {"ok": False, "message": "1Epin returned no product list", "code": "bad_response"}

    now = timezone.now()
    created = updated = 0
    price_alerts = 0
    seen: set[str] = set()
    with transaction.atomic():
        existing = {
            item.external_product_id: item
            for item in SupplierCatalogItem.objects.select_for_update().filter(supplier=supplier, environment=env)
        }
        mapped_ids = set(
            SupplierProductMapping.objects.filter(supplier=supplier).values_list("external_product_id", flat=True)
        )
        for row in products:
            if not isinstance(row, dict) or row.get("ProductId") in (None, ""):
                continue
            pid = str(row.get("ProductId")).strip()
            if pid in seen:
                continue
            seen.add(pid)
            price = to_decimal(row.get("ProductPrice"))
            if price is None:
                price = Decimal("0")
            fields = {
                "external_category_id": str(row.get("CategoryId") or "")[:64],
                "category_name": str(row.get("CategoryName") or "")[:255],
                "category_type": str(row.get("CategoryType") or "").strip().lower()[:32],
                "product_name": str(row.get("ProductName") or pid)[:255],
                "currency": currency(),
            }
            item = existing.get(pid)
            if item is None:
                SupplierCatalogItem.objects.create(
                    supplier=supplier,
                    environment=env,
                    external_product_id=pid,
                    price=price,
                    active=True,
                    last_seen_at=now,
                    **fields,
                )
                created += 1
                continue
            old_price = item.price
            changed = any(getattr(item, k) != v for k, v in fields.items()) or old_price != price or not item.active
            if old_price != price:
                item.previous_price = old_price
                if (
                    pid in mapped_ids
                    and old_price
                    and abs(price - old_price) / old_price > PRICE_CHANGE_ALERT_RATIO
                ):
                    price_alerts += 1
                    raise_alert(
                        supplier,
                        AlertKind.PRICE_CHANGE,
                        f"1Epin price of {fields['product_name']} changed from {old_price:.2f} to {price:.2f} {currency()}.",
                        dedupe_key=f"price:{env}:{pid}",
                        meta={"external_product_id": pid, "old": f"{old_price}", "new": f"{price}"},
                    )
            for k, v in fields.items():
                setattr(item, k, v)
            item.price = price
            item.active = True
            item.last_seen_at = now
            item.save()
            if changed:
                updated += 1
        missing = [pid for pid in existing if pid not in seen and existing[pid].active]
        deactivated = SupplierCatalogItem.objects.filter(
            supplier=supplier, environment=env, external_product_id__in=missing
        ).update(active=False, updated_at=now)
        # Link mappings that were created by id to the cached item of this environment.
        for mapping in SupplierProductMapping.objects.filter(supplier=supplier, catalog_item__isnull=True):
            item = SupplierCatalogItem.objects.filter(
                supplier=supplier, environment=env, external_product_id=mapping.external_product_id
            ).first()
            if item is not None:
                mapping.catalog_item = item
                mapping.category_type = mapping.category_type or item.category_type
                mapping.save(update_fields=["catalog_item", "category_type"])

    result = {
        "ok": True,
        "created": created,
        "updated": updated,
        "deactivated": deactivated,
        "total": len(seen),
        "price_alerts": price_alerts,
        "environment": env,
        "synced_at": now.isoformat(),
        "message": f"Synced {len(seen)} products ({created} new, {updated} updated, {deactivated} deactivated)",
    }
    connection = supplier.connection
    connection.last_catalog_sync_at = now
    connection.last_catalog_sync_result = {k: v for k, v in result.items() if k != "ok"}
    meta = dict(connection.meta or {})
    meta.setdefault("catalog_synced_at", {})[env] = now.isoformat()
    connection.meta = meta
    connection.save(update_fields=["last_catalog_sync_at", "last_catalog_sync_result", "meta", "updated_at"])
    logger.info("1Epin catalog sync (%s): %s", env, result["message"])
    return result


def catalog_synced_at(supplier, environment: str):
    from django.utils.dateparse import parse_datetime

    meta = (getattr(supplier, "connection", None) and supplier.connection.meta) or {}
    raw = (meta.get("catalog_synced_at") or {}).get(environment)
    return parse_datetime(raw) if raw else None


def sync_due(supplier, environment: str) -> bool:
    last = catalog_synced_at(supplier, environment)
    return last is None or timezone.now() - last >= SYNC_INTERVAL


def catalog_item_for(supplier, external_product_id: str, environment: str):
    return SupplierCatalogItem.objects.filter(
        supplier=supplier, environment=environment, external_product_id=str(external_product_id)
    ).first()
