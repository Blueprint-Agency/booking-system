"use client";
import { useState } from "react";
import { Dialog, DialogFooter, Button, Input, Label } from "@/components/ui";
import { locationSaveRefusal } from "@/lib/location-list";
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
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setRefusal(null);
    try {
      await onSave({
        id: location?.id ?? `loc-${Date.now().toString(36)}`,
        name: name.trim(),
        address: address.trim(),
        gmapsUrl: gmapsUrl.trim(),
        phone: phone.trim(),
        archivedAt: location?.archivedAt ?? null,
      });
    } catch (err) {
      setRefusal(locationSaveRefusal(err, "The location could not be saved. Try again."));
    } finally {
      setSaving(false);
    }
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
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="loc-address">Address</Label>
          <Input
            id="loc-address"
            required
            maxLength={500}
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
            maxLength={500}
            value={gmapsUrl}
            onChange={(e) => setGmapsUrl(e.target.value)}
            placeholder="https://maps.app.goo.gl/…"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="loc-phone">Phone number</Label>
          <Input
            id="loc-phone"
            maxLength={40}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+65 …"
          />
        </div>
        {refusal && (
          <p role="alert" className="text-sm text-error">
            {refusal}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {location ? "Save changes" : "Create"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
