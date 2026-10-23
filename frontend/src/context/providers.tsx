"use client";

import { CartProvider } from "@/context/cart-context";
import { LanguageProvider } from "@/context/language-context";
import { ToastProvider } from "@/context/toast-context";
import { UiProvider } from "@/context/ui-context";
import { WishlistProvider } from "@/context/wishlist-context";
import type { Locale } from "@/types";
import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

export function Providers({ children, locale = "en" }: { children: ReactNode; locale?: Locale }) {
  return (
    <SessionProvider refetchInterval={5 * 60} refetchOnWindowFocus>
      <LanguageProvider initialLocale={locale}>
        <ToastProvider>
          <UiProvider>
            <CartProvider>
              <WishlistProvider>{children}</WishlistProvider>
            </CartProvider>
          </UiProvider>
        </ToastProvider>
      </LanguageProvider>
    </SessionProvider>
  );
}
