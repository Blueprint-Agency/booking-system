"use client";
import { useState } from "react";
import { Dialog, DialogFooter, Button, Input, Label } from "@/components/ui";
import type { Location } from "@/types";

export function LocationFormDialog({
  location,
  onSave,
  onClose,
}: {
  location: Location | null;
  onSave: (loc: Location) => void | Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(location?.name ?? "");
  const [address, setAddress] = useState(location?.address ?? "");
  const [gmapsUrl, setGmapsUrl] = useState(location?.gmapsUrl ?? "");
  const [phone, setPhone] = useState(location?.phone ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      id: location?.id ?? `loc-${Date.now().toString(36)}`,
      name: name.trim(),
      address: address.trim(),
      gmapsUrl: gmapsUrl.trim(),
      phone: phone.trim(),
      archivedAt: location?.archivedAt ?? null,
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={location ? "Edit location" : "Add location"}
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <Label htmlFor="loc-name">Name</Label>
          <Input
            id="loc-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="loc-address">Address</Label>
          <Input
            id="loc-address"
            required
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Street, building, postal code"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="loc-gmaps">Google Maps link</Label>
          <Input
            id="loc-gmaps"
            type="url"
            value={gmapsUrl}
            onChange={(e) => setGmapsUrl(e.target.value)}
            placeholder="https://maps.app.goo.gl/…"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="loc-phone">Phone number</Label>
          <Input
            id="loc-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+65 …"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">{location ? "Save changes" : "Create"}</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
