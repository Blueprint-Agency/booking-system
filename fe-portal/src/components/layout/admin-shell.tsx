"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ContentLoading } from "@/components/ui/content-loading";
import { AdminNav } from "./admin-nav";
import { AdminTopBar } from "./admin-topbar";
import { LocationGate } from "./location-gate";
import { useWorkspace } from "@/lib/workspace-context";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { loading, currentStaff } = useWorkspace();
  const router = useRouter();

  // Role-aware landing: instructors don't use the admin surface. Bounce them to
  // their own tree once their role is known (role lives in the BE, not the
  // session, so this can only happen client-side after /auth/me resolves). The BE
  // role gates remain the real security boundary.
  const isInstructor = currentStaff?.role === "instructor";
  useEffect(() => {
    if (isInstructor) router.replace("/instructor/schedule");
  }, [isInstructor, router]);

  // The nav and top bar draw straight away — in the server's HTML, before the
  // staff member is known — and only the page waits for them, so a first visit
  // paints the app rather than a blank screen.
  const ready = !loading && currentStaff !== null && !isInstructor;

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <div className="flex flex-1">
        <AdminNav />
        <div className="flex min-w-0 flex-1 flex-col">
          <AdminTopBar />
          <main className="flex-1 overflow-auto px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6">
            {ready ? (
              <LocationGate>{children}</LocationGate>
            ) : (
              <ContentLoading label="Loading workspace" />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
