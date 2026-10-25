import { describe, expect, it } from "vitest";
import { importBatchStatus, previewRowStatus } from "@/components/admin/lib/code-import";
import {
  flattenGroups,
  groupSearchResults,
  matchesQuery,
  moveHighlight,
  shortcutLabel,
  shouldSearchRemote,
  type SearchResult,
} from "@/components/admin/lib/command-search";
import {
  hasActiveFilters,
  nextOrdering,
  parseListState,
  patchListState,
  serializeListState,
  sortDirection,
} from "@/components/admin/lib/list-state";
import { remainingAfterDelete, resolveAdminMediaUrl } from "@/components/admin/lib/media-url";
import {
  claimsInstantDelivery,
  draftSignature,
  fieldDraftToPayload,
  generalFormToPayload,
  generalServerErrors,
  isDraftDirty,
  kindFulfillmentIssue,
  nestedListErrors,
  newFieldDraft,
  numberFromName,
  patchFieldLabel,
  productToDraft,
  publishWarnings,
  reconcileKindFulfillment,
  toggleBadge,
  validateField,
  variantDraftToPayload,
  newVariantDraft,
} from "@/components/admin/lib/product-form";
import { normalizeWhatsapp, validateSettingsForm } from "@/components/admin/lib/settings-form";
import { autoSlug, fieldKeyFromLabel, isValidSlug, slugify } from "@/components/admin/lib/slugify";
import type { AdminMediaAsset, AdminProduct } from "@/lib/api/admin";

describe("slugify", () => {
  it("makes lowercase dash slugs", () => {
    expect(slugify("PlayStation Plus — 12 Months!")).toBe("playstation-plus-12-months");
    expect(slugify("  Café  Crème ")).toBe("cafe-creme");
    expect(slugify("بلاي ستيشن")).toBe("");
    expect(isValidSlug("steam-card-10")).toBe(true);
    expect(isValidSlug("Bad Slug")).toBe(false);
  });

  it("follows the name until edited", () => {
    expect(autoSlug("Steam Card", "", false)).toBe("steam-card");
    expect(autoSlug("Steam Card", "my-own", true)).toBe("my-own");
  });

  it("derives field keys like the backend", () => {
    expect(fieldKeyFromLabel("Player ID")).toBe("player_id");
    expect(fieldKeyFromLabel("2nd server")).toBe("f_2nd_server");
    expect(fieldKeyFromLabel("معرف")).toBe("");
  });
});

describe("list URL state", () => {
  const defaults = { search: "", status: "", ordering: "", page: "1" };

  it("parses and serializes, dropping defaults and keeping other keys", () => {
    const params = new URLSearchParams("search=psn&page=3&foo=bar");
    const state = parseListState(params, defaults);
    expect(state).toEqual({ search: "psn", status: "", ordering: "", page: "3" });
    expect(serializeListState({ ...state, page: "1" }, defaults, params)).toBe("?search=psn&foo=bar");
    expect(parseListState(new URLSearchParams("page=-2"), defaults).page).toBe("1");
  });

  it("resets the page when a filter changes", () => {
    const s = { ...defaults, page: "4" };
    expect(patchListState(s, { status: "DRAFT" }, defaults).page).toBe("1");
    expect(patchListState(s, { page: "5" }, defaults).page).toBe("5");
    expect(hasActiveFilters({ ...defaults, page: "2", ordering: "x" }, defaults)).toBe(false);
    expect(hasActiveFilters({ ...defaults, search: "a" }, defaults)).toBe(true);
  });

  it("cycles sort directions", () => {
    expect(sortDirection("-created_at", "created_at")).toBe("desc");
    expect(nextOrdering("", "name_en")).toBe("name_en");
    expect(nextOrdering("name_en", "name_en")).toBe("-name_en");
    expect(nextOrdering("-name_en", "name_en", { fallback: "" })).toBe("");
    expect(nextOrdering("", "updated_at", { firstDirection: "desc" })).toBe("-updated_at");
    expect(nextOrdering("updated_at", "updated_at", { firstDirection: "desc", fallback: "updated_at" })).toBe("-updated_at");
  });
});

