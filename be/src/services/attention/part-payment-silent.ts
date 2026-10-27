import { listSilentPartPaidPurchases, type SilentPurchaseView } from '../billing/open-purchases'
import { dismissedSubjects } from './dismissed-subjects'
import { formatWhen } from './format'
import type { AttentionContext, AttentionProvider, ProviderItem } from './types'

/**
 * A member who paid part of a purchase and has made no payment in 14 days.
 * It is exactly Partial payments' silent list (`listSilentPartPaidPurchases`,
 * with its one `isSilent` threshold), less what an admin has dismissed to keep
 * waiting. It goes when the purchase is refunded, paid in full or dismissed.
 * Admins only; money is the studio's, not a location's.
 */
const PAGE = '/admin/purchases'

async function open(ctx: AttentionContext): Promise<SilentPurchaseView[]> {
  const [silent, dismissed] = await Promise.all([
    listSilentPartPaidPurchases(ctx.tenantId, ctx.now),
    dismissedSubjects(ctx.tenantId, 'part_payment_silent'),
  ])
  return silent.filter(p => !dismissed.has(p.id))
}

function itemFor(ctx: AttentionContext, p: SilentPurchaseView): ProviderItem {
  return {
    subjectId: p.id,
    location: null,
    occurredAt: p.lastPaymentAt,
    title: `${p.clientName} has paid S$${p.paidSgd} of S$${p.totalSgd} for ${p.itemName} and stopped paying`,
    detail: `Last payment ${formatWhen(p.lastPaymentAt, ctx.timezone)}. Refund it, or dismiss to keep waiting`,
    href: `${PAGE}?purchase=${p.id}`,
  }
}

export const partPaymentSilent: AttentionProvider = {
  kind: 'part_payment_silent',
  group: 'payments_refunds',
  dismissable: true,
  appliesTo: ctx => ctx.role === 'admin',
  isOpen: async (ctx, subjectId) => (await open(ctx)).some(p => p.id === subjectId),
  count: async ctx => (await open(ctx)).length,
  list: async (ctx, limit) => (await open(ctx)).slice(0, limit).map(p => itemFor(ctx, p)),
  seeAllHref: () => PAGE,
  seeAllLabel: 'Partial payments',
}
