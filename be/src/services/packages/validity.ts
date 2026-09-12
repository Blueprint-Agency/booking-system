export type PackageKind = 'credit_bundle' | 'unlimited' | 'trial' | 'pt'

export interface PackageValidity {
  kind: PackageKind
  expiresAt: Date | null
  creditsOrSessionsRemaining: number | null
}

/**
 * The two **families**, within each of which at most one package is Activated
 * at a time. A Credit Bundle, an Unlimited Plan and a trial all pay for
 * classes, so they queue behind one another; a PT package pays for private
 * sessions and queues only behind other PT packages.
 */
export type PackageFamily = 'class' | 'pt'

export function familyOf(kind: PackageKind): PackageFamily {
  return kind === 'pt' ? 'pt' : 'class'
}

/**
 * Calendar-month arithmetic for a Duration (spec §4). Clamps month-ends the way
 * Postgres `interval` does — 31 August plus six months is 28 February, not 3 March,
 * which is what a naive `setMonth` would roll to.
 *
 * UTC throughout: `expires_at` is a timestamptz and must not drift with the
 * server's local zone.
 */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from)
  const day = d.getUTCDate()
  // Park on the 1st first so the month shift can't overflow on its own.
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const lastDayOfTargetMonth = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate()
  d.setUTCDate(Math.min(day, lastDayOfTargetMonth))
  return d
}

/**
 * Days added to a purchase instant, in UTC. `expires_at` is a timestamptz and
 * must not drift with the server's local zone — `setDate` reads and writes the
 * local day, which shifts the stamp by the offset on a non-UTC host.
 */
export function addDays(from: Date, days: number): Date {
  const d = new Date(from)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

/**
 * The length a package carries, frozen at purchase — a Duration in calendar
 * months for an Unlimited Plan, `validity_days` for every other kind. Both are
 * copied off the catalogue row because the catalogue is admin-editable and
 * Activation reads them later.
 */
export interface PackageLength {
  kind: PackageKind
  durationMonths: number | null
  validityDays: number | null
}

/**
 * When a package expires once it Activates on `activatedAt` — the ONE rule for
 * the end date, which the booking path, the PT request path and any test agree
 * on. Nothing stamps an expiry at purchase any more: every kind waits Dormant
 * until its first booking, and the clock runs from that day (§3).
 *
 *  - unlimited: `activatedAt` plus the frozen Duration, in calendar months
 *  - credit_bundle / trial / pt: `activatedAt` plus the frozen `validity_days`
 *
 * Null when the row carries no length of its own, which the DB check makes
 * impossible — kept as a return rather than a throw so callers decide.
 */
export function activationExpiry(p: PackageLength, activatedAt: Date): Date | null {
  if (p.kind === 'unlimited') {
    return p.durationMonths == null ? null : addMonths(activatedAt, p.durationMonths)
  }
  return p.validityDays == null ? null : addDays(activatedAt, p.validityDays)
}

/**
 * Dormant: bought, paid for, clock not started (spec §3). A null `expires_at`
 * means this and nothing else — "never expires" has left the domain. Every
 * kind is Dormant at purchase and Activates on the first booking it pays for;
 * `kind` is accepted so callers holding a row can pass it whole.
 */
export function isDormant(p: Pick<PackageValidity, 'expiresAt'> & { kind?: PackageKind }): boolean {
  return p.expiresAt === null
}

/**
 * Activated: the clock is running and has not run out. The one reading of
 * "the package paying right now" in a family — selection prefers it, and the
 * partial unique indexes on `client_packages` allow one per family per client.
 */
export function isActivated(p: Pick<PackageValidity, 'expiresAt'>, now: Date): boolean {
  return p.expiresAt !== null && p.expiresAt > now
}

/**
 * A package is consumable (active) when not expired AND (unlimited OR balance > 0).
 *
 * A Dormant package is active: it is bought, paid for and waiting, and its first
 * booking starts its clock. Nothing is expired that has not started.
 */
export function computeActive(p: PackageValidity, now: Date = new Date()): boolean {
  const notExpired = p.expiresAt === null || p.expiresAt > now
  if (!notExpired) return false
  if (p.kind === 'unlimited') return true
  return (p.creditsOrSessionsRemaining ?? 0) > 0
}

/**
 * Whole months of cover left on a plan, which is what a **Cross-Location Add-On**
 * is priced by (§5). A part month is charged as a whole one — the member is told
 * so before they see the total.
 *
 * A **Dormant** plan needs no arithmetic at all: its clock has not started, so it
 * has its full stored Duration ahead of it whenever it eventually starts.
 */
export function crossLocationMonths(
  p: Pick<PackageValidity, 'kind' | 'expiresAt'> & { durationMonths: number | null },
  now: Date,
): number {
  if (isDormant(p)) return p.durationMonths ?? 0
  if (p.expiresAt === null || p.expiresAt <= now) return 0
  // Count whole calendar months with the same clamping arithmetic the Duration
  // uses, then round any remainder up to a whole month.
  let months = 0
  while (addMonths(now, months + 1) <= p.expiresAt) months++
  return addMonths(now, months).getTime() === p.expiresAt.getTime() ? months : months + 1
}

/**
 * Months times the rate, in cents so the arithmetic cannot drift. The rate is
 * read once, at checkout, and frozen as the amount paid onto the plan — a later
 * repricing moves future purchases only (§5).
 */
export function crossLocationPriceSgd(months: number, rateSgd: string | number): string {
  const cents = Math.round(Number(rateSgd) * 100) * months
  return (cents / 100).toFixed(2)
}

export type MovementRefusal = 'overdraw' | 'unlimited_has_no_balance' | 'invalid_amount'

export type MovementResult =
  | { ok: true; remaining: number; active: boolean }
  | { ok: false; refusal: MovementRefusal }

/**
 * The whole arithmetic + flag decision for one credit movement, as a pure
 * function — `./ledger.ts` is the only thing that writes the result to the DB.
 *
 * `delta` is signed: negative debits, positive refunds. Kept free of imports
 * beyond this file so it stays checkable without a DB or a loaded env.
 *
 * Refusals are returned rather than thrown so this stays pure; `ledger.ts`
 * maps them to the project's typed errors, which is where callers meet them.
 */
export function applyMovement(
  p: PackageValidity,
  delta: number,
  now: Date = new Date(),
): MovementResult {
  if (!Number.isInteger(delta)) return { ok: false, refusal: 'invalid_amount' }
  // Unlimited packages have no balance (null remaining). Refuse rather than
  // coerce null to 0, which would write a real balance onto the column.
  // Booking against an unlimited package debits nothing and never gets here.
  if (p.creditsOrSessionsRemaining === null) {
    return { ok: false, refusal: 'unlimited_has_no_balance' }
  }
  const remaining = p.creditsOrSessionsRemaining + delta
  if (remaining < 0) return { ok: false, refusal: 'overdraw' }
  return {
    ok: true,
    remaining,
    // The invariant this module exists to protect: every movement re-derives
    // `active` from the NEW balance + expiry. A refund into an emptied bundle
    // makes it spendable again; a refund into an expired one does not.
    active: computeActive({ ...p, creditsOrSessionsRemaining: remaining }, now),
  }
}
