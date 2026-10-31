import { and, asc, count, eq, gte, inArray, lte, ne } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '../../db'
import { leaveConflicts } from '../../db/schema/catalog'
import { leaveRequests } from '../../db/schema/leave'
import { globalPolicy } from '../../db/schema/policy'
import { staffUsers } from '../../db/schema/identity'
import { tenantTimezone } from '../tenants/tenants'
import * as rules from './rules'

/**
 * The leave requests waiting for an admin's decision, as the bell lists them.
 *
 * "Waiting" is `status = 'pending'`, so approving, rejecting or withdrawing a
 * request takes it off with no code of its own. Which admins are owed which
 * request is decided here, not in the attention provider: everyone except the
 * applicant, unless the applicant is the studio's only active admin and so the
 * only person who could ever decide it (there is no self-decision guard: see
 * `decideLeaveRequest`).
 */

const pendingFor = (tenantId: string, deciderId: string, onlyAdmin: boolean) =>
  and(
    eq(leaveRequests.tenantId, tenantId),
    eq(leaveRequests.status, 'pending'),
    ...(onlyAdmin ? [] : [ne(leaveRequests.staffUserId, deciderId)]),
  )

async function isOnlyActiveAdmin(tenantId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(staffUsers)
    .where(and(eq(staffUsers.tenantId, tenantId), eq(staffUsers.role, 'admin'), eq(staffUsers.status, 'active')))
  return Number(row?.n ?? 0) <= 1
}

export async function countPendingLeaveForDecision(tenantId: string, deciderId: string): Promise<number> {
  const onlyAdmin = await isOnlyActiveAdmin(tenantId)
  const [row] = await db
    .select({ n: count() })
    .from(leaveRequests)
    .where(pendingFor(tenantId, deciderId, onlyAdmin))
  return Number(row?.n ?? 0)
}

/** What makes a pending request risky to approve. */
export type LeaveFlag = { kind: 'study_cap' } | { kind: 'conflict'; withName: string }

export interface PendingLeaveForDecision {
  id: string
  applicantName: string
  type: rules.LeaveType
  startDate: rules.PlainDate
  endDate: rules.PlainDate
  halfDay: rules.LeaveHalfDay
  days: number
  createdAt: Date
  flag: LeaveFlag | null
}

/** The oldest `limit` requests waiting for `deciderId`, each with its risk flag. */
export async function listPendingLeaveForDecision(
  tenantId: string,
  deciderId: string,
  limit: number,
): Promise<PendingLeaveForDecision[]> {
  const onlyAdmin = await isOnlyActiveAdmin(tenantId)
  const rows = await db
    .select({ row: leaveRequests, applicantName: staffUsers.name, applicantRole: staffUsers.role })
    .from(leaveRequests)
    .innerJoin(staffUsers, eq(staffUsers.id, leaveRequests.staffUserId))
    .where(pendingFor(tenantId, deciderId, onlyAdmin))
    .orderBy(asc(leaveRequests.createdAt), asc(leaveRequests.startDate))
    .limit(limit)
  if (rows.length === 0) return []

  const flags = await flagsFor(
    tenantId,
    rows.map(r => ({
      id: r.row.id,
      staffUserId: r.row.staffUserId,
      isInstructor: r.applicantRole === 'instructor',
      type: r.row.type,
      startDate: r.row.startDate,
      endDate: r.row.endDate,
      halfDay: r.row.halfDay,
    })),
  )

  return rows.map(({ row, applicantName }) => ({
    id: row.id,
    applicantName,
    type: row.type,
    startDate: row.startDate,
    endDate: row.endDate,
    halfDay: row.halfDay,
    days: Number(row.days),
    createdAt: row.createdAt,
    flag: flags.get(row.id) ?? null,
  }))
}

interface FlagInput {
  id: string
  staffUserId: string
  isInstructor: boolean
  type: rules.LeaveType
  startDate: rules.PlainDate
  endDate: rules.PlainDate
  halfDay: rules.LeaveHalfDay
}

/**
 * The same measurement the submission refusal, the admins' email and the leave
 * calendar's flag use (`rules.leaveCapExceedance`), asked of each request against
 * everyone else's occupying leave. The caps protect teaching cover, so only an
 * instructor's request is measured, and only against other instructors' leave.
 */
async function flagsFor(tenantId: string, requests: FlagInput[]): Promise<Map<string, LeaveFlag>> {
  const flags = new Map<string, LeaveFlag>()
  const measured = requests.filter(r => r.isInstructor)
  if (measured.length === 0) return flags
  const timezone = await tenantTimezone(tenantId)

  const from = measured.map(r => r.startDate).reduce((a, b) => (a < b ? a : b))
  const to = measured.map(r => r.endDate).reduce((a, b) => (a > b ? a : b))

  const [caps] = await db
    .select({ study: globalPolicy.studyLeaveCap })
    .from(globalPolicy)
    .where(eq(globalPolicy.tenantId, tenantId))
    .limit(1)
  if (!caps) return flags

  const conflictA = alias(staffUsers, 'conflict_a')
  const conflictB = alias(staffUsers, 'conflict_b')
  const partners = new Map<string, string[]>()
  for (const p of await db
    .select({ a: leaveConflicts.instructorAId, b: leaveConflicts.instructorBId })
    .from(leaveConflicts)
    .innerJoin(conflictA, eq(conflictA.id, leaveConflicts.instructorAId))
    .innerJoin(conflictB, eq(conflictB.id, leaveConflicts.instructorBId))
    .where(
      and(
        eq(leaveConflicts.tenantId, tenantId),
        eq(conflictA.status, 'active'),
        eq(conflictB.status, 'active'),
        eq(conflictA.role, 'instructor'),
        eq(conflictB.role, 'instructor'),
      ),
    )) {
    partners.set(p.a, [...(partners.get(p.a) ?? []), p.b])
    partners.set(p.b, [...(partners.get(p.b) ?? []), p.a])
  }

  const peers = (
    await db
      .select({
        staffUserId: leaveRequests.staffUserId,
        name: staffUsers.name,
        type: leaveRequests.type,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
        halfDay: leaveRequests.halfDay,
      })
      .from(leaveRequests)
      .innerJoin(staffUsers, eq(staffUsers.id, leaveRequests.staffUserId))
      .where(
        and(
          eq(leaveRequests.tenantId, tenantId),
          eq(staffUsers.role, 'instructor'),
          inArray(leaveRequests.status, [...rules.OCCUPYING_STATUSES]),
          lte(leaveRequests.startDate, to),
          gte(leaveRequests.endDate, from),
        ),
      )
  ).map(p => ({
    instructorId: p.staffUserId,
    instructorName: p.name,
    type: p.type,
    ...rules.leaveWindow(timezone, p.startDate, p.endDate, p.halfDay),
  }))

  for (const r of measured) {
    const over = rules.leaveCapExceedance({
      type: r.type,
      conflictPartnerIds: partners.get(r.staffUserId) ?? [],
      window: rules.leaveWindow(timezone, r.startDate, r.endDate, r.halfDay),
      timezone,
      // Excluded by person, as the submission path does.
      peers: peers.filter(p => p.instructorId !== r.staffUserId),
      studyCap: caps.study,
    })
    if (!over) continue
    flags.set(
      r.id,
      over.rule === 'study_cap' ? { kind: 'study_cap' } : { kind: 'conflict', withName: over.away[0]!.instructorName },
    )
  }
  return flags
}
