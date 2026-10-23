import { redirect } from "next/navigation";

/** Breadcrumb target for /admin/integrations/* — the only integration is OneEpin. */
export default function IntegrationsRedirect() {
  redirect("/admin/integrations/1epin");
}
