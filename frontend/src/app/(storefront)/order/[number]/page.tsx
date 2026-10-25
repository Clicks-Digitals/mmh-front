import { auth } from "@/auth";
import { OrderSuccessView } from "@/components/checkout/order-success";
import { noIndexMeta } from "@/lib/seo";
import { loadOrder } from "@/server/orders/load";
import { serverT } from "@/server/locale";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

type Params = Promise<{ number: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const [{ number }, { t }] = await Promise.all([params, serverT()]);
  return { ...noIndexMeta(t("order.title", { number: decodeURIComponent(number) })), referrer: "no-referrer" };
}

/** Email link target: /order/<number>?token=<access_token>. */
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ number }, { token }, session] = await Promise.all([params, searchParams, auth()]);
  const loaded = await loadOrder(decodeURIComponent(number), token).catch(() => null);
  return (
    <OrderSuccessView
      order={loaded?.order ?? null}
      canReveal={loaded?.canReveal ?? false}
      urlToken={token}
      signedIn={session?.user?.kind === "CUSTOMER" && Boolean(session.user.accessToken)}
    />
  );
}
