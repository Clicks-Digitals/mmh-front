import { pageMeta } from "@/lib/seo";
import { resolveStorefrontProducts } from "@/server/catalog/resolve";
import { serverT } from "@/server/locale";
import { brandCountKey, brandsFromProducts } from "@/lib/brands";
import Link from "next/link";

export const metadata = pageMeta("Brands at MMH", "Digital gaming brands sold by MMH in Jordan.", "/brands");

export default async function BrandsPage() {
  const [{ t, locale }, products] = await Promise.all([serverT(), resolveStorefrontProducts()]);
  const brands = brandsFromProducts(products);
  return (
    <div className="container-mmh py-6 sm:py-10">
      <h1 className="text-2xl font-semibold sm:text-3xl">{t("brands.title")}</h1>
      <p className="mt-2 mb-8 max-w-2xl text-sm text-muted">{t("brands.body")}</p>
      {brands.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {brands.map((brand) => (
            <article key={brand.name} className="rounded-[12px] border border-line bg-card p-5">
              <h2 className="text-lg font-semibold">{locale === "ar" ? brand.nameAr : brand.name}</h2>
              <Link href={`/shop?brand=${encodeURIComponent(brand.name)}`} className="mt-4 inline-flex text-sm text-accent">
                {t(brandCountKey(brand.count, locale), { count: brand.count })}
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">{t("brands.empty")}</p>
      )}
    </div>
  );
}
