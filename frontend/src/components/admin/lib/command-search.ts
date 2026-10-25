/** Pure helpers for the admin command menu / top-bar search (D23, CA-08). */

export type SearchGroupId = "pages" | "products" | "orders" | "customers" | "content";

export type SearchResult = {
  id: string;
  group: SearchGroupId;
  label: string;
  hint?: string;
  href: string;
};

export const GROUP_LABELS: Record<SearchGroupId, string> = {
  pages: "Go to",
  products: "Products",
  orders: "Orders",
  customers: "Customers",
  content: "Content pages",
};

export const GROUP_ORDER: SearchGroupId[] = ["pages", "products", "orders", "customers", "content"];

export type SearchGroup = { id: SearchGroupId; label: string; items: SearchResult[] };

/** Group results in a fixed order, dropping empty groups and duplicate hrefs. */
export function groupSearchResults(results: SearchResult[], perGroup = 6): SearchGroup[] {
  const seen = new Set<string>();
  const groups: SearchGroup[] = [];
  for (const id of GROUP_ORDER) {
    const items = results
      .filter((r) => r.group === id)
      .filter((r) => {
        if (seen.has(r.href)) return false;
        seen.add(r.href);
        return true;
      })
      .slice(0, perGroup);
    if (items.length) groups.push({ id, label: GROUP_LABELS[id], items });
  }
  return groups;
}

/** Flat, keyboard-navigable order of the grouped results. */
export function flattenGroups(groups: SearchGroup[]): SearchResult[] {
  return groups.flatMap((g) => g.items);
}

/** Arrow-key movement with wrap-around; -1 when there is nothing to highlight. */
export function moveHighlight(current: number, delta: number, length: number): number {
  if (length <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  return (((current + delta) % length) + length) % length;
}

/** Case/diacritic-insensitive "every word appears" match for static page titles. */
export function matchesQuery(text: string, query: string): boolean {
  const norm = (v: string) =>
    v
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
  const hay = norm(text);
  return norm(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

/** "⌘K" on Apple platforms, "Ctrl K" elsewhere (Windows, Linux, Android). */
export function shortcutLabel(platform: string | null | undefined): string {
  return /mac|iphone|ipad|ipod/i.test(platform ?? "") ? "⌘K" : "Ctrl K";
}

/** Remote search only runs for 2+ characters (single letters match everything). */
export function shouldSearchRemote(query: string): boolean {
  return query.trim().length >= 2;
}
