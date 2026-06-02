import { cookies } from "next/headers";
import { AppShell } from "@/components/layout/app-shell";
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
        <AppShell impersonating={impersonating}>{children}</AppShell>
      </div>
    </ClientPackagesProvider>
  );
}
