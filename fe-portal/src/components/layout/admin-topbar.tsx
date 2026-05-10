"use client";
import Link from "next/link";
import { Search } from "lucide-react";
import { Input } from "@/components/ui";
import { AdminMobileNavTrigger } from "./admin-nav";

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
        <span className="hidden rounded-full bg-paper px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted sm:inline-flex">
          Admin
        </span>
      </div>
      <div className="flex items-center gap-2 sm:gap-4">
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            placeholder="Search clients, sessions…"
            disabled
            className="h-9 w-56 pl-9 lg:w-64"
          />
        </div>
        <button
          type="button"
          aria-label="Search"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-paper hover:text-ink md:hidden"
        >
          <Search className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2 rounded-full border border-border bg-paper px-2 py-1 text-xs sm:px-3 sm:py-1.5">
          <div className="h-6 w-6 rounded-full bg-accent text-center text-[11px] font-semibold leading-6 text-white">
            L
          </div>
          <div className="hidden leading-tight sm:block">
            <div className="font-medium text-ink">Lakshmi Iyer</div>
            <div className="text-muted">Admin</div>
          </div>
        </div>
      </div>
    </header>
  );
}
