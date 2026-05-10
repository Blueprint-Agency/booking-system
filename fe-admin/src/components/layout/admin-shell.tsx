import { AdminNav } from "./admin-nav";
import { AdminTopBar } from "./admin-topbar";

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <div className="flex flex-1">
        <AdminNav />
        <div className="flex min-w-0 flex-1 flex-col">
          <AdminTopBar />
          <main className="flex-1 overflow-auto px-8 py-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
