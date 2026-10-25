import type { CodeImportBatch, CodeImportPreviewRow } from "@/lib/api/admin";

/** CA-23: what happened to an import batch, in plain words. */
export function importBatchStatus(batch: Pick<CodeImportBatch, "status" | "imported_rows" | "valid_rows" | "completed_at">): {
  label: string;
  tone: "success" | "warning" | "error" | "neutral" | "info";
  hint: string;
} {
  const status = (batch.status || "").toUpperCase();
  if (status === "COMPLETED") return { label: "Imported", tone: "success", hint: "All valid codes were added to stock." };
  if (status === "PARTIAL")
    return { label: "Partly imported", tone: "warning", hint: "Some rows were skipped (duplicates or errors)." };
  if (status === "PROCESSING") return { label: "Importing…", tone: "info", hint: "The import is still running." };
  if ((status === "VALIDATED" || status === "PENDING") && !batch.imported_rows)
    return {
      label: "Not imported (preview only)",
      tone: "neutral",
      hint: "The file was checked but the import was never confirmed. Nothing was added.",
    };
  if (status === "FAILED")
    return batch.imported_rows
      ? { label: "Partly imported", tone: "warning", hint: "Some rows were skipped." }
      : {
          label: batch.valid_rows ? "Not imported" : "Nothing to import",
          tone: "error",
          hint: batch.valid_rows ? "The import did not complete." : "No row of the file could be imported.",
        };
  return { label: status.toLowerCase() || "—", tone: "neutral", hint: "" };
}

/** Preview row status (ready | duplicate | error) -> label + tone. */
export function previewRowStatus(row: Pick<CodeImportPreviewRow, "status">): { label: string; tone: "success" | "warning" | "error" } {
  const s = (row.status || "").toLowerCase();
  if (s === "ready" || s === "ok") return { label: "Ready", tone: "success" };
  if (s === "duplicate") return { label: "Duplicate — skipped", tone: "warning" };
  return { label: "Error — skipped", tone: "error" };
}

/** Rows with problems in a batch (duplicates + invalid). */
export function problemRowCount(batch: Pick<CodeImportBatch, "duplicate_rows" | "failed_rows">): number {
  return (batch.duplicate_rows || 0) + (batch.failed_rows || 0);
}

export function downloadTextFile(filename: string, content: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
