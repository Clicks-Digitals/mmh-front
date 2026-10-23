import { ForgotPasswordForm } from "@/components/forms/auth-forms";
import { noIndexMeta } from "@/lib/seo";
import { Suspense } from "react";

export const metadata = noIndexMeta("Reset your password");

export default function Page() {
  return (
    <div className="container-mmh py-10 md:py-16">
      <Suspense fallback={null}>
        <ForgotPasswordForm />
      </Suspense>
    </div>
  );
}
