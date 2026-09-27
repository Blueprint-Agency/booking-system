/**
 * Which package pays for a class booking (be/docs/adr/0010).
 *
 * Two steps, and every path that picks a payer comes through both:
 *
 *  1. **Classify** every live class package the member holds against the class:
 *     **Eligible**, or the first reason it is not. Any number of packages may be
 *     running at once in a Family, so there is no "the running one" to defer to;
 *     each package answers for itself.
 *  2. **Choose.** The member's named package if it is Eligible (refused with its
 *     own reason if not), else the **Default payer**: the first Eligible package
 *     in default order — running packages soonest-ending first, then Dormant ones,
 *     Unlimited Plans before credits, each in the order they were bought.
 *
 * Coverage is a refusal, never a silent fall-through: a plan that does not Cover
 * the class's Location is Ineligible with `location_not_covered`, and the member
 * is told so if nothing else can pay.
 *
 * The class's **Package rule** is tested first: a package whose catalogue package
 * the class does not accept is Ineligible with `not_accepted`, whatever else is
 * true of it (be/CONTEXT.md § Package rule).
 *
 * Pure on purpose. `bookings/book.ts` loads and locks the rows, calls in, and
 * translates the refusal into a typed error; nothing here touches the database.
 */
import type { PackageRuleMode } from '../../db/enums'
import { activationExpiry, isActivated, isDormant } from './validity'

/**
 * What a class accepts: every class package (`all`), only the catalogue
 * packages named, or all but them. Its absence on a class is `all`.
 */
export interface PackageRule {
  mode: PackageRuleMode
  /** Catalogue class package ids. Empty under `all`. */
  packageIds: readonly string[]
}

export const ACCEPTS_ALL: PackageRule = { mode: 'all', packageIds: [] }

/**
 * Whether the rule lets a package bought from this catalogue package pay. A
 * package with no catalogue source is named by no list, so `only` refuses it and
 * `except` takes it.
 */
export function acceptsPackage(rule: PackageRule, sourceClassPackageId: string | null): boolean {
  if (rule.mode === 'all') return true
  const named = sourceClassPackageId !== null && rule.packageIds.includes(sourceClassPackageId)
  return rule.mode === 'only' ? named : !named
}

export interface CandidatePackage {
  id: string
  kind: 'credit_bundle' | 'unlimited' | 'trial' | 'pt'
  /** The catalogue package it was bought as — what a class's Package rule names. */
  sourceClassPackageId: string | null
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
  /** Dormant packages are offered in the order they were bought. */
  purchasedAt: Date
}

export interface ClassifyInput {
  /** The client's active package rows, as the caller read them. */
  packages: CandidatePackage[]
  classLocationId: string
  classStartsAt: Date
  creditCost: number
  /** The class's Package rule — `ACCEPTS_ALL` for a class that has none. */
  rule: PackageRule
  now: Date
}

export interface SelectionInput extends ClassifyInput {
  /**
   * The package the member picked on the Book sheet, or staff picked for them.
   * Absent where nobody picked — a promotion, staff who left it, an old client —
   * and the Default payer is used.
   */
  clientPackageId?: string | null
}

/**
 * Why a package cannot pay for this class, in the order they are tested.
 *
 * `plan_expires_before_class` is NOT a coverage problem: the package does cover
 * the class's Location, it simply runs out before the class runs. Told the
 * coverage refusal instead, a member buys the Cross-Location Add-On to fix a
 * problem the Add-On cannot touch.
 *
 * `not_accepted` comes first: no Add-On, top-up or renewal of that package can
 * make the class take it.
 */
export type SelectionRefusal =
  | 'not_accepted'
  | 'location_not_covered'
  | 'plan_expires_before_class'
  | 'insufficient_credits'

/** One live class package, read against one class. */
export interface ClassifiedPackage {
  pkg: CandidatePackage
  /** Activated: its clock is running. False means Dormant. */
  running: boolean
  /** Null when the package is Eligible to pay for this class. */
  reason: SelectionRefusal | null
  /** What paying would debit: the class's credit cost, or 0 on an Unlimited Plan. */
  creditsUsed: number
  /**
   * Dormant only: the expiry picking it would stamp, counted from the booking
   * moment and never from the class date — from the class date a member could
   * book the furthest-out class on the schedule for a free extension (§3).
   */
  activateUntil: Date | null
}

export type SelectionResult =
  | {
      ok: true
      clientPackageId: string
      creditsUsed: number
      /**
       * Non-null when the chosen package was Dormant: the `expires_at` the caller
       * must stamp on it in the same transaction.
       */
      activateUntil: Date | null
    }
  | { ok: false; refusal: SelectionRefusal }
  /** The member named a package that is not one of their live class packages. */
  | { ok: false; refusal: 'client_package_not_found' }

