import { ClientNav } from "@/components/layout/client-nav";
import { SiteFooter } from "@/components/layout/site-footer";
import { ScrollToTop } from "@/components/layout/scroll-to-top";

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-paper flex flex-col">
      <ScrollToTop />
      <ClientNav />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
