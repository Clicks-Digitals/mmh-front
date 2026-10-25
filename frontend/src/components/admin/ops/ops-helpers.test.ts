import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import {
  loginErrorMessage,
  normalizePhone,
  passwordAcceptable,
  passwordChecklist,
  safeAdminRedirect,
} from "@/components/admin/ops/auth-helpers";
import { auditEntityHref, auditEntityText } from "@/components/admin/lib/audit";
import { adminErrorSummary, adminFieldErrors } from "@/components/admin/lib/errors";
import { formatJod, formatJodDiscount, jodAmount } from "@/components/admin/lib/money";
import {
  actionHint,
  codeStatusText,
  fulfillmentButtons,
  isPaidLike,
  itemFieldRows,
  nextOrdering,
  orderHref,
  ordersQueryString,
  parseOrdersQuery,
  refundViaText,
  splitPaymentActions,
} from "@/components/admin/lib/orders";
import { permissionFlags, privilegedRoleWarning, roleDescription } from "@/components/admin/lib/roles";

describe("JOD formatting (OR-22)", () => {
  it("matches the backend format_jod", () => {
    expect(formatJod(8900)).toBe("JOD 8.90");
    expect(formatJod(8905)).toBe("JOD 8.905");
    expect(formatJod(0)).toBe("JOD 0.00");
    expect(formatJod(10000)).toBe("JOD 10.00");
    expect(formatJod(-1500)).toBe("JOD -1.50");
    expect(jodAmount(50)).toBe("0.05");
    expect(formatJod(null)).toBe("JOD 0.00");
  });
  it("never shows a negative zero discount", () => {
    expect(formatJodDiscount(0)).toBe("JOD 0.00");
    expect(formatJodDiscount(1500)).toBe("− JOD 1.50");
  });
});

describe("order actions mapping (D4, D7, D8, OR-26)", () => {
  const payment = [
    { status: "PAID", label: "Mark as paid", enabled: true, advanced: false, requires_reason: true },
    { status: "AUTHORIZED", label: "Mark approved", enabled: true, advanced: true },
    { status: "FAILED", label: "Mark failed", enabled: true, advanced: true },
  ];
  it("moves advanced payment transitions to the More menu", () => {
    const { primary, advanced } = splitPaymentActions(payment);
    expect(primary.map((a) => a.status)).toEqual(["PAID"]);
    expect(advanced.map((a) => a.status)).toEqual(["AUTHORIZED", "FAILED"]);
    expect(splitPaymentActions(undefined)).toEqual({ primary: [], advanced: [] });
  });
  it("keeps Completed and Cancel out of the generic delivery buttons", () => {
    const list = [
      { status: "PROCESSING", label: "Set status: Processing", enabled: true },
      { status: "COMPLETED", label: "Set status: Completed", enabled: false, disabled_reason: "1 of 2 item(s)…" },
      { status: "CANCELLED", label: "Cancel", enabled: true },
    ];
    expect(fulfillmentButtons(list).map((a) => a.status)).toEqual(["PROCESSING"]);
  });
  it("explains disabled actions", () => {
    expect(actionHint({ label: "x", enabled: false, disabled_reason: "Not paid" })).toBe("Not paid");
    expect(actionHint({ label: "x", enabled: false })).toMatch(/Not available/);
    expect(actionHint({ label: "x", enabled: true, disabled_reason: "ignored" })).toBe("");
  });
  it("treats partially refunded as paid", () => {
    expect(isPaidLike("PAID")).toBe(true);
    expect(isPaidLike("PARTIALLY_REFUNDED")).toBe(true);
    expect(isPaidLike("REFUNDED")).toBe(false);
    expect(isPaidLike("PENDING")).toBe(false);
  });
  it("words refunds by channel", () => {
    expect(refundViaText("paypal").button).toBe("Refund through PayPal");
    expect(refundViaText("manual").button).toBe("Record a manual refund");
  });
  it("labels retired codes and field details", () => {
    expect(codeStatusText({ status: "UNAVAILABLE" }, "REFUNDED")).toBe("Retired (refunded)");
    expect(codeStatusText({ status: "UNAVAILABLE", status_label: "Deactivated" }, "PAID")).toBe("Deactivated");
    expect(
      itemFieldRows({
        field_details: [{ key: "playerId", label_en: "Player ID", value: "5123" }],
        customer_fields: { playerId: "5123", zone_id: "77" },
      }),
    ).toEqual([
      { key: "playerId", label: "Player ID", value: "5123" },
      { key: "zone_id", label: "Zone id", value: "77" },
    ]);
  });
  it("links orders by number", () => {
    expect(orderHref({ id: 1, order_number: "A1B2" })).toBe("/admin/orders/A1B2");
    expect(orderHref({ id: 7 })).toBe("/admin/orders/7");
  });
});

describe("orders list URL state (OR-13)", () => {
  it("round-trips filters, search, sort and page", () => {
    const q = parseOrdersQuery(new URLSearchParams("needs_action=1&search=ali&ordering=-total_fils&page=3"));
    expect(q.view).toBe("needs_action");
    expect(q.search).toBe("ali");
    expect(q.ordering).toBe("-total_fils");
    expect(q.page).toBe(3);
    expect(ordersQueryString(q)).toBe("needs_action=1&search=ali&ordering=-total_fils&page=3");
  });
  it("drops defaults and unknown sort fields", () => {
    const q = parseOrdersQuery(new URLSearchParams("ordering=password&page=-2"));
    expect(q.ordering).toBe("");
    expect(q.page).toBe(1);
    expect(ordersQueryString({ ordering: "-created_at", page: 1 })).toBe("");
    expect(ordersQueryString({ view: "awaiting_payment_24h" })).toBe("awaiting_payment_24h=1");
  });
  it("cycles sorting", () => {
    expect(nextOrdering("", "total_fils")).toBe("-total_fils");
    expect(nextOrdering("-total_fils", "total_fils")).toBe("total_fils");
    expect(nextOrdering("total_fils", "total_fils")).toBe("-total_fils");
    expect(nextOrdering("", "created_at")).toBe("created_at");
  });
});

