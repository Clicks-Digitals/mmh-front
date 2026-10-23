import { cookies } from "next/headers";
import { formatMessage, translate } from "@/data/translations";
import { LOCALE_COOKIE, parseLocale } from "@/lib/locale";
import type { Locale } from "@/types";

export async function getServerLocale(): Promise<Locale> {
  try {
    return parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  } catch {
    return "en";
  }
}

export async function serverT() {
  const locale = await getServerLocale();
  return {
    locale,
    t: (key: string, values?: Record<string, string | number>) => formatMessage(translate(locale, key), values),
  };
}
