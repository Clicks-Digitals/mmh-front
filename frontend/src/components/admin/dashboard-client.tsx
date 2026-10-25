"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { Badge } from "@/components/admin/ui/badge";
import { AdminCard, AdminSectionHeader } from "@/components/admin/ui/card";
import { ErrorState } from "@/components/admin/ui/error-state";
import { PageHeader } from "@/components/admin/ui/page-header";
import { StatCard } from "@/components/admin/ui/stat-card";
import { getDashboard, type DashboardData } from "@/components/admin/ops/api";
import { auditActionLabel, auditEntityHref, auditEntityText } from "@/components/admin/lib/audit";
import { formatJod } from "@/components/admin/lib/money";
import { fulfillmentStatusLabel, orderHref, paymentStatusLabel } from "@/components/admin/lib/orders";
import { formatAdminDateTime } from "@/lib/admin/format";
import { useAdminQuery } from "@/hooks/use-admin-query";
import type { PermissionKey } from "@/server/auth/permissions";
import {
  AlertTriangle,
  Boxes,
  CalendarDays,
  Clock,
  Package,
  PackageX,
  ShoppingCart,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

const QUICK_LINKS: Array<{ href: string; title: string; body: string; permission: PermissionKey }> = [
  { href: "/admin/orders", title: "Orders", body: "Payments & delivery", permission: "orders.read" },
  { href: "/admin/products", title: "Products", body: "Catalog, variants & prices", permission: "catalog.read" },
  { href: "/admin/products/new", title: "New product", body: "Add a product to the store", permission: "catalog.write" },
  { href: "/admin/categories", title: "Categories", body: "Store navigation", permission: "catalog.read" },
  { href: "/admin/inventory", title: "Inventory", body: "Code stock levels", permission: "codes.read" },
  { href: "/admin/codes/import", title: "Import codes", body: "Bulk CSV / XLSX", permission: "codes.manage" },
  { href: "/admin/customers", title: "Customers", body: "Accounts & order history", permission: "customers.read" },
  { href: "/admin/banners", title: "Banners", body: "Homepage & shop banners", permission: "content.read" },
  { href: "/admin/pages", title: "Pages", body: "About, terms, privacy…", permission: "content.read" },
  { href: "/admin/faqs", title: "FAQs", body: "Help center questions", permission: "content.read" },
  { href: "/admin/integrations/1epin", title: "OneEpin", body: "Supplier status", permission: "suppliers.read" },
  { href: "/admin/audit", title: "Audit log", body: "Who changed what", permission: "audit.read" },
  { href: "/admin/settings", title: "Settings", body: "Store name, contact, maintenance", permission: "settings.manage" },
];

function QuickLinks({ columns = 1 }: { columns?: number }) {
  const { can } = useAdminAccess();
  const links = QUICK_LINKS.filter((l) => can(l.permission));
  if (!links.length) {
    return <p className="text-[13px] text-[var(--clicks-muted)]">Your role has no panel sections yet. Ask an administrator.</p>;
  }
  return (
    <div className={columns > 1 ? "grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3" : "grid gap-1.5"}>
      {links.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="rounded-[var(--admin-radius-sm)] px-2.5 py-2 transition hover:bg-[#F5F7FB]"
        >
          <p className="text-[13px] font-semibold text-[var(--clicks-navy)]">{item.title}</p>
          <p className="text-[11px] text-[var(--clicks-muted)]">{item.body}</p>
        </Link>
      ))}
    </div>
  );
}

function AttentionCard({
  href,
  icon: Icon,
  tone,
  title,
  body,
}: {
  href: string;
  icon: LucideIcon;
  tone: "amber" | "red" | "blue";
  title: string;
  body: string;
}) {
  const toneClass =
    tone === "red" ? "bg-red-50 text-red-700" : tone === "amber" ? "bg-amber-50 text-amber-700" : "bg-[var(--clicks-blue-soft)] text-[var(--clicks-blue)]";
  return (
    <Link href={href} className="admin-card flex items-center gap-3 p-3 transition hover:border-[var(--clicks-border-strong)]">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--admin-radius-sm)] ${toneClass}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-[var(--clicks-navy)]">{title}</p>
        <p className="text-[11px] text-[var(--clicks-muted)]">{body}</p>
      </div>
    </Link>
  );
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** OR-12: every card links to the orders list filtered exactly like the backend count. */
function ordersLink(stats: DashboardData, key: keyof NonNullable<DashboardData["links"]>, fallback: string) {
  const qs = stats.links?.[key] ?? fallback;
  return `/admin/orders${qs ? `?${qs}` : ""}`;
}

