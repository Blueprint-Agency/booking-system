/**
 * Which package pays for a class booking (spec §2).
 *
 * The defect this module exists to prevent: a member holding an Unlimited Plan
 * for one studio who books at the other used to have their credits spent
 * silently — the old booking path found no usable plan and fell straight
 * through to the credit branch. Coverage is a refusal, not a fallback.
 *
 * Pure on purpose. `bookings/book.ts` loads and locks the rows, calls in, and
 * translates the refusal into a typed error; nothing here touches the database,
 * so every rule below is testable without one. Refusals are returned rather than
 * thrown, exactly as `./validity.ts` does for credit movements.
 */
import { addMonths, isDormant } from './validity'

export interface CandidatePackage {
  id: string
  kind: 'credit_bundle' | 'unlimited' | 'trial' | 'pt'
  /** Null on an Unlimited Plan means Dormant, and nothing else (§3). */
  expiresAt: Date | null
  /** Home Location — set on an Unlimited Plan, null on every other kind (§1). */
  locationId: string | null
  /** Frozen Duration, Unlimited only (§4). Read when a Dormant plan activates. */
  durationMonths: number | null
  creditsOrSessionsRemaining: number | null
}

export interface SelectionInput {
  /** The client's active package rows, already locked by the caller. */
  packages: CandidatePackage[]
  classLocationId: string
  classStartsAt: Date
  creditCost: number
  /**
   * The member asked to pay with credits (§2 point 5). Deliberately the one
   * piece of client input the booking path accepts — without it a member holding
   * a plan for the wrong Location and paid credits is stranded.
   *
   * Taken at its word even when a plan does cover the class: that is also how a
   * member keeps a Dormant plan waiting instead of starting its clock (§3). The
   * member surface only offers it on a class the plan does not cover.
   */
  useCredits: boolean
  now: Date
}

export type SelectionRefusal = 'location_not_covered' | 'insufficient_credits'

export type SelectionResult =
  | {
      ok: true
      clientPackageId: string
      creditsUsed: number
      /**
       * Non-null when the chosen plan was Dormant: the `expires_at` the caller
       * must stamp on it in the same transaction. Counted from the booking
       * moment, never from the class date — from the class date a member could
       * book the furthest-out class on the schedule for a free extension (§3).
       */
      activateUntil: Date | null
    }
  | { ok: false; refusal: SelectionRefusal }

/** Soonest-expiring first, a null expiry last — Dormant plans sort as infinity. */
function bySoonestExpiry(a: CandidatePackage, b: CandidatePackage): number {
  return (a.expiresAt?.getTime() ?? Infinity) - (b.expiresAt?.getTime() ?? Infinity)
}

/**
 * When this plan's cover runs out, or null if it can never cover the class.
 * An Activated plan is tested against its own expiry; a Dormant plan's test is
 * prospective — `now + duration_months` — or a member with a three-month plan
 * booking four months out would activate it and instantly invalidate it for the
 * very class that activated it.
 */
function coverEnd(p: CandidatePackage, now: Date): Date | null {
  if (!isDormant(p)) return p.expiresAt
  if (p.durationMonths == null) return null
  return addMonths(now, p.durationMonths)
}

export function selectPackage(input: SelectionInput): SelectionResult {
  const { packages, classLocationId, classStartsAt, creditCost, useCredits, now } = input

  const live = packages.filter(p => p.expiresAt === null || p.expiresAt > now)
  const plans = live.filter(p => p.kind === 'unlimited')

  // A member holding no live plan at all has nothing to be refused about — they
  // go to credits as they always did.
  if (plans.length > 0 && !useCredits) {
    // A Dormant plan starts on the first booking made AFTER the plan in front of
    // it has ended (§3). While an Activated plan is still running — even one that
    // lapses before this class does — activating the one behind it would put two
    // Activated plans on the member and hit the partial unique index in their face.
    const anyActivated = plans.some(p => !isDormant(p))
    for (const plan of plans.filter(p => p.locationId === classLocationId).sort(bySoonestExpiry)) {
      if (isDormant(plan) && anyActivated) continue
      const end = coverEnd(plan, now)
      if (!end || end < classStartsAt) continue
      return {
        ok: true,
        clientPackageId: plan.id,
        creditsUsed: 0,
        activateUntil: isDormant(plan) ? end : null,
      }
    }
    // No plan covers this class at the Location AND on the day. Refuse — a
    // silent fall-through here is the whole defect.
    return { ok: false, refusal: 'location_not_covered' }
  }

  const credit = live
    .filter(
      p =>
        (p.kind === 'credit_bundle' || p.kind === 'trial') &&
        (p.creditsOrSessionsRemaining ?? 0) >= creditCost &&
        // Still valid when the class actually runs, not merely today.
        (p.expiresAt === null || p.expiresAt >= classStartsAt),
    )
    .sort(bySoonestExpiry)[0]
  if (!credit) return { ok: false, refusal: 'insufficient_credits' }

  return { ok: true, clientPackageId: credit.id, creditsUsed: creditCost, activateUntil: null }
}
