"use client";

import { useState } from "react";
import type { Location } from "@/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { upsertLocation } from "@/lib/mock-state";

export function LocationForm({
  initial,
  open,
  onClose,
}: {
  initial?: Location;
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [shortName, setShortName] = useState(initial?.shortName ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [area, setArea] = useState(initial?.area ?? "");
  const [rooms, setRooms] = useState<number | "">(initial?.rooms ?? "");
  const [amenities, setAmenities] = useState((initial?.amenities ?? []).join(", "));

  const submit = () => {
    upsertLocation({
      id: initial?.id,
      name,
      shortName,
      address,
      area,
      rooms: rooms === "" ? undefined : Number(rooms),
      amenities: amenities
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      mapUrl: initial?.mapUrl,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? "Edit location" : "New location"}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="lf-name">Name</Label>
          <Input id="lf-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="lf-short">Short name</Label>
          <Input id="lf-short" value={shortName} onChange={(e) => setShortName(e.target.value)} />
        </div>
        <div className="col-span-2">
          <Label htmlFor="lf-addr">Address</Label>
          <Textarea id="lf-addr" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="lf-area">Area</Label>
          <Input id="lf-area" value={area} onChange={(e) => setArea(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="lf-rooms">Rooms</Label>
          <Input
            id="lf-rooms"
            type="number"
            value={rooms === "" ? "" : rooms}
            onChange={(e) => setRooms(e.target.value === "" ? "" : Number(e.target.value))}
          />
        </div>
        <div className="col-span-2">
          <Label htmlFor="lf-amen">Amenities (comma-separated)</Label>
          <Input id="lf-amen" value={amenities} onChange={(e) => setAmenities(e.target.value)} />
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!name.trim()}>Save</Button>
      </div>
    </Modal>
  );
}
