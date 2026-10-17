"use client";

import { hasPermission, ROUTE_PERMISSIONS, type PermissionKey } from "@/server/auth/permissions";
import { Search } from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type CommandItem = { href: string; label: string; permission?: PermissionKey };

const ITEMS: CommandItem[] = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/products", label: "Products", permission: "catalog.read" },
  { href: "/admin/products/new", label: "New product", permission: "catalog.write" },
  { href: "/admin/categories", label: "Categories", permission: "catalog.read" },
  { href: "/admin/platforms", label: "Platforms", permission: "catalog.read" },
  { href: "/admin/regions", label: "Regions", permission: "catalog.read" },
  { href: "/admin/inventory", label: "Inventory", permission: "codes.read" },
  { href: "/admin/codes", label: "Codes", permission: "codes.read" },
  { href: "/admin/codes/import", label: "Import codes", permission: "codes.manage" },
  { href: "/admin/orders", label: "Orders", permission: "orders.read" },
  { href: "/admin/customers", label: "Customers", permission: "customers.read" },
  { href: "/admin/suppliers", label: "Suppliers", permission: "suppliers.read" },
  { href: "/admin/integrations/1epin", label: "OneEpin", permission: "suppliers.read" },
  { href: "/admin/integrations/1epin/logs", label: "OneEpin logs", permission: "suppliers.read" },
  { href: "/admin/payments", label: "Payments", permission: "orders.read" },
  { href: "/admin/coupons", label: "Coupons", permission: "orders.read" },
  { href: "/admin/faqs", label: "FAQs", permission: "content.read" },
  { href: "/admin/administrators", label: "Administrators", permission: "admins.read" },
  { href: "/admin/roles", label: "Roles", permission: "admins.read" },
  { href: "/admin/audit", label: "Audit log", permission: "audit.read" },
  { href: "/admin/settings", label: "Settings", permission: "settings.manage" },
];

export function AdminCommandMenu({
  permissions = [],
  role,
}: {
  permissions?: string[];
  role?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const session = useSession();
  const sessionPerms = (session.data?.user?.permissions as string[] | undefined) ?? permissions;
  const sessionRole = (session.data?.user?.role as string | null | undefined) ?? role;

  const allowed = useMemo(
    () =>
      ITEMS.filter((item) => {
        if (!item.permission) return true;
        return hasPermission(sessionPerms, item.permission as PermissionKey, sessionRole as never);
      }),
    [sessionPerms, sessionRole],
  );

  const results = useMemo(
    () => allowed.filter((item) => item.label.toLowerCase().includes(query.toLowerCase())),
    [allowed, query],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuery("");
        setOpen((value) => !value);
      }
      if (event.key === "Escape") setOpen(false);
    };
    const onCustom = () => {
      setQuery("");
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mmh-admin-command", onCustom);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mmh-admin-command", onCustom);
    };
  }, []);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--clicks-navy)]/45 p-4 pt-[12vh] backdrop-blur-[1px]"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--clicks-border)] bg-white shadow-[0_16px_48px_rgba(11,21,56,0.18)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Command menu"
      >
        <div className="relative border-b border-[var(--clicks-border)]">
          <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--clicks-muted)]" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search admin pages…"
            className="h-12 w-full bg-transparent pe-4 ps-10 text-[14px] outline-none"
            aria-label="Search admin pages"
          />
        </div>
        <ul className="max-h-80 overflow-y-auto p-1.5">
          {results.map((item) => (
            <li key={item.href}>
              <button
                type="button"
                className="flex h-9 w-full items-center rounded-[var(--admin-radius-sm)] px-3 text-start text-[13px] text-[var(--clicks-text)] hover:bg-[#F5F7FB]"
                onClick={() => {
                  setOpen(false);
                  router.push(item.href);
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
          {!results.length ? (
            <li className="px-3 py-8 text-center text-[13px] text-[var(--clicks-muted)]">No matches</li>
          ) : null}
        </ul>
        <div className="border-t border-[var(--clicks-border)] bg-[#F7F8FC] px-3 py-2 text-[11px] text-[var(--clicks-muted)]">
          Enter to open · Esc to close
        </div>
      </div>
    </div>
  );
}

void ROUTE_PERMISSIONS;
