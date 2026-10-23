"use client";

import { SLUG_RE, SimpleCrudPage, str } from "@/components/admin/modules/simple-crud";
import { Badge } from "@/components/admin/ui/badge";
import { ADMIN_LIST_PAGE_SIZE } from "@/components/admin/admin-list-page";
import { formatAdminDateTime } from "@/lib/admin/format";
import { asList, createPage, deletePage, listPages, updatePage, type ContentPage } from "@/lib/api/admin";

const OVERRIDE_SLUGS = ["about", "terms", "privacy", "digital-product-policy"];

export function PagesListClient() {
  return (
    <SimpleCrudPage<ContentPage>
      title="Pages"
      noun="Page"
      description="Static content pages. Published pages with the slugs about, terms, privacy or digital-product-policy replace the store's built-in versions of those pages."
      writePermission="content.write"
      searchPlaceholder="Search pages…"
      wide
      list={async (tok, p, s) =>
        asList(await listPages(tok, { page: p, page_size: ADMIN_LIST_PAGE_SIZE, search: s || undefined }))
      }
      create={(tok, body) => createPage(tok, body as Partial<ContentPage>)}
      update={(tok, row, body) => updatePage(tok, row.slug, body as Partial<ContentPage>)}
      remove={(tok, row) => deletePage(tok, row.slug)}
      deleteDescription={(r) =>
        OVERRIDE_SLUGS.includes(r.slug)
          ? `Delete “${r.title_en}”. The store falls back to its built-in /${r.slug} page.`
          : `Permanently delete “${r.title_en}” (/${r.slug}).`
      }
      columns={[
        {
          key: "title",
          header: "Title",
          render: (r) => (
            <div>
              <p className="font-medium">{r.title_en}</p>
              {r.title_ar ? <p className="text-xs text-[var(--clicks-muted)]" dir="rtl">{r.title_ar}</p> : null}
            </div>
          ),
        },
        {
          key: "slug",
          header: "Slug",
          render: (r) => (
            <span className="font-mono text-xs">
              /{r.slug}
              {OVERRIDE_SLUGS.includes(r.slug) ? <span className="ms-2 font-sans"><Badge tone="info">Overrides default</Badge></span> : null}
            </span>
          ),
        },
        { key: "status", header: "Status", render: (r) => <Badge status={r.published ? "PUBLISHED" : "DRAFT"} /> },
        { key: "updated", header: "Updated", render: (r) => formatAdminDateTime(r.updated_at) },
      ]}
      emptyValues={{ slug: "", title_en: "", title_ar: "", body_en: "", body_ar: "", published: true }}
      toValues={(r) => ({
        slug: r.slug,
        title_en: r.title_en,
        title_ar: r.title_ar ?? "",
        body_en: r.body_en ?? "",
        body_ar: r.body_ar ?? "",
        published: r.published,
      })}
      validate={(v) => (SLUG_RE.test(str(v, "slug")) ? {} : { slug: "Lowercase letters, numbers and dashes" })}
      toPayload={(v) => ({
        slug: str(v, "slug"),
        title_en: str(v, "title_en"),
        title_ar: str(v, "title_ar"),
        body_en: String(v.body_en ?? ""),
        body_ar: String(v.body_ar ?? ""),
        published: Boolean(v.published),
      })}
      fields={[
        {
          name: "slug",
          label: "Slug",
          required: true,
          mono: true,
          full: true,
          hint: "about, terms, privacy and digital-product-policy override the store's default pages.",
        },
        { name: "title_en", label: "Title (EN)", required: true, maxLength: 255 },
        { name: "title_ar", label: "Title (AR)", rtl: true, maxLength: 255 },
        { name: "body_en", label: "Body (EN)", type: "textarea", required: true, hint: "Page text shown on the store. Separate paragraphs with a blank line." },
        { name: "body_ar", label: "Body (AR)", type: "textarea", rtl: true },
        { name: "published", label: "Published", type: "checkbox", hint: "Unpublished pages return “not found” on the store." },
      ]}
    />
  );
}
