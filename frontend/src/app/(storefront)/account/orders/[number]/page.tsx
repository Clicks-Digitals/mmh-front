import { CustomerOrders } from "@/components/account/customer-account";
import { requireCustomer } from "@/server/auth/require-customer";
import { loadCustomerOrders } from "@/server/orders/customer";
import { notFound } from "next/navigation";

export const metadata = { title: "Order details" };

export default async function CustomerOrderPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const user = await requireCustomer(`/account/orders/${number}`);
  const order = (await loadCustomerOrders(user.accessToken)).find((item) => item.number === number);
  if (!order) notFound();
  return <CustomerOrders orders={[order]} />;
}
