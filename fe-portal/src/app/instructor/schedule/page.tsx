"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, EmptyState, LoadFailure, PageHeader, StatusBadge } from "@/components/ui";
import { InstructorCancelClassDialog } from "@/components/schedule/instructor-cancel-class-dialog";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";
import { answeredElsewhere, loadError, type LoadError } from "@/lib/failed-read";
import { formatDate, formatTime, todayIso } from "@/lib/formatters";
import { localDay } from "@/lib/local-day";
import { gridDays, gridWindow, upcomingWindow, type GridView } from "@/lib/schedule-grid";
import { useStudioZone } from "@/components/brand/brand-provider";
import { waitingTag } from "@/lib/class-waitlist";
import { PtRequestPickerDialog } from "@/components/schedule/pt-request-picker-dialog";
import {
  Legend,
  ScheduleCalendar,
  ViewToggle,
  WeekStrip,
  type CalendarResolver,
} from "@/components/schedule/schedule-calendar";
import {
  ADD_TIP,
  AddKindButtons,
  FilterPill,
  FiltersButton,
  FiltersRow,
  PickSlotBanner,
  PrevTodayNext,
  TYPE_FILTER_OPTIONS,
  gridHeading,
  stepCursor,
} from "@/components/schedule/schedule-toolbar";
import { slotHref, type Slot } from "@/lib/schedule";
import { useSchedule } from "@/lib/use-schedule";
import { useSchedulePosition } from "@/lib/use-schedule-position";
import {
  myCalendarHref,
  myScheduleRow,
  type MyScheduleEntry as ScheduleEntry,
} from "@/lib/my-schedule";

interface Room {
  id: string;
  name: string;
  location_id: string;
}

type AddKind = "class" | "pt";
type FilterType = "all" | ScheduleEntry["kind"];
/** The grid's three views, or the next 60 days as a list. */
type Shown = GridView | "list";

const SHOWN_OPTIONS: { v: Shown; label: string }[] = [
  { v: "day", label: "Day" },
  { v: "week", label: "Week" },
  { v: "month", label: "Month" },
  { v: "list", label: "List" },
];

const ADD_KINDS: { kind: AddKind; label: string; noun: string }[] = [
  { kind: "class", label: "Class", noun: "class" },
  { kind: "pt", label: "PT Session", noun: "PT session" },
];

const KIND_LABEL: Record<ScheduleEntry["kind"], string> = {
  class: "Class",
  workshop: "Workshop",
  pt: "Private",
  corporate: "Corporate",
};

/**
 * An Instructor's own timetable: the classes they teach, the private sessions
 * they run, and the workshops and corporate sessions they are on. The Admin's
 * Schedule, drawn the same way — "+ Class" and "+ PT Session" arm the grid and
 * the slot picked seeds the form — with only what their Instructor Permissions
 * allow, and a List of the next 60 days beside the grids.
 */
