import { pageMeta } from "@/lib/seo";
import { cmsPageHref, CmsPageView, isLegalSlug, legalMetadata, loadAnyCmsPage } from "@/server/legal-page";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  if (isLegalSlug(slug)) return legalMetadata(slug);
  const page = await loadAnyCmsPage(slug).catch(() => null);
  if (!page) return { title: "Page not found", robots: { index: false, follow: false } };
  const description = (page.body_en || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  return pageMeta(page.title_en || slug, description || page.title_en || slug, cmsPageHref(slug));
}

/** D19: any published CMS page. */
export default async function CmsPage({ params }: { params: Params }) {
  const { slug } = await params;
  return <CmsPageView slug={slug} />;
}
