"use client";
import { useState } from "react";
import Link from "next/link";
import { Plus, Repeat } from "lucide-react";
import { useStudioZone } from "@/components/brand/brand-provider";
import { cn } from "@/lib/utils";
import { formatPlainDay, formatTime } from "@/lib/formatters";
import { localDay } from "@/lib/local-day";
import { minutesFromMidnight, startsOnDay, type GridView } from "@/lib/schedule-grid";
import { addDays, isoWeekday, localDate, startOfMonth, startOfWeek } from "@/lib/studio-time";
import type { ScheduleEntry } from "@/lib/use-schedule";
import type { Slot } from "@/lib/schedule";
import { waitingTag } from "@/lib/class-waitlist";

/**
 * The timetable's day, week and month grids, drawn for both portals: the
 * Admin's whole-studio Schedule and an Instructor's My schedule. What differs
 * between them comes in through `CalendarResolver` (whose names to print and
 * where an entry opens) and whether the grid can be armed to pick a slot.
 */

type View = GridView;
type Entry = ScheduleEntry;

export interface CalendarResolver {
  instructorName: (id: string) => string;
  locationName: (id: string | null) => string;
  /** Where an entry opens, or null when this viewer has no page for it. */
  href: (entry: Entry) => string | null;
}

/**
 * Today on the studio's clock. Every day this grid draws, every "today"
 * highlight and the now line are the studio's, not the browser's.
 */
function useToday(): string {
  return localDay(useStudioZone());
}

const HOUR_START = 6;
const HOUR_END = 24;
const HOUR_HEIGHT = 72;
const SLOT_MINUTES = 30;
const SLOT_HEIGHT = (HOUR_HEIGHT * SLOT_MINUTES) / 60;
const SLOT_COUNT = ((HOUR_END - HOUR_START) * 60) / SLOT_MINUTES;
const TOTAL_HEIGHT = (HOUR_END - HOUR_START) * HOUR_HEIGHT;

/**
 * The grid for one view. `onPickSlot` arms it: slots light up and the next
 * click picks when the new thing goes (a month cell picks its day at a default
 * hour). Unarmed, a month cell opens its day in day view.
 */
export function ScheduleCalendar({
  view,
  cursor,
  weekStart,
  entries,
  resolver,
  onPickSlot,
  onOpenDay,
}: {
  view: View;
  cursor: string;
  /** The first day the week view draws (`gridDays(view, cursor).first`). */
  weekStart: string;
  entries: Entry[];
  resolver: CalendarResolver;
  onPickSlot: ((slot: Slot) => void) | null;
  onOpenDay: (day: string) => void;
}) {
  return (
    <>
      {view === "day" && (
        <DayView day={cursor} entries={entries} resolver={resolver} onPickSlot={onPickSlot} />
      )}
      {view === "week" && (
        <WeekView weekStart={weekStart} entries={entries} resolver={resolver} onPickSlot={onPickSlot} />
      )}
      {view === "month" && (
        <MonthView
          monthStart={startOfMonth(cursor)}
          entries={entries}
          resolver={resolver}
          onPickDay={onPickSlot ? (d) => onPickSlot(daySlot(d)) : null}
          onOpenDay={onOpenDay}
        />
      )}
    </>
  );
}

const GRID_VIEW_OPTIONS: readonly { v: View; label: string }[] = [
  { v: "day", label: "Day" },
  { v: "week", label: "Week" },
  { v: "month", label: "Month" },
];

/**
 * Day, week, month — or `options`, for a timetable with a view of its own
 * beside the grids (My schedule's List).
 */
