"use client";
// A staff member cancels one member's class booking (#320), shared by the class
// roster (admin and instructor) and the admin member profile. It asks Return
// credit or Keep credit with neither picked, and Cancel booking stays disabled
// until one is; a booking that spent nothing says so instead.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button, Dialog, DialogFooter, RadioGroup } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import type { StaffRole } from "@/lib/class-seats";
import {
  staffCancelBody,
  staffCancelCanConfirm,
  staffCancelCopy,
  staffCancelPath,
  staffCancelRefusal,
  type StaffCancelPreview,
  type StaffCredit,
} from "@/lib/staff-cancel";

export interface StaffCancelTarget {
  bookingId: string;
  /** The member, as the title names them. */
  name: string;
  /** What is being cancelled and when, under the title; optional. */
  detail?: string;
  preview: StaffCancelPreview;
}

export function CancelBookingDialog({
  role,
  target,
  onClose,
  onCancelled,
}: {
  role: StaffRole;
  /** The dialog is open while this is set. */
  target: StaffCancelTarget | null;
  onClose: () => void;
  /** The cancel went through; the caller reloads. */
  onCancelled: () => void;
}) {
  if (!target) return null;
  // Keyed on the booking so a second cancel starts with nothing picked.
  return <Open key={target.bookingId} role={role} target={target} onClose={onClose} onCancelled={onCancelled} />;
}

function Open({
  role,
  target,
  onClose,
  onCancelled,
}: {
  role: StaffRole;
  target: StaffCancelTarget;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const { api } = useWorkspace();
  const [choice, setChoice] = useState<StaffCredit | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const copy = staffCancelCopy(target.preview, target.name);

  async function confirm() {
    if (!api || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post(staffCancelPath(role, target.bookingId), staffCancelBody(target.preview, choice));
      onCancelled();
    } catch (e) {
      setErr(staffCancelRefusal(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      title={copy.title}
      description={target.detail}
    >
      <p className="text-sm text-muted">Their place is released. {copy.window}</p>
      {copy.options ? (
        <RadioGroup
          className="mt-4"
          label="What happens to the credit"
          value={choice}
          onValueChange={setChoice}
          options={copy.options}
          disabled={busy}
        />
      ) : (
        <p className="mt-4 rounded-lg border border-border bg-paper px-3 py-2.5 text-sm text-ink">{copy.nothingSpent}</p>
      )}
      {err && (
        <p className="mt-3 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">{err}</p>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          {copy.keep}
        </Button>
        <Button
          type="button"
          variant="danger"
          disabled={busy || !staffCancelCanConfirm(target.preview, choice)}
          onClick={confirm}
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Cancelling…
            </>
          ) : (
            copy.confirm
          )}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
