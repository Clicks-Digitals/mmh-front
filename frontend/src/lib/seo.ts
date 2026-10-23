import { SITE } from "@/config/site";
import { absoluteUrl } from "@/lib/site-url";
import type { Metadata } from "next";

export function pageMeta(title: string, description: string, path = "/"): Metadata {
  const url = absoluteUrl(SITE.url, path);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE.name,
      type: "website",
      locale: "en_JO",
      alternateLocale: ["ar_JO"],
      images: [{ url: absoluteUrl(SITE.url, "/brand/IMG_4556.png"), width: 512, height: 512, alt: SITE.name }],
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export function noIndexMeta(title: string): Metadata {
  return { title, robots: { index: false, follow: false } };
}
