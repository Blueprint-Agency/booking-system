"use client";
import { useEffect, useMemo } from "react";
import { Label } from "@/components/ui";
import type { CatalogInstructor } from "@/lib/catalog";

/**
 * Supporting instructors with their per-session pay: a removable chip each, plus
 * a picker for the next one. Serves class edit, PT edit and the new-class form.
 *
 * The one rule it exists to hold: an instructor can never be both main and
 * supporting. The main pick is dropped from the options AND from the rows —
 * choosing a main who is already supporting removes the supporting row, rather
 * than letting the backend refuse the save with
 * `supporting_instructor_duplicates_main`.
 *
 * What is deliberately NOT a caller: the corporate scheduling dialog and the
 * workshop editor. Both carry bare instructor ids with no pay at all and lay
 * their rows out differently, so folding them in would mean a pay-optional,
 * layout-switching component — a wider interface than the duplication costs.
 */

export interface SupportingRow {
  instructorId: string;
  pay: string;
}

export function SupportingInstructorsField({
  instructors,
  mainInstructorId,
  value,
  onChange,
  disabled = false,
  saving = false,
}: {
  instructors: CatalogInstructor[];
  mainInstructorId: string;
  value: SupportingRow[];
  onChange: (rows: SupportingRow[]) => void;
  /** The event can't be edited at all (cancelled) — the picker is hidden. */
  disabled?: boolean;
  /** A save is in flight — the fields are frozen but stay visible. */
  saving?: boolean;
}) {
  const available = useMemo(
    () =>
      instructors.filter(
        (i) => i.id !== mainInstructorId && !value.some((s) => s.instructorId === i.id),
      ),
    [instructors, mainInstructorId, value],
  );

  // Drop any row that duplicates the main instructor.
  useEffect(() => {
    if (!mainInstructorId) return;
    if (value.some((s) => s.instructorId === mainInstructorId)) {
      onChange(value.filter((s) => s.instructorId !== mainInstructorId));
    }
  }, [mainInstructorId, value, onChange]);

  return (
    <div className="space-y-1.5 sm:col-span-2">
      <Label>Supporting instructors</Label>
      <div className="flex flex-wrap items-center gap-2">
        {value.map((s) => {
          const name = instructors.find((i) => i.id === s.instructorId)?.name ?? "Unknown";
          return (
            <span
              key={s.instructorId}
              className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 py-1 pl-2.5 pr-1.5 text-xs text-ink"
            >
              {name}
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                placeholder="S$"
                value={s.pay}
                disabled={disabled || saving}
                onChange={(e) =>
                  onChange(
                    value.map((row) =>
                      row.instructorId === s.instructorId
                        ? { ...row, pay: e.target.value }
                        : row,
                    ),
                  )
                }
                className="h-6 w-16 rounded border border-border bg-card px-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
              />
              <button
                type="button"
                disabled={disabled || saving}
                onClick={() =>
                  onChange(value.filter((row) => row.instructorId !== s.instructorId))
                }
                className="text-muted hover:text-ink disabled:opacity-50"
                aria-label={`Remove ${name}`}
              >
                ×
              </button>
            </span>
          );
        })}
        {!disabled && available.length > 0 && (
          <select
            value=""
            disabled={saving}
            onChange={(e) => {
              const v = e.target.value;
              if (v) onChange([...value, { instructorId: v, pay: "" }]);
            }}
            className="flex h-9 rounded-lg border border-border bg-card px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            <option value="">
              {value.length === 0 ? "+ Add supporting instructor" : "+ Add another"}
            </option>
            {available.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        )}
        {value.length === 0 && available.length === 0 && (
          <span className="text-xs text-muted">No additional instructors available.</span>
        )}
      </div>
    </div>
  );
}
