import { LegalPage, legalMetadata } from "@/server/legal-page";

export const metadata = legalMetadata("digital-product-policy");

export default function Page() {
  return <LegalPage slug="digital-product-policy" />;
}
