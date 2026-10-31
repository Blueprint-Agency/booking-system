"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRequestDeepLink } from "@/components/attention/deep-links";
import { useAttention } from "@/components/attention/attention-provider";
import { CalendarCheck, Loader2, X } from "lucide-react";
import { Button, EmptyState, Label, LoadFailure, PageHeader } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { answeredElsewhere, loadError, type LoadError } from "@/lib/failed-read";
import { ApiError } from "@/lib/api";
import { LATEST_DATE, formatRelative } from "@/lib/formatters";
import { scheduleErrorMessage } from "@/lib/schedule";
import { withClashConfirm } from "@/lib/time-clash";
import { toast } from "sonner";
import {
  type PtProposedSlot,
  ptClassTypeName,
  ptNoteOrNull,
  ptOffProposal,
  ptSlotEnd,
  ptSlotStart,
  ptSlotTime,
} from "@/lib/pt-requests";
import { ScheduleNoteField } from "@/components/pt-requests/schedule-note-field";

interface InstructorPtRequest {
  id: string;
  status: string;
  session_type: "1on1" | "2on1";
  message: string | null;
  created_at: string;
  expires_at: string | null;
  client: { id: string; name: string; email: string };
  class_type: { id: string; name: string } | null;
  location: { id: string; name: string };
  co_client: { clientId: string | null; name: string | null; email: string | null } | null;
  /**
   * The instructor the member's package is bound to. The queue only carries
   * requests this instructor may take, so a value here always means "bound to
   * you" — somebody else's bound request never arrives.
   */
  bound_instructor: { id: string; name: string } | null;
  slots: PtProposedSlot[];
}
interface ApiRoom {
  id: string;
  location_id: string;
  name: string;
}

// `useSearchParams` (the bell's `?request=` link) needs a Suspense boundary.
export default function InstructorPtRequestsPage() {
  return (
    <Suspense fallback={null}>
      <InstructorPtRequestsView />
    </Suspense>
  );
}

function InstructorPtRequestsView() {
  const { api } = useWorkspace();
  // The bell's count follows what this page resolves, without waiting for the next poll.
  const { refresh: refreshAttention } = useAttention();
  const [requests, setRequests] = useState<InstructorPtRequest[]>([]);
  const [rooms, setRooms] = useState<ApiRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError | null>(null);
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
      // A `401` or maintenance is answered by the sign-in and the maintenance screen.
      if (!answeredElsewhere(err)) setError(loadError(err));
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  // A link from the bell (`?request=`): this page has no drawer, so it opens
  // that request's scheduling form and brings it into view.
  useRequestDeepLink(requests, loading, (r) => {
    setSchedId(r.id);
    requestAnimationFrame(() =>
      document.getElementById(`pt-request-${r.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="PT requests"
        description="The shared queue of pending private-session requests. Pick one up by scheduling it — it's assigned to you automatically."
      />

      {/* A queue that failed to load is never drawn as "No pending requests". */}
      {error ? (
        <div className="rounded-xl border border-border bg-card shadow-soft">
          <LoadFailure
            what="the PT requests"
            detail={error.detail}
            onRetry={load}
          />
        </div>
      ) : loading ? (
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
                id={`pt-request-${r.id}`}
                className="rounded-xl border border-border bg-card shadow-soft"
              >
                {/* Stacked on a phone: the details get the full width and the
                    age + Schedule sit in a row beneath, instead of a narrow
                    column squeezing the member's message. */}
                <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 break-words font-medium text-ink">{r.client.name}</span>
                      {r.bound_instructor && (
                        <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] text-ink">
                          your member
                        </span>
                      )}
                    </div>
                    <div className="break-words text-xs text-muted">
                      {r.session_type === "2on1" ? "2-on-1" : "1-on-1"} ·{" "}
                      {ptClassTypeName(r.class_type)} · {r.location.name}
                      {r.co_client
                        ? ` · partner: ${r.co_client.name ?? r.co_client.email ?? "needs account"}`
                        : ""}
                    </div>
                    {r.message && (
                      <p className="mt-1 break-words text-xs text-ink/80">“{r.message}”</p>
                    )}
                    {r.slots.length > 0 && (
                      <div className="mt-1 break-words text-xs text-muted">
                        Prefers:{" "}
                        {r.slots
                          .map((s) => `${s.proposed_date} ${ptSlotTime(s)}`)
                          .join(", ")}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center justify-between gap-2 sm:flex-col sm:items-end">
                    <span className="text-xs text-muted">
                      {formatRelative(r.created_at)}
                    </span>
                    {schedId !== r.id && (
                      <Button size="sm" className="h-10 sm:h-8" onClick={() => setSchedId(r.id)}>
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
                      refreshAttention();
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
  const [startTime, setStartTime] = useState(first ? ptSlotStart(first) : "");
  const [endTime, setEndTime] = useState(first ? ptSlotEnd(first) : "");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const offProposal = ptOffProposal(request.slots, date, startTime, endTime);

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
      // A member booked elsewhere at this time is asked about first.
      await withClashConfirm("session", (extra) =>
        api.post(`/portal/instructor/pt-requests/${request.id}/schedule`, {
          location_id: request.location.id,
          room_id: roomId,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          note: offProposal ? ptNoteOrNull(note) : null,
          ...extra,
        }),
      );
      toast.success("Session scheduled — assigned to you");
      onScheduled();
    } catch (e2) {
      const status = e2 instanceof ApiError ? e2.status : 0;
      const body = e2 instanceof ApiError ? (e2.body as { error?: string } | null) : null;
      if (status === 409 && body?.error === "not_pending")
        setErr("This request was already taken or cancelled.");
      else if (body?.error === "pt_request_bound_to_other_instructor")
        setErr(
          "This member's package is bound to another instructor. Ask an admin to schedule it.",
        );
      else if (status === 422)
        setErr("The 2-on-1 partner needs a member account before this can be scheduled.");
      // A clash names the room or instructor and the event in the way — that
      // sentence comes from the backend, so pass it straight through.
      else setErr(scheduleErrorMessage(e2, "Couldn't schedule"));
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
          className="-m-2 rounded-md p-2 text-muted hover:text-ink"
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
            max={LATEST_DATE}
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

      {offProposal && (
        <div className="mt-3">
          <ScheduleNoteField
            id={`note-${request.id}`}
            value={note}
            onChange={setNote}
            disabled={submitting}
          />
        </div>
      )}

      {err && <p className="mt-2 text-xs text-error">{err}</p>}

      <div className="mt-3 flex justify-end">
        <Button
          type="submit"
          size="sm"
          className="h-10 w-full sm:h-8 sm:w-auto"
          disabled={submitting || !canSubmit}
        >
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
