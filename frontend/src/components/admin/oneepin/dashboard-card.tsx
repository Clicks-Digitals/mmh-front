"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { Badge } from "@/components/admin/ui/badge";
import { AdminCard } from "@/components/admin/ui/card";
import { getStatus, type DashboardOneEpin } from "@/components/admin/oneepin/api";
import { modeLabel, modeTone, supplierAmount } from "@/components/admin/oneepin/labels";
import { formatAdminDateTime } from "@/lib/admin/format";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { cn } from "@/lib/cn";
import Link from "next/link";

function Card({ data }: { data: DashboardOneEpin }) {
  const { can } = useAdminAccess();
  const canSuppliers = can("suppliers.read");
  const title = canSuppliers ? (
    <Link href="/admin/integrations/1epin" className="hover:underline">
      1Epin supplier
    </Link>
  ) : (
    "1Epin supplier"
  );
  return (
    <AdminCard padding="md" className="mt-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-[13px] font-semibold text-[var(--clicks-navy)]">{title}</h2>
        <Badge tone={modeTone(data.mode)} className="normal-case tracking-normal">
          {modeLabel(data.mode)}
        </Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-[11px] text-[var(--clicks-muted)]">Balance</p>
          <p className={cn("text-[1.1rem] font-semibold tabular-nums", data.low_balance ? "text-amber-700" : "text-[var(--clicks-navy)]")}>
            {data.balance ? supplierAmount(data.balance, data.currency) : "—"}
          </p>
          <p className="text-[11px] text-[var(--clicks-muted)]">
            {data.low_balance ? "Low — top up 1Epin soon" : data.balance_checked_at ? `Checked ${formatAdminDateTime(data.balance_checked_at)}` : "Not checked yet"}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-[var(--clicks-muted)]">Open alerts</p>
          {canSuppliers ? (
            <Link
              href="/admin/integrations/1epin#alerts"
              className={cn("text-[1.1rem] font-semibold tabular-nums", data.open_alerts ? "text-amber-700" : "text-[var(--clicks-navy)]")}
            >
              {data.open_alerts}
            </Link>
          ) : (
            <p className="text-[1.1rem] font-semibold tabular-nums">{data.open_alerts}</p>
          )}
          <p className="text-[11px] text-[var(--clicks-muted)]">Problems a person should look at</p>
        </div>
        <div>
          <p className="text-[11px] text-[var(--clicks-muted)]">1Epin orders needing review</p>
          <Link
            href="/admin/integrations/1epin/orders?needs_review=1"
            className={cn("text-[1.1rem] font-semibold tabular-nums", data.manual_review_orders ? "text-amber-700" : "text-[var(--clicks-navy)]")}
          >
            {data.manual_review_orders}
          </Link>
          <p className="text-[11px] text-[var(--clicks-muted)]">Open orders whose 1Epin purchase stopped and waits for a decision</p>
        </div>
      </div>
    </AdminCard>
  );
}

/** For staff without orders.read (no dashboard API): read the 1Epin status instead. */
function StatusBackedCard() {
  const { data } = useAdminQuery((tok) => getStatus(tok));
  if (!data) return null;
  return (
    <Card
      data={{
        mode: data.mode ?? "",
        balance: data.balance?.amount ?? data.last_balance ?? null,
        currency: data.balance?.currency ?? data.currency ?? null,
        balance_checked_at: data.balance?.checked_at ?? data.last_checked_at ?? null,
        low_balance: Boolean(data.low_balance),
        open_alerts: data.open_alerts ?? 0,
        manual_review_orders: data.orders_manual_review ?? 0,
      }}
    />
  );
}

/** Dashboard 1Epin card: pass the `oneepin` block of GET dashboard/, or omit it to load the status. */
export function OneEpinDashboardCard({ data }: { data?: DashboardOneEpin | null }) {
  const { can } = useAdminAccess();
  if (!can("suppliers.read") && !can("orders.read")) return null;
  if (data) return <Card data={data} />;
  if (data === undefined && can("suppliers.read")) return <StatusBackedCard />;
  return null;
}
