"use client";

import { useState } from "react";
import type { Instructor, Location, SessionTemplate } from "@/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { upsertSessionTemplate } from "@/lib/mock-state";

const DAYS = [
  { v: 1, l: "Mon" },
  { v: 2, l: "Tue" },
  { v: 3, l: "Wed" },
  { v: 4, l: "Thu" },
  { v: 5, l: "Fri" },
  { v: 6, l: "Sat" },
  { v: 0, l: "Sun" },
] as const;

export function TemplateForm({
  initial,
  instructors,
  locations,
  open,
  onClose,
}: {
  initial?: SessionTemplate;
  instructors: Instructor[];
  locations: Location[];
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState(initial?.category ?? "Vinyasa");
  const [level, setLevel] = useState<SessionTemplate["level"]>(initial?.level ?? "all");
  const [instructorId, setInstructorId] = useState(initial?.instructorId ?? instructors[0]?.id ?? "");
  const [locationId, setLocationId] = useState(initial?.locationId ?? locations[0]?.id ?? "");
  const [dayOfWeek, setDayOfWeek] = useState<SessionTemplate["dayOfWeek"]>(initial?.dayOfWeek ?? 1);
  const [time, setTime] = useState(initial?.time ?? "07:00");
  const [duration, setDuration] = useState(initial?.duration ?? 60);
  const [capacity, setCapacity] = useState(initial?.capacity ?? 15);
  const [creditCost, setCreditCost] = useState(initial?.creditCost ?? 1);

  const submit = () => {
    upsertSessionTemplate({
      id: initial?.id,
      name,
      category,
      level,
      instructorId,
      locationId,
      dayOfWeek,
      time,
      duration,
      capacity,
      creditCost,
      active: initial?.active ?? true,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? "Edit template" : "New class template"}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label htmlFor="tf-name">Name</Label>
          <Input id="tf-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="tf-cat">Category</Label>
          <Input id="tf-cat" value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="tf-level">Level</Label>
          <Select
            id="tf-level"
            value={level}
            onChange={(e) => setLevel(e.target.value as SessionTemplate["level"])}
          >
            <option value="all">All</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="tf-inst">Instructor</Label>
          <Select id="tf-inst" value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
            {instructors.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="tf-loc">Location</Label>
          <Select id="tf-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="tf-day">Day of week</Label>
          <Select
            id="tf-day"
            value={String(dayOfWeek)}
            onChange={(e) => setDayOfWeek(Number(e.target.value) as SessionTemplate["dayOfWeek"])}
          >
            {DAYS.map((d) => (
              <option key={d.v} value={d.v}>{d.l}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="tf-time">Time</Label>
          <Input id="tf-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="tf-dur">Duration (min)</Label>
          <Input id="tf-dur" type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
        </div>
        <div>
          <Label htmlFor="tf-cap">Capacity</Label>
          <Input id="tf-cap" type="number" value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
        </div>
        <div className="col-span-2">
          <Label htmlFor="tf-cost">Credit cost</Label>
          <Input id="tf-cost" type="number" value={creditCost} onChange={(e) => setCreditCost(Number(e.target.value))} />
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!name.trim()}>Save</Button>
      </div>
    </Modal>
  );
}
