import { ResetPasswordForm } from "@/components/forms/auth-forms";
import { noIndexMeta } from "@/lib/seo";
import { Suspense } from "react";

export const metadata = noIndexMeta("Set a new password");

export default function Page() {
  return (
    <div className="container-mmh py-10 md:py-16">
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
