"use client";
import { AdminMobileNavTrigger } from "./admin-nav";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { DevRoleSwitcher } from "./dev-role-switcher";

export function AdminTopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-card/95 px-3 backdrop-blur sm:px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <AdminMobileNavTrigger />
        <WorkspaceSwitcher />
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <DevRoleSwitcher />
      </div>
    </header>
  );
}
