import { ClientNav } from "@/components/layout/client-nav";
import { RoleSwitcher } from "@/components/layout/role-switcher";

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-paper flex flex-col">
      <ClientNav />
      <main className="flex-1">{children}</main>
      <RoleSwitcher />
    </div>
  );
}
