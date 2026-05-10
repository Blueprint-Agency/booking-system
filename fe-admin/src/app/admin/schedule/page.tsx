"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Filter as FilterIcon,
} from "lucide-react";
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInMinutes,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { Button, PageHeader } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  buildScheduleEntries,
  instructorName,
  locationName,
} from "@/lib/schedule-helpers";
import { locations, instructors as allInstructors } from "@/data";
import { formatTime } from "@/lib/formatters";

type View = "day" | "week" | "month";
type FilterType = "all" | "class" | "workshop" | "pt";
type Entry = ReturnType<typeof buildScheduleEntries>[number];

const TODAY = new Date("2026-05-10");
const HOUR_START = 7;
const HOUR_END = 22;
const HOUR_HEIGHT = 56;
const TOTAL_HEIGHT = (HOUR_END - HOUR_START) * HOUR_HEIGHT;

export default function SchedulePage() {
  const [view, setView] = useState<View>("week");
  const [cursor, setCursor] = useState<Date>(TODAY);
  const [type, setType] = useState<FilterType>("all");
  const [locationId, setLocationId] = useState<string>("all");
  const [instructorId, setInstructorId] = useState<string>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const allEntries = useMemo(() => buildScheduleEntries(), []);

  const entries = useMemo(
    () =>
      allEntries.filter((e) => {
        if (type !== "all" && e.kind !== type) return false;
        if (locationId !== "all" && e.locationId !== locationId) return false;
        if (
          instructorId !== "all" &&
          !e.instructorIds.includes(instructorId)
        )
          return false;
        return true;
      }),
    [allEntries, type, locationId, instructorId]
  );

  const range = useMemo(() => getRange(view, cursor), [view, cursor]);
  const visibleEntries = useMemo(
    () =>
      entries.filter((e) => {
        const start = parseISO(e.startsAt);
        return start >= range.start && start < range.end;
      }),
    [entries, range]
  );

  const headingLabel =
    view === "day"
      ? format(cursor, "EEEE, d MMM yyyy")
      : view === "week"
        ? `${format(range.start, "d MMM")} – ${format(addDays(range.end, -1), "d MMM yyyy")}`
        : format(cursor, "MMMM yyyy");

  const filtersActive =
    type !== "all" || locationId !== "all" || instructorId !== "all";

  const navigate = (dir: -1 | 0 | 1) => {
    if (dir === 0) return setCursor(TODAY);
    if (view === "day") return setCursor(addDays(cursor, dir));
    if (view === "week") return setCursor(addWeeks(cursor, dir));
    return setCursor(addMonths(cursor, dir));
  };

  return (
    <div>
      <PageHeader
        title="Schedule"
        description="Unified timetable of classes, workshops, and confirmed private sessions."
        actions={
          <>
            <Link href="/admin/schedule/new/class">
              <Button variant="secondary" size="sm">
                <Plus className="h-4 w-4" /> Class
              </Button>
            </Link>
            <Link href="/admin/schedule/new/workshop">
              <Button size="sm">
                <Plus className="h-4 w-4" /> Workshop
              </Button>
            </Link>
          </>
        }
      />

      <div className="rounded-xl border border-border bg-card shadow-soft">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 border-b border-border p-3 sm:flex-row sm:items-center sm:gap-4 sm:p-4">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous"
              onClick={() => navigate(-1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate(0)}
            >
              Today
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next"
              onClick={() => navigate(1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="min-w-0 flex-1 truncate text-sm font-semibold text-ink sm:text-base">
            {headingLabel}
          </div>

          <div className="flex items-center gap-2">
            <ViewToggle value={view} onChange={setView} />
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium transition-colors",
                filtersActive
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "bg-card text-muted hover:text-ink"
              )}
              aria-expanded={filtersOpen}
            >
              <FilterIcon className="h-3.5 w-3.5" />
              Filters
              {filtersActive && (
                <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold text-white">
                  {[type !== "all", locationId !== "all", instructorId !== "all"].filter(Boolean).length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Filters row */}
        {filtersOpen && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-paper/50 p-3 text-xs">
            <FilterPill
              label="Type"
              value={type}
              options={[
                { val: "all", label: "All" },
                { val: "class", label: "Class" },
                { val: "workshop", label: "Workshop" },
                { val: "pt", label: "Private" },
              ]}
              onChange={(v) => setType(v as FilterType)}
            />
            <FilterPill
              label="Location"
              value={locationId}
              options={[
                { val: "all", label: "All" },
                ...locations.map((l) => ({ val: l.id, label: l.name })),
              ]}
              onChange={setLocationId}
            />
            <FilterPill
              label="Instructor"
              value={instructorId}
              options={[
                { val: "all", label: "All" },
                ...allInstructors
                  .filter((i) => !i.archivedAt)
                  .map((i) => ({ val: i.id, label: i.name })),
              ]}
              onChange={setInstructorId}
            />
            {filtersActive && (
              <button
                type="button"
                onClick={() => {
                  setType("all");
                  setLocationId("all");
                  setInstructorId("all");
                }}
                className="ml-auto text-xs font-medium text-muted hover:text-ink"
              >
                Clear all
              </button>
            )}
          </div>
        )}

        {/* Calendar surface */}
        <div className="overflow-x-auto">
          {view === "day" && (
            <DayView day={cursor} entries={visibleEntries} />
          )}
          {view === "week" && (
            <WeekView weekStart={range.start} entries={visibleEntries} />
          )}
          {view === "month" && (
            <MonthView monthStart={startOfMonth(cursor)} entries={visibleEntries} />
          )}
        </div>
      </div>

      <Legend />
    </div>
  );
}

function getRange(view: View, cursor: Date): { start: Date; end: Date } {
  if (view === "day") {
    const start = startOfDay(cursor);
    return { start, end: addDays(start, 1) };
  }
  if (view === "week") {
    const start = startOfWeek(cursor, { weekStartsOn: 1 });
    return { start, end: addDays(start, 7) };
  }
  // month: include leading/trailing days to fill 6 rows
  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = addDays(startOfWeek(monthEnd, { weekStartsOn: 1 }), 7 * 6);
  return { start: gridStart, end: gridEnd };
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function ViewToggle({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  const opts: { v: View; label: string }[] = [
    { v: "day", label: "Day" },
    { v: "week", label: "Week" },
    { v: "month", label: "Month" },
  ];
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-paper p-0.5">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={cn(
            "h-7 rounded px-3 text-xs font-medium transition-colors",
            value === o.v
              ? "bg-card text-ink shadow-soft"
              : "text-muted hover:text-ink"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function FilterPill({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { val: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent text-xs font-medium text-ink focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.val} value={o.val}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ---------- Day view ---------- */

function DayView({ day, entries }: { day: Date; entries: Entry[] }) {
  const dayEntries = entries.filter((e) => isSameDay(parseISO(e.startsAt), day));
  return (
    <div className="flex">
      <TimeGutter />
      <div className="relative min-w-0 flex-1 border-l border-border">
        <DayHeader day={day} />
        <div className="relative" style={{ height: TOTAL_HEIGHT }}>
          <HourLines />
          <NowIndicator day={day} />
          <EventLayer entries={dayEntries} dense={false} />
        </div>
      </div>
    </div>
  );
}

/* ---------- Week view ---------- */

function WeekView({ weekStart, entries }: { weekStart: Date; entries: Entry[] }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  return (
    <div className="flex min-w-[760px]">
      <TimeGutter />
      <div className="grid min-w-0 flex-1 grid-cols-7 border-l border-border">
        {days.map((day) => {
          const dayEntries = entries.filter((e) =>
            isSameDay(parseISO(e.startsAt), day)
          );
          return (
            <div
              key={day.toISOString()}
              className="relative border-r border-border last:border-r-0"
            >
              <DayHeader day={day} compact />
              <div className="relative" style={{ height: TOTAL_HEIGHT }}>
                <HourLines />
                <NowIndicator day={day} />
                <EventLayer entries={dayEntries} dense />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Month view ---------- */

function MonthView({ monthStart, entries }: { monthStart: Date; entries: Entry[] }) {
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: addDays(gridStart, 41) });
  return (
    <div>
      <div className="grid grid-cols-7 border-b border-border bg-paper/40">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div
            key={d}
            className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted sm:text-xs"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const inMonth = isSameMonth(day, monthStart);
          const today = isSameDay(day, TODAY);
          const dayEntries = entries
            .filter((e) => isSameDay(parseISO(e.startsAt), day))
            .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
          const visible = dayEntries.slice(0, 3);
          const overflow = dayEntries.length - visible.length;
          return (
            <div
              key={day.toISOString()}
              className={cn(
                "min-h-[88px] border-b border-r border-border p-1.5 last:border-r-0 sm:min-h-[120px] sm:p-2",
                !inMonth && "bg-paper/30",
                getDay(day) % 7 === 0 && "border-r-0"
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={cn(
                    "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                    today
                      ? "bg-accent text-white"
                      : inMonth
                        ? "text-ink"
                        : "text-muted"
                  )}
                >
                  {format(day, "d")}
                </span>
                {dayEntries.length > 0 && (
                  <span className="text-[10px] font-mono text-muted">
                    {dayEntries.length}
                  </span>
                )}
              </div>
              <ul className="space-y-1">
                {visible.map((e) => (
                  <li key={`${e.kind}-${e.id}`}>
                    <Link
                      href={`/admin/schedule/${e.kind}/${e.id}`}
                      className={cn(
                        "block truncate rounded-sm border-l-2 px-1.5 py-0.5 text-[11px] font-medium transition-colors hover:opacity-80",
                        kindClasses(e)
                      )}
                      title={`${formatTime(e.startsAt)} · ${e.label}`}
                    >
                      <span className="font-mono text-[10px] opacity-80">
                        {formatTime(e.startsAt).replace("m", "")}
                      </span>{" "}
                      <span className="truncate">{e.label}</span>
                    </Link>
                  </li>
                ))}
                {overflow > 0 && (
                  <li className="px-1 text-[10px] font-medium text-muted">
                    +{overflow} more
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Shared pieces ---------- */

function TimeGutter() {
  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);
  return (
    <div className="relative w-12 shrink-0 sm:w-14">
      <div className="h-10 border-b border-border" />
      <div style={{ height: TOTAL_HEIGHT }}>
        {hours.map((h, idx) => (
          <div
            key={h}
            className="relative border-b border-border/60"
            style={{ height: HOUR_HEIGHT }}
          >
            {idx > 0 && (
              <span className="absolute -top-2 right-2 font-mono text-[10px] text-muted">
                {formatHour(h)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DayHeader({ day, compact }: { day: Date; compact?: boolean }) {
  const today = isSameDay(day, TODAY);
  return (
    <div
      className={cn(
        "sticky top-0 z-10 flex h-10 items-center gap-2 border-b border-border bg-card px-2 sm:px-3",
        compact ? "justify-center" : "justify-start"
      )}
    >
      <span
        className={cn(
          "text-[10px] font-semibold uppercase tracking-wider",
          today ? "text-accent" : "text-muted"
        )}
      >
        {format(day, "EEE")}
      </span>
      <span
        className={cn(
          "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold",
          today ? "bg-accent text-white" : "text-ink"
        )}
      >
        {format(day, "d")}
      </span>
      {!compact && (
        <span className="text-xs text-muted">{format(day, "MMMM yyyy")}</span>
      )}
    </div>
  );
}

function HourLines() {
  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => i);
  return (
    <div className="pointer-events-none absolute inset-0">
      {hours.map((i) => (
        <div
          key={i}
          className="absolute left-0 right-0 border-t border-border/60"
          style={{ top: i * HOUR_HEIGHT }}
        />
      ))}
    </div>
  );
}

function NowIndicator({ day }: { day: Date }) {
  if (!isSameDay(day, TODAY)) return null;
  const now = TODAY;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const startMin = HOUR_START * 60;
  const endMin = HOUR_END * 60;
  if (minutes < startMin || minutes > endMin) return null;
  const top = ((minutes - startMin) / 60) * HOUR_HEIGHT;
  return (
    <div
      className="pointer-events-none absolute left-0 right-0 z-10"
      style={{ top }}
    >
      <div className="h-0.5 w-full bg-error" />
      <div className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-error" />
    </div>
  );
}

/* ---------- Event positioning ---------- */

function EventLayer({ entries, dense }: { entries: Entry[]; dense: boolean }) {
  const positioned = layoutEvents(entries);
  return (
    <div className="absolute inset-0">
      {positioned.map(({ entry, top, height, left, width }) => (
        <EventBlock
          key={`${entry.kind}-${entry.id}`}
          entry={entry}
          top={top}
          height={height}
          left={left}
          width={width}
          dense={dense}
        />
      ))}
    </div>
  );
}

interface PositionedEvent {
  entry: Entry;
  top: number;
  height: number;
  left: number;
  width: number;
}

function layoutEvents(entries: Entry[]): PositionedEvent[] {
  const sorted = [...entries].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt)
  );
  const out: PositionedEvent[] = [];
  let i = 0;
  while (i < sorted.length) {
    // collect overlap cluster
    const cluster: Entry[] = [sorted[i]];
    let clusterEnd = parseISO(sorted[i].endsAt).getTime();
    let j = i + 1;
    while (j < sorted.length) {
      const startMs = parseISO(sorted[j].startsAt).getTime();
      if (startMs < clusterEnd) {
        cluster.push(sorted[j]);
        clusterEnd = Math.max(clusterEnd, parseISO(sorted[j].endsAt).getTime());
        j++;
      } else break;
    }
    cluster.forEach((entry, idx) => {
      const pos = computeYBounds(entry);
      const colWidth = 100 / cluster.length;
      out.push({
        entry,
        top: pos.top,
        height: pos.height,
        left: idx * colWidth,
        width: colWidth,
      });
    });
    i = j;
  }
  return out;
}

function computeYBounds(entry: Entry): { top: number; height: number } {
  const start = parseISO(entry.startsAt);
  const end = parseISO(entry.endsAt);
  const startMin = start.getHours() * 60 + start.getMinutes();
  const offsetMin = startMin - HOUR_START * 60;
  const top = Math.max(0, (offsetMin / 60) * HOUR_HEIGHT);
  const durationMin = Math.max(15, differenceInMinutes(end, start));
  const height = Math.max(20, (durationMin / 60) * HOUR_HEIGHT);
  return { top, height };
}

function EventBlock({
  entry,
  top,
  height,
  left,
  width,
  dense,
}: {
  entry: Entry;
  top: number;
  height: number;
  left: number;
  width: number;
  dense: boolean;
}) {
  const subtitle =
    entry.kind === "pt"
      ? entry.instructorIds.map(instructorName).join(" & ")
      : `${entry.instructorIds.map(instructorName).join(" & ")} · ${locationName(entry.locationId)}`;

  const compact = height < 44;

  return (
    <Link
      href={`/admin/schedule/${entry.kind}/${entry.id}`}
      style={{
        top,
        height,
        left: `calc(${left}% + 2px)`,
        width: `calc(${width}% - 4px)`,
      }}
      className={cn(
        "absolute flex flex-col overflow-hidden rounded-md border-l-2 px-2 py-1 text-[11px] leading-tight shadow-soft transition-all hover:shadow-hover hover:z-10",
        kindClasses(entry),
        entry.eventState === "cancelled" && "opacity-60 line-through"
      )}
      title={`${formatTime(entry.startsAt)}–${formatTime(entry.endsAt)} · ${entry.label}`}
    >
      <div className="flex items-center gap-1 font-mono text-[10px] opacity-80">
        <span>{formatTime(entry.startsAt)}</span>
        {!compact && (
          <span className="opacity-60">–{formatTime(entry.endsAt)}</span>
        )}
      </div>
      <div className="truncate font-semibold">{entry.label}</div>
      {!compact && !dense && (
        <div className="mt-0.5 truncate opacity-80">{subtitle}</div>
      )}
      {!compact && (
        <div className="mt-auto flex items-center justify-between font-mono text-[10px] opacity-70">
          <span className="uppercase tracking-wider">{entry.kind}</span>
          <span>
            {entry.bookedCount}/{entry.capacity}
          </span>
        </div>
      )}
    </Link>
  );
}

function kindClasses(entry: Entry): string {
  if (entry.eventState === "cancelled") {
    return "bg-error/10 border-error text-error";
  }
  switch (entry.kind) {
    case "class":
      return "bg-cyan/15 border-cyan-deep text-cyan-deep hover:bg-cyan/25";
    case "workshop":
      return "bg-warning/15 border-warning text-warning hover:bg-warning/25";
    case "pt":
      return "bg-accent/10 border-accent text-accent hover:bg-accent/20";
  }
}

function formatHour(h: number): string {
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  if (h < 12) return `${h}am`;
  return `${h - 12}pm`;
}

/* ---------- Legend ---------- */

function Legend() {
  const items: { kind: Entry["kind"]; label: string }[] = [
    { kind: "class", label: "Class" },
    { kind: "workshop", label: "Workshop" },
    { kind: "pt", label: "Private session" },
  ];
  return (
    <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted">
      {items.map((i) => (
        <div key={i.kind} className="flex items-center gap-1.5">
          <span
            className={cn(
              "inline-block h-3 w-3 rounded-sm border-l-2",
              i.kind === "class" && "bg-cyan/15 border-cyan-deep",
              i.kind === "workshop" && "bg-warning/15 border-warning",
              i.kind === "pt" && "bg-accent/10 border-accent"
            )}
          />
          {i.label}
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-4 bg-error" />
        Now
      </div>
    </div>
  );
}
