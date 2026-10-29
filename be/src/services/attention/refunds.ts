import { and, eq } from 'drizzle-orm'
import { bookings } from '../../db/schema/bookings'
import {
  countRefundsNeedingAdmin,
  countUnrefundedWorkshopPlaces,
  listUnrefundedWorkshopPlaces,
  refundsNeedingAdmin,
  type RefundNeedingAdmin,
  type UnrefundedWorkshopPlace,
} from '../billing/refunds'
import { notDismissed } from './dismissed-subjects'
import { formatWhen } from './format'
import type { AttentionContext, AttentionProvider, ProviderItem } from './types'

/**
 * The three refunds that need an admin, all in Payments & refunds and
 * all Admin-only, because money is the studio's rather than a location's.
 *
 * `refund_incomplete` and `refund_unconfirmed` are exactly the Refund screens'
 * own rules (`refundProgress`, `REFUND_IN_FLIGHT_MS`), read across the studio
 * by `refundsNeedingAdmin`; they go when every payment is back or the Refund is
 * pressed again. `workshop_cancelled_unrefunded` is a paid place in a cancelled
 * Workshop that nobody refunded (cancelling refunds nobody); it goes when
 * refunded, or dismissed to keep the payment.
 *
 * The subject of the first two is the Purchase; of the last, the booking. All
 * three link to the member's page opened on that Purchase.
 */
const isAdmin = (ctx: AttentionContext) => ctx.role === 'admin'
const href = (clientId: string, purchaseId: string) => `/admin/customers/${clientId}?purchase=${purchaseId}`

const returned = (r: RefundNeedingAdmin) => `${r.returnedCount} of ${r.paymentCount} payments returned`

const incompleteItem = (r: RefundNeedingAdmin): ProviderItem => ({
  subjectId: r.purchaseId,
  location: null,
  occurredAt: r.lastAskedAt,
  title: `The refund of ${r.clientName}'s ${r.itemName} stopped part-way: ${returned(r)}`,
  detail: 'Press Refund again to return the rest',
  href: href(r.clientId, r.purchaseId),
})

const unconfirmedItem = (r: RefundNeedingAdmin): ProviderItem => ({
  subjectId: r.purchaseId,
  location: null,
  occurredAt: r.stale!.since,
  title: `Stripe hasn't confirmed ${r.clientName}'s S$${r.stale!.amountSgd} refund after a day`,
  detail: "Check it in Stripe; refund again if it didn't go through",
  href: href(r.clientId, r.purchaseId),
})

export const refundIncomplete: AttentionProvider = {
  kind: 'refund_incomplete',
  group: 'payments_refunds',
  dismissable: false,
  appliesTo: isAdmin,
  count: ctx => countRefundsNeedingAdmin(ctx.tenantId, ctx.now, 'incomplete'),
  list: async (ctx, limit) =>
    (await refundsNeedingAdmin(ctx.tenantId, ctx.now))
      .filter(r => r.incomplete)
      .slice(0, limit)
      .map(incompleteItem),
  seeAllHref: () => null,
}

export const refundUnconfirmed: AttentionProvider = {
  kind: 'refund_unconfirmed',
  group: 'payments_refunds',
  dismissable: false,
  appliesTo: isAdmin,
  count: ctx => countRefundsNeedingAdmin(ctx.tenantId, ctx.now, 'stale'),
  list: async (ctx, limit) =>
    (await refundsNeedingAdmin(ctx.tenantId, ctx.now))
      .filter(r => r.stale)
      .slice(0, limit)
      .map(unconfirmedItem),
  seeAllHref: () => null,
}

/** Not dismissed, as SQL: the count and the list leave the same ones out. */
const undismissed = (ctx: AttentionContext) => notDismissed(ctx.tenantId, 'workshop_cancelled_unrefunded', bookings.id)

const openPlaces = (ctx: AttentionContext): Promise<UnrefundedWorkshopPlace[]> =>
  listUnrefundedWorkshopPlaces(ctx.tenantId, undismissed(ctx))

export const workshopCancelledUnrefunded: AttentionProvider = {
  kind: 'workshop_cancelled_unrefunded',
  group: 'payments_refunds',
  dismissable: true,
  appliesTo: isAdmin,
  isOpen: async (ctx, subjectId) =>
    (await countUnrefundedWorkshopPlaces(ctx.tenantId, and(undismissed(ctx), eq(bookings.id, subjectId)))) > 0,
  count: ctx => countUnrefundedWorkshopPlaces(ctx.tenantId, undismissed(ctx)),
  list: async (ctx, limit) =>
    (await openPlaces(ctx))
      .sort((a, b) => a.cancelledAt.getTime() - b.cancelledAt.getTime())
      .slice(0, limit)
      .map(p => ({
        subjectId: p.bookingId,
        location: null,
        occurredAt: p.cancelledAt,
        title: `${p.clientName} paid S$${p.amountSgd} for ${p.workshopName}, which was cancelled, and hasn't been refunded`,
        detail: 'Refund it from their page, or dismiss to keep the payment',
        href: href(p.clientId, p.purchaseId),
      })),
  seeAllHref: () => null,
}
