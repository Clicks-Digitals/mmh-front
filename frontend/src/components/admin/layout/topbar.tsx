"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { useBreadcrumbLabels } from "@/components/admin/layout/breadcrumbs";
import { useNavigationGuard } from "@/components/admin/layout/navigation-guard";
import { shortcutLabel } from "@/components/admin/lib/command-search";
import { roleLabel as formatRole } from "@/components/admin/lib/roles";
import { AdminAvatar } from "@/components/admin/ui/avatar";
import { cn } from "@/lib/cn";
import { ChevronDown, LogOut, Menu, Search, Settings, X } from "lucide-react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

const LABELS: Record<string, string> = {
  admin: "Dashboard",
  products: "Products",
  categories: "Categories",
  platforms: "Platforms",
  regions: "Regions",
  inventory: "Inventory",
  codes: "Codes",
  import: "Import",
  imports: "Imports",
  orders: "Orders",
  customers: "Customers",
  suppliers: "Suppliers",
  integrations: "Integrations",
  "1epin": "1Epin",
  mappings: "Linked products",
  logs: "Logs",
  payments: "Payments",
  coupons: "Coupons",
  banners: "Banners",
  faqs: "FAQs",
  pages: "Pages",
  administrators: "Administrators",
  roles: "Roles",
  audit: "Audit log",
  settings: "Settings",
  new: "New",
};

/** Paths that are only URL groupings (they redirect), so their crumb is not a link. */
const NOT_LINKABLE = new Set(["/admin/integrations"]);

function breadcrumbLabel(segment: string) {
  return LABELS[segment] ?? segment.replaceAll("-", " ");
}

export function AdminTopbar({
  name,
  role,
  onMenuOpen,
  menuOpen,
}: {
  name: string;
  role: string;
  onMenuOpen: () => void;
  menuOpen: boolean;
}) {
  const pathname = usePathname();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const overrides = useBreadcrumbLabels();
  const { can } = useAdminAccess();
  const canSettings = can("settings.manage");
  const { confirmDiscard } = useNavigationGuard();
  const [shortcut, setShortcut] = useState("Ctrl K");

  useEffect(() => {
    const t = window.setTimeout(() => setShortcut(shortcutLabel(navigator.platform || navigator.userAgent)), 0);
    return () => window.clearTimeout(t);
  }, []);

  const crumbs = useMemo(() => {
    const parts = pathname.split("/").filter(Boolean);
    return parts.map((part, index) => {
      const href = "/" + parts.slice(0, index + 1).join("/");
      return { label: overrides[href] ?? breadcrumbLabel(decodeURIComponent(part)), href };
    });
  }, [pathname, overrides]);

  useEffect(() => {
    if (!menu) return;
    function onDoc(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menu]);

  const roleLabel = formatRole(role);

  return (
    <header className="z-20 flex h-14 shrink-0 items-center gap-3 border-b border-[var(--clicks-border)] bg-white px-4">
      <button
        type="button"
        className="rounded-[var(--admin-radius-sm)] p-2 text-[var(--clicks-muted)] hover:bg-[#F3F5F9] lg:hidden"
        onClick={onMenuOpen}
        aria-label="Open menu"
      >
        {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>

      <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-[13px] md:flex">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <span key={crumb.href} className="flex min-w-0 items-center gap-1.5">
              {index > 0 ? <span className="text-[var(--clicks-border-strong)]">/</span> : null}
              {last || NOT_LINKABLE.has(crumb.href) ? (
                <span
                  aria-current={last ? "page" : undefined}
                  className={cn(
                    "max-w-[280px] truncate",
                    last ? "font-semibold text-[var(--clicks-navy)]" : "text-[var(--clicks-muted)]",
                  )}
                >
                  {crumb.label}
                </span>
              ) : (
                <Link href={crumb.href} className="max-w-[200px] truncate text-[var(--clicks-muted)] hover:text-[var(--clicks-blue)]">
                  {crumb.label}
                </Link>
              )}
            </span>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("mmh-admin-command"))}
        className="ms-auto hidden h-9 max-w-sm flex-1 items-center gap-2 rounded-[var(--admin-radius-sm)] border border-[var(--clicks-border)] bg-[#F7F8FC] px-3 text-start text-[13px] text-[var(--clicks-muted)] transition hover:border-[var(--clicks-border-strong)] hover:bg-white md:flex lg:ms-8"
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 truncate">Search products, orders, customers…</span>
        <kbd className="hidden rounded border border-[var(--clicks-border)] bg-white px-1.5 py-0.5 text-[10px] font-medium text-[var(--clicks-muted)] lg:inline">
          {shortcut}
        </kbd>
      </button>

      <div className="ms-auto flex items-center gap-2 md:ms-0">
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--admin-radius-sm)] border border-[var(--clicks-border)] text-[var(--clicks-muted)] md:hidden"
          onClick={() => window.dispatchEvent(new Event("mmh-admin-command"))}
          aria-label="Search"
        >
          <Search className="h-4 w-4" />
        </button>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenu((v) => !v)}
            className="flex items-center gap-2 rounded-[var(--admin-radius)] py-1 pe-1.5 ps-1 hover:bg-[#F5F7FB]"
            aria-expanded={menu}
            aria-haspopup="menu"
          >
            <AdminAvatar name={name} size="sm" />
            <span className="hidden min-w-0 text-start sm:block">
              <span className="block max-w-[140px] truncate text-[13px] font-semibold leading-tight text-[var(--clicks-navy)]">
                {name}
              </span>
              <span className="block max-w-[140px] truncate text-[11px] text-[var(--clicks-muted)]">
                {roleLabel}
              </span>
            </span>
            <ChevronDown className="hidden h-3.5 w-3.5 text-[var(--clicks-muted)] sm:block" />
          </button>

          {menu ? (
            <div
              role="menu"
              className="absolute end-0 top-full z-40 mt-1.5 w-52 overflow-hidden rounded-[var(--admin-radius)] border border-[var(--clicks-border)] bg-white py-1 shadow-[var(--admin-shadow-hover)]"
            >
              <div className="border-b border-[var(--clicks-border)] px-3 py-2.5">
                <p className="truncate text-[13px] font-semibold text-[var(--clicks-navy)]">{name}</p>
                <p className="truncate text-[11px] text-[var(--clicks-muted)]">{roleLabel}</p>
              </div>
              {canSettings ? (
              <Link
                href="/admin/settings"
                role="menuitem"
                className="flex h-9 items-center gap-2 px-3 text-[13px] text-[var(--clicks-text)] hover:bg-[#F5F7FB]"
                onClick={() => setMenu(false)}
              >
                <Settings className="h-3.5 w-3.5 text-[var(--clicks-muted)]" />
                Settings
              </Link>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="flex h-9 w-full items-center gap-2 px-3 text-[13px] text-[var(--clicks-error)] hover:bg-red-50"
                onClick={() => {
                  setMenu(false);
                  confirmDiscard(() => void signOut({ callbackUrl: "/admin/login" }), { confirmLabel: "Discard and sign out" });
                }}
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
