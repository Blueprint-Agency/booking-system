/**
 * The check-in nag (admin-restructure §11, §16b #19; NTF-18): a session whose
 * check-in is still `pending` 24 hours after it ended emails its Instructor,
 * with every active Admin of the studio copied.
 *
 * A session's check-in is `pending` while any confirmed booking on it is
 * undecided (./session-check-in.ts) — nothing flips a row by itself, so
 * without this a session nobody finished stays open unnoticed.
 *
 * **Once per session.** The session is *claimed* — `checkin_nag_sent_at`
 * stamped — in the same statement that picks it, so a second tick, or a second
 * process, never finds it again. A send that fails is recorded as a failed
 * `email_log` row and reported, not retried: a nag is a reminder, and sending
 * it twice is worse than missing it.
 *
 * **A bounded look back.** Only sessions that ended within the last
 * `LOOK_BACK_MS` are considered. Every session that ended before this job
 * existed has a null stamp, and nagging staff about months of old sessions on
 * the first tick after a deploy would bury the one that matters; the window
 * still leaves two days of ticks for a job that was down.
 *
 * Runs per Tenant (`jobs/index.ts`: `tenantJob`), inside that Tenant's context,
 * so Row-Level Security narrows every read and claim to one studio.
 */
import { and, count, eq, gt, inArray, isNull, lte } from 'drizzle-orm'
import { db } from '../../db'
import { bookings } from '../../db/schema/bookings'
import { classes, ptSessions } from '../../db/schema/schedule'
import { classTypes } from '../../db/schema/catalog'
import { staffUsers } from '../../db/schema/identity'
import { emailEveryAdmin, sendTemplatedEmail } from '../notifications/send'
import { loadTenantById } from '../tenants/tenants'
import { requireTenantUrl } from '../tenants/urls'
import { reportError } from '../../shared/logger'
import { now as clockNow } from '../../lib/clock'

/** How long after a session ends its check-in may stay open before the nag. */
export const NAG_AFTER_MS = 24 * 60 * 60 * 1000
/** How far back an ended session is still nagged about — see the module note. */
const LOOK_BACK_MS = 3 * NAG_AFTER_MS

interface Claimed {
  tenantId: string
  instructorId: string
  startsAt: Date
  /** "Hatha", or "Private session" — what the nag names. */
  label: string
  pending: number
}

export async function sendCheckInNags(): Promise<void> {
  const now = clockNow()
  const endedBy = new Date(now.getTime() - NAG_AFTER_MS)
  const endedAfter = new Date(now.getTime() - LOOK_BACK_MS)

  const claimed = [...(await claimClasses(endedBy, endedAfter, now)), ...(await claimPtSessions(endedBy, endedAfter, now))]
  for (const c of claimed) await nag(c)
}

/** Confirmed bookings still undecided, per session. */
async function pendingCounts(column: typeof bookings.classId | typeof bookings.ptSessionId, ids: string[]) {
  if (!ids.length) return new Map<string, number>()
  const rows = await db
    .select({ id: column, n: count() })
    .from(bookings)
    .where(and(inArray(column, ids), eq(bookings.state, 'confirmed'), eq(bookings.checkInState, 'pending')))
    .groupBy(column)
  return new Map(rows.map(r => [r.id!, Number(r.n)]))
}

