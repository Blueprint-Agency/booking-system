import { and, asc, eq } from 'drizzle-orm'
import { db } from '../../db'
import { classTypes } from '../../db/schema/catalog'
import { clients, staffUsers } from '../../db/schema/identity'
import { ptSessionClients, ptSessions, workshopDays, workshops } from '../../db/schema/schedule'
import { readRoster, type RosterEventKind } from '../schedule/roster'
import { localDate } from '../tenants/term-dates'
import { loadTenantById } from '../tenants/tenants'
import { formatWhen } from './format'
import type { SessionChangedPayload, SessionKind } from './session-update-copy'
import { recordUpdate } from './updates'

/**
 * The writes behind the instructor's session Updates. Each is called
 * from the service that does the act, after the act's own writes and inside its
 * transaction, so the update exists exactly when the act does. None is written
 * for the person who did the act.
 */

const rosterKind: Record<SessionKind, RosterEventKind> = {
  class: 'class',
  pt: 'pt_session',
  workshop: 'workshop',
}

/** The part of a session an instructor would notice changing. */
export interface SessionSnapshot {
  startsAt: Date
  endsAt: Date
  locationId: string | null
  roomId: string | null
  mainId: string | null
  /** Everyone on it, main and supporting. */
  instructorIds: string[]
}

/** Who is on the session now. Call it before the act's writes for "before", after them for "after". */
export async function readInstructors(
  tenantId: string,
  kind: SessionKind,
  sessionId: string,
): Promise<{ mainId: string | null; instructorIds: string[] }> {
  const roster = await readRoster(tenantId, { kind: rosterKind[kind], id: sessionId })
  return {
    mainId: roster.find(r => r.role === 'main')?.instructorId ?? null,
    instructorIds: roster.map(r => r.instructorId),
  }
}

const timezoneOf = async (tenantId: string) => (await loadTenantById(tenantId))?.timezone ?? 'UTC'

/** "2026-10-28": the day in the studio's zone. */
const dayOf = (at: Date, timezone: string) => localDate(timezone, at)

async function nameOf(tenantId: string, staffId: string | null | undefined, fallback: string): Promise<string> {
  if (!staffId) return fallback
  const [row] = await db
    .select({ name: staffUsers.name })
    .from(staffUsers)
    .where(and(eq(staffUsers.tenantId, tenantId), eq(staffUsers.id, staffId)))
    .limit(1)
  return row?.name ?? fallback
}

/** A class is called by its type: "Vinyasa". */
export async function classSubject(tenantId: string, classTypeId: string): Promise<string> {
  const [row] = await db
    .select({ name: classTypes.name })
    .from(classTypes)
    .where(and(eq(classTypes.tenantId, tenantId), eq(classTypes.id, classTypeId)))
    .limit(1)
  return row?.name ?? 'your class'
}

/**
 * A private session is called by whom it is with: "the private session with Mia".
 *
 * An Update can name only one member, because `staff_updates.subject_client_id`
 * holds one id and that id is what permanent deletion removes the row by (story
 * 78). So the member is named only when there is exactly one, and the id comes
 * back to be stored with the Update. A session with two (a 2-on-1) names neither
 * and is "the 2-on-1 private session": no name is written that a deletion could
 * not reach.
 */
export async function ptSubject(
  tenantId: string,
  ptSessionId: string,
): Promise<{ subject: string; subjectClientId?: string }> {
  const people = await db
    .select({ id: clients.id, name: clients.name })
    .from(ptSessionClients)
    .innerJoin(clients, and(eq(clients.tenantId, ptSessionClients.tenantId), eq(clients.id, ptSessionClients.clientId)))
    .where(and(eq(ptSessionClients.tenantId, tenantId), eq(ptSessionClients.ptSessionId, ptSessionId)))
    .orderBy(asc(clients.name))
  if (people.length === 1) return { subject: `the private session with ${people[0]!.name}`, subjectClientId: people[0]!.id }
  return { subject: people.length > 1 ? 'the 2-on-1 private session' : 'the private session' }
}

/**
 * A workshop is called by its name, and starts when its first day does. One with
 * no day has no start, so there is nothing to tell an instructor about it: null.
 */
export async function workshopFacts(
  tenantId: string,
  workshopId: string,
): Promise<{ subject: string; startsAt: Date; endsAt: Date; locationId: string | null } | null> {
  const [w] = await db
    .select({ name: workshops.name, locationId: workshops.locationId })
    .from(workshops)
    .where(and(eq(workshops.tenantId, tenantId), eq(workshops.id, workshopId)))
    .limit(1)
  const [first] = await db
    .select({ startsAt: workshopDays.startsAt, endsAt: workshopDays.endsAt })
    .from(workshopDays)
    .where(and(eq(workshopDays.tenantId, tenantId), eq(workshopDays.workshopId, workshopId)))
    .orderBy(asc(workshopDays.startsAt))
    .limit(1)
  if (!first) return null
  return {
    subject: w?.name ?? 'your workshop',
    startsAt: first.startsAt,
    endsAt: first.endsAt,
    locationId: w?.locationId ?? null,
  }
}

/**
 * Tell the instructors a session changed under them. `before` and `after` are
 * the session on either side of the act.
 *
 * - Everyone who stays on it hears about a new time, room or location, or, if
 *   only the main instructor changed, about that.
 * - Whoever was taken off hears that, naming the new main instructor if they
 *   were the main. Their link goes to the schedule on that day.
 * - Whoever was added is told they were scheduled (`session_assigned`), not here.
 */
