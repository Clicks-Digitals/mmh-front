"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { PHONE_ERROR, normalizePhone } from "@/components/admin/ops/auth-helpers";
import { getCustomerDetail, patchCustomer, type CustomerRow } from "@/components/admin/ops/api";
import { Notice } from "@/components/admin/ops/controls";
import { Badge } from "@/components/admin/ui/badge";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { FormField, adminInputClass, adminTextareaClass } from "@/components/admin/ui/form-field";
import { PageHeader } from "@/components/admin/ui/page-header";
import { StatCard } from "@/components/admin/ui/stat-card";
import { useAdminToast } from "@/components/admin/ui/toast";
import { adminErrorSummary, adminFieldErrors } from "@/components/admin/lib/errors";
import { formatJod } from "@/components/admin/lib/money";
import { fulfillmentStatusLabel, orderHref, paymentStatusLabel } from "@/components/admin/lib/orders";
import { formatAdminDate, formatAdminDateTime } from "@/lib/admin/format";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { useAdminToken } from "@/hooks/use-admin-token";
import Link from "next/link";
import { useState } from "react";

const STATUS_OPTIONS = [
  { value: "active", label: "Regular" },
  { value: "vip", label: "VIP" },
  { value: "flagged", label: "Watch closely" },
  { value: "blocked", label: "Do not serve" },
];

