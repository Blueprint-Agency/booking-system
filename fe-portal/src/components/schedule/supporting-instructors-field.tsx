"use client";
import { useEffect, useMemo } from "react";
import { Input, Label, Select } from "@/components/ui";
import { InstructorOption, type InstructorLeave } from "@/components/schedule/instructor-leave";
import type { CatalogInstructor } from "@/lib/catalog";

/**
 * Supporting instructors with their per-session pay: one row each, laid out like
 * the main instructor / main pay pair above it, plus a picker for the next one.
 * Serves class edit, PT edit and the new-class form.
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
  onLeave,
  startTime,
  disabled = false,
  saving = false,
}: {
  instructors: CatalogInstructor[];
  mainInstructorId: string;
  value: SupportingRow[];
  onChange: (rows: SupportingRow[]) => void;
  /** Who is away on the chosen date — greyed and labelled. A hint; see
   *  `instructor-leave`. Omitted (or empty) before a date is picked. */
  onLeave: InstructorLeave;
  /** The class's intended start, `HH:MM` — sharpens a half-day absence from a
   *  label into a greyed option. Omitted where the form has no time. */
  startTime?: string;
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
      <div className="space-y-3">
        {value.map((s, idx) => {
          const picked = instructors.find((i) => i.id === s.instructorId);
          const name = picked?.name ?? "Unknown";
          return (
            <div key={s.instructorId} className="grid gap-4 sm:grid-cols-2">
              <Select
                value={s.instructorId}
                aria-label={`Supporting instructor ${idx + 1}`}
                disabled={disabled || saving}
                onChange={(e) =>
                  onChange(
                    value.map((row) =>
                      row.instructorId === s.instructorId
                        ? { ...row, instructorId: e.target.value }
                        : row,
                    ),
                  )
                }
              >
                {picked ? (
                  <InstructorOption
                    instructor={picked}
                    onLeave={onLeave}
                    startTime={startTime}
                  />
                ) : (
                  <option value={s.instructorId}>{name}</option>
                )}
                {available.map((i) => (
                  <InstructorOption
                    key={i.id}
                    instructor={i}
                    onLeave={onLeave}
                    startTime={startTime}
                  />
                ))}
              </Select>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  placeholder="Optional"
                  aria-label={`${name} pay (S$)`}
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
                />
                <button
                  type="button"
                  disabled={disabled || saving}
                  onClick={() =>
                    onChange(value.filter((row) => row.instructorId !== s.instructorId))
                  }
                  className="shrink-0 text-muted hover:text-ink disabled:opacity-50"
                  aria-label={`Remove ${name}`}
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
        {!disabled && available.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              value=""
              aria-label="Add supporting instructor"
              disabled={saving}
              onChange={(e) => {
                const v = e.target.value;
                if (v) onChange([...value, { instructorId: v, pay: "" }]);
              }}
              className="text-muted"
            >
              <option value="">
                {value.length === 0 ? "+ Add supporting instructor" : "+ Add another"}
              </option>
              {available.map((i) => (
                <InstructorOption
                  key={i.id}
                  instructor={i}
                  onLeave={onLeave}
                  startTime={startTime}
                />
              ))}
            </Select>
          </div>
        )}
        {value.length === 0 && available.length === 0 && (
          <span className="text-xs text-muted">No additional instructors available.</span>
        )}
      </div>
    </div>
  );
}
