"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  DialogFooter,
  EmptyState,
  Label,
  LoadFailure,
  PageHeader,
  StatusBadge,
  Textarea,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";
import { answeredElsewhere, loadError, type LoadError } from "@/lib/failed-read";
import { formatDate, formatPlainDay, formatTime, todayIso } from "@/lib/formatters";
import { localDay } from "@/lib/local-day";
import { gridDays, gridWindow, upcomingWindow } from "@/lib/schedule-grid";
import { addDays, addMonths } from "@/lib/studio-time";
import { useStudioZone } from "@/components/brand/brand-provider";
import { waitingTag } from "@/lib/class-waitlist";
import { ManualPtSessionDialog } from "@/components/schedule/manual-pt-session-dialog";
import {
  Legend,
  ScheduleCalendar,
  ViewToggle,
  WeekStrip,
  type CalendarResolver,
} from "@/components/schedule/schedule-calendar";
import { scheduleErrorMessage } from "@/lib/schedule";
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

type Mode = "calendar" | "list";

const KIND_LABEL: Record<ScheduleEntry["kind"], string> = {
  class: "Class",
  workshop: "Workshop",
  pt: "Private",
  corporate: "Corporate",
};

/**
 * An Instructor's own timetable: the classes they teach, the private sessions
 * they run, and the workshops and corporate sessions they are on. A calendar
 * (day, week, month), drawn as the Admin's Schedule is, or the next 60 days as
 * a list, where a class they lead can be cancelled.
 */
export default function InstructorSchedulePage() {
  const { may } = useWorkspace();
  // New class, Repeat weekly and Cancel are Schedule classes; the timetable is not.
  const canSchedule = may("schedule_classes");
  // A manual PT session puts a private session on their calendar: Take PT bookings'.
  const canTakePt = may("take_pt_bookings");
  const [mode, setMode] = useState<Mode>("calendar");
  const [addingPt, setAddingPt] = useState(false);
  // Bumped when something this page did changes the timetable, so whichever
  // view is showing reads it again.
  const [changed, setChanged] = useState(0);

  return (
    <div className={cn("space-y-6", mode === "list" && "mx-auto max-w-3xl")}>
      {/* The action belongs to PageHeader, which already stacks it under the
          title on a phone — a sibling flex row squeezed the description into a
          sliver instead. */}
      <PageHeader
        title="My schedule"
        description="Your classes, private sessions, workshops and corporate sessions."
        actions={
          <div className="flex flex-wrap gap-2">
            <ModeToggle value={mode} onChange={setMode} />
            {/* A private session agreed outside the app, run by this instructor. */}
            {canTakePt && (
              <Button variant="secondary" onClick={() => setAddingPt(true)}>
                <UserPlus className="h-4 w-4" /> PT session
              </Button>
            )}
            {canSchedule && (
              <Link href="/instructor/schedule/new/class">
                <Button>
                  <CalendarPlus className="h-4 w-4" /> New class
                </Button>
              </Link>
            )}
          </div>
        }
      />

      {addingPt && (
        <ManualPtSessionDialog
          role="instructor"
          onClose={() => setAddingPt(false)}
          onCreated={() => {
            setAddingPt(false);
            setChanged((n) => n + 1);
          }}
        />
      )}

      {mode === "calendar" ? (
        <MyCalendar changed={changed} />
      ) : (
        <UpcomingList canSchedule={canSchedule} changed={changed} />
      )}
    </div>
  );
}

