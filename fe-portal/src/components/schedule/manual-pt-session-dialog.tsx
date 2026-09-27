"use client";
// Add manually (#336): a private session staff put on the Schedule with its
// members, no member request behind it. The form is the class form's Location,
// room, time, instructor and pay fields plus the PT type; below it a member
// search and roster like the class roster's, each member paying one session
// from a package of their own. Shared by the admin timetable and the
// instructor's schedule — `role` picks the routes, and an Instructor runs the
// session themselves and leaves pay to an admin, as on their class form.

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button, Dialog, DialogFooter, Input, Label } from "@/components/ui";
import { LocationRoomFields } from "@/components/schedule/location-room-fields";
import { InstructorOption, useInstructorsOnLeave } from "@/components/schedule/instructor-leave";
import { MemberSearch, SeatRowView, toSeat, type SeatRow } from "@/components/schedule/pt-seat";
import { useWorkspace } from "@/lib/workspace-context";
import { currentHourTime, todayIso } from "@/lib/formatters";
import { ApiError } from "@/lib/api";
import { PAY_OPTIONAL_HINT } from "@/lib/pay";
import { fetchActiveInstructors, fetchActiveRooms, type CatalogInstructor, type CatalogRoom } from "@/lib/catalog";
import type { MemberMatch, StaffRole } from "@/lib/class-seats";
import type { Slot } from "@/lib/schedule";
import {
  createManualSession,
  fetchSeatCandidates,
  manualSessionBody,
  manualSessionErrorMessage,
  seatChoice,
  seatLimit,
  seatReadErrorMessage,
  sessionTypeLabel,
  type PtSessionType,
} from "@/lib/pt-manual";

const SELECT_CLASS =
  "flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50";

