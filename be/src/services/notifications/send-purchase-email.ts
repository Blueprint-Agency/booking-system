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
import { receiptPageUrl, withReceipt } from '../receipts/email'
import { purchaseReceipt } from '../receipts/read'
import { receiptItem } from '../receipts/snapshot'
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
 *
 * It carries the Purchase's Receipt (#387): the block, the PDF and the link.
 * The Purchase is the package's own; a free package is granted with none on
 * it, beside the settled Purchase its checkout opened, so the free paths name
 * that one (`salePurchaseId`).
 */
export async function sendPackagePurchaseEmail(
  tenantId: string,
  clientPackageId: string,
  salePurchaseId: string | null = null,
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
        purchaseId: clientPackages.purchaseId,
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
      .leftJoin(purchases, eq(purchases.id, clientPackages.purchaseId))
      .where(and(eq(clientPackages.tenantId, tenantId), eq(clientPackages.id, clientPackageId)))
      .limit(1)
    if (!row) throw new NotFoundError('client_package_not_found', { clientPackageId })

    const receipt = await purchaseReceipt(tenantId, salePurchaseId ?? row.purchaseId)

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
      receiptUrl: receipt ? await receiptPageUrl(tenantId, receipt.id) : null,
      accountUrl: await accountUrlFor(tenantId),
    })

    await sendTemplatedEmail(
      await withReceipt(
        {
          tenantId,
          slug,
          recipient: { email: row.clientEmail, userId: row.clientId, userKind: 'client' },
          variables,
        },
        receipt,
      ),
    )
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
 * a delivery that rolled back never mailed anyone. It carries the Receipt of
 * the Purchase the request names (#387).
 *
 * A package with nothing to pay (`paymentIntentId` null) is confirmed the same
 * way, from the zero-total Purchase the request names, and its S$0.00 Receipt.
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
        purchaseId: corporateRequests.purchaseId,
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
              paymentSgd: stripePayments.amountSgd,
              purchasePaidSgd: purchases.amountPaidSgd,
            })
            .from(stripePayments)
            .leftJoin(purchases, eq(purchases.id, stripePayments.purchaseId))
            .where(and(eq(stripePayments.tenantId, tenantId), eq(stripePayments.paymentIntentId, paymentIntentId)))
            .limit(1)
        )[0]
      : row.purchasePaidSgd != null
        ? { paymentSgd: row.purchasePaidSgd, purchasePaidSgd: row.purchasePaidSgd }
        : undefined
    if (!payment) throw new Error(`no payment ${paymentIntentId ?? '(free)'} for the corporate request`)

    await sendTemplatedEmail(
      await withReceipt(
        {
          tenantId,
          slug: 'corporate_purchase_confirmed',
          recipient: { email: row.clientEmail, userId: row.clientId, userKind: 'client' },
          variables: {
            client_name: row.clientName,
            package_name: row.packageName,
            // The sale's figure, as on every other confirmation (#370).
            amount_paid: amountPaid(payment.purchasePaidSgd ?? payment.paymentSgd),
            // The member's Receipt (`withReceipt`); where the request is only
            // for a request no Receipt was issued for: an escaped empty href
            // is a link to nowhere.
            receipt_url: await corporateRequestsUrlFor(tenantId),
          },
        },
        await purchaseReceipt(tenantId, row.purchaseId),
      ),
    )
  } catch (err) {
    reportError(err, 'corporate purchase confirmation email failed', {
      scope: 'purchase-email',
      tenantId,
      corporateRequestId,
    })
  }
}

/**
 * Send the Receipt of a sale that has no confirmation of its own (#388):
 * Merch, paid or free, and a standalone Cross-Location Add-On. Neither grants
 * a package or books a place, so `purchase_receipt` is the whole email: the
 * studio's copy naming what was bought and what it cost, and under it the
 * Receipt itself, its PDF and its link (`withReceipt`).
 *
 * Called once the delivery that issued the Receipt has committed. A Purchase
 * with no Receipt sends nothing, and says so in a report: this email exists
 * only to carry one. It goes to the member's current address, as every
 * confirmation does.
 */
export async function sendPurchaseReceiptEmail(tenantId: string, purchaseId: string): Promise<void> {
  try {
    const receipt = await purchaseReceipt(tenantId, purchaseId)
    if (!receipt) throw new NotFoundError('receipt_not_found', { purchaseId })
    if (!receipt.clientId) throw new Error('the Receipt names no member')

    const [member] = await db
      .select({ id: clients.id, name: clients.name, email: clients.email })
      .from(clients)
      .where(and(eq(clients.tenantId, tenantId), eq(clients.id, receipt.clientId)))
      .limit(1)
    if (!member) throw new NotFoundError('client_not_found', { clientId: receipt.clientId })

    await sendTemplatedEmail(
      await withReceipt(
        {
          tenantId,
          slug: 'purchase_receipt',
          recipient: { email: member.email, userId: member.id, userKind: 'client' },
          variables: {
            client_name: member.name,
            // What the Receipt calls it, so the copy and the block agree.
            item_name: receiptItem(receipt.lines),
            amount_paid: amountPaid(receipt.totalSgd),
          },
        },
        receipt,
      ),
    )
  } catch (err) {
    reportError(err, 'purchase receipt email failed', {
      scope: 'purchase-email',
      tenantId,
      purchaseId,
    })
  }
}

/**
 * Confirm one workshop booking, paid or free. The free path is the worst case
 * in the set — it produces a confirmed booking with a QR code and a date, and
 * used to send nothing at all.
 *
 * Fills the workshop template's declared variables and carries the place's
 * Receipt (#387), whose Purchase the booking names, paid or free.
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
        purchaseId: bookings.purchaseId,
        purchasePaidSgd: purchases.amountPaidSgd,
        bookingPaidSgd: bookings.amountPaidSgd,
      })
      .from(bookings)
      .innerJoin(clients, eq(clients.id, bookings.clientId))
      .innerJoin(workshops, eq(workshops.id, bookings.workshopId))
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

    await sendTemplatedEmail(
      await withReceipt(
        {
          tenantId,
          slug: 'workshop_purchase_confirmed',
          recipient: { email: row.clientEmail, userId: row.clientId, userKind: 'client' },
          variables: {
            client_name: row.clientName,
            workshop_name: row.workshopName,
            date: firstDay ? SG_DATETIME.format(firstDay.startsAt) : 'See your account for the date',
            qr_url: await workshopQrUrlFor(tenantId),
            code: row.code,
            // The sale's figure; a place booked before free places had a
            // Purchase records the zero it cost (required on every workshop place).
            amount_paid: amountPaid(row.purchasePaidSgd ?? row.bookingPaidSgd ?? '0.00'),
            // The member's Receipt (`withReceipt`); the account page only for
            // a place no Receipt was issued for.
            receipt_url: await accountUrlFor(tenantId),
          },
        },
        await purchaseReceipt(tenantId, row.purchaseId),
      ),
    )
  } catch (err) {
    reportError(err, 'workshop confirmation email failed', {
      scope: 'purchase-email',
      tenantId,
      bookingId,
    })
  }
}
