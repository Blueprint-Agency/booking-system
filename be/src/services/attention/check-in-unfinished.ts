import { and, asc, count, eq, gt, lte, type SQL } from 'drizzle-orm'
import { db } from '../../db'
import { classTypes } from '../../db/schema/catalog'
import { classes, ptRequests, ptSessions } from '../../db/schema/schedule'
import { classRoster as classRosterOf, ptRoster as ptRosterOf, type RosterCheckIns } from '../bookings/check-in-nag'
import { classHasUndecidedRow, ptSessionHasUndecidedSeat } from '../bookings/session-check-in'
import { localDate } from '../tenants/term-dates'
import { formatClock, formatDay, withLocation } from './format'
import type { AttentionContext, AttentionProvider, CountScope, ProviderItem } from './types'

/**
 * A session that ended with people still not marked. The rule is the check-in
 * desk's own (`classHasUndecidedRow` / `ptSessionHasUndecidedSeat`), so an item
 * resolves exactly when the desk's session turns `completed`:
 *
 *   - Admins: every such session in the studio.
 *   - Instructors: the classes they are main instructor of and the private
 *     sessions they teach, never a colleague's.
 *
 * It shows from an hour after the session ends, to give the room time to tick
 * people in, and drops off thirty days after: older than that is history, not
 * something to chase.
 */
const SHOW_AFTER_MS = 60 * 60 * 1000
const SHOW_FOR_MS = 30 * 24 * 60 * 60 * 1000

const desk = (ctx: AttentionContext) => `/${ctx.role}/check-in`

/** The `ends_at` window: ended at least an hour ago, and less than thirty days ago. */
function window(ctx: AttentionContext) {
  return {
    endedBy: new Date(ctx.now.getTime() - SHOW_AFTER_MS),
    endedAfter: new Date(ctx.now.getTime() - SHOW_FOR_MS),
  }
}

function classFilter(ctx: AttentionContext, scope: CountScope): SQL | undefined {
  const { endedBy, endedAfter } = window(ctx)
  return and(
    eq(classes.tenantId, ctx.tenantId),
    eq(classes.lifecycle, 'active'),
    lte(classes.endsAt, endedBy),
    gt(classes.endsAt, endedAfter),
    classHasUndecidedRow,
    ctx.role === 'admin' ? undefined : eq(classes.mainInstructorId, ctx.staffId),
    scope.locationId ? eq(classes.locationId, scope.locationId) : undefined,
  )
}

function ptFilter(ctx: AttentionContext, scope: CountScope): SQL | undefined {
  const { endedBy, endedAfter } = window(ctx)
  return and(
    eq(ptSessions.tenantId, ctx.tenantId),
    eq(ptSessions.lifecycle, 'active'),
    lte(ptSessions.endsAt, endedBy),
    gt(ptSessions.endsAt, endedAfter),
    ptSessionHasUndecidedSeat,
    ctx.role === 'admin' ? undefined : eq(ptSessions.instructorId, ctx.staffId),
    scope.locationId ? eq(ptSessions.locationId, scope.locationId) : undefined,
  )
}

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`

export const checkInUnfinished: AttentionProvider = {
  kind: 'check_in_unfinished',
  group: 'classes_sessions',
  badge: 'check_in',
  dismissable: false,
  appliesTo: ctx => ctx.role === 'admin' || ctx.role === 'instructor',
  count: async (ctx, scope) => {
    const [[c], [p]] = await Promise.all([
      db.select({ n: count() }).from(classes).where(classFilter(ctx, scope)),
      db.select({ n: count() }).from(ptSessions).where(ptFilter(ctx, scope)),
    ])
    return (c?.n ?? 0) + (p?.n ?? 0)
  },
  list: async (ctx, limit) => {
    const [classRows, ptRows] = await Promise.all([
      db
        .select({
          id: classes.id,
          locationId: classes.locationId,
          startsAt: classes.startsAt,
          endsAt: classes.endsAt,
          label: classTypes.name,
        })
        .from(classes)
        .innerJoin(classTypes, eq(classTypes.id, classes.classTypeId))
        .where(classFilter(ctx, {}))
        .orderBy(asc(classes.endsAt))
        .limit(limit),
      db
        .select({
          id: ptSessions.id,
          locationId: ptSessions.locationId,
          startsAt: ptSessions.startsAt,
          endsAt: ptSessions.endsAt,
          // Named by its request's class type, as the PT request item names it; a request need not have one.
          label: classTypes.name,
        })
        .from(ptSessions)
        .leftJoin(ptRequests, and(eq(ptRequests.tenantId, ptSessions.tenantId), eq(ptRequests.id, ptSessions.ptRequestId)))
        .leftJoin(classTypes, eq(classTypes.id, ptRequests.classTypeId))
        .where(ptFilter(ctx, {}))
        .orderBy(asc(ptSessions.endsAt))
        .limit(limit),
    ])
    const [classRoster, ptRoster] = await Promise.all([
      classRosterOf(classRows.map(r => r.id)),
      ptRosterOf(ptRows.map(r => r.id)),
    ])

    const toItem = (
      key: string,
      r: { id: string; locationId: string; startsAt: Date; endsAt: Date },
      label: string,
      roster: RosterCheckIns | undefined,
    ): ProviderItem => {
      const location = ctx.locations.find(l => l.id === r.locationId) ?? null
      return {
        subjectId: key,
        location,
        occurredAt: r.endsAt,
        title: `Finish check-in for ${label} on ${formatDay(r.startsAt, ctx.timezone)}`,
        detail: [
          `${roster?.pending ?? 0} of ${people(roster?.total ?? 0)} not marked`,
          formatClock(r.startsAt, ctx.timezone),
          location?.name,
        ]
          .filter(Boolean)
          .join(' · '),
        href: withLocation(`${desk(ctx)}?date=${localDate(ctx.timezone, r.startsAt)}&session=${key}`, r.locationId),
      }
    }

    return [
      ...classRows.map(r => toItem(`class:${r.id}`, r, r.label, classRoster.get(r.id))),
      ...ptRows.map(r => toItem(`pt:${r.id}`, r, r.label ?? 'Private session', ptRoster.get(r.id))),
    ]
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
      .slice(0, limit)
  },
  seeAllHref: desk,
  seeAllLabel: 'Check-in',
}
