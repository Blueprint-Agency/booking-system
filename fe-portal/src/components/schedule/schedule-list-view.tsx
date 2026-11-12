"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Repeat } from "lucide-react";
import { useStudioZone } from "@/components/brand/brand-provider";
import { StatusBadge } from "@/components/ui";
import { cn } from "@/lib/utils";
import { formatPlainDay, formatTime } from "@/lib/formatters";
import { localDay } from "@/lib/local-day";
import { waitingTag } from "@/lib/class-waitlist";
import { listWeeks, weeksOpenAtFirst, type ListWeek } from "@/lib/schedule-list";
import type { ScheduleEntry } from "@/lib/use-schedule";
import { KIND, kindClasses, type CalendarResolver } from "./schedule-calendar";

/**
 * The timetable's List view, for both portals: the month the toolbar is on, in
 * its weeks, each a section that opens and closes, the days inside with what
 * is on them. A row says what the grid's block says and opens the same page.
 *
 * Mount it with `key={month}` so a new month opens with its own weeks open
 * (`weeksOpenAtFirst`) rather than the last month's.
 */
export function ScheduleListView({
  cursor,
  entries,
  resolver,
  rowAction,
  empty,
}: {
  cursor: string;
  entries: ScheduleEntry[];
  resolver: CalendarResolver;
  /** Something staff can do from the row itself, e.g. an Instructor's Cancel. */
  rowAction?: (entry: ScheduleEntry) => React.ReactNode;
  /** What a week with nothing on says. */
  empty: string;
}) {
  const timezone = useStudioZone();
  const today = localDay(timezone);
  const weeks = useMemo(() => listWeeks(entries, timezone, cursor), [entries, timezone, cursor]);
  const [open, setOpen] = useState(() => weeksOpenAtFirst(weeks, today));
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="divide-y divide-border">
      {weeks.map((w) => (
        <WeekSection
          key={w.key}
          week={w}
          today={today}
          open={open.has(w.key)}
          onToggle={() => toggle(w.key)}
          resolver={resolver}
          rowAction={rowAction}
          empty={empty}
        />
      ))}
    </div>
  );
}

function WeekSection({
  week,
  today,
  open,
  onToggle,
  resolver,
  rowAction,
  empty,
}: {
  week: ListWeek<ScheduleEntry>;
  today: string;
  open: boolean;
  onToggle: () => void;
  resolver: CalendarResolver;
  rowAction?: (entry: ScheduleEntry) => React.ReactNode;
  empty: string;
}) {
  const thisWeek = week.first <= today && today <= week.last;
  const panelId = `week-${week.key}`;
  const range =
    week.first === week.last
      ? formatPlainDay(week.first, "EEE d MMM")
      : `${formatPlainDay(week.first, "EEE d MMM")} – ${formatPlainDay(week.last, "EEE d MMM")}`;
  return (
    <section>
      <h2>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          className="flex w-full items-center gap-2 bg-paper/50 px-4 py-2.5 text-left transition-colors hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        >
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 text-muted transition-transform", !open && "-rotate-90")}
            aria-hidden
          />
          <span className="text-xs font-semibold uppercase tracking-wider text-ink">{range}</span>
          {thisWeek && (
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
              This week
            </span>
          )}
          <span className="ml-auto text-xs tabular-nums text-muted">
            {week.count === 0 ? "Nothing on" : week.count === 1 ? "1 session" : `${week.count} sessions`}
          </span>
        </button>
      </h2>
      {open && (
        <div id={panelId}>
          {week.days.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted">{empty}</p>
          ) : (
            week.days.map((d) => (
              <div key={d.day} className="border-t border-border">
                <div className="flex items-center gap-2 px-4 pb-1 pt-3">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                    {formatPlainDay(d.day, "EEEE d MMM")}
                  </h3>
                  {d.day === today && (
                    <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
                      Today
                    </span>
                  )}
                </div>
                <ul className="space-y-1.5 px-3 pb-3 sm:px-4">
                  {d.entries.map((e) => (
                    <ListRow key={`${e.kind}-${e.id}`} entry={e} resolver={resolver} action={rowAction?.(e)} />
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}

function ListRow({
  entry,
  resolver,
  action,
}: {
  entry: ScheduleEntry;
  resolver: CalendarResolver;
  action?: React.ReactNode;
}) {
  const timezone = useStudioZone();
  const href = resolver.href(entry);
  const cancelled = entry.eventState === "cancelled";
  const kind = KIND[entry.kind];
  const instructors =
    entry.kind === "corporate"
      ? entry.mainInstructorId
        ? resolver.instructorName(entry.mainInstructorId)
        : ""
      : entry.instructorIds.map(resolver.instructorName).filter(Boolean).join(" & ");
  const details = [
    `${formatTime(timezone, entry.startsAt)}–${formatTime(timezone, entry.endsAt)}`,
    instructors,
    entry.kind === "corporate" ? entry.subtitle : null,
    entry.kind === "pt" || !entry.locationId ? null : resolver.locationName(entry.locationId),
  ]
    .filter(Boolean)
    .join(" · ");
  const places =
    entry.capacity !== null && entry.bookedCount !== null
      ? `${entry.bookedCount} booked of ${entry.capacity} places`
      : null;
  const dayChip =
    entry.kind === "workshop" && entry.dayCount > 1 ? `Day ${entry.dayIndex}/${entry.dayCount}` : null;

  const title = (
    <span className={cn("truncate font-semibold text-ink", cancelled && "line-through")}>{entry.label}</span>
  );
  return (
    <li
      className={cn(
        "relative flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-l-4 px-3 py-2",
        kindClasses(entry),
        href && "transition-shadow hover:shadow-hover",
        cancelled && "opacity-80",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          {href ? (
            // The link stretches over the whole row, so a click anywhere on it opens the page.
            <Link
              href={href}
              // The overlay covers the chips, so the places tooltip rides on the link.
              title={places ?? undefined}
              className="min-w-0 truncate rounded-sm after:absolute after:inset-0 after:rounded-md after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent"
            >
              {title}
            </Link>
          ) : (
            title
          )}
          {entry.kind === "class" && entry.seriesId && (
            <Repeat className="h-3 w-3 shrink-0 text-ink/50" aria-label="Part of a class series" />
          )}
          {dayChip && (
            <span
              className={cn(
                "shrink-0 rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide text-white",
                kind.solid,
              )}
            >
              {dayChip}
            </span>
          )}
        </div>
        <div className="break-words text-xs tabular-nums text-ink/70">{details}</div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {cancelled && <StatusBadge status="cancelled" />}
        {entry.capacity !== null && entry.bookedCount !== null && (
          <span
            className="rounded bg-ink/[0.07] px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-ink/75"
            title={places ?? undefined}
          >
            {entry.bookedCount}/{entry.capacity}
          </span>
        )}
        {entry.kind === "class" && waitingTag(entry.waiting) && (
          <span className="text-xs tabular-nums text-warning">{waitingTag(entry.waiting)}</span>
        )}
        {/* No kind label: the row's colour says it, as the legend under the card explains. */}
        <span className="sr-only">{kind.label}</span>
        {/* Above the row's link, so the action takes its own clicks. */}
        {action && <div className="relative z-10">{action}</div>}
      </div>
    </li>
  );
}
