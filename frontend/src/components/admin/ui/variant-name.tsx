import { variantDisplayName } from "@/components/admin/lib/variants";

/** "<Product> – <Variant>" with the SKU as secondary text (falls back to the SKU alone). */
export function VariantName({
  productName,
  variantName,
  sku,
  empty = "—",
}: {
  productName?: string | null;
  variantName?: string | null;
  sku?: string | null;
  empty?: string;
}) {
  const name = variantDisplayName(productName, variantName);
  if (!name && !sku) return <span className="text-xs">{empty}</span>;
  if (!name) return <span className="font-mono text-xs">{sku}</span>;
  return (
    <div className="min-w-0">
      <p className="break-words text-xs">{name}</p>
      {sku ? <p className="font-mono text-[11px] text-[var(--clicks-muted)]">{sku}</p> : null}
    </div>
  );
}