describe("command search", () => {
  const r = (group: SearchResult["group"], id: string, href = `/${id}`): SearchResult => ({ id, group, label: id, href });

  it("groups in a fixed order without duplicates", () => {
    const groups = groupSearchResults([r("orders", "o1"), r("pages", "p1"), r("products", "x"), r("products", "x2", "/x")]);
    expect(groups.map((g) => g.id)).toEqual(["pages", "products", "orders"]);
    expect(flattenGroups(groups).map((i) => i.id)).toEqual(["p1", "x", "o1"]);
  });

  it("moves the highlight with wrap-around", () => {
    expect(moveHighlight(-1, 1, 3)).toBe(0);
    expect(moveHighlight(2, 1, 3)).toBe(0);
    expect(moveHighlight(0, -1, 3)).toBe(2);
    expect(moveHighlight(0, 1, 0)).toBe(-1);
  });

  it("matches words and picks the right shortcut", () => {
    expect(matchesQuery("Import codes", "cod imp")).toBe(true);
    expect(matchesQuery("Orders", "zzz")).toBe(false);
    expect(shortcutLabel("Win32")).toBe("Ctrl K");
    expect(shortcutLabel("MacIntel")).toBe("⌘K");
    expect(shouldSearchRemote("a")).toBe(false);
    expect(shouldSearchRemote("ab")).toBe(true);
  });
});

describe("admin media URLs", () => {
  it("keeps store assets on the store origin and uploads on the API", () => {
    const api = "https://api.example.com/api/v1";
    expect(resolveAdminMediaUrl("/home/hero.webp", api)).toBe("/home/hero.webp");
    expect(resolveAdminMediaUrl("/media/products/a.png", api)).toBe("https://api.example.com/media/products/a.png");
    expect(resolveAdminMediaUrl("https://cdn.x/a.png", api)).toBe("https://cdn.x/a.png");
    expect(resolveAdminMediaUrl("", api)).toBe("");
  });

  it("promotes the next photo after deleting the main one", () => {
    const media = [
      { id: 1, key: "a", url: "a", is_primary: true, sort_order: 0 },
      { id: 2, key: "b", url: "b", is_primary: false, sort_order: 2 },
      { id: 3, key: "c", url: "c", is_primary: false, sort_order: 1 },
    ] as AdminMediaAsset[];
    const rest = remainingAfterDelete(media, media[0]);
    expect(rest.find((m) => m.is_primary)?.id).toBe(3);
    expect(remainingAfterDelete(media, media[1]).find((m) => m.is_primary)?.id).toBe(1);
  });
});

