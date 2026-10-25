import { OneEpinOrdersClient } from "@/components/admin/oneepin/orders-client";
import { Suspense } from "react";
import { requireSupplierOrdersAccess } from "./access";

export default async function Page() {
  await requireSupplierOrdersAccess();
  return (
    <Suspense>
      <OneEpinOrdersClient />
    </Suspense>
  );
}
