import { cookies } from "next/headers";
import { ClientNav } from "@/components/layout/client-nav";
import { SiteFooter } from "@/components/layout/site-footer";
import { ScrollToTop } from "@/components/layout/scroll-to-top";
import { ClientPackagesProvider } from "@/lib/use-client-packages";
import { ImpersonationBanner } from "@/components/impersonation-banner";

export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const jar = await cookies();
  const impersonating = jar.has("__imp_grant");

  return (
    <ClientPackagesProvider>
      <ImpersonationBanner />
      <div className={`min-h-screen bg-paper flex flex-col ${impersonating ? "pt-10" : ""}`}>
        <ScrollToTop />
        <ClientNav impersonating={impersonating} />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </div>
    </ClientPackagesProvider>
  );
}
