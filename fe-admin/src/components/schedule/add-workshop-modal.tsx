"use client";

import { useState } from "react";
import type { Instructor, Location, Session } from "@/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createWorkshop } from "@/lib/mock-state";

export function AddWorkshopModal({
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
  const [name, setName] = useState("Intro to Yin");
  const [instructorId, setInstructorId] = useState(instructors[0]?.id ?? "");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState(90);
  const [capacity, setCapacity] = useState(20);
  const [price, setPrice] = useState(45);
  const [level, setLevel] = useState<Session["level"]>("all");

  const submit = () => {
    if (!date) return;
    createWorkshop({
      tenantId,
      locationId,
      name,
      instructorId,
      date,
      time,
      duration,
      capacity,
      price,
      level,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Add workshop">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label htmlFor="ws-name">Workshop name</Label>
          <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ws-inst">Instructor</Label>
          <Select id="ws-inst" value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
            {instructors.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ws-loc">Location</Label>
          <Select id="ws-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ws-date">Date</Label>
          <Input id="ws-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ws-time">Time</Label>
          <Input id="ws-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ws-dur">Duration (min)</Label>
          <Input id="ws-dur" type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
        </div>
        <div>
          <Label htmlFor="ws-cap">Capacity</Label>
          <Input id="ws-cap" type="number" value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
        </div>
        <div>
          <Label htmlFor="ws-price">Price (SGD)</Label>
          <Input id="ws-price" type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
        </div>
        <div>
          <Label htmlFor="ws-level">Level</Label>
          <Select id="ws-level" value={level} onChange={(e) => setLevel(e.target.value as Session["level"])}>
            <option value="all">All</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </Select>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!date}>Add workshop</Button>
      </div>
    </Modal>
  );
}
