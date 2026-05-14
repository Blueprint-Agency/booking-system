"use client";
import { useEffect, useState } from "react";
import { locations as seedLocations } from "@/data";

export function LocationFilterChips({
  storageKey,
  value,
  onChange,
}: {
  storageKey: string;
  value?: string | "all";
  onChange?: (v: string | "all") => void;
}) {
  const active = seedLocations.filter((l) => !l.archivedAt);
  const [internal, setInternal] = useState<string | "all">("all");
  const current = value ?? internal;

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
    if (stored) {
      const v = stored as string | "all";
      if (value === undefined) setInternal(v);
      onChange?.(v);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  function set(next: string | "all") {
    if (value === undefined) setInternal(next);
    onChange?.(next);
    if (typeof window !== "undefined") window.localStorage.setItem(storageKey, next);
  }

  if (active.length <= 1) {
    return (
      <div className="text-xs text-muted">
        All events at {active[0]?.name ?? "this studio"}
      </div>
    );
  }

  const chips: { id: string | "all"; label: string }[] = [
    { id: "all", label: "All locations" },
    ...active.map((l) => ({ id: l.id, label: l.name })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">Location</span>
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => set(c.id)}
          className={`rounded-full border px-3 py-1 text-xs transition ${
            current === c.id
              ? "border-accent bg-accent/10 text-ink"
              : "border-border bg-card text-muted hover:border-accent/40"
          }`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
