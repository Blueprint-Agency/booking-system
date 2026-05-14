"use client";
import { useState } from "react";
import { Button, Dialog, DialogFooter, Input, Label } from "@/components/ui";
import { instructors, locations } from "@/data";
import { CapacityFields } from "@/components/schedule/capacity-fields";
import type { Capacity, PtRequest } from "@/types";

export type SchedulePayload = {
  date: string;
  startTime: string;
  durationMinutes: number;
  instructorId: string;
  locationId: string;
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
  const first = request.preferredSlots[0];
  const [date, setDate] = useState(first.date);
  const [startTime, setStartTime] = useState(first.startTime);
  const [duration, setDuration] = useState(request.durationMinutes);
  const activeInstructors = instructors.filter((i) => !i.archivedAt);
  const activeLocations = locations.filter((l) => !l.archivedAt);
  const [instructorId, setInstructorId] = useState(
    request.preferredInstructorId ?? activeInstructors[0]?.id ?? ""
  );
  const [locationId, setLocationId] = useState(activeLocations[0]?.id ?? "");
  const [capacity, setCapacity] = useState<Capacity>(
    request.sessionType === "1on1"
      ? { waitlist: 0, onlineBooking: 1, buffer: 0 }
      : { waitlist: 0, onlineBooking: 2, buffer: 0 }
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Schedule PT session">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm({
            date,
            startTime,
            durationMinutes: duration,
            instructorId,
            locationId,
            capacity,
          });
        }}
      >
        {request.preferredSlots.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Preferred slots:</span>
            {request.preferredSlots.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setDate(s.date);
                  setStartTime(s.startTime);
                }}
                className="rounded-full border border-border bg-card px-2.5 py-1 text-xs hover:border-accent/40"
              >
                {s.date} · {s.startTime}
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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
            <Label>Duration (min)</Label>
            <Input
              type="number"
              min={30}
              step={15}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value) || 60)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Session type</Label>
            <div className="rounded-md border border-border bg-paper px-3 py-2 text-sm text-muted">
              {request.sessionType === "1on1" ? "1-on-1" : "2-on-1"}
            </div>
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
        </div>
        <CapacityFields value={capacity} onChange={setCapacity} />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Schedule session</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
