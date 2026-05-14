"use client";
import { useState } from "react";
import { Button, Dialog, DialogFooter, Input, Label } from "@/components/ui";
import type { ClientPackage } from "@/types";

export function PackageSetBalanceDialog({
  pkg,
  onSave,
  onClose,
}: {
  pkg: ClientPackage;
  onSave: (newBalance: number, reason: string) => void;
  onClose: () => void;
}) {
  const [balance, setBalance] = useState<string>(
    String(pkg.creditsOrSessionsRemaining ?? 0)
  );
  const [reason, setReason] = useState("");
  const current = pkg.creditsOrSessionsRemaining ?? 0;
  const newVal = Math.max(0, Number(balance) || 0);
  const delta = newVal - current;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Set credit balance — ${pkg.packageName}`}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (delta === 0 || !reason.trim()) return;
          onSave(newVal, reason.trim());
        }}
      >
        <div className="text-sm text-muted">
          Current balance: <strong className="text-ink">{current}</strong>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bal">New balance</Label>
          <Input
            id="bal"
            type="number"
            min={0}
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
          />
          <div className="text-xs text-muted">
            Delta: {delta >= 0 ? `+${delta}` : delta}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bal-reason">Reason (required)</Label>
          <textarea
            id="bal-reason"
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
          <Button type="submit" disabled={delta === 0 || !reason.trim()}>
            Save
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
