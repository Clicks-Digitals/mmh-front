"use client";

import { adminErrorMessage } from "@/components/admin/lib/errors";
import { useAdminAccess } from "@/components/admin/admin-access";
import { Badge } from "@/components/admin/ui/badge";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { FormField, adminInputClass } from "@/components/admin/ui/form-field";
import { PageHeader } from "@/components/admin/ui/page-header";
import { useAdminToast } from "@/components/admin/ui/toast";
import { useAdminQuery } from "@/hooks/use-admin-query";
import {
  confirmCodeImport,
  fetchAllPages,
  createManualCode,
  downloadCodeImportErrors,
  downloadCodeImportTemplate,
  listProducts,
  listVariants,
  previewCodeImport,
  type AdminVariant,
  type CodeImportBatch,
} from "@/lib/api/admin";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

type Step = "setup" | "preview" | "result";

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function CodeImportClient() {
  const toast = useAdminToast();
  const router = useRouter();
  const search = useSearchParams();
  const { can } = useAdminAccess();
  const canManage = can("codes.manage");

  const presetVariant = search.get("variant") || "";

  const { data, loading, error, reload, token } = useAdminQuery(async (tok) => {
    // Paginate (backend caps page_size) instead of requesting one huge page.
    const [products, variants] = await Promise.all([
      fetchAllPages((params) => listProducts(tok, { ...params, ordering: "name_en" })),
      fetchAllPages((params) => listVariants(tok, params)),
    ]);
    return { products, variants: variants as AdminVariant[] };
  });

  const [mode, setMode] = useState<"SIMPLE" | "ADVANCED">("SIMPLE");
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState(presetVariant);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [step, setStep] = useState<Step>("setup");
  const [pending, setPending] = useState(false);
  const [batch, setBatch] = useState<CodeImportBatch | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [manualPin, setManualPin] = useState("");

  const variants = useMemo(() => data?.variants ?? [], [data?.variants]);
  const products = data?.products ?? [];

  const filteredVariants = useMemo(() => {
    if (!productId) return variants;
    return variants.filter((v) => String(v.product) === productId);
  }, [variants, productId]);

  const selectedVariant = variants.find((v) => String(v.id) === String(variantId));

  function acceptFile(next: File | null) {
    if (!next) {
      setFile(null);
      return;
    }
    const lower = next.name.toLowerCase();
    if (!lower.endsWith(".csv") && !lower.endsWith(".xlsx")) {
      toast.push("Only .csv and .xlsx files are allowed", "error");
      return;
    }
    setFile(next);
  }

  async function runPreview() {
    if (!token || !file) return;
    if (mode === "SIMPLE" && !variantId) {
      toast.push("Select a product variant", "error");
      return;
    }
    setPending(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mode", mode);
      if (mode === "SIMPLE") form.append("variant_id", String(variantId));
      const result = await previewCodeImport(token, form);
      setBatch(result.batch);
      setStep("preview");
      toast.push("File validated", "success");
    } catch (err) {
      toast.push(adminErrorMessage(err, "Preview failed"), "error");
    } finally {
      setPending(false);
    }
  }

  async function runConfirm() {
    if (!token || !batch) return;
    setPending(true);
    try {
      const result = await confirmCodeImport(token, batch.id);
      setBatch(result);
      setStep("result");
      toast.push("Import completed", "success");
    } catch (err) {
      toast.push(adminErrorMessage(err, "Import failed"), "error");
    } finally {
      setPending(false);
    }
  }

  async function handleTemplate(m: "SIMPLE" | "ADVANCED") {
    if (!token) return;
    try {
      const csv = await downloadCodeImportTemplate(token, m);
      downloadText(`code-import-${m.toLowerCase()}.csv`, csv);
    } catch (err) {
      toast.push(adminErrorMessage(err, "Template download failed"), "error");
    }
  }

  async function handleErrors() {
    if (!token || !batch) return;
    try {
      const csv = await downloadCodeImportErrors(token, batch.id);
      downloadText(`import-${batch.id}-errors.csv`, csv);
    } catch (err) {
      toast.push(adminErrorMessage(err, "Error report failed"), "error");
    }
  }

  async function handleManual() {
    if (!token) return;
    if (!variantId || !manualCode.trim()) {
      toast.push("Variant and code are required", "error");
      return;
    }
    setPending(true);
    try {
      await createManualCode(token, {
        variant_id: variantId,
        code: manualCode.trim(),
        pin: manualPin.trim() || undefined,
      });
      setManualCode("");
      setManualPin("");
      toast.push("Code added", "success");
    } catch (err) {
      toast.push(adminErrorMessage(err, "Could not add code"), "error");
    } finally {
      setPending(false);
    }
  }

  if (!canManage) {
    return <ErrorState message="You need codes.manage permission to import codes." />;
  }

  if (loading) {
    return <div className="h-48 animate-pulse rounded-xl border border-[var(--clicks-border)] bg-white" />;
  }
  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <div>
      <PageHeader
        title="Import digital codes"
        description="Upload CSV/XLSX, validate, then encrypt and store. Plaintext codes are never stored."
        actions={
          <>
            <Link
              href="/admin/codes/imports"
              className="h-9 rounded-lg border border-[var(--clicks-border)] bg-white px-3 text-sm font-medium text-[var(--clicks-navy)]"
            >
              Import history
            </Link>
            <Link href="/admin/codes" className="text-sm font-medium text-[var(--clicks-blue)]">
              View codes
            </Link>
          </>
        }
      />

      {step === "setup" ? (
        <div className="space-y-6">
          <section className="rounded-xl border border-[var(--clicks-border)] bg-white p-5">
            <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">1. Import type</h2>
            <div className="mt-3 flex flex-wrap gap-3">
              {(
                [
                  ["SIMPLE", "Simple — one variant"],
                  ["ADVANCED", "Advanced — SKU / variant per row"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={`h-9 rounded-lg px-3 text-sm font-medium ${
                    mode === value
                      ? "bg-[var(--clicks-blue)] text-white"
                      : "border border-[var(--clicks-border)] bg-white text-[var(--clicks-navy)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <button type="button" className="text-[var(--clicks-blue)]" onClick={() => void handleTemplate("SIMPLE")}>
                Download simple template
              </button>
              <button
                type="button"
                className="text-[var(--clicks-blue)]"
                onClick={() => void handleTemplate("ADVANCED")}
              >
                Download advanced template
              </button>
            </div>
          </section>

          {mode === "SIMPLE" ? (
            <section className="rounded-xl border border-[var(--clicks-border)] bg-white p-5">
              <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">2. Product / variant</h2>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <FormField label="Product" htmlFor="product">
                  <select
                    id="product"
                    className={adminInputClass}
                    value={productId}
                    onChange={(e) => {
                      setProductId(e.target.value);
                      setVariantId("");
                    }}
                  >
                    <option value="">All products</option>
                    {products.map((p) => (
                      <option key={String(p.id)} value={String(p.id)}>
                        {p.name_en}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Variant" htmlFor="variant">
                  <select
                    id="variant"
                    className={adminInputClass}
                    value={variantId}
                    onChange={(e) => setVariantId(e.target.value)}
                  >
                    <option value="">Select variant…</option>
                    {filteredVariants.map((v) => (
                      <option key={String(v.id)} value={String(v.id)}>
                        {v.sku} — {v.name_en || "Variant"} ({v.codes_available ?? 0} available)
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>
              {selectedVariant ? (
                <p className="mt-2 text-xs text-[var(--clicks-muted)]">
                  Selected {selectedVariant.sku} · Available {selectedVariant.codes_available ?? 0} · Reserved{" "}
                  {selectedVariant.codes_reserved ?? 0} · Delivered {selectedVariant.codes_delivered ?? 0}
                </p>
              ) : null}
            </section>
          ) : (
            <section className="rounded-xl border border-[var(--clicks-border)] bg-white p-5">
              <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">2. Advanced mapping</h2>
              <p className="mt-2 text-sm text-[var(--clicks-muted)]">
                Include <code className="font-mono text-xs">sku</code> or{" "}
                <code className="font-mono text-xs">variant_id</code> on each row with{" "}
                <code className="font-mono text-xs">code</code> and optional{" "}
                <code className="font-mono text-xs">pin</code>.
              </p>
            </section>
          )}

          <section className="rounded-xl border border-[var(--clicks-border)] bg-white p-5">
            <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">
              {mode === "SIMPLE" ? "3" : "3"}. Upload file
            </h2>
            <div
              className={`mt-3 flex min-h-[160px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 text-center ${
                dragOver ? "border-[var(--clicks-blue)] bg-[var(--clicks-bg)]" : "border-[var(--clicks-border)]"
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                acceptFile(e.dataTransfer.files?.[0] ?? null);
              }}
              onClick={() => document.getElementById("code-import-file")?.click()}
            >
              <p className="text-sm font-medium text-[var(--clicks-navy)]">
                Drag & drop CSV/XLSX, or click to browse
              </p>
              <p className="mt-1 text-xs text-[var(--clicks-muted)]">Max 10,000 rows · .csv / .xlsx</p>
              {file ? (
                <p className="mt-3 font-mono text-xs text-[var(--clicks-navy)]">
                  {file.name} · {formatBytes(file.size)}
                </p>
              ) : null}
              <input
                id="code-import-file"
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => acceptFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                disabled={pending || !file}
                onClick={() => void runPreview()}
                className="h-10 rounded-lg bg-[var(--clicks-blue)] px-4 text-sm font-semibold text-white disabled:opacity-60"
              >
                {pending ? "Validating…" : "Preview & validate"}
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--clicks-border)] bg-white p-5">
            <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">Add one code manually</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <FormField label="Variant" htmlFor="manual-variant">
                <select
                  id="manual-variant"
                  className={adminInputClass}
                  value={variantId}
                  onChange={(e) => setVariantId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {variants.map((v) => (
                    <option key={String(v.id)} value={String(v.id)}>
                      {v.sku}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Code" htmlFor="manual-code">
                <input
                  id="manual-code"
                  className={adminInputClass}
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  autoComplete="off"
                />
              </FormField>
              <FormField label="PIN (optional)" htmlFor="manual-pin">
                <input
                  id="manual-pin"
                  className={adminInputClass}
                  value={manualPin}
                  onChange={(e) => setManualPin(e.target.value)}
                  autoComplete="off"
                />
              </FormField>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => void handleManual()}
              className="mt-3 h-9 rounded-lg border border-[var(--clicks-border)] px-3 text-sm font-medium"
            >
              Encrypt & save
            </button>
          </section>
        </div>
      ) : null}

      {step === "preview" && batch ? (
        <div className="space-y-4">
          <section className="rounded-xl border border-[var(--clicks-border)] bg-white p-5">
            <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">Preview & validate</h2>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-[var(--clicks-muted)]">File</dt>
                <dd className="font-medium">{batch.filename}</dd>
              </div>
              <div>
                <dt className="text-[var(--clicks-muted)]">Variant</dt>
                <dd className="font-medium">{batch.variant_sku || "Mixed / advanced"}</dd>
              </div>
              <div>
                <dt className="text-[var(--clicks-muted)]">Rows</dt>
                <dd className="font-medium">
                  {batch.total_rows} total · {batch.valid_rows} valid · {batch.failed_rows} invalid ·{" "}
                  {batch.duplicate_rows} duplicates
                </dd>
              </div>
              <div>
                <dt className="text-[var(--clicks-muted)]">Status</dt>
                <dd>
                  <Badge status={batch.status} />
                </dd>
              </div>
            </dl>
          </section>

          <div className="overflow-hidden rounded-xl border border-[var(--clicks-border)] bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-[var(--clicks-bg)] text-[11px] uppercase tracking-wide text-[var(--clicks-muted)]">
                <tr>
                  <th className="px-4 py-3 text-start">Row</th>
                  <th className="px-4 py-3 text-start">SKU / Variant</th>
                  <th className="px-4 py-3 text-start">Code</th>
                  <th className="px-4 py-3 text-start">PIN</th>
                  <th className="px-4 py-3 text-start">Status</th>
                  <th className="px-4 py-3 text-start">Error</th>
                </tr>
              </thead>
              <tbody>
                {(batch.preview_rows || []).map((row) => (
                  <tr key={row.row} className="border-t border-[var(--clicks-border)]">
                    <td className="px-4 py-3">{row.row}</td>
                    <td className="px-4 py-3 font-mono text-xs">{row.sku || row.variant_id || "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs">{row.code_masked || "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs">{row.pin_masked || "—"}</td>
                    <td className="px-4 py-3">
                      <Badge status={row.status === "ok" ? "AVAILABLE" : "FAILED"} />
                    </td>
                    <td className="px-4 py-3 text-[var(--clicks-muted)]">{row.error || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!batch.preview_rows?.length ? <EmptyState title="No preview rows" /> : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="h-10 rounded-lg border border-[var(--clicks-border)] px-4 text-sm font-medium"
              onClick={() => {
                setStep("setup");
                setBatch(null);
              }}
            >
              Back
            </button>
            <button
              type="button"
              disabled={pending || batch.valid_rows < 1}
              onClick={() => void runConfirm()}
              className="h-10 rounded-lg bg-[var(--clicks-blue)] px-4 text-sm font-semibold text-white disabled:opacity-60"
            >
              {pending ? "Importing…" : `Confirm import (${batch.valid_rows} valid)`}
            </button>
          </div>
        </div>
      ) : null}

      {step === "result" && batch ? (
        <div className="space-y-4">
          <section className="rounded-xl border border-[var(--clicks-border)] bg-white p-5">
            <h2 className="text-lg font-semibold text-[var(--clicks-navy)]">Import complete</h2>
            <p className="mt-2 text-sm text-[var(--clicks-muted)]">
              {batch.total_rows.toLocaleString()} rows processed
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg bg-[var(--clicks-bg)] p-3">
                <p className="text-xs text-[var(--clicks-muted)]">Imported</p>
                <p className="text-xl font-semibold tabular-nums">{batch.imported_rows}</p>
              </div>
              <div className="rounded-lg bg-[var(--clicks-bg)] p-3">
                <p className="text-xs text-[var(--clicks-muted)]">Duplicates</p>
                <p className="text-xl font-semibold tabular-nums">{batch.duplicate_rows}</p>
              </div>
              <div className="rounded-lg bg-[var(--clicks-bg)] p-3">
                <p className="text-xs text-[var(--clicks-muted)]">Failed</p>
                <p className="text-xl font-semibold tabular-nums">{batch.failed_rows}</p>
              </div>
              <div className="rounded-lg bg-[var(--clicks-bg)] p-3">
                <p className="text-xs text-[var(--clicks-muted)]">Status</p>
                <Badge status={batch.status} />
              </div>
            </div>
          </section>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/inventory"
              className="inline-flex h-10 items-center rounded-lg bg-[var(--clicks-blue)] px-4 text-sm font-semibold text-white"
            >
              View inventory
            </Link>
            <Link
              href="/admin/codes"
              className="inline-flex h-10 items-center rounded-lg border border-[var(--clicks-border)] px-4 text-sm font-medium"
            >
              View codes
            </Link>
            <button
              type="button"
              className="h-10 rounded-lg border border-[var(--clicks-border)] px-4 text-sm font-medium"
              onClick={() => {
                setStep("setup");
                setBatch(null);
                setFile(null);
                router.refresh();
              }}
            >
              Import more
            </button>
            {batch.failed_rows > 0 ? (
              <button
                type="button"
                className="h-10 rounded-lg border border-[var(--clicks-border)] px-4 text-sm font-medium"
                onClick={() => void handleErrors()}
              >
                Download error report
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
