"use client";
import { useState } from "react";
import { Button, Dialog, DialogFooter, Input, Label } from "@/components/ui";

/**
 * Staff attach or remove a **Cross-Location Add-On** on one Unlimited Plan (§5).
 * Every change writes a zero-delta manual adjustment carrying the reason, the
 * same way an expiry-only edit is already recorded.
 */
export function CrossLocationDialog({
  packageName,
  currentPaidSgd,
  onSave,
  onClose,
}: {
  packageName: string;
  /** What the plan carries today — null means Home Location only. */
  currentPaidSgd: string | null;
  onSave: (paidSgd: number | null, reason: string) => void;
  onClose: () => void;
}) {
  const attached = currentPaidSgd !== null;
  const [amount, setAmount] = useState(currentPaidSgd ?? "");
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Cross-Location Add-On — ${packageName}`}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reason.trim()) return;
          // An empty field is not zero: recording a $0 Add-On is a decision
          // staff must type, never one a blank box makes for them.
          if (amount.trim() === "") return;
          const n = Number(amount);
          if (!(n >= 0)) return;
          onSave(n, reason.trim());
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="xloc-amount">Amount paid (SGD)</Label>
          <Input
            id="xloc-amount"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <p className="text-xs text-muted">
            The plan covers both studios while this is set. It expires with the plan.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="xloc-reason">Reason (required)</Label>
          <textarea
            id="xloc-reason"
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
          {attached && (
            <Button
              type="button"
              variant="ghost"
              disabled={!reason.trim()}
              onClick={() => reason.trim() && onSave(null, reason.trim())}
            >
              Remove Add-On
            </Button>
          )}
          <Button
            type="submit"
            disabled={!reason.trim() || amount.trim() === "" || !(Number(amount) >= 0)}
          >
            Save
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
