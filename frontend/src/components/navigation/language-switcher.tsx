"use client";

import { useLanguage } from "@/context/language-context";
import { FOCUS_RING } from "@/components/ui/control";
import { cn } from "@/lib/cn";

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useLanguage();

  return (
    <div className="inline-flex rounded-xl border border-line bg-elevated p-0.5" role="group" aria-label={t("common.language")}>
      {(["en", "ar"] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLocale(code)}
          className={cn(
            "mmh-neon-hover h-8 min-w-9 rounded-[10px] px-2.5 text-xs font-semibold uppercase transition-colors",
            FOCUS_RING,
            locale === code ? "bg-brand-deep text-white shadow-sm" : "text-muted hover:text-fg",
            compact && "min-w-8 px-2",
          )}
          aria-pressed={locale === code}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
