import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "MMH Admin", template: "%s · MMH Admin" },
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  // The panel is English-only; keep it LTR even when the storefront locale cookie is Arabic.
  return (
    <div lang="en" dir="ltr">
      {children}
    </div>
  );
}