function attention(stats: DashboardData, canInventory: boolean) {
  const cards: Array<Parameters<typeof AttentionCard>[0] & { key: string }> = [];
  if (stats.awaiting_delivery) {
    cards.push({
      key: "awaiting",
      href: ordersLink(stats, "awaiting_delivery", "needs_action=1"),
      icon: Truck,
      tone: "blue",
      title: `${plural(stats.awaiting_delivery, "paid order")} waiting for delivery`,
      body: "Paid but not finished — open them and deliver the rest",
    });
  }
  if (stats.manual_review) {
    cards.push({
      key: "manual",
      href: ordersLink(stats, "manual_review", "fulfillment_status=MANUAL_REVIEW"),
      icon: AlertTriangle,
      tone: "amber",
      title: `${plural(stats.manual_review, "order")} need${stats.manual_review === 1 ? "s" : ""} review`,
      body: "Usually missing stock or a supplier issue",
    });
  }
  if (stats.failed_fulfillment) {
    cards.push({
      key: "failed",
      href: ordersLink(stats, "failed_fulfillment", "fulfillment_status=FAILED"),
      icon: AlertTriangle,
      tone: "red",
      title: `${plural(stats.failed_fulfillment, "order")} with failed delivery`,
      body: "Retry delivery or refund the customer",
    });
  }
  if (stats.pending_payment_24h) {
    cards.push({
      key: "pending",
      href: ordersLink(stats, "pending_payment_24h", "awaiting_payment_24h=1"),
      icon: Clock,
      tone: "amber",
      title: `${plural(stats.pending_payment_24h, "order")} awaiting payment (last 24 h)`,
      body: "Checkout started but not paid yet — nothing to do unless the customer asks",
    });
  }
  if (stats.low_stock_variants) {
    cards.push({
      key: "low",
      href: canInventory ? "/admin/inventory" : "/admin/orders",
      icon: Boxes,
      tone: "amber",
      title: `${plural(stats.low_stock_variants, "published code variant")} low on stock`,
      body: `${stats.low_stock_threshold ?? "Only a few"} or fewer codes left — import more`,
    });
  }
  if (stats.out_of_stock_variants) {
    cards.push({
      key: "oos",
      href: canInventory ? "/admin/inventory" : "/admin/orders",
      icon: PackageX,
      tone: "red",
      // Same rule and wording as the Inventory page ("published code variant(s) out of stock").
      title: `${plural(stats.out_of_stock_variants, "published code variant")} out of stock`,
      body: "Customers cannot buy these until more codes are imported",
    });
  }
  return cards;
}

