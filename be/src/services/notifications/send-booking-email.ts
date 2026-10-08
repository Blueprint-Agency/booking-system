/**
 * Delivery for the booking and cancellation emails (#359: NTF-08..11) — the
 * reads, the send and the swallow. The sentences are composed in
 * ./booking-email.ts, which stays pure.
 *
 * **Nothing here can throw.** Every function runs AFTER the booking or the
 * cancellation it announces has committed, so nothing here may undo — or fail
 * — that work. `sendTemplatedEmail` already records an SMTP fault as a failed
 * `email_log` row, but it throws on a missing template row, and the reads
 * before it can fail too; each is reported (shared/logger.ts) rather than
 * thrown, so a swallowed email is never a silent one.
 */
import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { bookings } from '../../db/schema/bookings'
import { classes, ptSessions, workshops } from '../../db/schema/schedule'
import { purchases } from '../../db/schema/ledger'
import { toCents, toSgd } from '../../shared/money'
import { amountPaid } from './purchase-email'
import { classTypes, locations } from '../../db/schema/catalog'
import { clients, staffUsers } from '../../db/schema/identity'
import { classPackages, clientPackages } from '../../db/schema/packages'
import { loadTenantById } from '../tenants/tenants'
import { requireTenantUrl } from '../tenants/urls'
import { reportError } from '../../shared/logger'
import { NotFoundError } from '../../shared/errors'
import { bookingCreditsLine, classRefundLine, privateSessionLine, sessionsRefundLine } from './booking-email'
import { sendTemplatedEmail } from './send'
import type { PurchasedKind } from './purchase-email'

/**
 * "Thu, 8 Oct 2026, 9:00 am" in the studio's own zone — how a session's time
 * reads in every email about it: the booking and cancellation emails here, and
 * the check-in nag (../bookings/check-in-nag.ts).
 */
export async function sessionTimeFormat(tenantId: string): Promise<Intl.DateTimeFormat> {
  const tenant = await loadTenantById(tenantId)
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tenant?.timezone ?? 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/** The member's own studio's app, per send — never a platform-wide origin. */
const clientUrl = (tenantId: string, path: string) => requireTenantUrl('client', tenantId).then(base => `${base}${path}`)

/** A package as the member reads it: its catalogue name, or its kind when it has none. */
const KIND_NAME: Record<PurchasedKind, string> = {
  credit_bundle: 'your credit bundle',
  unlimited: 'your Unlimited Plan',
  trial: 'your trial pass',
  pt: 'your PT package',
}

/**
 * NTF-08: confirm a class booking to the member — the class, its time, place
 * and instructor, the check-in code, and what it cost the package that paid.
 */
export async function sendClassBookingEmail(tenantId: string, bookingId: string): Promise<void> {
  try {
    const [row] = await db
      .select({
        code: bookings.code,
        used: bookings.creditsOrSessionsUsed,
        clientId: clients.id,
        clientName: clients.name,
        clientEmail: clients.email,
        className: classTypes.name,
        startsAt: classes.startsAt,
        locationName: locations.name,
        instructorName: staffUsers.name,
        kind: clientPackages.kind,
        remaining: clientPackages.creditsOrSessionsRemaining,
        packageName: classPackages.name,
      })
      .from(bookings)
      .innerJoin(clients, and(eq(clients.tenantId, bookings.tenantId), eq(clients.id, bookings.clientId)))
      .innerJoin(classes, and(eq(classes.tenantId, bookings.tenantId), eq(classes.id, bookings.classId)))
      .innerJoin(classTypes, eq(classTypes.id, classes.classTypeId))
      .innerJoin(locations, eq(locations.id, classes.locationId))
      .innerJoin(staffUsers, eq(staffUsers.id, classes.mainInstructorId))
      .leftJoin(clientPackages, eq(clientPackages.id, bookings.clientPackageId))
      .leftJoin(classPackages, eq(classPackages.id, clientPackages.sourceClassPackageId))
      .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId), eq(bookings.kind, 'class')))
      .limit(1)
    if (!row) throw new NotFoundError('booking_not_found', { bookingId })

    const kind = (row.kind ?? 'credit_bundle') as PurchasedKind
    const used = row.used ?? 0
    const date = (await sessionTimeFormat(tenantId)).format(row.startsAt)
    await sendTemplatedEmail({
      tenantId,
      slug: 'class_booking_confirmed',
      recipient: { email: row.clientEmail, userId: row.clientId, userKind: 'client' },
      variables: {
        client_name: row.clientName,
        class_name: row.className,
        date,
        instructor_name: row.instructorName || 'your instructor',
        location: row.locationName,
        qr_url: await clientUrl(tenantId, '/account/bookings?type=class'),
        code: row.code,
        credits_line: bookingCreditsLine({
          kind,
          packageName: row.packageName ?? KIND_NAME[kind],
          used,
          remaining: kind === 'unlimited' ? null : row.remaining,
        }),
        // Read by a studio's own wording written before `credits_line`
        // existed; harmless to the default, which does not use them.
        credits_used: String(used),
        credits_remaining: kind === 'unlimited' ? 'Unlimited' : String(row.remaining ?? 0),
      },
    })
  } catch (err) {
    reportError(err, 'booking confirmation email failed', { scope: 'booking-email', tenantId, bookingId })
  }
}

