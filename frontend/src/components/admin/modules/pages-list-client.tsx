"use client";

import { SimpleCrudPage, crudListParams, str, type CrudValues } from "@/components/admin/modules/simple-crud";
import { Badge } from "@/components/admin/ui/badge";
import { formatAdminDateTime } from "@/lib/admin/format";
import { asList, createPage, deletePage, listPages, updatePage, type ContentPage } from "@/lib/api/admin";

/** D19: these slugs replace the store's built-in pages at the same address. */
export const BUILT_IN_PAGE_SLUGS = ["about", "terms", "privacy", "digital-product-policy"];

/** Store address of a content page: built-in slugs keep their own route, others live under /pages/. */
export function storePagePath(slug: string): string {
  return BUILT_IN_PAGE_SLUGS.includes(slug) ? `/${slug}` : `/pages/${slug}`;
}

function slugHint(values: CrudValues) {
  const slug = str(values, "slug");
  if (!slug) return "Filled in from the English title, e.g. shipping-info. Lowercase letters, numbers and dashes.";
  if (BUILT_IN_PAGE_SLUGS.includes(slug))
    return `This replaces the store's built-in “${slug}” page at /${slug}.`;
  return `The page will be at /pages/${slug}.`;
}

export function PagesListClient() {
  return (
    <SimpleCrudPage<ContentPage>
      title="Pages"
      noun="Page"
      description="Text pages of the store. Every published page is reachable at /pages/<web address>. The addresses about, terms, privacy and digital-product-policy replace the store's built-in versions of those pages. Tick “Show in footer” to link a page at the bottom of every store page."
      writePermission="content.write"
      searchPlaceholder="Search pages…"
      slugFrom="title_en"
      defaultOrdering="sort_order"
      wide
      list={async (tok, s) => asList(await listPages(tok, crudListParams(s, "sort_order")))}
      create={(tok, body) => createPage(tok, body as Partial<ContentPage>)}
      update={(tok, row, body) => updatePage(tok, row.slug, body as Partial<ContentPage>)}
      remove={(tok, row) => deletePage(tok, row.slug)}
      deleteDescription={(r) =>
        BUILT_IN_PAGE_SLUGS.includes(r.slug)
          ? `Delete “${r.title_en}”. The store goes back to its built-in /${r.slug} page.`
          : `Permanently delete “${r.title_en}”. Links to ${storePagePath(r.slug)} will show “page not found”.`
      }
      extraRowActions={(r) =>
        r.published ? (
          <a
            href={storePagePath(r.slug)}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-[var(--clicks-muted)] hover:text-[var(--clicks-blue)]"
          >
            View on store
          </a>
        ) : null
      }
      columns={[
        {
          key: "title",
          header: "Title",
          mobilePrimary: true,
          render: (r) => (
            <div>
              <p className="font-medium">{r.title_en}</p>
              {r.title_ar ? (
                <p className="text-xs text-[var(--clicks-muted)]" dir="rtl">
                  {r.title_ar}
                </p>
              ) : null}
            </div>
          ),
        },
        {
          key: "slug",
          header: "Address on store",
          sortKey: "slug",
          render: (r) => (
            <span className="font-mono text-xs">
              {storePagePath(r.slug)}
              {BUILT_IN_PAGE_SLUGS.includes(r.slug) ? (
                <span className="ms-2 font-sans">
                  <Badge tone="info">Replaces built-in page</Badge>
                </span>
              ) : null}
            </span>
          ),
        },
        {
          key: "footer",
          header: "In footer",
          render: (r) => (r.show_in_footer ? <Badge tone="success">Yes</Badge> : <span className="text-[var(--clicks-muted)]">No</span>),
        },
        {
          key: "status",
          header: "Status",
          render: (r) => <Badge status={r.published ? "PUBLISHED" : "DRAFT"}>{r.published ? "Published" : "Hidden"}</Badge>,
        },
        { key: "sort", header: "Sort", sortKey: "sort_order", className: "tabular-nums", render: (r) => r.sort_order ?? 0 },
        { key: "updated", header: "Updated", sortKey: "updated_at", sortFirst: "desc", render: (r) => formatAdminDateTime(r.updated_at) },
      ]}
      emptyValues={{ slug: "", title_en: "", title_ar: "", body_en: "", body_ar: "", published: true, show_in_footer: false, sort_order: "0" }}
      toValues={(r) => ({
        slug: r.slug,
        title_en: r.title_en,
        title_ar: r.title_ar ?? "",
        body_en: r.body_en ?? "",
        body_ar: r.body_ar ?? "",
        published: r.published,
        show_in_footer: Boolean(r.show_in_footer),
        sort_order: String(r.sort_order ?? 0),
      })}
      validate={(v) => {
        const slug = str(v, "slug");
        if (!slug) return { slug: "Enter a web address, e.g. shipping-info." };
        return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
          ? {}
          : { slug: "Use only lowercase letters, numbers and single dashes (no spaces), e.g. shipping-info." };
      }}
      toPayload={(v) => ({
        slug: str(v, "slug"),
        title_en: str(v, "title_en"),
        title_ar: str(v, "title_ar"),
        body_en: String(v.body_en ?? ""),
        body_ar: String(v.body_ar ?? ""),
        published: Boolean(v.published),
        show_in_footer: Boolean(v.show_in_footer),
        sort_order: Number(str(v, "sort_order")) || 0,
      })}
      fields={[
        { name: "title_en", label: "Title (English)", required: true, maxLength: 255 },
        { name: "title_ar", label: "Title (Arabic)", optional: true, rtl: true, maxLength: 255 },
        { name: "slug", label: "Web address (slug)", required: true, mono: true, full: true, hint: slugHint },
        {
          name: "body_en",
          label: "Text (English)",
          type: "textarea",
          required: true,
          hint: "Shown on the store. Separate paragraphs with a blank line.",
        },
        { name: "body_ar", label: "Text (Arabic)", type: "textarea", optional: true, rtl: true },
        { name: "sort_order", label: "Footer order", type: "number", hint: "Lower numbers are listed first in the footer." },
        { name: "published", label: "Published", type: "checkbox", hint: "Hidden pages show “page not found” on the store." },
        { name: "show_in_footer", label: "Show in footer", type: "checkbox", hint: "Adds a link to this page in the footer of every store page." },
      ]}
    />
  );
}
