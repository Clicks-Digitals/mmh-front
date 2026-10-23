import { OrderSuccessView } from "@/components/checkout/order-success";
import { noIndexMeta } from "@/lib/seo";
import { loadOrder } from "@/server/orders/load";

export const metadata = noIndexMeta("Order received");
export const dynamic = "force-dynamic";

export default async function OrderSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ number?: string; token?: string }>;
}) {
  const { number, token } = await searchParams;
  const loaded = number ? await loadOrder(number, token).catch(() => null) : null;
  return <OrderSuccessView order={loaded?.order ?? null} canReveal={loaded?.canReveal ?? false} urlToken={token} />;
}
