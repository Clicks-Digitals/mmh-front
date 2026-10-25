"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { useUnsavedChangesGuard } from "@/components/admin/layout/navigation-guard";
import { downloadTextFile, previewRowStatus } from "@/components/admin/lib/code-import";
import { adminErrorMessage } from "@/components/admin/lib/errors";
import { codeVariantLabel } from "@/components/admin/modules/codes-list-client";
import { Badge } from "@/components/admin/ui/badge";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { FormField, adminInputClass } from "@/components/admin/ui/form-field";
import { PageHeader } from "@/components/admin/ui/page-header";
import { useAdminToast } from "@/components/admin/ui/toast";
import { useAdminQuery } from "@/hooks/use-admin-query";
import {
  confirmCodeImport,
  createManualCode,
  downloadCodeImportErrors,
  downloadCodeImportTemplate,
  fetchAllPages,
  listVariants,
  previewCodeImport,
  type AdminVariant,
  type CodeImportBatch,
} from "@/lib/api/admin";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

type Step = "setup" | "preview" | "result";
type Mode = "SIMPLE" | "ADVANCED";

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function StepTitle({ n, title, done }: { n: number; title: string; done?: boolean }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--clicks-navy)]">
      <span
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] ${
          done ? "bg-emerald-600 text-white" : "bg-[var(--clicks-blue-soft)] text-[var(--clicks-blue)]"
        }`}
      >
        {done ? "✓" : n}
      </span>
      {title}
    </h2>
  );
}

function waitingMessage(batch: Pick<CodeImportBatch, "waiting_orders" | "waiting_orders_message" | "auto_delivered_orders">) {
  const delivered = batch.waiting_orders?.delivered ?? batch.auto_delivered_orders ?? 0;
  const partial = batch.waiting_orders?.partially_delivered ?? 0;
  if (!delivered && !partial) return "";
  const parts = [];
  if (delivered) parts.push(`${delivered} waiting order${delivered === 1 ? " was" : "s were"} delivered automatically`);
  if (partial) parts.push(`${partial} got part of their codes`);
  return `${parts.join(" and ")}.`;
}

export function CodeImportClient() {
  const toast = useAdminToast();
  const search = useSearchParams();
  const { can } = useAdminAccess();
  const canManage = can("codes.manage");
  const presetVariant = search.get("variant") || "";

  // Only CODE variants have code stock (CA-23); fetched page by page.
  const { data, loading, error, reload, token } = useAdminQuery(async (tok) => {
    const variants = await fetchAllPages((params) => listVariants(tok, { ...params, fulfillment_type: "CODE" }));
    return { variants: variants as AdminVariant[] };
  });

  const [mode, setMode] = useState<Mode>("SIMPLE");
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState(presetVariant);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [step, setStep] = useState<Step>("setup");
  const [pending, setPending] = useState(false);
  const [batch, setBatch] = useState<CodeImportBatch | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [manualPin, setManualPin] = useState("");
  const [manualMessage, setManualMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useUnsavedChangesGuard("code-import", step === "preview", "The file was checked but not imported yet. If you leave, no codes are added.");

  const variants = useMemo(() => data?.variants ?? [], [data?.variants]);
  const products = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of variants) if (v.product) map.set(String(v.product), v.product_name || String(v.product));
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [variants]);
  const selectedVariant = variants.find((v) => String(v.id) === String(variantId));
  const effectiveProduct = productId || (selectedVariant ? String(selectedVariant.product) : "");
  const productVariants = useMemo(
    () => (effectiveProduct ? variants.filter((v) => String(v.product) === effectiveProduct) : []),
    [variants, effectiveProduct],
  );

  function acceptFile(next: File | null) {
    setPreviewError("");
    if (!next) {
      setFile(null);
      return;
    }
    const lower = next.name.toLowerCase();
    if (!lower.endsWith(".csv") && !lower.endsWith(".xlsx")) {
      setPreviewError("Please choose a .csv or .xlsx (Excel) file.");
      return;
    }
    setFile(next);
  }

  async function runPreview() {
    if (!token || !file) return;
    if (mode === "SIMPLE" && !variantId) {
      setPreviewError("Choose the product and variant the codes belong to (step 1).");
      return;
    }
    setPending(true);
    setPreviewError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mode", mode);
      if (mode === "SIMPLE") form.append("variant_id", String(variantId));
      const result = await previewCodeImport(token, form);
      setBatch(result.batch);
      setStep("preview");
    } catch (err) {
      setPreviewError(adminErrorMessage(err, "The file could not be checked."));
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
      toast.push(`${result.imported_rows} code${result.imported_rows === 1 ? "" : "s"} imported`, "success");
    } catch (err) {
      toast.push(adminErrorMessage(err, "Import failed"), "error");
    } finally {
      setPending(false);
    }
  }

  async function handleTemplate(m: Mode) {
    if (!token) return;
    try {
      const csv = await downloadCodeImportTemplate(token, m);
      downloadTextFile(`code-import-${m === "SIMPLE" ? "one-variant" : "with-sku"}.csv`, csv);
    } catch (err) {
      toast.push(adminErrorMessage(err, "Template download failed"), "error");
    }
  }

  async function handleErrors() {
    if (!token || !batch) return;
    try {
      const csv = await downloadCodeImportErrors(token, batch.id);
      downloadTextFile(`import-${batch.id}-problems.csv`, csv);
    } catch (err) {
      toast.push(adminErrorMessage(err, "Could not download the report"), "error");
    }
  }

  async function handleManual() {
    if (!token) return;
    setManualMessage(null);
    if (!variantId || !manualCode.trim()) {
      setManualMessage({ tone: "error", text: "Choose the variant (step 1) and type the code." });
      return;
    }
    setPending(true);
    try {
      const created = await createManualCode(token, {
        variant_id: variantId,
        code: manualCode.trim(),
        pin: manualPin.trim() || undefined,
      });
      setManualCode("");
      setManualPin("");
      const waiting = (created as { waiting_orders_message?: string }).waiting_orders_message;
      setManualMessage({ tone: "success", text: `Code ${created.masked} added to stock.${waiting ? ` ${waiting}` : ""}` });
    } catch (err) {
      // D10: 409 duplicate_code names where the code already is.
      setManualMessage({ tone: "error", text: adminErrorMessage(err, "The code could not be added.") });
    } finally {
      setPending(false);
    }
  }

  function startOver() {
    setStep("setup");
    setBatch(null);
    setFile(null);
    setPreviewError("");
    reload();
  }

  if (!canManage) {
    return <ErrorState title="Not available for your role" message="Your role can view code stock but can't import codes." />;
  }
  if (loading) return <div className="admin-card h-48 animate-pulse" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const problems = batch ? batch.duplicate_rows + batch.failed_rows : 0;

  return (
    <div>
      <PageHeader
        title="Import codes"
        description="Add gift-card / game codes to stock from a CSV or Excel file. Codes are encrypted when saved and never shown in full."
        actions={
          <>
            <Link href="/admin/codes/imports" className="admin-btn admin-btn-secondary">
              Import history
            </Link>
            <Link href="/admin/codes" className="admin-btn admin-btn-ghost">
              View codes
            </Link>
          </>
        }
      />

      {step === "setup" ? (
        <div className="space-y-4">
          <section className="admin-card space-y-3 p-5">
            <StepTitle n={1} title="Which variant are the codes for?" done={mode === "ADVANCED" || Boolean(variantId)} />
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Import type">
              {(
                [
                  ["SIMPLE", "All codes are for one variant"],
                  ["ADVANCED", "The file says the SKU on each row"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  onClick={() => setMode(value)}
                  className={`admin-btn ${mode === value ? "admin-btn-primary" : "admin-btn-secondary"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {mode === "SIMPLE" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Product" htmlFor="ci-product" required>
                  <select
                    id="ci-product"
                    className={adminInputClass}
                    value={effectiveProduct}
                    onChange={(e) => {
                      setProductId(e.target.value);
                      setVariantId("");
                    }}
                  >
                    <option value="">Choose a product…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField
                  label="Variant"
                  htmlFor="ci-variant"
                  required
                  hint={!effectiveProduct ? "Choose the product first." : "Only code products are listed (top-ups have no codes)."}
                >
                  <select
                    id="ci-variant"
                    className={adminInputClass}
                    value={variantId}
                    disabled={!effectiveProduct}
                    onChange={(e) => setVariantId(e.target.value)}
                  >
                    <option value="">Choose a variant…</option>
                    {productVariants.map((v) => (
                      <option key={String(v.id)} value={String(v.id)}>
                        {v.name_en || v.sku} — {v.available_codes ?? v.codes_available ?? 0} in stock
                        {v.published === false ? " (hidden)" : ""}
                      </option>
                    ))}
                  </select>
                </FormField>
                {selectedVariant ? (
                  <p className="text-xs text-[var(--clicks-muted)] sm:col-span-2">
                    {codeVariantLabel(selectedVariant)}: {selectedVariant.codes_available ?? 0} available ·{" "}
                    {selectedVariant.codes_reserved ?? 0} reserved · {selectedVariant.codes_delivered ?? 0} delivered
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-[var(--clicks-muted)]">
                Each row of the file must have a <code className="font-mono text-xs">sku</code> column (the variant&apos;s SKU,
                shown on the product&apos;s Variants tab) plus <code className="font-mono text-xs">code</code> and an optional{" "}
                <code className="font-mono text-xs">pin</code>. Use this to import codes for several variants at once.
              </p>
            )}
          </section>

          <section className="admin-card space-y-2 p-5">
            <StepTitle n={2} title="Get the template (optional)" />
            <p className="text-sm text-[var(--clicks-muted)]">
              {mode === "SIMPLE"
                ? "One code per row in a column called “code”, and the PIN (if the card has one) in “pin”."
                : "Columns “sku”, “code” and “pin”. The template already contains two of your real SKUs as examples."}
            </p>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => void handleTemplate(mode)}>
              Download CSV template
            </button>
            <p className="text-[11px] text-[var(--clicks-muted)]">
              The template is a CSV file — it opens in Excel. You can upload either CSV or Excel (.xlsx); an Excel template is
              not available.
            </p>
          </section>

          <section className="admin-card space-y-3 p-5">
            <StepTitle n={3} title="Upload your file" done={Boolean(file)} />
            <div
              role="button"
              tabIndex={0}
              className={`flex min-h-[140px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 text-center ${
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
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") document.getElementById("code-import-file")?.click();
              }}
            >
              <p className="text-sm font-medium text-[var(--clicks-navy)]">Drop the file here, or click to choose it</p>
              <p className="mt-1 text-xs text-[var(--clicks-muted)]">.csv or .xlsx · up to 10,000 rows</p>
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
                onChange={(e) => {
                  acceptFile(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
            </div>
            {previewError ? (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
                {previewError}
              </p>
            ) : null}
            <div className="flex justify-end">
              <button type="button" disabled={pending || !file} onClick={() => void runPreview()} className="admin-btn admin-btn-primary">
                {pending ? "Checking…" : "Check the file"}
              </button>
            </div>
            <p className="text-end text-[11px] text-[var(--clicks-muted)]">Nothing is added yet — you see a preview first.</p>
          </section>

          <section className="admin-card p-5">
            <button
              type="button"
              className="text-sm font-semibold text-[var(--clicks-navy)]"
              aria-expanded={manualOpen}
              onClick={() => setManualOpen((v) => !v)}
            >
              {manualOpen ? "▾" : "▸"} Or add a single code by hand
            </button>
            {manualOpen ? (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-[var(--clicks-muted)]">
                  Goes to the variant chosen in step 1{selectedVariant ? ` (${codeVariantLabel(selectedVariant)})` : ""}.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Code" htmlFor="manual-code" required>
                    <input
                      id="manual-code"
                      className={`${adminInputClass} font-mono`}
                      value={manualCode}
                      onChange={(e) => setManualCode(e.target.value)}
                      autoComplete="off"
                    />
                  </FormField>
                  <FormField label="PIN" htmlFor="manual-pin" optional>
                    <input
                      id="manual-pin"
                      className={`${adminInputClass} font-mono`}
                      value={manualPin}
                      onChange={(e) => setManualPin(e.target.value)}
                      autoComplete="off"
                    />
                  </FormField>
                </div>
                {manualMessage ? (
                  <p
                    role={manualMessage.tone === "error" ? "alert" : "status"}
                    className={`rounded-lg px-3 py-2 text-[13px] ${
                      manualMessage.tone === "error" ? "border border-red-200 bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-900"
                    }`}
                  >
                    {manualMessage.text}
                  </p>
                ) : null}
                <button
                  type="button"
                  disabled={pending || mode !== "SIMPLE" || !variantId}
                  onClick={() => void handleManual()}
                  className="admin-btn admin-btn-secondary"
                >
                  Add code
                </button>
                {mode !== "SIMPLE" ? <p className="text-[11px] text-[var(--clicks-muted)]">Switch step 1 to “one variant” to add a single code.</p> : null}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {step === "preview" && batch ? (
        <div className="space-y-4">
          <section className="admin-card p-5">
            <StepTitle n={4} title="Check the preview, then import" />
            <p className="mt-2 text-sm text-[var(--clicks-muted)]">
              <span className="font-mono text-xs">{batch.filename}</span> ·{" "}
              {batch.mode === "ADVANCED" ? "SKU per row" : codeVariantLabel(selectedVariant ?? { sku: batch.variant_sku || "" })}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-emerald-50 p-3">
                <p className="text-xs text-emerald-800">Ready to import</p>
                <p className="text-xl font-semibold tabular-nums text-emerald-900">{batch.valid_rows}</p>
              </div>
              <div className="rounded-lg bg-amber-50 p-3">
                <p className="text-xs text-amber-900">Duplicates (skipped)</p>
                <p className="text-xl font-semibold tabular-nums text-amber-950">{batch.duplicate_rows}</p>
              </div>
              <div className="rounded-lg bg-red-50 p-3">
                <p className="text-xs text-red-800">Errors (skipped)</p>
                <p className="text-xl font-semibold tabular-nums text-red-900">{batch.failed_rows}</p>
              </div>
            </div>
            {problems ? (
              <p className="mt-3 text-[12px] text-[var(--clicks-muted)]">
                Skipped rows are not imported. A duplicate means the same code is already in your stock or was delivered to an
                order (the row says where).{" "}
                <button type="button" className="font-medium text-[var(--clicks-blue)]" onClick={() => void handleErrors()}>
                  Download the list of skipped rows
                </button>
              </p>
            ) : null}
          </section>

          <div className="admin-card overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[#F7F8FC] text-[11px] text-[var(--clicks-muted)]">
                <tr>
                  <th className="px-4 py-2.5 text-start">Row</th>
                  <th className="px-4 py-2.5 text-start">SKU</th>
                  <th className="px-4 py-2.5 text-start">Code</th>
                  <th className="px-4 py-2.5 text-start">PIN</th>
                  <th className="px-4 py-2.5 text-start">Status</th>
                  <th className="px-4 py-2.5 text-start">Note</th>
                </tr>
              </thead>
              <tbody>
                {(batch.preview_rows || []).map((row) => {
                  const st = previewRowStatus(row);
                  return (
                    <tr key={row.row} className="border-t border-[var(--clicks-border)]">
                      <td className="px-4 py-2 tabular-nums">{row.row}</td>
                      <td className="px-4 py-2 font-mono text-xs">{row.sku || row.variant_id || "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs">{row.code_masked || "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs">{row.pin_masked || "—"}</td>
                      <td className="px-4 py-2">
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </td>
                      <td className="px-4 py-2 text-[12px] text-[var(--clicks-muted)]">{row.error || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!batch.preview_rows?.length ? <EmptyState title="No rows to preview" /> : null}
            {batch.total_rows > (batch.preview_rows?.length ?? 0) ? (
              <p className="border-t border-[var(--clicks-border)] px-4 py-2 text-[11px] text-[var(--clicks-muted)]">
                Showing the first {batch.preview_rows?.length ?? 0} of {batch.total_rows} rows. The counts above cover the whole file.
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="admin-btn admin-btn-secondary" onClick={startOver}>
              Cancel — don&apos;t import
            </button>
            <button
              type="button"
              disabled={pending || batch.valid_rows < 1}
              onClick={() => void runConfirm()}
              className="admin-btn admin-btn-primary"
            >
              {pending ? "Importing…" : batch.valid_rows ? `Import ${batch.valid_rows} code${batch.valid_rows === 1 ? "" : "s"}` : "Nothing to import"}
            </button>
          </div>
        </div>
      ) : null}

      {step === "result" && batch ? (
        <div className="space-y-4">
          <section className="admin-card p-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--clicks-navy)]">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />
              {batch.imported_rows} code{batch.imported_rows === 1 ? "" : "s"} added to stock
            </h2>
            <p className="mt-1 text-sm text-[var(--clicks-muted)]">
              {batch.total_rows.toLocaleString()} rows in the file · {batch.duplicate_rows} duplicate · {batch.failed_rows} with errors
            </p>
            {waitingMessage(batch) ? (
              <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900">
                {waitingMessage(batch)}
                {batch.waiting_orders?.order_numbers?.length ? ` Orders: ${batch.waiting_orders.order_numbers.join(", ")}.` : ""}
              </p>
            ) : null}
          </section>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="admin-btn admin-btn-primary" onClick={startOver}>
              Import another file
            </button>
            <Link href="/admin/inventory" className="admin-btn admin-btn-secondary">
              View inventory
            </Link>
            <Link href="/admin/codes" className="admin-btn admin-btn-secondary">
              View codes
            </Link>
            {problems > 0 ? (
              <button type="button" className="admin-btn admin-btn-ghost" onClick={() => void handleErrors()}>
                Download skipped rows (CSV)
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
