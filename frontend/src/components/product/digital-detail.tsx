"use client";

import { LoginModal } from "@/components/auth/login-modal";
import { QuickPayModal, type QuickBuyPayload } from "@/components/checkout/quick-pay-modal";
import { CompleteOrderBundle } from "@/components/product/complete-order-bundle";
import { ProductGallery } from "@/components/product/product-gallery";
import { ProductCover } from "@/components/product/product-artwork";
import { ProductRail } from "@/components/product/product-card";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Price } from "@/components/ui/price";
import { QuantitySelector } from "@/components/ui/quantity-selector";
import { Rating } from "@/components/ui/rating";
import { StockBadge } from "@/components/ui/stock-badge";
import { getCategory } from "@/data/categories";
import { getAlsoBoughtProducts, getMayLikeProducts, getRelatedProducts } from "@/data/products";
import { useCart } from "@/context/cart-context";
import { useLanguage } from "@/context/language-context";
import { useUi } from "@/context/ui-context";
import { useWishlist } from "@/context/wishlist-context";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { discountPercent, formatJod } from "@/lib/format";
import { defaultRegionId, denominationsForRegion, isGiftCardProduct, matchDenominationId } from "@/lib/digital-options";
import { STORAGE_KEYS } from "@/lib/storage";
import { isValidEmail, isValidDemoPhone, validateCustomerField } from "@/lib/validation";
import type { DeliveryMethod, GiftIntent, Product } from "@/types";
import { ArrowUp, Heart } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import { choiceClass, FOCUS_RING, ICON_HIT } from "@/components/ui/control";
import { cn } from "@/lib/cn";

const EMPTY_RECENT_IDS: string[] = [];

function deliveryLabel(method: DeliveryMethod, t: (key: string) => string) {
  if (method === "email") return t("common.emailDelivery");
  if (method === "sms") return t("common.smsDelivery");
  if (method === "account") return t("common.accountDelivery");
  return t("common.instant");
}

function preferredCatalogImage(product: Product) {
  const webp = product.images.find((src) => /\.webp($|\?)/i.test(src));
  if (webp) return webp;
  const fromProduct = product.images.find((src) => /\.(svg|png|jpe?g|avif)($|\?)/i.test(src));
  if (fromProduct) return fromProduct;
  return `/catalog/${product.id}.webp`;
}

type PanelTab = "options" | "details" | "reviews";

