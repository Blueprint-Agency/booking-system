"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { InstructorNav, InstructorMobileNavTrigger } from "./instructor-nav";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { DevRoleSwitcher } from "./dev-role-switcher";
import { useWorkspace } from "@/lib/workspace-context";

function InstructorTopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-card/95 px-3 backdrop-blur sm:px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <InstructorMobileNavTrigger />
        <WorkspaceSwitcher />
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <DevRoleSwitcher />
      </div>
    </header>
  );
}

export function InstructorShell({ children }: { children: React.ReactNode }) {
  const { loading, currentStaff } = useWorkspace();
  const router = useRouter();

  // Admins/superadmins don't use the instructor surface — send them to /admin.
  // (Role lives in the BE, not the Clerk token, so this resolves client-side.)
  const isStaffAdmin =
    currentStaff?.role === "admin" || currentStaff?.role === "superadmin";
  useEffect(() => {
    if (isStaffAdmin) router.replace("/admin/schedule");
  }, [isStaffAdmin, router]);

  if (loading || !currentStaff || isStaffAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <div className="flex flex-1">
        <InstructorNav />
        <div className="flex min-w-0 flex-1 flex-col">
          <InstructorTopBar />
          <main className="flex-1 overflow-auto px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
