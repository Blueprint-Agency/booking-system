/**
 * How staff read a cancellation (#352): the profile's Cancelled tab and the
 * class roster's Cancelled section. The backend's shared cancellation summary
 * (`be/src/services/bookings/cancellation-summary.ts`) decides who cancelled
 * and where the credit went, and words both lines — the same sentences the
 * member's Cancelled tab reads, but for whose cap and card it is — so this app
 * shows them as sent. A credit is returned or kept, never "refunded"; only a
 * workshop's money is refunded.
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
  /** Who: "Member", the staff member's name, "Automatic" or "Studio". */
  who_line: string;
  /** Where the credit went, in one line: "Late cancel · credit not returned". */
  outcome_line: string;
  credits_used: number | null;
}

/** Was the credit kept? The line is toned as a warning then. */
export function creditKept(c: Pick<StaffCancellation, "outcome">): boolean {
  return c.outcome === "credit_kept_late" || c.outcome === "credit_kept_over_cap" || c.outcome === "credit_kept";
}
