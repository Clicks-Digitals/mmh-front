import type { DigitalDenomination, DigitalRegion, Product } from "@/types";

export function isGiftCardProduct(product: Product) {
  return product.digitalOptions.kind === "gift_card" || product.digitalOptions.kind === "wallet";
}

/** Prefer UAE/MENA for the Jordan storefront when available. */
export function defaultRegionId(regions: DigitalRegion[]): string {
  const preferred = ["uae", "mena", "jordan", "global"];
  for (const id of preferred) {
    if (regions.some((region) => region.id === id)) return id;
  }
  return regions[0]?.id ?? "";
}

/** The region a product page opens on: the usual default, unless it has nothing in stock and another region does. */
export function defaultSellableRegionId(product: Product): string {
  const regions = product.digitalOptions.regions;
  const first = defaultRegionId(regions);
  const order = [first, ...regions.map((region) => region.id).filter((id) => id !== first)];
  return order.find((id) => denominationsForRegion(product, id).some(denominationSellable)) ?? first;
}

export function uniqueFaceValues(items: DigitalDenomination[]): DigitalDenomination[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.value}|${item.currency}|${item.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function denominationsForRegion(product: Product, regionId: string): DigitalDenomination[] {
  const all = product.digitalOptions.denominations;
  if (!regionId) return uniqueFaceValues(all);
  const matching = all.filter((item) => !item.regionId || item.regionId === regionId);
  return matching.length ? matching : uniqueFaceValues(all);
}

export function matchDenominationId(product: Product, regionId: string, currentId: string): string {
  const visible = denominationsForRegion(product, regionId);
  if (visible.some((item) => item.id === currentId)) return currentId;
  const current = product.digitalOptions.denominations.find((item) => item.id === currentId);
  if (current) {
    const sameValue = visible.find(
      (item) => item.value === current.value && item.currency === current.currency && item.inStock !== false,
    );
    if (sameValue) return sameValue.id;
  }
  return visible.find((item) => item.inStock !== false)?.id ?? visible[0]?.id ?? "";
}

/**
 * Whether a variant can be bought right now: not flagged out of stock and, for stock-tracked
 * CODE variants, at least one sellable unit (`availableQuantity` 0 = none; null/undefined = not
 * tracked, e.g. top-ups).
 */
export function denominationSellable(denomination: DigitalDenomination | undefined | null): boolean {
  if (!denomination) return false;
  if (denomination.inStock === false) return false;
  return !(typeof denomination.availableQuantity === "number" && denomination.availableQuantity <= 0);
}
