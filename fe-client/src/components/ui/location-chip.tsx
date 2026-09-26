import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { ALL_LOCATIONS } from "@/lib/package-coverage";

/**
 * What a package Covers, one chip per Location — or one "All locations" chip
 * for a Credit Bundle or Trial. The same row on the package shop and on the
 * Account's active packages, so a package answers "where can I use this?" in
 * the same place before and after it's bought.
 */
export function CoversRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <ul aria-label="Covers" className={cn("flex flex-wrap gap-1.5", className)}>
      {children}
    </ul>
  );
}

/** A Credit Bundle's or Trial's Covers row: one "All locations" chip. */
export function AllLocationsRow({ className }: { className?: string }) {
  return (
    <CoversRow className={className}>
      <LocationChip name={ALL_LOCATIONS} />
    </CoversRow>
  );
}

export function LocationChip({ name, until }: { name: string; until?: string | null }) {
  return (
    <li className="inline-flex max-w-full items-center gap-1 rounded-full border border-ink/10 bg-ink/[0.03] px-2 py-0.5 text-xs font-medium text-ink">
      <MapPin className="h-3 w-3 shrink-0 text-ink/40" aria-hidden />
      <span className="truncate">{name}</span>
      {until && <span className="shrink-0 text-muted">· until {until}</span>}
    </li>
  );
}
