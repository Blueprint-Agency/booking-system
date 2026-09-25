/**
 * Whether a studio can take this payment online (#293).
 *
 * Every studio takes card payments on its own payment account, and a studio
 * that has not supplied one takes none. The member is told so in words where a
 * buy button would otherwise be — a button that can only fail is worse than a
 * sentence.
 *
 * Pure, so it is testable without a browser.
 */
export const NO_ONLINE_PAYMENTS = "This studio isn't taking online payments yet.";

/**
 * Is this purchase blocked because the studio takes no online payments?
 *
 * Only when the studio has *said* it takes none (`false`) and there is money to
 * take. Unknown (`null` — still loading, or the read failed) never blocks: the
 * server refuses the checkout anyway, and a studio that does sell must not lose
 * its buy button to a slow request. A $0 purchase never reaches the payment
 * provider, so it is never blocked. A price that is not a number reads as paid,
 * as it does on the buy button — bad catalogue data must never look free.
 */
export function blockedByPayments(onlinePayments: boolean | null, amountSgd: string | number): boolean {
  return onlinePayments === false && !(Number(amountSgd) <= 0);
}
