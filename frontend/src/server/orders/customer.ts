import type { CustomerOrderSummary } from "@/components/account/customer-account";
import { myOrders } from "@/lib/api/orders";

type ApiOrder = {
  id: number;
  order_number: string;
  created_at: string;
  payment_status: string;
  fulfillment_status: string;
  total_jod: number;
  items: Array<{
    id: number;
    product_name: string;
    variant_name?: string;
    quantity: number;
  }>;
};

type Paginated<T> = { results: T[] } | T[];

export async function loadCustomerOrders(token?: string): Promise<CustomerOrderSummary[]> {
  if (!token) return [];
  try {
    const data = (await myOrders(token)) as Paginated<ApiOrder>;
    const rows = Array.isArray(data) ? data : data.results;
    return rows.map((order) => ({
      id: String(order.id),
      number: order.order_number,
      createdAt: order.created_at,
      paymentStatus: order.payment_status,
      fulfillmentStatus: order.fulfillment_status,
      totalJod: order.total_jod,
      items: order.items.map((item) => {
        const name = item.variant_name ? `${item.product_name} · ${item.variant_name}` : item.product_name;
        return {
          id: String(item.id),
          name,
          nameAr: name,
          quantity: item.quantity,
          fulfillmentType: "CODE",
          fields: [],
          codes: [],
        };
      }),
    }));
  } catch {
    return [];
  }
}
