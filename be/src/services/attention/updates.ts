import { and, desc, eq, isNull, lt, ne, sql } from 'drizzle-orm'
import { db } from '../../db'
import type { InstructorPermission, StaffRole } from '../../db/enums'
import { staffUpdates } from '../../db/schema/attention'
import { staffUsers } from '../../db/schema/identity'
import { loadTenantById } from '../tenants/tenants'
import { formatWhen } from './format'
import { now as clockNow } from '../../lib/clock'
import { dateTime } from '../../shared/date-time'
import { NotFoundError } from '../../shared/errors'
import {
  composePtSessionCancelledByMember,
  composeSessionCancelledByAdmin,
  composeSessionChanged,
  type PtSessionCancelledByMemberPayload,
  type SessionCancelledByAdminPayload,
  type SessionChangedPayload,
} from './session-update-copy'

/**
 * Updates (#476, #490): events a staff member should know about, stored when
 * they happen. One row per recipient; the payload is a snapshot, and the copy is
 * composed from it on read, so the wording lives in one tested place and still
 * reads correctly after the subject changes.
 *
 * `recordUpdate` is called from the service that does the act, on the act's own
 * transaction: if the act rolls back, so does the update. The caller leaves the
 * actor out of `recipients`; an update is never written for the person who did
 * the act.
 */

export type StaffUpdateKind = (typeof staffUpdates.$inferInsert)['kind']

/** What `leave_decided` snapshots: enough to write the sentence and link the request. */
export interface LeaveDecidedPayload {
  leaveRequestId: string
  outcome: 'approved' | 'rejected' | 'revoked'
  /** 'annual' | 'medical' | 'study' */
  leaveType: string
  /** The dates as the applicant filed them: "18 Aug 2026 – 20 Aug 2026". */
  range: string
  /** The admin's reason, for a decline. */
  reason: string | null
  /** The admin who decided it. */
  actorName: string
}

/** What `session_assigned` snapshots: the sentence's parts, and where it links. */
export interface SessionAssignedPayload {
  sessionKind: 'class' | 'pt' | 'workshop' | 'corporate'
  /** The class or PT session the link opens; a workshop or corporate session has no page. */
  sessionId: string
  actorName: string
  /** "Vinyasa", "a private session", a workshop's name. */
  what: string
  /** "Tue 28 Oct, 7:00 pm" in the studio's zone; null when a workshop has no day yet. */
  when: string | null
  /** The session's day in the studio's zone, `YYYY-MM-DD`: where a page-less session links. */
  date: string | null
  /** Added as a supporting instructor rather than the main one. */
  supporting: boolean
  /** Set for a series: "every Tuesday at 7:00 pm from Tue 28 Oct". Its `sessionId` is the first class. */
  series: { weekday: string; time: string; from: string } | null
}

/** `class_cancelled_by_instructor`: the class, who cancelled it, why, and what it cost. */
export interface ClassCancelledByInstructorPayload {
  classId: string
  className: string
  instructorName: string
  /** The class's start, in the studio's zone: "Tue 28 Oct, 7:00 pm". */
  when: string
  reason: string
  refundedCount: number
}

/** `pt_session_cancelled_by_instructor`. */
export interface PtSessionCancelledByInstructorPayload {
  ptSessionId: string
  instructorName: string
  memberName: string
  when: string
}

/** `staff_joined`. */
export interface StaffJoinedPayload {
  staffId: string
  name: string
  role: StaffRole
}

/** `permissions_changed`: which Instructor Permissions were switched on and off. */
export interface PermissionsChangedPayload {
  actorName: string
  granted: InstructorPermission[]
  revoked: InstructorPermission[]
}

export interface UpdatePayloads {
  leave_decided: LeaveDecidedPayload
  session_assigned: SessionAssignedPayload
  class_cancelled_by_instructor: ClassCancelledByInstructorPayload
  pt_session_cancelled_by_instructor: PtSessionCancelledByInstructorPayload
  staff_joined: StaffJoinedPayload
  permissions_changed: PermissionsChangedPayload
  session_changed: SessionChangedPayload
  session_cancelled_by_admin: SessionCancelledByAdminPayload
  pt_session_cancelled_by_member: PtSessionCancelledByMemberPayload
}

/** Every active admin of the studio but `exceptStaffId`: the actor, who is never told of their own act. */
export async function activeAdminIds(tenantId: string, exceptStaffId?: string): Promise<string[]> {
  const rows = await db
    .select({ id: staffUsers.id })
    .from(staffUsers)
    .where(
      and(
        eq(staffUsers.tenantId, tenantId),
        eq(staffUsers.role, 'admin'),
        eq(staffUsers.status, 'active'),
        isNull(staffUsers.deletedAt),
        ...(exceptStaffId ? [ne(staffUsers.id, exceptStaffId)] : []),
      ),
    )
  return rows.map(r => r.id)
}

