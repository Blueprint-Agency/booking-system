import { and, asc, eq } from 'drizzle-orm'
import { db } from '../../db'
import { classTypes } from '../../db/schema/catalog'
import { staffUsers } from '../../db/schema/identity'
import { classes, corporateSessions, ptSessions, workshopDays, workshops } from '../../db/schema/schedule'
import type { RosterEventKind } from '../schedule/roster'
import { loadTenantById } from '../tenants/tenants'
import { localDate } from '../tenants/term-dates'
import { formatClock, formatDay, formatWeekday, formatWhen } from './format'
import { recordUpdate, type SessionAssignedPayload } from './updates'

/**
 * `session_assigned`: an instructor is told when someone else
 * schedules them to teach. The schedule services call this on every create or
 * assign path with the instructors the act ADDED; the actor is never told, and
 * an instructor who was already on the session is not told again.
 */

export interface AddedInstructors {
  main?: readonly string[]
  supporting?: readonly string[]
}

export interface SessionRef {
  kind: RosterEventKind
  id: string
}

interface Described {
  sessionKind: SessionAssignedPayload['sessionKind']
  what: string
  startsAt: Date | null
}

/** What the session is called and when it starts, read on the act's own transaction. */
async function describe(tenantId: string, ref: SessionRef, tx?: unknown): Promise<Described | null> {
  const q = (tx ?? db) as typeof db
  if (ref.kind === 'class') {
    const [row] = await q
      .select({ name: classTypes.name, startsAt: classes.startsAt })
      .from(classes)
      .innerJoin(classTypes, eq(classTypes.id, classes.classTypeId))
      .where(and(eq(classes.tenantId, tenantId), eq(classes.id, ref.id)))
      .limit(1)
    return row ? { sessionKind: 'class', what: row.name, startsAt: row.startsAt } : null
  }
  if (ref.kind === 'pt_session') {
    const [row] = await q
      .select({ startsAt: ptSessions.startsAt })
      .from(ptSessions)
      .where(and(eq(ptSessions.tenantId, tenantId), eq(ptSessions.id, ref.id)))
      .limit(1)
    return row ? { sessionKind: 'pt', what: 'a private session', startsAt: row.startsAt } : null
  }
  if (ref.kind === 'corporate_session') {
    const [row] = await q
      .select({ clientName: corporateSessions.clientName, startsAt: corporateSessions.startsAt })
      .from(corporateSessions)
      .where(and(eq(corporateSessions.tenantId, tenantId), eq(corporateSessions.id, ref.id)))
      .limit(1)
    return row ? { sessionKind: 'corporate', what: `a corporate session for ${row.clientName}`, startsAt: row.startsAt } : null
  }
  const [row] = await q
    .select({ name: workshops.name })
    .from(workshops)
    .where(and(eq(workshops.tenantId, tenantId), eq(workshops.id, ref.id)))
    .limit(1)
  if (!row) return null
  const [first] = await q
    .select({ startsAt: workshopDays.startsAt })
    .from(workshopDays)
    .where(and(eq(workshopDays.tenantId, tenantId), eq(workshopDays.workshopId, ref.id)))
    .orderBy(asc(workshopDays.startsAt))
    .limit(1)
  return { sessionKind: 'workshop', what: row.name, startsAt: first?.startsAt ?? null }
}

/**
 * Tell the instructors an act added. For a series, `ref` is its first class and
 * `series` is set: one update per instructor, however many classes it made.
 */
export async function recordSessionAssigned(
  tenantId: string,
  actorStaffId: string,
  ref: SessionRef,
  added: AddedInstructors,
  /** `tx`: the act's transaction handle, to read the session it just wrote. */
  opts: {
    series?: boolean
    tx?: unknown
    /** The member the copy names (a corporate session's client), so deleting them removes the Update. */
    subjectClientId?: string
  } = {},
): Promise<void> {
  const main = (added.main ?? []).filter(id => id !== actorStaffId)
  const supporting = (added.supporting ?? []).filter(id => id !== actorStaffId && !main.includes(id))
  if (main.length === 0 && supporting.length === 0) return

  const what = await describe(tenantId, ref, opts.tx)
  if (!what) return
  const tenant = await loadTenantById(tenantId)
  const timezone = tenant?.timezone ?? 'UTC'
  const q = (opts.tx ?? db) as typeof db
  const [actor] = await q
    .select({ name: staffUsers.name })
    .from(staffUsers)
    .where(and(eq(staffUsers.tenantId, tenantId), eq(staffUsers.id, actorStaffId)))
    .limit(1)

  const at = what.startsAt
  const payload: Omit<SessionAssignedPayload, 'supporting'> = {
    sessionKind: what.sessionKind,
    sessionId: ref.id,
    actorName: actor?.name ?? 'An admin',
    what: what.what,
    when: at ? formatWhen(at, timezone) : null,
    date: at ? localDate(timezone, at) : null,
    series:
      opts.series && at
        ? { weekday: formatWeekday(at, timezone), time: formatClock(at, timezone), from: formatDay(at, timezone) }
        : null,
  }
  await recordUpdate(tenantId, 'session_assigned', main, { ...payload, supporting: false }, opts.subjectClientId)
  await recordUpdate(tenantId, 'session_assigned', supporting, { ...payload, supporting: true }, opts.subjectClientId)
}
