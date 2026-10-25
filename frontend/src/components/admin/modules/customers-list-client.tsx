"use client";

import { ADMIN_LIST_PAGE_SIZE } from "@/components/admin/admin-list-page";
import { listCustomerRows, type CustomerRow } from "@/components/admin/ops/api";
import { OpsTable } from "@/components/admin/ops/ops-table";
import { Badge } from "@/components/admin/ui/badge";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { Filters } from "@/components/admin/ui/filters";
import { PageHeader } from "@/components/admin/ui/page-header";
import { Pagination } from "@/components/admin/ui/pagination";
import { formatJod } from "@/components/admin/lib/money";
import { formatAdminDate } from "@/lib/admin/format";
import { useAdminQuery } from "@/hooks/use-admin-query";
import Link from "next/link";
import { useEffect, useState } from "react";

export function CustomersListClient({ initialSearch = "" }: { initialSearch?: string }) {
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [access, setAccess] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const { data, loading, error, reload } = useAdminQuery(
    (tok) =>
      listCustomerRows(tok, {
        page,
        page_size: ADMIN_LIST_PAGE_SIZE,
        search: search || undefined,
        disabled: access === "disabled" ? "true" : access === "active" ? "false" : undefined,
      }),
    [page, search, access],
  );

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Customer accounts. Orders placed as a guest with the same e-mail are counted too."
      />
      <Filters
        search={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder="E-mail, name or phone…"
        filters={[
          {
            key: "access",
            label: "Account access",
            value: access,
            onChange: (v) => {
              setAccess(v);
              setPage(1);
            },
            options: [
              { value: "", label: "All accounts" },
              { value: "active", label: "Can sign in" },
              { value: "disabled", label: "Disabled" },
            ],
          },
        ]}
        onClear={() => {
          setSearchInput("");
          setAccess("");
          setPage(1);
        }}
      />
      <OpsTable<CustomerRow>
        rows={data?.results ?? []}
        loading={loading && !data}
        rowKey={(r) => String(r.id)}
        empty={<EmptyState title="No customers found" description="Try another search." />}
        error={error ? <ErrorState message={error} onRetry={reload} /> : null}
        columns={[
          {
            key: "name",
            header: "Customer",
            primary: true,
            render: (r) => (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <Link href={`/admin/customers/${r.id}`} className="font-medium text-[var(--clicks-blue)]">
                  {r.name || r.email}
                </Link>
                {r.disabled ? <Badge tone="error">Disabled</Badge> : null}
              </span>
            ),
          },
          { key: "email", header: "E-mail", render: (r) => <span className="break-all">{r.email}</span> },
          { key: "phone", header: "Phone", render: (r) => r.phone || "—" },
          {
            key: "orders",
            header: "Orders",
            className: "tabular-nums",
            render: (r) => (
              <span>
                {r.orders_count ?? 0}
                {r.guest_orders_count ? (
                  <span className="text-[11px] text-[var(--clicks-muted)]"> (incl. {r.guest_orders_count} as guest)</span>
                ) : null}
              </span>
            ),
          },
          {
            key: "spent",
            header: "Total spent",
            className: "tabular-nums whitespace-nowrap",
            render: (r) => formatJod(r.total_spent_fils ?? 0),
          },
          {
            key: "label",
            header: "Label",
            render: (r) => (r.status && r.status !== "active" ? <Badge status={r.status} /> : <span className="text-[var(--clicks-muted)]">—</span>),
          },
          { key: "created", header: "Joined", className: "whitespace-nowrap", render: (r) => formatAdminDate(r.created_at) },
        ]}
      />
      <Pagination page={page} pageSize={ADMIN_LIST_PAGE_SIZE} total={data?.count ?? 0} onPageChange={setPage} />
    </div>
  );
}
