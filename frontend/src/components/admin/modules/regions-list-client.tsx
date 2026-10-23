"use client";

import { SLUG_RE, SimpleCrudPage, str } from "@/components/admin/modules/simple-crud";
import { Badge } from "@/components/admin/ui/badge";
import { ADMIN_LIST_PAGE_SIZE } from "@/components/admin/admin-list-page";
import { asList, createRegion, deleteRegion, listRegions, updateRegion, type AdminRegion } from "@/lib/api/admin";

export function RegionsListClient() {
  return (
    <SimpleCrudPage<AdminRegion>
      title="Regions"
      noun="Region"
      description="Where a variant's code can be redeemed (e.g. US, KSA, Global). Assign regions to variants on the product page."
      writePermission="catalog.write"
      searchPlaceholder="Search regions…"
      list={async (tok, p, s) =>
        asList(await listRegions(tok, { page: p, page_size: ADMIN_LIST_PAGE_SIZE, search: s || undefined }))
      }
      create={(tok, body) => createRegion(tok, body as Partial<AdminRegion>)}
      update={(tok, row, body) => updateRegion(tok, row.id, body as Partial<AdminRegion>)}
      remove={(tok, row) => deleteRegion(tok, row.id)}
      deleteDescription={(r) =>
        `Permanently delete “${r.name_en}”. Variants using this region lose their region label.`
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
        { key: "currency", header: "Currency", render: (r) => r.currency },
        {
          key: "locked",
          header: "Region lock",
          render: (r) => (r.locked ? <Badge tone="warning">Locked</Badge> : <Badge tone="success">Works anywhere</Badge>),
        },
        { key: "variants", header: "Variants", className: "tabular-nums", render: (r) => r.variants_count ?? "—" },
      ]}
      emptyValues={{ name_en: "", name_ar: "", slug: "", currency: "", locked: true }}
      toValues={(r) => ({
        name_en: r.name_en,
        name_ar: r.name_ar ?? "",
        slug: r.slug,
        currency: r.currency,
        locked: Boolean(r.locked),
      })}
      validate={(v) => {
        const e: Record<string, string> = {};
        if (!SLUG_RE.test(str(v, "slug"))) e.slug = "Lowercase letters, numbers and dashes";
        if (!/^[A-Za-z]{3}$/.test(str(v, "currency"))) e.currency = "3-letter code, e.g. USD";
        return e;
      }}
      toPayload={(v) => ({
        name_en: str(v, "name_en"),
        name_ar: str(v, "name_ar"),
        slug: str(v, "slug"),
        currency: str(v, "currency").toUpperCase(),
        locked: Boolean(v.locked),
      })}
      fields={[
        { name: "name_en", label: "Name (EN)", required: true },
        { name: "name_ar", label: "Name (AR)", rtl: true },
        { name: "slug", label: "Slug", required: true, mono: true },
        {
          name: "currency",
          label: "Currency",
          required: true,
          mono: true,
          maxLength: 8,
          hint: "Account/card currency shown on the product page for this region (e.g. USD, SAR).",
        },
        {
          name: "locked",
          label: "Region locked",
          type: "checkbox",
          hint: "Codes only work in this region — the store shows a “region locked” badge and asks the customer to confirm.",
        },
      ]}
    />
  );
}
