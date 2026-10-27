import { and, asc, count, eq, gt, lte, sql, type SQL } from 'drizzle-orm'
import { db } from '../../db'
import { bookings, waitlistEntries } from '../../db/schema/bookings'
import { classTypes } from '../../db/schema/catalog'
import { classes } from '../../db/schema/schedule'
import { classCancelWindow } from '../policy/cancel-window'
import { waitlistClosesAt } from '../waitlist/rules'
import { formatWhen, withLocation } from './format'
import type { AttentionContext, AttentionProvider, CountScope, ProviderItem } from './types'

/**
 * An upcoming class that has a free online seat and people waiting, inside the
 * window where the waitlist no longer promotes (`waitlistClosesAt`, the class
 * Cancellation Window), so someone has to add a person by hand. It goes when the
 * online seats fill, the line empties, or the class starts.
 *
 *   - Admins: every such class in the studio.
 *   - Instructors: the classes they are main instructor of, never a colleague's.
 *
 * The seat and line counts are the ones the waitlist itself keeps: confirmed
 * bookings in an `online` seat (`countSeats`), and `waiting` entries on a class
 * that has not started (`waitingLine`).
 */
const classPage = (ctx: AttentionContext, classId: string) => `/${ctx.role}/schedule/class/${classId}`

const onlineUsed = sql<number>`(select count(*)::int from ${bookings} where ${bookings.tenantId} = ${classes.tenantId} and ${bookings.classId} = ${classes.id} and ${bookings.state} = 'confirmed' and ${bookings.seat} = 'online')`
const waiting = sql<number>`(select count(*)::int from ${waitlistEntries} where ${waitlistEntries.tenantId} = ${classes.tenantId} and ${waitlistEntries.classId} = ${classes.id} and ${waitlistEntries.status} = 'waiting')`

async function filter(ctx: AttentionContext, scope: CountScope): Promise<SQL | undefined> {
  const windowHours = await classCancelWindow(ctx.tenantId)
  // startsAt - window <= now, i.e. the waitlist has closed: `waitlistClosesAt(startsAt, window) <= now`.
  const latestStart = waitlistClosesAt(ctx.now, -windowHours)
  return and(
    eq(classes.tenantId, ctx.tenantId),
    eq(classes.lifecycle, 'active'),
    gt(classes.startsAt, ctx.now),
    lte(classes.startsAt, latestStart),
    sql`${classes.capacityOnline} > ${onlineUsed}`,
    sql`${waiting} > 0`,
    ctx.role === 'admin' ? undefined : eq(classes.mainInstructorId, ctx.staffId),
    scope.locationId ? eq(classes.locationId, scope.locationId) : undefined,
  )
}

const seats = (n: number) => `${n} free ${n === 1 ? 'seat' : 'seats'}`
const line = (n: number) => `${n} ${n === 1 ? 'person' : 'people'} waiting`

export const waitlistSeatFree: AttentionProvider = {
  kind: 'waitlist_seat_free',
  group: 'classes_sessions',
  dismissable: false,
  appliesTo: ctx => ctx.role === 'admin' || ctx.role === 'instructor',
  count: async (ctx, scope) => {
    const [row] = await db.select({ n: count() }).from(classes).where(await filter(ctx, scope))
    return row?.n ?? 0
  },
  list: async (ctx, limit) => {
    const [windowHours, rows] = await Promise.all([
      classCancelWindow(ctx.tenantId),
      filter(ctx, {}).then(where =>
        db
          .select({
            id: classes.id,
            locationId: classes.locationId,
            startsAt: classes.startsAt,
            capacityOnline: classes.capacityOnline,
            label: classTypes.name,
            used: onlineUsed,
            waiting,
          })
          .from(classes)
          .innerJoin(classTypes, eq(classTypes.id, classes.classTypeId))
          .where(where)
          .orderBy(asc(classes.startsAt))
          .limit(limit),
      ),
    ])
    return rows.map(
      (r): ProviderItem => ({
        subjectId: r.id,
        location: ctx.locations.find(l => l.id === r.locationId) ?? null,
        occurredAt: waitlistClosesAt(r.startsAt, windowHours),
        deadlineAt: r.startsAt,
        title: `${r.label} on ${formatWhen(r.startsAt, ctx.timezone)} has ${seats(r.capacityOnline - Number(r.used))} and ${line(Number(r.waiting))}`,
        detail: "The waitlist doesn't fill seats this close to class. Add someone from the waitlist",
        href: withLocation(classPage(ctx, r.id), r.locationId),
      }),
    )
  },
  seeAllHref: () => null,
}
