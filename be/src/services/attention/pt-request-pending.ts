import { countPtRequestsForAdmin, listPtRequestsForAdmin, type AdminPtRequestView } from '../pt-sessions/list'
import { formatAge, formatWhen } from './format'
import type { AttentionContext, AttentionProvider, ProviderItem } from './types'

/**
 * A PT request waiting to be scheduled. It is exactly the pending PT queue the
 * caller's own PT page lists (so it resolves when the request is scheduled,
 * cancelled or expires, and an instructor never sees one bound to a colleague):
 *
 *   - Admins: every request in the studio.
 *   - Instructors: with Take PT bookings, the unbound requests and the ones
 *     bound to them, as `listPtRequestsForAdmin(visibleToInstructorId)` has it.
 */
const base = (ctx: AttentionContext) => `/${ctx.role}/pt-requests`

/** Who the filter is for: an instructor's queue is narrowed; an admin's is not. */
const audience = (ctx: AttentionContext) =>
  ctx.role === 'admin' ? {} : { visibleToInstructorId: ctx.staffId }

function toItem(ctx: AttentionContext, r: AdminPtRequestView): ProviderItem {
  const kind = r.sessionType === '2on1' ? '2-on-1' : '1-on-1'
  const classType = r.classType ? `${r.classType.name} ` : ''
  const partnerHasNoAccount = r.sessionType === '2on1' && r.coClient !== null && r.coClient.clientId === null
  const detail =
    ctx.role === 'admin' && partnerHasNoAccount
      ? `Partner ${r.coClient?.name ?? 'their partner'} needs an account before you can schedule this`
      : [`Asked ${formatAge(r.createdAt, ctx.now)}`, r.expiresAt ? `expires ${formatWhen(r.expiresAt, ctx.timezone)}` : null]
          .filter(Boolean)
          .join(' · ')
  return {
    subjectId: r.id,
    location: { id: r.location.id, name: r.location.name },
    occurredAt: r.createdAt,
    deadlineAt: r.expiresAt,
    title: `${r.client.name} asked for a ${kind} ${classType}session`,
    detail,
    href: `${base(ctx)}?request=${r.id}&location=${r.location.id}`,
  }
}

export const ptRequestPending: AttentionProvider = {
  kind: 'pt_request_pending',
  group: 'requests',
  badge: 'pt_requests',
  dismissable: false,
  appliesTo: ctx => ctx.role === 'admin' || ctx.permissions.has('take_pt_bookings'),
  count: (ctx, scope) =>
    countPtRequestsForAdmin(ctx.tenantId, {
      status: 'pending',
      ...(scope.locationId ? { locationIds: [scope.locationId] } : {}),
      ...audience(ctx),
    }),
  list: async (ctx, limit) => {
    const rows = await listPtRequestsForAdmin(ctx.tenantId, {
      status: 'pending',
      oldestFirst: true,
      limit,
      ...audience(ctx),
    })
    return rows.map(r => toItem(ctx, r))
  },
  seeAllHref: base,
}
