"use client";

import { FOOTER_COLUMNS } from "@/data/navigation";
import { useLanguage } from "@/context/language-context";
import { Logo } from "@/components/ui/logo";
import { socialLinks, type SiteContact } from "@/lib/site-contact";
import Link from "next/link";

export function Footer({ contact, storeName = "MMH" }: { contact: SiteContact; storeName?: string }) {
  const { t } = useLanguage();
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-line bg-elevated">
      <div className="container-mmh grid gap-8 py-10 sm:gap-10 sm:py-14 lg:grid-cols-[1.2fr_2fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-sm text-sm leading-6 text-muted">{t("home.heroSubtitle")}</p>
          <p className="mt-5 text-sm text-muted">{t("contact.city")}</p>
          {contact.support_phone ? (
            <a href={`tel:${contact.support_phone.replace(/\s/g, "")}`} className="block text-sm text-muted hover:text-fg" dir="ltr">
              {contact.support_phone}
            </a>
          ) : null}
          {contact.support_email ? (
            <a href={`mailto:${contact.support_email}`} className="block text-sm text-muted hover:text-fg">
              {contact.support_email}
            </a>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.titleKey}>
              <p className="mb-3 text-sm font-semibold">{t(column.titleKey)}</p>
              <ul className="space-y-2">
                {column.links.map((link) => (
                  <li key={`${column.titleKey}-${link.href}`}>
                    <Link href={link.href} className="text-sm text-muted hover:text-fg">
                      {t(link.labelKey)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-line py-5">
        <div className="container-mmh flex flex-col gap-2 text-xs text-muted sm:flex-row sm:justify-between">
          <p>
            © {year} {storeName}
          </p>
          <div className="flex gap-4">
            {socialLinks(contact).map((link) => (
              <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" className="hover:text-fg">
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
