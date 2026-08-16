"use client";
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button, Dialog, DialogFooter, Input, Label } from "@/components/ui";
import { todayIso } from "@/lib/formatters";
import { ApiError } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import {
  fetchActiveInstructors,
  fetchActiveRooms,
  type CatalogInstructor,
  type CatalogRoom,
} from "@/lib/catalog";
import { scheduleErrorMessage } from "@/lib/schedule";
import {
  InstructorOption,
  useInstructorsOnLeave,
} from "@/components/schedule/instructor-leave";
import type { ApiPtRequest } from "@/lib/pt-requests";

// Codes only this dialog raises. A room or instructor clash is NOT here — it
// arrives as `schedule_conflict` carrying the specific sentence, which
// `scheduleErrorMessage` passes through.
const SCHEDULE_ERROR: Record<string, string> = {
  not_pending: "This request is no longer pending.",
  partner_account_required:
    "The partner needs a member account before this can be scheduled.",
};

const PARTNER_LINK_ERROR: Record<string, string> = {
  partner_client_not_found: "No active customer account was found for that email.",
  partner_cannot_be_requester: "The requester cannot also be the partner.",
  partner_not_active: "That partner account is not active.",
  partner_already_linked: "This request already has a linked partner.",
  pt_request_not_pending: "This request is no longer pending.",
  not_a_2on1_request: "Only 2-on-1 requests can have a linked partner.",
};

function apiErrorCode(e: unknown): string {
  return e instanceof ApiError &&
    e.body &&
    typeof e.body === "object" &&
    "error" in e.body
    ? String((e.body as { error: unknown }).error)
    : "";
}

export function ScheduleFromRequestDialog({
  request,
  onScheduled,
  onRequestUpdated,
  onClose,
}: {
  request: ApiPtRequest;
  onScheduled: () => void;
  onRequestUpdated?: (request: ApiPtRequest) => void;
  onClose: () => void;
}) {
  const { api, accessibleLocations } = useWorkspace();
  const [linkedRequest, setLinkedRequest] = useState<ApiPtRequest | null>(null);
  const currentRequest = linkedRequest ?? request;

  // Postgres `time` columns serialise as HH:MM:SS; <input type="time"> and our
  // datetime construction expect HH:MM, so normalise.
  const hhmm = (t: string) => t.slice(0, 5);
  const first = request.slots[0];
  const [date, setDate] = useState(first?.proposed_date ?? todayIso());
  const [startTime, setStartTime] = useState(first ? hhmm(first.start_time) : "09:00");
  const [endTime, setEndTime] = useState(first ? hhmm(first.end_time) : "10:00");

  const [instructors, setInstructors] = useState<CatalogInstructor[]>([]);
  const [rooms, setRooms] = useState<CatalogRoom[]>([]);
  const [refLoading, setRefLoading] = useState(true);

  const [instructorId, setInstructorId] = useState("");
  const [locationId, setLocationId] = useState(request.location.id);
  const [roomId, setRoomId] = useState("");
  const [instructorPay, setInstructorPay] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [partnerEmail, setPartnerEmail] = useState(request.co_client?.email ?? "");
  const [partnerLinking, setPartnerLinking] = useState(false);
  const [partnerLinkError, setPartnerLinkError] = useState<string | null>(null);
  const onLeave = useInstructorsOnLeave(date);

  // Partner must be a member before a 2on1 can be scheduled (BE enforces too).
  const partnerBlocked =
    currentRequest.session_type === "2on1" && !currentRequest.co_client?.clientId;

  useEffect(() => {
    setLinkedRequest(null);
    setPartnerEmail(request.co_client?.email ?? "");
    setPartnerLinkError(null);
  }, [request.id, request.co_client?.email]);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    setRefLoading(true);
    void (async () => {
      try {
        const [ins, rm] = await Promise.all([
          fetchActiveInstructors(api),
          fetchActiveRooms(api),
        ]);
        if (cancelled) return;
        setInstructors(ins);
        setRooms(rm);
        setInstructorId((prev) => prev || ins[0]?.id || "");
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
      await api.post(`/portal/admin/pt-sessions/${currentRequest.id}/schedule`, {
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
      const code = apiErrorCode(e);
      setErr(
        SCHEDULE_ERROR[code] ??
          scheduleErrorMessage(e, "Couldn't schedule the session"),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleLinkPartner() {
    if (!api || partnerLinking) return;
    const email = partnerEmail.trim();
    if (!email) {
      setPartnerLinkError("Enter the partner's account email.");
      return;
    }
    setPartnerLinking(true);
    setPartnerLinkError(null);
    try {
      const res = await api.post<{ pt_request: ApiPtRequest | null }>(
        `/portal/admin/pt-sessions/${currentRequest.id}/link-partner`,
        { email },
      );
      if (res.pt_request) {
        setLinkedRequest(res.pt_request);
        onRequestUpdated?.(res.pt_request);
      }
    } catch (e) {
      const code = apiErrorCode(e);
      setPartnerLinkError(PARTNER_LINK_ERROR[code] ?? "Couldn't link the partner.");
    } finally {
      setPartnerLinking(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Schedule PT session">
      <form className="space-y-4" onSubmit={handleSubmit}>
        {partnerBlocked && (
          <div className="space-y-3 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
            <p>
              Partner ({currentRequest.co_client?.name ?? currentRequest.co_client?.email ?? "—"}) is
              not linked to a member account yet.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="email"
                value={partnerEmail}
                onChange={(e) => setPartnerEmail(e.target.value)}
                placeholder="partner@email.com"
              />
              <Button type="button" onClick={handleLinkPartner} disabled={partnerLinking}>
                {partnerLinking && <Loader2 className="h-4 w-4 animate-spin" />}
                {partnerLinking ? "Linking…" : "Link partner"}
              </Button>
            </div>
            {partnerLinkError && <p className="text-error">{partnerLinkError}</p>}
          </div>
        )}
        {currentRequest.slots.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Proposed slots:</span>
            {currentRequest.slots.map((s, i) => (
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
              {currentRequest.session_type === "1on1" ? "1-on-1" : "2-on-1"}
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
                <InstructorOption
                  key={i.id}
                  instructor={i}
                  onLeave={onLeave}
                  startTime={startTime}
                />
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
