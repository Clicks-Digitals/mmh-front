import { SITE } from "@/config/site";
import { localeDir } from "@/lib/locale";
import { getServerLocale } from "@/server/locale";
import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#17182b",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: "MMH — Digital gaming codes and top-ups in Jordan",
    template: "%s · MMH",
  },
  description: SITE.description,
  icons: { icon: "/brand/IMG_4556.png" },
  alternates: { canonical: "/" },
  openGraph: {
    siteName: SITE.name,
    locale: "en_JO",
    type: "website",
    url: SITE.url,
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getServerLocale();
  return (
    <html
      lang={locale}
      dir={localeDir(locale)}
      data-input="pointer"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className="h-full antialiased"
    >
      <body className="min-h-full">
        <Script id="mmh-boot" strategy="beforeInteractive">
          {`(function(){try{document.documentElement.setAttribute('data-input','pointer');}catch(e){}})();`}
        </Script>
        {process.env.NODE_ENV === "development" ? (
          <Script id="mmh-hide-next-issue-badge" strategy="afterInteractive">
            {`(function(){function hide(){document.querySelectorAll('nextjs-portal').forEach(function(el){el.style.setProperty('display','none','important');});}hide();try{new MutationObserver(hide).observe(document.documentElement,{childList:true,subtree:true});}catch(e){}})();`}
          </Script>
        ) : null}
        {children}
      </body>
    </html>
  );
}
