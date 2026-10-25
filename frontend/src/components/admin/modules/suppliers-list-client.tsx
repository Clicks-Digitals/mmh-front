"use client";

import { SimpleCrudPage, crudListParams, optionalSlugError, str } from "@/components/admin/modules/simple-crud";
import { Badge } from "@/components/admin/ui/badge";
import { formatAdminDateTime } from "@/lib/admin/format";
import { asList, createSupplier, listSuppliers, updateSupplier, type Supplier } from "@/lib/api/admin";
import Link from "next/link";

/** CA-25 / D18: plain status of a supplier connection. */
export function supplierModeBadge(s: Pick<Supplier, "active" | "live_purchasing">) {
  if (!s.active) return <Badge tone="neutral">Inactive</Badge>;
  if (s.live_purchasing) return <Badge tone="success">Live purchasing on</Badge>;
  return <Badge tone="info">Test mode — no real purchases</Badge>;
}

export function SuppliersListClient() {
  return (
    <SimpleCrudPage<Supplier>
      title="Suppliers"
      noun="Supplier"
      description="Companies that deliver codes or top-ups for you. Link supplier products to your variants on each product's “Supplier mapping” tab. A mapping only keeps a variant on sale when the supplier is active and live purchasing is on."
      writePermission="suppliers.write"
      searchPlaceholder="Search suppliers…"
      slugFrom="name"
      list={async (tok, s) => asList(await listSuppliers(tok, crudListParams(s)))}
      create={(tok, body) => createSupplier(tok, body as { slug?: string; name: string; active: boolean })}
      update={(tok, row, body) => updateSupplier(tok, row.id, body)}
      columns={[
        {
          key: "name",
          header: "Supplier",
          mobilePrimary: true,
          render: (r) => (
            <Link href={`/admin/suppliers/${r.id}`} className="font-medium text-[var(--clicks-blue)]">
              {r.name}
            </Link>
          ),
        },
        { key: "slug", header: "Internal name", render: (r) => <span className="font-mono text-xs">{r.slug}</span> },
        { key: "status", header: "Status", render: (r) => supplierModeBadge(r) },
        { key: "checked", header: "Last checked", render: (r) => formatAdminDateTime(r.last_checked_at) },
      ]}
      emptyValues={{ name: "", slug: "", active: true }}
      toValues={(r) => ({ name: r.name, slug: r.slug, active: r.active })}
      validate={(v, editing) => ({
        slug: editing && !str(v, "slug") ? "Enter an internal name, e.g. 1epin." : optionalSlugError(v),
      })}
      toPayload={(v) => ({ name: str(v, "name"), slug: str(v, "slug"), active: Boolean(v.active) })}
      fields={[
        { name: "name", label: "Name", required: true },
        {
          name: "slug",
          label: "Internal name (slug)",
          mono: true,
          hint: "Filled in from the name. The OneEpin connection uses “1epin” — don't change it.",
        },
        {
          name: "active",
          label: "Active",
          type: "checkbox",
          hint: "Untick to stop using this supplier. Suppliers with order history can't be deleted, so deactivate them instead.",
        },
      ]}
    />
  );
}