export function ManualPtSessionDialog({
  role,
  slot,
  onClose,
  onCreated,
}: {
  role: StaffRole;
  /** Slot picked off the timetable grid, seeding the date and times. */
  slot?: Slot;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { api, activeLocationId, currentStaff } = useWorkspace();

  const [sessionType, setSessionType] = useState<PtSessionType>("1on1");
  const [date, setDate] = useState(slot?.date ?? todayIso());
  const [startTime, setStartTime] = useState(slot?.start ?? currentHourTime());
  const [endTime, setEndTime] = useState(slot?.end ?? currentHourTime(1));
  const [instructorId, setInstructorId] = useState("");
  const [locationId, setLocationId] = useState(activeLocationId ?? "");
  const [roomId, setRoomId] = useState("");
  const [pay, setPay] = useState("");

  const [instructors, setInstructors] = useState<CatalogInstructor[]>([]);
  const [rooms, setRooms] = useState<CatalogRoom[]>([]);
  const [refLoading, setRefLoading] = useState(true);
  const [refError, setRefError] = useState<string | null>(null);

  const [seats, setSeats] = useState<SeatRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const onLeave = useInstructorsOnLeave(role === "admin" ? date : "");

  // An Instructor runs the session themselves; the route ignores anyone else.
  const sessionInstructorId = role === "admin" ? instructorId : (currentStaff?.id ?? "");
  const shape = `${sessionType}|${sessionInstructorId}`;

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    setRefLoading(true);
    void (async () => {
      try {
        if (role === "admin") {
          const [ins, rm] = await Promise.all([fetchActiveInstructors(api), fetchActiveRooms(api)]);
          if (cancelled) return;
          setInstructors(ins);
          setRooms(rm);
        } else {
          const rm = await api.get<{ rooms: CatalogRoom[] }>("/portal/instructor/catalog/rooms");
          if (!cancelled) setRooms(rm.rooms);
        }
      } catch (e) {
        if (!cancelled) setRefError(e instanceof ApiError ? `HTTP ${e.status}` : "Network error");
      } finally {
        if (!cancelled) setRefLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, role]);

  useEffect(() => {
    setLocationId((prev) => prev || activeLocationId || "");
  }, [activeLocationId]);

  /**
   * Read one member's packages for the session as it is now. A reply for a
   * shape since changed (the type or instructor moved on) is dropped: the
   * re-read for the new shape is already on its way.
   */
  const read = useCallback(
    async (member: MemberMatch, forShape: string, type: PtSessionType, forInstructor: string) => {
      if (!api) return;
      if (!forInstructor) {
        setSeats((prev) =>
          prev.map((r) =>
            r.member.id === member.id
              ? { ...r, shape: forShape, state: "waiting", candidates: null, choice: null, chosen: null, accepted: false, error: null }
              : r,
          ),
        );
        return;
      }
      setSeats((prev) =>
        prev.map((r) => (r.member.id === member.id ? { ...r, shape: forShape, state: "loading", error: null } : r)),
      );
      try {
        const candidates = await fetchSeatCandidates(api, role, {
          clientId: member.id,
          sessionType: type,
          instructorId: forInstructor,
        });
        const choice = seatChoice(candidates);
        setSeats((prev) =>
          prev.map((r) =>
            r.member.id === member.id && r.shape === forShape
              ? { ...r, state: "ready", candidates, choice, chosen: choice.defaultId, accepted: false, error: null }
              : r,
          ),
        );
      } catch (e) {
        setSeats((prev) =>
          prev.map((r) =>
            r.member.id === member.id && r.shape === forShape
              ? { ...r, state: "error", candidates: null, choice: null, chosen: null, accepted: false, error: seatReadErrorMessage(e) }
              : r,
          ),
        );
      }
    },
    [api, role],
  );

  // Changing the type or instructor changes what each package may pay for:
  // re-read every member's candidates.
  const seatsRef = useRef(seats);
  useEffect(() => {
    seatsRef.current = seats;
  }, [seats]);
  useEffect(() => {
    for (const r of seatsRef.current) {
      if (r.shape !== shape) void read(r.member, shape, sessionType, sessionInstructorId);
    }
  }, [shape, sessionType, sessionInstructorId, read]);

  function addMember(m: MemberMatch) {
    if (seats.some((r) => r.member.id === m.id) || seats.length >= seatLimit(sessionType)) return;
    setSeats((prev) => [
      ...prev,
      { member: m, shape, state: "loading", candidates: null, choice: null, chosen: null, accepted: false, error: null },
    ]);
    setErr(null);
    void read(m, shape, sessionType, sessionInstructorId);
  }

  function removeMember(id: string) {
    setSeats((prev) => prev.filter((r) => r.member.id !== id));
    setErr(null);
  }

  function updateSeat(id: string, patch: Partial<SeatRow>) {
    setSeats((prev) => prev.map((r) => (r.member.id === id ? { ...r, ...patch } : r)));
    setErr(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!api || saving) return;
    const body = manualSessionBody(
      { sessionType, instructorId, locationId, roomId, date, startTime, endTime, pay },
      seats.map((r) => toSeat(r, sessionType)),
      role,
    );
    if (typeof body === "string") {
      setErr(body);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await createManualSession(api, role, body);
      onCreated();
    } catch (e) {
      setErr(manualSessionErrorMessage(e));
      // A package that changed under the form: read that member again so the
      // row shows what it now needs.
      const refused = e instanceof ApiError ? (e.body as { client_id?: string } | null)?.client_id : undefined;
      const row = refused ? seats.find((r) => r.member.id === refused) : undefined;
      if (row) void read(row.member, shape, sessionType, sessionInstructorId);
    } finally {
      setSaving(false);
    }
  }

  const limit = seatLimit(sessionType);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Add a PT session manually" className="max-w-2xl">
      <form className="space-y-5" onSubmit={handleSubmit}>
        {refError && (
          <p className="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
            Failed to load catalog: {refError}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="manual-pt-type">Session type</Label>
            <select
              id="manual-pt-type"
              value={sessionType}
              onChange={(e) => setSessionType(e.target.value as PtSessionType)}
              className={SELECT_CLASS}
            >
              <option value="1on1">1-on-1</option>
              <option value="2on1">2-on-1</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-pt-date">Date</Label>
            <Input
              id="manual-pt-date"
              type="date"
              required
              min={todayIso()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-pt-start">Start time</Label>
            <Input
              id="manual-pt-start"
              type="time"
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-pt-end">End time</Label>
            <Input
              id="manual-pt-end"
              type="time"
              required
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-pt-instructor">Instructor</Label>
            {role === "admin" ? (
              <select
                id="manual-pt-instructor"
                value={instructorId}
                required
                disabled={refLoading}
                onChange={(e) => setInstructorId(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">Select…</option>
                {instructors.map((i) => (
                  <InstructorOption key={i.id} instructor={i} onLeave={onLeave} startTime={startTime} />
                ))}
              </select>
            ) : (
              <div
                id="manual-pt-instructor"
                className="rounded-md border border-border bg-paper px-3 py-2 text-sm text-muted"
              >
                {currentStaff?.name ?? "You"} (you)
              </div>
            )}
          </div>
          {role === "admin" ? (
            <div className="space-y-1.5">
              <Label htmlFor="manual-pt-pay">Instructor pay (S$) · optional</Label>
              <Input
                id="manual-pt-pay"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={pay}
                onChange={(e) => setPay(e.target.value)}
                aria-describedby="manual-pt-pay-hint"
              />
              <p id="manual-pt-pay-hint" className="text-xs text-muted">
                {PAY_OPTIONAL_HINT}
              </p>
            </div>
          ) : (
            <p className="self-end text-xs text-muted">Pay is left for an admin to set later.</p>
          )}
          <LocationRoomFields
            idPrefix="manual-pt"
            rooms={rooms}
            locationId={locationId}
            roomId={roomId}
            onLocationChange={setLocationId}
            onRoomChange={setRoomId}
            disabled={refLoading}
          />
        </div>

        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink">Members</h3>
            <span className="text-xs text-muted">
              {seats.length} / {limit} · a {sessionTypeLabel(sessionType)} seats {limit === 1 ? "one member" : "two"}
            </span>
          </div>
          {seats.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {seats.map((r) => (
                <SeatRowView
                  key={r.member.id}
                  row={r}
                  sessionType={sessionType}
                  onRemove={() => removeMember(r.member.id)}
                  onChoose={(chosen) => updateSeat(r.member.id, { chosen, accepted: false })}
                  onAccept={(accepted) => updateSeat(r.member.id, { accepted })}
                />
              ))}
            </ul>
          )}
          {seats.length < limit && (
            <MemberSearch role={role} added={seats.map((r) => r.member.id)} onAdd={addMember} />
          )}
        </section>

        {err && (
          <p role="alert" className="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
            {err}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || refLoading || seats.length === 0}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Saving…" : "Create session"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
