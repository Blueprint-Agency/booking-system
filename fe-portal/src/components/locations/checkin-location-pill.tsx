"use client";
// FIXTURE-BACKED: reads static mock data from `@/data`, not the live backend.
import { useEffect, useState } from "react";
import { ChevronDown, MapPin } from "lucide-react";
import { locations as seedLocations } from "@/data";

const STORAGE_KEY = "ys.checkinLocationId";

export function CheckinLocationPill({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string) => void;
}) {
  const active = seedLocations.filter((l) => !l.archivedAt);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (value) return;
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (stored && active.some((l) => l.id === stored)) onChange(stored);
    else if (active[0]) onChange(active[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = active.find((l) => l.id === value) ?? null;

  function commit(id: string) {
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, id);
    onChange(id);
    setPending(null);
    setOpen(false);
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm hover:border-accent/40"
      >
        <MapPin className="h-3.5 w-3.5 text-muted" />
        <span className="font-medium text-ink">
          Checking in at: {current?.name ?? "Select a location"}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-muted" />
      </button>
      {open && !pending && (
        <div className="absolute z-30 mt-2 w-64 rounded-lg border border-border bg-card p-2 shadow-soft">
          {active.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => (l.id === value ? setOpen(false) : setPending(l.id))}
              className={`block w-full rounded px-3 py-2 text-left text-sm transition ${
                l.id === value ? "bg-paper text-ink" : "text-muted hover:bg-paper hover:text-ink"
              }`}
            >
              {l.name}
            </button>
          ))}
        </div>
      )}
      {pending && (
        <div className="absolute z-40 mt-2 w-72 rounded-lg border border-border bg-card p-3 shadow-soft">
          <p className="mb-3 text-sm text-ink">
            Switch to <strong>{active.find((l) => l.id === pending)?.name}</strong>?
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPending(null)}
              className="rounded px-3 py-1.5 text-sm text-muted hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => commit(pending)}
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
            >
              Switch
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
