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
 * The terms a checkout froze, or null for a session from before it froze them,
 * which the grant answers from the catalogue row as it stands.
 */
export function soldTermsFromMetadata(meta: Record<string, string>): SoldTerms | null {
  const listPriceSgd = meta.list_price_sgd
  const runsForALength = Boolean(meta.validity_days || meta.duration_months)
  if (!listPriceSgd || !runsForALength) return null
  const count = (value: string | undefined) => (value ? Number(value) : null)
  return {
    creditsOrSessions: count(meta.credits_or_sessions),
    validityDays: count(meta.validity_days),
    durationMonths: count(meta.duration_months),
    listPriceSgd,
  }
}