async function claimClasses(endedBy: Date, endedAfter: Date, now: Date): Promise<Claimed[]> {
  const due = await db
    .select({ id: classes.id })
    .from(classes)
    .where(
      and(
        eq(classes.lifecycle, 'active'),
        isNull(classes.checkinNagSentAt),
        lte(classes.endsAt, endedBy),
        gt(classes.endsAt, endedAfter),
      ),
    )
  const pending = await pendingCounts(bookings.classId, due.map(d => d.id))
  const ids = [...pending.keys()]
  if (!ids.length) return []
  // The claim: only a row still unstamped is taken, so two ticks racing on
  // one session claim it once between them.
  const rows = await db
    .update(classes)
    .set({ checkinNagSentAt: now })
    .where(and(inArray(classes.id, ids), isNull(classes.checkinNagSentAt)))
    .returning({ id: classes.id, tenantId: classes.tenantId, instructorId: classes.mainInstructorId, startsAt: classes.startsAt, classTypeId: classes.classTypeId })
  const names = new Map(
    rows.length
      ? (
          await db
            .select({ id: classTypes.id, name: classTypes.name })
            .from(classTypes)
            .where(inArray(classTypes.id, [...new Set(rows.map(r => r.classTypeId))]))
        ).map(t => [t.id, t.name] as const)
      : [],
  )
  return rows.map(r => ({
    tenantId: r.tenantId,
    instructorId: r.instructorId,
    startsAt: r.startsAt,
    label: names.get(r.classTypeId) ?? 'Class',
    pending: pending.get(r.id) ?? 0,
  }))
}

async function claimPtSessions(endedBy: Date, endedAfter: Date, now: Date): Promise<Claimed[]> {
  const due = await db
    .select({ id: ptSessions.id })
    .from(ptSessions)
    .where(
      and(
        eq(ptSessions.lifecycle, 'active'),
        isNull(ptSessions.checkinNagSentAt),
        lte(ptSessions.endsAt, endedBy),
        gt(ptSessions.endsAt, endedAfter),
      ),
    )
  const pending = await pendingCounts(bookings.ptSessionId, due.map(d => d.id))
  const ids = [...pending.keys()]
  if (!ids.length) return []
  const rows = await db
    .update(ptSessions)
    .set({ checkinNagSentAt: now })
    .where(and(inArray(ptSessions.id, ids), isNull(ptSessions.checkinNagSentAt)))
    .returning({ id: ptSessions.id, tenantId: ptSessions.tenantId, instructorId: ptSessions.instructorId, startsAt: ptSessions.startsAt })
  return rows.map(r => ({
    tenantId: r.tenantId,
    instructorId: r.instructorId,
    startsAt: r.startsAt,
    label: 'Private session',
    pending: pending.get(r.id) ?? 0,
  }))
}

/**
 * Email the Instructor, then every active Admin but them (an Instructor who is
 * also an Admin gets one email). Each link opens the recipient's own check-in
 * desk. Never throws: the claim is already made.
 */
async function nag(c: Claimed): Promise<void> {
  try {
    const tenant = await loadTenantById(c.tenantId)
    const date = new Intl.DateTimeFormat('en-GB', {
      timeZone: tenant?.timezone ?? 'UTC',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(c.startsAt)
    const portal = await requireTenantUrl('portal', c.tenantId)
    const [instructor] = await db
      .select({ id: staffUsers.id, name: staffUsers.name, email: staffUsers.email, status: staffUsers.status })
      .from(staffUsers)
      .where(and(eq(staffUsers.tenantId, c.tenantId), eq(staffUsers.id, c.instructorId)))
      .limit(1)
    const variables = (checkinPath: string) => ({
      instructor_name: instructor?.name || 'The instructor',
      session_label: c.label,
      date,
      pending_count: String(c.pending),
      checkin_url: `${portal}${checkinPath}`,
    })
    if (instructor && instructor.status === 'active') {
      await sendTemplatedEmail({
        tenantId: c.tenantId,
        slug: 'checkin_nag',
        recipient: { email: instructor.email, userId: instructor.id, userKind: 'staff' },
        variables: variables('/instructor/check-in'),
      })
    }
    await emailEveryAdmin(
      c.tenantId,
      'checkin_nag',
      async () => variables('/admin/check-in'),
      { scope: 'check-in-nag', instructorId: c.instructorId },
      { exceptStaffId: c.instructorId },
    )
  } catch (err) {
    reportError(err, 'check-in nag failed', { scope: 'check-in-nag', tenantId: c.tenantId, instructorId: c.instructorId })
  }
}
