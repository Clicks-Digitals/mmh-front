"use client";

import { createContext, useContext, type ReactNode } from "react";

/** Bundled defaults, shown until a picture is uploaded in Admin → Settings → Logo & home picture. */
export const DEFAULT_LOGO_URL = "/brand/IMG_4556.png";
export const DEFAULT_HERO_URL = "/home/hero-banner.jpg";

export interface BrandAssets {
  logoUrl: string;
  heroUrl: string;
}

const BrandAssetsContext = createContext<BrandAssets>({ logoUrl: DEFAULT_LOGO_URL, heroUrl: DEFAULT_HERO_URL });

export function BrandAssetsProvider({ value, children }: { value: Partial<BrandAssets>; children: ReactNode }) {
  return (
    <BrandAssetsContext.Provider
      value={{ logoUrl: value.logoUrl || DEFAULT_LOGO_URL, heroUrl: value.heroUrl || DEFAULT_HERO_URL }}
    >
      {children}
    </BrandAssetsContext.Provider>
  );
}

export function useBrandAssets(): BrandAssets {
  return useContext(BrandAssetsContext);
}
