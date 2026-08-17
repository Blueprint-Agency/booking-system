/**
 * Promo Code rules — pure (spec-pre-launch-batch.md §9–§11).
 *
 * A Promo Code is typed by the member, reaches across products, and is capped
 * both in total and at one use per member. A Promotion applies itself to one
 * product inside a window and lives in `promotions.ts`. See be/CONTEXT.md
 * § Discounts before touching either.
 *
 * Nothing here touches the database or throws: refusals are RETURNED and the
 * calling service maps them to the project's error types. Same shape as
 * `validity.ts`'s MovementResult.
 */
import { randomInt } from 'node:crypto'
import type {
  promoCodes,
  promoCodeProducts,
  promoCodeRedemptions,
} from '../../db/schema/packages'
import type { PromoCodeKind, PromoCodeProduct } from '../../db/enums'

export type PromoCodeRow = typeof promoCodes.$inferSelect
export type PromoCodeProductRow = typeof promoCodeProducts.$inferSelect
export type PromoCodeRedemptionRow = typeof promoCodeRedemptions.$inferSelect

/**
 * No `0`/`O`, no `1`/`I`/`L` — members read these aloud down a phone line.
 */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const GENERATED_CODE_LENGTH = 8

/** Custom codes: 3–24 of [A-Z0-9-]. Mirrors the promo_codes_code_format check. */
export const CODE_FORMAT = /^[A-Z0-9-]{3,24}$/

/** Entry is case- and whitespace-insensitive; the normalised form is stored and compared. */
export function normaliseCode(input: string): string {
  return input.trim().toUpperCase()
}

export function isValidCode(code: string): boolean {
  return CODE_FORMAT.test(code)
}

/**
 * Generate an 8-character code. Generated and custom codes share one namespace
 * behind one unique index, so collision is impossible by construction; the
 * caller retries this on a unique violation rather than pre-checking.
 */
export function generateCode(): string {
  let out = ''
  for (let i = 0; i < GENERATED_CODE_LENGTH; i++) {
    out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  }
  return out
}

export interface ProductRef {
  productType: PromoCodeProduct
  productId: string
}

/**
 * Five outcomes, four of them specific. `not_recognised` deliberately covers
 * both an unknown code and an archived one — separating them would turn the
 * validation endpoint into a code-guessing oracle.
 */
export type PromoCodeRefusal =
  | 'expired'
  | 'fully_claimed'
  | 'already_redeemed'
  | 'out_of_scope'
  | 'not_recognised'

/**
 * How long a Hold lives, and therefore how long the payment session lives — the
 * two end at the same moment, so a member who has paid can never be told the
 * code ran out. 30 is the provider's minimum session length, which is what sets
 * it. Applies only to a capped code; an uncapped checkout keeps 24 hours.
 */
export const HOLD_MINUTES = 30

/**
 * The provider measures its 30-minute minimum from the moment IT receives the
 * session, which is a few database round-trips after the Hold is taken. Without
 * this cushion the session creation is refused for being a second short. It is
 * added to the Hold as well as the session, so the two still end at the same
 * instant — which is the property that matters.
 */
export const HOLD_CUSHION_SECONDS = 60

export function holdExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + HOLD_MINUTES * 60_000 + HOLD_CUSHION_SECONDS * 1000)
}

/**
 * What the member is told. Unknown and archived share `not_recognised`'s
 * sentence for the same reason they share the refusal.
 */
export function refusalMessage(refusal: PromoCodeRefusal, productName: string): string {
  switch (refusal) {
    case 'expired':
      return 'This code has expired'
    case 'fully_claimed':
      return 'This code has been fully claimed'
    case 'already_redeemed':
      return "You've already used this code"
    case 'out_of_scope':
      return `This code doesn't apply to ${productName}`
    case 'not_recognised':
      return "We don't recognise that code"
  }
}

export type PromoCodeEvaluation =
  | { ok: true; discountSgd: string; effectivePriceSgd: string }
  | { ok: false; refusal: PromoCodeRefusal }

/**
 * Does this Redemption row still occupy one of the code's places?
 *
 * Consumed always does. A Hold does only while it is live — an abandoned one
 * lapses because this predicate says so, with no cron job and no sweeper.
 * A refunded row never does: the money went back, so the place is free.
 */
export function occupiesPlace(r: PromoCodeRedemptionRow, now: Date = new Date()): boolean {
  if (r.status === 'consumed') return true
  if (r.status === 'held') return r.heldUntil > now
  return false
}

/** How many of the code's places are taken right now. */
export function usedPlaces(
  redemptions: PromoCodeRedemptionRow[],
  now: Date = new Date(),
): number {
  return redemptions.reduce((n, r) => (occupiesPlace(r, now) ? n + 1 : n), 0)
}

