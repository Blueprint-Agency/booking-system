/**
 * A package's Credit history (#353), as `GET /portal/admin/clients/:id/packages/:pid/credit-history`
 * sends it, and each movement in words.
 */
export type CreditMovementCause =
  | "booked"
  | "returned"
  | "kept"
  | "no_show"
  | "expired"
  | "adjusted"
  | "pt_requested"
  | "pt_returned";

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
  staff_name: string | null;
  note: string | null;
}

export interface CreditHistory {
  history_from: string;
  movements: CreditMovement[];
}

export interface MovementLine {
  label: string;
  /** Signed, or null when nothing moved. */
  amount: string | null;
  /** What is left to use after it. */
  balance: number | null;
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `-${-n}` : null);

/** `unit` is "credit" for a class package, "session" for a PT package. */
export function movementLine(m: CreditMovement, unit: "credit" | "session"): MovementLine {
  const kept = `${unit} not returned`;
  const line = (label: string): MovementLine => ({ label, amount: signed(m.delta), balance: m.balance_after });
  switch (m.cause) {
    case "booked":
      return line("Booked");
    case "returned":
      return line("Returned");
    case "kept":
      if (m.actor === "staff") return line(`Staff cancel · ${kept}`);
      return line(m.booking?.cancelled_late ? `Late cancel · ${kept}` : `Over the cancellation limit · ${kept}`);
    case "no_show":
      return line(`No-show · ${kept}`);
    case "expired":
      // The stored balance stays (staff can extend the date), but none of it is usable.
      return {
        label: "Expired",
        amount: m.balance_after ? signed(-m.balance_after) : null,
        balance: m.balance_after === null ? null : 0,
      };
    case "adjusted":
      return line("Adjusted by staff");
    case "pt_requested":
      return line("Private session requested");
    case "pt_returned":
      return line("Request cancelled · returned");
  }
}
