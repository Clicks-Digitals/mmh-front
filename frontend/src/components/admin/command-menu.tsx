"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { useNavigationGuard } from "@/components/admin/layout/navigation-guard";
import { ADMIN_NAV } from "@/components/admin/layout/sidebar";
import {
  flattenGroups,
  groupSearchResults,
  matchesQuery,
  moveHighlight,
  shortcutLabel,
  shouldSearchRemote,
  type SearchResult,
} from "@/components/admin/lib/command-search";
import { useAdminToken } from "@/hooks/use-admin-token";
import { asList, listCustomers, listOrders, listPages, listProducts } from "@/lib/api/admin";
import { cn } from "@/lib/cn";
import { type PermissionKey } from "@/server/auth/permissions";
import { Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type CommandItem = { href: string; label: string; permission?: PermissionKey; keywords?: string };

/** Every real page in the sidebar, plus a few deep links. */
const ITEMS: CommandItem[] = [
  ...ADMIN_NAV.flatMap((entry) =>
    "items" in entry
      ? entry.items.map((item) => ({ href: item.href, label: item.label, permission: item.permission }))
      : [{ href: entry.href, label: entry.label, permission: entry.permission }],
  ),
  { href: "/admin/products/new", label: "New product", permission: "catalog.write", keywords: "add create" },
  { href: "/admin/codes/import", label: "Import codes", permission: "codes.manage", keywords: "upload csv excel stock" },
  { href: "/admin/codes/imports", label: "Code import history", permission: "codes.manage" },
  {
    href: "/admin/orders?fulfillment_status=MANUAL_REVIEW",
    label: "Orders waiting for delivery (manual review)",
    permission: "orders.read",
  },
];

const PAGE_SIZE = 5;

/**
 * D23 / CA-08: search across admin pages, products, orders, customers and content pages.
 * Only sections the signed-in role can read are queried. ↑/↓ move, Enter opens.
 */
export function AdminCommandMenu() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [shortcut, setShortcut] = useState("Ctrl K");
  const { can } = useAdminAccess();
  const token = useAdminToken();
  const { navigate } = useNavigationGuard();
  const seq = useRef(0);
  const listRef = useRef<HTMLUListElement>(null);

  const allowed = useMemo(() => ITEMS.filter((item) => !item.permission || can(item.permission)), [can]);
  const scope = useMemo(
    () => ({
      products: can("catalog.read") || can("codes.manage"),
      orders: can("orders.read"),
      customers: can("customers.read"),
      content: can("content.read"),
    }),
    [can],
  );

  const staticResults = useMemo<SearchResult[]>(() => {
    const q = query.trim();
    return allowed
      .filter((item) => !q || matchesQuery(`${item.label} ${item.keywords ?? ""}`, q))
      .map((item) => ({ id: `page:${item.href}`, group: "pages" as const, label: item.label, href: item.href }));
  }, [allowed, query]);

  const groups = useMemo(
    () => groupSearchResults([...staticResults, ...(shouldSearchRemote(query) ? remote : [])], query.trim() ? 6 : 30),
    [staticResults, remote, query],
  );
  const flat = useMemo(() => flattenGroups(groups), [groups]);
  const offsets = useMemo(() => {
    const out: number[] = [];
    let n = 0;
    for (const g of groups) {
      out.push(n);
      n += g.items.length;
    }
    return out;
  }, [groups]);
  const active = flat.length ? Math.min(highlight, flat.length - 1) : -1;

  useEffect(() => {
    const t = window.setTimeout(() => setShortcut(shortcutLabel(navigator.platform || navigator.userAgent)), 0);
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuery("");
        setHighlight(0);
        setOpen((value) => !value);
      }
    };
    const onCustom = () => {
      setQuery("");
      setHighlight(0);
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mmh-admin-command", onCustom);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mmh-admin-command", onCustom);
    };
  }, []);

  // Remote search (debounced; stale responses are ignored).
  useEffect(() => {
    if (!open || !token) return;
    const q = query.trim();
    const id = ++seq.current;
    if (!shouldSearchRemote(q)) {
      const t = window.setTimeout(() => {
        if (id === seq.current) {
          setRemote([]);
          setLoading(false);
        }
      }, 0);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(async () => {
      setLoading(true);
      const params = { search: q, page_size: PAGE_SIZE };
      const jobs: Array<Promise<SearchResult[]>> = [];
      if (scope.products) {
        jobs.push(
          listProducts(token, params).then((d) =>
            asList(d).items.map((p) => ({
              id: `product:${p.id}`,
              group: "products" as const,
              label: p.name_en,
              hint: [p.status === "PUBLISHED" ? "Published" : p.status === "DRAFT" ? "Draft" : "Archived", p.slug].join(" · "),
              href: `/admin/products/${encodeURIComponent(p.slug)}`,
            })),
          ),
        );
      }
      if (scope.orders) {
        jobs.push(
          listOrders(token, params).then((d) =>
            asList(d).items.map((o) => ({
              id: `order:${o.id}`,
              group: "orders" as const,
              label: o.order_number,
              hint: [o.email, o.full_name].filter(Boolean).join(" · "),
              href: `/admin/orders/${encodeURIComponent(o.order_number)}`,
            })),
          ),
        );
      }
      if (scope.customers) {
        jobs.push(
          listCustomers(token, params).then((d) =>
            asList(d).items.map((c) => ({
              id: `customer:${c.id}`,
              group: "customers" as const,
              label: c.name || c.email,
              hint: c.name ? c.email : undefined,
              href: `/admin/customers/${encodeURIComponent(String(c.id))}`,
            })),
          ),
        );
      }
      if (scope.content) {
        jobs.push(
          listPages(token, params).then((d) =>
            asList(d).items.map((p) => ({
              id: `content:${p.slug}`,
              group: "content" as const,
              label: p.title_en,
              hint: `/${p.slug}`,
              href: `/admin/pages?search=${encodeURIComponent(p.slug)}`,
            })),
          ),
        );
      }
      const settled = await Promise.allSettled(jobs);
      if (id !== seq.current) return;
      setRemote(settled.flatMap((r) => (r.status === "fulfilled" ? r.value : [])));
      setLoading(false);
    }, 250);
    return () => window.clearTimeout(t);
  }, [query, open, token, scope]);

  useEffect(() => {
    if (active < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function go(item: SearchResult | undefined) {
    if (!item) return;
    setOpen(false);
    navigate(item.href);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--clicks-navy)]/45 p-4 pt-[10vh] backdrop-blur-[1px]"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--clicks-border)] bg-white shadow-[0_16px_48px_rgba(11,21,56,0.18)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Search the admin panel"
      >
        <div className="relative border-b border-[var(--clicks-border)]">
          <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--clicks-muted)]" />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setHighlight(moveHighlight(active, 1, flat.length));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlight(moveHighlight(active, -1, flat.length));
              } else if (event.key === "Enter") {
                event.preventDefault();
                go(flat[active]);
              } else if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
              }
            }}
            placeholder="Search products, orders, customers, pages…"
            className="h-12 w-full bg-transparent pe-10 ps-10 text-[14px] outline-none"
            role="combobox"
            aria-expanded="true"
            aria-controls="admin-command-results"
            aria-activedescendant={active >= 0 ? `admin-command-item-${active}` : undefined}
            aria-label="Search products, orders, customers and pages"
          />
          {loading ? (
            <Loader2 className="absolute end-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[var(--clicks-muted)]" />
          ) : null}
        </div>
        <ul ref={listRef} id="admin-command-results" role="listbox" className="max-h-[60vh] overflow-y-auto p-1.5">
          {groups.map((group, gi) => (
            <li key={group.id} role="presentation">
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--clicks-muted)]">
                {group.label}
              </p>
              <ul role="presentation">
                {group.items.map((item, ii) => {
                  const i = offsets[gi] + ii;
                  return (
                    <li key={item.id} role="presentation">
                      <button
                        type="button"
                        id={`admin-command-item-${i}`}
                        data-index={i}
                        role="option"
                        aria-selected={i === active}
                        className={cn(
                          "flex min-h-9 w-full items-center gap-3 rounded-[var(--admin-radius-sm)] px-3 py-1.5 text-start text-[13px] text-[var(--clicks-text)]",
                          i === active ? "bg-[var(--clicks-blue-soft)] text-[var(--clicks-navy)]" : "hover:bg-[#F5F7FB]",
                        )}
                        onMouseMove={() => setHighlight(i)}
                        onClick={() => go(item)}
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                        {item.hint ? <span className="max-w-[50%] truncate text-[11px] text-[var(--clicks-muted)]">{item.hint}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
          {!flat.length ? (
            <li className="px-3 py-8 text-center text-[13px] text-[var(--clicks-muted)]">
              {loading ? "Searching…" : shouldSearchRemote(query) ? `Nothing found for “${query.trim()}”.` : "Type at least 2 letters to search."}
            </li>
          ) : null}
        </ul>
        <div className="flex flex-wrap justify-between gap-2 border-t border-[var(--clicks-border)] bg-[#F7F8FC] px-3 py-2 text-[11px] text-[var(--clicks-muted)]">
          <span>↑ ↓ to move · Enter to open · Esc to close</span>
          <span>{shortcut} opens this anywhere</span>
        </div>
      </div>
    </div>
  );
}
