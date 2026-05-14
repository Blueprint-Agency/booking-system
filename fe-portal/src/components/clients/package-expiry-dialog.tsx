"use client";
import { useState } from "react";
import { Button, Dialog, DialogFooter, Input, Label } from "@/components/ui";
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
          onSave(date ? `${date}T23:59:59.000Z` : null, reason.trim());
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="exp-date">New expiry date</Label>
          <Input
            id="exp-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <p className="text-xs text-muted">Leave blank to remove expiry.</p>
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
