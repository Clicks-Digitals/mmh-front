import { OrderLookupForm } from "@/components/orders/order-lookup-form";
import { pageMeta } from "@/lib/seo";
import { serverT } from "@/server/locale";

export const metadata = { ...pageMeta("Find your order", "Check the status of an MMH order with its number and checkout email.", "/order-lookup"), robots: { index: false, follow: true } };

export default async function OrderLookupPage({ searchParams }: { searchParams: Promise<{ number?: string }> }) {
  const [{ t }, { number }] = await Promise.all([serverT(), searchParams]);
  return (
    <div className="container-mmh max-w-2xl py-10 md:py-14">
      <h1 className="text-2xl font-semibold sm:text-3xl">{t("lookup.title")}</h1>
      <p className="mt-2 mb-6 text-sm text-muted">{t("lookup.body")}</p>
      <OrderLookupForm initialNumber={number ?? ""} />
    </div>
  );
}
