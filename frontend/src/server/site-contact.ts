import { getSettings } from "@/lib/api/cms";
import { EMPTY_SITE_CONTACT, type SiteContact } from "@/lib/site-contact";

export type StoreSettings = { contact: SiteContact; storeName: string; maintenanceMode: boolean };

export async function loadStoreSettings(): Promise<StoreSettings> {
  try {
    const data = await getSettings();
    const contact = { ...EMPTY_SITE_CONTACT };
    for (const key of Object.keys(contact) as Array<keyof SiteContact>) {
      contact[key] = String(data?.[key] ?? "").trim();
    }
    return {
      contact,
      storeName: String(data?.store_name ?? "").trim() || "MMH",
      maintenanceMode: data?.maintenance_mode === true,
    };
  } catch {
    return { contact: EMPTY_SITE_CONTACT, storeName: "MMH", maintenanceMode: false };
  }
}

export async function loadSiteContact(): Promise<SiteContact> {
  return (await loadStoreSettings()).contact;
}
