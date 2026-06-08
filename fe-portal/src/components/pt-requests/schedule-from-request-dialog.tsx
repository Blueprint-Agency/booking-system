"use client";
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button, Dialog, DialogFooter, Input, Label } from "@/components/ui";
import { todayIso } from "@/lib/formatters";
import { ApiError } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import type { ApiPtRequest } from "@/lib/pt-requests";

interface ApiInstructor {
  id: string;
  name: string;
  archived_at?: string | null;
}
interface ApiRoom {
  id: string;
  location_id: string;
  name: string;
  archived_at: string | null;
}

const SCHEDULE_ERROR: Record<string, string> = {
  not_pending: "This request is no longer pending.",
  room_conflict: "That room is already booked for this time.",
  instructor_conflict: "That instructor is already booked for this time.",
  partner_account_required:
    "The partner needs a member account before this can be scheduled.",
  bad_time_range: "End time must be after start time.",
};

export function ScheduleFromRequestDialog({
  request,
  onScheduled,
  onClose,
}: {
  request: ApiPtRequest;
  onScheduled: () => void;
  onClose: () => void;
}) {
  const { api, accessibleLocations } = useWorkspace();

  // Postgres `time` columns serialise as HH:MM:SS; <input type="time"> and our
  // datetime construction expect HH:MM, so normalise.
  const hhmm = (t: string) => t.slice(0, 5);
  const first = request.slots[0];
  const [date, setDate] = useState(first?.proposed_date ?? todayIso());
  const [startTime, setStartTime] = useState(first ? hhmm(first.start_time) : "09:00");
  const [endTime, setEndTime] = useState(first ? hhmm(first.end_time) : "10:00");

  const [instructors, setInstructors] = useState<ApiInstructor[]>([]);
  const [rooms, setRooms] = useState<ApiRoom[]>([]);
  const [refLoading, setRefLoading] = useState(true);

  const [instructorId, setInstructorId] = useState("");
  const [locationId, setLocationId] = useState(request.location.id);
  const [roomId, setRoomId] = useState("");
  const [instructorPay, setInstructorPay] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Partner must be a member before a 2on1 can be scheduled (BE enforces too).
  const partnerBlocked =
    request.session_type === "2on1" && !request.co_client?.clientId;

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    setRefLoading(true);
    void (async () => {
      try {
        const [ins, rm] = await Promise.all([
          api.get<{ instructors: ApiInstructor[] }>("/portal/admin/instructors"),
          api.get<{ rooms: ApiRoom[] }>("/portal/admin/rooms"),
        ]);
        if (cancelled) return;
        const activeIns = ins.instructors.filter((i) => !i.archived_at);
        setInstructors(activeIns);
        setRooms(rm.rooms.filter((r) => !r.archived_at));
        setInstructorId((prev) => prev || activeIns[0]?.id || "");
      } finally {
        if (!cancelled) setRefLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const activeLocations = useMemo(
    () => accessibleLocations.filter((l) => !l.archivedAt),
    [accessibleLocations],
  );
  const roomsForLocation = useMemo(
    () => rooms.filter((r) => r.location_id === locationId),
    [rooms, locationId],
  );
  useEffect(() => {
    if (!roomsForLocation.some((r) => r.id === roomId)) {
      setRoomId(roomsForLocation[0]?.id ?? "");
    }
  }, [roomsForLocation, roomId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!api || partnerBlocked || saving) return;
    if (!instructorId || !locationId || !roomId) {
      setErr("Pick an instructor, location, and room.");
      return;
    }
    const startsAt = new Date(`${date}T${startTime}:00`);
    const endsAt = new Date(`${date}T${endTime}:00`);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      setErr("Pick a valid date and time.");
      return;
    }
    if (endsAt <= startsAt) {
      setErr("End time must be after start time.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await api.post(`/portal/admin/pt-sessions/${request.id}/schedule`, {
        instructor_id: instructorId,
        location_id: locationId,
        room_id: roomId,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        instructor_pay_sgd:
          instructorPay.trim() === "" ? undefined : Number(instructorPay),
      });
      onScheduled();
    } catch (e) {
      const code =
        e instanceof ApiError &&
        e.body &&
        typeof e.body === "object" &&
        "error" in e.body
          ? String((e.body as { error: unknown }).error)
          : "";
      setErr(SCHEDULE_ERROR[code] ?? "Couldn't schedule the session. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Schedule PT session">
      <form className="space-y-4" onSubmit={handleSubmit}>
        {partnerBlocked && (
          <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
            Partner ({request.co_client?.name ?? request.co_client?.email ?? "—"}) is
            not a member yet. Create the partner&apos;s client account first, then
            re-open this dialog.
          </div>
        )}
        {request.slots.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Proposed slots:</span>
            {request.slots.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setDate(s.proposed_date);
                  setStartTime(hhmm(s.start_time));
                  setEndTime(hhmm(s.end_time));
                }}
                className="rounded-full border border-border bg-card px-2.5 py-1 text-xs hover:border-accent/40"
              >
                {s.proposed_date} · {s.start_time}–{s.end_time}
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Date</Label>
            <Input
              type="date"
              min={todayIso()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Session type</Label>
            <div className="rounded-md border border-border bg-paper px-3 py-2 text-sm text-muted">
              {request.session_type === "1on1" ? "1-on-1" : "2-on-1"}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Start time</Label>
            <Input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>End time</Label>
            <Input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Instructor</Label>
            <select
              value={instructorId}
              disabled={refLoading}
              onChange={(e) => setInstructorId(e.target.value)}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm disabled:opacity-50"
            >
              <option value="">Select…</option>
              {instructors.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Location</Label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <option value="">Select…</option>
              {activeLocations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Room</Label>
            <select
              value={roomId}
              disabled={refLoading || !locationId}
              onChange={(e) => setRoomId(e.target.value)}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm disabled:opacity-50"
            >
              <option value="">{locationId ? "Select room…" : "Pick a location first"}</option>
              {roomsForLocation.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Instructor pay (S$)</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              placeholder="Optional"
              value={instructorPay}
              onChange={(e) => setInstructorPay(e.target.value)}
            />
          </div>
        </div>
        {err && (
          <p className="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
            {err}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={partnerBlocked || saving || refLoading}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Scheduling…" : "Schedule session"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
