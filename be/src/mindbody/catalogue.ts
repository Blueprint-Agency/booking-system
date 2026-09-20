import type { StudioConfigInput } from './config'
import type { MindbodyReports } from './mapper'
import type { HoldingRow } from './readers'
import { dayNumber, normaliseOptionName, type CalendarDate } from './values'

/**
 * The catalogue a studio's Mindbody implies, proposed for a person to correct.
 *
 * Mindbody has no report of its pricing options as such, so each one is read
 * back from what was sold under its name: how many sessions people bought, how
 * long they had to use them, what they paid. The most common value wins, because
 * a pricing option's terms were edited over the years and discounted at the
 * till, and the commonest figure is the one the studio means by that name.
 */

/**
 * Live: something left, and not yet expired on the day of the download. The
 * expiry day itself still counts — Mindbody lets a member in on it.
 */
export function isLive(h: HoldingRow, asOf: CalendarDate): boolean {
  const left = h.remaining !== null && (h.remaining.unlimited || h.remaining.count > 0)
  return left && h.lastExpiration !== null && dayNumber(h.lastExpiration) >= dayNumber(asOf)
}

/** The value seen most often; between equals, the smaller, so the answer never depends on report order. */
function commonest(values: number[]): number | null {
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  const ranked = [...counts].sort(([a, n], [b, m]) => m - n || a - b)
  return ranked[0]?.[0] ?? null
}

/** Whole calendar months, near enough: nobody sells a plan of a month and a half. */
const monthsIn = (days: number) => Math.max(1, Math.round(days / 30.44))

type Proposal = NonNullable<StudioConfigInput['catalogue']>[number]

const TRIAL = /\btrial\b/i
const PT = /\bpt\b|personal training/i

export function proposeCatalogue(reports: MindbodyReports, asOf: CalendarDate | null): Proposal[] {
  // Every option still held — and every trial anybody ever held, because a
  // member who has used their trial must arrive having used it.
  const wanted = reports.holdings.filter(
    h =>
      (asOf ? isLive(h, asOf) : h.remaining !== null && (h.remaining.unlimited || h.remaining.count > 0)) ||
      (TRIAL.test(h.option) && !PT.test(`${h.option} ${h.serviceCategory}`)),
  )
  const keys = [...new Set(wanted.map(h => normaliseOptionName(h.option)))].sort()

  return keys.map(key => {
    const holdings = reports.holdings.filter(h => normaliseOptionName(h.option) === key)
    const spellings = [...new Set(holdings.map(h => h.option))].sort()
    const categories = holdings.map(h => h.serviceCategory).join(' ')
    const name = spellings
      .map(s => ({ s, n: holdings.filter(h => h.option === s).length }))
      .sort((a, b) => b.n - a.n || a.s.localeCompare(b.s))[0]!.s

    const unlimited = holdings.filter(h => h.purchased?.unlimited).length * 2 > holdings.length
    const about = `${name} ${categories}`
    const kind =
      unlimited && /\baccess\b/i.test(name)
        ? 'access_pass'
        : unlimited
          ? 'unlimited'
          : PT.test(about)
            ? 'pt'
            : TRIAL.test(name)
              ? 'trial'
              : 'credit_bundle'

    // One purchase at a time, from the register; a holding is several combined.
    const spreads = reports.optionSales
      .filter(s => normaliseOptionName(s.option) === key)
      .map(s => dayNumber(s.expiration) - dayNumber(s.activation))
      .filter(d => d > 0)
    const days = commonest(spreads)
    const prices = reports.sales
      .filter(s => normaliseOptionName(s.description) === key && s.quantity === 1 && s.total > 0)
      .map(s => s.total)
    const credits = commonest(
      holdings.flatMap(h => (h.purchased && !h.purchased.unlimited && h.purchased.count > 0 ? [h.purchased.count] : [])),
    )

    const dated = kind === 'credit_bundle' || kind === 'trial' || kind === 'pt'
    return {
      name,
      mindbodyNames: spellings,
      // Places on a workshop or a retreat, and things that are not classes at
      // all, are not packages. ClassPass visits are, and nobody buys one here.
      migrate: /workshop|retreat|storage/i.test(about) ? 'skip' : /^classpass$/i.test(name) ? 'legacy' : null,
      kind,
      credits: dated ? credits : null,
      validityDays: dated ? days : null,
      durationMonths: kind === 'unlimited' && days !== null ? monthsIn(days) : null,
      priceSgd: commonest(prices) ?? (holdings.every(h => h.totalPaid === 0) ? 0 : null),
      sessionType: kind === 'pt' ? (/sharing|2\s*on\s*1/i.test(name) ? '2on1' : '1on1') : null,
      location: null,
    }
  })
}
