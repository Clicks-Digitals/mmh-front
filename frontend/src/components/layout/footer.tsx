"use client";

import { FOOTER_COLUMNS } from "@/data/navigation";
import { SITE } from "@/config/site";
import { useLanguage } from "@/context/language-context";
import { useToast } from "@/context/toast-context";
import { isValidEmail } from "@/lib/validation";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { socialLinks, type SiteContact } from "@/lib/site-contact";
import Link from "next/link";
import { useState } from "react";

export function Footer({ contact }: { contact: SiteContact }) {
  const { t } = useLanguage();
  const { push } = useToast();
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  return (
    <footer className="mt-auto border-t border-line bg-elevated">
      <div className="container-mmh grid gap-8 py-10 sm:gap-10 sm:py-14 lg:grid-cols-[1.2fr_2fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-sm text-sm leading-6 text-muted">
            {t("home.heroSubtitle")}
          </p>
          <p className="mt-5 text-sm text-muted">{SITE.contact.city}</p>
          {SITE.contact.address ? <p className="text-sm text-muted">{SITE.contact.address}</p> : null}
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
          <form
            className="mt-6 flex max-w-md flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              if (!isValidEmail(email)) {
                push({ title: t("home.newsletterError"), tone: "error" });
                return;
              }
              setDone(true);
              push({ title: t("home.newsletterSuccess"), tone: "info" });
            }}
          >
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t("home.newsletterPlaceholder")}
              aria-label={t("home.newsletterPlaceholder")}
              className="h-11 flex-1 rounded-[12px] border border-line bg-deep px-3 text-base text-fg placeholder:text-subtle outline-none hover:border-accent/58 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-elevated md:text-sm"
            />
            <Button type="submit" className="w-full sm:w-auto">{t("home.newsletterCta")}</Button>
          </form>
          {done ? <p className="mt-2 text-xs text-success">{t("home.newsletterSuccess")}</p> : null}
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.titleKey}>
              <p className="mb-3 text-sm font-semibold">{t(column.titleKey)}</p>
              <ul className="space-y-2">
                {column.links.map((link) => (
                  <li key={link.href}>
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
          <p>{t("footer.rights")}</p>
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
