"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  MousePointerClick,
  ChevronLeft,
  ChevronRight,
  Filter as FilterIcon,
  Loader2,
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
import { formatTime } from "@/lib/formatters";
import { localDay } from "@/lib/local-day";
import { PtRequestPickerDialog } from "@/components/schedule/pt-request-picker-dialog";
import { CorporateRequestPickerDialog } from "@/components/schedule/corporate-request-picker-dialog";
import { useWorkspace } from "@/lib/workspace-context";
import { useSchedule, type ScheduleEntry } from "@/lib/use-schedule";
import type { Slot } from "@/lib/schedule";

type View = "day" | "week" | "month";
type AddKind = "class" | "corporate" | "pt";
type FilterType = "all" | "class" | "workshop" | "pt" | "corporate";
type Entry = ScheduleEntry;
type Resolver = {
  instructorName: (id: string) => string;
  locationName: (id: string | null) => string;
};

interface ApiInstructor {
  id: string;
  name: string;
  status: "pending" | "active" | "archived";
  archived_at: string | null;
}

const TODAY = new Date();
const HOUR_START = 6;
const HOUR_END = 24;
const HOUR_HEIGHT = 72;
const SLOT_MINUTES = 30;
const SLOT_HEIGHT = (HOUR_HEIGHT * SLOT_MINUTES) / 60;
const SLOT_COUNT = ((HOUR_END - HOUR_START) * 60) / SLOT_MINUTES;
const TOTAL_HEIGHT = (HOUR_END - HOUR_START) * HOUR_HEIGHT;

const ADD_KINDS: { kind: AddKind; label: string }[] = [
  { kind: "class", label: "Class" },
  { kind: "corporate", label: "Corporate" },
  { kind: "pt", label: "PT Session" },
];

