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
import type { PromoCodeProduct } from '../../db/enums'

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

/**
 * How long a Hold lasts. The payment session's expiry is set to the same
 * moment, which is why a member who has paid can never be told the code ran
 * out. The provider's 30-minute minimum is where the number comes from.
 */
export const HOLD_MINUTES = 30

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

  const mine = input.redemptions.filter(r => r.clientId === input.clientId)
  if (mine.some(r => occupiesPlace(r, now))) {
    return { ok: false, refusal: 'already_redeemed' }
  }
  if (
    code.maxRedemptions != null &&
    usedPlaces(input.redemptions, now) >= code.maxRedemptions
  ) {
    return { ok: false, refusal: 'fully_claimed' }
  }

  const discountSgd = moneyOffFor(code, input.basePriceSgd)
  const base = Number(input.basePriceSgd)
  const effective = Number.isFinite(base) ? Math.max(base - Number(discountSgd), 0) : 0
  return { ok: true, discountSgd, effectivePriceSgd: effective.toFixed(2) }
}
