import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { AnnouncementBar } from "@/components/layout/announcement-bar";
import { FloatingContactButtons } from "@/components/layout/floating-contact";
import { MaintenancePage } from "@/components/layout/maintenance-page";
import { CartDrawer } from "@/components/cart/cart-drawer";
import { MobileMenu } from "@/components/navigation/mobile-menu";
import { SearchOverlay } from "@/components/navigation/search-overlay";
import { QuickView } from "@/components/product/quick-view";
import { ToastViewport } from "@/components/ui/toast";
import { FocusMode } from "@/components/ui/focus-mode";
import { PageCurtain } from "@/components/layout/page-curtain";
import { Providers } from "@/context/providers";
import { BrandAssetsProvider } from "@/context/brand-assets-context";
import { CurrencyProvider } from "@/context/currency-context";
import { CURRENCY_COOKIE } from "@/lib/currency";
import { themeCss } from "@/lib/design";
import { CatalogBoot } from "@/components/storefront/catalog-boot";
import { isMaintenanceExempt, PATHNAME_HEADER } from "@/lib/maintenance";
import { resolveMenuCategories, resolveStorefrontCategories, resolveStorefrontProducts } from "@/server/catalog/resolve";
import { loadFooterPages } from "@/server/legal-page";
import { getServerLocale, serverT } from "@/server/locale";
import { loadStoreSettings } from "@/server/site-contact";
import { cookies, headers } from "next/headers";

export const dynamic = "force-dynamic";

export default async function StorefrontLayout({ children }: { children: React.ReactNode }) {
  const [settings, locale, requestHeaders] = await Promise.all([loadStoreSettings(), getServerLocale(), headers()]);
  const pathname = requestHeaders.get(PATHNAME_HEADER) ?? "";

  // D21: browse pages normally get a 503 from src/proxy.ts; this is the fallback when the proxy's
  // cached settings are a few seconds behind. Order, account and help pages stay available.
  if (settings.maintenanceMode && !(pathname && isMaintenanceExempt(pathname))) {
    return (
      <div className="flex min-h-full flex-col bg-deep text-fg">
        <Providers locale={locale}>
          <BrandAssetsProvider value={{ logoUrl: settings.logoUrl, heroUrl: settings.heroUrl }}>
            <MaintenancePage contact={settings.contact} storeName={settings.storeName} />
          </BrandAssetsProvider>
        </Providers>
      </div>
    );
  }

  const currencyCode = (await cookies()).get(CURRENCY_COOKIE)?.value;
  const [products, categories, menuCategories, footerPages] = await Promise.all([
    resolveStorefrontProducts().catch(() => []),
    resolveStorefrontCategories().catch(() => []),
    resolveMenuCategories(),
    loadFooterPages(),
  ]);
  const themeStyle = themeCss(settings.theme);
  return (
    <div className="flex min-h-full flex-col bg-deep text-fg" data-neon={settings.theme.neon}>
      {themeStyle ? <style dangerouslySetInnerHTML={{ __html: themeStyle }} /> : null}
      <Providers locale={locale}>
        <BrandAssetsProvider value={{ logoUrl: settings.logoUrl, heroUrl: settings.heroUrl }}>
          <CurrencyProvider currencies={settings.currencies} initialCode={currencyCode}>
          <CatalogBoot products={products} categories={categories} menuCategories={menuCategories}>
            <FocusMode />
            <PageCurtain />
            {settings.maintenanceMode ? (
              <div className="bg-amber/15 px-4 py-2 text-center text-xs font-medium text-amber" role="status">
                {(await serverT()).t("maintenance.banner")}
              </div>
            ) : null}
            <AnnouncementBar />
            <Header />
            <main className="flex-1">{children}</main>
            <Footer contact={settings.contact} storeName={settings.storeName} pages={footerPages} />
            <FloatingContactButtons contact={settings.contact} />
            <CartDrawer />
            <MobileMenu />
            <SearchOverlay />
            <QuickView />
            <ToastViewport />
          </CatalogBoot>
          </CurrencyProvider>
        </BrandAssetsProvider>
      </Providers>
    </div>
  );
}
