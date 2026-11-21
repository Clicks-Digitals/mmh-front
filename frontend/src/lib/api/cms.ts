import { apiFetch } from "@/lib/api/client";

export type ApiBanner = {
  id: number;
  placement: string;
  title_en: string;
  title_ar: string;
  subtitle_en: string;
  subtitle_ar: string;
  kicker: string;
  href: string;
  tone: string;
  desktop_image: string;
  mobile_image: string;
  sort_order: number;
};

export type ApiCmsPage = {
  slug: string;
  title_en: string;
  title_ar: string;
  body_en: string;
  body_ar: string;
  updated_at?: string;
};

export type ApiSiteSettings = {
  store_name?: string;
  maintenance_mode?: boolean;
  currencies?: Array<{ code: string; rate: number; enabled?: boolean }>;
  support_email?: string;
  support_phone?: string;
  business_hours?: string;
  whatsapp_number?: string;
  telegram_url?: string;
  instagram_url?: string;
  facebook_url?: string;
  tiktok_url?: string;
  youtube_url?: string;
  /** Uploaded in Admin → Settings; "" → the store's bundled logo / home picture. */
  logo_image_url?: string;
  hero_image_url?: string;
  /** Admin → Store design (normalised by lib/design.ts). */
  theme?: unknown;
  home_layout?: unknown;
};

export function listBanners(placement = "HOME") {
  return apiFetch<ApiBanner[] | { results: ApiBanner[] }>(`/cms/banners/?placement=${encodeURIComponent(placement)}`);
}

export function listFaqs() {
  return apiFetch("/cms/faqs/");
}

export function getPage(slug: string) {
  return apiFetch<ApiCmsPage>(`/cms/pages/${encodeURIComponent(slug)}/`);
}

export function getSettings() {
  return apiFetch<ApiSiteSettings>("/cms/settings/");
}

/** D19: published content pages (ordered); `show_in_footer` ones are linked in the footer. */
export type ApiCmsPageSummary = {
  slug: string;
  title_en: string;
  title_ar: string;
  show_in_footer?: boolean;
  sort_order?: number;
};

export function listPages() {
  return apiFetch<ApiCmsPageSummary[] | { results: ApiCmsPageSummary[] }>("/cms/pages/");
}