export function ViewToggle<V extends string = View>({
  value,
  onChange,
  options,
}: {
  value: V;
  onChange: (v: V) => void;
  options?: readonly { v: V; label: string }[];
}) {
  const opts = options ?? (GRID_VIEW_OPTIONS as readonly { v: string; label: string }[] as readonly { v: V; label: string }[]);
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-paper p-0.5">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          aria-pressed={value === o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            "h-8 rounded px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:h-7",
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

/**
 * The week around the open day, one tap per day — day view's quick way across
 * the week, which matters most on a phone where day view is the default.
 */
export function WeekStrip({ day, onPick }: { day: string; onPick: (d: string) => void }) {
  const todayKey = useToday();
  const start = startOfWeek(day);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div
      role="group"
      aria-label="Days this week"
      className="grid grid-cols-7 gap-1 border-b border-border bg-paper/40 px-2 py-2 sm:px-3"
    >
      {days.map((d) => {
        const selected = d === day;
        const today = d === todayKey;
        return (
          <button
            key={d}
            type="button"
            onClick={() => onPick(d)}
            aria-pressed={selected}
            aria-label={formatPlainDay(d, "EEEE d MMMM")}
            className={cn(
              "flex min-h-11 flex-col items-center justify-center rounded-lg text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              selected
                ? "bg-accent text-white shadow-soft"
                : today
                  ? "bg-accent/10 text-accent hover:bg-accent/15"
                  : "text-ink hover:bg-card",
            )}
          >
            <span
              className={cn(
                "text-[10px] font-semibold uppercase tracking-wider",
                selected ? "text-white/80" : "text-muted",
              )}
            >
              {formatPlainDay(d, "EEEEE")}
              <span className="hidden sm:inline">{formatPlainDay(d, "EEE").slice(1)}</span>
            </span>
            <span className="font-semibold tabular-nums">{formatPlainDay(d, "d")}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Day view ---------- */

function DayView({
  day,
  entries,
  resolver,
  onPickSlot,
}: {
  day: string;
  entries: Entry[];
  resolver: CalendarResolver;
  onPickSlot: ((slot: Slot) => void) | null;
}) {
  const timezone = useStudioZone();
  const dayEntries = entries.filter((e) => startsOnDay(timezone, e.startsAt, day));
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
  weekStart: string;
  entries: Entry[];
  resolver: CalendarResolver;
  onPickSlot: ((slot: Slot) => void) | null;
}) {
  const timezone = useStudioZone();
  const todayKey = useToday();
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  return (
    <div className="flex min-w-[760px]">
      <TimeGutter />
      <div className="grid min-w-0 flex-1 grid-cols-7 border-l border-border">
        {days.map((day) => {
          const dayEntries = entries.filter((e) => startsOnDay(timezone, e.startsAt, day));
          const today = day === todayKey;
          return (
            <div
              key={day}
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
  resolver,
  onPickDay,
  onOpenDay,
}: {
  monthStart: string;
  entries: Entry[];
  resolver: CalendarResolver;
  onPickDay: ((day: string) => void) | null;
  onOpenDay: (day: string) => void;
}) {
  const timezone = useStudioZone();
  const todayKey = useToday();
  const gridStart = startOfWeek(monthStart);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  return (
    // On a phone seven cells can't hold event chips, so each cell shows its date
    // and a count, and a tap opens the day. From `sm` up the chips come back.
    <div>
      <div className="grid grid-cols-7 border-b border-border bg-paper/40">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div
            key={d}
            className="px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted sm:px-2 sm:text-left sm:text-xs"
          >
            <span className="sm:hidden">{d.slice(0, 1)}</span>
            <span className="hidden sm:inline">{d}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const inMonth = day.slice(0, 7) === monthStart.slice(0, 7);
          const today = day === todayKey;
          const dayEntries = entries
            .filter((e) => startsOnDay(timezone, e.startsAt, day))
            .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
          const visible = dayEntries.slice(0, 3);
          const overflow = dayEntries.length - visible.length;
          return (
            <div
              key={day}
              className={cn(
                "relative min-h-[64px] border-b border-r border-border p-1 last:border-r-0 sm:min-h-[120px] sm:p-2",
                !inMonth && "bg-paper/30",
                isoWeekday(day) === 7 && "border-r-0"
              )}
            >
              {onPickDay ? (
                // Month cells carry no time, so picking one seeds the default
                // hour and the form takes it from there.
                <button
                  type="button"
                  onClick={() => onPickDay(day)}
                  title={formatPlainDay(day, "EEE d MMM")}
                  className="group absolute inset-0 z-20 flex items-center justify-center transition-colors hover:bg-accent/15 focus-visible:bg-accent/20 focus-visible:outline-none"
                >
                  <span className="pointer-events-none flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-white opacity-0 shadow-soft transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    <Plus className="h-3 w-3" />
                    {formatPlainDay(day, "d MMM")}
                  </span>
                </button>
              ) : (
                // Unarmed, the cell opens that day. It sits under the content,
                // which lets clicks fall through to it except on the chips.
                <button
                  type="button"
                  onClick={() => onOpenDay(day)}
                  aria-label={`Open ${formatPlainDay(day, "EEEE d MMMM")}`}
                  className="absolute inset-0 z-0 transition-colors hover:bg-accent/[0.06] focus-visible:bg-accent/10 focus-visible:outline-none"
                />
              )}
              <div className="pointer-events-none relative mb-1 flex flex-col items-center gap-1 sm:flex-row sm:justify-between">
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
                  {formatPlainDay(day, "d")}
                </span>
                {dayEntries.length > 0 && (
                  <span className="rounded-full bg-paper px-1.5 text-[10px] font-semibold tabular-nums text-muted">
                    {dayEntries.length}
                  </span>
                )}
              </div>
              <ul className="pointer-events-none relative hidden space-y-1 sm:block">
                {visible.map((e) => {
                  const href = resolver.href(e);
                  const chip = cn(
                    "flex items-center gap-1 truncate rounded-sm border-l-[3px] px-1.5 py-1 text-[11px] font-semibold text-ink",
                    kindClasses(e)
                  );
                  const body = (
                    <>
                      <span className="shrink-0 text-[10px] font-bold tabular-nums text-ink/60">
                        {formatTime(timezone, e.startsAt).replace("m", "")}
                      </span>
                      <span className="truncate">{e.label}</span>
                      {e.kind === "class" && e.seriesId && <SeriesMark />}
                    </>
                  );
                  const title = `${formatTime(timezone, e.startsAt)} · ${e.label}`;
                  return (
                    <li key={`${e.kind}-${e.id}`}>
                      {href ? (
                        <Link
                          href={href}
                          className={cn(
                            chip,
                            "pointer-events-auto transition-all hover:-translate-y-px hover:shadow-sm"
                          )}
                          title={title}
                        >
                          {body}
                        </Link>
                      ) : (
                        // No page to open: the chip lets clicks through to the
                        // cell, which opens the day.
                        <div className={chip} title={title}>
                          {body}
                        </div>
                      )}
                    </li>
                  );
                })}
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
function SlotLayer({ day, onPick }: { day: string; onPick: (slot: Slot) => void }) {
  const dateIso = day;
  return (
    <div className="absolute inset-0 z-40">
      {Array.from({ length: SLOT_COUNT }, (_, i) => {
        const minutes = HOUR_START * 60 + i * SLOT_MINUTES;
        const slot: Slot = {
          date: dateIso,
          start: minutesToHhmm(minutes),
          // The late slots would run past midnight — clamp so the prefilled end
          // stays a real `HH:MM` the form's time input accepts.
          end: minutesToHhmm(Math.min(minutes + 60, 24 * 60 - 1)),
        };
        return (
          <button
            key={slot.start}
            type="button"
            onClick={() => onPick(slot)}
            title={`${formatPlainDay(day, "EEE d MMM")} · ${formatSlot(minutes)}`}
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

/** Minutes from midnight as the `HH:MM` a `<input type="time">` accepts. */
function minutesToHhmm(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** A day picked from month view carries no time — seed a mid-morning hour. */
function daySlot(day: string): Slot {
  return { date: day, start: "09:00", end: "10:00" };
}

function formatSlot(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h < 12 ? "am" : "pm";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${pad(m)}${suffix}`;
}

function DayHeader({ day, compact }: { day: string; compact?: boolean }) {
  const today = day === useToday();
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
        {formatPlainDay(day, "EEE")}
      </span>
      <span
        className={cn(
          "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold",
          today ? "bg-accent text-white" : "text-ink"
        )}
      >
        {formatPlainDay(day, "d")}
      </span>
      {!compact && (
        <span className="text-xs text-muted">{formatPlainDay(day, "MMMM yyyy")}</span>
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

function NowIndicator({ day }: { day: string }) {
  const timezone = useStudioZone();
  // Read once on mount, as the grid has always done: the line is where "now"
  // was when the page opened.
  const [now] = useState(() => Date.now());
  if (day !== localDate(timezone, now)) return null;
  const minutes = minutesFromMidnight(timezone, now);
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
  resolver: CalendarResolver;
}) {
  const timezone = useStudioZone();
  const positioned = layoutEvents(timezone, entries);
  return (
    // Transparent to the pointer: the chips take their own clicks, and an armed
    // SlotLayer sits above this to claim the gaps between them.
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

/**
 * Packs a day's events into side-by-side columns. A chain of staggered classes
 * (9:30, 9:45, 10:15, 11:00 …) is one overlap group, but it only needs as many
 * columns as classes actually run at once — so each event takes the first
 * column that is free by its start, then widens right across any columns that
 * stay free for its whole length.
 */
function layoutEvents(timezone: string, entries: Entry[]): PositionedEvent[] {
  const items = entries
    .map((entry) => ({
      entry,
      start: Date.parse(entry.startsAt),
      end: Date.parse(entry.endsAt),
      col: 0,
    }))
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const out: PositionedEvent[] = [];
  let group: typeof items = [];
  let groupEnd = -Infinity;

  const flush = () => {
    const colEnds: number[] = [];
    for (const item of group) {
      const free = colEnds.findIndex((end) => end <= item.start);
      item.col = free === -1 ? colEnds.length : free;
      colEnds[item.col] = item.end;
    }
    const cols = colEnds.length;
    for (const item of group) {
      let span = 1;
      while (
        item.col + span < cols &&
        !group.some(
          (o) =>
            o.col === item.col + span && o.start < item.end && o.end > item.start
        )
      ) {
        span++;
      }
      const pos = computeYBounds(timezone, item.entry);
      out.push({
        entry: item.entry,
        top: pos.top,
        height: pos.height,
        left: (item.col / cols) * 100,
        width: (span / cols) * 100,
      });
    }
    group = [];
  };

  for (const item of items) {
    if (item.start >= groupEnd) flush();
    group.push(item);
    groupEnd = Math.max(groupEnd, item.end);
  }
  flush();
  return out;
}

function computeYBounds(timezone: string, entry: Entry): { top: number; height: number } {
  // Down the column by the studio's wall clock, from the studio's midnight.
  const startMin = minutesFromMidnight(timezone, entry.startsAt);
  const offsetMin = startMin - HOUR_START * 60;
  const top = Math.max(0, (offsetMin / 60) * HOUR_HEIGHT);
  const elapsedMin = Math.trunc((Date.parse(entry.endsAt) - Date.parse(entry.startsAt)) / 60_000);
  const durationMin = Math.max(15, elapsedMin);
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
  resolver: CalendarResolver;
}) {
  const timezone = useStudioZone();
  const instructors =
    entry.kind === "corporate"
      ? entry.mainInstructorId
        ? resolver.instructorName(entry.mainInstructorId)
        : ""
      : entry.instructorIds.map(resolver.instructorName).filter(Boolean).join(" & ");
  // Whoever teaches it comes first — a corporate booking's company name would
  // otherwise crowd the instructor out of the only row that carries them.
  const subtitle = [
    instructors,
    entry.kind === "corporate" ? entry.subtitle : null,
    entry.kind === "pt" ? null : resolver.locationName(entry.locationId),
  ]
    .filter(Boolean)
    .join(" · ");

  // Row budget at 72px/hour: a 30 min block fits the title alone, 45 min adds
  // the time row, and an hour is enough for the footer and the subtitle.
  const tiny = height < 40;
  const showFooter = height >= 56;
  const showSubtitle = height >= HOUR_HEIGHT && !dense;
  const href = resolver.href(entry);
  const dayChip =
    entry.kind === "workshop" && entry.dayCount > 1
      ? `Day ${entry.dayIndex}/${entry.dayCount}`
      : null;
  const tooltipInstructor =
    entry.kind === "corporate" && entry.mainInstructorId
      ? ` · ${resolver.instructorName(entry.mainInstructorId)}`
      : "";
  const kind = KIND[entry.kind];

  const style = {
    top,
    height,
    left: `calc(${left}% + 2px)`,
    width: `calc(${width}% - 4px)`,
  };
  const className = cn(
    // Pointer events on either way, so the title tooltip shows on a block too
    // short to print its time.
    "pointer-events-auto absolute z-10 flex flex-col overflow-hidden rounded-md border border-l-4 px-2 py-1 leading-snug shadow-sm",
    href && "transition-all duration-150 hover:z-20 hover:-translate-y-px hover:shadow-hover",
    kindClasses(entry),
    entry.eventState === "cancelled" && "opacity-70"
  );
  const title = `${formatTime(timezone, entry.startsAt)}–${formatTime(timezone, entry.endsAt)} · ${entry.label}${tooltipInstructor}`;

  const body = (
    <>
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
        {entry.kind === "class" && entry.seriesId && <SeriesMark />}
        {tiny && (
          <span className="ml-auto shrink-0 text-[10px] font-semibold tabular-nums text-ink/60">
            {formatTime(timezone, entry.startsAt)}
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
          {formatTime(timezone, entry.startsAt)} – {formatTime(timezone, entry.endsAt)}
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
          {entry.kind === "class" && waitingTag(entry.waiting) && (
            <span className="shrink-0 text-[10px] font-medium tabular-nums text-warning">
              {waitingTag(entry.waiting)}
            </span>
          )}
        </div>
      )}
    </>
  );

  if (!href) {
    // No page for this viewer to open (a workshop or corporate session on an
    // Instructor's calendar): the block shows the session and takes no click.
    return (
      <div style={style} className={className} title={title}>
        {body}
      </div>
    );
  }
  return (
    <Link href={href} style={style} className={className} title={title}>
      {body}
    </Link>
  );
}

/** Each kind's name and colours, on the grids, the legend and the List (`schedule-list-view.tsx`). */
export const KIND: Record<
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

export function kindClasses(entry: Entry): string {
  if (entry.eventState === "cancelled") {
    return "bg-error/10 border-error/40 border-l-error hover:bg-error/15";
  }
  return KIND[entry.kind].chip;
}

/** A class made by a Class Series — it repeats weekly. */
function SeriesMark() {
  return (
    <Repeat
      className="mt-0.5 h-3 w-3 shrink-0 text-ink/50"
      aria-label="Part of a class series"
    >
      <title>Part of a class series</title>
    </Repeat>
  );
}

function formatHour(h: number): string {
  if (h === 0 || h === 24) return "12am";
  if (h === 12) return "12pm";
  if (h < 12) return `${h}am`;
  return `${h - 12}pm`;
}

/* ---------- Legend ---------- */

export function Legend({ tip }: { tip?: string }) {
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
      {tip && <div className="ml-auto text-[11px] text-muted">{tip}</div>}
    </div>
  );
}
