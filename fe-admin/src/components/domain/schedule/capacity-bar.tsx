"use client";

import { cn } from "@/lib/utils";

export interface CapacityBarProps {
  booked: number;
  capacity: number;
  waitlist?: number;
  className?: string;
}

export function CapacityBar({ booked, capacity, waitlist = 0, className }: CapacityBarProps) {
  const pct = capacity > 0 ? Math.min(100, Math.round((booked / capacity) * 100)) : 0;
  const overFull = booked > capacity;
  const nearFull = pct >= 80;

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center justify-between text-xs text-muted">
        <span className="tabular-nums">
          {booked} / {capacity} booked
          {waitlist > 0 && (
            <span className="ml-1 text-warning">+ {waitlist} waitlist</span>
          )}
        </span>
        <span
          className={cn(
            "font-mono tabular-nums",
            overFull ? "text-error" : nearFull ? "text-warning" : "text-muted",
          )}
        >
          {pct}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-paper">
        <div
          className={cn(
            "h-full transition-all",
            overFull ? "bg-error" : nearFull ? "bg-warning" : "bg-accent",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