/** A staff member's name for a payload, with `fallback` if the row is gone. */
export async function staffNameFor(tenantId: string, staffId: string, fallback: string): Promise<string> {
  const [row] = await db
    .select({ name: staffUsers.name })
    .from(staffUsers)
    .where(and(eq(staffUsers.tenantId, tenantId), eq(staffUsers.id, staffId)))
    .limit(1)
  return row?.name ?? fallback
}

/** `at` as the studio writes it ("Tue 28 Oct, 7:00 pm"), for a payload. */
export async function studioWhen(tenantId: string, at: Date): Promise<string> {
  const tenant = await loadTenantById(tenantId)
  return formatWhen(at, tenant?.timezone ?? 'UTC')
}

const PERMISSION_PHRASE: Record<InstructorPermission, string> = {
  take_pt_bookings: 'take PT bookings',
  schedule_classes: 'schedule classes',
  manage_rosters: 'manage rosters',
}

const phraseList = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

/** Write one update per recipient, in the caller's transaction. */
export async function recordUpdate<K extends StaffUpdateKind>(
  tenantId: string,
  kind: K,
  recipientStaffIds: readonly string[],
  payload: UpdatePayloads[K],
  subjectClientId?: string,
): Promise<void> {
  const recipients = [...new Set(recipientStaffIds)]
  if (recipients.length === 0) return
  const at = clockNow()
  await db.insert(staffUpdates).values(
    recipients.map(recipientStaffId => ({
      tenantId,
      recipientStaffId,
      kind,
      payload,
      subjectClientId: subjectClientId ?? null,
      createdAt: at,
    })),
  )
}

// ── Reading ────────────────────────────────────────────────────────────────

export interface UpdateView {
  id: string
  kind: string
  title: string
  detail: string | null
  href: string | null
  created_at: string
  read_at: string | null
}

export interface UpdateReader {
  tenantId: string
  staffId: string
  role: StaffRole
}

interface Composed {
  title: string
  detail: string | null
  href: string | null
}

const compose: { [K in StaffUpdateKind]: (p: UpdatePayloads[K], role: StaffRole) => Composed } = {
  leave_decided: (p, role) => {
    // An admin's own leave is under My leave; an instructor's under Leave.
    const href = `${role === 'admin' ? '/admin/my-leave' : '/instructor/leave'}?request=${p.leaveRequestId}`
    const what = `${p.leaveType} leave, ${p.range}`
    if (p.outcome === 'approved') return { title: `Your ${what}, was approved`, detail: null, href }
    if (p.outcome === 'rejected') {
      return {
        title: `Your ${what}, was declined`,
        detail: `${p.reason ? `“${p.reason}” · ` : ''}${p.actorName}`,
        href,
      }
    }
    return { title: `${p.actorName} cancelled your approved ${what}`, detail: null, href }
  },
  session_assigned: (p, role) => {
    // A workshop or corporate session has no page of its own: the schedule on its day.
    const href =
      p.sessionKind === 'class'
        ? `/${role}/schedule/class/${p.sessionId}`
        : p.sessionKind === 'pt'
          ? `/${role}/schedule/pt/${p.sessionId}`
          : `/${role}/schedule${p.date ? `?date=${p.date}` : ''}`
    const timing = p.series
      ? ` every ${p.series.weekday} at ${p.series.time} from ${p.series.from}`
      : p.when
        ? ` on ${p.when}`
        : ''
    return {
      title: `${p.actorName} scheduled you to teach ${p.what}${timing}${p.supporting ? ' as a supporting instructor' : ''}`,
      detail: null,
      href,
    }
  },
  class_cancelled_by_instructor: p => ({
    title: `${p.instructorName} cancelled ${p.className} on ${p.when}`,
    detail: `“${p.reason}” · ${
      p.refundedCount === 0
        ? 'No bookings to refund'
        : `${p.refundedCount} ${p.refundedCount === 1 ? 'booking' : 'bookings'} refunded`
    }`,
    href: `/admin/schedule/class/${p.classId}`,
  }),
  pt_session_cancelled_by_instructor: p => ({
    title: `${p.instructorName} cancelled the private session with ${p.memberName} on ${p.when}`,
    detail: null,
    href: `/admin/schedule/pt/${p.ptSessionId}`,
  }),
  staff_joined: p => ({
    title: `${p.name} joined as ${p.role}`,
    detail: null,
    href: `/admin/staff?staff=${p.staffId}`,
  }),
  permissions_changed: p => {
    const parts = [
      ...(p.granted.length ? [`now ${phraseList(p.granted.map(k => PERMISSION_PHRASE[k]))}`] : []),
      ...(p.revoked.length ? [`no longer ${phraseList(p.revoked.map(k => PERMISSION_PHRASE[k]))}`] : []),
    ]
    return {
      title: `${p.actorName} changed what you can do: you can ${parts.join(' and ')}`,
      detail: null,
      href: '/instructor/profile',
    }
  },
  session_changed: composeSessionChanged,
  session_cancelled_by_admin: composeSessionCancelledByAdmin,
  pt_session_cancelled_by_member: composePtSessionCancelledByMember,
}

