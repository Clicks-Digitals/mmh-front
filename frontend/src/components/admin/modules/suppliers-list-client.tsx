"use client";

import { SLUG_RE, SimpleCrudPage, str } from "@/components/admin/modules/simple-crud";
import { ADMIN_LIST_PAGE_SIZE } from "@/components/admin/admin-list-page";
import { Badge } from "@/components/admin/ui/badge";
import { formatAdminDateTime } from "@/lib/admin/format";
import { asList, createSupplier, listSuppliers, updateSupplier, type Supplier } from "@/lib/api/admin";
import Link from "next/link";

export function SuppliersListClient() {
  return (
    <SimpleCrudPage<Supplier>
      title="Suppliers"
      noun="Supplier"
      description="Code / top-up suppliers. Map supplier product ids to your products on each product's “Supplier mapping” tab."
      writePermission="suppliers.write"
      searchPlaceholder="Search suppliers…"
      list={async (tok, p, s) =>
        asList(await listSuppliers(tok, { page: p, page_size: ADMIN_LIST_PAGE_SIZE, search: s || undefined }))
      }
      create={(tok, body) => createSupplier(tok, body as { slug: string; name: string; active: boolean })}
      update={(tok, row, body) => updateSupplier(tok, row.id, body)}
      columns={[
        {
          key: "name",
          header: "Supplier",
          render: (r) => (
            <Link href={`/admin/suppliers/${r.id}`} className="font-medium text-[var(--clicks-blue)]">
              {r.name}
            </Link>
          ),
        },
        { key: "slug", header: "Slug", render: (r) => <span className="font-mono text-xs">{r.slug}</span> },
        { key: "status", header: "Status", render: (r) => <Badge status={r.active ? "ACTIVE" : "DISABLED"}>{r.active ? "Active" : "Inactive"}</Badge> },
        { key: "env", header: "Environment", render: (r) => r.environment || "—" },
        { key: "checked", header: "Last checked", render: (r) => formatAdminDateTime(r.last_checked_at) },
      ]}
      emptyValues={{ name: "", slug: "", active: true }}
      toValues={(r) => ({ name: r.name, slug: r.slug, active: r.active })}
      validate={(v) => (SLUG_RE.test(str(v, "slug")) ? {} : { slug: "Lowercase letters, numbers and dashes" })}
      toPayload={(v) => ({ name: str(v, "name"), slug: str(v, "slug"), active: Boolean(v.active) })}
      fields={[
        { name: "name", label: "Name", required: true },
        { name: "slug", label: "Slug", required: true, mono: true, hint: "Internal id. The OneEpin integration uses “1epin”." },
        {
          name: "active",
          label: "Active",
          type: "checkbox",
          hint: "Turn off to stop using this supplier. Suppliers with order history cannot be deleted, so deactivate them instead.",
        },
      ]}
    />
  );
}
