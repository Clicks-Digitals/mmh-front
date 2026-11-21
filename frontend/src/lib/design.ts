/** Store design (Admin → Store design): theme colours, neon level and the home page sections. */

export type NeonLevel = "off" | "accents" | "full";

export type StoreTheme = {
  primary: string;
  secondary: string;
  background: string;
  neon: NeonLevel;
};

export const DEFAULT_THEME: StoreTheme = { primary: "#f7c037", secondary: "#565895", background: "#17182b", neon: "accents" };

export const BUILTIN_SECTIONS = [
  "banners",
  "promo",
  "platforms",
  "categories",
  "best_sellers",
  "services",
  "suggested",
  "support",
] as const;
export type BuiltinSectionType = (typeof BUILTIN_SECTIONS)[number];

export type ProductRowSource = "category" | "products" | "deals" | "newest";

export type ProductsSection = {
  id: string;
  type: "products";
  visible: boolean;
  title_en: string;
  title_ar: string;
  source: ProductRowSource;
  category: string;
  products: string[];
  limit: number;
  style: "row" | "grid";
};

export type ImageSection = {
  id: string;
  type: "image";
  visible: boolean;
  image: string;
  image_mobile: string;
  href: string;
  alt_en: string;
  alt_ar: string;
};

export type BuiltinSection = { id: string; type: BuiltinSectionType; visible: boolean };
export type HomeSection = BuiltinSection | ProductsSection | ImageSection;

export const DEFAULT_HOME_LAYOUT: HomeSection[] = BUILTIN_SECTIONS.map((type) => ({ id: type, type, visible: true }));

/** Ready-made looks offered in the panel (the client can still fine-tune each colour). */
export const THEME_PRESETS: Array<{ key: string; label: string; theme: StoreTheme }> = [
  { key: "classic", label: "MMH classic", theme: DEFAULT_THEME },
  { key: "neon", label: "Neon night", theme: { primary: "#22e6ff", secondary: "#a855f7", background: "#0c0b1d", neon: "full" } },
  { key: "magenta", label: "Magenta arcade", theme: { primary: "#ff3dbb", secondary: "#6d5dfc", background: "#120d22", neon: "full" } },
  { key: "gold", label: "Gold & purple glow", theme: { primary: "#f7c037", secondary: "#8b5cf6", background: "#14132a", neon: "full" } },
  { key: "calm", label: "Calm (no glow)", theme: { primary: "#f7c037", secondary: "#565895", background: "#17182b", neon: "off" } },
];

const HEX = /^#[0-9a-f]{6}$/i;

export function normalizeTheme(raw: unknown): StoreTheme {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const color = (key: "primary" | "secondary" | "background") => {
    const v = String(value[key] ?? "").trim();
    return HEX.test(v) ? v.toLowerCase() : DEFAULT_THEME[key];
  };
  const neon = String(value.neon ?? "");
  return {
    primary: color("primary"),
    secondary: color("secondary"),
    background: color("background"),
    neon: neon === "off" || neon === "full" || neon === "accents" ? neon : DEFAULT_THEME.neon,
  };
}

export function normalizeHomeLayout(raw: unknown): HomeSection[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_HOME_LAYOUT;
  const out: HomeSection[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const type = String(row.type ?? "");
    const visible = row.visible !== false;
    const id = String(row.id ?? type);
    if ((BUILTIN_SECTIONS as readonly string[]).includes(type)) {
      out.push({ id, type: type as BuiltinSectionType, visible });
    } else if (type === "products") {
      const source = String(row.source ?? "category");
      out.push({
        id,
        type,
        visible,
        title_en: String(row.title_en ?? ""),
        title_ar: String(row.title_ar ?? ""),
        source: (["category", "products", "deals", "newest"].includes(source) ? source : "category") as ProductRowSource,
        category: String(row.category ?? ""),
        products: Array.isArray(row.products) ? row.products.map(String) : [],
        limit: Math.max(2, Math.min(24, Number(row.limit) || 8)),
        style: row.style === "grid" ? "grid" : "row",
      });
    } else if (type === "image" && row.image) {
      out.push({
        id,
        type,
        visible,
        image: String(row.image),
        image_mobile: String(row.image_mobile ?? ""),
        href: String(row.href ?? ""),
        alt_en: String(row.alt_en ?? ""),
        alt_ar: String(row.alt_ar ?? ""),
      });
    }
  }
  return out.length ? out : DEFAULT_HOME_LAYOUT;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(hex: string, target: [number, number, number], amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const c = (v: number, t: number) => Math.round(v + (t - v) * amount);
  return `#${[c(r, target[0]), c(g, target[1]), c(b, target[2])].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const lighten = (hex: string, amount: number) => mix(hex, [255, 255, 255], amount);
const darken = (hex: string, amount: number) => mix(hex, [0, 0, 0], amount);

/** The storefront's text is white, so the background must stay dark (same rule as the backend). */
export function isBackgroundTooLight(hex: string): boolean {
  if (!HEX.test(hex)) return false;
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 90;
}

/** Dark or light text that reads on the given colour. */
function readableOn(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#17182b" : "#ffffff";
}

/** CSS variable overrides for the storefront; "" when the theme is the built-in one. */
export function themeCss(theme: StoreTheme): string {
  const d = DEFAULT_THEME;
  if (theme.primary === d.primary && theme.secondary === d.secondary && theme.background === d.background) return "";
  const [pr, pg, pb] = hexToRgb(theme.primary);
  const [sr, sg, sb] = hexToRgb(theme.secondary);
  const vars: Record<string, string> = {
    "--primary": theme.primary,
    "--primary-hover": lighten(theme.primary, 0.15),
    "--primary-active": darken(theme.primary, 0.12),
    "--primary-foreground": readableOn(theme.primary),
    "--secondary": theme.secondary,
    "--secondary-hover": lighten(theme.secondary, 0.15),
    "--secondary-active": darken(theme.secondary, 0.15),
    "--secondary-foreground": readableOn(theme.secondary),
    "--background": theme.background,
    "--surface-primary": lighten(theme.background, 0.05),
    "--surface-secondary": lighten(theme.background, 0.08),
    "--surface-elevated": lighten(theme.background, 0.11),
    "--glow-purple": `rgba(${sr}, ${sg}, ${sb}, 0.28)`,
    "--glow-yellow": `rgba(${pr}, ${pg}, ${pb}, 0.18)`,
    "--mmh-yellow-500": theme.primary,
    "--mmh-yellow-400": lighten(theme.primary, 0.15),
    "--mmh-yellow-600": darken(theme.primary, 0.12),
    "--mmh-navy-950": theme.background,
    "--mmh-navy-900": lighten(theme.background, 0.05),
    "--mmh-navy-850": lighten(theme.background, 0.08),
    "--mmh-navy-800": lighten(theme.background, 0.11),
  };
  return `:root{${Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";")}}`;
}
