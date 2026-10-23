import type { MetadataRoute } from "next";
import { absoluteUrl, siteUrl } from "@/lib/site-url";
import { resolveStorefrontCategories, resolveStorefrontProducts } from "@/server/catalog/resolve";

export const revalidate = 3600;

const STATIC_PATHS = [
  "/",
  "/shop",
  "/gift-cards",
  "/game-top-ups",
  "/deals",
  "/brands",
  "/about",
  "/contact",
  "/faq",
  "/terms",
  "/privacy",
  "/digital-product-policy",
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  if (process.env.PANEL_ONLY === "true") return [];
  const [products, categories] = await Promise.all([
    resolveStorefrontProducts().catch(() => []),
    resolveStorefrontCategories().catch(() => []),
  ]);
  const now = new Date();
  const seen = new Set<string>();
  const entries: MetadataRoute.Sitemap = [];
  const add = (path: string, priority: number, lastModified: Date = now) => {
    const url = absoluteUrl(base, path);
    if (seen.has(url)) return;
    seen.add(url);
    entries.push({ url, lastModified, changeFrequency: "daily", priority });
  };
  for (const path of STATIC_PATHS) add(path, path === "/" ? 1 : 0.6);
  for (const category of categories) {
    if (category.href.startsWith("/")) add(category.href.split("?")[0], 0.7);
  }
  for (const product of products) {
    const updated = Date.parse(product.createdAt);
    add(`/product/${product.slug}`, 0.8, Number.isFinite(updated) && updated > 0 ? new Date(updated) : now);
  }
  return entries;
}
