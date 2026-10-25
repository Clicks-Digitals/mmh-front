"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { ADMIN_LIST_PAGE_SIZE } from "@/components/admin/admin-list-page";
import { AdminModal } from "@/components/admin/ui/admin-modal";
import { Badge } from "@/components/admin/ui/badge";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { DataTable } from "@/components/admin/ui/data-table";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { Filters } from "@/components/admin/ui/filters";
import { FormField, adminInputClass } from "@/components/admin/ui/form-field";
import { PageHeader } from "@/components/admin/ui/page-header";
import { Pagination } from "@/components/admin/ui/pagination";
import { useAdminToast } from "@/components/admin/ui/toast";
import { isoToLocalInput, localInputToIso, localTimeZoneLabel } from "@/components/admin/lib/datetime";
import { adminErrorMessage, adminErrorSummary, adminFieldErrors, errorCode } from "@/components/admin/lib/errors";
import { filsToJodInput, formatJod, jodInputToFils } from "@/components/admin/lib/money";
import { listCouponRows, type CouponRow } from "@/components/admin/ops/api";
import { Notice } from "@/components/admin/ops/controls";
import { formatAdminDateTime } from "@/lib/admin/format";
import { useAdminResource } from "@/hooks/use-admin-resource";
import { createCoupon, deleteCoupon, updateCoupon, type Coupon } from "@/lib/api/admin";
import { useState } from "react";

/** OR-24: status computed by the API (dates, usage limit, on/off switch). */
const COUPON_STATUS: Record<string, { label: string; tone: "success" | "warning" | "error" | "neutral" | "info"; hint: string }> = {
  active: { label: "Active", tone: "success", hint: "Customers can use it now." },
  scheduled: { label: "Scheduled", tone: "info", hint: "Starts later — not usable yet." },
  expired: { label: "Expired", tone: "neutral", hint: "The end date has passed." },
  inactive: { label: "Turned off", tone: "neutral", hint: "Switched off by staff." },
  used_up: { label: "Used up", tone: "warning", hint: "The total usage limit is reached." },
};

const FORM_FIELDS = ["code", "description", "percent_off", "amount_jod", "max_uses", "max_uses_per_customer", "starts_at", "ends_at"];

/** D6: warn before saving a coupon that can make orders free. */
function localFreeWarning(form: Form): string {
  if (form.type === "percent") {
    const n = Number(form.percent_off);
    if (Number.isFinite(n) && n >= 100) {
      return "100% off makes every order free. Free orders are delivered right away without any payment.";
    }
    return "";
  }
  const fils = jodInputToFils(form.amount_jod);
  if (fils != null && !Number.isNaN(fils) && fils > 0) {
    return `Any order of ${formatJod(fils)} or less becomes free and is delivered without payment.`;
  }
  return "";
}

type DiscountType = "percent" | "fixed";

const emptyForm = {
  code: "",
  description: "",
  type: "percent" as DiscountType,
  percent_off: "",
  amount_jod: "",
  active: true,
  max_uses: "",
  max_uses_per_customer: "",
  starts_at: "",
  ends_at: "",
};

type Form = typeof emptyForm;

function validate(form: Form): Record<string, string> {
  const e: Record<string, string> = {};
  if (!form.code.trim()) e.code = "Enter the code customers will type.";
  else if (!/^[A-Za-z0-9_-]{2,40}$/.test(form.code.trim())) e.code = "Use 2–40 letters, numbers, - or _ (no spaces).";
  if (form.type === "percent") {
    const n = Number(form.percent_off);
    if (!form.percent_off.trim() || !Number.isFinite(n) || n <= 0 || n > 100) e.percent_off = "Enter a number above 0 and up to 100.";
  } else {
    const fils = jodInputToFils(form.amount_jod);
    if (fils == null || Number.isNaN(fils) || fils <= 0) e.amount_jod = "Enter an amount in JOD, e.g. 2.500";
  }
  for (const key of ["max_uses", "max_uses_per_customer"] as const) {
    const v = form[key].trim();
    if (v && (!/^\d+$/.test(v) || Number(v) < 1)) e[key] = "Enter 1 or more, or leave empty for no limit.";
  }
  const start = localInputToIso(form.starts_at);
  const end = localInputToIso(form.ends_at);
  if (start && end && end <= start) e.ends_at = "The end must be after the start.";
  return e;
}

