import type { MetadataRoute } from "next";
import { robotsRules } from "@/lib/robots";
import { siteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return robotsRules(process.env.PANEL_ONLY === "true", siteUrl());
}
