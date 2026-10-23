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
import { CatalogBoot } from "@/components/storefront/catalog-boot";
import { resolveStorefrontCategories, resolveStorefrontProducts } from "@/server/catalog/resolve";
import { getServerLocale } from "@/server/locale";
import { loadStoreSettings } from "@/server/site-contact";

export const dynamic = "force-dynamic";

export default async function StorefrontLayout({ children }: { children: React.ReactNode }) {
  const [settings, locale] = await Promise.all([loadStoreSettings(), getServerLocale()]);

  if (settings.maintenanceMode) {
    return (
      <div className="flex min-h-full flex-col bg-deep text-fg">
        <Providers locale={locale}>
          <MaintenancePage contact={settings.contact} storeName={settings.storeName} />
        </Providers>
      </div>
    );
  }

  const [products, categories] = await Promise.all([
    resolveStorefrontProducts().catch(() => []),
    resolveStorefrontCategories().catch(() => []),
  ]);
  return (
    <div className="flex min-h-full flex-col bg-deep text-fg">
      <Providers locale={locale}>
        <CatalogBoot products={products} categories={categories}>
          <FocusMode />
          <PageCurtain />
          <AnnouncementBar />
          <Header />
          <main className="flex-1">{children}</main>
          <Footer contact={settings.contact} storeName={settings.storeName} />
          <FloatingContactButtons contact={settings.contact} />
          <CartDrawer />
          <MobileMenu />
          <SearchOverlay />
          <QuickView />
          <ToastViewport />
        </CatalogBoot>
      </Providers>
    </div>
  );
}
