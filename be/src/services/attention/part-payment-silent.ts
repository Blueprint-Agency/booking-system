import { and, eq } from 'drizzle-orm'
import { purchases } from '../../db/schema/ledger'
import {
  countSilentPartPaidPurchases,
  listSilentPartPaidPurchases,
  type SilentPurchaseView,
} from '../billing/open-purchases'
import { notDismissed } from './dismissed-subjects'
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

/** Not dismissed, as SQL: the count and the list leave the same ones out. */
const undismissed = (ctx: AttentionContext) => notDismissed(ctx.tenantId, 'part_payment_silent', purchases.id)

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
  isOpen: async (ctx, subjectId) =>
    (await countSilentPartPaidPurchases(ctx.tenantId, ctx.now, and(undismissed(ctx), eq(purchases.id, subjectId)))) > 0,
  count: ctx => countSilentPartPaidPurchases(ctx.tenantId, ctx.now, undismissed(ctx)),
  list: async (ctx, limit) =>
    (await listSilentPartPaidPurchases(ctx.tenantId, ctx.now, undismissed(ctx))).slice(0, limit).map(p => itemFor(ctx, p)),
  seeAllHref: () => PAGE,
  seeAllLabel: 'Partial payments',
}
