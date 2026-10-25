/** Public contact details managed in Admin → Settings. Empty strings are hidden on the storefront. */
export type SiteContact = {
  support_email: string;
  support_phone: string;
  business_hours: string;
  whatsapp_number: string;
  telegram_url: string;
  instagram_url: string;
  facebook_url: string;
  tiktok_url: string;
  youtube_url: string;
};

export const EMPTY_SITE_CONTACT: SiteContact = {
  support_email: "",
  support_phone: "",
  business_hours: "",
  whatsapp_number: "",
  telegram_url: "",
  instagram_url: "",
  facebook_url: "",
  tiktok_url: "",
  youtube_url: "",
};

/** ST-13: whether any way to reach the shop is configured (otherwise contact CTAs are hidden). */
export function hasContactChannel(contact: Partial<SiteContact>): boolean {
  return Boolean(
    contact.support_email?.trim() ||
      contact.support_phone?.trim() ||
      contact.whatsapp_number?.replace(/\D/g, "") ||
      contact.telegram_url?.trim() ||
      contact.instagram_url?.trim() ||
      contact.facebook_url?.trim(),
  );
}

export function whatsappHref(number: string): string {
  const digits = number.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : "";
}

export function socialLinks(contact: SiteContact) {
  return [
    { label: "Instagram", href: contact.instagram_url },
    { label: "Facebook", href: contact.facebook_url },
    { label: "TikTok", href: contact.tiktok_url },
    { label: "YouTube", href: contact.youtube_url },
  ].filter((link) => link.href);
}
