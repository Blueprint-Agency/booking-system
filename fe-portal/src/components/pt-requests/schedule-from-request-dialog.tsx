"use client";
import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, DialogFooter, Input, Label } from "@/components/ui";
import { todayIso } from "@/lib/formatters";
import { instructors, locations, rooms } from "@/data";
import { CapacityFields } from "@/components/schedule/capacity-fields";
import type { Capacity, PtRequest } from "@/types";

export type SchedulePayload = {
  date: string;
  startTime: string;
  endTime: string;
  instructorId: string;
  locationId: string;
  roomId: string;
  capacity: Capacity;
};

export function ScheduleFromRequestDialog({
  request,
  onConfirm,
  onClose,
}: {
  request: PtRequest;
  onConfirm: (payload: SchedulePayload) => void;
  onClose: () => void;
}) {
  const first = request.slots[0];
  const [date, setDate] = useState(first.proposedDate);
  const [startTime, setStartTime] = useState(first.startTime);
  const [endTime, setEndTime] = useState(first.endTime);

  const activeInstructors = instructors.filter((i) => !i.archivedAt);
  const activeLocations = locations.filter((l) => !l.archivedAt);

  // No `preferredInstructorId` to pre-fill from — admin picks from scratch.
  const [instructorId, setInstructorId] = useState(activeInstructors[0]?.id ?? "");
  const [locationId, setLocationId] = useState(activeLocations[0]?.id ?? "");
  const roomsForLocation = useMemo(
    () => rooms.filter((r) => !r.archivedAt && r.locationId === locationId),
    [locationId],
  );
  const [roomId, setRoomId] = useState(roomsForLocation[0]?.id ?? "");
  // Keep the selected room valid as the location changes.
  useEffect(() => {
    if (!roomsForLocation.some((r) => r.id === roomId)) {
      setRoomId(roomsForLocation[0]?.id ?? "");
    }
  }, [roomsForLocation, roomId]);
  const [capacity, setCapacity] = useState<Capacity>(
    request.sessionType === "1on1"
      ? { waitlist: 0, onlineBooking: 1, buffer: 0 }
      : { waitlist: 0, onlineBooking: 2, buffer: 0 },
  );

  // Block scheduling for 2on1 when the partner is not yet a member.
  const partnerBlocked =
    request.sessionType === "2on1" && !request.coClientId;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Schedule PT session">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (partnerBlocked) return;
          onConfirm({
            date,
            startTime,
            endTime,
            instructorId,
            locationId,
            roomId,
            capacity,
          });
        }}
      >
        {partnerBlocked && (
          <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
            Partner ({request.coClientName ?? request.coClientEmail ?? "—"}) is
            not a member yet. Create the partner&apos;s client account first,
            then re-open this dialog.
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
                  setDate(s.proposedDate);
                  setStartTime(s.startTime);
                  setEndTime(s.endTime);
                }}
                className="rounded-full border border-border bg-card px-2.5 py-1 text-xs hover:border-accent/40"
              >
                {s.proposedDate} · {s.startTime}–{s.endTime}
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
              {request.sessionType === "1on1" ? "1-on-1" : "2-on-1"}
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
              onChange={(e) => setInstructorId(e.target.value)}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              {activeInstructors.map((i) => (
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
              onChange={(e) => setRoomId(e.target.value)}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <option value="">Select room…</option>
              {roomsForLocation.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <CapacityFields value={capacity} onChange={setCapacity} />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={partnerBlocked}>
            Schedule session
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
