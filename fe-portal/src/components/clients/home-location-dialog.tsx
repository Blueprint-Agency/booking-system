"use client";
import { useState } from "react";
import { Button, Dialog, DialogFooter, Label } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";

/**
 * Staff move a member's **Home Location** (§7) — the correction for a studio
 * picked wrong at checkout, whose only other route out is a refund and a
 * repurchase. Members cannot do this themselves: a self-serve toggle would give
 * away what the Cross-Location Add-On sells.
 *
 * The dialog names both consequences the backend guarantees, because neither is
 * visible from the row: the member's Dormant renewal moves with the Activated
 * plan, and existing bookings — including the ones at the studio being left —
 * stay booked.
 */
export function HomeLocationDialog({
  packageName,
  currentLocation,
  onSave,
  onClose,
}: {
  packageName: string;
  /** The Home Location the plan sits at today. */
  currentLocation: { id: string; name: string } | null;
  onSave: (locationId: string, reason: string) => void;
  onClose: () => void;
}) {
  const { locations } = useWorkspace();
  const [locationId, setLocationId] = useState("");
  const [reason, setReason] = useState("");

  // Deliberately no default selection, the same way the checkout picker has
  // none — a Location must be chosen, never arrived at by inattention. No class
  // can be scheduled at an archived Location, so moving a member onto one would
  // strand them exactly as the wrong Location already has.
  const choices = locations.filter(
    (l) => !l.archivedAt && l.id !== currentLocation?.id,
  );
  const ready = locationId !== "" && reason.trim() !== "";

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Home studio — ${packageName}`}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          onSave(locationId, reason.trim());
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="home-location">Move to</Label>
          <select
            id="home-location"
            required
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          >
            <option value="">Select a studio</option>
            {choices.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted">
            Currently {currentLocation?.name ?? "unset"}. Any queued renewal moves
            with this plan, and existing bookings stay booked — including ones at
            the studio being left.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="home-location-reason">Reason (required)</Label>
          <textarea
            id="home-location-reason"
            rows={3}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready}>
            Move
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
