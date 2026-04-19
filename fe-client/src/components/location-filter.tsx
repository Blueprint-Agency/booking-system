"use client";

import { cn } from "@/lib/utils";
import type { Location } from "@/types";

interface LocationFilterProps {
  locations: Location[];
  selected: string | "all";
  onChange: (id: string | "all") => void;
}

export function LocationFilter({ locations, selected, onChange }: LocationFilterProps) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-warm p-1">
      <button
        onClick={() => onChange("all")}
        className={cn(
          "px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 whitespace-nowrap",
          selected === "all" ? "bg-card text-ink shadow-soft" : "text-muted hover:text-ink"
        )}
      >
        All Locations
      </button>
      {locations.map((loc) => (
        <button
          key={loc.id}
          onClick={() => onChange(loc.id)}
          className={cn(
            "px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 whitespace-nowrap",
            selected === loc.id ? "bg-card text-ink shadow-soft" : "text-muted hover:text-ink"
          )}
        >
          {loc.shortName}
        </button>
      ))}
    </div>
  );
}
