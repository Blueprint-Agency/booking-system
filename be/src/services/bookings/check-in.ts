/**
 * Attendance / check-in for class and PT bookings (spec §11 — workshops are not
 * check-in tracked).
 *
 * Three ways in, one set of rules:
 *   - `scanCheckIn` — front desk scans a member's QR, or types the code under it.
 *   - `markAttendance` — the manual tick on the roster, and its undo.
 *   - `listCheckInDay` — today's sessions and their rosters, for the desk.
 *
 * All of them honour the studio's **Check-in Window** (check-in-window.ts):
 * check-in opens `check_in_opens_minutes_before` ahead of the start. A no-show
 * does not — nobody is a no-show before the class begins (no-show.ts).
 *
 * There is deliberately NO automatic no-show flip — admin-restructure.md §11:
 * "No automatic no-show flip. Forfeits only fire when admin/instructor manually
 * marks the row `no-show`." A member who was simply never ticked stays `pending`.
 */
import { and, asc, eq, gte, inArray, lt, ne, or } from 'drizzle-orm'
import { db } from '../../db'
import { bookings, checkIns, waitlistEntries } from '../../db/schema/bookings'
import { classes, ptSessions } from '../../db/schema/schedule'
import { classTypes, locations, rooms } from '../../db/schema/catalog'
import { clients, staffUsers } from '../../db/schema/identity'
import { globalPolicy } from '../../db/schema/policy'
import { loadTenantById } from '../tenants/tenants'
import { addDays, localDateOf, zonedInstant } from '../schedule/series-dates'
import { checkInOpensAt, checkInWindow } from './check-in-window'
import { listForClasses } from '../waitlist/line'
import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../shared/errors'

/** Who is acting. An instructor reaches their OWN sessions only (§11). */
export type CheckInSource = 'admin' | 'instructor'
export type CheckInMethod = 'qr' | 'code' | 'manual'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

type LockedBooking = {
  id: string
  kind: 'class' | 'workshop' | 'pt'
  state: 'confirmed' | 'cancelled' | 'no_show'
  checkInState: 'pending' | 'attended' | 'no_show' | 'n_a'
  classId: string | null
  ptSessionId: string | null
  clientId: string
}

type SessionFacts = {
  kind: 'class' | 'pt'
  id: string
  name: string
  startsAt: Date
  lifecycle: 'active' | 'cancelled'
  mainInstructorId: string
  location: { id: string; name: string } | null
}

const PT_SESSION_NAME = 'PT session'

/** Locks one booking of this Tenant, found by whichever key the caller holds. */
async function lockBooking(
  tx: Tx,
  tenantId: string,
  key: { id: string } | { qrToken: string } | { code: string },
): Promise<LockedBooking> {
  const match =
    'id' in key
      ? eq(bookings.id, key.id)
      : 'qrToken' in key
        ? eq(bookings.qrToken, key.qrToken)
        : eq(bookings.code, key.code)
  const [bk] = await tx
    .select({
      id: bookings.id,
      kind: bookings.kind,
      state: bookings.state,
      checkInState: bookings.checkInState,
      classId: bookings.classId,
      ptSessionId: bookings.ptSessionId,
      clientId: bookings.clientId,
    })
    .from(bookings)
    .where(and(eq(bookings.tenantId, tenantId), match))
    .for('update')
    .limit(1)
  // Another Tenant's code lands here too: the lookup is scoped, so it simply
  // is not found, and the refusal says nothing about whose it might have been.
  if (!bk) {
    throw new NotFoundError('booking_not_found', {
      message: 'No booking at this studio matches that code.',
    })
  }
  return bk
}

