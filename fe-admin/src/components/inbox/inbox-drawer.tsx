"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface InboxDrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}

export function InboxDrawer({ open, onClose, title, subtitle, children, actions }: InboxDrawerProps) {
  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-ink/30 transition-opacity",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
      />
      <aside
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-xl transition-transform",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        <header className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-ink">{title}</div>
            {subtitle && <div className="mt-0.5 text-xs text-muted">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted hover:bg-paper hover:text-ink"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {actions && (
          <footer className="flex items-center justify-end gap-2 border-t border-border bg-paper/40 px-5 py-3">
            {actions}
          </footer>
        )}
      </aside>
    </>
  );
}
