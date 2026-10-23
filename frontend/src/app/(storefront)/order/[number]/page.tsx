import { OrderSuccessView } from "@/components/checkout/order-success";
import { noIndexMeta } from "@/lib/seo";
import { loadOrder } from "@/server/orders/load";

export const metadata = {
  ...noIndexMeta("Your order"),
  referrer: "no-referrer" as const,
};
export const dynamic = "force-dynamic";

/** Email link target: /order/<number>?token=<access_token>. */
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ number: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ number }, { token }] = await Promise.all([params, searchParams]);
  const loaded = await loadOrder(decodeURIComponent(number), token).catch(() => null);
  return <OrderSuccessView order={loaded?.order ?? null} canReveal={loaded?.canReveal ?? false} urlToken={token} />;
}
