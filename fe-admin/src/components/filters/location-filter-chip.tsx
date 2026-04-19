"use client";

import { useAdminState } from "@/lib/admin-state";
import { cn } from "@/lib/utils";

interface LocationFilterChipProps {
  value: string | null;
  onChange: (locationId: string | null) => void;
}

export function LocationFilterChip({ value, onChange }: LocationFilterChipProps) {
  const locations = useAdminState((s) => s.locations);

  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-border bg-card p-0.5 text-xs">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={cn(
          "rounded px-2.5 py-1 transition-colors",
          value === null ? "bg-accent/10 font-medium text-accent" : "text-muted hover:text-ink"
        )}
      >
        All locations
      </button>
      {locations.map((loc) => (
        <button
          key={loc.id}
          type="button"
          onClick={() => onChange(loc.id)}
          className={cn(
            "rounded px-2.5 py-1 transition-colors",
            value === loc.id ? "bg-accent/10 font-medium text-accent" : "text-muted hover:text-ink"
          )}
        >
          {loc.shortName}
        </button>
      ))}
    </div>
  );
}
