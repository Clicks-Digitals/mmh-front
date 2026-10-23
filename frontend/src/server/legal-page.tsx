import sanitizeHtml from "sanitize-html";
import { LEGAL_DEFAULTS, type LegalSlug } from "@/data/legal";
import { getPage, type ApiCmsPage } from "@/lib/api/cms";
import { formatDate } from "@/lib/format";
import { pageMeta } from "@/lib/seo";
import { serverT } from "@/server/locale";
import type { Metadata } from "next";

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
