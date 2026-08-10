"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogFooter,
  EmptyState,
  Label,
  PageHeader,
  Textarea,
} from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import { formatDate, formatTime, todayIso } from "@/lib/formatters";
import { localDay } from "@/lib/local-day";

interface ScheduleEntry {
  kind: "class" | "workshop" | "pt" | "corporate";
  id: string;
  label: string;
  subtitle: string | null;
  main_instructor_id: string | null;
  location_id: string | null;
  room_id: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  booked_count: number | null;
  event_state: string;
}

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
  const { api, accessibleLocations, currentStaff } = useWorkspace();
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
        api.get<{ entries: ScheduleEntry[] }>("/portal/instructor/schedule", {
          from: startOfTodayIso(),
          to: plusDaysIso(60),
        }),
        api.get<{ rooms: Room[] }>("/portal/instructor/catalog/rooms"),
      ]);
      setEntries(sched.entries ?? []);
      setRooms(rm.rooms ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
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

  const canCancel = (e: ScheduleEntry) =>
    e.kind === "class" &&
    !!currentStaff &&
    e.main_instructor_id === currentStaff.id &&
    e.event_state !== "cancelled" &&
    e.event_state !== "completed";

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
      await load();
    } catch (err) {
      setCancelError(
        err instanceof ApiError ? `HTTP ${err.status}` : "Network error",
      );
    } finally {
      setCancelBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <PageHeader
          title="My schedule"
          description="Your classes and private sessions over the next 60 days."
        />
        <Link href="/instructor/schedule/new/class" className="shrink-0">
          <Button>
            <CalendarPlus className="h-4 w-4" /> New class
          </Button>
        </Link>
      </div>

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
          Failed to load schedule: {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          title="Nothing scheduled"
          description="Classes and sessions you teach in the next 60 days show up here. Use “New class” to add one."
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
                {items.map((e) => (
                  <li
                    key={`${e.kind}:${e.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">{e.label}</div>
                      <div className="text-xs text-muted">
                        {formatTime(e.starts_at)}–{formatTime(e.ends_at)}
                        {e.location_id
                          ? ` · ${locName.get(e.location_id) ?? "Studio"}`
                          : ""}
                        {e.room_id ? ` · ${roomName.get(e.room_id) ?? "Room"}` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {e.capacity != null && (
                        <span className="text-xs tabular-nums text-muted">
                          {e.booked_count ?? 0}/{e.capacity}
                        </span>
                      )}
                      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted">
                        {KIND_LABEL[e.kind]}
                      </span>
                      {canCancel(e) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-error hover:bg-error/5"
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
                ))}
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
          {(cancelling?.booked_count ?? 0) === 1 ? "" : "s"} will be refunded
          their credit. This cannot be undone, and all admins are notified.
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