/** A cancelled booking's class or private session, as its cancellation emails name it. */
async function readCancelledBooking(tenantId: string, bookingId: string) {
  const [row] = await db
    .select({
      kind: bookings.kind,
      used: bookings.creditsOrSessionsUsed,
      clientId: clients.id,
      clientName: clients.name,
      clientEmail: clients.email,
      className: classTypes.name,
      classStartsAt: classes.startsAt,
      ptStartsAt: ptSessions.startsAt,
      ptInstructorName: staffUsers.name,
    })
    .from(bookings)
    .innerJoin(clients, and(eq(clients.tenantId, bookings.tenantId), eq(clients.id, bookings.clientId)))
    .leftJoin(classes, eq(classes.id, bookings.classId))
    .leftJoin(classTypes, eq(classTypes.id, classes.classTypeId))
    .leftJoin(ptSessions, eq(ptSessions.id, bookings.ptSessionId))
    .leftJoin(staffUsers, eq(staffUsers.id, ptSessions.instructorId))
    .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId)))
    .limit(1)
  if (!row) throw new NotFoundError('booking_not_found', { bookingId })
  return row
}

/**
 * NTF-09: a member cancelled in time, and what the booking used came back —
 * `class_cancelled_credit_returned` for a class, `pt_cancelled_session_returned`
 * for a private session. The caller sends it only when the refund fired.
 */
export async function sendMemberCancelReturnedEmail(tenantId: string, bookingId: string): Promise<void> {
  try {
    const row = await readCancelledBooking(tenantId, bookingId)
    const when = await sessionTimeFormat(tenantId)
    const returned = String(row.used ?? 0)
    const recipient = { email: row.clientEmail, userId: row.clientId, userKind: 'client' as const }
    if (row.kind === 'class') {
      await sendTemplatedEmail({
        tenantId,
        slug: 'class_cancelled_credit_returned',
        recipient,
        variables: {
          client_name: row.clientName,
          class_name: row.className ?? 'Your class',
          date: row.classStartsAt ? when.format(row.classStartsAt) : '',
          credits_returned: returned,
          refund_line: classRefundLine(row.used ?? 0),
          classes_url: await clientUrl(tenantId, '/classes'),
        },
      })
    } else if (row.kind === 'pt') {
      await sendTemplatedEmail({
        tenantId,
        slug: 'pt_cancelled_session_returned',
        recipient,
        variables: {
          client_name: row.clientName,
          instructor_name: row.ptInstructorName || 'your instructor',
          starts_at: row.ptStartsAt ? when.format(row.ptStartsAt) : '',
          sessions_returned: returned,
          refund_line: sessionsRefundLine(row.used ?? 0),
          account_url: await clientUrl(tenantId, '/account/private-sessions'),
        },
      })
    }
  } catch (err) {
    reportError(err, 'cancellation email failed', { scope: 'booking-email', tenantId, bookingId })
  }
}

