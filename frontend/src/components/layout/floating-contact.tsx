"use client";

import { useLanguage } from "@/context/language-context";
import { cn } from "@/lib/cn";
import { FOCUS_RING } from "@/components/ui/control";
import { whatsappHref, type SiteContact } from "@/lib/site-contact";

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M21.93 4.24a1.5 1.5 0 0 0-1.55-.2L3.4 11.2c-.9.38-.88 1.68.03 2.02l4.08 1.5 1.57 4.78c.28.86 1.38 1.1 1.98.44l2.3-2.53 4.26 3.14c.72.53 1.75.14 1.95-.74L22.7 5.62a1.5 1.5 0 0 0-.77-1.38ZM9.2 14.1l8.88-6.66c.18-.14.37.1.22.27l-7.2 7.64-.3 3.07-1.6-4.32Z" />
    </svg>
  );
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M12.04 2C6.58 2 2.15 6.4 2.15 11.83c0 1.95.55 3.8 1.52 5.4L2 22l4.95-1.6a9.9 9.9 0 0 0 5.09 1.4h.01c5.46 0 9.89-4.4 9.89-9.84C21.94 6.4 17.5 2 12.04 2Zm5.75 14.13c-.24.68-1.4 1.25-1.94 1.33-.5.07-1.14.1-1.84-.12-.42-.13-.97-.32-1.67-.63-2.94-1.27-4.85-4.23-5-4.42-.14-.19-1.18-1.57-1.18-3 0-1.42.74-2.12 1.01-2.41.26-.28.58-.35.77-.35h.56c.18 0 .42-.07.66.5.24.59.82 2.02.89 2.17.07.14.12.31.02.5-.1.19-.14.31-.28.48-.14.16-.3.37-.42.5-.14.14-.28.29-.12.56.16.28.7 1.15 1.5 1.86 1.03.92 1.9 1.2 2.17 1.34.28.14.44.12.6-.07.16-.19.7-.81.88-1.09.19-.28.37-.23.63-.14.26.1 1.64.77 1.92.91.28.14.47.21.54.33.07.12.07.68-.17 1.36Z" />
    </svg>
  );
}

export function FloatingContactButtons({ contact }: { contact: SiteContact }) {
  const { t } = useLanguage();
  const telegram = contact.telegram_url;
  const whatsapp = whatsappHref(contact.whatsapp_number);

  if (!telegram && !whatsapp) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[55] px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex max-w-[1440px] items-end justify-between gap-4">
        {telegram ? (
          <a
            href={telegram}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("contact.telegram")}
            className={cn(
              FOCUS_RING,
              "pointer-events-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#2AABEE] text-white shadow-[0_12px_28px_rgba(42,171,238,0.45)] transition hover:scale-105 hover:brightness-110 sm:h-14 sm:w-14",
            )}
          >
            <TelegramIcon className="h-6 w-6 sm:h-7 sm:w-7" />
          </a>
        ) : (
          <span />
        )}
        {whatsapp ? (
          <a
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("contact.whatsapp")}
            className={cn(
              FOCUS_RING,
              "pointer-events-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_12px_28px_rgba(37,211,102,0.45)] transition hover:scale-105 hover:brightness-110 sm:h-14 sm:w-14",
            )}
          >
            <WhatsAppIcon className="h-6 w-6 sm:h-7 sm:w-7" />
          </a>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
