import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta("Privacy", "How the current MMH storefront handles account, order, and browser data.", "/privacy");

export default function PrivacyPage() {
  return (
    <div className="container-mmh max-w-3xl py-10 text-sm leading-7 text-muted md:py-14">
      <h1 className="text-2xl font-semibold text-fg sm:text-3xl">Privacy</h1>
      <p className="mt-3 text-xs uppercase tracking-wide text-amber">Interim notice — requires final legal review before launch.</p>
      <div className="mt-6 space-y-4">
        <p>Cart, wishlist, and language preferences are stored in your browser. Registered account details and pending order records are stored by the MMH application.</p>
        <p>Checkout records your name, email, phone, selected products, and the customer fields required for those products. Sensitive order fields are masked in customer-facing history.</p>
        <p>Card details are entered on PayPal, not on MMH. MMH stores the PayPal order and capture identifiers needed to confirm payment and process refunds. Operational security and audit logs may record technical request information.</p>
      </div>
    </div>
  );
}
