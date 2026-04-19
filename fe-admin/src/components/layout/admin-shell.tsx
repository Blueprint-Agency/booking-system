"use client";
import type { AdminRole } from "@/types";
import { AdminNav } from "./admin-nav";
import { AdminTopBar } from "./admin-topbar";
import { ImpersonateBanner } from "./impersonate-banner";

export function AdminShell({
  variant,
  children,
}: {
  variant: AdminRole;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <ImpersonateBanner />
      <div className="flex flex-1">
        <AdminNav variant={variant} />
        <div className="flex min-w-0 flex-1 flex-col">
          <AdminTopBar variant={variant} />
          <main className="flex-1 overflow-auto px-8 py-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
