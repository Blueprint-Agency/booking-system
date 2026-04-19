"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface InboxTab {
  key: string;
  label: string;
  count?: number;
}

interface InboxShellProps {
  tabs: InboxTab[];
  defaultTab?: string;
  children: (activeTab: string) => ReactNode;
}

export function InboxShell({ tabs, defaultTab, children }: InboxShellProps) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.key ?? "");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1 border-b border-border">
        {tabs.map((t) => {
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className={cn(
                "border-b-2 px-3 py-2 text-sm transition-colors",
                isActive
                  ? "border-accent font-medium text-accent"
                  : "border-transparent text-muted hover:text-ink"
              )}
            >
              {t.label}
              {t.count !== undefined && (
                <span className="ml-2 inline-flex min-w-[20px] justify-center rounded-full bg-paper px-1.5 py-0.5 text-[11px] font-semibold text-ink">
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div>{children(active)}</div>
    </div>
  );
}
