import sanitizeHtml from "sanitize-html";
import { LEGAL_DEFAULTS, type LegalSlug } from "@/data/legal";
import { getPage, listPages, type ApiCmsPage } from "@/lib/api/cms";
import { ApiError } from "@/lib/api/client";
import { notFound } from "next/navigation";
import { formatDate } from "@/lib/format";
import { pageMeta } from "@/lib/seo";
import { serverT } from "@/server/locale";
import type { Metadata } from "next";

export const CMS_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isLegalSlug(slug: string): slug is LegalSlug {
  return Object.prototype.hasOwnProperty.call(LEGAL_DEFAULTS, slug);
}

/** Public URL of a CMS page: built-in slugs keep their own route (D19). */
export function cmsPageHref(slug: string): string {
  return isLegalSlug(slug) ? `/${slug}` : `/pages/${slug}`;
}

export type FooterPage = { slug: string; href: string; title: string; titleAr: string };

/** D19: published pages flagged show_in_footer, in sort order. */
export async function loadFooterPages(): Promise<FooterPage[]> {
  try {
    const data = await listPages();
    const rows = Array.isArray(data) ? data : data.results;
    return rows
      .filter((row) => row.show_in_footer && row.slug)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((row) => ({ slug: row.slug, href: cmsPageHref(row.slug), title: row.title_en || row.slug, titleAr: row.title_ar || row.title_en || row.slug }));
  } catch {
    return [];
  }
}

/** Any published CMS page (D19); null when it does not exist or is unpublished. */
export async function loadAnyCmsPage(slug: string): Promise<ApiCmsPage | null> {
  if (!CMS_SLUG_RE.test(slug)) return null;
  try {
    return await getPage(slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** /pages/<slug>: a published CMS page in the current language. */
export async function CmsPageView({ slug }: { slug: string }) {
  if (isLegalSlug(slug)) return <LegalPage slug={slug} />;
  const [{ t, locale }, page] = await Promise.all([serverT(), loadAnyCmsPage(slug).catch(() => null)]);
  if (!page) notFound();
  const title = locale === "ar" ? page.title_ar || page.title_en : page.title_en || page.title_ar;
  const body = locale === "ar" ? page.body_ar || page.body_en : page.body_en || page.body_ar;
  return (
    <div className="container-mmh max-w-3xl py-10 text-sm leading-7 text-muted md:py-14">
      <h1 className="text-2xl font-semibold text-fg sm:text-3xl">{title}</h1>
      {page.updated_at ? <p className="mt-2 text-xs">{t("legal.updated", { date: formatDate(page.updated_at, locale) })}</p> : null}
      <div className="mt-6">
        <CmsBody body={body || ""} />
      </div>
    </div>
  );
}

async function loadCmsPage(slug: LegalSlug): Promise<ApiCmsPage | null> {
  try {
    const page = await getPage(slug);
    return page && (page.body_en || page.body_ar) ? page : null;
  } catch {
    return null;
  }
}

export function legalMetadata(slug: LegalSlug): Metadata {
  const fallback = LEGAL_DEFAULTS[slug];
  return pageMeta(fallback.title.en, fallback.description, `/${slug}`);
}

function CmsBody({ body }: { body: string }) {
  if (/<[a-z][\s\S]*>/i.test(body)) {
    const html = sanitizeHtml(body, {
      allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "a", "ul", "ol", "li", "h2", "h3", "h4", "blockquote", "hr"],
      allowedAttributes: { a: ["href", "target", "rel"] },
      allowedSchemes: ["http", "https", "mailto", "tel"],
      transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }) },
    });
    return <div className="cms-body space-y-4 [&_a]:text-accent [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-fg [&_ol]:list-decimal [&_ol]:ps-5 [&_ul]:list-disc [&_ul]:ps-5" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return (
    <div className="space-y-4">
      {body
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph, index) => (
          <p key={index} className="whitespace-pre-line">
            {paragraph}
          </p>
        ))}
    </div>
  );
}

/** Info page: published CMS content when available, otherwise the bilingual default. */
export async function LegalPage({ slug }: { slug: LegalSlug }) {
  const [{ t, locale }, page] = await Promise.all([serverT(), loadCmsPage(slug)]);
  const fallback = LEGAL_DEFAULTS[slug];
  const title = page ? (locale === "ar" ? page.title_ar || page.title_en : page.title_en) : fallback.title[locale];
  const body = page ? (locale === "ar" ? page.body_ar || page.body_en : page.body_en || page.body_ar) : "";

  return (
    <div className="container-mmh max-w-3xl py-10 text-sm leading-7 text-muted md:py-14">
      <h1 className="text-2xl font-semibold text-fg sm:text-3xl">{title}</h1>
      {page?.updated_at ? <p className="mt-2 text-xs">{t("legal.updated", { date: formatDate(page.updated_at, locale) })}</p> : null}
      <div className="mt-6">
        {page ? (
          <CmsBody body={body} />
        ) : (
          <div className="space-y-6">
            {fallback.sections.map((section, index) => (
              <section key={index}>
                {section.heading ? <h2 className="text-base font-semibold text-fg">{section.heading[locale]}</h2> : null}
                <p className={section.heading ? "mt-2" : undefined}>{section.body[locale]}</p>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
