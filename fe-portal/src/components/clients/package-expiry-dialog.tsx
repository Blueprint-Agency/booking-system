"use client";
import { useState } from "react";
import { Button, Dialog, DialogFooter, Input, Label } from "@/components/ui";
import { todayIso } from "@/lib/formatters";
import type { ClientPackage } from "@/types";

export function PackageExpiryDialog({
  pkg,
  onSave,
  onClose,
}: {
  pkg: ClientPackage;
  onSave: (newExpiresAt: string | null, reason: string) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(pkg.expiresAt?.slice(0, 10) ?? "");
  const [reason, setReason] = useState("");
  // A blank expiry means "return this plan to Dormant", and only an Unlimited
  // Plan can be Dormant (spec §8). The backend refuses it for every other kind;
  // this only stops the dialog offering what would be refused.
  const canReturnToDormant = pkg.kind === "unlimited";
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Edit expiry — ${pkg.packageName}`}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reason.trim()) return;
          // KNOWN DEFECT: this stamps end-of-day in UTC, so a package the admin
          // set to expire "the 30th" dies at 07:59 on the 31st Singapore time.
          // Same class as the local-day fix, but NOT the same fix — correcting
          // it moves when existing packages actually expire, so it needs a call
          // on the live rows, not just a code change. See lib/local-day.ts.
          onSave(date ? `${date}T23:59:59.000Z` : null, reason.trim());
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="exp-date">New expiry date</Label>
          <Input
            id="exp-date"
            type="date"
            min={todayIso()}
            required={!canReturnToDormant}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          {canReturnToDormant && (
            <p className="text-xs text-muted">
              Leave blank to return this plan to Dormant — its clock restarts at the
              member&apos;s first booking this plan pays for.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="exp-reason">Reason (required)</Label>
          <textarea
            id="exp-reason"
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
          <Button type="submit" disabled={!reason.trim()}>
            Save
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