function isCreditKind(p: CandidatePackage): boolean {
  return p.kind === 'credit_bundle' || p.kind === 'trial'
}

/**
 * Which Locations this plan Covers: its Home Location always, and every other
 * one too while it carries a Cross-Location Add-On (§5).
 */
function covers(p: CandidatePackage, classLocationId: string): boolean {
  return p.locationId === classLocationId || p.crossLocationPaidSgd !== null
}

/**
 * Default order. Running packages first, soonest-ending first, so the clock
 * about to run out is spent before a longer one; then Dormant packages, an
 * Unlimited Plan before credits (credits are kept for classes a plan cannot pay
 * for), each in the order bought. A running package is always preferred to a
 * Dormant one, so a booking never starts a new clock the member did not ask for.
 */
function defaultOrder(a: CandidatePackage, b: CandidatePackage): number {
  const aRunning = !isDormant(a)
  const bRunning = !isDormant(b)
  if (aRunning !== bRunning) return aRunning ? -1 : 1
  if (aRunning) {
    const byEnd = a.expiresAt!.getTime() - b.expiresAt!.getTime()
    if (byEnd !== 0) return byEnd
  } else {
    const aPlan = a.kind === 'unlimited'
    const bPlan = b.kind === 'unlimited'
    if (aPlan !== bPlan) return aPlan ? -1 : 1
  }
  return a.purchasedAt.getTime() - b.purchasedAt.getTime()
}

/**
 * Every live class package the member holds, read against one class, in default
 * order. What the Book sheet lists, and what `selectPackage` chooses from.
 */
export function classifyPackages(input: ClassifyInput): ClassifiedPackage[] {
  const { packages, classLocationId, classStartsAt, creditCost, rule, now } = input

  // PT packages pay for private sessions, never classes — a different Family.
  // A package spent to zero has ended as surely as an expired one: the ledger
  // flips `active` off and the caller filters on it, but the rule must not
  // depend on that.
  const live = packages.filter(
    p =>
      p.kind !== 'pt' &&
      (isDormant(p) || isActivated(p, now)) &&
      (!isCreditKind(p) || (p.creditsOrSessionsRemaining ?? 0) > 0),
  )

  return [...live].sort(defaultOrder).map(p => {
    const running = !isDormant(p)
    // A Dormant package's test is prospective — `now + its length` — or a member
    // with a three-month plan booking four months out would activate it and
    // instantly invalidate it for the very class that activated it.
    const activateUntil = running ? null : activationExpiry(p, now)
    const coverEnd = running ? p.expiresAt : activateUntil
    const credit = isCreditKind(p)

    let reason: SelectionRefusal | null = null
    if (!acceptsPackage(rule, p.sourceClassPackageId)) reason = 'not_accepted'
    else if (p.kind === 'unlimited' && !covers(p, classLocationId)) reason = 'location_not_covered'
    else if (!coverEnd || coverEnd < classStartsAt) reason = 'plan_expires_before_class'
    else if (credit && (p.creditsOrSessionsRemaining ?? 0) < creditCost) reason = 'insufficient_credits'

    return { pkg: p, running, reason, creditsUsed: credit ? creditCost : 0, activateUntil }
  })
}

/**
 * Why nothing can pay: the reason of the first package in default order — the
 * one the member would have expected to pay — passing over packages the class
 * does not accept, since whatever is wrong with an accepted one is what the
 * member can fix. `not_accepted` only when that is true of every package, and a
 * member holding nothing at all is out of credits.
 */
function refusalOf(classified: ClassifiedPackage[]): SelectionRefusal {
  const fixable = classified.find(c => c.reason !== 'not_accepted')
  if (fixable) return fixable.reason!
  return classified.length > 0 ? 'not_accepted' : 'insufficient_credits'
}

/**
 * The package that pays: the member's pick if they made one and it is Eligible,
 * else the Default payer. Nothing Eligible refuses with `refusalOf`'s reason.
 */
export function selectPackage(input: SelectionInput): SelectionResult {
  const classified = classifyPackages(input)

  let chosen: ClassifiedPackage | undefined
  if (input.clientPackageId) {
    chosen = classified.find(c => c.pkg.id === input.clientPackageId)
    if (!chosen) return { ok: false, refusal: 'client_package_not_found' }
    if (chosen.reason) return { ok: false, refusal: chosen.reason }
  } else {
    chosen = classified.find(c => c.reason === null)
    if (!chosen) return { ok: false, refusal: refusalOf(classified) }
  }

  return {
    ok: true,
    clientPackageId: chosen.pkg.id,
    creditsUsed: chosen.creditsUsed,
    activateUntil: chosen.activateUntil,
  }
}
