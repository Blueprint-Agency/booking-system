"use client";
import Link from "next/link";
import { Search } from "lucide-react";
import { Input } from "@/components/ui";
import { AdminMobileNavTrigger } from "./admin-nav";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { DevRoleSwitcher } from "./dev-role-switcher";

export function AdminTopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-card/95 px-3 backdrop-blur sm:px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <AdminMobileNavTrigger />
        <Link
          href="/admin/schedule"
          className="hidden truncate text-sm font-medium text-ink hover:text-accent sm:block"
        >
          Yoga Sadhana
        </Link>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <WorkspaceSwitcher />
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            placeholder="Search clients, sessions…"
            disabled
            className="h-9 w-48 pl-9 lg:w-56"
          />
        </div>
        <DevRoleSwitcher />
      </div>
    </header>
  );
}
