import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { LOCALE_COOKIE, parseLocale } from "@/lib/locale";
import { isMaintenanceExempt, maintenanceHtml, PATHNAME_HEADER } from "@/lib/maintenance";
import type { SiteContact } from "@/lib/site-contact";

// The same build can run as the storefront or as a panel-only deployment.
// PANEL_ONLY=true: the host serves only /admin. PANEL_URL: the storefront sends /admin there.
const PANEL_ONLY = process.env.PANEL_ONLY === "true";
const PANEL_URL = (process.env.PANEL_URL || "").replace(/\/+$/, "");
const API_URL = (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api/v1").replace(/\/$/, "");

type MaintenanceState = { on: boolean; storeName: string; contact: Partial<SiteContact> };

const SETTINGS_TTL_MS = 30_000;
let cached: { at: number; value: MaintenanceState } | null = null;
let pending: Promise<MaintenanceState> | null = null;

/** D21: public settings, cached ~30 s per server instance. Errors fail open (store stays up). */
async function maintenanceState(): Promise<MaintenanceState> {
  if (cached && Date.now() - cached.at < SETTINGS_TTL_MS) return cached.value;
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await fetch(`${API_URL}/cms/settings/`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as Record<string, unknown>;
      const text = (key: string) => (typeof data[key] === "string" ? (data[key] as string).trim() : "");
      const value: MaintenanceState = {
        on: data.maintenance_mode === true,
        storeName: text("store_name") || "MMH",
        contact: {
          support_email: text("support_email"),
          support_phone: text("support_phone"),
          whatsapp_number: text("whatsapp_number"),
          telegram_url: text("telegram_url"),
          instagram_url: text("instagram_url"),
          facebook_url: text("facebook_url"),
          tiktok_url: text("tiktok_url"),
          youtube_url: text("youtube_url"),
        },
      };
      cached = { at: Date.now(), value };
      return value;
    } catch {
      const value = cached?.value ?? { on: false, storeName: "MMH", contact: {} };
      cached = { at: Date.now(), value };
      return value;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");

  if (PANEL_ONLY && !isAdmin && !pathname.startsWith("/api/")) {
    return NextResponse.redirect(new URL("/admin", request.url));
  }
  if (!PANEL_ONLY && PANEL_URL && isAdmin) {
    return NextResponse.redirect(`${PANEL_URL}${pathname}${search}`);
  }

  if (isAdmin && !pathname.startsWith("/admin/login")) {
    const token =
      request.cookies.get("authjs.session-token") ?? request.cookies.get("__Secure-authjs.session-token");
    if (!token) {
      const url = new URL("/admin/login", request.url);
      url.searchParams.set("from", pathname);
      return NextResponse.redirect(url);
    }
  }

  // D21: browse pages answer 503 while the store is in maintenance; order, account, help and
  // auth pages keep working.
  if (!PANEL_ONLY && !isMaintenanceExempt(pathname)) {
    const state = await maintenanceState();
    if (state.on) {
      const locale = parseLocale(request.cookies.get(LOCALE_COOKIE)?.value);
      return new NextResponse(maintenanceHtml({ locale, storeName: state.storeName, contact: state.contact }), {
        status: 503,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Retry-After": "600",
          "Cache-Control": "no-store",
        },
      });
    }
  }

  const headers = new Headers(request.headers);
  headers.set(PATHNAME_HEADER, pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Skip Next internals and static files (anything with an extension).
  matcher: ["/((?!_next/|.*\\.[a-zA-Z0-9]+$).*)"],
};