/** One member's booking a studio cancelled, and what came back to their package. */
export interface StudioCancelNotice {
  bookingId: string
  /** Credits (a class) or sessions (a private session) returned; 0 when nothing was. */
  returned: number
}

/**
 * NTF-10: the studio cancelled a class — every member booked on it is told,
 * with the credits returned (`admin_cancel_class`). One send per booking; one
 * member's failure does not stop the rest.
 */
export async function sendClassCancelledByStudioEmails(tenantId: string, notices: readonly StudioCancelNotice[]): Promise<void> {
  for (const n of notices) {
    try {
      const row = await readCancelledBooking(tenantId, n.bookingId)
      const when = await sessionTimeFormat(tenantId)
      await sendTemplatedEmail({
        tenantId,
        slug: 'admin_cancel_class',
        recipient: { email: row.clientEmail, userId: row.clientId, userKind: 'client' },
        variables: {
          client_name: row.clientName,
          class_name: row.className ?? 'Your class',
          date: row.classStartsAt ? when.format(row.classStartsAt) : '',
          refund_line: classRefundLine(n.returned),
          classes_url: await clientUrl(tenantId, '/classes'),
          credits_returned: String(n.returned),
        },
      })
    } catch (err) {
      reportError(err, 'cancellation email failed', { scope: 'booking-email', tenantId, bookingId: n.bookingId })
    }
  }
}

/**
 * NTF-10: the studio cancelled a private session — every member on it is told,
 * with the sessions returned to their own package (`admin_cancel_pt`).
 */
export async function sendPtCancelledByStudioEmails(tenantId: string, notices: readonly StudioCancelNotice[]): Promise<void> {
  for (const n of notices) {
    try {
      const row = await readCancelledBooking(tenantId, n.bookingId)
      const when = await sessionTimeFormat(tenantId)
      await sendTemplatedEmail({
        tenantId,
        slug: 'admin_cancel_pt',
        recipient: { email: row.clientEmail, userId: row.clientId, userKind: 'client' },
        variables: {
          client_name: row.clientName,
          instructor_name: row.ptInstructorName || 'your instructor',
          starts_at: row.ptStartsAt ? when.format(row.ptStartsAt) : '',
          refund_line: sessionsRefundLine(n.returned),
          account_url: await clientUrl(tenantId, '/account/private-sessions'),
        },
      })
    } catch (err) {
      reportError(err, 'cancellation email failed', { scope: 'booking-email', tenantId, bookingId: n.bookingId })
    }
  }
}

/**
 * The emails a private-session cancel owes, gathered inside its transaction
 * (services/pt-sessions/cancel.ts) and sent by `sendPtCancelMail` once it has
 * committed — so a rolled-back cancel mails nobody.
 */
export interface PtCancelMail {
  /** NTF-10: staff cancelled a manual session — each seat, and the sessions it got back. */
  studio: StudioCancelNotice[]
  /** NTF-09: a member cancelled their own seat in time and got its session back. */
  memberReturned: string[]
  /** NTF-11: a PT Request was cancelled — each member it booked, and what they got back. */
  request: PtRequestCancelNotice[]
}

export interface PtRequestCancelNotice {
  clientId: string
  sessionsReturned: number
  /** The scheduled session; null for a request cancelled before it was scheduled. */
  ptSessionId: string | null
}

export const emptyPtCancelMail = (): PtCancelMail => ({ studio: [], memberReturned: [], request: [] })

/** Send what a private-session cancel gathered. Never throws. */
export async function sendPtCancelMail(tenantId: string, mail: PtCancelMail): Promise<void> {
  await sendPtCancelledByStudioEmails(tenantId, mail.studio)
  for (const bookingId of mail.memberReturned) await sendMemberCancelReturnedEmail(tenantId, bookingId)
  await sendPtRequestCancelledEmails(tenantId, mail.request)
}