export async function recordSessionChanged(
  tenantId: string,
  input: {
    actorStaffId: string | undefined
    kind: SessionKind
    sessionId: string
    subject: string
    /** The member `subject` names, if it names one: permanent deletion removes the Update by it. */
    subjectClientId?: string | undefined
    before: SessionSnapshot
    after: SessionSnapshot
  },
): Promise<void> {
  const { actorStaffId, kind, sessionId, subject, subjectClientId, before, after } = input
  const timeMoved = before.startsAt.getTime() !== after.startsAt.getTime()
  const placeChanged =
    before.endsAt.getTime() !== after.endsAt.getTime() ||
    before.roomId !== after.roomId ||
    before.locationId !== after.locationId
  const mainChanged = before.mainId !== after.mainId
  const gone = before.instructorIds.filter(id => !after.instructorIds.includes(id) && id !== actorStaffId)
  const stays = before.instructorIds.filter(id => after.instructorIds.includes(id) && id !== actorStaffId)
  if (!timeMoved && !placeChanged && !mainChanged && gone.length === 0) return

  const timezone = await timezoneOf(tenantId)
  const actorName = await nameOf(tenantId, actorStaffId, 'An admin')
  const newMainName = mainChanged && after.mainId ? await nameOf(tenantId, after.mainId, 'another instructor') : null
  const base = {
    sessionKind: kind,
    sessionId,
    subject,
    actorName,
    when: formatWhen(after.startsAt, timezone),
    date: dayOf(after.startsAt, timezone),
  }
  const write = (recipients: string[], change: SessionChangedPayload['change'], otherInstructor: string | null) =>
    recipients.length === 0
      ? undefined
      : recordUpdate(
          tenantId,
          'session_changed',
          recipients,
          {
            ...base,
            change,
            from: change === 'moved' ? formatWhen(before.startsAt, timezone) : null,
            otherInstructor,
          },
          subjectClientId,
        )

  if (timeMoved || placeChanged) {
    await write(stays, timeMoved ? 'moved' : 'changed', null)
  } else if (mainChanged) {
    // Someone who has become the main instructor chose nothing to be told of.
    await write(stays.filter(id => id !== after.mainId), 'instructor_changed', newMainName)
  }

  // A time the session had before is what the removed instructor remembers, and
  // the day they are linked to is the one they would have taught on.
  const wasMain = gone.filter(id => id === before.mainId)
  const wasSupporting = gone.filter(id => id !== before.mainId)
  await write(wasMain, newMainName ? 'handed_over' : 'removed', newMainName)
  await write(wasSupporting, 'removed', null)
}

/** An admin cancelled a class, workshop or private session: everyone on it is told. */
export async function recordSessionCancelledByAdmin(
  tenantId: string,
  input: {
    actorStaffId: string
    kind: SessionKind
    sessionId: string
    subject: string
    /** The member `subject` names, if it names one: permanent deletion removes the Update by it. */
    subjectClientId?: string | undefined
    startsAt: Date
    instructorIds: string[]
  },
): Promise<void> {
  const recipients = input.instructorIds.filter(id => id !== input.actorStaffId)
  if (recipients.length === 0) return
  const timezone = await timezoneOf(tenantId)
  await recordUpdate(
    tenantId,
    'session_cancelled_by_admin',
    recipients,
    {
      sessionKind: input.kind,
      sessionId: input.sessionId,
      subject: input.subject,
      when: formatWhen(input.startsAt, timezone),
      date: dayOf(input.startsAt, timezone),
      actorName: await nameOf(tenantId, input.actorStaffId, 'An admin'),
    },
    input.subjectClientId,
  )
}

/**
 * A private session was cancelled, or a seat on it was left, by `source`. A member
 * leaving tells the session's instructor; an admin cancelling the session tells
 * everyone on it. Any other source (an instructor's own, the studio's machinery)
 * tells nobody here. Call it after the cancel's writes.
 */
export async function recordPtSessionCancelled(
  tenantId: string,
  input: { ptSessionId: string; source: string; actorStaffId?: string | null; memberClientId?: string },
): Promise<void> {
  const { ptSessionId, source } = input
  if (source !== 'client' && source !== 'admin') return
  const [session] = await db
    .select({
      startsAt: ptSessions.startsAt,
      lifecycle: ptSessions.lifecycle,
      mainId: ptSessions.instructorId,
    })
    .from(ptSessions)
    .where(and(eq(ptSessions.tenantId, tenantId), eq(ptSessions.id, ptSessionId)))
    .limit(1)
  if (!session) return

  if (source === 'admin') {
    // An admin removing one member from a session that goes on cancelled nothing the instructor teaches.
    if (session.lifecycle !== 'cancelled' || !input.actorStaffId) return
    await recordSessionCancelledByAdmin(tenantId, {
      actorStaffId: input.actorStaffId,
      kind: 'pt',
      sessionId: ptSessionId,
      ...(await ptSubject(tenantId, ptSessionId)),
      startsAt: session.startsAt,
      instructorIds: (await readInstructors(tenantId, 'pt', ptSessionId)).instructorIds,
    })
    return
  }

  if (!input.memberClientId) return
  const [member] = await db
    .select({ name: clients.name })
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), eq(clients.id, input.memberClientId)))
    .limit(1)
  const timezone = await timezoneOf(tenantId)
  await recordUpdate(
    tenantId,
    'pt_session_cancelled_by_member',
    [session.mainId],
    {
      sessionKind: 'pt',
      sessionId: ptSessionId,
      subject: 'the private session',
      when: formatWhen(session.startsAt, timezone),
      date: dayOf(session.startsAt, timezone),
      memberName: member?.name ?? 'A member',
    },
    input.memberClientId,
  )
}
