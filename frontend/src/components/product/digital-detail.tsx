"use client";

import { QuickPayModal, type QuickBuyPayload } from "@/components/checkout/quick-pay-modal";
import { CompleteOrderBundle } from "@/components/product/complete-order-bundle";
import { ProductGallery } from "@/components/product/product-gallery";
import { ProductCover } from "@/components/product/product-artwork";
import { ProductRail } from "@/components/product/product-card";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { CustomerFieldInput } from "@/components/product/customer-field-input";
import { Price } from "@/components/ui/price";
import { QuantitySelector } from "@/components/ui/quantity-selector";
import { Rating } from "@/components/ui/rating";
import { StockBadge } from "@/components/ui/stock-badge";
import { getCategory } from "@/data/categories";
import { getAlsoBoughtProducts, getMayLikeProducts, getRelatedProducts } from "@/data/products";
import { useCart } from "@/context/cart-context";
import { useLanguage } from "@/context/language-context";
import { useToast } from "@/context/toast-context";
import { useUi } from "@/context/ui-context";
import { useWishlist } from "@/context/wishlist-context";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { getSnapshotCategories } from "@/lib/catalog-snapshot";
import { discountPercent } from "@/lib/format";
import { useCurrency } from "@/context/currency-context";
import { defaultSellableRegionId, denominationSellable, denominationsForRegion, matchDenominationId } from "@/lib/digital-options";
import { clampQuantity, lowStockCount, quantityLimits } from "@/lib/quantity";
import { STORAGE_KEYS } from "@/lib/storage";
import { customerFieldError, firstInvalidField, normalizeFieldValue } from "@/lib/validation";
import type { CartDigitalMeta, Product } from "@/types";
import { ArrowUp, Heart } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { FOCUS_RING, ICON_HIT } from "@/components/ui/control";
import { cn } from "@/lib/cn";

const EMPTY_RECENT_IDS: string[] = [];

type PanelTab = "options" | "details" | "reviews";

const CURRENCY_SIGN: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };

/** Short face value for a compact tile, e.g. "$10" or "600 UC"; "" when the option has none. */
function faceValueText(item: { value: number; currency: string }): string {
  if (!item.value || !Number.isFinite(item.value)) return "";
  const amount = Number.isInteger(item.value) ? String(item.value) : item.value.toFixed(2);
  const currency = (item.currency || "").toUpperCase();
  const sign = CURRENCY_SIGN[currency];
  return sign ? `${sign}${amount}` : currency ? `${amount} ${currency}` : amount;
}

