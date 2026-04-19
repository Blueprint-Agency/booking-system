"use client";

import { useMockState } from "@/lib/mock-state";

function initialsOf(first: string, last: string): string {
  const s = `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase();
  return s || "G";
}

export function AccountHeader() {
  const { user } = useMockState();
  const name = user ? `${user.firstName} ${user.lastName}`.trim() || "Guest" : "Guest";
  const email = user?.email ?? "Not signed in";
  const initials = user ? initialsOf(user.firstName, user.lastName) : "G";

  return (
    <div className="flex items-center gap-4 lg:block lg:px-4 lg:pb-6 lg:border-b lg:border-ink/10">
      <div className="h-12 w-12 lg:h-16 lg:w-16 rounded-full bg-accent/20 flex items-center justify-center text-base lg:text-lg font-semibold text-accent-deep shrink-0">
        {initials}
      </div>
      <div className="min-w-0 lg:mt-4">
        <div className="text-sm font-semibold text-ink truncate">{name}</div>
        <div className="text-xs text-muted mt-0.5 truncate">{email}</div>
      </div>
    </div>
  );
}