/**
 * NTF-11: a PT Request was cancelled, before or after it was scheduled, by the
 * member or by staff (admin-restructure §9e). One email for both paths
 * (`pt_request_cancelled`); the refund line is there only when sessions came
 * back — a 2-on-1 partner, who paid nothing, gets none.
 */
async function sendPtRequestCancelledEmails(tenantId: string, notices: readonly PtRequestCancelNotice[]): Promise<void> {
  for (const n of notices) {
    try {
      const [client] = await db
        .select({ name: clients.name, email: clients.email })
        .from(clients)
        .where(and(eq(clients.tenantId, tenantId), eq(clients.id, n.clientId)))
        .limit(1)
      if (!client) throw new NotFoundError('client_not_found', { clientId: n.clientId })
      const [session] = n.ptSessionId
        ? await db
            .select({ startsAt: ptSessions.startsAt, instructorName: staffUsers.name })
            .from(ptSessions)
            .innerJoin(staffUsers, eq(staffUsers.id, ptSessions.instructorId))
            .where(and(eq(ptSessions.tenantId, tenantId), eq(ptSessions.id, n.ptSessionId)))
            .limit(1)
        : []
      const when = await sessionTimeFormat(tenantId)
      await sendTemplatedEmail({
        tenantId,
        slug: 'pt_request_cancelled',
        recipient: { email: client.email, userId: n.clientId, userKind: 'client' },
        variables: {
          client_name: client.name,
          session_line: privateSessionLine(
            session ? { instructorName: session.instructorName || 'your instructor', startsAt: when.format(session.startsAt) } : null,
          ),
          refund_line: sessionsRefundLine(n.sessionsReturned),
          account_url: await clientUrl(tenantId, '/account/private-sessions'),
        },
      })
    } catch (err) {
      reportError(err, 'cancellation email failed', { scope: 'booking-email', tenantId, clientId: n.clientId })
    }
  }
}

/**
 * NTF-10: the studio cancelled a workshop — every attendee is told, with what
 * they paid (`admin_cancel_workshop`). Nobody is refunded automatically (#272):
 * the studio refunds each place by hand, so the email states the amount paid
 * and that the refund is being arranged, not that it has happened.
 */
export async function sendWorkshopCancelledEmails(tenantId: string, bookingIds: readonly string[]): Promise<void> {
  for (const bookingId of bookingIds) {
    try {
      const [row] = await db
        .select({
          clientId: clients.id,
          clientName: clients.name,
          clientEmail: clients.email,
          workshopName: workshops.name,
          purchasePaidSgd: purchases.amountPaidSgd,
          bookingPaidSgd: bookings.amountPaidSgd,
        })
        .from(bookings)
        .innerJoin(clients, and(eq(clients.tenantId, bookings.tenantId), eq(clients.id, bookings.clientId)))
        .innerJoin(workshops, eq(workshops.id, bookings.workshopId))
        .leftJoin(purchases, eq(purchases.id, bookings.purchaseId))
        .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId), eq(bookings.kind, 'workshop')))
        .limit(1)
      if (!row) throw new NotFoundError('workshop_booking_not_found', { bookingId })
      // The sale's figure, as the purchase confirmation states it (#370).
      const paid = row.purchasePaidSgd ?? row.bookingPaidSgd ?? '0.00'
      await sendTemplatedEmail({
        tenantId,
        slug: 'admin_cancel_workshop',
        recipient: { email: row.clientEmail, userId: row.clientId, userKind: 'client' },
        variables: {
          client_name: row.clientName,
          workshop_name: row.workshopName,
          amount_paid: amountPaid(paid),
          workshops_url: await clientUrl(tenantId, '/workshops'),
          refund_sgd: toSgd(toCents(paid)),
        },
      })
    } catch (err) {
      reportError(err, 'cancellation email failed', { scope: 'booking-email', tenantId, bookingId })
    }
  }
}
