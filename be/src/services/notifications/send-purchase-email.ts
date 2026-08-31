/**
 * Delivery for the purchase confirmations (§13) — the reads, the send, and the
 * swallow. The sentences themselves are composed in ./purchase-email.ts, which
 * stays pure.
 *
 * **Neither function can throw.** Both run AFTER the thing they announce is
 * committed, so nothing here may undo — or fail — that work. The templated send
 * already swallows SMTP faults, but it THROWS on an unknown template slug, and
 * thrown from the webhook after a committed grant that would take the provider's
 * retry down with it: the retry then finds the row, `created` is false, and the
 * email is lost permanently while the purchase looks fine. This swallow is what
 * makes the `created` flag safe. Failures are reported, never silent.
 */
import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { clients } from '../../db/schema/identity'
import { clientPackages, classPackages, ptPackages } from '../../db/schema/packages'
import { bookings } from '../../db/schema/bookings'
import { stripePayments } from '../../db/schema/ledger'
import { workshops, workshopDays, workshopTierDays } from '../../db/schema/schedule'
import { CLIENT_URL } from '../../env'
import { reportError } from '../../shared/logger'
import { sgFormat } from '../../lib/time'
import { composePurchaseEmail } from './purchase-email'
import { sendTemplatedEmail } from './send'

/** The page that lists what the member owns — where a free purchase points. */
const ACCOUNT_URL = `${CLIENT_URL}/account`
/** Where a workshop booking's QR code lives. */
const WORKSHOP_QR_URL = `${CLIENT_URL}/account/workshops`

const SG_DATETIME = sgFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/**
 * Confirm one granted package — a Credit Bundle, an Unlimited Plan, a PT
 * package or a trial pass. The slug is read off the granted row's kind, not off
 * the caller: a *priced* trial arrives here through the webhook and must still
 * get the trial email.
 *
 * A comp grant never calls this. A comp grant is not a purchase — "your
 * purchase is confirmed" is false, and an admin correcting a record must not
 * mail the member.
 */
export async function sendPackagePurchaseEmail(
  tenantId: string,
  clientPackageId: string,
): Promise<void> {
  try {
    const [row] = await db
      .select({
        kind: clientPackages.kind,
        creditsOrSessions: clientPackages.creditsOrSessionsRemaining,
        expiresAt: clientPackages.expiresAt,
        durationMonths: clientPackages.durationMonths,
        clientName: clients.name,
        clientEmail: clients.email,
        clientId: clients.id,
        classPackageName: classPackages.name,
        ptPackageName: ptPackages.name,
        receiptUrl: stripePayments.receiptUrl,
      })
      .from(clientPackages)
      .innerJoin(clients, eq(clients.id, clientPackages.clientId))
      .leftJoin(classPackages, eq(classPackages.id, clientPackages.sourceClassPackageId))
      .leftJoin(ptPackages, eq(ptPackages.id, clientPackages.sourcePtPackageId))
      .leftJoin(
        stripePayments,
        eq(stripePayments.paymentIntentId, clientPackages.stripePaymentIntentId),
      )
      .where(and(eq(clientPackages.tenantId, tenantId), eq(clientPackages.id, clientPackageId)))
      .limit(1)
    if (!row) throw new Error(`client_package_not_found:${clientPackageId}`)

    const { slug, variables } = composePurchaseEmail({
      kind: row.kind,
      clientName: row.clientName,
      packageName: row.classPackageName ?? row.ptPackageName ?? 'Your package',
      creditsOrSessions: row.creditsOrSessions,
      expiresAt: row.expiresAt,
      durationMonths: row.durationMonths,
      receiptUrl: row.receiptUrl,
      accountUrl: ACCOUNT_URL,
    })

    await sendTemplatedEmail({
      tenantId,
      slug,
      recipient: { email: row.clientEmail, userId: row.clientId, userKind: 'client' },
      variables,
    })
  } catch (err) {
    reportError(err, 'purchase confirmation email failed', {
      scope: 'purchase-email',
      tenantId,
      clientPackageId,
    })
  }
}

/**
 * Confirm one workshop booking, paid or free. The free path is the worst case
 * in the set — it produces a confirmed booking with a QR code and a date, and
 * used to send nothing at all.
 *
 * The workshop template's declared variables are unchanged, so this fills the
 * six it already has; `receipt_url` falls back to the account page the same way,
 * because an escaped empty value inside an href renders a link that goes nowhere.
 */
export async function sendWorkshopPurchaseEmail(
  tenantId: string,
  bookingId: string,
): Promise<void> {
  try {
    const [row] = await db
      .select({
        code: bookings.code,
        workshopTierId: bookings.workshopTierId,
        workshopName: workshops.name,
        clientName: clients.name,
        clientEmail: clients.email,
        clientId: clients.id,
        receiptUrl: stripePayments.receiptUrl,
      })
      .from(bookings)
      .innerJoin(clients, eq(clients.id, bookings.clientId))
      .innerJoin(workshops, eq(workshops.id, bookings.workshopId))
      .leftJoin(stripePayments, eq(stripePayments.paymentIntentId, bookings.stripePaymentIntentId))
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          eq(bookings.id, bookingId),
          eq(bookings.kind, 'workshop'),
        ),
      )
      .limit(1)
    if (!row) throw new Error(`workshop_booking_not_found:${bookingId}`)

    // The tier's first day is the date the member needs; the rest are on the
    // booking page the QR link points at.
    const [firstDay] = row.workshopTierId
      ? await db
          .select({ startsAt: workshopDays.startsAt })
          .from(workshopTierDays)
          .innerJoin(workshopDays, eq(workshopDays.id, workshopTierDays.workshopDayId))
          .where(
            and(
              eq(workshopTierDays.tenantId, tenantId),
              eq(workshopTierDays.workshopTierId, row.workshopTierId),
            ),
          )
          .orderBy(workshopDays.startsAt)
          .limit(1)
      : []

    await sendTemplatedEmail({
      tenantId,
      slug: 'workshop_purchase_confirmed',
      recipient: { email: row.clientEmail, userId: row.clientId, userKind: 'client' },
      variables: {
        client_name: row.clientName,
        workshop_name: row.workshopName,
        date: firstDay ? SG_DATETIME.format(firstDay.startsAt) : 'See your account for the date',
        qr_url: WORKSHOP_QR_URL,
        code: row.code,
        receipt_url: row.receiptUrl || ACCOUNT_URL,
      },
    })
  } catch (err) {
    reportError(err, 'workshop confirmation email failed', {
      scope: 'purchase-email',
      tenantId,
      bookingId,
    })
  }
}
