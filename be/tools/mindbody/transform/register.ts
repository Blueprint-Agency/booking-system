import type { MemberListRow, OptionSaleRow } from './readers'
import { normaliseStaffName } from './values'

/**
 * Who bought each purchase in the pricing-option register (Pricing Option
 * Expirations), which carries a client's name and phone but no client id.
 *
 * Joined by normalised name, and by phone where a name is held by more than one
 * member. Anything else is **not guessed**: a purchase whose name nobody holds is
 * `unmatched`, and one whose name several members hold with no phone to tell them
 * apart is `ambiguous`. Both history (past purchases) and the live packages
 * (splitting a member's combined holding back into its purchases) read this.
 */

export type RegisterMatch = { clientId: string; outcome: 'matched' } | { clientId: null; outcome: 'unmatched' | 'ambiguous' }

/**
 * A person's name as a key: its words, case-folded and sorted — the same fold
 * staff names use. A full stop goes with the commas, because that is what a
 * Mindbody record with no surname carries.
 */
export const personKey = (raw: string) => normaliseStaffName(raw.replace(/\./g, ' '))

export function registerMatcher(members: MemberListRow[]): (sale: OptionSaleRow) => RegisterMatch {
  const byName = new Map<string, MemberListRow[]>()
  for (const m of members) {
    const key = personKey(`${m.firstName} ${m.lastName}`)
    byName.set(key, [...(byName.get(key) ?? []), m])
  }
  const digits = (s: string) => s.replace(/\D/g, '')
  return sale => {
    const candidates = byName.get(personKey(sale.client)) ?? []
    if (candidates.length === 0) return { clientId: null, outcome: 'unmatched' }
    if (candidates.length === 1) return { clientId: candidates[0]!.id, outcome: 'matched' }
    const phone = digits(sale.phone)
    const narrowed = phone ? candidates.filter(m => digits(m.phone) === phone) : []
    return narrowed.length === 1 ? { clientId: narrowed[0]!.id, outcome: 'matched' } : { clientId: null, outcome: 'ambiguous' }
  }
}
