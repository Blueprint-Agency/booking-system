"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, Loader2, UserPlus } from "lucide-react";
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
import { PERMISSION_REFUSED, permissionRefusal } from "@/lib/access-refusal";
import { answeredElsewhere } from "@/lib/failed-read";
import { ApiError } from "@/lib/api";
import { formatDate, formatTime, todayIso } from "@/lib/formatters";
import { localDay } from "@/lib/local-day";
import { waitingTag } from "@/lib/class-waitlist";
import { ManualPtSessionDialog } from "@/components/schedule/manual-pt-session-dialog";
import { scheduleErrorMessage } from "@/lib/schedule";
import { myScheduleRow, type MyScheduleEntry as ScheduleEntry } from "@/lib/my-schedule";

interface Room {
  id: string;
  name: string;
  location_id: string;
}

const KIND_LABEL: Record<ScheduleEntry["kind"], string> = {
  class: "Class",
  workshop: "Workshop",
  pt: "Private",
  corporate: "Corporate",
};

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function plusDaysIso(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
// Group/compare by LOCAL calendar day so the day headers, grouping, and the
// "Today" badge all agree — see lib/local-day.ts for the rule.
const dayKey = localDay;

export default function InstructorSchedulePage() {
  const { api, accessibleLocations, currentStaff, may } = useWorkspace();
  // New class, Repeat weekly and Cancel are Schedule classes; the timetable is not.
  const canSchedule = may("schedule_classes");
  // A manual PT session puts a private session on their calendar: Take PT bookings'.
  const canTakePt = may("take_pt_bookings");
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Cancel-own-class flow: only ever offered for a class this instructor leads.
  const [cancelling, setCancelling] = useState<ScheduleEntry | null>(null);
  const [reason, setReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [addingPt, setAddingPt] = useState(false);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const [sched, rm] = await Promise.all([
        api.get<{ entries: ScheduleEntry[] }>("/portal/instructor/schedule", {
          from: startOfTodayIso(),
          to: plusDaysIso(60),
        }),
        api.get<{ rooms: Room[] }>("/portal/instructor/catalog/rooms"),
      ]);
      setEntries(sched.entries ?? []);
      setRooms(rm.rooms ?? []);
    } catch (err) {
      // A `401` or maintenance is answered by the sign-in and the maintenance screen.
      if (!answeredElsewhere(err)) {
        setError(
          permissionRefusal(err) ??
            (err instanceof ApiError ? `HTTP ${err.status}` : "Network error"),
        );
      }
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

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
      const k = dayKey(e.starts_at);
      const list = byDay.get(k) ?? [];
      list.push(e);
      byDay.set(k, list);
    }
    return Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries]);

  const todayKey = todayIso();
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
      setCancelError(scheduleErrorMessage(err, "Failed to cancel"));
    } finally {
      setCancelBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* The action belongs to PageHeader, which already stacks it under the
          title on a phone — a sibling flex row squeezed the description into a
          sliver instead. */}
      <PageHeader
        title="My schedule"
        description="Your classes and private sessions over the next 60 days."
        actions={
          canSchedule || canTakePt ? (
            <div className="flex flex-wrap gap-2">
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
          ) : null
        }
      />

      {addingPt && (
        <ManualPtSessionDialog
          role="instructor"
          onClose={() => setAddingPt(false)}
          onCreated={() => {
            setAddingPt(false);
            void load();
          }}
        />
      )}

      {/* A schedule that failed to load is never drawn as "Nothing scheduled". */}
      {error ? (
        <LoadFailure
          what="your schedule"
          detail={error === PERMISSION_REFUSED ? error : undefined}
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
          {groups.map(([day, items]) => (
            <section key={day}>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-sm font-semibold text-ink">
                  {formatDate(items[0].starts_at, "EEEE d MMM")}
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
                          {formatTime(e.starts_at)}–{formatTime(e.ends_at)}
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
            ? `${cancelling.label} · ${formatDate(cancelling.starts_at, "EEE d MMM")} ${formatTime(cancelling.starts_at)}`
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
    </div>
  );
}