describe("product editor helpers", () => {
  const product = {
    id: "p1",
    slug: "steam-card",
    kind: "GIFT_CARD",
    fulfillment_type: "CODE",
    brand: "Steam",
    status: "DRAFT",
    name_en: "Steam",
    image_url: "/media/a.png",
    category_id: 3,
    platform_id: 4,
    badges: ["new", "hot"],
    variants: [{ id: 9, sku: "S-10", price_fils: 7000, name_en: "$10", published: true, effective_stock_status: "OUT_OF_STOCK" }],
    fields: [],
  } as unknown as AdminProduct;

  it("detects changes and discards back to the snapshot", () => {
    const initial = productToDraft(product);
    const edited = { ...initial, general: { ...initial.general, name_en: "Steam Wallet" } };
    expect(isDraftDirty(initial, initial)).toBe(false);
    expect(isDraftDirty(initial, edited)).toBe(true);
    expect(draftSignature(productToDraft(product))).toBe(draftSignature(initial));
  });

  it("does not resend an unchanged image URL (D25)", () => {
    const form = productToDraft(product).general;
    expect("image_url" in generalFormToPayload(form, form)).toBe(false);
    expect(generalFormToPayload({ ...form, image_url: "https://x/y.png" }, form).image_url).toBe("https://x/y.png");
  });

  it("keeps kind and delivery type consistent (CA-19)", () => {
    expect(reconcileKindFulfillment({ kind: "GIFT_CARD", fulfillment_type: "CODE" }, { fulfillment_type: "DIRECT_TOPUP" })).toEqual({
      kind: "DIRECT_TOPUP",
      fulfillment_type: "DIRECT_TOPUP",
    });
    expect(reconcileKindFulfillment({ kind: "DIRECT_TOPUP", fulfillment_type: "DIRECT_TOPUP" }, { kind: "WALLET" })).toEqual({
      kind: "WALLET",
      fulfillment_type: "CODE",
    });
    expect(kindFulfillmentIssue("GIFT_CARD", "DIRECT_TOPUP")).toBeTruthy();
    expect(kindFulfillmentIssue("GAME_CURRENCY", "DIRECT_TOPUP")).toBeNull();
  });

  it("toggles supported badges and flags instant delivery", () => {
    expect(toggleBadge(["hot"], "sale", true)).toEqual(["sale", "hot"]);
    expect(toggleBadge(["new", "sale"], "new", false)).toEqual(["sale"]);
    expect(claimsInstantDelivery("Instant delivery")).toBe(true);
    expect(claimsInstantDelivery("تسليم فوري")).toBe(true);
    expect(claimsInstantDelivery("Within 10 minutes")).toBe(false);
  });

  it("warns before publishing something nobody can buy (CA-20)", () => {
    const d = productToDraft(product);
    expect(publishWarnings(d)).toEqual([]);
    const published = { ...d, general: { ...d.general, status: "PUBLISHED" } };
    expect(publishWarnings(published)).toEqual(["no_stock"]);
    const hidden = { ...published, variants: published.variants.map((v) => ({ ...v, published: false })) };
    expect(publishWarnings(hidden, { categoryStatus: "DRAFT" })).toEqual(["no_published_variants", "category_hidden"]);
  });

  it("sends optional variant fields blank for the server to derive", () => {
    const v = { ...newVariantDraft({ index: 0 }), name_en: "$25", price: "18" };
    expect(numberFromName("1,000 V-Bucks")).toBe("1000");
    expect(variantDraftToPayload(v, 0)).toMatchObject({ sku: "", denomination: null, package_value: "", published: true, price_fils: 18000 });
  });

  it("validates customer fields in plain words (D17)", () => {
    const f = { ...newFieldDraft(0), ...patchFieldLabel(newFieldDraft(0), "Player ID") };
    expect(f.key).toBe("player_id");
    expect(validateField(f, [f])).toEqual({});
    const bad = { ...f, min_length: "9", max_length: "6" };
    expect(validateField(bad, [bad]).max_length).toBeTruthy();
    const select = { ...f, type: "SELECT", options: [] };
    expect(validateField(select, [select]).options).toBeTruthy();
    const dup = { ...f, key_local: "other" };
    expect(validateField(f, [f, dup]).key).toBeTruthy();
    expect(fieldDraftToPayload({ ...f, min_length: "6", max_length: "" }, 0)).toMatchObject({
      key: "player_id",
      input_format: "numeric",
      min_length: 6,
      max_length: null,
      options: [],
    });
  });

  it("maps server validation errors to tabs and rows", () => {
    const body = { detail: { id: ["A product with this ID already exists"], category: ["Invalid"], variants: [{}, { sku: ["SKU already exists"] }] }, code: "validation_error" };
    expect(generalServerErrors(body)).toEqual({ id: "A product with this ID already exists", category_id: "Invalid" });
    expect(nestedListErrors(body, "variants").rows).toEqual({ 1: { sku: "SKU already exists" } });
    expect(nestedListErrors({ detail: { variants: "SKU already exists" } }, "variants").message).toBe("SKU already exists");
  });
});

describe("code imports", () => {
  it("labels abandoned previews honestly (CA-23)", () => {
    expect(importBatchStatus({ status: "VALIDATED", imported_rows: 0, valid_rows: 3, completed_at: null }).label).toBe(
      "Not imported (preview only)",
    );
    expect(importBatchStatus({ status: "COMPLETED", imported_rows: 3, valid_rows: 3, completed_at: "x" }).label).toBe("Imported");
    expect(previewRowStatus({ status: "ready" }).label).toBe("Ready");
    expect(previewRowStatus({ status: "duplicate" }).tone).toBe("warning");
  });
});

describe("settings form", () => {
  it("normalizes WhatsApp numbers like the backend", () => {
    expect(normalizeWhatsapp("+962 79 123 4567")).toBe("962791234567");
    expect(normalizeWhatsapp("00962791234567")).toBe("962791234567");
    expect(normalizeWhatsapp("٩٦٢٧٩١٢٣٤٥٦٧")).toBe("962791234567");
    expect(normalizeWhatsapp("call me")).toBeNull();
    expect(normalizeWhatsapp("")).toBe("");
  });

  it("returns inline errors", () => {
    const errors = validateSettingsForm({ store_name: "", whatsapp_number: "abc", instagram_url: "instagram.com/x", low_stock_threshold: "-1" });
    expect(Object.keys(errors).sort()).toEqual(["instagram_url", "low_stock_threshold", "store_name", "whatsapp_number"]);
  });
});