describe("safe admin redirect (RO-02)", () => {
  it("allows same-site admin paths", () => {
    expect(safeAdminRedirect("/admin/orders?needs_action=1")).toBe("/admin/orders?needs_action=1");
    expect(safeAdminRedirect("/admin")).toBe("/admin");
  });
  it("rejects everything else", () => {
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/admin\\..\\x",
      "/adminevil",
      "/admin.evil.com",
      "/orders",
      "/admin/login",
      "/admin/%2f%2fevil",
      "",
      null,
    ]) {
      expect(safeAdminRedirect(bad)).toBe("/admin");
    }
  });
});

describe("login messages (RO-03)", () => {
  it("maps auth.ts codes", () => {
    expect(loginErrorMessage({ error: "CredentialsSignin", code: "invalid_credentials" })).toBe(
      "Incorrect email or password.",
    );
    expect(loginErrorMessage({ error: "CredentialsSignin", code: "account_disabled" })).toMatch(/disabled/);
    expect(loginErrorMessage({ error: "CredentialsSignin", code: "throttled" })).toMatch(/Too many attempts/);
    expect(loginErrorMessage({ error: "CredentialsSignin", code: "not_staff" })).toMatch(/customer account/);
    expect(loginErrorMessage({ error: "CredentialsSignin", code: "credentials" })).toBe("Incorrect email or password.");
    expect(loginErrorMessage({ error: "Configuration" })).toMatch(/not available/);
  });
});

describe("password checklist (RO-13, D16)", () => {
  it("flags each rule", () => {
    const failed = (pw: string, email = "") =>
      passwordChecklist(pw, email)
        .filter((c) => !c.ok)
        .map((c) => c.key);
    expect(failed("short")).toContain("length");
    expect(failed("aaaaaaaaaaaab")).toContain("variety");
    expect(failed("123456789012")).toEqual(expect.arrayContaining(["numeric", "common"]));
    expect(failed("password1234")).toContain("common");
    expect(failed("janedoe-Store-9", "janedoe@x.com")).toContain("email");
    expect(passwordAcceptable("Calm-River-Lamp-42", "jane@x.com")).toBe(true);
  });
});

describe("phone validation (OR-16)", () => {
  it("mirrors the backend rules", () => {
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone("+962 79 123 4567")).toBe("+962791234567");
    expect(normalizePhone("00962791234567")).toBe("+962791234567");
    expect(normalizePhone("٠٧٩١٢٣٤٥٦٧")).toBe("0791234567");
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("+0123456789")).toBeNull();
  });
});

describe("errors without raw field prefixes (RO-13, OR-24)", () => {
  it("keeps a coupon `code` field error", () => {
    const err = new ApiError("API 400", 400, "validation", {
      detail: { code: ["A coupon with this code already exists"] },
      code: "validation_error",
    });
    expect(adminFieldErrors(err)).toEqual({ code: "A coupon with this code already exists." });
    expect(adminErrorSummary(err, "x", ["code"])).toBe("Please fix the highlighted fields.");
  });
  it("shows the message without the key", () => {
    const err = new ApiError("API 400", 400, "validation", { detail: { password: ["This password is too common."] } });
    expect(adminErrorSummary(err)).toBe("This password is too common.");
    const refund = new ApiError("API 400", 400, "validation", {
      detail: "The refund (JOD 9.00) is more than the amount that can still be refunded (JOD 5.00).",
      code: "refund_exceeds_remaining",
    });
    expect(adminErrorSummary(refund)).toMatch(/more than the amount/);
  });
});

describe("audit entities (OR-14, RO-17)", () => {
  it("links targets", () => {
    expect(auditEntityHref({ entity_type: "Order", entity_id: "5", order_number: "N1" })).toBe("/admin/orders/N1");
    expect(auditEntityHref({ entity_type: "DigitalCode", entity_id: "9", meta: { order_number: "N2" } })).toBe(
      "/admin/orders/N2",
    );
    expect(auditEntityHref({ entity_type: "Product", entity_id: "pubg-uc" })).toBe("/admin/products/pubg-uc");
    expect(auditEntityHref({ entity_type: "User", entity_id: "3", meta: { email: "a@b.c" } })).toBe(
      "/admin/administrators?search=a%40b.c",
    );
    expect(auditEntityHref({ entity_type: "FAQ", entity_id: "1" })).toBeNull();
    expect(auditEntityText({ entity_type: "Order", entity_id: "5", meta: { order_number: "N1" } })).toBe("Order N1");
    expect(auditEntityText({ entity_type: "ProductVariant", entity_id: "4" })).toBe("Product option #4");
  });
});

describe("roles (RO-05)", () => {
  it("describes roles and flags risky permissions", () => {
    expect(roleDescription("SUPPORT_AGENT")).toMatch(/resends delivery e-mails/);
    expect(privilegedRoleWarning("ADMIN")).toMatch(/refund money/);
    expect(privilegedRoleWarning("VIEWER")).toBe("");
    expect(permissionFlags("orders.write")).toEqual(["money"]);
    expect(permissionFlags("codes.reveal")).toEqual(["secret"]);
    expect(permissionFlags("orders.read")).toEqual([]);
  });
});
