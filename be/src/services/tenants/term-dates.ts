/**
 * The calendar arithmetic of a studio's Term — see `./term.ts` for what a Term
 * is. Its own module, with no database, so the rules are decidable (and
 * testable) without one, and so `./tenants.ts` can read them without importing
 * the module that writes Terms.
 */
import { tenants, type TenantRow } from '../../db/schema/tenancy'
import type { TenantStatus } from '../../db/enums'

/** The zone a studio created without one is on — the `tenants.timezone` column
 *  default, read from the schema so the two cannot disagree. */
export const DEFAULT_TIMEZONE = String(tenants.timezone.default)

/** The durations the operator can pick, in months. */
export const TERM_MONTHS = [3, 6, 12] as const
export type TermMonths = (typeof TERM_MONTHS)[number]

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Is this a real calendar date written `YYYY-MM-DD`? */
export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const at = new Date(Date.UTC(y, mo - 1, d))
  return at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d
}

/**
 * `start` plus `months`, as a calendar date.
 *
 * A day that does not exist in the target month is clamped to that month's last
 * day — 31 August plus 6 months is 28 (or 29) February, not 3 March — which is
 * what Postgres's `date + interval` does and what a person means by "six months".
 */
export function termEndDate(start: string, months: number): string {
  const m = ISO_DATE.exec(start)
  // Invariant: callers validate the date first (`isIsoDate`) — the route's zod does.
  if (!m || !isIsoDate(start)) throw new Error(`not a date: ${start}`)
  const monthIndex = Number(m[2]) - 1 + months
  const year = Number(m[1]) + Math.floor(monthIndex / 12)
  const month = ((monthIndex % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const day = Math.min(Number(m[3]), lastDay)
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** The calendar date it is at `at` in `timezone`, as `YYYY-MM-DD`. */
export function localDate(timezone: string, at: Date = new Date()): string {
  // `en-CA` formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

/** Today on this studio's clock — the default start of a new Term. A zone the
 *  runtime cannot read falls back to UTC rather than refusing to provision. */
export function todayFor(timezone: string | undefined, at: Date = new Date()): string {
  try {
    return localDate(timezone ?? 'UTC', at)
  } catch {
    return localDate('UTC', at)
  }
}

type TermFields = Pick<TenantRow, 'timezone' | 'termEndDate'>

/** Has this studio's Term ended — is it on or past its end date, on its own clock? */
export function termEnded(tenant: TermFields, at: Date = new Date()): boolean {
  if (!tenant.termEndDate) return false
  // A zone the runtime cannot read is read as UTC: at worst a few hours out,
  // never a studio left open indefinitely or closed for good.
  return todayFor(tenant.timezone, at) >= tenant.termEndDate
}

/**
 * The status a studio actually has right now: its stored status, except that an
 * active studio whose Term has ended is suspended. Read wherever a status
 * decides what a request may do, so the Term ending takes effect on the dot
 * rather than at the next sweep.
 */
export function effectiveStatus(
  tenant: TermFields & Pick<TenantRow, 'status'>,
  at: Date = new Date(),
): TenantStatus {
  return tenant.status === 'active' && termEnded(tenant, at) ? 'suspended' : tenant.status
}
