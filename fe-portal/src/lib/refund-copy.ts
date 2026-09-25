/**
 * What the portal's Refund screens say (#275), kept pure so every sentence is
 * testable and the three places a Refund is issued from say the same thing.
 *
 * Nothing here decides a rule. The backend says whether a Refund is on its way,
 * how much goes back, whether the Add-On goes with it, how many bookings it
 * cancels and which Promo Code it frees; this only puts those facts into words.
 *
 * "Stripe", not "the provider": it is the name on the studio's dashboard and on
 * the statement, and the word staff will search their inbox for.
 */
import { refusalCode } from "./access-refusal";
import { REFUND_REFUSALS as WHERE_THE_MONEY_IS } from "./refund-refusals";

/**
 * The backend's refusals of a Refund, in words an admin can act on — the ones
 * about the purchase here, and the ones about which Stripe account holds the
 * money (#293) from `refund-refusals`.
 */
const REFUND_REFUSALS: Record<string, string> = {
  ...WHERE_THE_MONEY_IS,
  already_refunded: "This purchase has already been refunded.",
  purchase_not_refundable: "Nothing was paid online for this, so there's nothing to refund.",
  purchase_not_open:
    "This purchase has been paid in full, so refund it from the package or booking it bought instead.",
  refund_processing:
    "A refund for this purchase is already on its way. It lands once Stripe confirms — there is no need to issue it again.",
};

/**
 * Why a Refund did not go through. A refusal the backend named gets its own
 * sentence; anything else (Stripe declined, the network dropped) gets one that
 * says where to look — and never a status code, which tells staff nothing.
 */
export function refundFailureMessage(body: unknown): string {
  const code = refusalCode(body);
  return (
    (code && REFUND_REFUSALS[code]) ||
    "The refund didn't go through. Check the payment in Stripe, then try again."
  );
}

/**
 * A Refund over several payments where Stripe took some and refused the next.
 * The admin has to hear that some money moved, or they will issue it again
 * from the Stripe dashboard and return it twice. "Accepted", not "returned":
 * the money is back only when Stripe confirms.
 */
export function incompleteRefundMessage(requestedCount: number, paymentCount: number): string {
  return (
    `Some of this refund may have gone through. Stripe accepted ${requestedCount} of ` +
    `${paymentCount} payments and refused the next. Check Stripe before you try again.`
  );
}

/** Where a Refund has got between the button and Stripe's confirmation — the backend decides. */
export type RefundProgress = "none" | "processing" | "incomplete";

/** What the Refund button's reply says about the provider calls it made. */
export interface RefundReply {
  complete: boolean;
  requested_count: number;
  covered_payment_count: number;
}

/** The toast after a Refund button's reply: a warning when Stripe stopped part-way. */
export function refundReplyToast(
  kind: RefundKind,
  reply: RefundReply,
  lead?: string,
): { tone: "success" | "warning"; message: string } {
  if (!reply.complete) {
    return {
      tone: "warning",
      message: incompleteRefundMessage(reply.requested_count, reply.covered_payment_count),
    };
  }
  const issued = refundIssuedMessage(kind);
  return { tone: "success", message: lead ? `${lead}. ${issued}` : issued };
}

export type RefundKind = "package" | "workshop" | "unfinished";

/** The toast after a Refund is issued: it lands when Stripe confirms, not now. */
export function refundIssuedMessage(kind: RefundKind): string {
  switch (kind) {
    case "package":
      return "Refund issued. The package is voided once Stripe confirms.";
    case "workshop":
      return "Refund issued. The booking is cancelled once Stripe confirms.";
    case "unfinished":
      return "Refund issued. The purchase closes once Stripe confirms.";
  }
}

/** The badge a purchase or payment wears between the button and `charge.refunded`. */
export const REFUND_PROCESSING_LABEL = "Refund processing";

/**
 * The badge for a Refund in flight, or null when none is. `incomplete` is one
 * Refund of the whole that Stripe stopped part-way — not a partial refund, which
 * the studio does not do.
 */
export function refundProgressTag(
  progress: RefundProgress,
): { label: string; tone: "warning" | "error" } | null {
  if (progress === "processing") return { label: REFUND_PROCESSING_LABEL, tone: "warning" };
  if (progress === "incomplete") return { label: "Refund incomplete", tone: "error" };
  return null;
}

/**
 * A purchase settled in more than one payment gets one refund per payment on
 * the statement. It may well have been one card used twice, so the count is of
 * payments, never of cards.
 */
export function splitPaymentLines(paymentCount: number): [string, string] {
  return [
    `This was paid in ${paymentCount} payments, so ${paymentCount} refunds will show on the statement.`,
    "One refund here returns every payment, each to wherever it was paid from.",
  ];
}

export type RefundFacts =
  | {
      kind: "package";
      amountSgd: string;
      /** What the plan's Cross-Location Add-On cost; null when it has none. */
      crossLocationPaidSgd: string | null;
      /** Bought with the plan (true) or separately (false); null when it has none. */
      includesAddOn: boolean | null;
      upcomingBookingCount: number;
      promoCode: string | null;
    }
  | { kind: "workshop"; amountSgd: string; promoCode: string | null }
  | { kind: "unfinished"; amountSgd: string; promoCode?: null };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Everything a Refund does, one line each, for the dialog to list before the admin commits. */
export function refundEffects(f: RefundFacts): string[] {
  const addOnIncluded =
    f.kind === "package" && f.crossLocationPaidSgd !== null && f.includesAddOn === true;
  const lines = [
    addOnIncluded
      ? `S$${f.amountSgd} goes back to the customer, including the Cross-Location Add-On (S$${f.crossLocationPaidSgd}).`
      : `S$${f.amountSgd} goes back to the customer.`,
  ];
  if (f.kind === "unfinished") {
    lines.push(
      "Nothing was ever issued on it, so there is no package to stop and no booking to cancel. The purchase is closed.",
    );
    return lines;
  }
  if (f.kind === "workshop") {
    lines.push("Their place on the workshop is cancelled.");
  } else {
    lines.push("The package stops covering bookings.");
    lines.push(
      f.upcomingBookingCount > 0
        ? `Their ${plural(f.upcomingBookingCount, "upcoming booking", "upcoming bookings")} on it ${f.upcomingBookingCount === 1 ? "is" : "are"} cancelled.`
        : "Nothing is booked on it yet, so no bookings are cancelled.",
    );
    if (f.crossLocationPaidSgd !== null && f.includesAddOn === false) {
      lines.push(
        `The Cross-Location Add-On (S$${f.crossLocationPaidSgd}, bought separately) ends with the package and is not refunded.`,
      );
    }
  }
  if (f.promoCode) lines.push(`Promo Code ${f.promoCode} is freed, so they can use it again.`);
  return lines;
}
