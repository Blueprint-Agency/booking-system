"use client";

import { useAppUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";

/** The signed-in member's picture, name and email. */
export function AccountHeader({ size = "md" }: { size?: "md" | "lg" }) {
  const { user, isLoaded } = useAppUser();

  const first = user?.firstName ?? "";
  const last = user?.lastName ?? "";
  const email = user?.email ?? "";
  const name =
    `${first} ${last}`.trim() || (email ? email.split("@")[0] : "Member");
  const avatarClass = cn("bg-accent text-inverse", size === "lg" ? "h-14 w-14 text-lg" : "h-11 w-11 text-sm");

  return (
    <div className="flex items-center gap-3 min-w-0">
      {isLoaded ? (
        <Avatar name={`${first} ${last}`} email={email} photoUrl={user?.photoUrl} className={avatarClass} />
      ) : (
        <span className={cn("rounded-full shrink-0", avatarClass)} aria-hidden />
      )}
      <div className="min-w-0">
        <div className={cn("font-bold text-ink truncate", size === "lg" ? "text-base" : "text-sm")}>
          {isLoaded ? name : "Loading…"}
        </div>
        <div className="text-xs text-muted truncate">{isLoaded ? email : ""}</div>
      </div>
    </div>
  );
}
