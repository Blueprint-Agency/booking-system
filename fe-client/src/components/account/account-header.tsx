"use client";

import { useAppUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

function initialsOf(first?: string | null, last?: string | null, email?: string | null): string {
  const s = `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase();
  if (s) return s;
  return (email?.[0] ?? "Y").toUpperCase();
}

/** The signed-in member's avatar, name and email. */
export function AccountHeader({ size = "md" }: { size?: "md" | "lg" }) {
  const { user, isLoaded } = useAppUser();

  const first = user?.firstName ?? "";
  const last = user?.lastName ?? "";
  const email = user?.email ?? "";
  const name =
    `${first} ${last}`.trim() || (email ? email.split("@")[0] : "Member");
  const initials = initialsOf(first, last, email);

  return (
    <div className="flex items-center gap-3 min-w-0">
      <div
        className={cn(
          "rounded-full bg-accent text-inverse flex items-center justify-center font-bold shrink-0",
          size === "lg" ? "h-14 w-14 text-lg" : "h-11 w-11 text-sm",
        )}
      >
        {isLoaded ? initials : ""}
      </div>
      <div className="min-w-0">
        <div className={cn("font-bold text-ink truncate", size === "lg" ? "text-base" : "text-sm")}>
          {isLoaded ? name : "Loading…"}
        </div>
        <div className="text-xs text-muted truncate">{isLoaded ? email : ""}</div>
      </div>
    </div>
  );
}
