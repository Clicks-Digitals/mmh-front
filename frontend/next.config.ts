import type { NextConfig } from "next";

function mediaRemotePatterns(): NonNullable<NextConfig["images"]>["remotePatterns"] {
  const api = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "http://127.0.0.1:8000/api/v1";
  try {
    const u = new URL(api);
    const protocol = (u.protocol.replace(":", "") || "http") as "http" | "https";
    return [
      {
        protocol,
        hostname: u.hostname,
        ...(u.port ? { port: u.port } : {}),
        pathname: "/media/**",
      },
    ];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Hide the Next.js bottom-left "N" / Issues pill during local development.
  // Compile/runtime errors still appear in the terminal and browser console.
  devIndicators: false,
  // Allow both localhost and 127.0.0.1 for Next.js 16 dev asset/HMR access
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  experimental: {
    authInterrupts: true,
  },
  images: {
    formats: ["image/avif", "image/webp"],
    qualities: [75, 100],
    remotePatterns: mediaRemotePatterns(),
  },
  async redirects() {
    return [
      { source: "/category/gaming-pcs", destination: "/shop", permanent: false },
      { source: "/category/custom-pcs", destination: "/shop", permanent: false },
      { source: "/category/laptops", destination: "/shop", permanent: false },
      { source: "/category/playstation-5", destination: "/category/playstation", permanent: false },
      { source: "/category/playstation-controllers", destination: "/category/playstation", permanent: false },
      { source: "/category/playstation-accessories", destination: "/category/playstation", permanent: false },
      { source: "/category/pc-components", destination: "/shop", permanent: false },
      { source: "/category/graphics-cards", destination: "/shop", permanent: false },
      { source: "/category/processors", destination: "/shop", permanent: false },
      { source: "/category/motherboards", destination: "/shop", permanent: false },
      { source: "/category/ram", destination: "/shop", permanent: false },
      { source: "/category/ssd-storage", destination: "/shop", permanent: false },
      { source: "/category/monitors", destination: "/shop", permanent: false },
      { source: "/category/gaming-gear", destination: "/shop", permanent: false },
      { source: "/category/gaming-mice", destination: "/shop", permanent: false },
      { source: "/category/gaming-keyboards", destination: "/shop", permanent: false },
      { source: "/category/headsets", destination: "/shop", permanent: false },
      { source: "/category/microphones", destination: "/shop", permanent: false },
      { source: "/category/gaming-chairs", destination: "/shop", permanent: false },
      { source: "/category/streaming-equipment", destination: "/shop", permanent: false },
      { source: "/category/cables-accessories", destination: "/shop", permanent: false },
      { source: "/digital-cards", destination: "/game-top-ups", permanent: false },
      { source: "/shipping-returns", destination: "/digital-product-policy", permanent: false },
    ];
  },
};

export default nextConfig;
