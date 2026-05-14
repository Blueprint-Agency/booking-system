import { AdminNav } from "./admin-nav";
import { AdminTopBar } from "./admin-topbar";
import { LocationGate } from "./location-gate";

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <div className="flex flex-1">
        <AdminNav />
        <div className="flex min-w-0 flex-1 flex-col">
          <AdminTopBar />
          <main className="flex-1 overflow-auto px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6">
            <LocationGate>{children}</LocationGate>
          </main>
        </div>
      </div>
    </div>
  );
}
