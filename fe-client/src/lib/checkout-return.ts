/**
 * Where a checkout sends the member back to, and what those screens say (#274).
 *
 * Two halves. A **cancel** return — the member backed out of the payment page —
 * must say plainly that nothing was taken, wherever it lands. A **success**
 * return may still not be a payment: the provider can hand the member back
 * before the money is confirmed, the sync can fail, and a $0 grant never had a
 * payment at all.
 *
 * Pure, so it is testable without a browser.
 */

/**
 * The banner for a cancel return, or null for an ordinary visit.
 *
 * `cancelled=1` comes back from the review page, merch, and the standalone
 * Cross-Location Add-On (which returns to the account page). `resumed=<id>` is
 * the cancel return of paying more towards an unfinished purchase — that one
 * says the balance is still owed, because it is.
 */
export function cancelledNotice(params: URLSearchParams): string | null {
  if (params.get("resumed")) {
    return "Payment cancelled — you haven't been charged. Your purchase is still waiting below.";
  }
  if (params.get("cancelled") === "1") {
    return "Payment cancelled — you haven't been charged.";
  }
  return null;
}

/**
 * What the confirmation page may claim.
 *
 * - `confirmed` — the sync read the session back as paid and recorded it.
 * - `pending`  — anything short of that: the provider said the payment is not
 *   through yet, or the sync failed. The webhook still records a real payment,
 *   so this is "we're still confirming", never "it failed".
 * - `free`     — no payment session at all: a $0 grant, done on the server
 *   before the member reached this page.
 */
export type ConfirmationOutcome = "confirmed" | "pending" | "free" | NotGranted;

export type NotGranted = "refunded" | "abandoned";

/** The sync's answer: the response, or "failed" when the request itself threw. */
export type SyncResult = { ok: boolean; body: Record<string, unknown> | null } | "failed";

const SYNC_OUTCOMES = new Map<unknown, ConfirmationOutcome>([
  ["granted", "confirmed"],
  ["owing", "confirmed"],
  ["refunded", "refunded"],
  ["abandoned", "abandoned"],
]);

export function confirmationOutcome(sessionId: string | null, sync: SyncResult): ConfirmationOutcome {
  if (!sessionId) return "free";
  if (sync === "failed" || !sync.ok) return "pending";
  return SYNC_OUTCOMES.get(sync.body?.status) ?? "pending";
}

export const notGranted = (outcome: ConfirmationOutcome | null): outcome is NotGranted =>
  outcome === "refunded" || outcome === "abandoned";

/**
 * The Receipt the sync said this payment was given (#384), for the
 * confirmation page to link to: null for anything short of a granted payment,
 * and for a sale that is not issued one.
 */
export function syncedReceipt(sync: SyncResult): { id: string; number: string } | null {
  if (sync === "failed" || !sync.ok || sync.body?.status !== "granted") return null;
  const receipt = sync.body.receipt as { id?: unknown; number?: unknown } | null | undefined;
  return receipt && typeof receipt.id === "string" && typeof receipt.number === "string"
    ? { id: receipt.id, number: receipt.number }
    : null;
}

/** The small line above the heading. Never "successful" unless it was. */
export function confirmationEyebrow(outcome: ConfirmationOutcome): string {
  switch (outcome) {
    case "confirmed":
      return "Payment successful";
    case "free":
      return "Added to your account";
    case "pending":
      return "Payment processing";
    case "refunded":
      return "Purchase refunded";
    case "abandoned":
      return "Purchase not completed";
  }
}

export const NOT_GRANTED_COPY: Record<NotGranted, { heading: string; body: string }> = {
  refunded: {
    heading: "This purchase has been refunded",
    body:
      "Nothing from it is on your account. Your payment goes back the way you paid (card or PayNow), which can take a few business days. If you weren't expecting this, please contact the studio.",
  },
  abandoned: {
    heading: "We couldn't complete this purchase",
    body:
      "Nothing was added to your account, and your payment is being returned the way you paid (card or PayNow), which can take a few business days. You can buy it again whenever you're ready, or contact the studio if you have questions.",
  },
};

/** The heading and sentence of the pending state, shared by every flow. */
export const PENDING_HEADING = "We're still confirming your payment…";
export const PENDING_BODY =
  "This can take a few minutes. It will show on your account as soon as it's confirmed — you don't need to pay again.";
