import { and, asc, count, eq, isNull, lte, ne, or, type SQL } from 'drizzle-orm'
import { db } from '../../db'
import { clients } from '../../db/schema/identity'
import { purchases } from '../../db/schema/ledger'
import { corporatePackages } from '../../db/schema/packages'
import { corporateRequests, corporateSessions } from '../../db/schema/schedule'
import { formatAge, formatWhen } from './format'
import type { AttentionContext, AttentionProvider, ProviderItem } from './types'

/**
 * The three ways a corporate request needs an Admin. Corporate requests belong
 * to no location until they are scheduled, so none of these is location-bound,
 * and all three are Admin-only. They are mutually exclusive on a scheduled
 * request (whose session is still booked): a refunded purchase is the refund
 * item, whatever the time; otherwise an ended session is the unmarked item.
 */
const PAGE = '/admin/corporate-requests'
const href = (id: string) => `${PAGE}?request=${id}`

const refunded = eq(purchases.status, 'refunded')

/** A scheduled request whose session is still booked, with the purchase that paid for it. */
function bookedRequests(extra: SQL | undefined, tenantId: string) {
  return and(
    eq(corporateRequests.tenantId, tenantId),
    eq(corporateRequests.status, 'scheduled'),
    eq(corporateSessions.lifecycle, 'active'),
    extra,
  )
}

const withPurchase = () =>
  db
    .select({ n: count() })
    .from(corporateRequests)
    .innerJoin(corporateSessions, eq(corporateSessions.id, corporateRequests.scheduledCorporateSessionId))
    .leftJoin(purchases, eq(purchases.id, corporateRequests.purchaseId))

const rows = () =>
  db
    .select({
      id: corporateRequests.id,
      createdAt: corporateRequests.createdAt,
      resolvedAt: corporateRequests.resolvedAt,
      member: clients.name,
      pkg: corporatePackages.name,
      startsAt: corporateSessions.startsAt,
      endsAt: corporateSessions.endsAt,
    })
    .from(corporateRequests)
    .innerJoin(clients, eq(clients.id, corporateRequests.clientId))
    .innerJoin(corporatePackages, eq(corporatePackages.id, corporateRequests.corporatePackageId))
    .innerJoin(corporateSessions, eq(corporateSessions.id, corporateRequests.scheduledCorporateSessionId))
    .leftJoin(purchases, eq(purchases.id, corporateRequests.purchaseId))

/** "Tue 28 Oct" in the studio's zone: formatWhen without its time. */
const dayOf = (at: Date, ctx: AttentionContext) => formatWhen(at, ctx.timezone).split(',')[0]!

const adminOnly = (ctx: AttentionContext) => ctx.role === 'admin'

export const corporateRequestPending: AttentionProvider = {
  kind: 'corporate_request_pending',
  group: 'requests',
  badge: 'corporate_requests',
  dismissable: false,
  appliesTo: adminOnly,
  count: async ctx => {
    const [r] = await db
      .select({ n: count() })
      .from(corporateRequests)
      .where(and(eq(corporateRequests.tenantId, ctx.tenantId), eq(corporateRequests.status, 'pending')))
    return r?.n ?? 0
  },
  list: async (ctx, limit) => {
    const pending = await db
      .select({ id: corporateRequests.id, createdAt: corporateRequests.createdAt, member: clients.name, pkg: corporatePackages.name })
      .from(corporateRequests)
      .innerJoin(clients, eq(clients.id, corporateRequests.clientId))
      .innerJoin(corporatePackages, eq(corporatePackages.id, corporateRequests.corporatePackageId))
      .where(and(eq(corporateRequests.tenantId, ctx.tenantId), eq(corporateRequests.status, 'pending')))
      .orderBy(asc(corporateRequests.createdAt))
      .limit(limit)
    return pending.map(
      (r): ProviderItem => ({
        subjectId: r.id,
        location: null,
        occurredAt: r.createdAt,
        title: `${r.member} bought ${r.pkg}: schedule the session`,
        detail: `Bought ${formatAge(r.createdAt, ctx.now)}`,
        href: href(r.id),
      }),
    )
  },
  seeAllHref: () => PAGE,
  seeAllLabel: 'Corporate requests',
}

/** A scheduled request whose session is over and still not marked attended. */
const unmarkedFilter = (ctx: AttentionContext) =>
  bookedRequests(
    and(lte(corporateSessions.endsAt, ctx.now), or(isNull(purchases.id), ne(purchases.status, 'refunded'))),
    ctx.tenantId,
  )

export const corporateSessionUnmarked: AttentionProvider = {
  kind: 'corporate_session_unmarked',
  group: 'requests',
  badge: 'corporate_requests',
  dismissable: false,
  appliesTo: adminOnly,
  count: async ctx => (await withPurchase().where(unmarkedFilter(ctx)))[0]?.n ?? 0,
  list: async (ctx, limit) =>
    (await rows().where(unmarkedFilter(ctx)).orderBy(asc(corporateSessions.endsAt)).limit(limit)).map(
      (r): ProviderItem => ({
        subjectId: r.id,
        location: null,
        occurredAt: r.endsAt,
        title: `Mark ${r.pkg} for ${r.member} as attended`,
        detail: `The session was on ${formatWhen(r.startsAt, ctx.timezone)}`,
        href: href(r.id),
      }),
    ),
  seeAllHref: () => PAGE,
  seeAllLabel: 'Corporate requests',
}

/** A scheduled request whose purchase was refunded while its session is still booked. */
const refundedFilter = (ctx: AttentionContext) => bookedRequests(refunded, ctx.tenantId)

export const corporateRefundedStillScheduled: AttentionProvider = {
  kind: 'corporate_refunded_still_scheduled',
  group: 'requests',
  badge: 'corporate_requests',
  dismissable: false,
  appliesTo: adminOnly,
  count: async ctx => (await withPurchase().where(refundedFilter(ctx)))[0]?.n ?? 0,
  list: async (ctx, limit) =>
    (await rows().where(refundedFilter(ctx)).orderBy(asc(corporateSessions.startsAt)).limit(limit)).map(
      (r): ProviderItem => ({
        subjectId: r.id,
        location: null,
        occurredAt: r.resolvedAt ?? r.createdAt,
        title: `${r.member}’s ${r.pkg} was refunded, but its session on ${dayOf(r.startsAt, ctx)} is still booked`,
        detail: 'Cancel the session',
        href: href(r.id),
      }),
    ),
  seeAllHref: () => PAGE,
  seeAllLabel: 'Corporate requests',
}
