import { CustomerOrderDetail } from "@/components/account/customer-account";
import { noIndexMeta } from "@/lib/seo";
import { requireCustomer } from "@/server/auth/require-customer";
import { loadOrder } from "@/server/orders/load";
import { notFound } from "next/navigation";

export const metadata = noIndexMeta("Order details");

export default async function CustomerOrderPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  await requireCustomer(`/account/orders/${number}`);
  const loaded = await loadOrder(decodeURIComponent(number));
  if (!loaded) notFound();
  return <CustomerOrderDetail order={loaded.order} />;
}