export function DigitalProductDetail({ product }: { product: Product }) {
  const options = product.digitalOptions;
  const isTopup = product.fulfillmentType === "direct_topup";
  const isGift = isGiftCardProduct(product);
  const multiRegion = options.regions.length > 1;
  const regionLocked = options.regions.some((item) => item.locked);
  const { t, locale } = useLanguage();
  const { addItem } = useCart();
  const { toggle, has } = useWishlist();
  const { setCartOpen } = useUi();
  const { data: session, status } = useSession();
  const [recentIds, setRecentIds] = useLocalStorage<string[]>(STORAGE_KEYS.recentlyViewed, EMPTY_RECENT_IDS);
  const [loginOpen, setLoginOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [pendingBuy, setPendingBuy] = useState<QuickBuyPayload | null>(null);

  const initialRegion = defaultRegionId(options.regions);
  const [regionId, setRegionId] = useState(initialRegion);
  const [denominationId, setDenominationId] = useState(
    () => denominationsForRegion(product, initialRegion).find((item) => item.inStock !== false)?.id ?? "",
  );
  const [recipientPhone, setRecipientPhone] = useState("");
  const [giftMessage, setGiftMessage] = useState("");
  const [sendAsGift, setSendAsGift] = useState(false);
  const [method, setMethod] = useState<DeliveryMethod>("account");
  const [showDelivery, setShowDelivery] = useState(false);
  const [contact, setContact] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [guideId, setGuideId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
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
  const category = getCategory(product.category);
  const categoryHref = category?.href ?? (isTopup ? "/game-top-ups" : "/gift-cards");
  const categoryLabel = category
    ? locale === "ar"
      ? category.nameAr
      : category.name
    : t(isTopup ? "nav.topups" : "nav.gifts");

  const visibleDenoms = useMemo(() => denominationsForRegion(product, regionId), [product, regionId]);
  const hasAmountChoices = visibleDenoms.length > 1;
  const hasConfigurableOptions =
    multiRegion ||
    hasAmountChoices ||
    options.requiredCustomerFields.length > 0 ||
    isGift ||
    options.deliveryMethods.length > 1;
  const denomination = options.denominations.find((item) => item.id === denominationId);
  const region = options.regions.find((item) => item.id === regionId);
  const sale = discountPercent(denomination?.priceJod ?? product.priceJod, denomination?.compareAtPriceJod);
  const sendingGift = isGift && sendAsGift;
  const deliveryMethod: DeliveryMethod = sendingGift ? "sms" : method;
  const deliveryContact = sendingGift ? recipientPhone.trim() : contact;
  const needsContact = deliveryMethod === "email" || deliveryMethod === "sms";
  const contactOk = sendingGift
    ? isValidDemoPhone(recipientPhone)
    : !needsContact || (deliveryMethod === "email" ? isValidEmail(contact) : isValidDemoPhone(contact));
  const fieldsOk = options.requiredCustomerFields.every((field) =>
    validateCustomerField(field.id, fields[field.id] ?? "", field.required),
  );
  const stockOk = denomination?.inStock !== false;
  const ready = Boolean(regionId && denominationId && contactOk && fieldsOk && stockOk);

  const price = useMemo(() => (denomination?.priceJod ?? product.priceJod) * qty, [denomination, product.priceJod, qty]);
  const platformName = locale === "ar" ? options.platformLabelAr : options.platformLabel;
  const showBrand = product.brand.trim().toLowerCase() !== platformName.trim().toLowerCase();
  const productName = locale === "ar" ? product.nameAr : product.name;
  const thumbSrc = preferredCatalogImage(product);
  const denomLabel = denomination ? (locale === "ar" ? denomination.labelAr : denomination.label) : null;
  const activeTab: PanelTab =
    !hasConfigurableOptions && panelTab === "options" ? "details" : panelTab;

  const nextStep = !regionId
    ? t("product.needRegion")
    : !denominationId
      ? t("product.needAmount")
      : !fieldsOk
        ? t("product.needAccount")
        : sendingGift && !contactOk
          ? t("gift.needRecipient")
          : needsContact && !contactOk
            ? t("product.needContact")
            : !stockOk
              ? t("product.stockOut")
              : null;

  const selectRegion = (id: string) => {
    setRegionId(id);
    setDenominationId(matchDenominationId(product, id, denominationId));
  };

  const buildDigital = () => {
    if (!region || !denomination) return null;
    return {
      regionId: region.id,
      regionName: locale === "ar" ? region.nameAr : region.name,
      denominationId: denomination.id,
      denominationLabel: locale === "ar" ? denomination.labelAr : denomination.label,
      deliveryMethod,
      deliveryContact: needsContact ? deliveryContact : "",
      platform: platformName,
      customerFields: { ...fields },
      giftIntent: isGift ? ((sendingGift ? "recipient" : "self") as GiftIntent) : undefined,
      recipientPhone: sendingGift ? recipientPhone.trim() : undefined,
      giftMessage: sendingGift ? giftMessage.trim() : undefined,
    };
  };

  const addToCart = () => {
    const digital = buildDigital();
    if (!ready || !digital) return;
    addItem({ productId: product.id, quantity: qty, digital });
    setCartOpen(true);
  };

  const startBuyNow = () => {
    const digital = buildDigital();
    if (!ready || !digital || !denomination) return;
    const payload: QuickBuyPayload = {
      product,
      quantity: qty,
      digital,
      unitPriceJod: denomination.priceJod,
    };
    setPendingBuy(payload);
    if (status === "authenticated" && session?.user?.email) {
      setPayOpen(true);
      return;
    }
    setLoginOpen(true);
  };

  const tabs: Array<{ id: PanelTab; label: string }> = [
    ...(hasConfigurableOptions ? [{ id: "options" as const, label: t("product.tabOptions") }] : []),
    { id: "details", label: t("product.tabDetails") },
    { id: "reviews", label: t("product.reviews") },
  ];

  const buyFooter = (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted">{t("product.qty")}</span>
        <QuantitySelector value={qty} onChange={setQty} max={5} />
        <button
          type="button"
          className={cn(ICON_HIT, "ms-auto border border-line", wished && "text-gold")}
          onClick={() => toggle(product.id)}
          aria-label={t("common.wishlist")}
        >
          <Heart className={cn("h-4 w-4", wished && "fill-gold")} />
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl bg-brand-deep px-4 py-3.5 text-white">
        <span className="text-sm font-medium text-white/75">{t("product.optionPrice")}</span>
        <Price
          amount={price}
          compareAt={denomination?.compareAtPriceJod ? denomination.compareAtPriceJod * qty : undefined}
          locale={locale}
          size="lg"
          className="[&>span:first-child]:text-gold [&>span:last-child]:text-white/50"
        />
      </div>

      {nextStep ? (
        <p id="product-buy-hint" className="text-xs text-muted">
          {nextStep}
        </p>
      ) : (
        <p className="text-xs text-success">{t("product.digitalNotice")}</p>
      )}

      <div className="flex gap-2">
        <Button className="min-h-12 flex-1" disabled={!ready} aria-describedby={nextStep ? "product-buy-hint" : undefined} onClick={addToCart}>
          {t("product.add")}
        </Button>
        <Button className="min-h-12 flex-1" variant="outline" disabled={!ready} onClick={startBuyNow}>
          {t("product.buyNow")}
        </Button>
      </div>
    </>
  );

  return (
    <div className="container-mmh pb-32 pt-5 sm:pt-7 xl:pb-36">
      <Breadcrumbs
        items={[
          { href: "/", label: locale === "ar" ? "الرئيسية" : "Home" },
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
            <Badge
              badge={isTopup ? "topup" : "digital"}
              label={isTopup ? t("common.topup") : isGift ? t("gift.badge") : t("product.fulfillmentCode")}
            />
            {regionLocked ? <Badge badge="region_locked" label={t("common.regionLocked")} /> : null}
            {sale ? <Badge badge="sale" label={`-${sale}%`} /> : null}
          </div>

          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted">
            {showBrand ? `${platformName} · ${product.brand}` : platformName}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{productName}</h1>

          {product.reviewCount > 0 ? (
            <div className="mt-3">
              <Rating value={product.rating} count={product.reviewCount} reviewsLabel={t("common.reviews")} />
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <StockBadge
              inStock={stockOk && product.inStock}
              inLabel={t("product.available")}
              lowLabel={t("common.lowStock")}
              outLabel={t("common.outOfStock")}
            />
            <span className="text-sm text-muted">
              {t("product.categoryLabel")}:{" "}
              <Link href={categoryHref} className="font-semibold text-brand-deep hover:text-fg">
                {categoryLabel}
              </Link>
            </span>
          </div>

          {!hasConfigurableOptions ? (
            <div className="mt-6 space-y-5 rounded-2xl border border-line bg-card p-4 sm:p-5">
              <div>
                <p className="text-sm font-medium text-fg">{t("product.simpleBuy")}</p>
                {denomLabel ? (
                  <p className="mt-2 text-sm text-muted">
                    {t("product.fixedAmount")}: <span className="font-semibold text-fg">{denomLabel}</span>
                    {region ? ` · ${locale === "ar" ? region.nameAr : region.name}` : ""}
                  </p>
                ) : null}
              </div>
              {buyFooter}
            </div>
          ) : null}

          <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-card">
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
                              className={choiceClass(selected, "min-h-11 px-3.5 py-2")}
                            >
                              {locale === "ar" ? item.nameAr : item.name}
                              {item.currency ? ` · ${item.currency}` : ""}
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
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {visibleDenoms.map((item) => {
                          const selected = denominationId === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              disabled={item.inStock === false}
                              aria-pressed={selected}
                              onClick={() => setDenominationId(item.id)}
                              className={choiceClass(selected, "flex min-h-[4.5rem] flex-col justify-center px-3 py-3 text-start disabled:opacity-40")}
                            >
                              <span className="text-base font-semibold">{locale === "ar" ? item.labelAr : item.label}</span>
                              <span className="mt-1 text-xs text-muted">
                                {formatJod(item.priceJod, locale)}
                                {item.inStock === false ? ` · ${t("common.unavailable")}` : ""}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : denomLabel ? (
                    <p className="rounded-xl border border-line bg-elevated px-3 py-3 text-sm text-muted">
                      {t("product.fixedAmount")}: <span className="font-semibold text-fg">{denomLabel}</span>
                    </p>
                  ) : null}

                  {options.requiredCustomerFields.map((field) => (
                    <div key={field.id}>
                      <Field
                        label={locale === "ar" ? field.labelAr : field.label}
                        placeholder={locale === "ar" ? field.placeholderAr : field.placeholder}
                        value={fields[field.id] ?? ""}
                        error={
                          fields[field.id] && !validateCustomerField(field.id, fields[field.id], field.required)
                            ? t("product.playerIdError")
                            : undefined
                        }
                        onChange={(event) => setFields((current) => ({ ...current, [field.id]: event.target.value }))}
                      />
                      {(locale === "ar" ? field.helpTextAr : field.helpText) ? (
                        <>
                          <button
                            type="button"
                            className={cn("mt-1 rounded-md text-xs text-gold hover:underline", FOCUS_RING)}
                            aria-expanded={guideId === field.id}
                            aria-controls={`guide-${field.id}`}
                            onClick={() => setGuideId(guideId === field.id ? null : field.id)}
                          >
                            {t("product.findId")}
                          </button>
                          {guideId === field.id ? (
                            <p
                              id={`guide-${field.id}`}
                              className="mt-2 rounded-[12px] border border-line bg-elevated p-3 text-xs leading-5 text-muted"
                            >
                              {locale === "ar" ? field.helpTextAr : field.helpText}
                            </p>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  ))}

                  {isGift ? (
                    <div className="space-y-3">
                      <label className="flex cursor-pointer items-start gap-3 rounded-[12px] border border-line bg-elevated px-3 py-3 text-sm leading-5">
                        <input
                          type="checkbox"
                          className={cn("mt-0.5 h-4 w-4 shrink-0 accent-[#F7C037]", FOCUS_RING)}
                          checked={sendAsGift}
                          onChange={(event) => setSendAsGift(event.target.checked)}
                        />
                        <span>
                          <span className="block font-semibold text-fg">{t("gift.send")}</span>
                          <span className="mt-1 block text-xs text-muted">{t("gift.sendHint")}</span>
                        </span>
                      </label>
                      {sendingGift ? (
                        <div>
                          <Field
                            label={t("gift.recipientPhone")}
                            type="tel"
                            inputMode="tel"
                            value={recipientPhone}
                            onChange={(event) => setRecipientPhone(event.target.value)}
                            hint={t("gift.recipientPhoneHint")}
                            placeholder="+962 7X XXX XXXX"
                            error={recipientPhone && !isValidDemoPhone(recipientPhone) ? t("checkout.invalidPhone") : undefined}
                          />
                          <label className="mt-3 block space-y-1.5">
                            <span className="text-sm font-medium">{t("gift.message")}</span>
                            <textarea
                              value={giftMessage}
                              onChange={(event) => setGiftMessage(event.target.value)}
                              placeholder={t("gift.messagePlaceholder")}
                              rows={3}
                              className="w-full rounded-[12px] border border-line bg-elevated px-3 py-2 text-sm"
                            />
                          </label>
                        </div>
                      ) : (
                        <p className="text-xs leading-5 text-muted">{t("gift.forMeHint")}</p>
                      )}
                    </div>
                  ) : null}

                  {!sendingGift && options.deliveryMethods.length > 1 ? (
                    <div>
                      <button
                        type="button"
                        className="text-xs font-medium text-gold"
                        onClick={() => setShowDelivery((open) => !open)}
                        aria-expanded={showDelivery}
                      >
                        {t("product.deliveryAdvanced")}
                        {!showDelivery && method !== "account" ? ` · ${deliveryLabel(method, t)}` : ""}
                      </button>
                      {showDelivery ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {options.deliveryMethods.map((item) => {
                            const selected = method === item;
                            return (
                              <button
                                key={item}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => setMethod(item)}
                                className={choiceClass(selected, "px-3 py-2")}
                              >
                                {deliveryLabel(item, t)}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      {needsContact ? (
                        <div className="mt-3">
                          <Field
                            label={t("product.deliveryContact")}
                            value={contact}
                            onChange={(event) => setContact(event.target.value)}
                            placeholder={method === "email" ? "name@example.com" : "+962 7X XXX XXXX"}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {buyFooter}
                </div>
              ) : null}

              {activeTab === "details" ? (
                <div className="space-y-5 text-sm leading-7 text-muted">
                  <div>
                    <h2 className="text-base font-semibold text-fg">{t("product.description")}</h2>
                    <p className="mt-2">{locale === "ar" ? product.descriptionAr : product.description}</p>
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-fg">{t("product.howToUseHeading")}</h2>
                    <ol className="mt-2 list-decimal space-y-2 ps-5">
                      {(locale === "ar" ? options.howToUseAr : options.howToUse).map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-fg">{t("product.regionCompat")}</h2>
                    <p className="mt-2">{locale === "ar" ? options.regionRestrictionsAr : options.regionRestrictions}</p>
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-fg">{t("product.deliveryInfo")}</h2>
                    <p className="mt-2">{locale === "ar" ? options.deliveryEstimateAr : options.deliveryEstimate}</p>
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-fg">{t("product.refundPolicy")}</h2>
                    <p className="mt-2">{locale === "ar" ? options.refundPolicyTextAr : options.refundPolicyText}</p>
                  </div>
                </div>
              ) : null}

              {activeTab === "reviews" ? (
                <div>
                  {product.reviewCount > 0 ? (
                    <div className="mb-4">
                      <Rating value={product.rating} count={product.reviewCount} reviewsLabel={t("common.reviews")} />
                    </div>
                  ) : null}
                  <p className="text-sm leading-6 text-muted">{t("product.reviewsEmpty")}</p>
                </div>
              ) : null}
            </div>
          </div>

          <CompleteOrderBundle product={product} suggestions={alsoBought.length ? alsoBought : similar} />
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
          className="inline-flex items-center gap-2 text-sm font-semibold text-brand-deep hover:text-fg"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <ArrowUp className="h-4 w-4" />
          {t("product.backToTop")}
        </button>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-[35] border-t border-line bg-card/97 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(23,24,43,0.12)] backdrop-blur-md">
        <div className="container-mmh flex items-center gap-3">
          <div className="hidden h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-line bg-[#17182b] sm:block">
            <ProductCover product={product} src={thumbSrc} shot="cover" compact label={productName} className="aspect-square h-full w-full p-0 [&_img]:p-1" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{productName}</p>
            <Price amount={price} locale={locale} className="mt-0.5 [&>span:first-child]:text-sm [&>span:first-child]:text-brand-deep" />
          </div>
          <div className="hidden md:block">
            <QuantitySelector value={qty} onChange={setQty} max={5} />
          </div>
          <Button className="min-h-11 min-w-0 flex-1 px-3 text-sm sm:flex-none sm:min-w-[8.5rem]" disabled={!ready} onClick={addToCart}>
            {t("product.add")}
          </Button>
          <Button className="min-h-11 min-w-0 flex-1 px-3 text-sm sm:flex-none sm:min-w-[8.5rem]" variant="secondary" disabled={!ready} onClick={startBuyNow}>
            {t("product.buyNow")}
          </Button>
        </div>
      </div>

      <LoginModal
        open={loginOpen}
        onClose={() => {
          setLoginOpen(false);
          setPendingBuy(null);
        }}
        onSuccess={() => {
          setLoginOpen(false);
          setPayOpen(true);
        }}
      />
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
