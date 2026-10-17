import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { AnnouncementBar } from "@/components/layout/announcement-bar";
import { FloatingContactButtons } from "@/components/layout/floating-contact";
import { CartDrawer } from "@/components/cart/cart-drawer";
import { MobileMenu } from "@/components/navigation/mobile-menu";
import { SearchOverlay } from "@/components/navigation/search-overlay";
import { QuickView } from "@/components/product/quick-view";
import { ToastViewport } from "@/components/ui/toast";
import { FocusMode } from "@/components/ui/focus-mode";
import { PageCurtain } from "@/components/layout/page-curtain";
import { Providers } from "@/context/providers";
import { CatalogBoot } from "@/components/storefront/catalog-boot";
import { hydrateCatalogFromDb } from "@/server/catalog/map";
import { loadSiteContact } from "@/server/site-contact";

export const dynamic = "force-dynamic";

export default async function StorefrontLayout({ children }: { children: React.ReactNode }) {
  const [catalog, contact] = await Promise.all([
    hydrateCatalogFromDb().catch(() => ({ products: [], categories: [] })),
    loadSiteContact(),
  ]);
  return (
    <div className="flex min-h-full flex-col bg-deep text-fg">
      <Providers>
        <CatalogBoot products={catalog.products} categories={catalog.categories}>
          <FocusMode />
          <PageCurtain />
          <AnnouncementBar />
          <Header />
          <main className="flex-1">{children}</main>
          <Footer contact={contact} />
          <FloatingContactButtons contact={contact} />
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
