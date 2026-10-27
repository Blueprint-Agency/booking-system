import { and, asc, count, eq, gt, gte, inArray, isNull, lte, notInArray, sql, type SQL } from 'drizzle-orm'
import { db } from '../../db'
import { bookings } from '../../db/schema/bookings'
import { classTypes } from '../../db/schema/catalog'
import { classes, classSeries } from '../../db/schema/schedule'
import { addDays } from '../schedule/series-dates'
import { localDate } from '../tenants/term-dates'
import { dismissedSubjects } from './dismissed-subjects'
import { formatPlainDay, formatWhen, withLocation } from './format'
import type { AttentionContext, AttentionProvider, CountScope, ProviderItem } from './types'

/**
 * The two follow-ups a Class Series leaves for an admin.
 *
 * `series_ending`: a series that has not been ended runs out of classes within
 * `ENDING_DAYS` days, counted on the studio's calendar. Extending it moves
 * `last_date` out of range, ending it sets `ended_from`, and once `last_date`
 * has passed there is nothing left to extend, so each takes the item away.
 *
 * `series_ended_class_kept`: `endSeries` cancels the classes it ends that nobody
 * booked and leaves the booked ones running for the admin to decide. Such a class
 * (active, on or after its series' `ended_from`, not yet started, with confirmed
 * bookings) is the item. It goes when the class is cancelled, starts, or an
 * admin dismisses it to keep it.
 */
const ENDING_DAYS = 14

const classPage = (classId: string) => `/admin/schedule/class/${classId}`

const WEEKDAYS = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays']

/** "7:00 pm" from a `HH:MM[:SS]` wall-clock time. */
function formatTime(time: string): string {
  const [h = '0', m = '00'] = time.split(':')
  const hour = Number(h)
  return `${hour % 12 || 12}:${m} ${hour < 12 ? 'am' : 'pm'}`
}

// ---------------------------------------------------------------------------
// series_ending
// ---------------------------------------------------------------------------

function endingFilter(ctx: AttentionContext, scope: CountScope): SQL | undefined {
  const today = localDate(ctx.timezone, ctx.now)
  return and(
    eq(classSeries.tenantId, ctx.tenantId),
    isNull(classSeries.endedFrom),
    gte(classSeries.lastDate, today),
    lte(classSeries.lastDate, addDays(today, ENDING_DAYS)),
    scope.locationId ? eq(classSeries.locationId, scope.locationId) : undefined,
  )
}

export const seriesEnding: AttentionProvider = {
  kind: 'series_ending',
  group: 'classes_sessions',
  dismissable: false,
  appliesTo: ctx => ctx.role === 'admin',
  count: async (ctx, scope) => {
    const [row] = await db.select({ n: count() }).from(classSeries).where(endingFilter(ctx, scope))
    return row?.n ?? 0
  },
  list: async (ctx, limit) => {
    const rows = await db
      .select({
        id: classSeries.id,
        locationId: classSeries.locationId,
        weekday: classSeries.weekday,
        startTime: classSeries.startTime,
        lastDate: classSeries.lastDate,
        label: classTypes.name,
        lastClassId: sql<string | null>`(select c.id from ${classes} c where c.tenant_id = ${classSeries.tenantId} and c.series_id = ${classSeries.id} order by (c.lifecycle = 'active') desc, c.starts_at desc limit 1)`,
      })
      .from(classSeries)
      .innerJoin(classTypes, eq(classTypes.id, classSeries.classTypeId))
      .where(endingFilter(ctx, {}))
      .orderBy(asc(classSeries.lastDate), asc(classSeries.id))
      .limit(limit)
    return rows.map(
      (r): ProviderItem => ({
        subjectId: r.id,
        location: ctx.locations.find(l => l.id === r.locationId) ?? null,
        occurredAt: new Date(`${addDays(r.lastDate, -ENDING_DAYS)}T00:00:00Z`),
        deadlineAt: new Date(`${r.lastDate}T00:00:00Z`),
        title: `The ${r.label} series on ${WEEKDAYS[r.weekday - 1]} at ${formatTime(r.startTime)} runs out after ${formatPlainDay(r.lastDate)}`,
        detail: 'Extend it to keep classes on the timetable',
        href: r.lastClassId ? withLocation(classPage(r.lastClassId), r.locationId) : null,
      }),
    )
  },
  seeAllHref: () => null,
}

// ---------------------------------------------------------------------------
// series_ended_class_kept
// ---------------------------------------------------------------------------

const confirmed = sql<number>`(select count(*)::int from ${bookings} where ${bookings.tenantId} = ${classes.tenantId} and ${bookings.classId} = ${classes.id} and ${bookings.state} = 'confirmed')`

async function keptFilter(ctx: AttentionContext, scope: CountScope, only?: string[]): Promise<SQL | undefined> {
  const dismissed = [...(await dismissedSubjects(ctx.tenantId, 'series_ended_class_kept'))]
  return and(
    eq(classes.tenantId, ctx.tenantId),
    eq(classes.lifecycle, 'active'),
    gt(classes.startsAt, ctx.now),
    sql`(${classes.startsAt} at time zone ${ctx.timezone})::date >= ${classSeries.endedFrom}`,
    sql`${confirmed} > 0`,
    dismissed.length > 0 ? notInArray(classes.id, dismissed) : undefined,
    only ? inArray(classes.id, only) : undefined,
    scope.locationId ? eq(classes.locationId, scope.locationId) : undefined,
  )
}

const kept = (ctx: AttentionContext, where: SQL | undefined) =>
  db
    .select({
      id: classes.id,
      locationId: classes.locationId,
      startsAt: classes.startsAt,
      label: classTypes.name,
      endedFrom: classSeries.endedFrom,
      bookings: confirmed,
    })
    .from(classes)
    .innerJoin(classSeries, and(eq(classSeries.tenantId, classes.tenantId), eq(classSeries.id, classes.seriesId)))
    .innerJoin(classTypes, eq(classTypes.id, classes.classTypeId))
    .where(where)

export const seriesEndedClassKept: AttentionProvider = {
  kind: 'series_ended_class_kept',
  group: 'classes_sessions',
  dismissable: true,
  appliesTo: ctx => ctx.role === 'admin',
  isOpen: async (ctx, subjectId) => (await kept(ctx, await keptFilter(ctx, {}, [subjectId]))).length > 0,
  // A SQL count over the same filter and joins the list reads.
  count: async (ctx, scope) => {
    const [row] = await db
      .select({ n: count() })
      .from(classes)
      .innerJoin(classSeries, and(eq(classSeries.tenantId, classes.tenantId), eq(classSeries.id, classes.seriesId)))
      .where(await keptFilter(ctx, scope))
    return Number(row?.n ?? 0)
  },
  list: async (ctx, limit) => {
    const rows = await kept(ctx, await keptFilter(ctx, {})).orderBy(asc(classes.startsAt)).limit(limit)
    return rows.map(
      (r): ProviderItem => ({
        subjectId: r.id,
        location: ctx.locations.find(l => l.id === r.locationId) ?? null,
        occurredAt: new Date(`${r.endedFrom}T00:00:00Z`),
        deadlineAt: r.startsAt,
        title: `${r.label} on ${formatWhen(r.startsAt, ctx.timezone)} is after the end of its series but still has ${Number(r.bookings)} ${Number(r.bookings) === 1 ? 'booking' : 'bookings'}`,
        detail: 'Cancel it, or dismiss to keep it',
        href: withLocation(classPage(r.id), r.locationId),
      }),
    )
  },
  seeAllHref: () => null,
}