export default function InstructorSchedulePage() {
  const router = useRouter();
  const { may, accessibleLocations, currentStaff } = useWorkspace();
  const timezone = useStudioZone();
  // New class, Repeat weekly and Cancel are Schedule classes; the timetable is not.
  const canSchedule = may("schedule_classes");
  // A PT session put on their calendar (from a request or by hand) is Take PT bookings'.
  const canTakePt = may("take_pt_bookings");
  const addKinds = ADD_KINDS.filter((k) => (k.kind === "class" ? canSchedule : canTakePt));

  // Kept across a trip to a class's page and back, as the Admin's Schedule is.
  const { cursor, view, today, ready, setDate, setView, open } =
    useSchedulePosition("instructor-schedule-position");
  const [list, setList] = useState(false);
  const [type, setType] = useState<FilterType>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [addMode, setAddMode] = useState<AddKind | null>(null);
  const [pickedSlot, setPickedSlot] = useState<Slot | null>(null);
  // Bumped when something this page did changes the timetable, so the list
  // reads it again.
  const [changed, setChanged] = useState(0);

  const range = useMemo(
    () => ({ ...gridDays(view, cursor), ...gridWindow(timezone, view, cursor) }),
    [view, cursor, timezone],
  );
  const { entries, loading, error, reload } = useSchedule(
    { from: range.from, to: range.to },
    { surface: "instructor", enabled: ready && !list },
  );

  const visibleEntries = useMemo(
    () =>
      entries.filter((e) => {
        if (type !== "all" && e.kind !== type) return false;
        const start = Date.parse(e.startsAt);
        return start >= Date.parse(range.from) && start < Date.parse(range.to);
      }),
    [entries, range, type],
  );

  const locationById = useMemo(
    () => new Map(accessibleLocations.map((l) => [l.id, l.name])),
    [accessibleLocations],
  );
  const staffId = currentStaff?.id ?? null;
  const resolver = useMemo<CalendarResolver>(
    () => ({
      // It is their own calendar, so a block names no instructor and keeps the
      // row for the kind of session and the place.
      instructorName: () => "",
      locationName: (id) => (id ? (locationById.get(id) ?? "Studio") : ""),
      href: (e) => myCalendarHref(e, staffId),
    }),
    [locationById, staffId],
  );

  const clearAdd = () => {
    setAddMode(null);
    setPickedSlot(null);
  };

  // Arming a "+" from the list goes back to the grid, where the slot is picked.
  const arm = (kind: AddKind | null) => {
    setAddMode(kind);
    if (kind) setList(false);
  };

  // A class is created on its own page; a PT session from a pending request or
  // by hand, in a picker over the grid.
  const pickSlot = (slot: Slot) => {
    if (addMode === "class") {
      clearAdd();
      router.push(slotHref("/instructor/schedule/new/class", slot));
      return;
    }
    setPickedSlot(slot);
  };

  const afterScheduled = () => {
    clearAdd();
    setChanged((n) => n + 1);
    void reload();
  };

  return (
    <div>
      <PageHeader
        title="My schedule"
        description="Your classes, private sessions, workshops and corporate sessions."
        actions={
          addKinds.length > 0 ? (
            <AddKindButtons kinds={addKinds} armed={addMode} onArm={arm} />
          ) : undefined
        }
      />

      <div className="rounded-xl border border-border bg-card shadow-soft">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border p-3 sm:flex-nowrap sm:p-4">
          {!list && <PrevTodayNext onStep={(dir) => setDate(stepCursor(view, cursor, today, dir))} />}
          <div className="min-w-0 flex-1 truncate text-sm font-semibold text-ink sm:text-base">
            {list ? "The next 60 days" : gridHeading(view, cursor, range.first, range.last)}
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <ViewToggle<Shown>
              value={list ? "list" : view}
              options={SHOWN_OPTIONS}
              onChange={(v) => {
                if (v === "list") {
                  setList(true);
                  setAddMode(null);
                  return;
                }
                setList(false);
                setView(v);
              }}
            />
            <FiltersButton
              open={filtersOpen}
              active={type !== "all" ? 1 : 0}
              onToggle={() => setFiltersOpen((o) => !o)}
            />
          </div>
        </div>

        {filtersOpen && (
          <FiltersRow onClear={type !== "all" ? () => setType("all") : null}>
            <FilterPill
              label="Type"
              value={type}
              options={TYPE_FILTER_OPTIONS}
              onChange={(v) => setType(v as FilterType)}
            />
          </FiltersRow>
        )}

        {addMode && (
          <PickSlotBanner
            what={ADD_KINDS.find((k) => k.kind === addMode)?.noun ?? ""}
            onCancel={() => setAddMode(null)}
          />
        )}

        {list ? (
          <UpcomingList canSchedule={canSchedule} changed={changed} type={type} />
        ) : (
          <>
            {view === "day" && <WeekStrip day={cursor} onPick={setDate} />}
            {/* Day and week scroll inside the card so the toolbar and day
                headers stay put across the 6am–12am range. */}
            <div
              className={cn(
                "relative overflow-auto",
                view !== "month" && "max-h-[calc(100dvh-16rem)] min-h-[420px]",
              )}
            >
              {/* A schedule that failed to load is never drawn as an empty week. */}
              {error ? (
                <LoadFailure what="your schedule" onRetry={reload} className="py-16" />
              ) : loading && entries.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading schedule…
                </div>
              ) : (
                <ScheduleCalendar
                  view={view}
                  cursor={cursor}
                  weekStart={range.first}
                  entries={visibleEntries}
                  resolver={resolver}
                  onPickSlot={addMode ? pickSlot : null}
                  onOpenDay={(d) => open(d, "day")}
                />
              )}
            </div>
          </>
        )}
      </div>

      <Legend tip={addKinds.length > 0 && !list ? ADD_TIP : undefined} />

      {addMode === "pt" && pickedSlot && (
        <PtRequestPickerDialog
          role="instructor"
          slot={pickedSlot}
          onClose={clearAdd}
          onScheduled={() => {
            toast.success("Session scheduled");
            afterScheduled();
          }}
        />
      )}
    </div>
  );
}

/* --------------------------------- List --------------------------------- */

