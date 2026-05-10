"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Filter, ChevronLeft, ChevronRight } from "lucide-react";
import { Button, PageHeader, Badge } from "@/components/ui";
import { buildScheduleEntries, instructorName, locationName, classTypeName } from "@/lib/schedule-helpers";
import { locations, instructors as allInstructors } from "@/data";
import { formatDate, formatTime } from "@/lib/formatters";
import { startOfWeek, addDays, format, parseISO, isSameDay } from "date-fns";

type FilterType = "all" | "class" | "workshop" | "pt";

export default function SchedulePage() {
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date("2026-05-10"), { weekStartsOn: 1 })
  );
  const [locationId, setLocationId] = useState<string>("all");
  const [instructorId, setInstructorId] = useState<string>("all");
  const [type, setType] = useState<FilterType>("all");

  const entries = useMemo(() => buildScheduleEntries(), []);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const filtered = entries.filter((e) => {
    if (locationId !== "all" && e.locationId !== locationId) return false;
    if (instructorId !== "all" && !e.instructorIds.includes(instructorId)) return false;
    if (type !== "all" && e.kind !== type) return false;
    const start = parseISO(e.startsAt);
    return start >= weekStart && start < addDays(weekStart, 7);
  });

  return (
    <div>
      <PageHeader
        title="Schedule"
        description="Unified timetable of classes, workshops, and confirmed private sessions."
        actions={
          <div className="flex gap-2">
            <Link href="/admin/schedule/new/class">
              <Button variant="secondary">
                <Plus className="h-4 w-4" /> Class
              </Button>
            </Link>
            <Link href="/admin/schedule/new/workshop">
              <Button>
                <Plus className="h-4 w-4" /> Workshop
              </Button>
            </Link>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-soft">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setWeekStart(addDays(weekStart, -7))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-sm font-medium text-ink">
          {format(weekStart, "d MMM")} – {format(addDays(weekStart, 6), "d MMM yyyy")}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setWeekStart(addDays(weekStart, 7))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setWeekStart(startOfWeek(new Date("2026-05-10"), { weekStartsOn: 1 }))}
        >
          Today
        </Button>

        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
          <Filter className="h-3.5 w-3.5 text-muted" />
          <FilterPill
            value={type}
            options={[
              { val: "all", label: "All types" },
              { val: "class", label: "Class" },
              { val: "workshop", label: "Workshop" },
              { val: "pt", label: "Private" },
            ]}
            onChange={(v) => setType(v as FilterType)}
          />
          <FilterPill
            value={locationId}
            options={[
              { val: "all", label: "All locations" },
              ...locations.map((l) => ({ val: l.id, label: l.name })),
            ]}
            onChange={setLocationId}
          />
          <FilterPill
            value={instructorId}
            options={[
              { val: "all", label: "All instructors" },
              ...allInstructors
                .filter((i) => !i.archivedAt)
                .map((i) => ({ val: i.id, label: i.name.split(" ")[0] })),
            ]}
            onChange={setInstructorId}
          />
        </div>
      </div>

      <div className="grid gap-3">
        {days.map((day) => {
          const dayEntries = filtered.filter((e) => isSameDay(parseISO(e.startsAt), day));
          return (
            <DayCard key={day.toISOString()} day={day} entries={dayEntries} />
          );
        })}
      </div>
    </div>
  );
}

function FilterPill({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { val: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-border bg-paper px-2 py-1 text-xs hover:bg-warm focus:outline-none focus:ring-2 focus:ring-accent"
    >
      {options.map((o) => (
        <option key={o.val} value={o.val}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

type Entry = ReturnType<typeof buildScheduleEntries>[number];

function DayCard({ day, entries }: { day: Date; entries: Entry[] }) {
  return (
    <section className="rounded-xl border border-border bg-card shadow-soft">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-ink">{format(day, "EEEE")}</h2>
          <span className="text-xs text-muted">{format(day, "d MMM")}</span>
        </div>
        <span className="text-xs text-muted">
          {entries.length} {entries.length === 1 ? "session" : "sessions"}
        </span>
      </header>
      {entries.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted">No sessions scheduled.</div>
      ) : (
        <ul className="divide-y divide-border">
          {entries.map((e) => (
            <ScheduleRow key={`${e.kind}-${e.id}`} entry={e} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ScheduleRow({ entry }: { entry: Entry }) {
  const stateBadge =
    entry.eventState === "scheduled" ? (
      <Badge tone="accent">Scheduled</Badge>
    ) : entry.eventState === "ongoing" ? (
      <Badge tone="warning">Ongoing</Badge>
    ) : entry.eventState === "completed" ? (
      <Badge tone="sage">Completed</Badge>
    ) : (
      <Badge tone="error">Cancelled</Badge>
    );

  const kindBadge =
    entry.kind === "class" ? (
      <Badge tone="cyan">Class</Badge>
    ) : entry.kind === "workshop" ? (
      <Badge tone="warning">Workshop</Badge>
    ) : (
      <Badge tone="accent">PT</Badge>
    );

  const subtitle = [
    entry.kind === "class" || entry.kind === "workshop" ? classTypeName(entry.classTypeId) : null,
    entry.instructorIds.map(instructorName).join(" & "),
    locationName(entry.locationId),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      href={`/admin/schedule/${entry.kind}/${entry.id}`}
      className="flex items-center gap-4 px-4 py-3 transition hover:bg-paper"
    >
      <div className="w-20 shrink-0 font-mono text-xs text-muted">
        <div>{formatTime(entry.startsAt)}</div>
        <div className="opacity-60">{formatTime(entry.endsAt)}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {kindBadge}
          <span className="truncate font-medium text-ink">{entry.label}</span>
          {stateBadge}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted">{subtitle}</div>
      </div>
      <div className="shrink-0 text-right text-xs">
        <div className="font-mono font-semibold text-ink">
          {entry.bookedCount} / {entry.capacity}
        </div>
        <div className="text-muted">booked</div>
      </div>
    </Link>
  );
}
