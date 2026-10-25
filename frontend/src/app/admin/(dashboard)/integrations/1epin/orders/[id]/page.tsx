import { OneEpinOrderDetailClient } from "@/components/admin/oneepin/order-detail-client";
import { requireSupplierOrdersAccess } from "../access";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireSupplierOrdersAccess();
  const { id } = await params;
  return <OneEpinOrderDetailClient id={id} />;
}
