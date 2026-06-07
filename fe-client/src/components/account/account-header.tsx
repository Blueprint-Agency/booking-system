"use client";

import { useUser } from "@clerk/nextjs";

function initialsOf(first?: string | null, last?: string | null, email?: string | null): string {
  const s = `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase();
  if (s) return s;
  return (email?.[0] ?? "Y").toUpperCase();
}

export function AccountHeader() {
  const { user, isLoaded } = useUser();

  const first = user?.firstName ?? "";
  const last = user?.lastName ?? "";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const name =
    `${first} ${last}`.trim() || (email ? email.split("@")[0] : "Member");
  const initials = initialsOf(first, last, email);

  return (
    <div className="flex items-center gap-4 lg:block lg:px-4 lg:pb-6 lg:border-b lg:border-ink/10">
      <div className="h-12 w-12 lg:h-16 lg:w-16 rounded-full bg-accent/20 flex items-center justify-center text-base lg:text-lg font-semibold text-accent-deep shrink-0">
        {isLoaded ? initials : ""}
      </div>
      <div className="min-w-0 lg:mt-4">
        <div className="text-sm font-semibold text-ink truncate">
          {isLoaded ? name : "Loading…"}
        </div>
        <div className="text-xs text-muted mt-0.5 truncate">
          {isLoaded ? email : ""}
        </div>
      </div>
    </div>
  );
}
