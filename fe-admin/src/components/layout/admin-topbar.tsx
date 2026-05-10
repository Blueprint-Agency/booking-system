"use client";
import Link from "next/link";
import { Search } from "lucide-react";
import { Input } from "@/components/ui";

export function AdminTopBar() {
  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/schedule"
          className="text-sm font-medium text-ink hover:text-accent"
        >
          Yoga Sadhana
        </Link>
        <span className="rounded-full bg-paper px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted">
          Admin
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input placeholder="Search clients, sessions…" disabled className="h-9 w-64 pl-9" />
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border bg-paper px-3 py-1.5 text-xs">
          <div className="h-6 w-6 rounded-full bg-accent text-center text-[11px] font-semibold leading-6 text-white">
            L
          </div>
          <div className="leading-tight">
            <div className="font-medium text-ink">Lakshmi Iyer</div>
            <div className="text-muted">Admin</div>
          </div>
        </div>
      </div>
    </header>
  );
}
