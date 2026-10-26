import { and, count, eq, inArray } from 'drizzle-orm'
import { db } from '../../db'
import { bookings, classes, locations } from '../../db/schema'
import { overbookedClassPassBookings } from '../classpass/settings'
import { formatWhen } from './format'
import type { AttentionProvider, ProviderItem } from './types'

/**
 * An upcoming class that ClassPass booked over capacity: one item per class,
 * from the same query the ClassPass page lists (`overbookedClassPassBookings`:
 * confirmed ClassPass bookings in an overbook seat on an active class that has
 * not ended). It goes when the class ends or those bookings are cancelled.
 * Admins only.
 */
export const classpassOverbooked: AttentionProvider = {
  kind: 'classpass_overbooked',
  group: 'classpass',
  badge: 'classpass',
  dismissable: false,
  appliesTo: ctx => ctx.role === 'admin',
  count: async ctx => new Set((await overbookedClassPassBookings(ctx.tenantId)).map(b => b.classId)).size,
  list: async (ctx, limit) => {
    const perClass = new Map<string, { className: string; startsAt: Date; over: number }>()
    for (const b of await overbookedClassPassBookings(ctx.tenantId)) {
      const seen = perClass.get(b.classId)
      if (seen) seen.over += 1
      else perClass.set(b.classId, { className: b.className, startsAt: b.startsAt, over: 1 })
    }
    const ids = [...perClass.keys()].slice(0, limit)
    if (ids.length === 0) return []

    const [where, attending] = await Promise.all([
      db
        .select({ id: classes.id, locationId: locations.id, locationName: locations.name })
        .from(classes)
        .innerJoin(locations, eq(locations.id, classes.locationId))
        .where(and(eq(classes.tenantId, ctx.tenantId), inArray(classes.id, ids))),
      db
        .select({ classId: bookings.classId, n: count() })
        .from(bookings)
        .where(and(eq(bookings.tenantId, ctx.tenantId), inArray(bookings.classId, ids), eq(bookings.state, 'confirmed')))
        .groupBy(bookings.classId),
    ])
    const locationOf = new Map(where.map(w => [w.id, w]))
    const total = new Map(attending.map(a => [a.classId, Number(a.n)]))

    return ids.map((id): ProviderItem => {
      const c = perClass.get(id)!
      const at = locationOf.get(id)
      const people = total.get(id) ?? c.over
      return {
        subjectId: id,
        location: at ? { id: at.locationId, name: at.locationName } : null,
        occurredAt: c.startsAt,
        deadlineAt: c.startsAt,
        title: `${c.className} on ${formatWhen(c.startsAt, ctx.timezone)} is over capacity: ClassPass booked ${c.over} more ${c.over === 1 ? 'person' : 'people'} than it has seats`,
        detail: `Expect ${people} ${people === 1 ? 'person' : 'people'}`,
        href: `/admin/schedule/class/${id}${at ? `?location=${at.locationId}` : ''}`,
      }
    })
  },
  seeAllHref: () => '/admin/classpass',
}
