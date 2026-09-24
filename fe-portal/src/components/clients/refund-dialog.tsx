"use client";
import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button, Dialog, DialogFooter, Label } from "@/components/ui";
import { refundEffects, splitPaymentLines, type RefundFacts } from "@/lib/refund-copy";

/**
 * Refund one purchase (§14). A Refund is always the **full amount**, so there is
 * deliberately no amount field here or anywhere else in the portal — the amount
 * is stated, not asked for.
 *
 * `facts` is what the backend says the Refund will do: the amount going back,
 * whether the Cross-Location Add-On goes with it, how many bookings it cancels
 * and which Promo Code it frees (#275). The dialog lists every one of them
 * before the admin commits, because each is something a member will ring about.
 *
 * `notice` is the backend's sentence — "3 classes used (attended or no-show)
 * since 12 Jun 2026" — and it is a **notice, not a gate**: the studio's rule is
 * that a used plan is not refunded, and it is enforced by showing it. The admin
 * may proceed. A null notice simply means nothing to show.
 */
export function RefundDialog({
  packageName,
  facts,
  notice,
  paymentCount = 1,
  onConfirm,
  onClose,
}: {
  packageName: string;
  /** What is being refunded and what the Refund undoes.
   *
   *  `unfinished` is a Purchase the member part-paid and never came back to
   *  (#95). Nothing was ever issued on it, so the copy must not promise to
   *  cancel a package or a place — there is none, and an admin who reads that
   *  will go looking for what was taken away. */
  facts: RefundFacts;
  notice: string | null;
  /**
   * How many payments this purchase holds (#93). One is the ordinary case and
   * says nothing extra. More than one means several refunds will appear on the
   * statement from one press of this button, and the admin is told before they
   * press it rather than by a bookkeeper a week later.
   */
  paymentCount?: number;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const isUnfinished = facts.kind === "unfinished";
  const effects = refundEffects(facts);
  const [splitHead, splitDetail] = splitPaymentLines(paymentCount);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Refund ${packageName}?`}
      description="This is the full amount. It lands once Stripe confirms."
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
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
          {effects.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {paymentCount > 1 && (
          <div className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <div>
              <div className="font-medium text-ink">{splitHead}</div>
              <div className="text-xs text-muted">{splitDetail}</div>
            </div>
          </div>
        )}
        {notice && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div>
              <div className="font-medium text-ink">{notice}</div>
              <div className="text-xs text-muted">
                The studio does not normally refund a{" "}
                {facts.kind === "workshop" ? "workshop" : "package"} once a class on it has been
                used. You can still refund it — say why below.
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
            {isUnfinished ? "Refund and close" : `Refund S$${facts.amountSgd}`}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
