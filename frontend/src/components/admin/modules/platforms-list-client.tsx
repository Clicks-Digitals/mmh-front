"use client";

import { SLUG_RE, SimpleCrudPage, str } from "@/components/admin/modules/simple-crud";
import { Badge } from "@/components/admin/ui/badge";
import { ADMIN_LIST_PAGE_SIZE } from "@/components/admin/admin-list-page";
import {
  asList,
  createPlatform,
  deletePlatform,
  listPlatforms,
  updatePlatform,
  type AdminPlatform,
} from "@/lib/api/admin";

export function PlatformsListClient() {
  return (
    <SimpleCrudPage<AdminPlatform>
      title="Platforms"
      noun="Platform"
      description="Brands/platforms a product belongs to (PlayStation, Steam, PUBG…). Archiving or drafting a platform hides all of its products from the store."
      writePermission="catalog.write"
      searchPlaceholder="Search platforms…"
      list={async (tok, p, s) =>
        asList(await listPlatforms(tok, { page: p, page_size: ADMIN_LIST_PAGE_SIZE, search: s || undefined }))
      }
      create={(tok, body) => createPlatform(tok, body as Partial<AdminPlatform>)}
      update={(tok, row, body) => updatePlatform(tok, row.id, body as Partial<AdminPlatform>)}
      remove={(tok, row) => deletePlatform(tok, row.id)}
      deleteDescription={(r) =>
        `Permanently delete “${r.name_en}”. Platforms that still have products cannot be deleted — archive it instead.`
      }
      columns={[
        {
          key: "name",
          header: "Name",
          render: (r) => (
            <div>
              <p className="font-medium">{r.name_en}</p>
              {r.name_ar ? <p className="text-xs text-[var(--clicks-muted)]" dir="rtl">{r.name_ar}</p> : null}
            </div>
          ),
        },
        { key: "slug", header: "Slug", render: (r) => <span className="font-mono text-xs">{r.slug}</span> },
        { key: "products", header: "Products", className: "tabular-nums", render: (r) => r.products_count ?? "—" },
        { key: "status", header: "Status", render: (r) => <Badge status={r.status} /> },
        { key: "sort", header: "Sort", className: "tabular-nums", render: (r) => r.sort_order ?? 0 },
      ]}
      emptyValues={{ name_en: "", name_ar: "", slug: "", artwork_key: "", status: "PUBLISHED", sort_order: "0" }}
      toValues={(r) => ({
        name_en: r.name_en,
        name_ar: r.name_ar ?? "",
        slug: r.slug,
        artwork_key: r.artwork_key ?? "",
        status: r.status,
        sort_order: String(r.sort_order ?? 0),
      })}
      validate={(v) => (SLUG_RE.test(str(v, "slug")) ? {} : { slug: "Lowercase letters, numbers and dashes" })}
      toPayload={(v) => ({
        name_en: str(v, "name_en"),
        name_ar: str(v, "name_ar"),
        slug: str(v, "slug"),
        artwork_key: str(v, "artwork_key"),
        status: str(v, "status"),
        sort_order: Number(str(v, "sort_order")) || 0,
      })}
      fields={[
        { name: "name_en", label: "Name (EN)", required: true },
        { name: "name_ar", label: "Name (AR)", rtl: true },
        { name: "slug", label: "Slug", required: true, mono: true, hint: "Used in store filters/URLs." },
        { name: "artwork_key", label: "Artwork key", mono: true, hint: "Built-in logo/artwork name, e.g. playstation." },
        {
          name: "status",
          label: "Status",
          type: "select",
          hint: "Draft or archived hides every product of this platform on the store.",
          options: [
            { value: "PUBLISHED", label: "Published" },
            { value: "DRAFT", label: "Draft" },
            { value: "ARCHIVED", label: "Archived" },
          ],
        },
        { name: "sort_order", label: "Sort order", type: "number", hint: "Lower shows first in menus and filters." },
      ]}
    />
  );
}
