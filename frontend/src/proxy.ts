import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// The same build can run as the storefront or as a panel-only deployment.
// PANEL_ONLY=true: the host serves only /admin. PANEL_URL: the storefront sends /admin there.
const PANEL_ONLY = process.env.PANEL_ONLY === "true";
const PANEL_URL = (process.env.PANEL_URL || "").replace(/\/+$/, "");

export function proxy(request: NextRequest) {
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
  return NextResponse.next();
}

export const config = {
  // Skip Next internals and static files (anything with an extension).
  matcher: ["/((?!_next/|.*\\.[a-zA-Z0-9]+$).*)"],
};
