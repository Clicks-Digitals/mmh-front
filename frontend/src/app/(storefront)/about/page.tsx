import { LegalPage, legalMetadata } from "@/server/legal-page";

export const metadata = legalMetadata("about");

export default function Page() {
  return <LegalPage slug="about" />;
}
