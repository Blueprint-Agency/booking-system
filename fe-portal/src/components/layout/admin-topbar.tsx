"use client";
import { UserButton } from "@clerk/nextjs";
import { AdminMobileNavTrigger } from "./admin-nav";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { DevRoleSwitcher } from "./dev-role-switcher";
import { NotificationBell } from "./notification-bell";

export function AdminTopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-card/95 px-3 backdrop-blur sm:px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <AdminMobileNavTrigger />
        <WorkspaceSwitcher />
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <NotificationBell />
        <DevRoleSwitcher />
        {/* Clerk-hosted account UI — staff manage their own password, email,
            and sessions from here. Sign-out also lives in this menu. On sign-out,
            Clerk redirects to the ClerkProvider's `signInUrl` (/login). */}
        <UserButton appearance={{ elements: { avatarBox: "h-8 w-8" } }} />
      </div>
    </header>
  );
}
