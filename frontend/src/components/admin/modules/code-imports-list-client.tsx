"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { ADMIN_LIST_PAGE_SIZE } from "@/components/admin/admin-list-page";
import { downloadTextFile, importBatchStatus, previewRowStatus, problemRowCount } from "@/components/admin/lib/code-import";
import { adminErrorMessage } from "@/components/admin/lib/errors";
import { AdminModal } from "@/components/admin/ui/admin-modal";
import { Badge } from "@/components/admin/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/admin/ui/data-table";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { PageHeader } from "@/components/admin/ui/page-header";
import { Pagination } from "@/components/admin/ui/pagination";
import { useAdminToast } from "@/components/admin/ui/toast";
import { useAdminUrlResource } from "@/hooks/use-admin-url-resource";
import { downloadCodeImportErrors, getCodeImport, listCodeImports, type CodeImportBatch } from "@/lib/api/admin";
import { formatAdminDateTime } from "@/lib/admin/format";
import Link from "next/link";
import { useState } from "react";
import { VariantName } from "@/components/admin/ui/variant-name";

export function CodeImportsListClient() {
  const { can } = useAdminAccess();
  const canManage = can("codes.manage");
  const toast = useAdminToast();
  const [detail, setDetail] = useState<CodeImportBatch | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const { state, set, page, token, items, count, loading, error, reload } = useAdminUrlResource<CodeImportBatch, { ordering: string }>(
    { ordering: "" },
    async (tok, s) => {
      const data = await listCodeImports(tok, { page: Number(s.page) || 1, page_size: ADMIN_LIST_PAGE_SIZE, ordering: s.ordering || undefined });
      return { items: data.results, count: data.count };
    },
  );

  async function openDetail(row: CodeImportBatch) {
    if (!token) return;
    setDetail(row);
    setLoadingDetail(true);
    try {
      setDetail(await getCodeImport(token, row.id));
    } catch (err) {
      toast.push(adminErrorMessage(err, "Could not load the import"), "error");
    } finally {
      setLoadingDetail(false);
    }
  }

  async function downloadErrors(row: CodeImportBatch) {
    if (!token) return;
    try {
      const csv = await downloadCodeImportErrors(token, row.id);
      downloadTextFile(`import-${row.id}-problems.csv`, csv);
    } catch (err) {
      toast.push(adminErrorMessage(err, "Could not download the report"), "error");
    }
  }

  if (!canManage) {
    return <ErrorState title="Not available for your role" message="Your role can't import codes, so the import history is hidden." />;
  }

  const columns: DataTableColumn<CodeImportBatch>[] = [
    {
      key: "date",
      header: "Uploaded",
      mobilePrimary: true,
      render: (r) => (
        <div>
          <p className="font-medium">{r.filename}</p>
          <p className="text-[11px] text-[var(--clicks-muted)]">
            {formatAdminDateTime(r.created_at)}
            {r.uploaded_by_email ? ` · ${r.uploaded_by_email}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "variant",
      header: "Variant",
      render: (r) =>
        r.mode === "ADVANCED" ? (
          "Several (from the file)"
        ) : (
          <VariantName productName={r.product_name} variantName={r.variant_name} sku={r.variant_sku} />
        ),
    },
    { key: "rows", header: "Rows in file", className: "tabular-nums", render: (r) => r.total_rows },
    { key: "imported", header: "Imported", className: "tabular-nums", render: (r) => r.imported_rows },
    {
      key: "problems",
      header: "Skipped",
      className: "tabular-nums",
      render: (r) =>
        problemRowCount(r) ? (
          <span>
            {r.duplicate_rows ? `${r.duplicate_rows} duplicate` : ""}
            {r.duplicate_rows && r.failed_rows ? " · " : ""}
            {r.failed_rows ? `${r.failed_rows} with errors` : ""}
          </span>
        ) : (
          "0"
        ),
    },
    {
      key: "status",
      header: "Result",
      render: (r) => {
        const st = importBatchStatus(r);
        return (
          <span title={st.hint}>
            <Badge tone={st.tone}>{st.label}</Badge>
            {r.auto_delivered_orders ? (
              <span className="mt-0.5 block text-[11px] text-emerald-700">{r.auto_delivered_orders} waiting order(s) delivered</span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <div className="flex justify-end gap-3 text-xs">
          <button type="button" className="font-medium text-[var(--clicks-blue)]" onClick={() => void openDetail(r)}>
            Details
          </button>
          {problemRowCount(r) ? (
            <button type="button" className="font-medium text-[var(--clicks-blue)]" onClick={() => void downloadErrors(r)}>
              Problem report (CSV)
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  const detailStatus = detail ? importBatchStatus(detail) : null;

  return (
    <div>
      <PageHeader
        title="Code import history"
        description="Every code file that was uploaded and what happened to it. Codes themselves are never shown here."
        actions={
          <Link href="/admin/codes/import" className="admin-btn admin-btn-primary">
            Import codes
          </Link>
        }
      />
      <DataTable
        columns={columns}
        rows={items}
        loading={loading}
        rowKey={(r) => String(r.id)}
        ordering={state.ordering}
        onOrderingChange={(next) => set({ ordering: next })}
        empty={<EmptyState title="No imports yet" description="Upload a CSV or Excel file of codes from “Import codes”." />}
        error={error ? <ErrorState message={error} onRetry={reload} /> : null}
      />
      <Pagination page={page} pageSize={ADMIN_LIST_PAGE_SIZE} total={count} onPageChange={(p) => set({ page: String(p) })} />

      <AdminModal open={Boolean(detail)} onClose={() => setDetail(null)} title={detail ? `Import: ${detail.filename}` : "Import"} wide>
        {detail && detailStatus ? (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={detailStatus.tone}>{detailStatus.label}</Badge>
              <span className="text-[12px] text-[var(--clicks-muted)]">{detailStatus.hint}</span>
            </div>
            <dl className="grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-[11px] text-[var(--clicks-muted)]">Uploaded</dt>
                <dd>{formatAdminDateTime(detail.created_at)}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-[var(--clicks-muted)]">By</dt>
                <dd>{detail.uploaded_by_email || "—"}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-[var(--clicks-muted)]">Variant</dt>
                <dd>
                  {detail.mode === "ADVANCED" ? (
                    "Several (from the file)"
                  ) : (
                    <VariantName productName={detail.product_name} variantName={detail.variant_name} sku={detail.variant_sku} />
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-[var(--clicks-muted)]">Rows in file</dt>
                <dd className="tabular-nums">{detail.total_rows}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-[var(--clicks-muted)]">Imported</dt>
                <dd className="tabular-nums">{detail.imported_rows}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-[var(--clicks-muted)]">Skipped</dt>
                <dd className="tabular-nums">
                  {detail.duplicate_rows} duplicate · {detail.failed_rows} with errors
                </dd>
              </div>
            </dl>
            {detail.auto_delivered_orders ? (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900">
                {detail.auto_delivered_orders} waiting order(s) were delivered automatically from this import.
              </p>
            ) : null}
            {loadingDetail ? <div className="h-20 animate-pulse rounded-lg bg-[var(--clicks-bg)]" /> : null}
            {detail.error_report?.length ? (
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[12px] font-semibold">Skipped rows</p>
                  <button type="button" className="text-xs font-medium text-[var(--clicks-blue)]" onClick={() => void downloadErrors(detail)}>
                    Download as CSV
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--clicks-border)]">
                  <table className="min-w-full text-[12px]">
                    <thead className="sticky top-0 bg-[#F7F8FC] text-[11px] text-[var(--clicks-muted)]">
                      <tr>
                        <th className="px-3 py-2 text-start">Row</th>
                        <th className="px-3 py-2 text-start">Why</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.error_report.slice(0, 200).map((e) => (
                        <tr key={`${e.row}-${e.error}`} className="border-t border-[var(--clicks-border)]">
                          <td className="px-3 py-1.5 tabular-nums">{e.row}</td>
                          <td className="px-3 py-1.5">
                            <Badge tone={e.type === "duplicate" ? "warning" : "error"}>{e.type === "duplicate" ? "Duplicate" : "Error"}</Badge>{" "}
                            {e.error}
                            {e.sku ? <span className="ms-1 font-mono text-[11px] text-[var(--clicks-muted)]">({e.sku})</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : !loadingDetail && detail.preview_rows?.length ? (
              <p className="text-[12px] text-[var(--clicks-muted)]">
                No skipped rows. {detail.preview_rows.filter((r) => previewRowStatus(r).tone === "success").length} row(s) were ready.
              </p>
            ) : null}
          </div>
        ) : null}
      </AdminModal>
    </div>
  );
}
