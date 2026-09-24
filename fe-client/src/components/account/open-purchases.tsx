"use client";

/**
 * Unfinished purchases on the member's account page (#93).
 *
 * The list is the promise the checkout page made: a balance left outstanding
 * stays open until it is paid in full or the studio refunds it, and the member
 * can come back to it whenever they like. So
 * this renders above the packages, not below them — it is the one thing on the
 * page that is waiting on the member rather than the other way round.
 *
 * It says plainly that nothing has been granted. A member looking at a plan
 * they have paid most of, and cannot use, deserves to be told which of those
 * two facts is the one they can change.
 */
import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { formatSgd } from "@/lib/utils";
import { useApi } from "@/lib/api";
import { reportError } from "@/lib/report-error";
import {
  resumePurchase,
  type OpenPurchase,
  type PartPaymentOptions,
} from "@/lib/open-purchases";
import { SaveCardBlock } from "@/components/checkout/save-card-block";
import { checkoutErrorMessage, type CheckoutErrorBody } from "@/lib/checkout-messages";

export function OpenPurchases({
  purchases,
  partPayment,
  failed = false,
}: {
  purchases: OpenPurchase[];
  partPayment: PartPaymentOptions;
  /**
   * The list could not be read. An empty list and a failed read both arrive
   * here as no rows, and staying silent on the second would tell a member who
   * owes half that they owe nothing.
   */
  failed?: boolean;
}) {
  if (failed) {
    return (
      <div className="mt-6 flex items-start gap-2 rounded-2xl border border-ink/10 bg-warm px-4 py-3 text-sm text-ink">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
        <span>
          We couldn&apos;t load your unfinished purchases just now. Refresh the page —
          nothing has been lost.
        </span>
      </div>
    );
  }
  if (purchases.length === 0) return null;
  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
        Unfinished purchases
      </h3>
      <div className="space-y-4">
        {purchases.map(p => (
          <OpenPurchaseCard key={p.id} purchase={p} partPayment={partPayment} />
        ))}
      </div>
    </div>
  );
}

function OpenPurchaseCard({
  purchase,
  partPayment,
}: {
  purchase: OpenPurchase;
  partPayment: PartPaymentOptions;
}) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Splitting the *remainder* again is only offered where the studio offers
  // Part Payment at all, and never once the balance is under the card minimum —
  // there the whole remainder is the only amount anyone can charge.
  const canSplit = partPayment.enabled && !purchase.must_pay_in_full;
  const [splitting, setSplitting] = useState(false);
  const [amount, setAmount] = useState(purchase.outstanding_sgd);
  // "Save this card for next time" (#185). Offered here as well as at checkout
  // because this is the second card on a split purchase — the member is on this
  // screen precisely because they paid once already, and a third instalment or
  // a next purchase is exactly what a saved card spares them.
  const [saveCard, setSaveCard] = useState(false);
  // Same rule as the checkout box: an empty or half-typed amount blocks the
  // button. It must never fall through to "pay it all", which is more money
  // than the member asked to hand over.
  const typed = Number(amount.trim());
  const amountValid = amount.trim() !== "" && Number.isFinite(typed) && typed > 0;
  const blocked = splitting && !amountValid;

  async function pay(amountSgd: number | null) {
    setBusy(true);
    setError(null);
    try {
      await resumePurchase(api, purchase.id, amountSgd, saveCard);
    } catch (err) {
      reportError(err, { scope: "resume-purchase" });
      const body = (err as { body?: CheckoutErrorBody })?.body;
      setError(checkoutErrorMessage(body, "Could not start the payment. Please try again."));
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-warning/30 bg-warning/5 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium text-ink truncate">{purchase.item_name}</p>
          <p className="mt-1 text-xs text-muted">
            {formatSgd(purchase.paid_sgd)} paid of {formatSgd(purchase.total_sgd)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-2xl font-extrabold text-ink">
            {formatSgd(purchase.outstanding_sgd)}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-muted">Still to pay</p>
        </div>
      </div>

      <div className="mt-3 flex items-start gap-2 text-xs text-ink">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
        <span>
          Nothing has been added to your account yet, and no place is held. This
          purchase stays open until it&apos;s paid in full or refunded by the studio.
        </span>
      </div>

      {splitting && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-sm text-muted">S$</span>
          <input
            type="number"
            inputMode="decimal"
            min={partPayment.floorSgd}
            max={purchase.outstanding_sgd}
            step="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            className="w-36 rounded-xl border border-ink/10 bg-paper px-3 py-2.5 text-sm focus:border-accent focus:outline-none transition-colors"
            aria-label="Amount to pay now"
          />
          <span className="text-xs text-muted">
            of {formatSgd(purchase.outstanding_sgd)}
          </span>
        </div>
      )}

      {/* Resuming is always a card-only session — the balance cannot wait on a
          method that settles hours later — so the notice is already made. */}
      <SaveCardBlock
        checked={saveCard}
        onCheckedChange={setSaveCard}
        resuming
        alreadyCardOnly
      />

      {error && <p className="mt-3 text-xs text-error">{error}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || blocked}
          onClick={() => pay(splitting ? typed : null)}
          className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition-colors hover:bg-ink/90 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {blocked
            ? "Enter an amount"
            : splitting
              ? "Pay this amount"
              : `Pay ${formatSgd(purchase.outstanding_sgd)} now`}
        </button>
        {canSplit && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setSplitting(s => !s)}
            className="rounded-full border border-ink/10 px-5 py-2.5 text-sm font-medium transition-colors hover:border-accent disabled:opacity-50"
          >
            {splitting ? "Pay it all instead" : "Pay part of it"}
          </button>
        )}
      </div>
    </div>
  );
}
