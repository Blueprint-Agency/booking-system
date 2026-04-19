"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface InboxRowProps {
  primary: ReactNode;
  secondary?: ReactNode;
  meta?: ReactNode;
  badges?: ReactNode;
  onClick?: () => void;
  active?: boolean;
}

export function InboxRow({ primary, secondary, meta, badges, onClick, active }: InboxRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-paper/60",
        active && "bg-paper"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-ink">
          {primary}
          {badges}
        </div>
        {secondary && <div className="mt-0.5 truncate text-xs text-muted">{secondary}</div>}
      </div>
      {meta && <div className="shrink-0 text-xs text-muted">{meta}</div>}
    </button>
  );
}
