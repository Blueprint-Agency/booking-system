/**
 * Delivery for the emails a private session request sends over its life: it was
 * received (`pt_request_submitted`), staff scheduled it, which is the approval
 * (`pt_session_approved`), or it lapsed unanswered (`pt_request_expired`). Its
 * cancellation is `./send-booking-email.ts` (NTF-11), and a request is never
 * declined in the app, so there is no declined email.
 *
 * Like every send beside it, **nothing here can throw**: each runs AFTER the
 * write it announces has committed, so a failed read or send is reported
 * (shared/logger.ts) and goes no further.
 *
 * A request names no instructor — the studio assigns one when it schedules —
 * and proposes times instead of one start, so the copy's `instructor_name` and
 * `starts_at` are filled from that: the studio, and the times the member offered.
 */
import { and, asc, eq } from 'drizzle-orm'
import { db } from '../../db'
import { bookings } from '../../db/schema/bookings'
import { locations } from '../../db/schema/catalog'
import { clients, staffUsers } from '../../db/schema/identity'
import { ptRequests, ptRequestSlots, ptSessions } from '../../db/schema/schedule'
import { NotFoundError } from '../../shared/errors'
import { reportError } from '../../shared/logger'
import { proposedTimesLine, sessionsRefundLine } from './booking-email'
import { clientUrl, sessionTimeFormat } from './send-booking-email'
import { sendTemplatedEmail } from './send'

/** Who a request that has no instructor yet is addressed to. */
const THE_STUDIO = 'the studio'

/** The request's requester and the times they proposed, in one read. */
async function readRequest(tenantId: string, ptRequestId: string) {
  const [row] = await db
    .select({ clientId: clients.id, clientName: clients.name, clientEmail: clients.email })
    .from(ptRequests)
    .innerJoin(clients, and(eq(clients.tenantId, ptRequests.tenantId), eq(clients.id, ptRequests.clientId)))
    .where(and(eq(ptRequests.tenantId, tenantId), eq(ptRequests.id, ptRequestId)))
    .limit(1)
  if (!row) throw new NotFoundError('pt_request_not_found', { ptRequestId })
  const slots = await db
    .select({ proposedDate: ptRequestSlots.proposedDate, startTime: ptRequestSlots.startTime })
    .from(ptRequestSlots)
    .where(and(eq(ptRequestSlots.tenantId, tenantId), eq(ptRequestSlots.ptRequestId, ptRequestId)))
  return { ...row, proposed: proposedTimesLine(slots) }
}

/**
 * The member submitted a request: the requester, and only them, is told it was
 * received. A 2-on-1 partner has not been asked yet and may have no account.
 */
export async function sendPtRequestSubmittedEmail(tenantId: string, ptRequestId: string): Promise<void> {
  try {
    const req = await readRequest(tenantId, ptRequestId)
    await sendTemplatedEmail({
      tenantId,
      slug: 'pt_request_submitted',
      recipient: { email: req.clientEmail, userId: req.clientId, userKind: 'client' },
      variables: { client_name: req.clientName, instructor_name: THE_STUDIO, starts_at: req.proposed },
    })
  } catch (err) {
    reportError(err, 'private session request email failed', { scope: 'pt-request-email', tenantId, ptRequestId })
  }
}

/**
 * Staff scheduled a request into a session — its approval. Every member the
 * session booked is told it is confirmed, with its instructor, place and time:
 * the requester and a 2-on-1 partner, who holds a seat of their own.
 */
export async function sendPtSessionApprovedEmail(tenantId: string, ptSessionId: string): Promise<void> {
  try {
    const [session] = await db
      .select({ startsAt: ptSessions.startsAt, instructorName: staffUsers.name, locationName: locations.name })
      .from(ptSessions)
      .innerJoin(staffUsers, eq(staffUsers.id, ptSessions.instructorId))
      .innerJoin(locations, eq(locations.id, ptSessions.locationId))
      .where(and(eq(ptSessions.tenantId, tenantId), eq(ptSessions.id, ptSessionId)))
      .limit(1)
    if (!session) throw new NotFoundError('pt_session_not_found', { ptSessionId })
    const attendees = await db
      .select({ id: clients.id, name: clients.name, email: clients.email })
      .from(bookings)
      .innerJoin(clients, and(eq(clients.tenantId, bookings.tenantId), eq(clients.id, bookings.clientId)))
      .where(and(eq(bookings.tenantId, tenantId), eq(bookings.ptSessionId, ptSessionId), eq(bookings.state, 'confirmed')))
      .orderBy(asc(bookings.bookedAt), asc(bookings.id))
    const startsAt = (await sessionTimeFormat(tenantId)).format(session.startsAt)
    const bookingsUrl = await clientUrl(tenantId, '/account/bookings?type=pt')
    for (const who of attendees) {
      try {
        await sendTemplatedEmail({
          tenantId,
          slug: 'pt_session_approved',
          recipient: { email: who.email, userId: who.id, userKind: 'client' },
          variables: {
            client_name: who.name,
            instructor_name: session.instructorName || 'your instructor',
            starts_at: startsAt,
            location: session.locationName,
            qr_url: bookingsUrl,
          },
        })
      } catch (err) {
        reportError(err, 'private session request email failed', { scope: 'pt-request-email', tenantId, ptSessionId, clientId: who.id })
      }
    }
  } catch (err) {
    reportError(err, 'private session request email failed', { scope: 'pt-request-email', tenantId, ptSessionId })
  }
}

/** A pending request that lapsed, and the sessions its package took back. */
export interface PtRequestExpiredNotice {
  ptRequestId: string
  /** Zero where no package took any back: a Voided one, or a request that debited none. */
  sessionsReturned: number
}

/**
 * Pending requests lapsed unanswered: each requester is told, with the times they
 * had proposed and, only when its package took them back, the sessions returned.
 * One request's failure does not stop the rest.
 */
export async function sendPtRequestExpiredEmails(tenantId: string, notices: readonly PtRequestExpiredNotice[]): Promise<void> {
  for (const { ptRequestId, sessionsReturned } of notices) {
    try {
      const req = await readRequest(tenantId, ptRequestId)
      await sendTemplatedEmail({
        tenantId,
        slug: 'pt_request_expired',
        recipient: { email: req.clientEmail, userId: req.clientId, userKind: 'client' },
        variables: {
          client_name: req.clientName,
          instructor_name: THE_STUDIO,
          starts_at: req.proposed,
          refund_line: sessionsRefundLine(sessionsReturned),
        },
      })
    } catch (err) {
      reportError(err, 'private session request email failed', { scope: 'pt-request-email', tenantId, ptRequestId })
    }
  }
}