/** Class and PT carry the same facts under different column names. */
async function loadSession(tx: Tx, tenantId: string, bk: LockedBooking): Promise<SessionFacts> {
  if (bk.kind === 'workshop') throw new BadRequestError('workshop_check_in_unsupported')
  if (bk.kind === 'class') {
    const [row] = await tx
      .select({
        id: classes.id,
        name: classTypes.name,
        startsAt: classes.startsAt,
        lifecycle: classes.lifecycle,
        mainInstructorId: classes.mainInstructorId,
        location: { id: locations.id, name: locations.name },
      })
      .from(classes)
      .leftJoin(classTypes, eq(classTypes.id, classes.classTypeId))
      .leftJoin(locations, eq(locations.id, classes.locationId))
      .where(and(eq(classes.tenantId, tenantId), eq(classes.id, bk.classId!)))
      .limit(1)
    if (!row) throw new NotFoundError('class_not_found')
    return { kind: 'class', ...row, name: row.name ?? 'Class' }
  }
  const [row] = await tx
    .select({
      id: ptSessions.id,
      startsAt: ptSessions.startsAt,
      lifecycle: ptSessions.lifecycle,
      mainInstructorId: ptSessions.instructorId,
      location: { id: locations.id, name: locations.name },
    })
    .from(ptSessions)
    .leftJoin(locations, eq(locations.id, ptSessions.locationId))
    .where(and(eq(ptSessions.tenantId, tenantId), eq(ptSessions.id, bk.ptSessionId!)))
    .limit(1)
  if (!row) throw new NotFoundError('pt_session_not_found')
  return { kind: 'pt', ...row, name: PT_SESSION_NAME }
}

/** The column's own default, for a studio whose policy row has not been seeded. */
const DEFAULT_WINDOW_MINUTES = 30

/**
 * The studio's Check-in Window, in minutes. A studio with no policy row gets
 * the same window a new row would, rather than a refusal at the door.
 */
async function windowMinutes(tx: Tx | typeof db, tenantId: string): Promise<number> {
  const [row] = await tx
    .select({ minutes: globalPolicy.checkInOpensMinutesBefore })
    .from(globalPolicy)
    .where(eq(globalPolicy.tenantId, tenantId))
    .limit(1)
  return row?.minutes ?? DEFAULT_WINDOW_MINUTES
}

async function timezoneOf(tenantId: string): Promise<string> {
  const tenant = await loadTenantById(tenantId)
  if (!tenant) throw new NotFoundError('tenant_not_found')
  return tenant.timezone
}

/** "09:30", in the studio's own time. */
const clockIn = (instant: Date, timezone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(
    instant,
  )

/**
 * The refusals every way in shares, in the order a person at the desk needs
 * them: is this a thing that can be checked in at all, is it yours to check in.
 * Checked in the service, not the route, so no future caller can skip them —
 * same shape as cancelClass.
 */
function refuseIneligible(bk: LockedBooking, ses: SessionFacts, source: CheckInSource, staffId: string): void {
  if (bk.state === 'cancelled') {
    throw new ConflictError('booking_cancelled', { message: 'This booking was cancelled.' })
  }
  if (ses.lifecycle !== 'active') {
    throw new ConflictError('session_cancelled', { message: `${ses.name} was cancelled.` })
  }
  if (source === 'instructor' && ses.mainInstructorId !== staffId) {
    throw new ForbiddenError('not_your_session', { message: 'This booking is for a session you are not teaching.' })
  }
}

/** Refuses unless the Check-in Window is open right now. */
async function refuseOutsideWindow(
  tx: Tx,
  tenantId: string,
  ses: SessionFacts,
  closesWithTheDay: boolean,
): Promise<void> {
  const [minutes, timezone] = await Promise.all([windowMinutes(tx, tenantId), timezoneOf(tenantId)])
  const now = new Date()
  const state = checkInWindow({ now, startsAt: ses.startsAt, minutesBefore: minutes, timezone, closesWithTheDay })
  if (state === 'not_open') {
    const opensAt = checkInOpensAt(ses.startsAt, minutes)
    const sameDay = localDateOf(opensAt, timezone) === localDateOf(now, timezone)
    throw new AppError(422, 'check_in_not_open', {
      message: sameDay
        ? `Check-in for ${ses.name} opens at ${clockIn(opensAt, timezone)}.`
        : `This booking is for ${ses.name} on ${localDateOf(ses.startsAt, timezone)}, not today.`,
      opens_at: opensAt.toISOString(),
    })
  }
  if (state === 'closed') {
    throw new AppError(422, 'check_in_closed', {
      message: `This booking was for ${ses.name} on ${localDateOf(ses.startsAt, timezone)}. Tick it on that day's roster instead.`,
    })
  }
}

/** Writes the check-in. A booking already attended keeps its first row. */
async function writeCheckIn(tx: Tx, tenantId: string, bookingId: string, staffId: string, method: CheckInMethod) {
  await tx
    .insert(checkIns)
    .values({ tenantId, bookingId, checkedInByStaffId: staffId, method })
    .onConflictDoNothing()
  // Attendance implies they showed up — clear any prior no-show AND the forfeit
  // that came with it, or the member stays "forfeited" on a session they attended.
  await tx
    .update(bookings)
    .set({ checkInState: 'attended', state: 'confirmed', refundOutcome: 'n_a' })
    .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId)))
}

