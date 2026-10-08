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
import { clients, staffUsers } from '../../db/schema/identity'
import { clientPackages, classPackages, corporatePackages, ptPackages } from '../../db/schema/packages'
import { bookings } from '../../db/schema/bookings'
import { purchases, stripePayments } from '../../db/schema/ledger'
import { toCents, toSgd } from '../../shared/money'
import { corporateRequests, workshops, workshopDays, workshopTierDays } from '../../db/schema/schedule'
import { requireTenantUrl } from '../tenants/urls'
import { reportError } from '../../shared/logger'
import { NotFoundError } from '../../shared/errors'
import { sgFormat } from '../../lib/time'
import { amountPaid, composePurchaseEmail } from './purchase-email'
import { sendTemplatedEmail } from './send'

/**
 * The member's own studio's app, per send.
 *
 * Both pages used to be module constants built from the one platform-wide
 * `CLIENT_URL`, so a member of the second studio was sent to the first studio's
 * account page — a hostname they cannot sign into — to see the purchase they
 * had just made. The origin is the buying studio's own, derived from its slug.
 *
 * Both callers already run inside a `try` that reports and swallows, because
 * neither may fail the committed purchase it announces; a studio whose origin
 * cannot be built therefore loses the email and gains a report, rather than
 * mailing a link into somebody else's studio.
 */

/** The page that lists what the member owns — where a free purchase points. */
const accountUrlFor = (tenantId: string) =>
  requireTenantUrl('client', tenantId).then(base => `${base}/account`)
/** Where a workshop booking's QR code lives. */
const workshopQrUrlFor = (tenantId: string) =>
  requireTenantUrl('client', tenantId).then(base => `${base}/account/workshops`)
