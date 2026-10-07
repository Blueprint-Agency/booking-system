/**
 * How staff read a cancellation (#352): the profile's Cancelled tab and the
 * class roster's Cancelled section. The backend's shared cancellation summary
 * (`be/src/services/bookings/cancellation-summary.ts`) decides who cancelled
 * and where the credit went — the same summary the member's Cancelled tab is
 * worded from — so this only puts it into the front desk's words. A credit is
 * returned or kept, never "refunded"; only a workshop's money is refunded.
 */

/** Who cancelled, as staff read it. */
export type CancelActor = "member" | "staff" | "automatic" | "studio";

/** Where the credit went. */
export type CancellationOutcome =
  | "credit_returned"
  | "credit_kept_late"
  | "credit_kept_over_cap"
  | "credit_kept"
  | "refunded"
  | "nothing_to_return";

/** The cancellation fields a staff read sends with each cancelled booking. */
export interface StaffCancellation {
  cancelled_at: string | null;
  cancelled_by: CancelActor;
  /** The staff member's name when `cancelled_by` is `staff`. */
  cancelled_by_name: string | null;
  late: boolean;
  outcome: CancellationOutcome;
  credits_used: number | null;
}

/**
 * Who cancelled: the member, the named staff member, or "Automatic" — a Void,
 * a Remove, a Package rule change or a request's expiry. A cancel recorded
 * before staff were named reads as the studio's.
 */
export function cancelledByLabel(c: Pick<StaffCancellation, "cancelled_by" | "cancelled_by_name">): string {
  switch (c.cancelled_by) {
    case "member":
      return "Member";
    case "staff":
      return c.cancelled_by_name ?? "Staff";
    case "automatic":
      return "Automatic";
    case "studio":
      return "Studio";
  }
}

/**
 * Where the credit went, in one line. A private session's credit is its
 * session. A Late cancel says so, as the member's own tab does.
 */
export function cancelledOutcomeLine(c: StaffCancellation, kind: "class" | "pt" | "workshop" = "class"): string {
  const unit = kind === "pt" ? "session" : "credit";
  const n = c.credits_used ?? 0;
  switch (c.outcome) {
    case "credit_returned":
      return n > 1 ? `${n} ${unit}s returned` : `${unit.charAt(0).toUpperCase()}${unit.slice(1)} returned`;
    case "credit_kept_late":
      return `Late cancel · ${unit} kept`;
    case "credit_kept_over_cap":
      return `Over cap · ${unit} kept`;
    case "credit_kept":
      return `${unit.charAt(0).toUpperCase()}${unit.slice(1)} kept`;
    case "refunded":
      return "Refunded";
    case "nothing_to_return":
      return "Nothing to return";
  }
}

/** Was the credit kept? The line is toned as a warning then. */
export function creditKept(c: Pick<StaffCancellation, "outcome">): boolean {
  return c.outcome === "credit_kept_late" || c.outcome === "credit_kept_over_cap" || c.outcome === "credit_kept";
}
