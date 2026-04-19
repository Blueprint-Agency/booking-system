"use client";
import Link from "next/link";
import { Search } from "lucide-react";
import { Input, StatusBadge } from "@/components/ui";
import { useAdminState } from "@/lib/admin-state";
import { RoleSwitcherMenu } from "@/components/auth/role-switcher-menu";
import type { AdminRole } from "@/types";

export function AdminTopBar({ variant }: { variant: AdminRole }) {
  const studio = useAdminState((s) => s.studio);

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-medium text-ink hover:text-accent"
        >
          {studio.name}
        </Link>
        <StatusBadge status={variant} />
      </div>
      <div className="flex items-center gap-4">
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input placeholder="Search (Phase F)" disabled className="h-9 w-64 pl-9" />
        </div>
        <RoleSwitcherMenu />
      </div>
    </header>
  );
}
