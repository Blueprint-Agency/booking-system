"use client";
// The question unticking a member's attendance asks first, shared by the class
// roster's Attended pill and the check-in desk's Undo (admin-restructure §11).
// Ticking stays one tap; only taking a check-in away is confirmed.

import { Button, Dialog, DialogFooter } from "@/components/ui";
import { untickConfirmCopy } from "@/lib/untick-confirm";

export function UntickConfirmDialog<Row>({
  row,
  name,
  onClose,
  onUnmark,
}: {
  /** The row being unmarked; the dialog is open while this is set. */
  row: Row | null;
  name: (row: Row) => string;
  /** Clears `row`: the dialog was answered or dismissed. */
  onClose: () => void;
  /** Sends the untick. Called only on "Unmark", after the dialog closes. */
  onUnmark: (row: Row) => void;
}) {
  const copy = untickConfirmCopy(row === null ? "" : name(row));
  return (
    <Dialog
      open={row !== null}
      onOpenChange={(o) => !o && onClose()}
      title={copy.title}
      description={copy.body}
    >
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {copy.keep}
        </Button>
        <Button
          type="button"
          variant="danger"
          onClick={() => {
            if (row === null) return;
            onClose();
            onUnmark(row);
          }}
        >
          {copy.confirm}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
