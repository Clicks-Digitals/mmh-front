import { apiFetch } from "@/lib/api/client";
import { EMPTY_SITE_CONTACT, type SiteContact } from "@/lib/site-contact";

export async function loadSiteContact(): Promise<SiteContact> {
  try {
    const data = await apiFetch<Partial<SiteContact>>("/cms/settings/");
    const contact = { ...EMPTY_SITE_CONTACT };
    for (const key of Object.keys(contact) as Array<keyof SiteContact>) {
      contact[key] = String(data?.[key] ?? "").trim();
    }
    return contact;
  } catch {
    return EMPTY_SITE_CONTACT;
  }
}
