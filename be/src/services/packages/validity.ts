/** Global validity for PT packages — the PT catalog has no per-package validity. */
export const PT_VALIDITY_DAYS = 365

export interface PackageValidity {
  kind: 'credit_bundle' | 'unlimited' | 'trial' | 'pt'
  expiresAt: Date | null
  creditsOrSessionsRemaining: number | null
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
 * Dormant: an Unlimited Plan bought while another was still live, whose clock
 * starts at Activation (spec §3). A null `expires_at` means this and nothing
 * else — "never expires" has left the domain, and the `client_packages_kind_fields`
 * check makes an absent expiry impossible for every other kind.
 */
export function isDormant(p: PackageValidity): boolean {
  return p.kind === 'unlimited' && p.expiresAt === null
}

/**
 * A package is consumable (active) when not expired AND (unlimited OR balance > 0).
 *
 * A Dormant plan is active: it is bought, paid for and waiting, and its first
 * confirmed class booking starts its clock. Nothing is expired that has not started.
 */
export function computeActive(p: PackageValidity, now: Date = new Date()): boolean {
  const notExpired = p.expiresAt === null || p.expiresAt > now
  if (!notExpired) return false
  if (p.kind === 'unlimited') return true
  return (p.creditsOrSessionsRemaining ?? 0) > 0
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
