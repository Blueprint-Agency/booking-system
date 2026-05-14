"use client";
import { useState } from "react";
import { Button, Dialog, DialogFooter, Label } from "@/components/ui";

export function DeclineRequestDialog({
  onConfirm,
  onClose,
}: {
  onConfirm: (note: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Decline PT request">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (note.trim().length >= 5) onConfirm(note.trim());
        }}
      >
        <div className="space-y-1.5">
          <Label>Reason (visible to client, ≥ 5 characters)</Label>
          <textarea
            rows={4}
            required
            minLength={5}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Instructor on leave that week — please re-submit with another date."
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={note.trim().length < 5}>
            Decline request
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
