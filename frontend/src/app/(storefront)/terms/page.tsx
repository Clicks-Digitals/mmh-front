import { LegalPage, legalMetadata } from "@/server/legal-page";

export const metadata = legalMetadata("terms");

export default function Page() {
  return <LegalPage slug="terms" />;
}
