"use client";

import { Logo } from "@/components/ui/logo";
import { LanguageSwitcher } from "@/components/navigation/language-switcher";
import { useLanguage } from "@/context/language-context";
import { socialLinks, whatsappHref, type SiteContact } from "@/lib/site-contact";

export function MaintenancePage({ contact, storeName }: { contact: SiteContact; storeName: string }) {
  const { t } = useLanguage();
  const whatsapp = whatsappHref(contact.whatsapp_number);
  const links = [
    contact.support_email && { label: contact.support_email, href: `mailto:${contact.support_email}` },
    contact.support_phone && { label: contact.support_phone, href: `tel:${contact.support_phone.replace(/\s/g, "")}` },
    whatsapp && { label: "WhatsApp", href: whatsapp },
    contact.telegram_url && { label: "Telegram", href: contact.telegram_url },
    ...socialLinks(contact),
  ].filter((item): item is { label: string; href: string } => Boolean(item));

  return (
    <main className="container-mmh flex min-h-[100dvh] flex-col items-center justify-center py-16 text-center">
      <div className="absolute end-4 top-4">
        <LanguageSwitcher compact />
      </div>
      <Logo />
      <h1 className="mt-8 text-3xl font-bold tracking-tight sm:text-4xl">{t("maintenance.title")}</h1>
      <p className="mt-4 max-w-lg text-sm leading-7 text-muted sm:text-base">{t("maintenance.body")}</p>
      {links.length ? (
        <div className="mt-8">
          <p className="text-sm font-medium">{t("maintenance.contact")}</p>
          <ul className="mt-3 flex flex-wrap justify-center gap-3">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  target={link.href.startsWith("http") ? "_blank" : undefined}
                  rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                  className="inline-flex min-h-10 items-center rounded-xl border border-line bg-card px-4 text-sm font-medium hover:border-gold/50 hover:text-gold"
                  dir="ltr"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-12 text-xs text-muted">© {new Date().getFullYear()} {storeName}</p>
    </main>
  );
}
