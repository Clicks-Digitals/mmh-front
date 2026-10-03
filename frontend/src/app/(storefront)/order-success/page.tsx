import { auth } from "@/auth";
import { OrderSuccessView } from "@/components/checkout/order-success";
import { getOrder } from "@/lib/api/orders";
import { readOrderAccessEmail } from "@/server/orders/access";

export const metadata = { title: "Order received" };

type ApiOrder = {
  id: number;
  order_number: string;
  total_jod: number;
  currency: string;
  payment_status: string;
  payment_provider?: string;
  fulfillment_status: string;
  items: Array<{
    id: number;
    product_name: string;
    variant_name?: string;
    quantity: number;
    unit_price_fils: number;
  }>;
};

export default async function OrderSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; number?: string }>;
}) {
  const { number } = await searchParams;
  const orderNumber = number;
  let safe = null;
  if (orderNumber) {
    try {
      const session = await auth();
      const token = session?.user?.kind === "CUSTOMER" ? session.user.accessToken : undefined;
      const email = await readOrderAccessEmail(orderNumber);
      const order = (await getOrder(orderNumber, { email, token })) as ApiOrder;
      safe = {
        number: order.order_number,
        totalJod: order.total_jod,
        currency: order.currency,
        paymentStatus: order.payment_status,
        fulfillmentStatus: order.fulfillment_status,
        paymentMethod: order.payment_provider || "paypal",
        items: order.items.map((item) => ({
          id: String(item.id),
          name: item.variant_name ? `${item.product_name} · ${item.variant_name}` : item.product_name,
          nameAr: item.variant_name ? `${item.product_name} · ${item.variant_name}` : item.product_name,
          quantity: item.quantity,
          unitPriceJod: item.unit_price_fils / 1000,
          fulfillmentType: "CODE" as const,
          fields: [] as Array<{ label: string; maskedValue: string }>,
          codes: [] as Array<{ masked: string; value?: string }>,
        })),
      };
    } catch {
      safe = null;
    }
  }

  return <OrderSuccessView order={safe} />;
}
