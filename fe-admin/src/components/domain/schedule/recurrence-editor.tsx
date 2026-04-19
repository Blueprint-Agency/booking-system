"use client";

import { useEffect, useMemo, useState } from "react";
import { Input, Select, Label } from "@/components/ui";
import {
  WEEKDAY_OPTIONS,
  buildWeeklyRRule,
  formatRRule,
  parseRRule,
} from "@/lib/rrule";
import { cn } from "@/lib/utils";

type EndKind = "never" | "count" | "until";

export interface RecurrenceEditorProps {
  value: string | null;
  onChange: (rrule: string) => void;
}

function parseSafe(value: string | null): {
  days: number[];
  endKind: EndKind;
  count: number;
  until: string;
} {
  const empty = { days: [] as number[], endKind: "never" as EndKind, count: 12, until: "" };
  if (!value) return empty;
  try {
    const r = parseRRule(value);
    const opts = r.options;
    const byweekday = (opts.byweekday ?? []) as Array<{ weekday: number } | number>;
    const days = byweekday.map((w) => {
      const wd = typeof w === "number" ? w : w.weekday;
      return wd === 6 ? 0 : wd + 1;
    });
    let endKind: EndKind = "never";
    let count = 12;
    let until = "";
    if (opts.count) {
      endKind = "count";
      count = opts.count;
    } else if (opts.until) {
      endKind = "until";
      until = opts.until.toISOString().slice(0, 10);
    }
    return { days, endKind, count, until };
  } catch {
    return empty;
  }
}

export function RecurrenceEditor({ value, onChange }: RecurrenceEditorProps) {
  const initial = useMemo(() => parseSafe(value), [value]);
  const [days, setDays] = useState<number[]>(initial.days);
  const [endKind, setEndKind] = useState<EndKind>(initial.endKind);
  const [count, setCount] = useState<number>(initial.count);
  const [until, setUntil] = useState<string>(initial.until);

  useEffect(() => {
    if (days.length === 0) {
      onChange("");
      return;
    }
    const rrule = buildWeeklyRRule({
      days,
      count: endKind === "count" ? count : undefined,
      until: endKind === "until" && until ? new Date(`${until}T00:00:00Z`) : undefined,
    });
    onChange(rrule);
  }, [days, endKind, count, until, onChange]);

  const summary = useMemo(() => {
    if (days.length === 0) return "Pick at least one day";
    try {
      const r = parseRRule(
        buildWeeklyRRule({
          days,
          count: endKind === "count" ? count : undefined,
          until: endKind === "until" && until ? new Date(`${until}T00:00:00Z`) : undefined,
        }),
      );
      return formatRRule(r);
    } catch {
      return "—";
    }
  }, [days, endKind, count, until]);

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  return (
    <div className="space-y-4">
      <div>
        <Label>Repeats on</Label>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {WEEKDAY_OPTIONS.map((opt) => {
            const active = days.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleDay(opt.value)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "border-accent bg-accent text-white"
                    : "border-border bg-card text-muted hover:text-ink",
                )}
              >
                {opt.short}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <Label>Ends</Label>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Select value={endKind} onChange={(e) => setEndKind(e.target.value as EndKind)}>
            <option value="never">Never</option>
            <option value="count">After N occurrences</option>
            <option value="until">On date</option>
          </Select>
          {endKind === "count" && (
            <Input
              type="number"
              min={1}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              placeholder="Occurrences"
              className="col-span-2"
            />
          )}
          {endKind === "until" && (
            <Input
              type="date"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              className="col-span-2"
            />
          )}
        </div>
      </div>

      <div className="rounded-md border border-border bg-paper/40 px-3 py-2 text-xs text-muted">
        <span className="font-medium text-ink">Schedule:</span> {summary}
      </div>
    </div>
  );
}
