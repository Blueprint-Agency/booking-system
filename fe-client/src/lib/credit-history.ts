/**
 * A package's Credit history (#353), as `GET /me/packages/:id/credit-history`
 * sends it: every movement of its credits or sessions, newest first, each
 * against the booking it was for, with the balance after it.
 */
export type CreditMovementCause =
  | "booked"
  | "returned"
  | "kept"
  | "no_show"
  | "expired"
  | "adjusted"
  | "pt_requested"
  | "pt_refunded";

export interface CreditMovement {
  id: string;
  at: string;
  cause: CreditMovementCause;
  delta: number;
  balance_after: number | null;
  actor: "member" | "staff" | "system";
  booking: {
    id: string;
    kind: "class" | "workshop" | "pt";
    title: string | null;
    starts_at: string | null;
    cancelled_late: boolean | null;
  } | null;
}

export interface CreditHistory {
  /** Where the record starts; nothing before it was recorded. */
  history_from: string;
  movements: CreditMovement[];
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `-${-n}` : null);
const join = (label: string, amount: string | null) => (amount ? `${label} · ${amount}` : label);

/**
 * One movement in words — "Booked · -1", "Late cancel · credit kept",
 * "Expired · -3" — and what was left to use after it. `unit` is "credit" for
 * a class package, "session" for a PT package.
 */
export function movementText(m: CreditMovement, unit: "credit" | "session"): { text: string; balance: number | null } {
  const kept = `${unit} kept`;
  const amount = signed(m.delta);
  const text = (() => {
    switch (m.cause) {
      case "booked":
        return join("Booked", amount);
      case "returned":
        return join("Returned", amount);
      case "kept":
        if (m.actor === "staff") return `Cancelled by the studio · ${kept}`;
        return m.booking?.cancelled_late ? `Late cancel · ${kept}` : `Over the cancellation limit · ${kept}`;
      case "no_show":
        return `No-show · ${kept}`;
      case "expired":
        return join("Expired", m.balance_after ? signed(-m.balance_after) : null);
      case "adjusted":
        return amount ? join("Adjusted by the studio", amount) : "Updated by the studio";
      case "pt_requested":
        return join("Session requested", amount);
      case "pt_refunded":
        return join("Request cancelled", amount);
    }
  })();
  // An expired package keeps its number (the studio can extend it), but none of it can be used.
  const balance = m.cause === "expired" && m.balance_after !== null ? 0 : m.balance_after;
  return { text, balance };
}
