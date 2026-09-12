/**
 * Which package pays for a class booking (spec §2, §3).
 *
 * Two rules live here and nowhere else:
 *
 *  1. **One Activated package per family.** The class family is Credit Bundle
 *     + Unlimited + trial. While one of them is running, it is the only one that
 *     can pay — nothing waiting behind it starts, even for a class it cannot
 *     cover. When it has ended (expired, or spent to zero), the next booking
 *     Activates the package that has been waiting longest.
 *  2. **Coverage is a refusal, not a fallback.** A member holding a plan for one
 *     studio who books at the other used to have their credits spent silently —
 *     the old booking path found no usable plan and fell straight through to the
 *     credit branch.
 *
 * Pure on purpose. `bookings/book.ts` loads and locks the rows, calls in, and
 * translates the refusal into a typed error; nothing here touches the database,
 * so every rule below is testable without one. Refusals are returned rather than
 * thrown, exactly as `./validity.ts` does for credit movements.
 */
import { activationExpiry, isActivated, isDormant } from './validity'

export interface CandidatePackage {
  id: string
  kind: 'credit_bundle' | 'unlimited' | 'trial' | 'pt'
  /** Null means Dormant, and nothing else (§3). */
  expiresAt: Date | null
  /** Home Location — set on an Unlimited Plan, null on every other kind (§1). */
  locationId: string | null
  /** Frozen Duration, Unlimited only (§4). Read when a Dormant plan activates. */
  durationMonths: number | null
  /** Frozen validity in days, every kind but Unlimited. Read at Activation. */
  validityDays: number | null
  creditsOrSessionsRemaining: number | null
  /**
   * The **Cross-Location Add-On** (§5) — what the member paid to have this plan
   * Cover the other Location as well. Null means Home Location only.
   */
  crossLocationPaidSgd: string | null
  /** Waiting packages Activate in the order they were bought. */
  purchasedAt: Date
}

export interface SelectionInput {
  /** The client's active package rows, already locked by the caller. */
  packages: CandidatePackage[]
  classLocationId: string
  classStartsAt: Date
  creditCost: number
  /**
   * The member asked to pay with credits (§2 point 5). Deliberately the one
   * piece of client input the booking path accepts.
   *
   * Read only when nothing in the class family is running: it is how a member
   * holding a Dormant plan and Dormant credits starts the credits and keeps the
   * plan waiting (§3). While a package IS running, it is the only one that can
   * pay, and the flag changes nothing.
   */
  useCredits: boolean
  now: Date
}

/**
 * `plan_expires_before_class` is NOT a coverage problem: the running package
 * does cover the class's Location, it simply runs out before the class runs
 * (§3). Told the coverage refusal instead, a member buys the Cross-Location
 * Add-On to fix a problem the Add-On cannot touch.
 */
export type SelectionRefusal =
  | 'location_not_covered'
  | 'plan_expires_before_class'
  | 'insufficient_credits'

export type SelectionResult =
  | {
      ok: true
      clientPackageId: string
      creditsUsed: number
      /**
       * Non-null when the chosen package was Dormant: the `expires_at` the caller
       * must stamp on it in the same transaction. Counted from the booking
       * moment, never from the class date — from the class date a member could
       * book the furthest-out class on the schedule for a free extension (§3).
       */
      activateUntil: Date | null
    }
  | { ok: false; refusal: SelectionRefusal }

/** Bought first, starts first. */
function byPurchase(a: CandidatePackage, b: CandidatePackage): number {
  return a.purchasedAt.getTime() - b.purchasedAt.getTime()
}

/**
 * When this package's cover runs out, or null if it can never cover the class.
 * An Activated package is tested against its own expiry; a Dormant one's test is
 * prospective — `now + its length` — or a member with a three-month plan booking
 * four months out would activate it and instantly invalidate it for the very
 * class that activated it.
 */