function EditCustomer({ customer, onSaved }: { customer: CustomerRow; onSaved: (c: CustomerRow) => void }) {
  const toast = useAdminToast();
  const token = useAdminToken();
  const [form, setForm] = useState({
    name: customer.name ?? "",
    phone: customer.phone ?? "",
    status: customer.status || "active",
    notes: customer.notes ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const statusOptions = STATUS_OPTIONS.some((o) => o.value === form.status)
    ? STATUS_OPTIONS
    : [{ value: form.status, label: form.status }, ...STATUS_OPTIONS];

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  }

  return (
    <form
      className="admin-card space-y-3 p-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!token) return;
        const phone = normalizePhone(form.phone);
        if (phone === null) {
          setErrors({ phone: PHONE_ERROR });
          return;
        }
        setPending(true);
        setErrors({});
        try {
          const saved = await patchCustomer(token, customer.id, {
            name: form.name.trim(),
            phone,
            status: form.status,
            notes: form.notes,
          });
          onSaved({ ...customer, ...saved });
          setForm((f) => ({ ...f, phone }));
          toast.push("Customer saved", "success");
        } catch (err) {
          const fields = adminFieldErrors(err);
          setErrors(fields);
          toast.push(adminErrorSummary(err, "Could not save the customer.", ["name", "phone", "status", "notes"]), "error");
        } finally {
          setPending(false);
        }
      }}
    >
      <p className="text-sm font-semibold text-[var(--clicks-navy)]">Edit customer</p>
      <FormField label="Name" htmlFor="cu-name" error={errors.name}>
        <input id="cu-name" className={adminInputClass} value={form.name} onChange={(e) => update("name", e.target.value)} />
      </FormField>
      <FormField label="Phone" htmlFor="cu-phone" hint="International format, e.g. +962791234567." error={errors.phone}>
        <input
          id="cu-phone"
          type="tel"
          inputMode="tel"
          className={adminInputClass}
          value={form.phone}
          aria-invalid={Boolean(errors.phone)}
          onChange={(e) => update("phone", e.target.value)}
          onBlur={() => {
            if (normalizePhone(form.phone) === null) setErrors((er) => ({ ...er, phone: PHONE_ERROR }));
          }}
        />
      </FormField>
      <FormField
        label="Label"
        htmlFor="cu-status"
        hint="A note for staff only. To stop someone from signing in or buying, use “Disable account”."
        error={errors.status}
      >
        <select id="cu-status" className={adminInputClass} value={form.status} onChange={(e) => update("status", e.target.value)}>
          {statusOptions.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Staff notes" htmlFor="cu-notes" hint="Only staff can see this." error={errors.notes}>
        <textarea id="cu-notes" className={adminTextareaClass} value={form.notes} onChange={(e) => update("notes", e.target.value)} />
      </FormField>
      <button type="submit" disabled={pending} className="admin-btn admin-btn-primary disabled:opacity-60">
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

function OrderList({ list, empty, canOrders }: { list: NonNullable<CustomerRow["recent_orders"]>; empty: string; canOrders: boolean }) {
  if (!list.length) return <p className="mt-2 text-sm text-[var(--clicks-muted)]">{empty}</p>;
  return (
    <ul className="mt-2 divide-y divide-[var(--clicks-border)] text-sm">
      {list.map((o) => (
        <li key={String(o.id)} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <div>
            {canOrders ? (
              <Link href={orderHref(o)} className="font-medium text-[var(--clicks-blue)]">
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
            <span className="tabular-nums">{formatJod(o.total_fils)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CustomerDetailClient({ id }: { id: string }) {
  const { can } = useAdminAccess();
  const toast = useAdminToast();
  const [confirmAccess, setConfirmAccess] = useState(false);
  const [pending, setPending] = useState(false);
  const { data: customer, setData, loading, error, reload, token } = useAdminQuery(
    (tok) => getCustomerDetail(tok, id),
    [id],
  );

  if (loading && !customer) return <div className="h-40 animate-pulse rounded-xl border border-[var(--clicks-border)] bg-white" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!customer) return <EmptyState title="Customer not found" />;

  const canOrders = can("orders.read");
  const canWrite = can("customers.write");
  const orders = customer.recent_orders ?? [];
  const accountOrders = orders.filter((o) => !o.is_guest);
  const guestOrders = orders.filter((o) => o.is_guest);

  async function toggleAccess() {
    if (!token || !customer) return;
    setPending(true);
    try {
      const saved = await patchCustomer(token, customer.id, { disabled: !customer.disabled });
      setData({ ...customer, ...saved });
      toast.push(saved.disabled ? "Account disabled" : "Account enabled", "success");
      setConfirmAccess(false);
    } catch (err) {
      toast.push(adminErrorSummary(err, "Could not change the account."), "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={customer.name || customer.email}
        description={customer.email}
        actions={
          <>
            {canWrite ? (
              <button
                type="button"
                className={`admin-btn ${customer.disabled ? "admin-btn-primary" : "admin-btn-danger"}`}
                onClick={() => setConfirmAccess(true)}
              >
                {customer.disabled ? "Enable account" : "Disable account"}
              </button>
            ) : null}
            <Link href="/admin/customers" className="text-sm font-medium text-[var(--clicks-blue)]">
              Back to customers
            </Link>
          </>
        }
      />
      {customer.disabled ? (
        <Notice tone="error" className="mb-4">
          This account is disabled: the customer cannot sign in or check out.
        </Notice>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Orders"
          value={customer.orders_count ?? 0}
          hint={customer.guest_orders_count ? `${customer.guest_orders_count} placed as a guest with this e-mail` : undefined}
        />
        <StatCard
          label="Total spent"
          value={formatJod(customer.total_spent_fils ?? 0)}
          hint="Paid orders after refunds"
        />
        <StatCard label="Joined" value={<span className="text-base">{formatAdminDate(customer.created_at)}</span>} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <div className="admin-card p-4 text-sm">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--clicks-muted)]">Account</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {customer.disabled ? <Badge tone="error">Disabled</Badge> : <Badge tone="success">Can sign in</Badge>}
                  {customer.status && customer.status !== "active" ? (
                    <Badge tone="warning">{STATUS_OPTIONS.find((o) => o.value === customer.status)?.label ?? customer.status}</Badge>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--clicks-muted)]">Phone</dt>
                <dd className="mt-1">{customer.phone || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--clicks-muted)]">Language</dt>
                <dd className="mt-1">
                  {customer.locale === "ar" ? "Arabic" : customer.locale === "en" ? "English" : customer.locale || "—"}
                </dd>
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
            <p className="text-sm font-semibold text-[var(--clicks-navy)]">Orders from this account</p>
            <OrderList list={accountOrders} empty="No orders from this account yet." canOrders={canOrders} />
          </div>

          <div className="admin-card p-4">
            <p className="text-sm font-semibold text-[var(--clicks-navy)]">Guest orders with the same e-mail</p>
            <p className="text-xs text-[var(--clicks-muted)]">Placed without signing in, so they are not linked to the account.</p>
            <OrderList list={guestOrders} empty="No guest orders with this e-mail." canOrders={canOrders} />
          </div>
        </div>

        {canWrite ? <EditCustomer customer={customer} onSaved={(c) => setData(c)} /> : null}
      </div>

      <ConfirmDialog
        open={confirmAccess}
        title={customer.disabled ? "Enable this account?" : "Disable this account?"}
        description={
          customer.disabled
            ? "The customer can sign in and buy again."
            : "The customer is signed out everywhere and cannot sign in or check out until you enable the account again. Their past orders stay as they are."
        }
        danger={!customer.disabled}
        confirmLabel={customer.disabled ? "Enable account" : "Disable account"}
        cancelLabel="Go back"
        pending={pending}
        onCancel={() => setConfirmAccess(false)}
        onConfirm={() => void toggleAccess()}
      />
    </div>
  );
}
