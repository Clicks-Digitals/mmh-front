type CategoryLike = {
  id: number | string;
  name_en: string;
  parent?: number | string | null;
  status?: string;
};

export type CategoryOption<T extends CategoryLike> = { category: T; depth: number; label: string };

const INDENT = "    ";

/**
 * Categories ordered as a tree for a <select>: each sub-category right below its parent,
 * indented ("    ↳ Gift cards"). Keeps the incoming order among siblings; categories whose
 * parent is missing are treated as top level, and cycles are cut.
 */
export function categoryTreeOptions<T extends CategoryLike>(categories: T[]): Array<CategoryOption<T>> {
  const ids = new Set(categories.map((c) => String(c.id)));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const c of categories) {
    const parent = c.parent != null && c.parent !== "" ? String(c.parent) : "";
    if (parent && ids.has(parent) && parent !== String(c.id)) {
      const list = children.get(parent) ?? [];
      list.push(c);
      children.set(parent, list);
    } else {
      roots.push(c);
    }
  }
  const out: Array<CategoryOption<T>> = [];
  const seen = new Set<string>();
  const walk = (c: T, depth: number) => {
    const key = String(c.id);
    if (seen.has(key)) return;
    seen.add(key);
    const status = c.status && c.status !== "PUBLISHED" ? ` (${c.status.toLowerCase()})` : "";
    out.push({ category: c, depth, label: `${depth ? `${INDENT.repeat(depth)}↳ ` : ""}${c.name_en}${status}` });
    for (const child of children.get(key) ?? []) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  // Anything left (only reachable through a cycle) is shown at the top level.
  for (const c of categories) if (!seen.has(String(c.id))) walk(c, 0);
  return out;
}
