/**
 * Corporate request flow (mirrors the PT request flow, simpler).
 *
 * A member buys a corporate package in fe-client → submitCorporateRequest() is
 * called from the Stripe webhook to auto-create ONE pending corporate_requests
 * row. Admin negotiates the details over WhatsApp, then scheduleCorporateRequest()
 * mints a corporate_session (reusing the existing services/corporate/sessions.ts)
 * and flips the request to 'scheduled' — the implicit approval. markAttended /
 * cancel close it out. There is no slot/class-type/partner concept (unlike PT).
 *
 * See docs/md/be-client.md §Corporate and docs/md/be-portal.md §Corporate.
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { corporateRequests, corporateSessions } from '../../db/schema/schedule'
import { corporatePackages } from '../../db/schema/packages'
import { clients, staffUsers } from '../../db/schema/identity'
import { locations } from '../../db/schema/catalog'
import {
  cancelCorporateSession,
  createCorporateSession,
  type CorporateSessionError,
} from './sessions'
import { BadRequestError, NotFoundError } from '../../shared/errors'

export type CorporateRequestRow = typeof corporateRequests.$inferSelect
export type CorporateRequestStatus = CorporateRequestRow['status']

export interface CorporateRequestSessionDetail {
  id: string
  startsAt: Date
  endsAt: Date
  locationName: string | null
  instructorName: string | null
}

export interface HydratedCorporateRequest {
  id: string
  status: CorporateRequestStatus
  preferredLocation: string | null
  message: string | null
  createdAt: Date
  resolvedAt: Date | null
  client: { id: string; name: string; email: string }
  package: { id: string; name: string }
  /** Populated once the request has been scheduled (else null). */
  session: CorporateRequestSessionDetail | null
}

// ----------------------------------------------------------------------------
// Create (auto, on purchase)
// ----------------------------------------------------------------------------

export interface SubmitCorporateRequestInput {
  clientId: string
  corporatePackageId: string
  /** Preferred location captured by the fe-client request form (optional). */
  preferredLocation?: string | null
  /** Free-text notes captured by the fe-client request form (optional). */
  message?: string | null
}

/**
 * Create one pending corporate request from the fe-client request form. Corporate is
 * a free request/quote flow in v1 — NOT a Stripe-paid item — so this is called
 * directly from `POST /me/catalog/corporate-requests`, not from a webhook. No slots,
 * no negotiation captured here — that all happens over WhatsApp. The member's preferred
 * location and free-text notes (from the request form) are stored as separate fields.
 *
 * NOTE: the `corporate_package` value in the stripePaymentKind enum is currently unused
 * (corporate is unpaid); it is left in place to avoid a destructive enum migration.
 */
export async function submitCorporateRequest(
  tenantId: string,
  input: SubmitCorporateRequestInput,
): Promise<{ corporateRequestId: string }> {
  const [pkg] = await db
    .select({ id: corporatePackages.id, status: corporatePackages.status })
    .from(corporatePackages)
    .where(
      and(
        eq(corporatePackages.tenantId, tenantId),
        eq(corporatePackages.id, input.corporatePackageId),
        isNull(corporatePackages.deletedAt),
      ),
    )
    .limit(1)
  if (!pkg) throw new NotFoundError('corporate_package_not_found')
  if (pkg.status !== 'active') throw new BadRequestError('corporate_package_not_active')

  const [row] = await db
    .insert(corporateRequests)
    .values({
      tenantId,
      clientId: input.clientId,
      corporatePackageId: input.corporatePackageId,
      preferredLocation: input.preferredLocation ?? null,
      message: input.message ?? null,
      status: 'pending',
    })
    .returning({ id: corporateRequests.id })
  return { corporateRequestId: row!.id }
}

// ----------------------------------------------------------------------------
// Read (hydrated)
// ----------------------------------------------------------------------------

