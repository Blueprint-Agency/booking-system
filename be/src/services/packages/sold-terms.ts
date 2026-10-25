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

export interface SoldTerms {
  /** Credits on a Credit Bundle or Trial Pass, sessions on a PT package, null on an Unlimited Plan. */
  creditsOrSessions: number | null
  /** Null on an Unlimited Plan, which runs for `durationMonths` instead. */
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
 * The terms a checkout froze, or null for a session from before it froze them,
 * which the grant answers from the catalogue row as it stands.
 *
 * Every package runs for a validity or a Duration, so a session carrying
 * neither never had its terms frozen. Read by value rather than by key: the
 * provider drops a metadata key whose value is empty.
 */
export function soldTermsFromMetadata(meta: Record<string, string>): SoldTerms | null {
  const listPriceSgd = meta.list_price_sgd
  if (!listPriceSgd || (!meta.validity_days && !meta.duration_months)) return null
  const count = (value: string | undefined) => (value ? Number(value) : null)
  return {
    creditsOrSessions: count(meta.credits_or_sessions),
    validityDays: count(meta.validity_days),
    durationMonths: count(meta.duration_months),
    listPriceSgd,
  }
}
