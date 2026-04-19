"use client";

import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  label: string;
  value: string;
  icon?: LucideIcon;
  delta?: number; // percent change
  hint?: string;
}

export function StatCard({ label, value, icon: Icon, delta, hint }: StatCardProps) {
  const positive = delta !== undefined && delta > 0;
  const negative = delta !== undefined && delta < 0;
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-muted" />}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-ink">{value}</div>
      {(delta !== undefined || hint) && (
        <div className="mt-1 flex items-center gap-2 text-xs">
          {delta !== undefined && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 tabular-nums",
                positive ? "text-sage" : negative ? "text-error" : "text-muted",
              )}
            >
              {positive ? <ArrowUp className="h-3 w-3" /> : negative ? <ArrowDown className="h-3 w-3" /> : null}
              {Math.abs(delta).toFixed(1)}%
            </span>
          )}
          {hint && <span className="text-muted">{hint}</span>}
        </div>
      )}
    </div>
  );
}
