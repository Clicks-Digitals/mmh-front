"use client";

import { cn } from "@/lib/cn";
import { useAdminAccess } from "@/components/admin/admin-access";
import { roleLabel } from "@/components/admin/lib/roles";
import { type PermissionKey } from "@/server/auth/permissions";
import {
  CreditCard,
  FileText,
  FolderTree,
  Globe2,
  HelpCircle,
  Image as ImageIcon,
  KeyRound,
  LayoutDashboard,
  Link2,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Percent,
  ScrollText,
  Settings,
  Shield,
  ShoppingCart,
  Tag,
  Users,
  Warehouse,
  Boxes,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

export type AdminNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: PermissionKey;
};

export type AdminNavGroup = {
  id: string;
  label: string;
  icon?: LucideIcon;
  items: AdminNavItem[];
  permissionAny?: PermissionKey[];
};

export const ADMIN_NAV: Array<AdminNavItem | AdminNavGroup> = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  {
    id: "catalog",
    label: "Catalog",
    icon: Boxes,
    permissionAny: ["catalog.read", "catalog.write"],
    items: [
      { href: "/admin/products", label: "Products", icon: Package, permission: "catalog.read" },
      { href: "/admin/categories", label: "Categories", icon: FolderTree, permission: "catalog.read" },
      { href: "/admin/platforms", label: "Platforms", icon: Tag, permission: "catalog.read" },
      { href: "/admin/regions", label: "Regions", icon: Globe2, permission: "catalog.read" },
    ],
  },
  {
    id: "commerce",
    label: "Commerce",
    icon: ShoppingCart,
    permissionAny: ["codes.read", "orders.read", "customers.read"],
    items: [
      { href: "/admin/inventory", label: "Inventory", icon: Warehouse, permission: "codes.read" },
      { href: "/admin/codes", label: "Codes", icon: KeyRound, permission: "codes.read" },
      { href: "/admin/orders", label: "Orders", icon: ShoppingCart, permission: "orders.read" },
      { href: "/admin/customers", label: "Customers", icon: Users, permission: "customers.read" },
      { href: "/admin/payments", label: "Payments", icon: CreditCard, permission: "orders.read" },
      { href: "/admin/coupons", label: "Coupons", icon: Percent, permission: "orders.read" },
    ],
  },
  {
    id: "suppliers",
    label: "Suppliers",
    icon: Link2,
    permissionAny: ["suppliers.read", "suppliers.write"],
    items: [
      { href: "/admin/suppliers", label: "Suppliers", icon: Link2, permission: "suppliers.read" },
      { href: "/admin/integrations/1epin", label: "OneEpin", icon: Link2, permission: "suppliers.read" },
      { href: "/admin/integrations/1epin/logs", label: "OneEpin logs", icon: ScrollText, permission: "suppliers.read" },
    ],
  },
  {
    id: "content",
    label: "Content",
    icon: FileText,
    permissionAny: ["content.read", "content.write"],
    items: [
      { href: "/admin/banners", label: "Banners", icon: ImageIcon, permission: "content.read" },
      { href: "/admin/pages", label: "Pages", icon: FileText, permission: "content.read" },
      { href: "/admin/faqs", label: "FAQs", icon: HelpCircle, permission: "content.read" },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: Shield,
    permissionAny: ["admins.read", "admins.write", "audit.read", "settings.manage"],
    items: [
      { href: "/admin/administrators", label: "Administrators", icon: Users, permission: "admins.read" },
      { href: "/admin/roles", label: "Roles", icon: Shield, permission: "admins.read" },
      { href: "/admin/audit", label: "Audit log", icon: ScrollText, permission: "audit.read" },
      { href: "/admin/settings", label: "Settings", icon: Settings, permission: "settings.manage" },
    ],
  },
];

function isGroup(entry: AdminNavItem | AdminNavGroup): entry is AdminNavGroup {
  return "items" in entry;
}

function matches(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

const NAV_HREFS = ADMIN_NAV.flatMap((entry) => (isGroup(entry) ? entry.items.map((item) => item.href) : [entry.href]));

// Only the most specific match is active, so /admin/integrations/1epin/logs
// highlights "OneEpin logs" and not "OneEpin" as well.
function isActive(pathname: string, href: string) {
  if (!matches(pathname, href)) return false;
  return !NAV_HREFS.some((other) => other.length > href.length && matches(pathname, other));
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  collapsed,
  onClick,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  collapsed: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-lg text-[13px] transition-colors duration-150",
        collapsed ? "h-10 justify-center px-0" : "h-9 px-2.5",
        active
          ? "bg-[var(--clicks-blue)]/18 font-medium text-white shadow-[inset_0_0_0_1px_rgba(59,130,246,0.22)]"
          : "text-white/68 hover:bg-white/[0.06] hover:text-white",
      )}
    >
      {active && !collapsed ? (
        <span
          aria-hidden
          className="absolute start-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-e-full bg-[var(--clicks-blue)]"
        />
      ) : null}
      <Icon
        className={cn(
          "shrink-0 transition-colors",
          collapsed ? "h-[18px] w-[18px]" : "h-4 w-4",
          active ? "text-[var(--clicks-blue)]" : "text-white/55 group-hover:text-white/85",
        )}
        strokeWidth={1.75}
      />
      {!collapsed ? <span className="truncate">{label}</span> : null}
    </Link>
  );
}

