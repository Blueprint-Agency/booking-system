"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AdminNav } from "./admin-nav";
import { AdminTopBar } from "./admin-topbar";
import { LocationGate } from "./location-gate";
import { useWorkspace } from "@/lib/workspace-context";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { loading, currentStaff } = useWorkspace();
  const router = useRouter();

  // Role-aware landing: instructors don't use the admin surface. Bounce them to
  // their own tree once their role is known (role lives in the BE, not the Clerk
  // token, so this can only happen client-side after /auth/me resolves). The BE
  // role gates remain the real security boundary.
  const isInstructor = currentStaff?.role === "instructor";
  useEffect(() => {
    if (isInstructor) router.replace("/instructor/schedule");
  }, [isInstructor, router]);

  if (loading || !currentStaff || isInstructor) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading workspace…
        </div>
      </div>
    );
  }

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