function ModeToggle({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  const opts: { v: Mode; label: string }[] = [
    { v: "calendar", label: "Calendar" },
    { v: "list", label: "List" },
  ];
  return (
    <div className="inline-flex h-10 items-center rounded-md border border-border bg-paper p-0.5">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          aria-pressed={value === o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            "h-full rounded px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            value === o.v ? "bg-card text-ink shadow-soft" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------- Calendar ------------------------------- */

function MyCalendar({ changed }: { changed: number }) {
  const { accessibleLocations, currentStaff } = useWorkspace();
  const timezone = useStudioZone();
  // Kept across a trip to a class's page and back, as the Admin's Schedule is.
  const { cursor, view, today, ready, setDate, setView, open } =
    useSchedulePosition("instructor-schedule-position");

  const range = useMemo(
    () => ({ ...gridDays(view, cursor), ...gridWindow(timezone, view, cursor) }),
    [view, cursor, timezone],
  );
  const { entries, loading, error, reload } = useSchedule(
    { from: range.from, to: range.to },
    { surface: "instructor", enabled: ready },
  );

  useEffect(() => {
    if (changed > 0) void reload();
    // Only a change this page made reads again; `reload` changes with the week.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changed]);

  const visibleEntries = useMemo(
    () =>
      entries.filter((e) => {
        const start = Date.parse(e.startsAt);
        return start >= Date.parse(range.from) && start < Date.parse(range.to);
      }),
    [entries, range],
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

  const headingLabel =
    view === "day"
      ? formatPlainDay(cursor, "EEEE, d MMM yyyy")
      : view === "week"
        ? `${formatPlainDay(range.first, "d MMM")} – ${formatPlainDay(range.last, "d MMM yyyy")}`
        : formatPlainDay(cursor, "MMMM yyyy");

  const navigate = (dir: -1 | 0 | 1) => {
    if (dir === 0) return setDate(today);
    if (view === "day") return setDate(addDays(cursor, dir));
    if (view === "week") return setDate(addDays(cursor, 7 * dir));
    return setDate(addMonths(cursor, dir));
  };

  return (
    <div>
      <div className="rounded-xl border border-border bg-card shadow-soft">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border p-3 sm:flex-nowrap sm:p-4">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Previous" onClick={() => navigate(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="secondary" size="sm" className="h-9 sm:h-8" onClick={() => navigate(0)}>
              Today
            </Button>
            <Button variant="ghost" size="icon" aria-label="Next" onClick={() => navigate(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="min-w-0 flex-1 truncate text-sm font-semibold text-ink sm:text-base">
            {headingLabel}
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <ViewToggle value={view} onChange={setView} />
          </div>
        </div>

        {view === "day" && <WeekStrip day={cursor} onPick={setDate} />}

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
              onPickSlot={null}
              onOpenDay={(d) => open(d, "day")}
            />
          )}
        </div>
      </div>
      <Legend />
    </div>
  );
}

/* --------------------------------- List --------------------------------- */

function UpcomingList({ canSchedule, changed }: { canSchedule: boolean; changed: number }) {
  const { api, accessibleLocations, currentStaff } = useWorkspace();
  const timezone = useStudioZone();
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError | null>(null);
  // Cancel-own-class flow: only ever offered for a class this instructor leads.
  const [cancelling, setCancelling] = useState<ScheduleEntry | null>(null);
  const [reason, setReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

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
      // Group by the STUDIO's calendar day so the day headers, grouping and the
      // "Today" badge all agree — see lib/local-day.ts for the rule.
      const k = localDay(timezone, e.starts_at);
      const list = byDay.get(k) ?? [];
      list.push(e);
      byDay.set(k, list);
    }
    return Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries, timezone]);

  const todayKey = todayIso(timezone);
  const viewer = { staffId: currentStaff?.id ?? null, canScheduleClasses: canSchedule };

  async function submitCancel() {
    if (!api || !cancelling) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      await api.post(
        `/portal/instructor/schedule/classes/${cancelling.id}/cancel`,
        { reason: reason.trim() },
      );
      setCancelling(null);
      setReason("");
      toast.success(`${cancelling.label} cancelled`);
      await load();
    } catch (err) {
      setCancelError(scheduleErrorMessage(err, "Failed to cancel", timezone));
    } finally {
      setCancelBusy(false);
    }
  }

  return (
    <>
      {/* A schedule that failed to load is never drawn as "Nothing scheduled". */}
      {error ? (
        <LoadFailure
          what="your schedule"
          detail={error.detail}
          onRetry={load}
        />
      ) : loading ? (
        <div className="flex items-center justify-center py-16 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          title="Nothing scheduled"
          description={
            canSchedule
              ? "Classes and sessions you teach in the next 60 days show up here. Use “New class” to add one."
              : "Classes and sessions you teach in the next 60 days show up here."
          }
        />
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-muted">The next 60 days.</p>
          {groups.map(([day, items]) => (
            <section key={day}>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-sm font-semibold text-ink">
                  {formatDate(timezone, items[0].starts_at, "EEEE d MMM")}
                </h2>
                {day === todayKey && (
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
                    Today
                  </span>
                )}
              </div>
              <ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-soft">
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
                            onClick={() => {
                              setCancelling(e);
                              setReason("");
                              setCancelError(null);
                            }}
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

      <Dialog
        open={cancelling !== null}
        onOpenChange={(o) => {
          if (!o) setCancelling(null);
        }}
        title="Cancel this class?"
        description={
          cancelling
            ? `${cancelling.label} · ${formatDate(timezone, cancelling.starts_at, "EEE d MMM")} ${formatTime(timezone, cancelling.starts_at)}`
            : undefined
        }
      >
        <p className="text-sm text-ink">
          {cancelling?.booked_count ?? 0} member
          {(cancelling?.booked_count ?? 0) === 1 ? "" : "s"} will get their credit or
          session back — members on an Unlimited plan simply lose the place. This cannot be
          undone, and all admins are notified.
        </p>
        <div className="mt-4 space-y-1.5">
          <Label htmlFor="cancel-reason">Reason (required)</Label>
          <Textarea
            id="cancel-reason"
            value={reason}
            maxLength={500}
            onChange={(ev) => setReason(ev.target.value)}
            placeholder="Why are you cancelling this class?"
          />
        </div>
        {cancelError && (
          <div className="mt-3 rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
            Failed to cancel: {cancelError}
          </div>
        )}
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => setCancelling(null)}
            disabled={cancelBusy}
          >
            Keep class
          </Button>
          <Button
            variant="danger"
            onClick={() => void submitCancel()}
            disabled={cancelBusy || reason.trim().length === 0}
          >
            {cancelBusy && <Loader2 className="h-4 w-4 animate-spin" />}
            Cancel class
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
