/**
 * What a member is allowed to put on this card — decided without a database.
 *
 * A card at its daily limit declines the whole charge, and no API will tell us
 * what that limit is, so the member is the only party who can say what each
 * card will take. They name an amount; this decides whether it is one the
 * studio can accept. A declined attempt captures nothing and moves nothing, so
 * guessing too high costs a retry rather than the sale.
 *
 * Two rules, and both exist to stop a Purchase being *stranded* — left owing a
 * remainder no card network will charge, which nobody can clear and which the
 * studio would then be holding money against forever:
 *
 *   1. **Never leave less than the floor outstanding.** Either pay the whole
 *      remainder, or leave at least the floor behind for the next card.
 *   2. **Never charge less than the floor.** A payment the provider would
 *      refuse is not a payment.
 *
 * The one place those two collide is a Balance already below the floor — a
 * remainder inherited from before this rule, or from a floor that later moved.
 * There the only permitted amount is the whole remainder, which rule 2 would
 * otherwise forbid: an amount the provider might refuse beats a Balance no
 * amount can clear, and the refusal costs a member one message.
 *
 * Everything is integer cents. `numeric` comes back from Postgres as a string
 * and summing those as floats is how a Purchase ends up one cent from settled.
 */
import { BadRequestError } from '../../shared/errors'

/**
 * The smallest payment worth sending to the provider, in cents.
 *
 * Stripe refuses an SGD charge under S$0.50; this sits at S$1 so a Purchase is
 * never left owing an amount that is *technically* chargeable but costs more in
 * card fees than it collects. It is deliberately a constant rather than a
 * studio setting — it describes the card networks, not the studio's terms.
 */
export const PART_PAYMENT_FLOOR_CENTS = 100

/** The only amount permitted when the Balance is already under the floor. */
export const mustPayInFull = (outstandingCents: number): boolean =>
  outstandingCents <= PART_PAYMENT_FLOOR_CENTS

/**
 * The amount this card will be charged, or a refusal an interface can print.
 *
 * `requestedCents` is null for an ordinary, untouched, whole-price checkout —
 * the default, and the shape every existing sale takes. `outstandingCents` is
 * read from the Purchase's own Balance by the caller and never from the
 * browser: a member who can edit a number in a form can otherwise ask to pay
 * one cent for a plan.
 *
 * **A request for more than is outstanding is refused, not clamped.** Silently
 * charging less than asked is the one outcome a member cannot audit — they
 * would see a smaller charge on the statement and no reason for it — and it
 * hides the browser-side bug that produced the number.
 */
export function chargeableCents(
  outstandingCents: number,
  requestedCents: number | null,
): number {
  if (outstandingCents <= 0) {
    throw new BadRequestError('purchase_settled', {
      message: 'This purchase has already been paid in full.',
    })
  }
  if (requestedCents == null) return outstandingCents

  if (!Number.isInteger(requestedCents) || requestedCents <= 0) {
    throw new BadRequestError('part_payment_invalid', {
      message: 'Enter an amount in dollars and cents.',
    })
  }
  if (requestedCents > outstandingCents) {
    throw new BadRequestError('part_payment_exceeds_balance', {
      message: `You can pay at most ${sgd(outstandingCents)} — that is all that is left on this purchase.`,
      outstanding_sgd: sgd(outstandingCents),
    })
  }
  if (requestedCents === outstandingCents) return requestedCents

  // Below here the member is asking to leave something behind, so both floors
  // apply. When the Balance itself is under the floor there is nothing to leave
  // behind that anyone could charge later — pay it all or pay none of it.
  if (mustPayInFull(outstandingCents)) {
    throw new BadRequestError('part_payment_remainder_too_small', {
      message: `Only ${sgd(outstandingCents)} is left, so this one has to be paid in full.`,
      outstanding_sgd: sgd(outstandingCents),
    })
  }
  if (requestedCents < PART_PAYMENT_FLOOR_CENTS) {
    throw new BadRequestError('part_payment_below_floor', {
      message: `A part payment has to be at least ${sgd(PART_PAYMENT_FLOOR_CENTS)}.`,
    })
  }
  if (outstandingCents - requestedCents < PART_PAYMENT_FLOOR_CENTS) {
    throw new BadRequestError('part_payment_remainder_too_small', {
      message: `That would leave under ${sgd(PART_PAYMENT_FLOOR_CENTS)} to pay later. Pay a little less, or pay the whole ${sgd(outstandingCents)}.`,
      outstanding_sgd: sgd(outstandingCents),
    })
  }
  return requestedCents
}

/**
 * An amount was asked for at a studio that does not offer Part Payment.
 *
 * **Refused, not ignored.** Ignoring it would charge the whole price when the
 * member asked for part of it — more money than they agreed to, which is the
 * one direction a misunderstanding here must never run. It is only reachable by
 * a request the checkout page does not make, or by an owner switching the
 * option off while somebody is on the page.
 */
export function refusePartPaymentWhenDisabled(requestedCents: number | null): void {
  if (requestedCents == null) return
  throw new BadRequestError('part_payment_unavailable', {
    message: 'This studio is not accepting part payments. Refresh and pay in full.',
  })
}

/** Cents as a member reads them, for the sentences above. */
const sgd = (cents: number): string => `S$${(cents / 100).toFixed(2)}`