export default function SchedulePage() {
  const router = useRouter();
  const { api, activeLocationId, accessibleLocations } = useWorkspace();
  const [view, setView] = useState<View>("week");
  const [cursor, setCursor] = useState<Date>(TODAY);
  const [type, setType] = useState<FilterType>("all");
  const [instructorId, setInstructorId] = useState<string>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Picking a "+ …" button arms the grid: slots light up on hover and the next
  // click chooses when the thing goes. Nothing is placeable until then.
  const [addMode, setAddMode] = useState<AddKind | null>(null);
  const [pickedSlot, setPickedSlot] = useState<Slot | null>(null);

  const [instructorsList, setInstructorsList] = useState<ApiInstructor[]>([]);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void (async () => {
      try {
        const ins = await api.get<{ instructors: ApiInstructor[] }>(
          "/portal/admin/instructors",
        );
        if (cancelled) return;
        setInstructorsList(ins.instructors);
      } catch {
        // Names degrade to "Unknown" if the catalog fetch fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const instructorById = useMemo(
    () => new Map(instructorsList.map((i) => [i.id, i.name])),
    [instructorsList],
  );
  const locationById = useMemo(
    () => new Map(accessibleLocations.map((l) => [l.id, l.name])),
    [accessibleLocations],
  );
  const resolver = useMemo<Resolver>(
    () => ({
      instructorName: (id) => instructorById.get(id) ?? "Unknown",
      locationName: (id) => (id ? (locationById.get(id) ?? "Unknown") : "—"),
    }),
    [instructorById, locationById],
  );

  const filterInstructors = useMemo(
    () =>
      instructorsList.filter(
        (i) => i.status === "active" && !i.archived_at,
      ),
    [instructorsList],
  );

  const range = useMemo(() => getRange(view, cursor), [view, cursor]);

  const { entries: allEntries, loading, error, reload } = useSchedule({
    from: range.start.toISOString(),
    to: range.end.toISOString(),
    locationId: activeLocationId ?? undefined,
  });

  const entries = useMemo(
    () =>
      allEntries.filter((e) => {
        if (type !== "all" && e.kind !== type) return false;
        if (
          instructorId !== "all" &&
          !e.instructorIds.includes(instructorId)
        )
          return false;
        return true;
      }),
    [allEntries, type, instructorId]
  );

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

  const filtersActive = type !== "all" || instructorId !== "all";

  const clearAdd = () => {
    setAddMode(null);
    setPickedSlot(null);
  };

  // A class is created on its own page; PT and corporate sessions are scheduled
  // from an existing request, so the slot seeds their picker dialog instead.
  const pickSlot = (slot: Slot) => {
    if (addMode === "class") {
      clearAdd();
      router.push(
        `/admin/schedule/new/class?date=${slot.date}&start=${slot.start}&end=${slot.end}`,
      );
      return;
    }
    setPickedSlot(slot);
  };

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
        actions={ADD_KINDS.map((k) => (
          <Button
            key={k.kind}
            variant={addMode === k.kind ? "primary" : "secondary"}
            size="sm"
            aria-pressed={addMode === k.kind}
            onClick={() => setAddMode(addMode === k.kind ? null : k.kind)}
          >
            <Plus className="h-4 w-4" /> {k.label}
          </Button>
        ))}
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
                  {[type !== "all", instructorId !== "all"].filter(Boolean).length}
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
                { val: "corporate", label: "Corporate" },
              ]}
              onChange={(v) => setType(v as FilterType)}
            />
            <FilterPill
              label="Instructor"
              value={instructorId}
              options={[
                { val: "all", label: "All" },
                ...filterInstructors.map((i) => ({ val: i.id, label: i.name })),
              ]}
              onChange={setInstructorId}
            />
            {filtersActive && (
              <button
                type="button"
                onClick={() => {
                  setType("all");
                  setInstructorId("all");
                }}
                className="ml-auto text-xs font-medium text-muted hover:text-ink"
              >
                Clear all
              </button>
            )}
          </div>
        )}

        {addMode && (
          <div className="flex items-center gap-2 border-b border-accent/30 bg-accent/[0.07] px-3 py-2 text-xs font-medium text-accent">
            <MousePointerClick className="h-3.5 w-3.5 shrink-0" />
            Click a slot on the grid to place the new{" "}
            {ADD_KINDS.find((k) => k.kind === addMode)?.label.toLowerCase()}.
            <button
              type="button"
              onClick={() => setAddMode(null)}
              className="ml-auto font-semibold underline underline-offset-2"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Calendar surface — day/week scroll internally so the toolbar and day
            headers stay put across the 6am–12am range. */}
        <div
          className={cn(
            "relative overflow-auto",
            view !== "month" && "max-h-[calc(100vh-16rem)] min-h-[420px]"
          )}
        >
          {error && (
            <div className="border-b border-error/30 bg-error/5 px-4 py-2 text-xs text-error">
              Failed to load schedule: {error}
            </div>
          )}
          {loading && allEntries.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading schedule…
            </div>
          ) : (
            <>
              {view === "day" && (
                <DayView
                  day={cursor}
                  entries={visibleEntries}
                  resolver={resolver}
                  onPickSlot={addMode ? pickSlot : null}
                />
              )}
              {view === "week" && (
                <WeekView
                  weekStart={range.start}
                  entries={visibleEntries}
                  resolver={resolver}
                  onPickSlot={addMode ? pickSlot : null}
                />
              )}
              {view === "month" && (
                <MonthView
                  monthStart={startOfMonth(cursor)}
                  entries={visibleEntries}
                  onPickDay={addMode ? (d) => pickSlot(daySlot(d)) : null}
                />
              )}
            </>
          )}
        </div>
      </div>

      <Legend />

      {addMode === "pt" && pickedSlot && (
        <PtRequestPickerDialog
          slot={pickedSlot}
          onClose={clearAdd}
          onScheduled={() => {
            clearAdd();
            void reload();
          }}
        />
      )}

      {addMode === "corporate" && pickedSlot && (
        <CorporateRequestPickerDialog
          slot={pickedSlot}
          onClose={clearAdd}
          onScheduled={() => {
            clearAdd();
            void reload();
          }}
        />
      )}
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

function DayView({
  day,
  entries,
  resolver,
  onPickSlot,
}: {
  day: Date;
  entries: Entry[];
  resolver: Resolver;
  onPickSlot: ((slot: Slot) => void) | null;
}) {
  const dayEntries = entries.filter((e) => isSameDay(parseISO(e.startsAt), day));
  return (
    <div className="flex">
      <TimeGutter />
      <div className="relative min-w-0 flex-1 border-l border-border">
        <DayHeader day={day} />
        <div className="relative" style={{ height: TOTAL_HEIGHT }}>
          {onPickSlot && <SlotLayer day={day} onPick={onPickSlot} />}
          <HourLines />
          <NowIndicator day={day} />
          <EventLayer entries={dayEntries} dense={false} resolver={resolver} />
        </div>
      </div>
    </div>
  );
}

/* ---------- Week view ---------- */

