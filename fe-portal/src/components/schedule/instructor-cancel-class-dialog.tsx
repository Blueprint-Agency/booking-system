"use client";
// An Instructor cancelling a class they lead (Schedule classes): the route
// wants a reason, which every admin is notified with. Opened from My schedule's
// List and from the class's own page.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Dialog, DialogFooter, Label, Textarea } from "@/components/ui";
import { useStudioZone } from "@/components/brand/brand-provider";
import { useWorkspace } from "@/lib/workspace-context";
import { formatDate, formatTime } from "@/lib/formatters";
import { scheduleErrorMessage } from "@/lib/schedule";

export interface CancellableClass {
  id: string;
  label: string;
  startsAt: string;
  bookedCount: number;
}

export function InstructorCancelClassDialog({
  target,
  onClose,
  onCancelled,
}: {
  /** The class being cancelled; null keeps the dialog shut. */
  target: CancellableClass | null;
  onClose: () => void;
  onCancelled: () => void | Promise<void>;
}) {
  const { api } = useWorkspace();
  const timezone = useStudioZone();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setReason("");
    setError(null);
    onClose();
  }

  async function submit() {
    if (!api || !target) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/portal/instructor/schedule/classes/${target.id}/cancel`, { reason: reason.trim() });
      toast.success(`${target.label} cancelled`);
      setReason("");
      await onCancelled();
    } catch (err) {
      setError(scheduleErrorMessage(err, "Failed to cancel", timezone));
    } finally {
      setBusy(false);
    }
  }

  const booked = target?.bookedCount ?? 0;
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(o) => {
        if (!o && !busy) close();
      }}
      title="Cancel this class?"
      description={
        target
          ? `${target.label} · ${formatDate(timezone, target.startsAt, "EEE d MMM")} ${formatTime(timezone, target.startsAt)}`
          : undefined
      }
    >
      <p className="text-sm text-ink">
        {booked} member{booked === 1 ? "" : "s"} will get their credit or session back — members on an
        Unlimited plan simply lose the place. This cannot be undone, and all admins are notified.
      </p>
      <div className="mt-4 space-y-1.5">
        <Label htmlFor="cancel-reason">Reason (required)</Label>
        <Textarea
          id="cancel-reason"
          value={reason}
          maxLength={500}
          onChange={(ev) => setReason(ev.target.value)}
          placeholder="Why are you cancelling this class?"
        />
      </div>
      {error && (
        <div className="mt-3 rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
          Failed to cancel: {error}
        </div>
      )}
      <DialogFooter>
        <Button variant="secondary" onClick={close} disabled={busy}>
          Keep class
        </Button>
        <Button variant="danger" onClick={() => void submit()} disabled={busy || reason.trim().length === 0}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Cancel class
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
