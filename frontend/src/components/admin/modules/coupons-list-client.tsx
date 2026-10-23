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
import { adminErrorMessage, adminFieldErrors, errorCode } from "@/components/admin/lib/errors";
import { filsToJodInput, jodInputToFils } from "@/components/admin/lib/money";
import { formatAdminDateTime } from "@/lib/admin/format";
import { useAdminResource } from "@/hooks/use-admin-resource";
import { createCoupon, deleteCoupon, listCoupons, updateCoupon, type Coupon } from "@/lib/api/admin";
import { formatFils } from "@/server/money";
import { useState } from "react";

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
  if (!form.code.trim()) e.code = "Code is required";
  else if (!/^[A-Za-z0-9_-]{2,40}$/.test(form.code.trim())) e.code = "2–40 letters, numbers, - or _";
  if (form.type === "percent") {
    const n = Number(form.percent_off);
    if (!form.percent_off.trim() || !Number.isFinite(n) || n <= 0 || n > 100) e.percent_off = "Between 0 and 100";
  } else {
    const fils = jodInputToFils(form.amount_jod);
    if (fils == null || Number.isNaN(fils) || fils <= 0) e.amount_jod = "Enter an amount in JOD";
  }
  for (const key of ["max_uses", "max_uses_per_customer"] as const) {
    const v = form[key].trim();
    if (v && (!/^\d+$/.test(v) || Number(v) < 1)) e[key] = "Whole number ≥ 1, or empty for unlimited";
  }
  const start = localInputToIso(form.starts_at);
  const end = localInputToIso(form.ends_at);
  if (start && end && end <= start) e.ends_at = "Must be after the start";
  return e;
}

export function CouponsListClient() {
  const toast = useAdminToast();
  const { can } = useAdminAccess();
  const canWrite = can("orders.write");
  const { token, page, setPage, search, setSearch, items, count, loading, error, reload } =
    useAdminResource<Coupon>(async (tok, p, s) => {
      const data = await listCoupons(tok, { page: p, page_size: ADMIN_LIST_PAGE_SIZE, search: s || undefined });
      return { items: data.results, count: data.count };
    });

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Coupon | null>(null);
  const [inUse, setInUse] = useState<Coupon | null>(null);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setErrors({});
    setModalOpen(true);
  }

  function openEdit(row: Coupon) {
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
      if (editing) {
        await updateCoupon(token, editing.id, body);
        toast.push("Coupon updated", "success");
      } else {
        await createCoupon(token, body);
        toast.push("Coupon created", "success");
      }
      setModalOpen(false);
      reload();
    } catch (err) {
      const fields = adminFieldErrors(err);
      if (fields.amount_off_fils) fields.amount_jod = fields.amount_off_fils;
      setErrors(fields);
      toast.push(adminErrorMessage(err, "Save failed"), "error");
    } finally {
      setPending(false);
    }
  }

  async function setActive(row: Coupon, active: boolean) {
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
    if (r.percent_off != null && r.percent_off !== "") return `${Number(r.percent_off)}%`;
    if (r.amount_off_fils != null) return `${formatFils(r.amount_off_fils)} JOD`;
    return "—";
  }

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
      <Filters search={search} onSearchChange={setSearch} searchPlaceholder="Search coupons…" />
      <DataTable
        columns={[
          { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs">{r.code}</span> },
          { key: "discount", header: "Discount", render: (r) => discountLabel(r) },
          {
            key: "status",
            header: "Status",
            render: (r) => <Badge status={r.active ? "ACTIVE" : "DISABLED"}>{r.active ? "Active" : "Inactive"}</Badge>,
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
                  render: (r: Coupon) => (
                    <div className="flex justify-end gap-3">
                      <button type="button" className="text-xs font-medium text-[var(--clicks-blue)]" onClick={() => openEdit(r)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-xs font-medium text-[var(--clicks-muted)]"
                        onClick={() => void setActive(r, !r.active)}
                      >
                        {r.active ? "Deactivate" : "Activate"}
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
        empty={<EmptyState title="No coupons" />}
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
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
            />
          </FormField>
          <FormField label="Description" htmlFor="cp-desc" hint="Internal note — not shown to customers.">
            <input
              id="cp-desc"
              className={adminInputClass}
              maxLength={255}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
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
                  onChange={() => setForm((f) => ({ ...f, type: "percent" }))}
                />
                Percent
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="cp-type"
                  checked={form.type === "fixed"}
                  onChange={() => setForm((f) => ({ ...f, type: "fixed" }))}
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
                onChange={(e) => setForm((f) => ({ ...f, percent_off: e.target.value }))}
              />
            </FormField>
          ) : (
            <FormField label="Amount off (JOD)" htmlFor="cp-jod" required hint="e.g. 2.5 = 2.500 JOD off the order." error={errors.amount_jod}>
              <input
                id="cp-jod"
                inputMode="decimal"
                className={adminInputClass}
                value={form.amount_jod}
                onChange={(e) => setForm((f) => ({ ...f, amount_jod: e.target.value }))}
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
                onChange={(e) => setForm((f) => ({ ...f, max_uses: e.target.value }))}
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
                onChange={(e) => setForm((f) => ({ ...f, max_uses_per_customer: e.target.value }))}
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
                onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))}
              />
            </FormField>
            <FormField label="Ends at" htmlFor="cp-end" hint="Empty = never expires." error={errors.ends_at}>
              <input
                id="cp-end"
                type="datetime-local"
                className={adminInputClass}
                value={form.ends_at}
                onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))}
              />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
            Active
          </label>
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
            ? `${inUse.code} has been used on orders, so it can't be deleted (order history keeps a reference). Deactivate it instead so nobody can use it again?`
            : undefined
        }
        confirmLabel="Deactivate"
        onCancel={() => setInUse(null)}
        onConfirm={() => {
          if (inUse) void setActive(inUse, false);
          setInUse(null);
        }}
      />
    </div>
  );
}
