import { requireAdmin } from "@/server/auth/require-admin";
import { hasPermission } from "@/server/auth/permissions";
import { redirect } from "next/navigation";

/** 1Epin supplier orders are readable with suppliers.read OR orders.read (backend rule). */
export async function requireSupplierOrdersAccess() {
  const user = await requireAdmin();
  const ok =
    hasPermission(user.permissions, "suppliers.read", user.role) || hasPermission(user.permissions, "orders.read", user.role);
  if (!ok) redirect("/admin/unauthorized");
  return user;
}