function OrdersDashboard() {
  const { can } = useAdminAccess();
  const { data: stats, loading, error, reload } = useAdminQuery((token) => getDashboard(token));

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading || !stats) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="admin-card h-[88px] animate-pulse" />
        ))}
      </div>
    );
  }

  const cards = attention(stats, can("codes.read"));

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Link href={ordersLink(stats, "today", "")} className="block">
          <StatCard
            label="Today"
            value={stats.today?.orders ?? 0}
            hint={`orders · ${stats.today?.revenue_display || formatJod(stats.today?.revenue_fils ?? 0)} net revenue`}
            icon={CalendarDays}
            className="h-full transition hover:border-[var(--clicks-border-strong)]"
          />
        </Link>
        <StatCard
          label="Net revenue (all time)"
          value={stats.revenue_display || formatJod(stats.revenue_fils)}
          hint={
            stats.refunds_fils
              ? `${formatJod(stats.gross_revenue_fils ?? stats.revenue_fils)} paid − ${formatJod(stats.refunds_fils)} refunded`
              : "Paid and partly refunded orders, after refunds"
          }
          icon={Wallet}
        />
        <Link href={ordersLink(stats, "pending_orders", "payment_status=PENDING")} className="block">
          <StatCard
            label="Orders"
            value={stats.orders_count}
            hint={`${stats.pending_orders} not paid yet`}
            icon={ShoppingCart}
            className="h-full transition hover:border-[var(--clicks-border-strong)]"
          />
        </Link>
        <StatCard
          label="Products"
          value={stats.products_count}
          hint={`${stats.active_products} published · ${stats.codes_available} codes in stock`}
          icon={Package}
        />
      </div>

      {cards.length ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map(({ key, ...card }) => (
            <AttentionCard key={key} {...card} />
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900">
          Nothing needs attention — every paid order is delivered and stock looks fine.
        </p>
      )}

      <div className="mt-4 grid gap-3 lg:grid-cols-5">
        <AdminCard className="lg:col-span-3" padding="md">
          <AdminSectionHeader
            title="Recent orders"
            action={
              <Link href="/admin/orders" className="text-[12px] font-medium text-[var(--clicks-blue)]">
                View all
              </Link>
            }
          />
          {stats.recent_orders?.length ? (
            <div className="-mx-4 overflow-x-auto">
              <table className="min-w-full text-[13px]">
                <thead>
                  <tr className="border-y border-[var(--clicks-border)] bg-[#F7F8FC] text-[11px] text-[var(--clicks-muted)]">
                    <th className="px-4 py-2 text-start font-semibold">Order</th>
                    <th className="px-4 py-2 text-start font-semibold">Customer</th>
                    <th className="px-4 py-2 text-start font-semibold">Total</th>
                    <th className="px-4 py-2 text-start font-semibold">Status</th>
                    <th className="px-4 py-2 text-start font-semibold">When</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recent_orders.slice(0, 8).map((order) => (
                    <tr key={String(order.id)} className="border-t border-[var(--clicks-border)] hover:bg-[#F8FAFD]">
                      <td className="px-4 py-2.5">
                        <Link href={orderHref(order)} className="font-semibold text-[var(--clicks-blue)]">
                          {order.order_number}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-[var(--clicks-navy)]">{order.full_name}</p>
                        <p className="text-[11px] text-[var(--clicks-muted)]">{order.email}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                        {order.total_display || formatJod(order.total_fils)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          <Badge status={order.payment_status}>{paymentStatusLabel(order.payment_status)}</Badge>
                          <Badge status={order.fulfillment_status}>{fulfillmentStatusLabel(order.fulfillment_status)}</Badge>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-[var(--clicks-muted)]">
                        {formatAdminDateTime(order.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-6 text-center text-[13px] text-[var(--clicks-muted)]">No recent orders.</p>
          )}
        </AdminCard>

        <AdminCard className="lg:col-span-2" padding="md">
          <AdminSectionHeader title="Top products (paid units)" />
          {stats.top_products?.length ? (
            <ul className="divide-y divide-[var(--clicks-border)]">
              {stats.top_products.slice(0, 7).map((p, idx) => (
                <li key={String(p.product_id)} className="flex items-center gap-3 py-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F3F5F9] text-[10px] font-semibold text-[var(--clicks-muted)]">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-[var(--clicks-navy)]">{p.product_name}</p>
                    <p className="text-[11px] text-[var(--clicks-muted)]">
                      {p.quantity} sold · {p.orders} orders
                    </p>
                  </div>
                  <p className="shrink-0 text-[13px] font-semibold tabular-nums text-[var(--clicks-navy)]">
                    {formatJod(p.revenue_fils)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-[13px] text-[var(--clicks-muted)]">No sales data yet.</p>
          )}
        </AdminCard>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {can("audit.read") && stats.recent_audit ? (
          <AdminCard className="lg:col-span-2" padding="md">
            <AdminSectionHeader
              title="Recent activity"
              action={
                <Link href="/admin/audit" className="text-[12px] font-medium text-[var(--clicks-blue)]">
                  View all
                </Link>
              }
            />
            {stats.recent_audit.length ? (
              <ul className="divide-y divide-[var(--clicks-border)]">
                {stats.recent_audit.slice(0, 6).map((a) => {
                  const href = auditEntityHref(a);
                  const target = a.entity_type ? auditEntityText(a) : "";
                  return (
                    <li key={a.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-0.5 py-2 text-[13px]">
                      <span className="min-w-0">
                        <span className="font-medium text-[var(--clicks-navy)]">{auditActionLabel(a.action)}</span>
                        {target ? (
                          <>
                            {" · "}
                            {href ? (
                              <Link href={href} className="text-[var(--clicks-blue)]">
                                {target}
                              </Link>
                            ) : (
                              <span className="text-[var(--clicks-muted)]">{target}</span>
                            )}
                          </>
                        ) : null}
                        <span className="block text-[11px] text-[var(--clicks-muted)]">
                          by {a.actor_name || a.actor_email || "System / customer"}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] text-[var(--clicks-muted)]">
                        {formatAdminDateTime(a.created_at)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="py-4 text-[13px] text-[var(--clicks-muted)]">No activity yet.</p>
            )}
          </AdminCard>
        ) : null}
        <AdminCard padding="md">
          <AdminSectionHeader title="Quick links" />
          <QuickLinks />
        </AdminCard>
      </div>
    </>
  );
}

export function DashboardClient() {
  const { can } = useAdminAccess();
  const canOrders = can("orders.read");

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={
          canOrders
            ? "Live snapshot of orders, stock and recent activity."
            : "Welcome. Pick a section you have access to."
        }
        actions={
          can("catalog.write") ? (
            <Link href="/admin/products/new" className="admin-btn admin-btn-primary">
              New product
            </Link>
          ) : null
        }
      />
      {canOrders ? (
        <OrdersDashboard />
      ) : (
        <AdminCard padding="md">
          <AdminSectionHeader
            title="Your sections"
            description="Your role does not include order statistics. These are the sections you can open."
          />
          <QuickLinks columns={3} />
        </AdminCard>
      )}
    </div>
  );
}
