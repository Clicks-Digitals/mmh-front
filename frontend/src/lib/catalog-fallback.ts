/**
 * Static catalog fallback is for development only.
 * Production (NODE_ENV=production) never shows static products unless explicitly enabled.
 */
export function allowStaticCatalogFallback(): boolean {
  if (process.env.NEXT_PUBLIC_ALLOW_STATIC_CATALOG_FALLBACK === "true") return true;
  if (process.env.NEXT_PUBLIC_ALLOW_STATIC_CATALOG_FALLBACK === "false") return false;
  return process.env.NODE_ENV !== "production";
}
