/**
 * What a package sale entitles the member to, as checkout showed it: the
 * credits or sessions, how long it runs, and its List Price.
 *
 * Frozen onto the checkout's metadata, which the provider session carries and
 * the Purchase keeps for the Balance session a Part Payment opens later. The
 * grant reads them from there: the catalogue row is admin-editable, and a sale
 * in flight keeps the terms it was sold on.
 */
import type { classPackages, ptPackages } from '../../db/schema/packages'
import type { PackageKind } from './validity'

export interface SoldTerms {
  creditsOrSessions: number | null
  validityDays: number | null
  durationMonths: number | null
  listPriceSgd: string
}

export const classPackageTerms = (row: typeof classPackages.$inferSelect): SoldTerms => ({
  creditsOrSessions: row.credits,
  validityDays: row.validityDays,
  durationMonths: row.durationMonths,
  listPriceSgd: row.priceSgd,
})

export const ptPackageTerms = (row: typeof ptPackages.$inferSelect): SoldTerms => ({
  creditsOrSessions: row.numSessions,
  validityDays: row.validityDays,
  durationMonths: null,
  listPriceSgd: row.priceSgd,
})

export const soldTermsMetadata = (terms: SoldTerms): Record<string, string> => ({
  credits_or_sessions: terms.creditsOrSessions?.toString() ?? '',
  validity_days: terms.validityDays?.toString() ?? '',
  duration_months: terms.durationMonths?.toString() ?? '',
  list_price_sgd: terms.listPriceSgd,
})

/**
 * What the grant is reading is wrong: the Purchase's stored terms are present
 * but incomplete or malformed. Not an `AppError`, so a delivery that meets it
 * answers 500 and the provider redelivers, once a human has repaired the
 * record. The grant never guesses at what the member was sold.
 */
export class CorruptSoldTermsError extends Error {
  constructor(
    /** The metadata key at fault. */
    readonly key: string,
    /** What it held; undefined when it is the missing one. */
    readonly value: string | undefined,
    readonly reason: string,
  ) {
    super(`frozen terms are corrupt: ${key}=${value === undefined ? '(missing)' : JSON.stringify(value)}, ${reason}`)
    this.name = 'CorruptSoldTermsError'
  }
}

/**
 * The one rule for what a Purchase's stored copy of checkout's metadata means:
 * a key with no value and a key that is absent are the same thing, because the
 * provider drops empty metadata values. **Absent means an old sale, from before
 * checkout recorded it; present but wrong means corrupt.**
 */
const valueOf = (meta: Record<string, string>, key: string): string | undefined => meta[key] || undefined

/** The column holding a count is an `integer`. */
const MAX_COUNT = 2_147_483_647

function countOf(meta: Record<string, string>, key: string): number | null {
  const value = valueOf(meta, key)
  if (value === undefined) return null
  const count = /^\d+$/.test(value) ? Number(value) : Number.NaN
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_COUNT) {
    throw new CorruptSoldTermsError(key, value, 'a count is a whole number of at least 1')
  }
  return count
}

/**
 * A List Price: dollars, not negative, to at most the cent, and within the
 * `numeric(10,2)` column that keeps it (eight digits before the point). Null
 * when the copy holds none.
 */
export function soldListPriceFromMetadata(meta: Record<string, string>): string | null {
  const value = valueOf(meta, 'list_price_sgd')
  if (value === undefined) return null
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(value)) {
    throw new CorruptSoldTermsError('list_price_sgd', value, 'a List Price is an amount of dollars, to at most the cent')
  }
  return value
}

/**
 * The terms a checkout froze, or null for a sale from before it froze them
 * (none of its credits or sessions, validity or Duration carries a value),
 * which the grant answers from the catalogue row as it stands. Every count must
 * be a whole number of at least 1, and a List Price must go with them.
 * Whether the set is complete for the package's kind is `soldTermsForKind`.
 */
export function soldTermsFromMetadata(meta: Record<string, string>): SoldTerms | null {
  const creditsOrSessions = countOf(meta, 'credits_or_sessions')
  const validityDays = countOf(meta, 'validity_days')
  const durationMonths = countOf(meta, 'duration_months')
  if (creditsOrSessions === null && validityDays === null && durationMonths === null) return null
  const listPriceSgd = soldListPriceFromMetadata(meta)
  if (listPriceSgd === null) throw new CorruptSoldTermsError('list_price_sgd', undefined, 'terms were frozen without a List Price')
  return { creditsOrSessions, validityDays, durationMonths, listPriceSgd }
}

/**
 * The fields each kind is sold on, the same the catalogue requires before an
 * Admin can save one. The catalogue's upper bounds are not re-applied: they may
 * change after a sale, and all this asks is that the grant is usable.
 */
type CountField = 'creditsOrSessions' | 'validityDays' | 'durationMonths'

const FIELDS_OF_KIND: Record<PackageKind, { needs: CountField[]; never: CountField[] }> = {
  credit_bundle: { needs: ['creditsOrSessions', 'validityDays'], never: ['durationMonths'] },
  trial: { needs: ['creditsOrSessions', 'validityDays'], never: ['durationMonths'] },
  pt: { needs: ['creditsOrSessions', 'validityDays'], never: ['durationMonths'] },
  unlimited: { needs: ['durationMonths'], never: ['creditsOrSessions', 'validityDays'] },
}

const KEY_OF_FIELD: Record<CountField, string> = {
  creditsOrSessions: 'credits_or_sessions',
  validityDays: 'validity_days',
  durationMonths: 'duration_months',
}

/**
 * The terms a checkout froze for a package of `kind` (read from the catalogue
 * row, which never changes it): null for an old sale, else the terms, complete
 * and well-formed for that kind. Anything else throws `CorruptSoldTermsError`.
 */
export function soldTermsForKind(meta: Record<string, string>, kind: PackageKind): SoldTerms | null {
  const terms = soldTermsFromMetadata(meta)
  if (!terms) return null
  const { needs, never } = FIELDS_OF_KIND[kind]
  for (const field of needs) {
    if (terms[field] === null) {
      throw new CorruptSoldTermsError(KEY_OF_FIELD[field], undefined, `a ${kind} is sold on its ${field}`)
    }
  }
  for (const field of never) {
    if (terms[field] !== null) {
      throw new CorruptSoldTermsError(KEY_OF_FIELD[field], String(terms[field]), `a ${kind} is not sold on a ${field}`)
    }
  }
  return terms
}