function hydratedSelect() {
  return db
    .select({
      id: corporateRequests.id,
      status: corporateRequests.status,
      preferredLocation: corporateRequests.preferredLocation,
      message: corporateRequests.message,
      createdAt: corporateRequests.createdAt,
      resolvedAt: corporateRequests.resolvedAt,
      clientId: clients.id,
      clientName: clients.name,
      clientEmail: clients.email,
      packageId: corporatePackages.id,
      packageName: corporatePackages.name,
      sessionId: corporateSessions.id,
      sessionStartsAt: corporateSessions.startsAt,
      sessionEndsAt: corporateSessions.endsAt,
      sessionLifecycle: corporateSessions.lifecycle,
      locationName: locations.name,
      locationText: corporateSessions.locationText,
      instructorName: staffUsers.name,
    })
    .from(corporateRequests)
    .innerJoin(clients, eq(clients.id, corporateRequests.clientId))
    .innerJoin(corporatePackages, eq(corporatePackages.id, corporateRequests.corporatePackageId))
    .leftJoin(
      corporateSessions,
      eq(corporateSessions.id, corporateRequests.scheduledCorporateSessionId),
    )
    .leftJoin(locations, eq(locations.id, corporateSessions.locationId))
    // main_instructor_id references instructors.staff_user_id, which IS staff_users.id.
    .leftJoin(staffUsers, eq(staffUsers.id, corporateSessions.mainInstructorId))
}

type HydratedRow = Awaited<ReturnType<ReturnType<typeof hydratedSelect>['where']>>[number]

function mapRow(r: HydratedRow): HydratedCorporateRequest {
  return {
    id: r.id,
    status: r.status,
    preferredLocation: r.preferredLocation,
    message: r.message,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
    client: { id: r.clientId, name: r.clientName, email: r.clientEmail },
    package: { id: r.packageId, name: r.packageName },
    session: r.sessionId
      ? {
          id: r.sessionId,
          startsAt: r.sessionStartsAt!,
          endsAt: r.sessionEndsAt!,
          // Off-site sessions have no studio location row — fall back to the venue text.
          locationName: r.locationName ?? r.locationText,
          instructorName: r.instructorName,
        }
      : null,
  }
}

/** Admin queue. Optional status filter; newest first. */
export async function listCorporateRequests(
  tenantId: string,
  opts: { status?: CorporateRequestStatus } = {},
): Promise<HydratedCorporateRequest[]> {
  const rows = await hydratedSelect()
    .where(
      and(
        eq(corporateRequests.tenantId, tenantId),
        ...(opts.status ? [eq(corporateRequests.status, opts.status)] : []),
      ),
    )
    .orderBy(desc(corporateRequests.createdAt))
  return rows.map(mapRow)
}

export async function getCorporateRequest(
  tenantId: string,
  id: string,
): Promise<HydratedCorporateRequest | null> {
  const rows = await hydratedSelect()
    .where(and(eq(corporateRequests.tenantId, tenantId), eq(corporateRequests.id, id)))
    .limit(1)
  return rows[0] ? mapRow(rows[0]) : null
}

/** A single client's own requests (fe-client account page). */
export async function listCorporateRequestsForClient(
  tenantId: string,
  clientId: string,
): Promise<HydratedCorporateRequest[]> {
  const rows = await hydratedSelect()
    .where(
      and(eq(corporateRequests.tenantId, tenantId), eq(corporateRequests.clientId, clientId)),
    )
    .orderBy(desc(corporateRequests.createdAt))
  return rows.map(mapRow)
}

// ----------------------------------------------------------------------------
// Schedule (admin — the implicit approval)
// ----------------------------------------------------------------------------

export interface ScheduleCorporateRequestInput {
  corporateRequestId: string
  mainInstructorId: string
  supportingInstructorIds: string[]
  // Either a studio location (locationId, optional roomId) OR a free-text off-site
  // venue (locationText). Room is optional even for a studio location.
  locationId?: string | null
  locationText?: string | null
  roomId?: string | null
  startsAt: Date
  endsAt: Date
  actorStaffId: string
}

export type ScheduleCorporateRequestError =
  | CorporateSessionError
  | 'request_not_found'
  | 'not_pending'

export type ScheduleCorporateRequestResult =
  | { ok: true; corporateSessionId: string }
  | { ok: false; error: ScheduleCorporateRequestError }

