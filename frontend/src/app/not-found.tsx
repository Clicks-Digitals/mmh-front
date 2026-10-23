import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { serverT } from "@/server/locale";

export default async function NotFound() {
  const { t } = await serverT();
  return (
    <div className="container-mmh flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <Logo />
      <h1 className="mt-8 text-2xl font-semibold sm:text-3xl">{t("notFound.title")}</h1>
      <p className="mt-3 max-w-md text-sm text-muted">{t("notFound.body")}</p>
      <Button className="mt-6" href="/shop">
        {t("notFound.cta")}
      </Button>
    </div>
  );
}
