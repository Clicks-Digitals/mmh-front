import { pageMeta } from "@/lib/seo";
import { socialLinks, whatsappHref } from "@/lib/site-contact";
import { loadSiteContact } from "@/server/site-contact";
import { serverT } from "@/server/locale";
import Link from "next/link";

export const metadata = pageMeta("Contact MMH", "Reach MMH support for orders, codes, and top-ups.", "/contact");
export const dynamic = "force-dynamic";

export default async function ContactPage() {
  const [contact, { t }] = await Promise.all([loadSiteContact(), serverT()]);
  const whatsapp = whatsappHref(contact.whatsapp_number);
  const socials = socialLinks(contact);
  const channels = [
    contact.support_phone && {
      label: t("contact.phone"),
      value: contact.support_phone,
      href: `tel:${contact.support_phone.replace(/\s/g, "")}`,
    },
    contact.support_email && { label: t("contact.email"), value: contact.support_email, href: `mailto:${contact.support_email}` },
    whatsapp && { label: "WhatsApp", value: `+${contact.whatsapp_number.replace(/\D/g, "")}`, href: whatsapp },
    contact.telegram_url && { label: "Telegram", value: contact.telegram_url.replace(/^https?:\/\//, ""), href: contact.telegram_url },
  ].filter((item): item is { label: string; value: string; href: string } => Boolean(item));

  return (
    <div className="container-mmh max-w-3xl py-10 lg:py-14">
      <div className="rounded-2xl border border-line bg-card p-6 sm:p-8">
        <h1 className="text-2xl font-semibold sm:text-3xl">{t("contact.title")}</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          {channels.length ? t("contact.body") : t("contact.bodyEmpty")}
        </p>
        <dl className="mt-8 space-y-4 text-sm">
          {channels.map((channel) => (
            <div key={channel.label}>
              <dt className="text-muted">{channel.label}</dt>
              <dd className="mt-1">
                <a
                  href={channel.href}
                  target={channel.href.startsWith("http") ? "_blank" : undefined}
                  rel={channel.href.startsWith("http") ? "noopener noreferrer" : undefined}
                  className="font-medium hover:text-gold"
                  dir="ltr"
                >
                  {channel.value}
                </a>
              </dd>
            </div>
          ))}
          {contact.business_hours ? (
            <div>
              <dt className="text-muted">{t("contact.hours")}</dt>
              <dd className="mt-1">{contact.business_hours}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-muted">{t("contact.location")}</dt>
            <dd className="mt-1">{t("contact.city")}</dd>
          </div>
          {socials.length ? (
            <div>
              <dt className="text-muted">{t("contact.follow")}</dt>
              <dd className="mt-1 flex flex-wrap gap-4">
                {socials.map((link) => (
                  <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-gold">
                    {link.label}
                  </a>
                ))}
              </dd>
            </div>
          ) : null}
        </dl>
        <p className="mt-7 text-sm text-muted">{t("contact.existing")}</p>
        <Link href="/account/orders" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-brand-deep px-5 text-sm font-semibold text-white">{t("contact.viewOrders")}</Link>
        <Link href="/order-lookup" className="ms-3 mt-4 inline-flex min-h-11 items-center rounded-xl border border-line px-5 text-sm font-semibold">{t("lookup.footer")}</Link>
      </div>
    </div>
  );
}
