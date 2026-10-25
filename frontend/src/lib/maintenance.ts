/** D21 maintenance mode helpers (pure — used by src/proxy.ts and the storefront layout). */

import type { SiteContact } from "@/lib/site-contact";

/** Header set by src/proxy.ts so the storefront layout knows which page is rendering. */
export const PATHNAME_HEADER = "x-mmh-pathname";

const EXEMPT_PREFIXES = [
  "/order", // /order/<n>, /order-success, /order-lookup
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/account",
  "/contact",
  "/pages/",
  "/api",
  "/admin",
  "/_next",
  "/maintenance",
];

/** Pages that keep working while the store is in maintenance (orders, accounts, help). */
export function isMaintenanceExempt(pathname: string): boolean {
  const path = pathname || "/";
  if (/\.[a-zA-Z0-9]+$/.test(path)) return true; // static files (favicon, robots.txt, images…)
  return EXEMPT_PREFIXES.some((prefix) =>
    prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}-`),
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : char === '"' ? "&quot;" : "&#39;",
  );
}

/** Contact channels to show on the maintenance page (only those set in Settings). */
export function maintenanceContactLinks(contact: Partial<SiteContact>): Array<{ label: string; href: string }> {
  const links: Array<{ label: string; href: string }> = [];
  const email = (contact.support_email ?? "").trim();
  const phone = (contact.support_phone ?? "").trim();
  const whatsapp = (contact.whatsapp_number ?? "").replace(/\D/g, "");
  if (email) links.push({ label: email, href: `mailto:${email}` });
  if (phone) links.push({ label: phone, href: `tel:${phone.replace(/\s/g, "")}` });
  if (whatsapp) links.push({ label: "WhatsApp", href: `https://wa.me/${whatsapp}` });
  const urls: Array<[string, string | undefined]> = [
    ["Telegram", contact.telegram_url],
    ["Instagram", contact.instagram_url],
    ["Facebook", contact.facebook_url],
    ["TikTok", contact.tiktok_url],
    ["YouTube", contact.youtube_url],
  ];
  for (const [label, href] of urls) {
    const url = (href ?? "").trim();
    if (/^https?:\/\//i.test(url)) links.push({ label, href: url });
  }
  return links;
}

const COPY = {
  en: {
    title: "We'll be back soon",
    body: "The store is temporarily closed for maintenance. Existing orders are safe — you can still open your orders and account.",
    contact: "Need help with an order? Contact us:",
    links: [
      { href: "/account/orders", label: "My orders" },
      { href: "/order-lookup", label: "Track an order" },
    ],
  },
  ar: {
    title: "سنعود قريباً",
    body: "المتجر مغلق مؤقتاً للصيانة. طلباتك الحالية بأمان — ما زال بإمكانك فتح طلباتك وحسابك.",
    contact: "تحتاج مساعدة في طلب؟ تواصل معنا:",
    links: [
      { href: "/account/orders", label: "طلباتي" },
      { href: "/order-lookup", label: "تتبّع طلباً" },
    ],
  },
} as const;

/** Self-contained 503 page served by the proxy for browse pages while maintenance mode is on. */
export function maintenanceHtml({
  locale,
  storeName,
  contact,
}: {
  locale: "en" | "ar";
  storeName: string;
  contact: Partial<SiteContact>;
}): string {
  const copy = COPY[locale];
  const links = maintenanceContactLinks(contact);
  const contactBlock = links.length
    ? `<p class="c">${escapeHtml(copy.contact)}</p><ul>${links
        .map(
          (link) =>
            `<li><a href="${escapeHtml(link.href)}" dir="ltr"${link.href.startsWith("http") ? ' target="_blank" rel="noopener noreferrer"' : ""}>${escapeHtml(link.label)}</a></li>`,
        )
        .join("")}</ul>`
    : "";
  const nav = copy.links.map((link) => `<a href="${link.href}">${escapeHtml(link.label)}</a>`).join(" · ");
  const other = locale === "ar" ? { code: "en", label: "English" } : { code: "ar", label: "العربية" };
  return `<!doctype html><html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(`${copy.title} · ${storeName}`)}</title><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#17182b;color:#f4f5fb;font-family:${locale === "ar" ? "Tahoma,Arial" : "ui-sans-serif,system-ui,-apple-system,'Segoe UI'"},sans-serif;text-align:center;padding:24px;box-sizing:border-box}
main{max-width:560px}h1{font-size:2rem;margin:0 0 16px}p{color:#b8bad2;line-height:1.7;margin:0 0 16px}.c{color:#f4f5fb;font-weight:600;margin-top:28px}
ul{list-style:none;padding:0;margin:12px 0 0;display:flex;flex-wrap:wrap;gap:10px;justify-content:center}li a{display:inline-block;padding:10px 16px;border:1px solid rgba(184,186,210,.28);border-radius:12px;background:#262743;color:#f4f5fb;text-decoration:none}
a{color:#f7c037}.brand{font-weight:700;letter-spacing:.2em;color:#f7c037;margin-bottom:28px}.nav{margin-top:28px;font-size:.9rem}
</style></head><body><main><p class="brand">${escapeHtml(storeName)}</p><h1>${escapeHtml(copy.title)}</h1><p>${escapeHtml(copy.body)}</p>${contactBlock}<p class="nav">${nav}</p><p class="nav"><a href="?lang=${other.code}" onclick="document.cookie='mmh-locale=${other.code};path=/;max-age=31536000;samesite=lax';location.reload();return false;">${other.label}</a></p></main></body></html>`;
}
