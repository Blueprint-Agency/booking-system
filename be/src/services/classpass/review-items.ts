import { and, asc, eq, inArray, isNull, ne, or } from 'drizzle-orm'
import { db } from '../../db'
import { classpassInboundEmails } from '../../db/schema'
import type { ClassPassEmailOutcome, ClassPassReviewReason } from '../../db/enums'
import { reportError } from '../../shared/logger'
import { placeClassPassBooking } from './import-booking'
import { normaliseClassPassLocation } from './location-name'
import { parseClassPassBooking } from './parse'

/**
 * The open items of ClassPass review, as the importer, the review and
 * the ClassPass location mappings all write them.
 *
 * An open item is a kept email with an outcome of `review` or `unparsed` and
 * no `resolved_at`.
 */

export const OPEN_OUTCOMES: ClassPassEmailOutcome[] = ['review', 'unparsed']

export const isOpen = and(inArray(classpassInboundEmails.outcome, OPEN_OUTCOMES), isNull(classpassInboundEmails.resolvedAt))

/** What placing an email did, as its kept row records it. */
export type Placed = {
  outcome: ClassPassEmailOutcome
  reason: ClassPassReviewReason | null
  startsAt: Date | null
  clientId: string | null
  bookingId: string | null
}

/**
 * Runs `place` in a savepoint, so whatever it wrote is undone if it throws.
 * A throw is logged, and what the email becomes is `review` as `import_error`:
 * keeping an email never depends on placing it.
 */
export async function placeIsolated(
  place: () => Promise<Placed>,
  context: { tenantId: string; inboundEmailId: string },
): Promise<Placed> {
  try {
    return await db.transaction(() => place())
  } catch (err) {
    reportError(err, 'classpass inbound: placing failed; kept for review', { scope: 'classpass-import', ...context })
    return { outcome: 'review', reason: 'import_error', startsAt: null, clientId: null, bookingId: null }
  }
}

/**
 * Writes what placing an email did. Given `closedBy`, a review item that is no
 * longer for review (imported, or found already booked) is closed in that
 * staff member's name (null: nobody's, when no one is signed in).
 */
export async function recordPlaced(tenantId: string, id: string, placed: Placed, closedBy?: string | null): Promise<void> {
  const closed = closedBy !== undefined && !OPEN_OUTCOMES.includes(placed.outcome)
  const staffId = closedBy ?? null
  await db
    .update(classpassInboundEmails)
    .set({
      outcome: placed.outcome,
      reviewReason: placed.reason,
      startsAt: placed.startsAt,
      clientId: placed.clientId,
      bookingId: placed.bookingId,
      ...(closed ? { resolvedAt: new Date(), resolvedByStaffId: staffId } : {}),
    })
    .where(and(eq(classpassInboundEmails.tenantId, tenantId), eq(classpassInboundEmails.id, id)))
}

/**
 * Runs the import again on every open booking item whose ClassPass location
 * normalises to one of `names`, after its mapping changed. Each one that now
 * places is booked and closed in `staffId`'s name; the rest stay open with
 * their new reason. A booking kept while the import was off is left for the
 * Admin to decide on. Returns the ids it re-ran, oldest first.
 */
export async function rerunOpenReviewAt(tenantId: string, names: string[], staffId: string | null): Promise<string[]> {
  const open = await db
    .select({
      id: classpassInboundEmails.id,
      text: classpassInboundEmails.text,
      html: classpassInboundEmails.html,
      locationName: classpassInboundEmails.locationName,
    })
    .from(classpassInboundEmails)
    .where(
      and(
        eq(classpassInboundEmails.tenantId, tenantId),
        isOpen,
        eq(classpassInboundEmails.kind, 'booking'),
        or(isNull(classpassInboundEmails.reviewReason), ne(classpassInboundEmails.reviewReason, 'import_off')),
      ),
    )
    .orderBy(asc(classpassInboundEmails.receivedAt), asc(classpassInboundEmails.id))
    .for('update')
  const fromThere = open.filter(o => o.locationName && names.includes(normaliseClassPassLocation(o.locationName)))

  for (const o of fromThere) {
    const placed = await placeIsolated(() => placeClassPassBooking(tenantId, parseClassPassBooking(o)), {
      tenantId,
      inboundEmailId: o.id,
    })
    await recordPlaced(tenantId, o.id, placed, staffId)
  }
  return fromThere.map(o => o.id)
}
