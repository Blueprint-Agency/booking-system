"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck, Loader2, X } from "lucide-react";
import { Button, EmptyState, Label, PageHeader } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import { formatRelative } from "@/lib/formatters";
import { toast } from "sonner";

interface PtSlot {
  proposed_date: string;
  start_time: string;
  end_time: string;
}
interface InstructorPtRequest {
  id: string;
  status: string;
  session_type: "1on1" | "2on1";
  message: string | null;
  created_at: string;
  expires_at: string;
  client: { id: string; name: string; email: string };
  class_type: { id: string; name: string };
  location: { id: string; name: string };
  co_client: { clientId: string | null; name: string | null; email: string | null } | null;
  slots: PtSlot[];
}
interface ApiRoom {
  id: string;
  location_id: string;
  name: string;
}

export default function InstructorPtRequestsPage() {
  const { api } = useWorkspace();
  const [requests, setRequests] = useState<InstructorPtRequest[]>([]);
  const [rooms, setRooms] = useState<ApiRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [schedId, setSchedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const [res, rm] = await Promise.all([
        api.get<{ pt_requests: InstructorPtRequest[] }>(
          "/portal/instructor/pt-requests",
        ),
        api.get<{ rooms: ApiRoom[] }>("/portal/instructor/catalog/rooms"),
      ]);
      setRequests(res.pt_requests ?? []);
      setRooms(rm.rooms ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="PT requests"
        description="The shared queue of pending private-session requests. Pick one up by scheduling it — it's assigned to you automatically."
      />

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          Failed to load requests: {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : requests.length === 0 ? (
        <EmptyState
          title="No pending requests"
          description="When a member requests a private session, it shows up here for any instructor to pick up."
        />
      ) : (
        <ul className="space-y-3">
          {requests.map((r) => {
            const roomsForLoc = rooms.filter((rm) => rm.location_id === r.location.id);
            return (
              <li
                key={r.id}
                className="rounded-xl border border-border bg-card shadow-soft"
              >
                <div className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="font-medium text-ink">{r.client.name}</div>
                    <div className="text-xs text-muted">
                      {r.session_type === "2on1" ? "2-on-1" : "1-on-1"} ·{" "}
                      {r.class_type.name} · {r.location.name}
                      {r.co_client
                        ? ` · partner: ${r.co_client.name ?? r.co_client.email ?? "needs account"}`
                        : ""}
                    </div>
                    {r.message && (
                      <p className="mt-1 text-xs text-ink/80">“{r.message}”</p>
                    )}
                    {r.slots.length > 0 && (
                      <div className="mt-1 text-xs text-muted">
                        Prefers:{" "}
                        {r.slots
                          .map((s) => `${s.proposed_date} ${s.start_time}–${s.end_time}`)
                          .join(", ")}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="text-xs text-muted">
                      {formatRelative(r.created_at)}
                    </span>
                    {schedId !== r.id && (
                      <Button size="sm" onClick={() => setSchedId(r.id)}>
                        <CalendarCheck className="h-3.5 w-3.5" /> Schedule
                      </Button>
                    )}
                  </div>
                </div>

                {schedId === r.id && (
                  <ScheduleForm
                    request={r}
                    rooms={roomsForLoc}
                    onClose={() => setSchedId(null)}
                    onScheduled={() => {
                      setSchedId(null);
                      void load();
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ScheduleForm({
  request,
  rooms,
  onClose,
  onScheduled,
}: {
  request: InstructorPtRequest;
  rooms: ApiRoom[];
  onClose: () => void;
  onScheduled: () => void;
}) {
  const { api } = useWorkspace();
  const first = request.slots[0];
  const [roomId, setRoomId] = useState("");
  const [date, setDate] = useState(first?.proposed_date ?? "");
  const [startTime, setStartTime] = useState(first?.start_time?.slice(0, 5) ?? "");
  const [endTime, setEndTime] = useState(first?.end_time?.slice(0, 5) ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => Boolean(roomId && date && startTime && endTime),
    [roomId, date, startTime, endTime],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!api || !canSubmit) return;
    const startsAt = new Date(`${date}T${startTime}:00`);
    const endsAt = new Date(`${date}T${endTime}:00`);
    if (endsAt <= startsAt) {
      setErr("End time must be after start time.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await api.post(`/portal/instructor/pt-requests/${request.id}/schedule`, {
        location_id: request.location.id,
        room_id: roomId,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
      });
      toast.success("Session scheduled — assigned to you");
      onScheduled();
    } catch (e2) {
      const status = e2 instanceof ApiError ? e2.status : 0;
      const body = e2 instanceof ApiError ? (e2.body as { error?: string } | null) : null;
      if (status === 409 && body?.error === "room_conflict")
        setErr("That room is booked for an overlapping time.");
      else if (status === 409 && body?.error === "instructor_conflict")
        setErr("You already have a session overlapping that time.");
      else if (status === 409 && body?.error === "not_pending")
        setErr("This request was already taken or cancelled.");
      else if (status === 422)
        setErr("The 2-on-1 partner needs a member account before this can be scheduled.");
      else setErr(status ? `Couldn't schedule (HTTP ${status})` : "Network error");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="border-t border-border bg-paper/50 px-4 py-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-ink">Schedule this session</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-muted hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`room-${request.id}`}>Room ({request.location.name})</Label>
          <select
            id={`room-${request.id}`}
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">{rooms.length ? "Select…" : "No rooms at this location"}</option>
            {rooms.map((rm) => (
              <option key={rm.id} value={rm.id}>
                {rm.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`date-${request.id}`}>Date</Label>
          <input
            id={`date-${request.id}`}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={`start-${request.id}`}>Start</Label>
            <input
              id={`start-${request.id}`}
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`end-${request.id}`}>End</Label>
            <input
              id={`end-${request.id}`}
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
        </div>
      </div>

      {err && <p className="mt-2 text-xs text-error">{err}</p>}

      <div className="mt-3 flex justify-end">
        <Button type="submit" size="sm" disabled={submitting || !canSubmit}>
          {submitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CalendarCheck className="h-3.5 w-3.5" />
          )}
          Confirm
        </Button>
      </div>
    </form>
  );
}
