"use client";

import { SimpleCrudPage, crudListParams, optionalSlugError, str } from "@/components/admin/modules/simple-crud";
import { Badge } from "@/components/admin/ui/badge";
import { asList, createRegion, deleteRegion, listRegions, updateRegion, type AdminRegion } from "@/lib/api/admin";

export function RegionsListClient() {
  return (
    <SimpleCrudPage<AdminRegion>
      title="Regions"
      noun="Region"
      description="Where a variant's code can be redeemed (e.g. US, KSA, Global). Choose a region for each variant on the product page."
      writePermission="catalog.write"
      searchPlaceholder="Search regions…"
      slugFrom="name_en"
      defaultOrdering="name_en"
      list={async (tok, s) => asList(await listRegions(tok, crudListParams(s, "name_en")))}
      create={(tok, body) => createRegion(tok, body as Partial<AdminRegion>)}
      update={(tok, row, body) => updateRegion(tok, row.id, body as Partial<AdminRegion>)}
      remove={(tok, row) => deleteRegion(tok, row.id)}
      deleteDescription={(r) => `Permanently delete “${r.name_en}”. Variants using this region lose their region label.`}
      columns={[
        {
          key: "name",
          header: "Name",
          sortKey: "name_en",
          mobilePrimary: true,
          render: (r) => (
            <div>
              <p className="font-medium">{r.name_en}</p>
              {r.name_ar ? <p className="text-xs text-[var(--clicks-muted)]" dir="rtl">{r.name_ar}</p> : null}
            </div>
          ),
        },
        { key: "slug", header: "Web address", render: (r) => <span className="font-mono text-xs">{r.slug}</span> },
        { key: "currency", header: "Currency", sortKey: "currency", render: (r) => r.currency },
        {
          key: "locked",
          header: "Region lock",
          render: (r) => (r.locked ? <Badge tone="warning">Locked to region</Badge> : <Badge tone="success">Works anywhere</Badge>),
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
      validate={(v, editing) => ({
        slug: editing && !str(v, "slug") ? "Enter a web address, e.g. us." : optionalSlugError(v),
        currency: /^[A-Za-z]{3}$/.test(str(v, "currency")) ? undefined : "Use a 3-letter currency code, e.g. USD.",
      })}
      toPayload={(v) => ({
        name_en: str(v, "name_en"),
        name_ar: str(v, "name_ar"),
        slug: str(v, "slug"),
        currency: str(v, "currency").toUpperCase(),
        locked: Boolean(v.locked),
      })}
      fields={[
        { name: "name_en", label: "Name (English)", required: true },
        { name: "name_ar", label: "Name (Arabic)", optional: true, rtl: true },
        { name: "slug", label: "Web address (slug)", mono: true, hint: "Filled in from the English name." },
        {
          name: "currency",
          label: "Currency",
          required: true,
          mono: true,
          maxLength: 8,
          placeholder: "USD",
          hint: "Card/account currency shown on the product page for this region (e.g. USD, SAR).",
        },
        {
          name: "locked",
          label: "Codes only work in this region",
          type: "checkbox",
          hint: "The store shows a “region locked” badge and asks the customer to confirm their account region.",
        },
      ]}
    />
  );
}
