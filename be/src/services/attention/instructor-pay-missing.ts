import { sgDayWindow, sgToday } from '../../lib/time'
import { getFinance } from '../finance/list'
import type { AttentionContext, AttentionProvider, ProviderItem } from './types'

/**
 * Completed sessions with no instructor pay, as ONE line for admins: the count
 * is in the sentence, and the line counts as one in the bubble. It is Finance's
 * own Needs-pay answer (`getFinance`'s `unpriced_count`, which uses the one
 * `isUnpriced` rule), over the window from the first day of the previous month
 * to today, so the line and the Finance page agree for the same range.
 *
 * The line carries the same range in the link, so Finance opens on it. It is
 * studio-wide: no location narrows it.
 */
const FINANCE_PAGE = '/admin/finance'

/** The first day of the previous month, and today, as plain dates. */
export function payWindow(now: Date): { from: string; to: string } {
  const to = sgToday(now)
  const [year, month] = to.split('-').map(Number) as [number, number]
  const from = month === 1 ? `${year - 1}-12-01` : `${year}-${String(month - 1).padStart(2, '0')}-01`
  return { from, to }
}

async function unpricedCount(ctx: AttentionContext): Promise<number> {
  const { from, to } = payWindow(ctx.now)
  const { unpriced_count } = await getFinance(ctx.tenantId, {
    needsPayOnly: true,
    from: sgDayWindow(from).startsAt,
    to: new Date(sgDayWindow(to).endsAt.getTime() - 1),
  })
  return unpriced_count
}

export const instructorPayMissing: AttentionProvider = {
  kind: 'instructor_pay_missing',
  group: 'payments_refunds',
  dismissable: false,
  appliesTo: ctx => ctx.role === 'admin',
  // One line, so one: the session count is the line's wording, not the bubble's.
  count: async ctx => ((await unpricedCount(ctx)) > 0 ? 1 : 0),
  list: async ctx => {
    const n = await unpricedCount(ctx)
    if (n === 0) return []
    const { from, to } = payWindow(ctx.now)
    const item: ProviderItem = {
      subjectId: 'window',
      location: null,
      occurredAt: ctx.now,
      title: `${n} completed ${n === 1 ? 'session has' : 'sessions have'} no instructor pay`,
      detail: 'Set their pay in Finance',
      href: `${FINANCE_PAGE}?needs_pay=1&from=${from}&to=${to}`,
    }
    return [item]
  },
  seeAllHref: () => `${FINANCE_PAGE}?needs_pay=1`,
  seeAllLabel: 'Finance',
}