// ── Manual tick ───────────────────────────────────────────────────────────

export interface MarkAttendanceInput {
  bookingId: string
  staffId: string
  /** true → mark attended; false → undo back to pending. */
  attended: boolean
  /** Who is acting. Defaults to `admin` (the original caller). */
  source?: CheckInSource
}

export async function markAttendance(
  tenantId: string,
  input: MarkAttendanceInput,
): Promise<{ checkInState: 'attended' | 'pending' }> {
  const { bookingId, staffId, attended } = input
  const source: CheckInSource = input.source ?? 'admin'

  return db.transaction(async tx => {
    const bk = await lockBooking(tx, tenantId, { id: bookingId })
    const ses = await loadSession(tx, tenantId, bk)
    refuseIneligible(bk, ses, source, staffId)
    // The tick opens with the window and never closes: cleaning up a roster
    // after the class is what it is for.
    await refuseOutsideWindow(tx, tenantId, ses, false)

    if (attended) {
      await writeCheckIn(tx, tenantId, bk.id, staffId, 'manual')
      return { checkInState: 'attended' }
    }

    // Undo: remove the check-in and reset to pending.
    await tx
      .delete(checkIns)
      .where(and(eq(checkIns.tenantId, tenantId), eq(checkIns.bookingId, bk.id)))
    await tx
      .update(bookings)
      .set({ checkInState: 'pending' })
      .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bk.id)))
    return { checkInState: 'pending' }
  })
}

// ── Scan ──────────────────────────────────────────────────────────────────

export interface ScanCheckInInput {
  /** Exactly one: the token the member's QR encodes, or the code under it. */
  qrToken?: string
  code?: string
  staffId: string
  source: CheckInSource
}

export interface ScanCheckInResult {
  /** `already_checked_in` is a friendly no-op, never an error. */
  outcome: 'checked_in' | 'already_checked_in'
  bookingId: string
  method: CheckInMethod
  member: { id: string; name: string }
  session: {
    kind: 'class' | 'pt'
    id: string
    name: string
    startsAt: Date
    location: { id: string; name: string } | null
  }
  message: string
}

/** Codes are read aloud and typed; case and stray spaces are not meaningful. */
export const normaliseBookingCode = (code: string) => code.trim().toUpperCase()

/**
 * A booking's QR or typed code, checked in. The code alone names the member
 * and the session (§11), so there is no "wrong session" to refuse.
 *
 * Idempotent: a second scan of the same booking answers `already_checked_in`,
 * writes nothing, and keeps the first scan's row as the record.
 */
export async function scanCheckIn(tenantId: string, input: ScanCheckInInput): Promise<ScanCheckInResult> {
  const { staffId, source } = input
  const key =
    input.qrToken !== undefined
      ? { qrToken: input.qrToken.trim() }
      : input.code !== undefined
        ? { code: normaliseBookingCode(input.code) }
        : null
  if (!key) throw new BadRequestError('bad_request', { message: 'Scan a QR code or type a booking code.' })
  const method: CheckInMethod = 'qrToken' in key ? 'qr' : 'code'

  return db.transaction(async tx => {
    const bk = await lockBooking(tx, tenantId, key)
    const ses = await loadSession(tx, tenantId, bk)
    refuseIneligible(bk, ses, source, staffId)

    const [client] = await tx
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(and(eq(clients.tenantId, tenantId), eq(clients.id, bk.clientId)))
      .limit(1)
    const member = { id: bk.clientId, name: client?.name ?? 'Member' }
    const session = { kind: ses.kind, id: ses.id, name: ses.name, startsAt: ses.startsAt, location: ses.location }

    if (bk.checkInState === 'attended') {
      return {
        outcome: 'already_checked_in',
        bookingId: bk.id,
        method,
        member,
        session,
        message: `${member.name} is already checked in to ${ses.name}.`,
      }
    }

    await refuseOutsideWindow(tx, tenantId, ses, true)
    await writeCheckIn(tx, tenantId, bk.id, staffId, method)
    return {
      outcome: 'checked_in',
      bookingId: bk.id,
      method,
      member,
      session,
      message: `${member.name} is checked in to ${ses.name}.`,
    }
  })
}

