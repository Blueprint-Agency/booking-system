"use client";
import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button, Dialog, DialogFooter, Label } from "@/components/ui";

/**
 * Refund one purchase (§14). A Refund is always the **full amount**, so there is
 * deliberately no amount field here or anywhere else in the portal.
 *
 * `notice` is the backend's sentence — "3 classes attended since 12 Jun 2026" —
 * and it is a **notice, not a gate**: the studio's rule is that an attended plan
 * is not refunded, and it is enforced by showing it. The admin may proceed. The
 * frontend works none of that out; a null notice simply means nothing to show.
 */
export function RefundDialog({
  packageName,
  kind = "package",
  notice,
  onConfirm,
  onClose,
}: {
  packageName: string;
  /** What is being refunded, so the copy names it. The unwind is the same
   *  operation either way — only the sentence differs. */
  kind?: "package" | "workshop";
  notice: string | null;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const isWorkshop = kind === "workshop";
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Refund ${packageName}?`}
      description={
        isWorkshop
          ? "The full amount goes back to the customer. Their place on the workshop is cancelled."
          : "The full amount goes back to the customer. The package stops covering bookings and every class still ahead of them on it is cancelled."
      }
    >
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!reason.trim() || busy) return;
          setBusy(true);
          try {
            await onConfirm(reason.trim());
          } finally {
            setBusy(false);
          }
        }}
      >
        {notice && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div>
              <div className="font-medium text-ink">{notice}</div>
              <div className="text-xs text-muted">
                The studio does not normally refund a {isWorkshop ? "workshop" : "package"} once a
                class has been attended. You can still refund it — say why below.
              </div>
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="refund-reason">Reason (required)</Label>
          <textarea
            id="refund-reason"
            rows={3}
            required
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Free text — this is the only record of why the refund was given."
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!reason.trim() || busy}
            className="bg-error text-white hover:bg-error/90"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Refund in full
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
