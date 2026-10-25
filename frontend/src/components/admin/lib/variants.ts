/** "PUBG Mobile – 60 UC"; either part may be missing (falls back to the other, then ""). */
export function variantDisplayName(productName?: string | null, variantName?: string | null): string {
  const product = (productName ?? "").trim();
  const variant = (variantName ?? "").trim();
  if (product && variant) return product === variant ? product : `${product} – ${variant}`;
  return product || variant;
}

/** One-line label for a <select> option: "PUBG Mobile – 60 UC (PUBG-60)"; SKU alone when nothing else is known. */
export function variantOptionLabel(v: {
  product_name?: string | null;
  name_en?: string | null;
  sku?: string | null;
}): string {
  const name = variantDisplayName(v.product_name, v.name_en);
  const sku = (v.sku ?? "").trim();
  if (name && sku) return `${name} (${sku})`;
  return name || sku || "—";
}
