import { AuditListClient } from "@/components/admin/modules/audit-list-client";
import { requireAdmin } from "@/server/auth/require-admin";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; order_number?: string; entity_type?: string; action_prefix?: string }>;
}) {
  await requireAdmin("audit.read");
  const sp = await searchParams;
  // An order number from the order page ("Open in activity log") is searched like any text.
  return (
    <AuditListClient
      initialSearch={sp.search ?? sp.order_number ?? ""}
      initialEntityType={sp.entity_type ?? ""}
      initialActionPrefix={sp.action_prefix ?? ""}
    />
  );
}
