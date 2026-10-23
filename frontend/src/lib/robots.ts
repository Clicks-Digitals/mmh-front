import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site-url";

/** robots.txt rules: a panel-only deployment is never indexed. */
export function robotsRules(panelOnly: boolean, base: string): MetadataRoute.Robots {
  if (panelOnly) return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/account", "/checkout", "/api", "/cart", "/order", "/order-success", "/order-lookup", "/reset-password"],
      },
    ],
    sitemap: absoluteUrl(base, "/sitemap.xml"),
    host: base,
  };
}
