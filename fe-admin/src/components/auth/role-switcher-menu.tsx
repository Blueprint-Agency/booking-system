"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ShieldCheck, Briefcase, GraduationCap, LogOut } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { useCurrentUser, signInAs, signOut } from "@/lib/admin-auth";
import { Avatar } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { AdminRole } from "@/types";

const ROLE_ROUTE: Record<AdminRole, string> = {
  super: "/superadmin",
  admin: "/admin/dashboard",
  instructor: "/instructor",
};

const ROLE_LABEL: Record<AdminRole, string> = {
  super: "Super-admin",
  admin: "Studio admin",
  instructor: "Instructor",
};

const ROLE_ICON: Record<AdminRole, typeof ShieldCheck> = {
  super: ShieldCheck,
  admin: Briefcase,
  instructor: GraduationCap,
};

export function RoleSwitcherMenu() {
  const router = useRouter();
  const user = useCurrentUser();
  const users = useAdminState((s) => s.adminUsers);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const pick = (targetUser: typeof users[number]) => {
    signInAs(targetUser.id);
    setOpen(false);
    router.push(ROLE_ROUTE[targetUser.role]);
  };

  const handleSignOut = () => {
    signOut();
    setOpen(false);
    router.push("/");
  };

  // One representative user per role for the picker
  const oneOfEach: Record<AdminRole, typeof users[number] | undefined> = {
    super: users.find((u) => u.role === "super"),
    admin: users.find((u) => u.role === "admin"),
    instructor: users.find((u) => u.role === "instructor"),
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-sm hover:bg-paper"
      >
        {user ? (
          <>
            <Avatar name={user.name} size={24} />
            <div className="hidden text-left md:block">
              <div className="text-xs font-medium text-ink">{user.name}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted">{ROLE_LABEL[user.role]}</div>
            </div>
          </>
        ) : (
          <span className="text-xs text-muted">Sign in</span>
        )}
        <ChevronDown className="h-3.5 w-3.5 text-muted" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-border bg-card p-1 shadow-lg">
          <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Switch identity
          </div>
          {(["admin", "instructor"] as AdminRole[]).map((role) => {
            const u = oneOfEach[role];
            if (!u) return null;
            const Icon = ROLE_ICON[role];
            const isCurrent = user?.id === u.id;
            return (
              <button
                key={role}
                type="button"
                onClick={() => pick(u)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-paper",
                  isCurrent && "bg-accent/10"
                )}
              >
                <Icon className="h-4 w-4 text-muted" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-ink">{u.name}</div>
                  <div className="text-[11px] text-muted">{ROLE_LABEL[role]}</div>
                </div>
                {isCurrent && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">Active</span>
                )}
              </button>
            );
          })}
          {user && (
            <>
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                onClick={handleSignOut}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-muted hover:bg-paper"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