export const UPDATES_PAGE_SIZE = 20

/** The cursor is the last row's time and id: `2026-10-27T01:02:03.456Z_<uuid>`. */
const CURSOR = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
const cursorTime = dateTime('An updates cursor')
/** The shape, and a time that exists: `2026-02-30T00:00:00Z` has the shape and no day, and Postgres refuses it. */
export const isUpdatesCursor = (s: string) => {
  const match = CURSOR.exec(s)
  return match !== null && cursorTime.safeParse(match[1]).success
}

/** Unread updates addressed to this staff member. */
export async function unreadUpdateCount(reader: UpdateReader): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(staffUpdates)
    .where(
      and(
        eq(staffUpdates.tenantId, reader.tenantId),
        eq(staffUpdates.recipientStaffId, reader.staffId),
        isNull(staffUpdates.readAt),
      ),
    )
  return row?.n ?? 0
}

/** The Updates tab: this person's updates, newest first, one page at a time. */
export async function listUpdates(
  reader: UpdateReader,
  opts: { before?: string | undefined } = {},
): Promise<{ items: UpdateView[]; next_cursor: string | null }> {
  const cursor = opts.before ? CURSOR.exec(opts.before) : null
  const rows = await db
    .select()
    .from(staffUpdates)
    .where(
      and(
        eq(staffUpdates.tenantId, reader.tenantId),
        eq(staffUpdates.recipientStaffId, reader.staffId),
        cursor
          ? sql`(${staffUpdates.createdAt}, ${staffUpdates.id}) < (${cursor[1]}::timestamptz, ${cursor[2]}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(staffUpdates.createdAt), desc(staffUpdates.id))
    .limit(UPDATES_PAGE_SIZE + 1)

  const page = rows.slice(0, UPDATES_PAGE_SIZE)
  const last = page[page.length - 1]
  return {
    items: page.map(r => {
      const copy = (compose[r.kind] as (p: unknown, role: StaffRole) => Composed)(r.payload, reader.role)
      return {
        id: r.id,
        kind: r.kind,
        ...copy,
        created_at: r.createdAt.toISOString(),
        read_at: r.readAt ? r.readAt.toISOString() : null,
      }
    }),
    next_cursor: rows.length > UPDATES_PAGE_SIZE && last ? `${last.createdAt.toISOString()}_${last.id}` : null,
  }
}

/** Mark one of the caller's own updates read. Someone else's is a 404, as if it did not exist. */
export async function markUpdateRead(reader: UpdateReader, id: string): Promise<void> {
  const own = and(
    eq(staffUpdates.tenantId, reader.tenantId),
    eq(staffUpdates.recipientStaffId, reader.staffId),
    eq(staffUpdates.id, id),
  )
  const [row] = await db.select({ id: staffUpdates.id }).from(staffUpdates).where(own).limit(1)
  if (!row) throw new NotFoundError('update_not_found')
  // Already read keeps its first time.
  await db
    .update(staffUpdates)
    .set({ readAt: clockNow() })
    .where(and(own, isNull(staffUpdates.readAt)))
}

export async function markAllUpdatesRead(reader: UpdateReader): Promise<void> {
  await db
    .update(staffUpdates)
    .set({ readAt: clockNow() })
    .where(
      and(
        eq(staffUpdates.tenantId, reader.tenantId),
        eq(staffUpdates.recipientStaffId, reader.staffId),
        isNull(staffUpdates.readAt),
      ),
    )
}

// ── Retention ──────────────────────────────────────────────────────────────

export const UPDATE_RETENTION_DAYS = 90

/** Delete this studio's updates older than 90 days (run per tenant by the daily job). */
export async function pruneStaffUpdates(): Promise<number> {
  const cutoff = new Date(clockNow().getTime() - UPDATE_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const gone = await db.delete(staffUpdates).where(lt(staffUpdates.createdAt, cutoff)).returning({ id: staffUpdates.id })
  return gone.length
}