// ── Today's sessions ──────────────────────────────────────────────────────

export interface CheckInRosterEntry {
  bookingId: string
  clientId: string
  name: string
  code: string
  state: 'confirmed' | 'no_show'
  checkInState: 'pending' | 'attended' | 'no_show' | 'n_a'
  method: CheckInMethod | null
  checkedInAt: Date | null
  /** The seat a class booking holds (spec-waitlist.md §2); null on a PT booking. */
  seat: 'online' | 'buffer' | 'overbook' | null
  /** The booking came from the class's waitlist. */
  promotedFromWaitlist: boolean
}

/** A member still waiting for a seat on a class, in queue order (spec-waitlist.md §10). */
export interface CheckInWaitingEntry {
  entryId: string
  clientId: string
  name: string
  position: number
}

export interface CheckInSession {
  kind: 'class' | 'pt'
  id: string
  name: string
  startsAt: Date
  endsAt: Date
  checkInOpensAt: Date
  location: { id: string; name: string } | null
  room: { id: string; name: string } | null
  instructor: { id: string; name: string } | null
  roster: CheckInRosterEntry[]
  /** The class's live waitlist, empty for a PT session or a class with no line. */
  waitlist: CheckInWaitingEntry[]
}

export interface CheckInDay {
  /** The studio's calendar day, `YYYY-MM-DD`. */
  date: string
  opensMinutesBefore: number
  sessions: CheckInSession[]
}

/**
 * Today's classes and PT sessions, each with its roster and check-in state —
 * what the front desk works from. "Today" is the studio's own day.
 *
 * An Admin sees every Location (there are no per-location grants; see
 * CONTEXT.md § Admin), narrowed by `locationId` when the desk stands at one.
 * An Instructor sees only the sessions they teach. Cancelled sessions and
 * cancelled bookings are left out: nobody is arriving for them.
 */
