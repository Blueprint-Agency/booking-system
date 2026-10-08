/**
 * A member's approved requests they have yet to see — the "approved"
 * celebration in fe-client.
 *
 * PT and Corporate Requests carry no approval step of their own: scheduling one
 * is the approval (be/CONTEXT.md § PT Request). `schedulePtRequest` and
 * `scheduleCorporateRequest` set `approval_unseen` on the request; the member's
 * app reads what is still unseen here, celebrates each once, and clears it.
 *
 * Only a request still worth celebrating is listed: scheduled, its session
 * active and not yet started. One cancelled, or whose time has passed before
 * the member opened the app, is left alone — nothing to put in a calendar.
 */
import { and, asc, eq, gt } from 'drizzle-orm'
import { db } from '../../db'
import { now as clockNow } from '../../lib/clock'
import { staffUsers } from '../../db/schema/identity'
import { classTypes, locations } from '../../db/schema/catalog'
import { corporatePackages } from '../../db/schema/packages'
import { corporateRequests, corporateSessions, ptRequests, ptSessions } from '../../db/schema/schedule'

export type ApprovalKind = 'pt' | 'corporate'

export interface UnseenApproval {
  kind: ApprovalKind
  /** The request's id: what the member marks seen. */
  id: string
  /** What was approved, in the member's words: the class type, or the corporate package. */
  title: string
  /** PT only: `1on1` or `2on1`. */
  sessionType: '1on1' | '2on1' | null
  startsAt: Date
  endsAt: Date
  locationName: string | null
  locationAddress: string | null
  /** The Location's map link; null off-site. */
  locationGmapsUrl: string | null
  instructorName: string | null
  approvedAt: Date | null
}

export async function listUnseenApprovals(tenantId: string, clientId: string): Promise<UnseenApproval[]> {
  const now = clockNow()

  // Only the requester's own: a 2on1 partner never asked, and a manual session
  // (#334) is never pending, so it is never approved.
  const pt = await db
    .select({
      id: ptRequests.id,
      className: classTypes.name,
      sessionType: ptSessions.sessionType,
      startsAt: ptSessions.startsAt,
      endsAt: ptSessions.endsAt,
      locationName: locations.name,
      locationAddress: locations.address,
      locationGmapsUrl: locations.gmapsUrl,
      instructorName: staffUsers.name,
      approvedAt: ptRequests.resolvedAt,
    })
    .from(ptRequests)
    .innerJoin(ptSessions, eq(ptSessions.id, ptRequests.scheduledPtSessionId))
    .leftJoin(classTypes, eq(classTypes.id, ptRequests.classTypeId))
    .leftJoin(locations, eq(locations.id, ptSessions.locationId))
    .leftJoin(staffUsers, eq(staffUsers.id, ptSessions.instructorId))
    .where(
      and(
        eq(ptRequests.tenantId, tenantId),
        eq(ptRequests.clientId, clientId),
        eq(ptRequests.approvalUnseen, true),
        eq(ptRequests.status, 'scheduled'),
        eq(ptSessions.lifecycle, 'active'),
        gt(ptSessions.startsAt, now),
      ),
    )
    .orderBy(asc(ptSessions.startsAt))

  const corporate = await db
    .select({
      id: corporateRequests.id,
      packageName: corporatePackages.name,
      startsAt: corporateSessions.startsAt,
      endsAt: corporateSessions.endsAt,
      locationName: locations.name,
      locationAddress: locations.address,
      locationGmapsUrl: locations.gmapsUrl,
      // An off-site session has no studio Location: its venue is free text.
      locationText: corporateSessions.locationText,
      instructorName: staffUsers.name,
      approvedAt: corporateRequests.resolvedAt,
    })
    .from(corporateRequests)
    .innerJoin(corporateSessions, eq(corporateSessions.id, corporateRequests.scheduledCorporateSessionId))
    .innerJoin(corporatePackages, eq(corporatePackages.id, corporateRequests.corporatePackageId))
    .leftJoin(locations, eq(locations.id, corporateSessions.locationId))
    .leftJoin(staffUsers, eq(staffUsers.id, corporateSessions.mainInstructorId))
    .where(
      and(
        eq(corporateRequests.tenantId, tenantId),
        eq(corporateRequests.clientId, clientId),
        eq(corporateRequests.approvalUnseen, true),
        eq(corporateRequests.status, 'scheduled'),
        eq(corporateSessions.lifecycle, 'active'),
        gt(corporateSessions.startsAt, now),
      ),
    )
    .orderBy(asc(corporateSessions.startsAt))

  const out: UnseenApproval[] = [
    ...pt.map(r => ({
      kind: 'pt' as const,
      id: r.id,
      title: r.className ?? 'Private session',
      sessionType: r.sessionType,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      locationName: r.locationName,
      locationAddress: r.locationAddress,
      locationGmapsUrl: r.locationGmapsUrl,
      instructorName: r.instructorName,
      approvedAt: r.approvedAt,
    })),
    ...corporate.map(r => ({
      kind: 'corporate' as const,
      id: r.id,
      title: r.packageName,
      sessionType: null,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      locationName: r.locationName ?? r.locationText,
      locationAddress: r.locationName ? r.locationAddress : null,
      locationGmapsUrl: r.locationName ? r.locationGmapsUrl : null,
      instructorName: r.instructorName,
      approvedAt: r.approvedAt,
    })),
  ]
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
}

/**
 * The member has seen this approval. Idempotent, and a request that is not
 * theirs (or not at this studio) is simply not changed: there is nothing to
 * tell the caller that the list did not already.
 */
export async function markApprovalSeen(
  tenantId: string,
  clientId: string,
  kind: ApprovalKind,
  requestId: string,
): Promise<void> {
  if (kind === 'pt') {
    await db
      .update(ptRequests)
      .set({ approvalUnseen: false })
      .where(
        and(eq(ptRequests.tenantId, tenantId), eq(ptRequests.clientId, clientId), eq(ptRequests.id, requestId)),
      )
    return
  }
  await db
    .update(corporateRequests)
    .set({ approvalUnseen: false })
    .where(
      and(
        eq(corporateRequests.tenantId, tenantId),
        eq(corporateRequests.clientId, clientId),
        eq(corporateRequests.id, requestId),
      ),
    )
}