/**
 * Schedule a pending corporate request. Reuses createCorporateSession() (which
 * runs all room/instructor/package validation), then links the session back to
 * the request and flips it to 'scheduled'. The client_name on the session is
 * derived from the member record — no longer a freeform admin entry.
 */
export async function scheduleCorporateRequest(
  tenantId: string,
  input: ScheduleCorporateRequestInput,
): Promise<ScheduleCorporateRequestResult> {
  const [req] = await db
    .select()
    .from(corporateRequests)
    .where(
      and(
        eq(corporateRequests.tenantId, tenantId),
        eq(corporateRequests.id, input.corporateRequestId),
      ),
    )
    .limit(1)
  if (!req) return { ok: false, error: 'request_not_found' }
  if (req.status !== 'pending') return { ok: false, error: 'not_pending' }

  const [client] = await db
    .select({ name: clients.name })
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), eq(clients.id, req.clientId)))
    .limit(1)
  if (!client) return { ok: false, error: 'request_not_found' }

  const result = await createCorporateSession(tenantId, {
    corporatePackageId: req.corporatePackageId,
    clientName: client.name,
    mainInstructorId: input.mainInstructorId,
    supportingInstructorIds: input.supportingInstructorIds,
    locationId: input.locationId,
    locationText: input.locationText,
    roomId: input.roomId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    createdByStaffId: input.actorStaffId,
  })
  if (!result.ok) return result

  const sessionId = result.session.id
  // Link + flip atomically. Both rows already exist, so the deferred circular FKs
  // are satisfied; the transaction just keeps the two writes consistent.
  await db.transaction(async tx => {
    await tx
      .update(corporateSessions)
      .set({ corporateRequestId: req.id })
      .where(and(eq(corporateSessions.tenantId, tenantId), eq(corporateSessions.id, sessionId)))
    await tx
      .update(corporateRequests)
      .set({
        status: 'scheduled',
        scheduledCorporateSessionId: sessionId,
        resolvedAt: new Date(),
        resolvedByStaffId: input.actorStaffId,
      })
      .where(and(eq(corporateRequests.tenantId, tenantId), eq(corporateRequests.id, req.id)))
  })

  return { ok: true, corporateSessionId: sessionId }
}

// ----------------------------------------------------------------------------
// Cancel / attended
// ----------------------------------------------------------------------------

/**
 * Cancel a corporate request. Pending → just mark cancelled. Scheduled → also
 * cancel the linked corporate_session. Terminal states are a no-op (idempotent).
 */
export async function cancelCorporateRequest(
  tenantId: string,
  id: string,
  actorStaffId: string,
): Promise<CorporateRequestRow | null> {
  const [req] = await db
    .select()
    .from(corporateRequests)
    .where(and(eq(corporateRequests.tenantId, tenantId), eq(corporateRequests.id, id)))
    .limit(1)
  if (!req) return null
  if (req.status === 'cancelled' || req.status === 'attended') return req

  if (req.status === 'scheduled' && req.scheduledCorporateSessionId) {
    await cancelCorporateSession(tenantId, req.scheduledCorporateSessionId, actorStaffId)
  }

  const [row] = await db
    .update(corporateRequests)
    .set({ status: 'cancelled', resolvedAt: new Date(), resolvedByStaffId: actorStaffId })
    .where(and(eq(corporateRequests.tenantId, tenantId), eq(corporateRequests.id, id)))
    .returning()
  return row ?? null
}

/** Mark a scheduled corporate request as delivered. */
export async function markCorporateRequestAttended(
  tenantId: string,
  id: string,
  actorStaffId: string,
): Promise<CorporateRequestRow | null> {
  const [req] = await db
    .select()
    .from(corporateRequests)
    .where(and(eq(corporateRequests.tenantId, tenantId), eq(corporateRequests.id, id)))
    .limit(1)
  if (!req) return null
  if (req.status !== 'scheduled') {
    throw new BadRequestError('corporate_request_not_scheduled')
  }

  const [row] = await db
    .update(corporateRequests)
    .set({ status: 'attended', resolvedAt: new Date(), resolvedByStaffId: actorStaffId })
    .where(and(eq(corporateRequests.tenantId, tenantId), eq(corporateRequests.id, id)))
    .returning()
  return row ?? null
}