/** Where a member's Corporate Requests are listed. */
const corporateRequestsUrlFor = (tenantId: string) =>
  requireTenantUrl('client', tenantId).then(base => `${base}/account/bookings?type=corporate`)

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
        validityDays: clientPackages.validityDays,
        clientName: clients.name,
        clientEmail: clients.email,
        clientId: clients.id,
        classPackageName: classPackages.name,
        ptPackageName: ptPackages.name,
        boundInstructorName: staffUsers.name,
        receiptUrl: stripePayments.receiptUrl,
        purchasePaidSgd: purchases.amountPaidSgd,
        packagePaidSgd: clientPackages.amountPaidSgd,
        crossLocationPaidSgd: clientPackages.crossLocationPaidSgd,
      })
      .from(clientPackages)
      .innerJoin(clients, eq(clients.id, clientPackages.clientId))
      // The Bound Instructor a PT package's sessions are with (#109). Left, and
      // null on every open package and every other kind.
      .leftJoin(staffUsers, eq(staffUsers.id, clientPackages.boundInstructorId))
      .leftJoin(classPackages, eq(classPackages.id, clientPackages.sourceClassPackageId))
      .leftJoin(ptPackages, eq(ptPackages.id, clientPackages.sourcePtPackageId))
      // Through the sale, not the intent (#92). One payment per Purchase today,
      // so this picks the same row it always did.
      .leftJoin(stripePayments, eq(stripePayments.purchaseId, clientPackages.purchaseId))
      .leftJoin(purchases, eq(purchases.id, clientPackages.purchaseId))
      .where(and(eq(clientPackages.tenantId, tenantId), eq(clientPackages.id, clientPackageId)))
      .limit(1)
    if (!row) throw new NotFoundError('client_package_not_found', { clientPackageId })

    const { slug, variables } = composePurchaseEmail({
      kind: row.kind,
      clientName: row.clientName,
      packageName: row.classPackageName ?? row.ptPackageName ?? 'Your package',
      creditsOrSessions: row.creditsOrSessions,
      expiresAt: row.expiresAt,
      durationMonths: row.durationMonths,
      validityDays: row.validityDays,
      boundInstructorName: row.boundInstructorName,
      // The sale's own figure (#370): what the Purchase collected, which is
      // the plan and any Cross-Location Add-On bought with it. A free purchase
      // is granted with no Purchase on the package, and the package records
      // what it cost — zero.
      amountPaidSgd:
        row.purchasePaidSgd ??
        toSgd(toCents(row.packagePaidSgd) + toCents(row.crossLocationPaidSgd ?? 0)),
      receiptUrl: row.receiptUrl,
      accountUrl: await accountUrlFor(tenantId),
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
 * Confirm a paid corporate package (be-client § Corporate branch, step 5): the
 * package, what was paid for it, and that the studio now arranges the session.
 * No credits, so none of the package confirmation's sentences apply.
 *
 * Called once the delivery that made the Corporate Request has committed, so
 * the payment row it reads already carries the receipt, and a delivery that
 * rolled back never mailed anyone.
 *
 * A package with nothing to pay (`paymentIntentId` null) is confirmed the same
 * way, from the zero-total Purchase the request names: no payment, so no
 * receipt, and the link is to where the request is.
 */
export async function sendCorporatePurchaseEmail(
  tenantId: string,
  corporateRequestId: string,
  paymentIntentId: string | null,
): Promise<void> {
  try {
    const [row] = await db
      .select({
        clientName: clients.name,
        clientEmail: clients.email,
        clientId: clients.id,
        packageName: corporatePackages.name,
        purchasePaidSgd: purchases.amountPaidSgd,
      })
      .from(corporateRequests)
      .innerJoin(clients, eq(clients.id, corporateRequests.clientId))
      .innerJoin(corporatePackages, eq(corporatePackages.id, corporateRequests.corporatePackageId))
      .leftJoin(purchases, eq(purchases.id, corporateRequests.purchaseId))
      .where(and(eq(corporateRequests.tenantId, tenantId), eq(corporateRequests.id, corporateRequestId)))
      .limit(1)
    // Not a refusal anyone is shown: reported below, with the ids.
    if (!row) throw new Error('corporate request not found')

    const payment = paymentIntentId
      ? (
          await db
            .select({
              receiptUrl: stripePayments.receiptUrl,
              paymentSgd: stripePayments.amountSgd,
              purchasePaidSgd: purchases.amountPaidSgd,
            })
            .from(stripePayments)
            .leftJoin(purchases, eq(purchases.id, stripePayments.purchaseId))
            .where(and(eq(stripePayments.tenantId, tenantId), eq(stripePayments.paymentIntentId, paymentIntentId)))
            .limit(1)
        )[0]
      : row.purchasePaidSgd != null
        ? { receiptUrl: null, paymentSgd: row.purchasePaidSgd, purchasePaidSgd: row.purchasePaidSgd }
        : undefined
    if (!payment) throw new Error(`no payment ${paymentIntentId ?? '(free)'} for the corporate request`)

    await sendTemplatedEmail({
      tenantId,
      slug: 'corporate_purchase_confirmed',
      recipient: { email: row.clientEmail, userId: row.clientId, userKind: 'client' },
      variables: {
        client_name: row.clientName,
        package_name: row.packageName,
        // The sale's figure, as on every other confirmation (#370).
        amount_paid: amountPaid(payment.purchasePaidSgd ?? payment.paymentSgd),
        // Where the request is, when the provider gave no receipt: an escaped
        // empty href is a link to nowhere.
        receipt_url: payment.receiptUrl || (await corporateRequestsUrlFor(tenantId)),
      },
    })
  } catch (err) {
    reportError(err, 'corporate purchase confirmation email failed', {
      scope: 'purchase-email',
      tenantId,
      corporateRequestId,
    })
  }
}

/**
 * Confirm one workshop booking, paid or free. The free path is the worst case
 * in the set — it produces a confirmed booking with a QR code and a date, and
 * used to send nothing at all.
 *
 * Fills the workshop template's seven declared variables; `receipt_url` falls
 * back to the account page the same way, because an escaped empty value inside
 * an href renders a link that goes nowhere.
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
        purchasePaidSgd: purchases.amountPaidSgd,
        bookingPaidSgd: bookings.amountPaidSgd,
      })
      .from(bookings)
      .innerJoin(clients, eq(clients.id, bookings.clientId))
      .innerJoin(workshops, eq(workshops.id, bookings.workshopId))
      .leftJoin(stripePayments, eq(stripePayments.purchaseId, bookings.purchaseId))
      .leftJoin(purchases, eq(purchases.id, bookings.purchaseId))
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          eq(bookings.id, bookingId),
          eq(bookings.kind, 'workshop'),
        ),
      )
      .limit(1)
    if (!row) throw new NotFoundError('workshop_booking_not_found', { bookingId })

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
        qr_url: await workshopQrUrlFor(tenantId),
        code: row.code,
        // The sale's figure; a free tier is booked with no Purchase, and the
        // booking records the zero it cost (required on every workshop place).
        amount_paid: amountPaid(row.purchasePaidSgd ?? row.bookingPaidSgd ?? '0.00'),
        receipt_url: row.receiptUrl || (await accountUrlFor(tenantId)),
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
