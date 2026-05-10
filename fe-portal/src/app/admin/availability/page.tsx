"use client";
import { useState, useMemo } from "react";
import { Plus, Trash2, Repeat, Calendar } from "lucide-react";
import { Avatar, Badge, Button, Input, Label, PageHeader, Dialog, DialogFooter } from "@/components/ui";
import {
  instructors,
  availabilityRecurring as seedRecurring,
  availabilityOneOff as seedOneOff,
  classInstances,
  ptSessions,
} from "@/data";
import { computeEventState } from "@/lib/event-state";
import { classTypeName, locationName } from "@/lib/schedule-helpers";
import { formatDate, formatTime } from "@/lib/formatters";
import type { AvailabilityRecurring, AvailabilityOneOff } from "@/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function AvailabilityPage() {
  const [instructorId, setInstructorId] = useState(instructors[0]?.id ?? "");
  const [recurring, setRecurring] = useState<AvailabilityRecurring[]>(seedRecurring);
  const [oneOff, setOneOff] = useState<AvailabilityOneOff[]>(seedOneOff);
  const [dialog, setDialog] = useState<"recurring" | "oneoff" | null>(null);

  const instructor = instructors.find((i) => i.id === instructorId);
  const myRecurring = recurring.filter((r) => r.instructorId === instructorId);
  const myOneOff = oneOff.filter((r) => r.instructorId === instructorId);

  // Show overlapping assignments — classes + confirmed PT
  const upcomingAssignments = useMemo(() => {
    const cls = classInstances
      .filter((c) => c.instructorId === instructorId)
      .map((c) => ({
        kind: "class" as const,
        id: c.id,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        label: classTypeName(c.classTypeId),
        location: locationName(c.locationId),
        eventState: computeEventState({
          startsAt: c.startsAt,
          endsAt: c.endsAt,
          lifecycle: c.lifecycle,
        }),
      }));
    const pt = ptSessions
      .filter((s) => s.instructorId === instructorId && s.status === "confirmed")
      .map((s) => ({
        kind: "pt" as const,
        id: s.id,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        label: `PT (${s.sessionType === "1on1" ? "1-on-1" : "2-on-1"})`,
        location: locationName(s.locationId),
        eventState: computeEventState({
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          lifecycle: "active",
        }),
      }));
    return [...cls, ...pt]
      .filter((a) => a.eventState !== "completed")
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }, [instructorId]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Instructor Availability"
        description="Admin sets availability on behalf of instructors. Recurring slots cover the typical week; one-off slots add specific dates and times."
      />

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-soft">
        <span className="text-xs font-medium uppercase tracking-wider text-muted">Instructor</span>
        <div className="flex flex-wrap gap-1.5">
          {instructors
            .filter((i) => !i.archivedAt)
            .map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => setInstructorId(i.id)}
                className={`flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                  instructorId === i.id
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-paper text-muted hover:bg-warm hover:text-ink"
                }`}
              >
                <Avatar name={i.name} size={20} />
                {i.name.split(" ")[0]}
              </button>
            ))}
        </div>
      </div>

      {instructor && (
        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-card shadow-soft">
            <header className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="flex items-center gap-2">
                <Repeat className="h-4 w-4 text-muted" />
                <h2 className="text-sm font-semibold text-ink">Recurring weekly slots</h2>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setDialog("recurring")}>
                <Plus className="h-3.5 w-3.5" /> Add slot
              </Button>
            </header>
            {myRecurring.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-muted">
                No recurring availability for this instructor.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {myRecurring.map((slot) => (
                  <li key={slot.id} className="flex items-center gap-4 px-5 py-2.5">
                    <Badge tone="cyan">{WEEKDAYS[slot.weekday]}</Badge>
                    <span className="font-mono text-sm text-ink">
                      {slot.startTime} – {slot.endTime}
                    </span>
                    <div className="flex-1" />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setRecurring((p) => p.filter((r) => r.id !== slot.id))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card shadow-soft">
            <header className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted" />
                <h2 className="text-sm font-semibold text-ink">One-off slots</h2>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setDialog("oneoff")}>
                <Plus className="h-3.5 w-3.5" /> Add slot
              </Button>
            </header>
            {myOneOff.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-muted">
                No one-off slots configured.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {myOneOff.map((slot) => (
                  <li key={slot.id} className="flex items-center gap-4 px-5 py-2.5">
                    <span className="text-sm text-ink">{formatDate(slot.startsAt)}</span>
                    <span className="font-mono text-sm text-muted">
                      {formatTime(slot.startsAt)} – {formatTime(slot.endsAt)}
                    </span>
                    <div className="flex-1" />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setOneOff((p) => p.filter((r) => r.id !== slot.id))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card shadow-soft">
            <header className="border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold text-ink">Upcoming assignments</h2>
              <p className="text-xs text-muted">
                Classes, workshops, and confirmed PT sessions occupy availability slots.
              </p>
            </header>
            {upcomingAssignments.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-muted">
                Nothing on the calendar.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {upcomingAssignments.map((a) => (
                  <li
                    key={`${a.kind}-${a.id}`}
                    className="flex items-center gap-4 px-5 py-2.5"
                  >
                    <Badge tone={a.kind === "class" ? "cyan" : "accent"}>
                      {a.kind === "class" ? "Class" : "Private"}
                    </Badge>
                    <span className="text-sm text-ink">{a.label}</span>
                    <span className="text-xs text-muted">
                      {formatDate(a.startsAt)} · {formatTime(a.startsAt)}–
                      {formatTime(a.endsAt)}
                    </span>
                    <span className="text-xs text-muted">{a.location}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {dialog === "recurring" && (
        <RecurringDialog
          instructorId={instructorId}
          onSave={(slot) => {
            setRecurring((p) => [...p, slot]);
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === "oneoff" && (
        <OneOffDialog
          instructorId={instructorId}
          onSave={(slot) => {
            setOneOff((p) => [...p, slot]);
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function RecurringDialog({
  instructorId,
  onSave,
  onClose,
}: {
  instructorId: string;
  onSave: (slot: AvailabilityRecurring) => void;
  onClose: () => void;
}) {
  const [weekday, setWeekday] = useState(1);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("12:00");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Add recurring slot">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            id: `av-r-${Date.now().toString(36)}`,
            instructorId,
            weekday,
            startTime,
            endTime,
          });
        }}
        className="space-y-4"
      >
        <div className="space-y-1.5">
          <Label>Weekday</Label>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d, i) => (
              <button
                key={d}
                type="button"
                onClick={() => setWeekday(i)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  weekday === i
                    ? "bg-accent text-white"
                    : "bg-paper text-muted hover:bg-warm hover:text-ink"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Start</Label>
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>End</Label>
            <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit">Add slot</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function OneOffDialog({
  instructorId,
  onSave,
  onClose,
}: {
  instructorId: string;
  onSave: (slot: AvailabilityOneOff) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("12:00");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Add one-off slot">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // Build local datetime; in production use proper TZ handling
          const startsAt = new Date(`${date}T${startTime}:00+08:00`).toISOString();
          const endsAt = new Date(`${date}T${endTime}:00+08:00`).toISOString();
          onSave({
            id: `av-o-${Date.now().toString(36)}`,
            instructorId,
            startsAt,
            endsAt,
          });
        }}
        className="space-y-4"
      >
        <div className="space-y-1.5">
          <Label>Date</Label>
          <Input required type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Start time</Label>
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>End time</Label>
            <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit">Add slot</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