function UpcomingList({
  canSchedule,
  changed,
  type,
}: {
  canSchedule: boolean;
  changed: number;
  type: FilterType;
}) {
  const { api, accessibleLocations, currentStaff } = useWorkspace();
  const timezone = useStudioZone();
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError | null>(null);
  // Cancel-own-class flow: only ever offered for a class this instructor leads.
  const [cancelling, setCancelling] = useState<ScheduleEntry | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const [sched, rm] = await Promise.all([
        // The studio's midnight today, for 60 days: what the heading says.
        api.get<{ entries: ScheduleEntry[] }>("/portal/instructor/schedule", upcomingWindow(timezone, 60)),
        api.get<{ rooms: Room[] }>("/portal/instructor/catalog/rooms"),
      ]);
      setEntries(sched.entries ?? []);
      setRooms(rm.rooms ?? []);
    } catch (err) {
      // A `401` or maintenance is answered by the sign-in and the maintenance screen.
      if (!answeredElsewhere(err)) setError(loadError(err));
    } finally {
      setLoading(false);
    }
  }, [api, timezone]);

  useEffect(() => {
    void load();
  }, [load, changed]);

  const locName = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of accessibleLocations) m.set(l.id, l.name);
    return m;
  }, [accessibleLocations]);
  const roomName = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rooms) m.set(r.id, r.name);
    return m;
  }, [rooms]);

  const groups = useMemo(() => {
    const byDay = new Map<string, ScheduleEntry[]>();
    for (const e of entries) {
      if (type !== "all" && e.kind !== type) continue;
      // Group by the STUDIO's calendar day so the day headers, grouping and the
      // "Today" badge all agree — see lib/local-day.ts for the rule.
      const k = localDay(timezone, e.starts_at);
      const list = byDay.get(k) ?? [];
      list.push(e);
      byDay.set(k, list);
    }
    return Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries, timezone, type]);

  const todayKey = todayIso(timezone);
  const viewer = { staffId: currentStaff?.id ?? null, canScheduleClasses: canSchedule };

  return (
    <>
      {/* A schedule that failed to load is never drawn as "Nothing scheduled". */}
      {error ? (
        <LoadFailure what="your schedule" detail={error.detail} onRetry={load} className="py-16" />
      ) : loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading schedule…
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          title="Nothing scheduled"
          description={
            type !== "all"
              ? "Nothing of this type in the next 60 days."
              : canSchedule
                ? "Classes and sessions you teach in the next 60 days show up here. Use “+ Class” to add one."
                : "Classes and sessions you teach in the next 60 days show up here."
          }
        />
      ) : (
        <div className="divide-y divide-border">
          {groups.map(([day, items]) => (
            <section key={day}>
              <div className="flex items-center gap-2 bg-paper/50 px-4 py-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  {formatDate(timezone, items[0].starts_at, "EEEE d MMM")}
                </h2>
                {day === todayKey && (
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
                    Today
                  </span>
                )}
              </div>
              <ul className="divide-y divide-border">
                {items.map((e) => {
                  const row = myScheduleRow(e, viewer);
                  return (
                    <li
                      key={`${e.kind}:${e.id}`}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3"
                    >
                      <div className={cn("min-w-0 flex-1", row.cancelled && "opacity-70")}>
                        {row.href ? (
                          <Link
                            href={row.href}
                            className={cn(
                              "block truncate py-0.5 font-medium text-ink hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                              row.cancelled && "line-through",
                            )}
                          >
                            {e.label}
                          </Link>
                        ) : (
                          <div className={cn("truncate font-medium text-ink", row.cancelled && "line-through")}>
                            {e.label}
                          </div>
                        )}
                        <div className="break-words text-xs text-muted">
                          {formatTime(timezone, e.starts_at)}–{formatTime(timezone, e.ends_at)}
                          {e.location_id
                            ? ` · ${locName.get(e.location_id) ?? "Studio"}`
                            : ""}
                          {e.room_id ? ` · ${roomName.get(e.room_id) ?? "Room"}` : ""}
                        </div>
                      </div>
                      <div className="ml-auto flex shrink-0 items-center gap-2">
                        {row.cancelled && <StatusBadge status="cancelled" />}
                        {e.capacity != null && (
                          <span
                            className="text-xs tabular-nums text-muted"
                            title={`${e.booked_count ?? 0} booked of ${e.capacity} places`}
                          >
                            {e.booked_count ?? 0}/{e.capacity}
                          </span>
                        )}
                        {waitingTag(e.waiting) && (
                          <span className="text-xs tabular-nums text-warning">{waitingTag(e.waiting)}</span>
                        )}
                        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted">
                          {KIND_LABEL[e.kind]}
                        </span>
                        {row.canCancel && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-10 text-error hover:bg-error/5 sm:h-8"
                            onClick={() => setCancelling(e)}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <InstructorCancelClassDialog
        target={
          cancelling
            ? {
                id: cancelling.id,
                label: cancelling.label,
                startsAt: cancelling.starts_at,
                bookedCount: cancelling.booked_count ?? 0,
              }
            : null
        }
        onClose={() => setCancelling(null)}
        onCancelled={async () => {
          setCancelling(null);
          await load();
        }}
      />
    </>
  );
}