export function DigitalProductDetail({ product }: { product: Product }) {
  const options = product.digitalOptions;
  const isTopup = product.fulfillmentType === "direct_topup";
  const multiRegion = options.regions.length > 1;
  const regionLocked = options.regions.some((item) => item.locked);
  const { t, locale } = useLanguage();
  const { format: formatPrice } = useCurrency();
  const { addItem } = useCart();
  const { push } = useToast();
  const { toggle, has } = useWishlist();
  const { setCartOpen } = useUi();
  const [recentIds, setRecentIds] = useLocalStorage<string[]>(STORAGE_KEYS.recentlyViewed, EMPTY_RECENT_IDS);
  const [payOpen, setPayOpen] = useState(false);
  const [pendingBuy, setPendingBuy] = useState<QuickBuyPayload | null>(null);

  const initialRegion = defaultSellableRegionId(product);
  const [regionId, setRegionId] = useState(initialRegion);
  const [denominationId, setDenominationId] = useState(
    () => denominationsForRegion(product, initialRegion).find(denominationSellable)?.id ?? "",
  );
  const [fields, setFields] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const fieldRefs = useRef<Record<string, HTMLInputElement | HTMLSelectElement | null>>({});
  const [qtyWanted, setQty] = useState(1);
  const [qtyNotice, setQtyNotice] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>("options");
  const wished = has(product.id);

  useEffect(() => {
    setRecentIds((current) => {
      const next = [product.id, ...current.filter((id) => id !== product.id)].slice(0, 12);
      if (next.length === current.length && next.every((id, index) => id === current[index])) return current;
      return next;
    });
  }, [product.id, setRecentIds]);

  const similar = useMemo(() => getRelatedProducts(product, 8), [product]);
  const alsoBought = useMemo(() => getAlsoBoughtProducts(product, 6), [product]);
  const mayLike = useMemo(() => getMayLikeProducts(product, recentIds, 8), [product, recentIds]);
  const category =
    getSnapshotCategories().find((item) => item.slug === product.category) ?? getCategory(product.category);
  const categoryHref = category?.href ?? (isTopup ? "/game-top-ups" : "/gift-cards");
  const categoryLabel = category ? (locale === "ar" ? category.nameAr : category.name) : t(isTopup ? "nav.topups" : "nav.gifts");

  const visibleDenoms = useMemo(() => denominationsForRegion(product, regionId), [product, regionId]);
  const hasAmountChoices = visibleDenoms.length > 1;
  const hasConfigurableOptions = multiRegion || hasAmountChoices || options.requiredCustomerFields.length > 0;
  const denomination = options.denominations.find((item) => item.id === denominationId);
  const region = options.regions.find((item) => item.id === regionId);
  const limits = quantityLimits(denomination?.minQuantity, denomination?.maxQuantity, denomination?.availableQuantity);
  const left = lowStockCount(denomination?.availableQuantity);
  const sale = discountPercent(denomination?.priceJod ?? product.priceJod, denomination?.compareAtPriceJod);
  const fieldErrors = Object.fromEntries(
    options.requiredCustomerFields.map((field) => [field.id, customerFieldError(field, fields[field.id] ?? "")]),
  );
  const fieldsOk = Object.values(fieldErrors).every((error) => error === null);
  const productInStock = product.inStock && options.denominations.some(denominationSellable);
  const stockOk = product.inStock && denominationSellable(denomination);
  // Sold out: the whole product, or the option the customer picked (available_quantity 0 / stock_status).
  const soldOut = !productInStock || (Boolean(denomination) && !stockOk);
  const qty = soldOut ? 0 : clampQuantity(qtyWanted, limits);
  const ready = Boolean(regionId && denomination && fieldsOk && stockOk);

  const unitPrice = denomination?.priceJod ?? product.priceJod;
  const price = Math.round(unitPrice * 1000 * Math.max(qty, 1)) / 1000;
  const platformName = locale === "ar" ? options.platformLabelAr : options.platformLabel;
  const showBrand = product.brand.trim().toLowerCase() !== platformName.trim().toLowerCase();
  const productName = locale === "ar" ? product.nameAr : product.name;
  const denomLabel = denomination ? (locale === "ar" ? denomination.labelAr : denomination.label) : null;
  const regionName = region ? (locale === "ar" ? region.nameAr : region.name) : "";
  const regionCurrency = region?.currency || denomination?.currency || options.accountCurrency || "";
  // ST-19: top-ups go to the game account — no "region · currency card" wording.
  const regionLine = isTopup
    ? ""
    : regionName
    ? regionCurrency
      ? t("product.regionCurrency", { region: regionName, currency: regionCurrency })
      : regionName
    : "";
  const reviewsVisible = product.reviewCount > 0;
  const activeTab: PanelTab =
    !hasConfigurableOptions && panelTab === "options" ? "details" : !reviewsVisible && panelTab === "reviews" ? "details" : panelTab;

  const nextStep = !productInStock
    ? t("product.outOfStock")
    : !regionId
      ? t("product.needRegion")
      : !denomination
        ? t("product.needVariant")
        : !stockOk
          ? t("product.stockOut")
          : !fieldsOk
            ? t("product.needAccount")
            : null;

  const selectRegion = (id: string) => {
    setRegionId(id);
    setDenominationId(matchDenominationId(product, id, denominationId));
  };

  const buildDigital = (): CartDigitalMeta | null => {
    if (!region || !denomination) return null;
    return {
      regionId: region.id,
      regionName,
      denominationId: denomination.id,
      denominationLabel: denomLabel ?? "",
      deliveryMethod: "account",
      platform: platformName,
      customerFields: Object.fromEntries(
        options.requiredCustomerFields
          .map((field) => [field.id, normalizeFieldValue(fields[field.id])] as const)
          .filter(([, value]) => value),
      ),
    };
  };

  const guard = () => {
    setAttempted(true);
    if (!ready) {
      if (!fieldsOk) {
        // ST-09: show the options tab, bring the first invalid field into view and say what is missing.
        setPanelTab("options");
        const invalid = firstInvalidField(options.requiredCustomerFields, fields);
        if (invalid) {
          const label = locale === "ar" ? invalid.labelAr || invalid.label : invalid.label;
          push({ title: t("product.fixField", { field: label }), tone: "error" });
          window.setTimeout(() => {
            const element = fieldRefs.current[invalid.id];
            element?.scrollIntoView({ behavior: "smooth", block: "center" });
            element?.focus({ preventScroll: true });
          }, 60);
        }
      } else if (nextStep) {
        push({ title: nextStep, tone: "error" });
      }
      return null;
    }
    return buildDigital();
  };

  const addToCart = () => {
    const digital = guard();
    if (!digital) return;
    const result = addItem({ productId: product.id, quantity: qty, digital });
    if (result.capped) push({ title: t("product.qtyCapped", { max: result.max }), tone: "info" });
    setCartOpen(true);
  };

  const startBuyNow = () => {
    const digital = guard();
    if (!digital || !denomination) return;
    setPendingBuy({ product, quantity: qty, digital, denomination });
    setPayOpen(true);
  };

  const changeQty = (value: number) => {
    setQtyNotice(value < limits.min ? t("product.qtyMin", { min: limits.min }) : "");
    setQty(value);
  };

  const tabs: Array<{ id: PanelTab; label: string }> = [
    ...(hasConfigurableOptions ? [{ id: "options" as const, label: t("product.tabOptions") }] : []),
    { id: "details", label: t("product.tabDetails") },
    ...(reviewsVisible ? [{ id: "reviews" as const, label: t("product.reviews") }] : []),
  ];

  const description = locale === "ar" ? product.descriptionAr || product.description : product.description;
  const instructions = locale === "ar" ? options.instructionsAr || options.instructions : options.instructions;
  const howToUse = (locale === "ar" && options.howToUseAr.length ? options.howToUseAr : options.howToUse).filter(Boolean);
  const regionText = locale === "ar" ? options.regionRestrictionsAr || options.regionRestrictions : options.regionRestrictions;
  const refundText = locale === "ar" ? options.refundPolicyTextAr || options.refundPolicyText : options.refundPolicyText;
  const deliveryText = locale === "ar" ? options.deliveryEstimateAr : options.deliveryEstimate;

  const buyFooter = (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted">{t("product.qty")}</span>
        <QuantitySelector
          value={qty}
          onChange={changeQty}
          min={limits.min}
          max={limits.max}
          disabled={soldOut}
          onLimit={(max) => setQtyNotice(t("product.qtyMax", { max }))}
        />
        <button
          type="button"
          className={cn(ICON_HIT, "ms-auto border border-line", wished && "text-gold")}
          onClick={() => toggle(product.id)}
          aria-label={t("common.wishlist")}
        >
          <Heart className={cn("h-4 w-4", wished && "fill-gold")} />
        </button>
      </div>
      {qtyNotice && !soldOut ? <p className="text-xs text-amber">{qtyNotice}</p> : null}
      {left && stockOk ? <p className="text-xs font-medium text-amber">{t("stock.onlyNLeft", { count: left })}</p> : null}

      <div className="mmh-neon-frame flex items-center justify-between gap-3 rounded-xl border border-transparent bg-brand-deep px-4 py-3.5 text-white">
        <span className="min-w-0">
          <span className="block text-sm font-medium text-white/75">{t("product.optionPrice")}</span>
          {regionLine ? <span className="block truncate text-xs text-white/60">{regionLine}</span> : null}
        </span>
        <Price
          amount={price}
          compareAt={denomination?.compareAtPriceJod ? denomination.compareAtPriceJod * Math.max(qty, 1) : undefined}
          locale={locale}
          size="lg"
          className="[&>span:first-child]:text-gold [&>span:last-child]:text-white/50"
        />
      </div>

      {nextStep ? (
        <p id="product-buy-hint" className={cn("text-xs", attempted || soldOut ? "text-danger" : "text-muted")}>
          {nextStep}
        </p>
      ) : (
        <p className="text-xs text-success">{t(isTopup ? "product.topupNotice" : "product.digitalNotice")}</p>
      )}

      <div className="flex gap-2">
        <Button
          className="mmh-neon-btn min-h-12 flex-1"
          disabled={!stockOk}
          aria-describedby={nextStep ? "product-buy-hint" : undefined}
          onClick={addToCart}
        >
          {soldOut ? t("product.outOfStock") : t("product.add")}
        </Button>
        <Button className="mmh-neon-btn min-h-12 flex-1" variant="outline" disabled={!stockOk} aria-disabled={!stockOk} onClick={startBuyNow}>
          {t("product.buyNow")}
        </Button>
      </div>
      <p className="text-xs leading-5 text-muted">{t(isTopup ? "delivery.topupWhere" : "delivery.where")}</p>
    </>
  );

  return (
    <div className="container-mmh pb-32 pt-5 sm:pt-7 xl:pb-36">
      <Breadcrumbs
        items={[
          { href: "/", label: t("common.home") },
          { href: categoryHref, label: categoryLabel },
          { label: productName },
        ]}
      />

      <div className="mt-5 grid items-start gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-10 xl:gap-12">
        <div className="lg:sticky lg:top-24">
          <ProductGallery product={product} />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge badge={isTopup ? "topup" : "digital"} label={isTopup ? t("common.topup") : t("product.fulfillmentCode")} />
            {regionLocked ? <Badge badge="region_locked" label={t("common.regionLocked")} /> : null}
            {sale ? <Badge badge="sale" label={`-${sale}%`} /> : null}
            {product.badges
              .filter((badge) => badge === "new" || badge === "bestseller" || badge === "limited")
              .map((badge) => (
                <Badge key={badge} badge={badge} label={t(`common.${badge}`)} />
              ))}
          </div>

          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted">
            {showBrand ? `${platformName} · ${product.brand}` : platformName}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{productName}</h1>

          {reviewsVisible ? (
            <div className="mt-3">
              <Rating value={product.rating} count={product.reviewCount} reviewsLabel={t("common.reviews")} />
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <StockBadge
              inStock={denomination ? stockOk : productInStock}
              inLabel={t("product.available")}
              lowLabel={t("common.lowStock")}
              outLabel={t("product.outOfStock")}
            />
            {regionLine ? <span className="text-sm font-medium text-fg">{regionLine}</span> : null}
            <span className="text-sm text-muted">
              {t("product.categoryLabel")}:{" "}
              <Link href={categoryHref} className="font-semibold text-gold hover:text-fg">
                {categoryLabel}
              </Link>
            </span>
          </div>

          <p className="mt-3 text-sm text-muted">{deliveryText}</p>

          {!hasConfigurableOptions ? (
            <div className="mmh-neon-frame mt-6 space-y-5 rounded-2xl border border-line bg-card p-4 sm:p-5">
              <div>
                {soldOut ? (
                  <>
                    <p className="text-sm font-semibold text-danger">{t("product.outOfStock")}</p>
                    <p className="mt-1 text-sm text-muted">{t("product.soldOutBody")}</p>
                  </>
                ) : (
                  <p className="text-sm font-medium text-fg">{t("product.simpleBuy")}</p>
                )}
                {denomLabel ? (
                  <p className="mt-2 text-sm text-muted">
                    {t("product.fixedAmount")}: <span className="font-semibold text-fg">{denomLabel}</span>
                    {regionLine ? ` · ${regionLine}` : ""}
                  </p>
                ) : null}
              </div>
              {buyFooter}
            </div>
          ) : null}

          <div className="mmh-neon-frame mt-6 overflow-hidden rounded-2xl border border-line bg-card">
            <div className="flex gap-1 border-b border-line bg-elevated/70 p-1.5">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPanelTab(tab.id)}
                  className={cn(
                    "min-h-10 flex-1 rounded-xl px-3 text-sm font-semibold transition-colors",
                    activeTab === tab.id ? "bg-brand-deep text-white shadow-sm" : "text-muted hover:bg-card hover:text-fg",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="p-4 sm:p-5">
              {activeTab === "options" && hasConfigurableOptions ? (
                <div className="space-y-5">
                  {multiRegion ? (
                    <div>
                      <p className="mb-2.5 text-sm font-medium">{t("product.stepRegion")}</p>
                      <div className="flex flex-wrap gap-2">
                        {options.regions.map((item) => {
                          const selected = regionId === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              aria-pressed={selected}
                              onClick={() => selectRegion(item.id)}
                              className={cn("mmh-chip inline-flex h-9 items-center gap-1.5 px-3 text-[13px] font-semibold text-fg", FOCUS_RING)}
                            >
                              {locale === "ar" ? item.nameAr : item.name}
                              {item.currency ? <span className="text-[11px] font-medium text-muted">{item.currency}</span> : null}
                            </button>
                          );
                        })}
                      </div>
                      {regionLocked ? <p className="mt-2 text-xs leading-5 text-muted">{t("product.lockedHint")}</p> : null}
                    </div>
                  ) : null}

                  {hasAmountChoices ? (
                    <div>
                      <p className="mb-2.5 text-sm font-medium">{isTopup ? t("product.package") : t("product.stepAmount")}</p>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {visibleDenoms.map((item) => {
                          const selected = denominationId === item.id;
                          const out = !denominationSellable(item);
                          const label = locale === "ar" ? item.labelAr : item.label;
                          const face = faceValueText(item);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              disabled={out}
                              aria-pressed={selected}
                              aria-label={`${label} — ${out ? t("product.outOfStock") : formatPrice(item.priceJod)}`}
                              title={label}
                              onClick={() => setDenominationId(item.id)}
                              className={cn("mmh-chip flex min-h-[3.6rem] flex-col items-center justify-center px-2 py-2 text-center", FOCUS_RING)}
                            >
                              <span className={cn("text-[15px] font-bold leading-tight tabular-nums text-fg", !face && "line-clamp-2 text-[12px] font-semibold")} dir="ltr">
                                {face || label}
                              </span>
                              <span className={cn("mt-0.5 text-[11px] leading-tight", out ? "text-danger" : selected ? "text-gold" : "text-muted")}>
                                {out ? t("product.outOfStock") : formatPrice(item.priceJod)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {attempted && !denomination ? <p className="mt-2 text-xs text-danger">{t("product.needVariant")}</p> : null}
                    </div>
                  ) : denomLabel ? (
                    <p className="rounded-xl border border-line bg-elevated px-3 py-3 text-sm text-muted">
                      {t("product.fixedAmount")}: <span className="font-semibold text-fg">{denomLabel}</span>
                    </p>
                  ) : null}

                  {options.requiredCustomerFields.map((field) => (
                    <CustomerFieldInput
                      key={field.id}
                      field={field}
                      value={fields[field.id] ?? ""}
                      showError={Boolean(fieldErrors[field.id]) && (attempted || Boolean(touched[field.id]))}
                      inputRef={(element) => {
                        fieldRefs.current[field.id] = element;
                      }}
                      onBlur={() => setTouched((current) => ({ ...current, [field.id]: true }))}
                      onChange={(value) => setFields((current) => ({ ...current, [field.id]: value }))}
                    />
                  ))}

                  {buyFooter}
                </div>
              ) : null}

              {activeTab === "details" ? (
                <div className="space-y-5 text-sm leading-7 text-muted">
                  {description ? (
                    <div>
                      <h2 className="text-base font-semibold text-fg">{t("product.description")}</h2>
                      <p className="mt-2 whitespace-pre-line">{description}</p>
                    </div>
                  ) : null}
                  {instructions ? (
                    <div>
                      <h2 className="text-base font-semibold text-fg">{t("product.instructions")}</h2>
                      <p className="mt-2 whitespace-pre-line">{instructions}</p>
                    </div>
                  ) : null}
                  {howToUse.length ? (
                    <div>
                      <h2 className="text-base font-semibold text-fg">{t("product.howToUseHeading")}</h2>
                      <ol className="mt-2 list-decimal space-y-2 ps-5">
                        {howToUse.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                    </div>
                  ) : null}
                  {regionText ? (
                    <div>
                      <h2 className="text-base font-semibold text-fg">{t("product.regionCompat")}</h2>
                      <p className="mt-2">{regionText}</p>
                    </div>
                  ) : null}
                  <div>
                    <h2 className="text-base font-semibold text-fg">{t("product.deliveryInfo")}</h2>
                    <p className="mt-2">{deliveryText}</p>
                    <p className="mt-1">{t(isTopup ? "delivery.topupWhere" : "delivery.where")}</p>
                  </div>
                  {refundText ? (
                    <div>
                      <h2 className="text-base font-semibold text-fg">{t("product.refundPolicy")}</h2>
                      <p className="mt-2">{refundText}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {activeTab === "reviews" && reviewsVisible ? (
                <div>
                  <Rating value={product.rating} count={product.reviewCount} reviewsLabel={t("common.reviews")} />
                </div>
              ) : null}
            </div>
          </div>

          <CompleteOrderBundle
            product={product}
            suggestions={alsoBought.length ? alsoBought : similar}
            mainDigital={ready ? buildDigital() : null}
            mainQuantity={qty}
          />
        </div>
      </div>

      {similar.length ? (
        <section className="mt-12 sm:mt-14">
          <h2 className="mb-5 text-xl font-bold tracking-tight">{t("product.similar")}</h2>
          <ProductRail products={similar} />
        </section>
      ) : null}

      {mayLike.length ? (
        <section className="mt-12 sm:mt-14">
          <h2 className="mb-5 text-xl font-bold tracking-tight">{t("product.mayLike")}</h2>
          <ProductRail products={mayLike} />
        </section>
      ) : null}

      <div className="mt-10 flex justify-center">
        <button
          type="button"
          className="inline-flex items-center gap-2 text-sm font-semibold text-gold hover:text-fg"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <ArrowUp className="h-4 w-4" />
          {t("product.backToTop")}
        </button>
      </div>

      <div className="mmh-neon-bar fixed inset-x-0 bottom-0 z-[35] border-t border-line bg-card/97 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(23,24,43,0.12)] backdrop-blur-md">
        <div className="container-mmh flex items-center gap-3">
          <div className="hidden h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-line bg-[#17182b] sm:block">
            <ProductCover product={product} shot="cover" compact label={productName} className="aspect-square h-full w-full p-0 [&_img]:p-1" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{productName}</p>
            <Price amount={price} locale={locale} className="mt-0.5 [&>span:first-child]:text-sm [&>span:first-child]:text-gold" />
          </div>
          <div className="hidden md:block">
            <QuantitySelector
              value={qty}
              onChange={changeQty}
              min={limits.min}
              max={limits.max}
              disabled={soldOut}
              onLimit={(max) => setQtyNotice(t("product.qtyMax", { max }))}
            />
          </div>
          <Button className="mmh-neon-btn min-h-11 min-w-0 flex-1 px-3 text-sm sm:flex-none sm:min-w-[8.5rem]" disabled={!stockOk} onClick={addToCart}>
            {soldOut ? t("product.outOfStock") : t("product.add")}
          </Button>
          <Button className="mmh-neon-btn-alt min-h-11 min-w-0 flex-1 px-3 text-sm sm:flex-none sm:min-w-[8.5rem]" variant="secondary" disabled={!stockOk} aria-disabled={!stockOk} onClick={startBuyNow}>
            {t("product.buyNow")}
          </Button>
        </div>
      </div>

      <QuickPayModal
        open={payOpen}
        payload={pendingBuy}
        onClose={() => {
          setPayOpen(false);
          setPendingBuy(null);
        }}
      />
    </div>
  );
}
