"use client";
import { useState, useRef, useEffect } from "react";
import { ChevronDown, LogOut, User } from "lucide-react";
import { useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useWorkspace, STORAGE_KEY_LOC } from "@/lib/workspace-context";

/**
 * Top-right user menu. Was a demo "switch staff" affordance in the mockup;
 * now backed by the real Clerk session — clicking sign-out clears Clerk and
 * routes back to /login.
 */
export function DevRoleSwitcher() {
  const { currentStaff } = useWorkspace();
  const { signOut } = useClerk();
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
  const initial = currentStaff.name?.charAt(0) || currentStaff.email.charAt(0);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-full border border-border bg-paper px-2 py-1 text-xs sm:px-3 sm:py-1.5"
      >
        <div className="h-6 w-6 rounded-full bg-accent text-center text-[11px] font-semibold leading-6 text-white">
          {initial.toUpperCase()}
        </div>
        <div className="hidden leading-tight sm:block">
          <div className="font-medium text-ink">{currentStaff.name}</div>
          <div className="text-muted capitalize">{currentStaff.role}</div>
        </div>
        <ChevronDown className="h-3.5 w-3.5 text-muted" />
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1 w-64 rounded-lg border border-border bg-card shadow-modal">
          <div className="border-b border-border px-3 py-2">
            <div className="text-sm font-medium text-ink">{currentStaff.name}</div>
            <div className="truncate text-xs text-muted">{currentStaff.email}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted">
              {currentStaff.role}
            </div>
          </div>
          <ul className="p-1">
            <li>
              <button
                type="button"
                disabled
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-muted"
              >
                <User className="h-4 w-4" /> Account (v1)
              </button>
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
                  void signOut(() => router.push("/login"));
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-paper"
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