/**
 * How many members have actually used this code — the count that freezes its
 * text and its money off (§9, story 63: "frozen once someone has **used** it").
 *
 * Deliberately not `usedPlaces`. A place can be taken by a live Hold, which is
 * an in-flight checkout that may never complete; freezing a live campaign's
 * terms on one abandoned checkout is not a rule anyone asked for. A refunded
 * Redemption keeps its row (story 89) but is a sale that was undone, so it
 * stops freezing too — there is no longer a member standing on those terms.
 *
 * Unlike a place, this needs no `now`: consumed is permanent, and nothing here
 * lapses.
 */
export function consumedCount(redemptions: PromoCodeRedemptionRow[]): number {
  return redemptions.reduce((n, r) => (r.status === 'consumed' ? n + 1 : n), 0)
}

/**
 * A code either applies to everything or names its products explicitly.
 * `appliesToAll` means no scope rows at all, so the rows are not consulted.
 * Workshops match at workshop level — a tier is never a scope row.
 */
export function coversProduct(
  code: PromoCodeRow,
  scope: PromoCodeProductRow[],
  product: ProductRef,
): boolean {
  if (code.appliesToAll) return true
  return scope.some(
    s => s.productType === product.productType && s.productId === product.productId,
  )
}

/**
 * A `kind` names exactly one money field, and that field must be present. The
 * `promo_codes_kind_fields` check holds the same pairing in the database; this
 * is the same rule stated where a caller can be refused cleanly instead of
 * meeting a constraint violation.
 *
 * Returns the refusal rather than throwing, like everything else in this module.
 */
export function missingMoneyField(input: {
  kind: PromoCodeKind
  percentOff?: number | null
  amountOffSgd?: string | null
}): 'percent_off_required' | 'amount_off_sgd_required' | null {
  if (input.kind === 'percent' && input.percentOff == null) return 'percent_off_required'
  if (input.kind === 'amount' && input.amountOffSgd == null) return 'amount_off_sgd_required'
  return null
}

/**
 * The money taken off, as a 2dp string. Floors at zero and never exceeds the
 * base — that is the whole of the "cannot drive a package below cost" guard.
 * The automatic Promotion is already baked into `basePriceSgd`, so a code
 * takes its cut of the already-reduced figure.
 */
export function moneyOffFor(code: PromoCodeRow, basePriceSgd: string): string {
  const base = Number(basePriceSgd)
  if (!Number.isFinite(base) || base <= 0) return '0.00'
  const raw =
    code.kind === 'percent' && code.percentOff != null
      ? (base * code.percentOff) / 100
      : code.kind === 'amount' && code.amountOffSgd != null
        ? Number(code.amountOffSgd)
        : 0
  if (!Number.isFinite(raw) || raw <= 0) return '0.00'
  return Math.min(raw, base).toFixed(2)
}

export interface EvaluateInput {
  /** null when no row matched the typed text — indistinguishable from archived. */
  code: PromoCodeRow | null
  /** Scope rows for this code. Ignored when `appliesToAll`. */
  scope: PromoCodeProductRow[]
  /** Every Redemption row for this code, this member's included. */
  redemptions: PromoCodeRedemptionRow[]
  clientId: string
  product: ProductRef
  /** Price after any automatic Promotion. */
  basePriceSgd: string
  now?: Date
}

/**
 * Decide whether this member may use this code on this product, and for how
 * much. Refusal order matters in one place: the member's own live Hold is
 * checked before the total cap, or their own retry would be reported as
 * "fully claimed".
 */
export function evaluatePromoCode(input: EvaluateInput): PromoCodeEvaluation {
  const now = input.now ?? new Date()
  const { code } = input

  if (!code || code.status !== 'active') return { ok: false, refusal: 'not_recognised' }
  if (code.expiresAt != null && code.expiresAt <= now) return { ok: false, refusal: 'expired' }
  if (!coversProduct(code, input.scope, input.product)) {
    return { ok: false, refusal: 'out_of_scope' }
  }

  // One use per member, counted on what they have actually taken: a Consumed
  // Redemption of their own is the rule. Their own live Hold is NOT — it is the
  // place they are standing in, and refusing it would lock a member out of their
  // own abandoned checkout for the length of the Hold. The upsert re-takes that
  // row rather than adding one, which is what makes the retry idempotent.
  const mine = input.redemptions.filter(r => r.clientId === input.clientId)
  if (mine.some(r => r.status === 'consumed')) {
    return { ok: false, refusal: 'already_redeemed' }
  }
  // Their own Hold is excluded from the count for the same reason: re-taking a
  // place they already occupy cannot exhaust the cap.
  const others = input.redemptions.filter(r => r.clientId !== input.clientId)
  if (code.maxRedemptions != null && usedPlaces(others, now) >= code.maxRedemptions) {
    return { ok: false, refusal: 'fully_claimed' }
  }

  const discountSgd = moneyOffFor(code, input.basePriceSgd)
  const base = Number(input.basePriceSgd)
  const effective = Number.isFinite(base) ? Math.max(base - Number(discountSgd), 0) : 0
  return { ok: true, discountSgd, effectivePriceSgd: effective.toFixed(2) }
}
