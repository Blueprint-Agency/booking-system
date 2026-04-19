"use client";

import { useState } from "react";
import type { Instructor, Location, Session } from "@/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { generateInstancesFromTemplate } from "@/lib/schedule";
import { createSessionInstances } from "@/lib/mock-state";

const DAYS = [
  { v: 1, l: "Mon" },
  { v: 2, l: "Tue" },
  { v: 3, l: "Wed" },
  { v: 4, l: "Thu" },
  { v: 5, l: "Fri" },
  { v: 6, l: "Sat" },
  { v: 0, l: "Sun" },
] as const;

export function CreateClassModal({
  open,
  onClose,
  instructors,
  locations,
  tenantId,
}: {
  open: boolean;
  onClose: () => void;
  instructors: Instructor[];
  locations: Location[];
  tenantId: string;
}) {
  const [name, setName] = useState("Vinyasa");
  const [category, setCategory] = useState("Vinyasa");
  const [level, setLevel] = useState<Session["level"]>("all");
  const [instructorId, setInstructorId] = useState(instructors[0]?.id ?? "");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [dayOfWeek, setDayOfWeek] = useState<0 | 1 | 2 | 3 | 4 | 5 | 6>(1);
  const [time, setTime] = useState("07:00");
  const [duration, setDuration] = useState(60);
  const [capacity, setCapacity] = useState(15);
  const [weeks, setWeeks] = useState(12);

  const submit = () => {
    const instances = generateInstancesFromTemplate({
      tenantId,
      locationId,
      name,
      category,
      level,
      instructorId,
      dayOfWeek,
      time,
      duration,
      capacity,
      weeks,
    });
    createSessionInstances(instances);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Create recurring class">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label htmlFor="cc-name">Class name</Label>
          <Input id="cc-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="cc-cat">Category</Label>
          <Input id="cc-cat" value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="cc-level">Level</Label>
          <Select
            id="cc-level"
            value={level}
            onChange={(e) => setLevel(e.target.value as Session["level"])}
          >
            <option value="all">All</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="cc-inst">Instructor</Label>
          <Select id="cc-inst" value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
            {instructors.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="cc-loc">Location</Label>
          <Select id="cc-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="cc-day">Day of week</Label>
          <Select
            id="cc-day"
            value={String(dayOfWeek)}
            onChange={(e) => setDayOfWeek(Number(e.target.value) as 0 | 1 | 2 | 3 | 4 | 5 | 6)}
          >
            {DAYS.map((d) => (
              <option key={d.v} value={d.v}>{d.l}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="cc-time">Time</Label>
          <Input id="cc-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="cc-dur">Duration (min)</Label>
          <Input id="cc-dur" type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
        </div>
        <div>
          <Label htmlFor="cc-cap">Capacity</Label>
          <Input id="cc-cap" type="number" value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
        </div>
        <div>
          <Label htmlFor="cc-weeks">Generate weeks</Label>
          <Input id="cc-weeks" type="number" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} />
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!instructorId || !locationId}>Create {weeks} instances</Button>
      </div>
    </Modal>
  );
}
