"use client";
import { useState, useRef, useEffect } from "react";
import { ChevronDown, LogOut, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui";
import { signOutPortal } from "@/lib/portal-auth";
import { runsStudio } from "@/lib/staff-role";
import { useWorkspace, STORAGE_KEY_LOC } from "@/lib/workspace-context";

/**
 * Top-right user menu. Was a demo "switch staff" affordance in the mockup;
 * now backed by the real staff session — clicking sign-out ends it and routes
 * back to /login.
 */
export function DevRoleSwitcher() {
  const { currentStaff } = useWorkspace();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (!currentStaff) return null;
  const profileHref = runsStudio(currentStaff.role) ? "/admin/profile" : "/instructor/profile";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex h-10 items-center gap-2 rounded-full border border-border bg-paper px-2 text-xs sm:h-auto sm:px-3 sm:py-1.5"
      >
        <Avatar
          name={currentStaff.name || currentStaff.email}
          src={currentStaff.photoUrl}
          size={24}
          className="text-[11px]"
        />
        <div className="hidden leading-tight sm:block">
          <div className="font-medium text-ink">{currentStaff.name}</div>
          <div className="text-muted capitalize">{currentStaff.role}</div>
        </div>
        <ChevronDown className="h-3.5 w-3.5 text-muted" />
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1 w-64 max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-card shadow-modal">
          <div className="border-b border-border px-3 py-2">
            <div className="truncate text-sm font-medium text-ink">{currentStaff.name}</div>
            <div className="truncate text-xs text-muted">{currentStaff.email}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted">
              {currentStaff.role}
            </div>
          </div>
          <ul className="p-1">
            <li>
              <Link
                href={profileHref}
                onClick={() => setOpen(false)}
                className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-paper"
              >
                <User className="h-4 w-4" /> My profile
              </Link>
            </li>
            <li>
              <button
                type="button"
                onClick={() => {
                  // Clear persisted workspace before tearing down the session so
                  // the next user on this browser starts clean.
                  if (typeof window !== "undefined") {
                    window.localStorage.removeItem(STORAGE_KEY_LOC);
                  }
                  void signOutPortal().finally(() => router.push("/login"));
                }}
                className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-paper"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
