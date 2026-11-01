"use client";
import { useState } from "react";
import { Button, Dialog, DialogFooter, Input, Label } from "@/components/ui";
import { useStudioZone } from "@/components/brand/brand-provider";
import { LATEST_DATE, todayIso } from "@/lib/formatters";
import { expiryDay, expiryInstant } from "@/lib/package-expiry";
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
  const timezone = useStudioZone();
  const [date, setDate] = useState(expiryDay(timezone, pkg.expiresAt));
  const [reason, setReason] = useState("");
  // A blank expiry means "return this package to Dormant" (spec §8). Every
  // kind starts Dormant and Activates on its first booking, so every kind can
  // be sent back there — it is how an admin undoes an Activation the studio
  // itself caused. Setting a date on a Dormant package Activates it by hand;
  // any number of packages in a family may run at once (ADR 0010).
  const isPt = pkg.kind === "pt";
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
          // The last instant of the picked day on the studio's clock
          // (lib/package-expiry.ts). Ends already stamped at 23:59:59 UTC
          // are not rewritten: that would take hours from members, and
          // reopening one saves the later day in their favour.
          onSave(expiryInstant(timezone, date), reason.trim());
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="exp-date">New expiry date</Label>
          <Input
            id="exp-date"
            type="date"
            min={todayIso(timezone)}
            max={LATEST_DATE}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <p className="text-xs text-muted">
            Leave blank to return this package to Dormant — its clock starts
            again at the next booking it pays for
            {isPt ? " (for a private-session package, when its next session is scheduled)" : ""}.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="exp-reason">Reason (required)</Label>
          <textarea
            id="exp-reason"
            rows={3}
            maxLength={2000}
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
