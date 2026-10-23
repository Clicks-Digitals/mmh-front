import { DigitalProductDetail } from "@/components/product/digital-detail";
import { resolveStorefrontProduct } from "@/server/catalog/resolve";
import { pageMeta } from "@/lib/seo";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Script from "next/script";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await resolveStorefrontProduct(slug);
  if (!product) notFound();
  return {
    ...pageMeta(product.name, product.shortDescription, `/product/${slug}`),
    other: {
      "product:price:amount": String(product.priceJod),
      "product:price:currency": "JOD",
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await resolveStorefrontProduct(slug);
  if (!product) notFound();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    brand: product.brand,
    image: product.images.length > 0 ? product.images : undefined,
    offers: {
      "@type": "Offer",
      priceCurrency: "JOD",
      price: product.priceJod,
      availability: product.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  };
  return (
    <>
      <Script id="product-jsonld" type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <DigitalProductDetail product={product} />
    </>
  );
}
