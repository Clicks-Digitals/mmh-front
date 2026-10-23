import { auth } from "@/auth";
import { redirect } from "next/navigation";

export async function requireCustomer(callbackUrl = "/account") {
  const session = await auth();
  if (!session?.user?.id || session.user.kind !== "CUSTOMER" || !session.user.accessToken) redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  return session.user;
}