function WeekView({
  weekStart,
  entries,
  resolver,
  onPickSlot,
}: {
  weekStart: Date;
  entries: Entry[];
  resolver: Resolver;
  onPickSlot: ((slot: Slot) => void) | null;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  return (
    <div className="flex min-w-[760px]">
      <TimeGutter />
      <div className="grid min-w-0 flex-1 grid-cols-7 border-l border-border">
        {days.map((day) => {
          const dayEntries = entries.filter((e) =>
            isSameDay(parseISO(e.startsAt), day)
          );
          const today = isSameDay(day, TODAY);
          return (
            <div
              key={day.toISOString()}
              className={cn(
                "relative border-r border-border last:border-r-0",
                today && "bg-accent/[0.03]"
              )}
            >
              <DayHeader day={day} compact />
              <div className="relative" style={{ height: TOTAL_HEIGHT }}>
                {onPickSlot && <SlotLayer day={day} onPick={onPickSlot} />}
                <HourLines />
                <NowIndicator day={day} />
                <EventLayer entries={dayEntries} dense resolver={resolver} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Month view ---------- */

function MonthView({
  monthStart,
  entries,
  onPickDay,
}: {
  monthStart: Date;
  entries: Entry[];
  onPickDay: ((day: Date) => void) | null;
}) {
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
                "relative min-h-[88px] border-b border-r border-border p-1.5 last:border-r-0 sm:min-h-[120px] sm:p-2",
                !inMonth && "bg-paper/30",
                getDay(day) % 7 === 0 && "border-r-0"
              )}
            >
              {onPickDay && (
                // Month cells carry no time, so picking one seeds the default
                // hour and the form takes it from there.
                <button
                  type="button"
                  onClick={() => onPickDay(day)}
                  title={`${format(day, "EEE d MMM")}`}
                  className="group absolute inset-0 z-20 flex items-center justify-center transition-colors hover:bg-accent/15 focus-visible:bg-accent/20 focus-visible:outline-none"
                >
                  <span className="pointer-events-none flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-white opacity-0 shadow-soft transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    <Plus className="h-3 w-3" />
                    {format(day, "d MMM")}
                  </span>
                </button>
              )}
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
                  <span className="rounded-full bg-paper px-1.5 text-[10px] font-semibold tabular-nums text-muted">
                    {dayEntries.length}
                  </span>
                )}
              </div>
              <ul className="space-y-1">
                {visible.map((e) => (
                  <li key={`${e.kind}-${e.id}`}>
                    <Link
                      href={`/admin/schedule/${e.kind}/${e.kind === "workshop" ? e.raw.id : e.id}`}
                      className={cn(
                        "flex items-center gap-1 truncate rounded-sm border-l-[3px] px-1.5 py-1 text-[11px] font-semibold text-ink transition-all hover:-translate-y-px hover:shadow-sm",
                        kindClasses(e)
                      )}
                      title={`${formatTime(e.startsAt)} · ${e.label}`}
                    >
                      <span className="shrink-0 text-[10px] font-bold tabular-nums text-ink/60">
                        {formatTime(e.startsAt).replace("m", "")}
                      </span>
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
  const hours = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
  return (
    <div className="sticky left-0 z-30 w-14 shrink-0 border-r border-border bg-paper sm:w-16">
      <div className="sticky top-0 z-10 h-11 border-b border-border bg-paper" />
      <div className="relative" style={{ height: TOTAL_HEIGHT }}>
        {hours.map((h, idx) => (
          <div
            key={h}
            className={cn(
              "absolute right-0 flex w-full items-center justify-end gap-1 pr-1.5",
              // The first and last labels sit flush against the edges so they
              // are not clipped; the rest straddle their hour line.
              idx === 0 ? "top-0" : idx === hours.length - 1 ? "bottom-0" : "-translate-y-1/2"
            )}
            style={idx > 0 && idx < hours.length - 1 ? { top: idx * HOUR_HEIGHT } : undefined}
          >
            <span className="text-[11px] font-semibold tabular-nums text-ink/70">
              {formatHour(h)}
            </span>
            <span className="h-px w-1.5 bg-border" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Half-hour hit targets, rendered only while a "+ …" button has armed the grid.
 * It sits above the events so a slot that already holds a class can still be
 * picked — whether that double-books is the service's call, not the grid's.
 */
function SlotLayer({ day, onPick }: { day: Date; onPick: (slot: Slot) => void }) {
  const dateIso = localDay(day);
  return (
    <div className="absolute inset-0 z-40">
      {Array.from({ length: SLOT_COUNT }, (_, i) => {
        const minutes = HOUR_START * 60 + i * SLOT_MINUTES;
        const slot: Slot = {
          date: dateIso,
          start: hhmm(minutes),
          // The late slots would run past midnight — clamp so the prefilled end
          // stays a real `HH:MM` the form's time input accepts.
          end: hhmm(Math.min(minutes + 60, 24 * 60 - 1)),
        };
        return (
          <button
            key={slot.start}
            type="button"
            onClick={() => onPick(slot)}
            title={`${format(day, "EEE d MMM")} · ${formatSlot(minutes)}`}
            className="group absolute left-0 right-0 flex items-center justify-center transition-colors hover:bg-accent/15 focus-visible:bg-accent/20 focus-visible:outline-none"
            style={{ top: i * SLOT_HEIGHT, height: SLOT_HEIGHT }}
          >
            <span className="pointer-events-none flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-white opacity-0 shadow-soft transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <Plus className="h-3 w-3" />
              {formatSlot(minutes)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function hhmm(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** A day picked from month view carries no time — seed a mid-morning hour. */
function daySlot(day: Date): Slot {
  return { date: localDay(day), start: "09:00", end: "10:00" };
}

function formatSlot(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h < 12 ? "am" : "pm";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${pad(m)}${suffix}`;
}

function DayHeader({ day, compact }: { day: Date; compact?: boolean }) {
  const today = isSameDay(day, TODAY);
  return (
    <div
      className={cn(
        "sticky top-0 z-20 flex h-11 items-center gap-2 border-b border-border px-2 sm:px-3",
        today ? "bg-accent/[0.06]" : "bg-card",
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
  return (
    <div className="pointer-events-none absolute inset-0">
      {Array.from({ length: SLOT_COUNT + 1 }, (_, i) => (
        <div
          key={i}
          className={cn(
            "absolute left-0 right-0 border-t",
            i % 2 === 0 ? "border-border" : "border-dashed border-border/50"
          )}
          style={{ top: i * SLOT_HEIGHT }}
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
      className="pointer-events-none absolute left-0 right-0 z-30"
      style={{ top }}
    >
      <div className="h-0.5 w-full bg-error" />
      <div className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-error" />
    </div>
  );
}

/* ---------- Event positioning ---------- */

function EventLayer({
  entries,
  dense,
  resolver,
}: {
  entries: Entry[];
  dense: boolean;
  resolver: Resolver;
}) {
  const positioned = layoutEvents(entries);
  return (
    // Transparent to the pointer so the empty-slot links underneath stay clickable.
    <div className="pointer-events-none absolute inset-0">
      {positioned.map(({ entry, top, height, left, width }) => (
        <EventBlock
          key={`${entry.kind}-${entry.id}`}
          entry={entry}
          top={top}
          height={height}
          left={left}
          width={width}
          dense={dense}
          resolver={resolver}
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
  resolver,
}: {
  entry: Entry;
  top: number;
  height: number;
  left: number;
  width: number;
  dense: boolean;
  resolver: Resolver;
}) {
  const instructors =
    entry.kind === "corporate"
      ? entry.mainInstructorId
        ? resolver.instructorName(entry.mainInstructorId)
        : ""
      : entry.instructorIds.map(resolver.instructorName).join(" & ");
  const subtitle =
    entry.kind === "pt"
      ? instructors
      : entry.kind === "corporate"
        ? `${entry.subtitle} · ${resolver.locationName(entry.locationId)}`
        : `${instructors} · ${resolver.locationName(entry.locationId)}`;

  // Row budget at 72px/hour: a 30 min block fits the title alone, 45 min adds
  // the time row, and an hour is enough for the footer and the subtitle.
  const tiny = height < 40;
  const showFooter = height >= 56;
  const showSubtitle = height >= HOUR_HEIGHT && !dense;
  const linkId = entry.kind === "workshop" ? entry.raw.id : entry.id;
  const dayChip =
    entry.kind === "workshop" && entry.dayCount > 1
      ? `Day ${entry.dayIndex}/${entry.dayCount}`
      : null;
  const tooltipInstructor =
    entry.kind === "corporate" && entry.mainInstructorId
      ? ` · ${resolver.instructorName(entry.mainInstructorId)}`
      : "";
  const kind = KIND[entry.kind];

  return (
    <Link
      href={`/admin/schedule/${entry.kind}/${linkId}`}
      style={{
        top,
        height,
        left: `calc(${left}% + 2px)`,
        width: `calc(${width}% - 4px)`,
      }}
      className={cn(
        "pointer-events-auto absolute z-10 flex flex-col overflow-hidden rounded-md border border-l-4 px-2 py-1 leading-snug shadow-sm transition-all duration-150 hover:z-20 hover:-translate-y-px hover:shadow-hover",
        kindClasses(entry),
        entry.eventState === "cancelled" && "opacity-70"
      )}
      title={`${formatTime(entry.startsAt)}–${formatTime(entry.endsAt)} · ${entry.label}${tooltipInstructor}`}
    >
      <div className="flex items-start gap-1.5">
        <span
          className={cn(
            "truncate text-[12px] font-bold tracking-tight text-ink",
            entry.eventState === "cancelled" && "line-through",
            tiny && "text-[11px]"
          )}
        >
          {entry.label}
        </span>
        {tiny && (
          <span className="ml-auto shrink-0 text-[10px] font-semibold tabular-nums text-ink/60">
            {formatTime(entry.startsAt)}
          </span>
        )}
        {dayChip && !tiny && (
          <span className={cn("shrink-0 rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide text-white", kind.solid)}>
            {dayChip}
          </span>
        )}
      </div>

      {!tiny && (
        <div className="text-[11px] font-medium tabular-nums text-ink/65">
          {formatTime(entry.startsAt)} – {formatTime(entry.endsAt)}
        </div>
      )}

      {showSubtitle && subtitle && (
        <div className="truncate text-[11px] text-ink/60">{subtitle}</div>
      )}

      {showFooter && (
        <div className="mt-auto flex shrink-0 items-center justify-between gap-1 pt-0.5">
          {/* Narrow week columns have no room for both, so they drop the kind
              (the colour already encodes it) and keep the instructor. Day view
              keeps both until the subtitle row takes the instructor over. */}
          <span className="flex min-w-0 items-center gap-1">
            {!(dense && instructors && !showSubtitle) && (
              <span
                className={cn(
                  "shrink-0 text-[10px] font-bold uppercase tracking-[0.06em]",
                  kind.text
                )}
              >
                {kind.label}
              </span>
            )}
            {instructors && !showSubtitle && (
              <span className="truncate text-[10px] font-medium text-ink/70">
                {instructors}
              </span>
            )}
          </span>
          {entry.capacity !== null && entry.bookedCount !== null && (
            <span className="shrink-0 rounded bg-ink/[0.07] px-1 text-[10px] font-bold tabular-nums text-ink/75">
              {entry.bookedCount}/{entry.capacity}
            </span>
          )}
        </div>
      )}
    </Link>
  );
}

const KIND: Record<
  Entry["kind"],
  { label: string; chip: string; text: string; solid: string; swatch: string }
> = {
  class: {
    label: "Class",
    chip: "bg-cyan/20 border-cyan-deep/40 border-l-cyan-deep hover:bg-cyan/30",
    text: "text-cyan-deep",
    solid: "bg-cyan-deep",
    swatch: "bg-cyan/20 border-cyan-deep",
  },
  workshop: {
    label: "Workshop",
    chip: "bg-warning/20 border-warning/40 border-l-warning hover:bg-warning/30",
    text: "text-warning",
    solid: "bg-warning",
    swatch: "bg-warning/20 border-warning",
  },
  pt: {
    label: "Private",
    chip: "bg-accent/12 border-accent/30 border-l-accent hover:bg-accent/20",
    text: "text-accent",
    solid: "bg-accent",
    swatch: "bg-accent/12 border-accent",
  },
  corporate: {
    label: "Corporate",
    chip: "bg-sage/20 border-sage/40 border-l-sage hover:bg-sage/30",
    text: "text-sage",
    solid: "bg-sage",
    swatch: "bg-sage/20 border-sage",
  },
};

function kindClasses(entry: Entry): string {
  if (entry.eventState === "cancelled") {
    return "bg-error/10 border-error/40 border-l-error hover:bg-error/15";
  }
  return KIND[entry.kind].chip;
}

function formatHour(h: number): string {
  if (h === 0 || h === 24) return "12am";
  if (h === 12) return "12pm";
  if (h < 12) return `${h}am`;
  return `${h - 12}pm`;
}

/* ---------- Legend ---------- */

function Legend() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted">
      {(Object.keys(KIND) as Entry["kind"][]).map((k) => (
        <div key={k} className="flex items-center gap-1.5">
          <span
            className={cn("inline-block h-3 w-3 rounded-sm border-l-2", KIND[k].swatch)}
          />
          {KIND[k].label}
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-4 bg-error" />
        Now
      </div>
      <div className="ml-auto text-[11px] text-muted">
        Tip: hit “+ Class”, “+ Corporate”, or “+ PT Session”, then click the slot it belongs in.
      </div>
    </div>
  );
}
