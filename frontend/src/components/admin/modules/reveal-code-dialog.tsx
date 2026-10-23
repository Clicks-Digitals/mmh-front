"use client";

import { AdminModal } from "@/components/admin/ui/admin-modal";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { useAdminToast } from "@/components/admin/ui/toast";
import { parseRevealedCode } from "@/components/admin/lib/codes";
import { adminErrorMessage } from "@/components/admin/lib/errors";
import { useAdminToken } from "@/hooks/use-admin-token";
import { revealCode } from "@/lib/api/admin";
import { useState } from "react";

function CopyRow({ label, value }: { label: string; value: string }) {
  const toast = useAdminToast();
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--clicks-muted)]">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <p className="min-w-0 flex-1 select-all break-all rounded-lg bg-[var(--clicks-bg)] px-3 py-2.5 font-mono text-[15px] text-[var(--clicks-navy)]">
          {value}
        </p>
        <button
          type="button"
          className="admin-btn admin-btn-secondary h-9 shrink-0 text-xs"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(value)
              .then(() => toast.push(`${label} copied`, "success"))
              .catch(() => toast.push("Copy failed — select the text instead", "error"));
          }}
        >
          Copy
        </button>
      </div>
    </div>
  );
}

/**
 * Confirm → reveal → show formatted code / PIN. Every reveal is audit-logged by the API.
 * Parent controls `target`; `onRevealed` lets list pages refresh "revealed at".
 */
export function RevealCodeDialog({
  target,
  onClose,
  onRevealed,
}: {
  target: { id: number | string; masked: string } | null;
  onClose: () => void;
  onRevealed?: () => void;
}) {
  const token = useAdminToken();
  const toast = useAdminToast();
  const [pending, setPending] = useState(false);
  const [revealed, setRevealed] = useState<{ code: string; pin: string; masked: string } | null>(null);

  async function confirm() {
    if (!token || !target) return;
    setPending(true);
    try {
      const result = await revealCode(token, target.id);
      setRevealed({ ...parseRevealedCode(result.code), masked: result.masked || target.masked });
      onClose();
      onRevealed?.();
    } catch (err) {
      toast.push(adminErrorMessage(err, "Reveal failed"), "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <ConfirmDialog
        open={Boolean(target)}
        title="Reveal digital code?"
        description={
          target
            ? `Decrypts code ${target.masked}. The reveal is recorded in the audit log — only reveal when assisting a customer.`
            : undefined
        }
        confirmLabel="Reveal"
        pending={pending}
        onCancel={onClose}
        onConfirm={() => void confirm()}
      />
      <AdminModal
        open={Boolean(revealed)}
        onClose={() => setRevealed(null)}
        title="Revealed code"
        description={revealed ? `Masked ${revealed.masked}. The value is cleared when you close this window.` : undefined}
      >
        {revealed ? (
          <div className="space-y-3">
            <CopyRow label="Code" value={revealed.code} />
            {revealed.pin ? <CopyRow label="PIN" value={revealed.pin} /> : null}
            <div className="flex justify-end pt-1">
              <button type="button" className="admin-btn admin-btn-primary" onClick={() => setRevealed(null)}>
                Close
              </button>
            </div>
          </div>
        ) : null}
      </AdminModal>
    </>
  );
}
