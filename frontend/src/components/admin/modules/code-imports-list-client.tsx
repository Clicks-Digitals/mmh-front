"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { ADMIN_LIST_PAGE_SIZE } from "@/components/admin/admin-list-page";
import { Badge } from "@/components/admin/ui/badge";
import { DataTable } from "@/components/admin/ui/data-table";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { PageHeader } from "@/components/admin/ui/page-header";
import { Pagination } from "@/components/admin/ui/pagination";
import { useAdminResource } from "@/hooks/use-admin-resource";
import { listCodeImports, type CodeImportBatch } from "@/lib/api/admin";
import { formatAdminDateTime } from "@/lib/admin/format";
import Link from "next/link";

export function CodeImportsListClient() {
  const { can } = useAdminAccess();
  const canManage = can("codes.manage");

  const { page, setPage, items, count, loading, error, reload } = useAdminResource<CodeImportBatch>(
    async (tok, p) => {
      const data = await listCodeImports(tok, { page: p, page_size: ADMIN_LIST_PAGE_SIZE });
      return { items: data.results, count: data.count };
    },
  );

  if (!canManage) {
    return <ErrorState message="You need codes.manage to view import history." />;
  }

  const columns = [
    {
      key: "date",
      header: "Date",
      render: (r: CodeImportBatch) => formatAdminDateTime(r.created_at),
    },
    { key: "file", header: "File", render: (r: CodeImportBatch) => r.filename },
    { key: "variant", header: "Variant", render: (r: CodeImportBatch) => r.variant_sku || "—" },
    {
      key: "admin",
      header: "Admin",
      render: (r: CodeImportBatch) => r.uploaded_by_email || "—",
    },
    {
      key: "rows",
      header: "Rows",
      render: (r: CodeImportBatch) => r.total_rows,
    },
    {
      key: "imported",
      header: "Imported",
      render: (r: CodeImportBatch) => r.imported_rows,
    },
    {
      key: "dups",
      header: "Duplicates",
      render: (r: CodeImportBatch) => r.duplicate_rows,
    },
    {
      key: "failed",
      header: "Failed",
      render: (r: CodeImportBatch) => r.failed_rows,
    },
    {
      key: "status",
      header: "Status",
      render: (r: CodeImportBatch) => <Badge status={r.status} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Code import history"
        description="Batch metadata only — no plaintext codes are retained."
        actions={
          <Link
            href="/admin/codes/import"
            className="h-9 rounded-lg bg-[var(--clicks-blue)] px-3 text-sm font-semibold text-white inline-flex items-center"
          >
            Import codes
          </Link>
        }
      />
      <DataTable
        columns={columns}
        rows={items}
        loading={loading}
        rowKey={(r) => String(r.id)}
        empty={<EmptyState title="No imports yet" />}
        error={error ? <ErrorState message={error} onRetry={reload} /> : null}
      />
      <Pagination page={page} pageSize={ADMIN_LIST_PAGE_SIZE} total={count} onPageChange={setPage} />
    </div>
  );
}