export function CouponsListClient({ initialSearch = "" }: { initialSearch?: string }) {
  const toast = useAdminToast();
  const { can } = useAdminAccess();
  const canWrite = can("orders.write");
  const [seedSearch, setSeedSearch] = useState(initialSearch);
  const { token, page, setPage, search, setSearch, items, count, loading, error, reload } =
    useAdminResource<CouponRow>(async (tok, p, s) => {
      const data = await listCouponRows(tok, {
        page: p,
        page_size: ADMIN_LIST_PAGE_SIZE,
        search: s || seedSearch || undefined,
      });
      return { items: data.results, count: data.count };
    }, [seedSearch]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CouponRow | null>(null);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState<Form>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CouponRow | null>(null);
  const [inUse, setInUse] = useState<CouponRow | null>(null);

  function setField<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setFormError("");
    setErrors((e) => {
      const errKey = key === "type" ? "" : key;
      if (!errKey || !e[errKey]) return e;
      const next = { ...e };
      delete next[errKey];
      return next;
    });
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setErrors({});
    setFormError("");
    setModalOpen(true);
  }

  function openEdit(row: CouponRow) {
    setEditing(row);
    const isPercent = row.percent_off != null && row.percent_off !== "";
    setForm({
      code: row.code,
      description: row.description ?? "",
      type: isPercent ? "percent" : "fixed",
      percent_off: isPercent ? String(Number(row.percent_off)) : "",
      amount_jod: filsToJodInput(row.amount_off_fils),
      active: row.active,
      max_uses: row.max_uses != null ? String(row.max_uses) : "",
      max_uses_per_customer: row.max_uses_per_customer != null ? String(row.max_uses_per_customer) : "",
      starts_at: isoToLocalInput(row.starts_at),
      ends_at: isoToLocalInput(row.ends_at),
    });
    setErrors({});
    setFormError("");
    setModalOpen(true);
  }

  async function save() {
    if (!token) return;
    const local = validate(form);
    setErrors(local);
    if (Object.keys(local).length) return;
    setPending(true);
    try {
      const body: Partial<Coupon> = {
        code: form.code.trim().toUpperCase(),
        description: form.description.trim(),
        active: form.active,
        percent_off: form.type === "percent" ? form.percent_off.trim() : null,
        amount_off_fils: form.type === "fixed" ? jodInputToFils(form.amount_jod) : null,
        max_uses: form.max_uses.trim() ? Number(form.max_uses) : null,
        max_uses_per_customer: form.max_uses_per_customer.trim() ? Number(form.max_uses_per_customer) : null,
        starts_at: localInputToIso(form.starts_at),
        ends_at: localInputToIso(form.ends_at),
      };
      const saved = (editing ? await updateCoupon(token, editing.id, body) : await createCoupon(token, body)) as CouponRow;
      toast.push(editing ? "Coupon saved" : "Coupon created", "success");
      if (saved?.free_order_warning) toast.push(saved.free_order_warning, "warning");
      setModalOpen(false);
      reload();
    } catch (err) {
      const fields = adminFieldErrors(err);
      if (fields.amount_off_fils) fields.amount_jod = fields.amount_off_fils;
      // "Set exactly one of percent_off or amount_off_fils" etc. belong to the discount field shown.
      if (fields.percent_off && form.type === "fixed") fields.amount_jod = fields.percent_off;
      setErrors(fields);
      const inline = Object.keys(fields).filter((k) => FORM_FIELDS.includes(k));
      const summary = adminErrorSummary(err, "Could not save the coupon.", [...inline, "amount_off_fils"]);
      setFormError(inline.length ? "Please fix the highlighted fields." : summary);
    } finally {
      setPending(false);
    }
  }

  async function setActive(row: CouponRow, active: boolean) {
    if (!token) return;
    try {
      await updateCoupon(token, row.id, { active });
      toast.push(active ? "Coupon activated" : "Coupon deactivated", "success");
      reload();
    } catch (err) {
      toast.push(adminErrorMessage(err, "Update failed"), "error");
    }
  }

  async function confirmDelete() {
    if (!token || !deleteTarget) return;
    setPending(true);
    try {
      await deleteCoupon(token, deleteTarget.id);
      toast.push("Coupon deleted", "success");
      setDeleteTarget(null);
      reload();
    } catch (err) {
      if (errorCode(err) === "coupon_in_use") {
        setInUse(deleteTarget);
        setDeleteTarget(null);
      } else {
        toast.push(adminErrorMessage(err, "Delete failed"), "error");
      }
    } finally {
      setPending(false);
    }
  }

  function discountLabel(r: Coupon) {
    if (r.percent_off != null && r.percent_off !== "") return `${Number(r.percent_off)}% off`;
    if (r.amount_off_fils != null) return `${formatJod(r.amount_off_fils)} off`;
    return "—";
  }

  const freeWarning = modalOpen ? localFreeWarning(form) || editing?.free_order_warning || "" : "";

  const tz = localTimeZoneLabel();

  return (
    <div>
      <PageHeader
        title="Coupons"
        description="Discount codes customers enter at checkout."
        actions={
          canWrite ? (
            <button type="button" onClick={openCreate} className="admin-btn admin-btn-primary">
              New coupon
            </button>
          ) : null
        }
      />
      <Filters
        search={search || seedSearch}
        onSearchChange={(v) => {
          setSeedSearch("");
          setSearch(v);
        }}
        searchPlaceholder="Search coupons…"
      />
      <DataTable
        columns={[
          { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs">{r.code}</span> },
          { key: "discount", header: "Discount", render: (r) => discountLabel(r) },
          {
            key: "status",
            header: "Status",
            render: (r) => {
              const info = COUPON_STATUS[r.status ?? (r.active ? "active" : "inactive")] ?? COUPON_STATUS.inactive;
              return (
                <span className="inline-flex flex-wrap items-center gap-1" title={info.hint}>
                  <Badge tone={info.tone}>{info.label}</Badge>
                  {r.free_order_risk ? (
                    <span title={r.free_order_warning}>
                      <Badge tone="warning">Can make orders free</Badge>
                    </span>
                  ) : null}
                </span>
              );
            },
          },
          {
            key: "window",
            header: "Valid",
            render: (r) => (
              <span className="text-xs text-[var(--clicks-muted)]">
                {r.starts_at || r.ends_at
                  ? `${r.starts_at ? formatAdminDateTime(r.starts_at) : "now"} → ${r.ends_at ? formatAdminDateTime(r.ends_at) : "no end"}`
                  : "Always"}
              </span>
            ),
          },
          {
            key: "usage",
            header: "Usage",
            render: (r) => (
              <span className="text-xs">
                {r.used_count ?? 0}
                {r.max_uses != null ? ` / ${r.max_uses}` : ""}
                {r.max_uses_per_customer != null ? (
                  <span className="text-[var(--clicks-muted)]"> · {r.max_uses_per_customer}/customer</span>
                ) : null}
              </span>
            ),
          },
          ...(canWrite
            ? [
                {
                  key: "actions",
                  header: "",
                  render: (r: CouponRow) => (
                    <div className="flex justify-end gap-3">
                      <button type="button" className="text-xs font-medium text-[var(--clicks-blue)]" onClick={() => openEdit(r)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-xs font-medium text-[var(--clicks-muted)]"
                        onClick={() => void setActive(r, !r.active)}
                      >
                        {r.active ? "Turn off" : "Turn on"}
                      </button>
                      <button
                        type="button"
                        className="text-xs font-medium text-[var(--clicks-error)]"
                        onClick={() => setDeleteTarget(r)}
                      >
                        Delete
                      </button>
                    </div>
                  ),
                },
              ]
            : []),
        ]}
        rows={items}
        loading={loading}
        rowKey={(r) => String(r.id)}
        empty={<EmptyState title="No coupons" description={canWrite ? "Create one with “New coupon”." : undefined} />}
        error={error ? <ErrorState message={error} onRetry={reload} /> : null}
      />
      <Pagination page={page} pageSize={ADMIN_LIST_PAGE_SIZE} total={count} onPageChange={setPage} />

      <AdminModal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Edit coupon" : "New coupon"}>
        <div className="space-y-3">
          <FormField label="Code" htmlFor="cp-code" required hint="What customers type at checkout. Saved in upper case." error={errors.code}>
            <input
              id="cp-code"
              className={`${adminInputClass} font-mono uppercase`}
              value={form.code}
              onChange={(e) => setField("code", e.target.value)}
            />
          </FormField>
          <FormField label="Description" htmlFor="cp-desc" hint="Internal note — not shown to customers.">
            <input
              id="cp-desc"
              className={adminInputClass}
              maxLength={255}
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
            />
          </FormField>
          <fieldset>
            <legend className="mb-1.5 text-[12px] font-medium">Discount type</legend>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="cp-type"
                  checked={form.type === "percent"}
                  onChange={() => setField("type", "percent")}
                />
                Percent
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="cp-type"
                  checked={form.type === "fixed"}
                  onChange={() => setField("type", "fixed")}
                />
                Fixed JOD amount
              </label>
            </div>
          </fieldset>
          {form.type === "percent" ? (
            <FormField label="Percent off" htmlFor="cp-pct" required hint="e.g. 10 for 10% off the subtotal." error={errors.percent_off}>
              <input
                id="cp-pct"
                type="number"
                step="0.01"
                min={0}
                max={100}
                className={adminInputClass}
                value={form.percent_off}
                onChange={(e) => setField("percent_off", e.target.value)}
              />
            </FormField>
          ) : (
            <FormField label="Amount off (JOD)" htmlFor="cp-jod" required hint="e.g. 2.5 = JOD 2.500 off the order." error={errors.amount_jod}>
              <input
                id="cp-jod"
                inputMode="decimal"
                className={adminInputClass}
                value={form.amount_jod}
                onChange={(e) => setField("amount_jod", e.target.value)}
              />
            </FormField>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Max uses (total)" htmlFor="cp-max" hint="Empty = unlimited." error={errors.max_uses}>
              <input
                id="cp-max"
                type="number"
                min={1}
                className={adminInputClass}
                value={form.max_uses}
                onChange={(e) => setField("max_uses", e.target.value)}
              />
            </FormField>
            <FormField
              label="Max uses per customer"
              htmlFor="cp-max-c"
              hint="Counted by e-mail. Empty = unlimited."
              error={errors.max_uses_per_customer}
            >
              <input
                id="cp-max-c"
                type="number"
                min={1}
                className={adminInputClass}
                value={form.max_uses_per_customer}
                onChange={(e) => setField("max_uses_per_customer", e.target.value)}
              />
            </FormField>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Starts at" htmlFor="cp-start" hint={`Your time zone (${tz}). Empty = immediately.`} error={errors.starts_at}>
              <input
                id="cp-start"
                type="datetime-local"
                className={adminInputClass}
                value={form.starts_at}
                onChange={(e) => setField("starts_at", e.target.value)}
              />
            </FormField>
            <FormField label="Ends at" htmlFor="cp-end" hint="Empty = never expires." error={errors.ends_at}>
              <input
                id="cp-end"
                type="datetime-local"
                className={adminInputClass}
                value={form.ends_at}
                onChange={(e) => setField("ends_at", e.target.value)}
              />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={(e) => setField("active", e.target.checked)} />
            On (customers can use it between the dates above)
          </label>
          {freeWarning ? <Notice tone="warning">{freeWarning}</Notice> : null}
          {formError ? <Notice tone="error">{formError}</Notice> : null}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </button>
            <button type="button" disabled={pending} onClick={() => void save()} className="admin-btn admin-btn-primary disabled:opacity-60">
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </AdminModal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete coupon?"
        description={deleteTarget ? `Permanently delete ${deleteTarget.code}. Coupons already used on orders cannot be deleted.` : undefined}
        danger
        confirmLabel="Delete"
        pending={pending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
      <ConfirmDialog
        open={Boolean(inUse)}
        title="Coupon already used"
        description={
          inUse
            ? `${inUse.code} has been used on orders, so it can't be deleted (order history keeps a reference). Turn it off instead so nobody can use it again?`
            : undefined
        }
        confirmLabel="Turn it off"
        onCancel={() => setInUse(null)}
        onConfirm={() => {
          if (inUse) void setActive(inUse, false);
          setInUse(null);
        }}
      />
    </div>
  );
}
