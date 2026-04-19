import { AdminSidebar } from "./admin-sidebar";
import { AdminTopbar } from "./admin-topbar";
import { AuthGuard } from "./auth-guard";

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="min-h-screen flex bg-paper">
        <AdminSidebar />
        <div className="flex-1 min-w-0 flex flex-col">
          <AdminTopbar />
          <main className="flex-1 px-6 py-8 max-w-[1400px] w-full mx-auto">{children}</main>
        </div>
      </div>
    </AuthGuard>
  );
}
