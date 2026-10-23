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
  support_email?: string;
  support_phone?: string;
  business_hours?: string;
  whatsapp_number?: string;
  telegram_url?: string;
  instagram_url?: string;
  facebook_url?: string;
  tiktok_url?: string;
  youtube_url?: string;
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
