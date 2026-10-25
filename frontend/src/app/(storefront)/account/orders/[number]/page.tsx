import { CustomerOrderDetail } from "@/components/account/customer-account";
import { OrderUnavailable } from "@/components/checkout/order-success";
import { noIndexMeta } from "@/lib/seo";
import { requireCustomer } from "@/server/auth/require-customer";
import { loadOrder } from "@/server/orders/load";

export const metadata = noIndexMeta("Order details");

export default async function CustomerOrderPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  await requireCustomer(`/account/orders/${number}`);
  const loaded = await loadOrder(decodeURIComponent(number)).catch(() => null);
  // ST-22: an order that is not this customer's gets order-specific copy, not a generic 404.
  if (!loaded) return <OrderUnavailable signedIn />;
  return <CustomerOrderDetail order={loaded.order} />;
}
