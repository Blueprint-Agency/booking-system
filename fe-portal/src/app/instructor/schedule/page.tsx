"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import { Button, EmptyState, PageHeader } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import { formatDate, formatTime, todayIso } from "@/lib/formatters";

interface ScheduleEntry {
  kind: "class" | "workshop" | "pt" | "corporate";
  id: string;
  label: string;
  subtitle: string | null;
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
// "Today" badge all agree. Slicing the ISO string would use the UTC date, which
// drifts a day off for early-morning sessions in SGT (UTC+8).
function dayKey(iso: string): string {
  return formatDate(iso, "yyyy-MM-dd");
}

export default function InstructorSchedulePage() {
  const { api, accessibleLocations } = useWorkspace();
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
