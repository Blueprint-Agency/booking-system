"use client";
import { useState } from "react";
import { Button, Dialog, DialogFooter, Label } from "@/components/ui";

/**
 * Take back a **Complimentary Package** given by mistake (#176).
 *
 * Deliberately not the Refund dialog: no money moved, so there is nothing to
 * give back — the package row goes, and the classes it paid for that have not
 * been held are cancelled. The backend refuses this once a class it paid for
 * has been held, so the dialog says what will happen and lets the server be the
 * one that says no.
 */
export function RemovePackageDialog({
  packageName,
  onConfirm,
  onClose,
}: {
  packageName: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Remove ${packageName}?`}
      description="The free package is deleted and any class it paid for that has not happened yet is cancelled. Once a class it paid for has been held, use a balance or expiry edit instead."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reason.trim()) return;
          onConfirm(reason.trim());
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="remove-reason">Reason (required)</Label>
          <textarea
            id="remove-reason"
            rows={3}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why it is being taken back — kept in the audit log."
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!reason.trim()}
            className="bg-error text-white hover:bg-error/90"
          >
            Remove package
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
