"use client";

import { AdminListPage, ADMIN_LIST_PAGE_SIZE } from "@/components/admin/admin-list-page";
import { Badge } from "@/components/admin/ui/badge";
import { formatAdminDate } from "@/lib/admin/format";
import { asList, listCustomers, type AdminCustomer } from "@/lib/api/admin";
import Link from "next/link";

export function CustomersListClient() {
  return (
    <AdminListPage<AdminCustomer>
      title="Customers"
      description="Registered customer accounts. Guest checkouts appear only under Orders."
      rowKey={(r) => String(r.id)}
      searchPlaceholder="Search customers…"
      loader={async (token, page, search) => {
        const data = await listCustomers(token, { page, page_size: ADMIN_LIST_PAGE_SIZE, search: search || undefined });
        return asList(data);
      }}
      columns={[
        {
          key: "name",
          header: "Customer",
          render: (r) => (
            <Link href={`/admin/customers/${r.id}`} className="font-medium text-[var(--clicks-blue)]">
              {r.name || r.email}
            </Link>
          ),
        },
        { key: "email", header: "Email", render: (r) => r.email },
        { key: "phone", header: "Phone", render: (r) => r.phone || "—" },
        { key: "status", header: "Status", render: (r) => <Badge status={r.status || "ACTIVE"} /> },
        { key: "created", header: "Joined", render: (r) => formatAdminDate(r.created_at) },
      ]}
    />
  );
}
