"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const ROLES = [
  { key: "client", label: "Client", href: "/", color: "bg-accent" },
  { key: "admin", label: "Admin", href: "/admin", color: "bg-ink" },
  { key: "instructor", label: "Instructor", href: "/instructor", color: "bg-sage" },
  { key: "staff", label: "Staff", href: "/staff/check-in", color: "bg-info" },
] as const;

export function RoleSwitcher() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-[100]">
      {open && (
        <div className="absolute bottom-full right-0 mb-2 bg-card border border-border rounded-lg shadow-modal p-2 min-w-[160px] animate-fade-up">
          <p className="text-[10px] font-mono text-muted px-2 py-1 uppercase tracking-widest">
            Switch Role
          </p>
          {ROLES.map((role) => (
            <Link
              key={role.key}
              href={role.href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-2 py-2 text-sm font-medium text-ink rounded-sm hover:bg-warm transition-colors"
            >
              <span className={cn("w-2.5 h-2.5 rounded-full", role.color)} />
              {role.label}
            </Link>
          ))}
        </div>
      )}
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 px-4 py-2.5 bg-ink text-white text-xs font-medium",
          "rounded-full shadow-hover hover:bg-ink/90 transition-all duration-200",
          "font-mono uppercase tracking-wider"
        )}
      >
        <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
        Prototype
      </button>
    </div>
  );
}