function coverEnd(p: CandidatePackage, now: Date): Date | null {
  return isDormant(p) ? activationExpiry(p, now) : p.expiresAt
}

/**
 * Which Locations this plan Covers: its Home Location always, and the other one
 * too while it carries a Cross-Location Add-On (§5).
 */
function covers(p: CandidatePackage, classLocationId: string): boolean {
  return p.locationId === classLocationId || p.crossLocationPaidSgd !== null
}

function isCreditKind(p: CandidatePackage): boolean {
  return p.kind === 'credit_bundle' || p.kind === 'trial'
}

export function selectPackage(input: SelectionInput): SelectionResult {
  const { packages, classLocationId, classStartsAt, creditCost, useCredits, now } = input

  // PT packages pay for private sessions, never classes — a different family.
  // A package spent to zero has ended as surely as an expired one: the ledger
  // flips `active` off and the caller filters on it, but the rule must not
  // depend on that — an empty bundle holding the family's one slot would
  // strand every package behind it.
  const live = packages.filter(
    p =>
      p.kind !== 'pt' &&
      (isDormant(p) || isActivated(p, now)) &&
      (!isCreditKind(p) || (p.creditsOrSessionsRemaining ?? 0) > 0),
  )

  // The one running package in the family, if any. The partial unique index
  // guarantees there is at most one; a second here is a bug upstream, and the
  // earliest-ending one is the least wrong to answer with.
  const running = live
    .filter(p => !isDormant(p))
    .sort((a, b) => a.expiresAt!.getTime() - b.expiresAt!.getTime())[0]

  if (running) {
    // It is the only package that may pay. Nothing waiting behind it starts
    // while it runs — not for the other studio, not for a class after it ends,
    // not because the member asked for credits. Refuse with the reason that
    // actually happened, so the member is not sold the wrong remedy.
    if (running.kind === 'unlimited' && !covers(running, classLocationId)) {
      return { ok: false, refusal: 'location_not_covered' }
    }
    if (running.expiresAt! < classStartsAt) {
      return { ok: false, refusal: 'plan_expires_before_class' }
    }
    if (isCreditKind(running) && (running.creditsOrSessionsRemaining ?? 0) < creditCost) {
      return { ok: false, refusal: 'insufficient_credits' }
    }
    return {
      ok: true,
      clientPackageId: running.id,
      creditsUsed: isCreditKind(running) ? creditCost : 0,
      activateUntil: null,
    }
  }

  // Nothing is running: this booking Activates the next package, the one that
  // has waited longest (§3).
  const waiting = live.sort(byPurchase)
  const plans = waiting.filter(p => p.kind === 'unlimited')

  // A member holding no plan at all has nothing to be refused about — they go
  // to credits as they always did.
  if (plans.length > 0 && !useCredits) {
    // Set when a plan that DOES cover this Location was passed over for running
    // out first — the difference between the two refusals below.
    let ranOutFirst = false
    for (const plan of plans.filter(p => covers(p, classLocationId))) {
      const end = coverEnd(plan, now)
      if (!end || end < classStartsAt) {
        ranOutFirst = true
        continue
      }
      return { ok: true, clientPackageId: plan.id, creditsUsed: 0, activateUntil: end }
    }
    // No plan covers this class at the Location AND on the day. Refuse — a
    // silent fall-through here is the whole defect.
    return { ok: false, refusal: ranOutFirst ? 'plan_expires_before_class' : 'location_not_covered' }
  }

  const credit = waiting.filter(p => {
    if (!isCreditKind(p) || (p.creditsOrSessionsRemaining ?? 0) < creditCost) return false
    // Still valid when the class actually runs, not merely today.
    const end = coverEnd(p, now)
    return end !== null && end >= classStartsAt
  })[0]
  if (!credit) return { ok: false, refusal: 'insufficient_credits' }

  return {
    ok: true,
    clientPackageId: credit.id,
    creditsUsed: creditCost,
    activateUntil: coverEnd(credit, now),
  }
}