export async function listCheckInDay(
  tenantId: string,
  input: { staffId: string; source: CheckInSource; locationId?: string; now?: Date },
): Promise<CheckInDay> {
  const now = input.now ?? new Date()
  const timezone = await timezoneOf(tenantId)
  const date = localDateOf(now, timezone)
  const dayStart = zonedInstant(date, '00:00', timezone)
  const dayEnd = zonedInstant(addDays(date, 1), '00:00', timezone)
  const minutes = await windowMinutes(db, tenantId)
  const mine = input.source === 'instructor'

  const classRows = await db
    .select({
      id: classes.id,
      name: classTypes.name,
      startsAt: classes.startsAt,
      endsAt: classes.endsAt,
      locationId: locations.id,
      locationName: locations.name,
      roomId: rooms.id,
      roomName: rooms.name,
      instructorId: staffUsers.id,
      instructorName: staffUsers.name,
    })
    .from(classes)
    .leftJoin(classTypes, eq(classTypes.id, classes.classTypeId))
    .leftJoin(locations, eq(locations.id, classes.locationId))
    .leftJoin(rooms, eq(rooms.id, classes.roomId))
    .leftJoin(staffUsers, eq(staffUsers.id, classes.mainInstructorId))
    .where(
      and(
        eq(classes.tenantId, tenantId),
        eq(classes.lifecycle, 'active'),
        gte(classes.startsAt, dayStart),
        lt(classes.startsAt, dayEnd),
        mine ? eq(classes.mainInstructorId, input.staffId) : undefined,
        input.locationId ? eq(classes.locationId, input.locationId) : undefined,
      ),
    )

  const ptRows = await db
    .select({
      id: ptSessions.id,
      startsAt: ptSessions.startsAt,
      endsAt: ptSessions.endsAt,
      locationId: locations.id,
      locationName: locations.name,
      roomId: rooms.id,
      roomName: rooms.name,
      instructorId: staffUsers.id,
      instructorName: staffUsers.name,
    })
    .from(ptSessions)
    .leftJoin(locations, eq(locations.id, ptSessions.locationId))
    .leftJoin(rooms, eq(rooms.id, ptSessions.roomId))
    .leftJoin(staffUsers, eq(staffUsers.id, ptSessions.instructorId))
    .where(
      and(
        eq(ptSessions.tenantId, tenantId),
        eq(ptSessions.lifecycle, 'active'),
        gte(ptSessions.startsAt, dayStart),
        lt(ptSessions.startsAt, dayEnd),
        mine ? eq(ptSessions.instructorId, input.staffId) : undefined,
        input.locationId ? eq(ptSessions.locationId, input.locationId) : undefined,
      ),
    )

  const classIds = classRows.map(r => r.id)
  const ptIds = ptRows.map(r => r.id)
  const rosterRows =
    classIds.length + ptIds.length === 0
      ? []
      : await db
          .select({
            bookingId: bookings.id,
            classId: bookings.classId,
            ptSessionId: bookings.ptSessionId,
            clientId: bookings.clientId,
            name: clients.name,
            code: bookings.code,
            state: bookings.state,
            checkInState: bookings.checkInState,
            method: checkIns.method,
            checkedInAt: checkIns.checkedInAt,
            seat: bookings.seat,
            promotedEntryId: waitlistEntries.id,
          })
          .from(bookings)
          .innerJoin(clients, eq(clients.id, bookings.clientId))
          .leftJoin(checkIns, eq(checkIns.bookingId, bookings.id))
          .leftJoin(
            waitlistEntries,
            and(eq(waitlistEntries.tenantId, bookings.tenantId), eq(waitlistEntries.bookingId, bookings.id)),
          )
          .where(
            and(
              eq(bookings.tenantId, tenantId),
              ne(bookings.state, 'cancelled'),
              or(
                classIds.length ? inArray(bookings.classId, classIds) : undefined,
                ptIds.length ? inArray(bookings.ptSessionId, ptIds) : undefined,
              ),
            ),
          )
          .orderBy(asc(clients.name))

  const rosterOf = (sessionId: string): CheckInRosterEntry[] =>
    rosterRows
      .filter(r => r.classId === sessionId || r.ptSessionId === sessionId)
      .map(r => ({
        bookingId: r.bookingId,
        clientId: r.clientId,
        name: r.name,
        code: r.code,
        state: r.state as 'confirmed' | 'no_show',
        checkInState: r.checkInState,
        method: r.method,
        checkedInAt: r.checkedInAt,
        seat: r.classId ? r.seat : null,
        promotedFromWaitlist: r.promotedEntryId !== null,
      }))

  // A line on a class that has started is expired (spec-waitlist.md §6), so a
  // class already under way shows none.
  const lines = await listForClasses(tenantId, classIds, now)
  const waitlistOf = (classId: string): CheckInWaitingEntry[] =>
    (lines.get(classId) ?? []).map(e => ({
      entryId: e.id,
      clientId: e.clientId,
      name: e.clientName || 'Member',
      position: e.position,
    }))

  const ref = (id: string | null, name: string | null) => (id && name ? { id, name } : null)
  const sessions: CheckInSession[] = [
    ...classRows.map(r => ({ kind: 'class' as const, ...r, name: r.name ?? 'Class' })),
    ...ptRows.map(r => ({ kind: 'pt' as const, ...r, name: PT_SESSION_NAME })),
  ]
    .map(r => ({
      kind: r.kind,
      id: r.id,
      name: r.name,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      checkInOpensAt: checkInOpensAt(r.startsAt, minutes),
      location: ref(r.locationId, r.locationName),
      room: ref(r.roomId, r.roomName),
      instructor: ref(r.instructorId, r.instructorName),
      roster: rosterOf(r.id),
      waitlist: r.kind === 'class' ? waitlistOf(r.id) : [],
    }))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())

  return { date, opensMinutesBefore: minutes, sessions }
}
