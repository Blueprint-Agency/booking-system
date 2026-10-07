/**
 * Changing the Package rule of a class that already has bookings
 * (be/CONTEXT.md § Package rule).
 *
 * A booking paid by a package the class no longer accepts is cancelled — only
 * those: a booking paid by a package the new rule still accepts is untouched,
 * whenever it was made. Each goes through the single-booking cancel
 * (`bookings/cancel`) with the studio-initiated reason `package_rule_changed`,
 * so it is refunded in full to the package that paid, its seat is offered to
 * the waitlist, and it does not count against the member's cancellations.
 *
 * Staff are told how many first: the portal previews the change and asks before
 * saving one that cancels anybody. The save runs the rule write and every
 * cancel in one transaction — the class's own edit transaction — and each
 * member is emailed `class_rule_cancelled` once it has committed.
 *
 * A booking already checked in is left alone: its member is in the room.
 */
import { and, eq, ne } from 'drizzle-orm'
import { db } from '../../db'
import { bookings } from '../../db/schema/bookings'
import { classPackages, clientPackages } from '../../db/schema/packages'
import { classes } from '../../db/schema/schedule'
import { classTypes } from '../../db/schema/catalog'
import { clients } from '../../db/schema/identity'
import { acceptsPackage, type PackageRule } from '../packages/selection'
import { cancelBookingInTx } from '../bookings/cancel'
import { packageDisplayName } from '../bookings/book'
import type { Promotion } from '../waitlist/promote'
import { sendTemplatedEmail } from '../notifications/send'
import { loadTenantById } from '../tenants/tenants'
import { reportError } from '../../shared/logger'
import { writeClassRule } from './package-rules'
import type { Tx } from './roster'

/** One booking a rule change cancelled, as its member is told. */
export interface RuleCancellation {
  bookingId: string
  clientId: string
  classId: string
  packageName: string
  creditsReturned: number
}

/** The class's confirmed bookings the rule does not accept the payer of. */
async function bookingsRefusedBy(reader: Tx | typeof db, tenantId: string, classId: string, rule: PackageRule) {
  const rows = await reader
    .select({
      bookingId: bookings.id,
      clientId: bookings.clientId,
      used: bookings.creditsOrSessionsUsed,
      kind: clientPackages.kind,
      sourceClassPackageId: clientPackages.sourceClassPackageId,
      catalogueName: classPackages.name,
    })
    .from(bookings)
    // A booking nothing paid for (an unpaid import) was not paid by a package
    // the class refuses, so it is not one to cancel.
    .innerJoin(clientPackages, eq(clientPackages.id, bookings.clientPackageId))
    .leftJoin(classPackages, eq(classPackages.id, clientPackages.sourceClassPackageId))
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        eq(bookings.classId, classId),
        eq(bookings.state, 'confirmed'),
        ne(bookings.checkInState, 'attended'),
      ),
    )
  return rows.filter(r => !acceptsPackage(rule, r.sourceClassPackageId))
}

/** How many bookings saving this rule on the class would cancel. Writes nothing. */
export async function previewRuleChange(tenantId: string, classId: string, rule: PackageRule): Promise<number> {
  return (await bookingsRefusedBy(db, tenantId, classId, rule)).length
}

/**
 * Save the class's rule and cancel the bookings it no longer accepts, inside the
 * caller's transaction. The rule is written first so a seat freed here is
 * offered to the waitlist under the new rule. Returns what to email once the
 * transaction commits.
 */
export async function applyRuleChange(
  tx: Tx,
  tenantId: string,
  classId: string,
  rule: PackageRule,
  actorStaffId: string | null,
): Promise<{ cancellations: RuleCancellation[]; promotions: Promotion[] }> {
  await writeClassRule(tx, tenantId, [classId], rule)

  const cancellations: RuleCancellation[] = []
  const promotions: Promotion[] = []
  for (const b of await bookingsRefusedBy(tx, tenantId, classId, rule)) {
    const done = await cancelBookingInTx(tx, tenantId, {
      bookingId: b.bookingId,
      source: 'system',
      // The studio's change, not the member's: the credit always comes back.
      credit: 'return',
      ...(actorStaffId ? { actorStaffId } : {}),
      studioReason: 'package_rule_changed',
    })
    promotions.push(...done.promotions)
    cancellations.push({
      bookingId: b.bookingId,
      clientId: b.clientId!,
      classId,
      packageName: packageDisplayName(b.kind, b.catalogueName),
      // An Unlimited Plan spent nothing on it, so nothing went back.
      creditsReturned: done.result.refundFired ? (b.used ?? 0) : 0,
    })
  }
  return { cancellations, promotions }
}

/**
 * Email each member whose booking a rule change cancelled `class_rule_cancelled`.
 * After commit, and never throws: a mail fault must not undo a change already
 * saved, so failures are reported instead.
 */
export async function sendRuleCancelledEmails(tenantId: string, cancellations: readonly RuleCancellation[]): Promise<void> {
  if (cancellations.length === 0) return
  const tenant = await loadTenantById(tenantId)
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: tenant?.timezone ?? 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  for (const c of cancellations) {
    try {
      const [row] = await db
        .select({
          clientName: clients.name,
          clientEmail: clients.email,
          className: classTypes.name,
          startsAt: classes.startsAt,
        })
        .from(classes)
        .innerJoin(classTypes, eq(classTypes.id, classes.classTypeId))
        .innerJoin(clients, and(eq(clients.tenantId, classes.tenantId), eq(clients.id, c.clientId)))
        .where(and(eq(classes.tenantId, tenantId), eq(classes.id, c.classId)))
        .limit(1)
      if (!row) continue
      await sendTemplatedEmail({
        tenantId,
        slug: 'class_rule_cancelled',
        recipient: { email: row.clientEmail, userId: c.clientId, userKind: 'client' },
        variables: {
          client_name: row.clientName,
          class_name: row.className,
          date: date.format(row.startsAt),
          package_name: c.packageName,
          credits_returned: String(c.creditsReturned),
        },
      })
    } catch (err) {
      reportError(err, 'package rule cancellation email failed', { scope: 'schedule', bookingId: c.bookingId })
    }
  }
}
