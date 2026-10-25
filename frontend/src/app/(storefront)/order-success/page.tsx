import { auth } from "@/auth";
import { OrderSuccessView } from "@/components/checkout/order-success";
import { noIndexMeta } from "@/lib/seo";
import { loadOrder } from "@/server/orders/load";
import { serverT } from "@/server/locale";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

type Search = Promise<{ number?: string; token?: string }>;

/** ST-27: the tab title matches the page (no "Order received" when the order cannot be opened). */
export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const [{ number }, { t }] = await Promise.all([searchParams, serverT()]);
  return noIndexMeta(number ? t("order.title", { number }) : t("order.unavailableTitle"));
}

export default async function OrderSuccessPage({ searchParams }: { searchParams: Search }) {
  const [{ number, token }, session] = await Promise.all([searchParams, auth()]);
  const loaded = number ? await loadOrder(number, token).catch(() => null) : null;
  return (
    <OrderSuccessView
      order={loaded?.order ?? null}
      canReveal={loaded?.canReveal ?? false}
      urlToken={token}
      signedIn={session?.user?.kind === "CUSTOMER" && Boolean(session.user.accessToken)}
    />
  );
}
