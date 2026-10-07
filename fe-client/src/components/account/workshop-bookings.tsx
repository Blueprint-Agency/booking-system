/**
 * A member's workshop booking, as `GET /me/workshop-bookings` returns it.
 * Read-only: workshop cancellations and refunds are arranged with the studio,
 * not self-served in-app (#272). The list itself is "Your bookings" (`/account`).
 */
export interface ApiWorkshopBooking {
  id: string;
  workshop_id: string;
  workshop_name: string;
  tier_id: string | null;
  tier_name: string | null;
  state: string;
  check_in_state: "pending" | "attended" | "no_show" | "n_a";
  booked_at: string;
  cancelled_at: string | null;
  /** On a cancelled place: `stripe_refunded` once the money went back to the card, else `n_a`. */
  refund_outcome: string;
  /** On a cancelled place, its lines as the server's cancellation summary words them (#351). */
  who_line: string | null;
  outcome_line: string | null;
  code: string;
  qr_token: string;
  location: { id: string; name: string; address: string | null } | null;
  starts_at: string | null;
  ends_at: string | null;
}
