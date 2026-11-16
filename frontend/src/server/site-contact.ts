import { getSettings } from "@/lib/api/cms";
import { resolveMediaUrl } from "@/lib/media";
import { normalizeCurrencies, type DisplayCurrency } from "@/lib/currency";
import { EMPTY_SITE_CONTACT, type SiteContact } from "@/lib/site-contact";

export type StoreSettings = {
  contact: SiteContact;
  storeName: string;
  maintenanceMode: boolean;
  /** Uploaded logo / home picture ("" → bundled defaults). */
  logoUrl: string;
  heroUrl: string;
  /** Display currencies switched on in Settings (JOD first). */
  currencies: DisplayCurrency[];
};

export async function loadStoreSettings(): Promise<StoreSettings> {
  try {
    const data = await getSettings();
    const contact = { ...EMPTY_SITE_CONTACT };
    for (const key of Object.keys(contact) as Array<keyof SiteContact>) {
      contact[key] = String(data?.[key] ?? "").trim();
    }
    // ST-13: fall back to the deployment's support address when Settings has none.
    if (!contact.support_email) contact.support_email = (process.env.SUPPORT_EMAIL ?? "").trim();
    return {
      contact,
      storeName: String(data?.store_name ?? "").trim() || "MMH",
      maintenanceMode: data?.maintenance_mode === true,
      logoUrl: resolveMediaUrl(data?.logo_image_url),
      heroUrl: resolveMediaUrl(data?.hero_image_url),
      currencies: normalizeCurrencies(data?.currencies),
    };
  } catch {
    return {
      contact: { ...EMPTY_SITE_CONTACT, support_email: (process.env.SUPPORT_EMAIL ?? "").trim() },
      storeName: "MMH",
      maintenanceMode: false,
      logoUrl: "",
      heroUrl: "",
      currencies: normalizeCurrencies([]),
    };
  }
}

export async function loadSiteContact(): Promise<SiteContact> {
  return (await loadStoreSettings()).contact;
}
