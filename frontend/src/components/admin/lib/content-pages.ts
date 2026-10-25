/** D19: these slugs replace the store's built-in pages at the same address. */
export const BUILT_IN_PAGE_SLUGS = ["about", "terms", "privacy", "digital-product-policy"];

/** Store address of a content page: built-in slugs keep their own route, others live under /pages/. */
export function storePagePath(slug: string): string {
  return BUILT_IN_PAGE_SLUGS.includes(slug) ? `/${slug}` : `/pages/${slug}`;
}