export function AdminSidebar({
  open,
  onClose,
  collapsed,
  onToggleCollapse,
  name = "",
  email = "",
}: {
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  name?: string;
  email?: string;
}) {
  const pathname = usePathname();
  const { can, role } = useAdminAccess();

  const filtered = useMemo(() => {
    const allowed = (permission?: PermissionKey) => (permission ? can(permission) : true);

    return ADMIN_NAV.map((entry) => {
      if (!isGroup(entry)) {
        return allowed(entry.permission) ? entry : null;
      }
      const items = entry.items.filter((item) => allowed(item.permission));
      if (!items.length) return null;
      return { ...entry, items };
    }).filter(Boolean) as Array<AdminNavItem | AdminNavGroup>;
  }, [can]);

  return (
    <>
      {open ? (
        <button
          className="fixed inset-0 z-30 bg-[var(--clicks-navy)]/50 backdrop-blur-[1px] lg:hidden"
          onClick={onClose}
          aria-label="Close menu"
        />
      ) : null}
      <aside
        className={cn(
          "z-40 flex h-full shrink-0 flex-col text-white transition-[width,transform] duration-200",
          "fixed inset-y-0 start-0 lg:static lg:translate-x-0",
          "bg-[linear-gradient(180deg,#0b1538_0%,#0a1230_45%,#080f28_100%)]",
          "border-e border-white/[0.06]",
          collapsed ? "w-[72px]" : "w-[248px]",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div
          className={cn(
            "flex h-14 shrink-0 items-center border-b border-white/[0.07]",
            collapsed ? "justify-center px-2" : "gap-2 px-3",
          )}
        >
          <Link
            href="/admin"
            className={cn("flex min-w-0 items-center gap-2.5 overflow-hidden", collapsed ? "" : "flex-1")}
            onClick={onClose}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--clicks-blue)] text-[11px] font-bold tracking-wide shadow-[0_6px_16px_rgba(37,99,235,0.35)]">
              MMH
            </span>
            {!collapsed ? (
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold leading-tight tracking-tight">
                  MMH Admin
                </span>
                <span className="block truncate text-[10px] text-white/40">Commerce console</span>
              </span>
            ) : null}
          </Link>
          <button
            type="button"
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/45 hover:bg-white/[0.08] hover:text-white lg:inline-flex"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        <nav className="admin-scrollbar flex-1 overflow-y-auto px-2.5 py-4">
          {filtered.map((entry, index) => {
            if (!isGroup(entry)) {
              return (
                <div key={entry.href} className={cn(index > 0 && "mt-1")}>
                  <NavLink
                    href={entry.href}
                    label={entry.label}
                    icon={entry.icon}
                    active={isActive(pathname, entry.href)}
                    collapsed={collapsed}
                    onClick={onClose}
                  />
                </div>
              );
            }

            return (
              <div
                key={entry.id}
                className={cn(
                  "mt-5 first:mt-0",
                  collapsed && "mt-3 border-t border-white/[0.06] pt-3 first:border-0 first:pt-0",
                )}
              >
                {!collapsed ? (
                  <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/32">
                    {entry.label}
                  </p>
                ) : null}
                <div className="flex flex-col gap-0.5">
                  {entry.items.map((item) => (
                    <NavLink
                      key={item.href}
                      href={item.href}
                      label={item.label}
                      icon={item.icon}
                      active={isActive(pathname, item.href)}
                      collapsed={collapsed}
                      onClick={onClose}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        {!collapsed ? (
          <div className="shrink-0 border-t border-white/[0.07] px-3 py-3">
            <div className="rounded-lg bg-white/[0.04] px-2.5 py-2" title={email || name}>
              <p className="text-[11px] text-white/45">Signed in as</p>
              <p className="mt-0.5 truncate text-[12px] font-medium text-white/85">{name || email || "Administrator"}</p>
              <p className="truncate text-[11px] text-white/50">
                {email && email !== name ? `${email} · ` : ""}
                {roleLabel(role)}
              </p>
            </div>
          </div>
        ) : null}
      </aside>
    </>
  );
}
