"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { Badge } from "@/components/admin/ui/badge";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { FormField, adminInputClass, adminTextareaClass } from "@/components/admin/ui/form-field";
import { PageHeader } from "@/components/admin/ui/page-header";
import { StatCard } from "@/components/admin/ui/stat-card";
import { useAdminToast } from "@/components/admin/ui/toast";
import { adminErrorMessage, adminFieldErrors } from "@/components/admin/lib/errors";
import { fulfillmentStatusLabel, paymentStatusLabel } from "@/components/admin/lib/orders";
import { formatAdminDateTime } from "@/lib/admin/format";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { useAdminToken } from "@/hooks/use-admin-token";
import { getCustomer, updateCustomer, type AdminCustomer } from "@/lib/api/admin";
import { formatFils } from "@/server/money";
import Link from "next/link";
import { useState } from "react";

const STATUS_OPTIONS = ["active", "vip", "flagged", "blocked"];

function EditCustomer({ customer, onSaved }: { customer: AdminCustomer; onSaved: (c: AdminCustomer) => void }) {
  const toast = useAdminToast();
  const token = useAdminToken();
  const [form, setForm] = useState({
    phone: customer.phone ?? "",
    status: customer.status || "active",
    notes: customer.notes ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const statusOptions = STATUS_OPTIONS.includes(form.status) ? STATUS_OPTIONS : [form.status, ...STATUS_OPTIONS];

  return (
    <form
      className="admin-card space-y-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!token) return;
        setPending(true);
        setErrors({});
        try {
          const saved = await updateCustomer(token, customer.id, {
            phone: form.phone.trim(),
            status: form.status,
            notes: form.notes,
          });
          onSaved({ ...customer, ...saved });
          toast.push("Customer updated", "success");
        } catch (err) {
          setErrors(adminFieldErrors(err));
          toast.push(adminErrorMessage(err, "Save failed"), "error");
        } finally {
          setPending(false);
        }
      }}
    >
      <p className="text-sm font-semibold text-[var(--clicks-navy)]">Edit customer</p>
      <FormField label="Phone" htmlFor="cu-phone" error={errors.phone}>
        <input
          id="cu-phone"
          type="tel"
          className={adminInputClass}
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
        />
      </FormField>
      <FormField
        label="Status label"
        htmlFor="cu-status"
        hint="Internal label for staff. It does not block sign-in or checkout."
        error={errors.status}
      >
        <select
          id="cu-status"
          className={adminInputClass}
          value={form.status}
          onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
        >
          {statusOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Staff notes" htmlFor="cu-notes" hint="Visible to staff only." error={errors.notes}>
        <textarea
          id="cu-notes"
          className={adminTextareaClass}
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        />
      </FormField>
      <button type="submit" disabled={pending} className="admin-btn admin-btn-primary disabled:opacity-60">
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

export function CustomerDetailClient({ id }: { id: string }) {
  const { can } = useAdminAccess();
  const { data: customer, setData, loading, error, reload } = useAdminQuery((token) => getCustomer(token, id), [id]);

  if (loading) return <div className="h-40 animate-pulse rounded-xl border border-[var(--clicks-border)] bg-white" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!customer) return <EmptyState title="Customer not found" />;

  const canOrders = can("orders.read");

  return (
    <div>
      <PageHeader
        title={customer.name || customer.email}
        description={customer.email}
        actions={
          <Link href="/admin/customers" className="text-sm font-medium text-[var(--clicks-blue)]">
            Back to customers
          </Link>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Orders" value={customer.orders_count ?? 0} />
        <StatCard label="Total spent (paid)" value={`${formatFils(customer.total_spent_fils ?? 0)} JOD`} />
        <StatCard label="Joined" value={<span className="text-base">{formatAdminDateTime(customer.created_at)}</span>} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="admin-card p-4 text-sm">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--clicks-muted)]">Status</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  <Badge status={customer.status || "ACTIVE"} />
                  {customer.disabled ? <Badge tone="error">Account disabled</Badge> : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--clicks-muted)]">Phone</dt>
                <dd className="mt-1">{customer.phone || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--clicks-muted)]">Language</dt>
                <dd className="mt-1">{customer.locale === "ar" ? "Arabic" : customer.locale === "en" ? "English" : customer.locale || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--clicks-muted)]">Last updated</dt>
                <dd className="mt-1">{formatAdminDateTime(customer.updated_at)}</dd>
              </div>
            </dl>
            {customer.notes ? (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--clicks-muted)]">Staff notes</p>
                <p className="mt-1 whitespace-pre-wrap">{customer.notes}</p>
              </div>
            ) : null}
          </div>

          <div className="admin-card p-4">
            <p className="text-sm font-semibold text-[var(--clicks-navy)]">Recent orders</p>
            {customer.recent_orders?.length ? (
              <ul className="mt-2 divide-y divide-[var(--clicks-border)] text-sm">
                {customer.recent_orders.map((o) => (
                  <li key={String(o.id)} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      {canOrders ? (
                        <Link href={`/admin/orders/${o.id}`} className="font-medium text-[var(--clicks-blue)]">
                          {o.order_number}
                        </Link>
                      ) : (
                        <span className="font-medium">{o.order_number}</span>
                      )}
                      <p className="text-xs text-[var(--clicks-muted)]">{formatAdminDateTime(o.created_at)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge status={o.payment_status}>{paymentStatusLabel(o.payment_status)}</Badge>
                      <Badge status={o.fulfillment_status}>{fulfillmentStatusLabel(o.fulfillment_status)}</Badge>
                      <span className="tabular-nums">{formatFils(o.total_fils)} JOD</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-[var(--clicks-muted)]">No orders from this account yet.</p>
            )}
          </div>
        </div>

        {can("customers.write") ? (
          <EditCustomer customer={customer} onSaved={(c) => setData(c)} />
        ) : null}
      </div>
    </div>
  );
}
