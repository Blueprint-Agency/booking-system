/**
 * Instructor Pay as a scheduling form sends it. Pay is optional when an admin
 * schedules (be/docs/adr/0008-instructor-pay-is-optional-when-scheduling.md): a
 * blank field leaves that instructor Unpriced, and an admin prices them later
 * from Finance's Needs pay filter.
 */

/** Shown under the main instructor's pay field wherever a session is scheduled. */
export const PAY_OPTIONAL_HINT = "Leave blank to set it later in Finance.";

/**
 * A pay field's text → the API's `pay_sgd`. Blank is Unpriced (`null`), never
 * S$0 — "not decided yet" must not read as "paid nothing". A typed 0 is a price.
 */
export function payOrNull(text: string): number | null {
  const t = text.trim();
  return t === "" ? null : Number(t);
}
