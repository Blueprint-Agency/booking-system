/**
 * Activation (spec §3): the moment a Dormant package starts its clock — the
 * first booking it pays for (for a PT package, its first session being put on
 * the calendar — be/docs/adr/0011). Every kind waits Dormant from purchase;
 * this file is the one place the stamp is written, so the class path and the
 * PT path cannot disagree about it.
 *
 * Any number of packages in a Family may be Activated at once (be/docs/adr/0010):
 * the member picks which one pays, and picking a Dormant one while another runs
 * starts its clock there and then. Both writers already hold the row locked
 * FOR UPDATE inside a transaction.
 */
import { and, eq, isNotNull, lte } from 'drizzle-orm'
import { clientPackages } from '../../db/schema/packages'
import { manualAdjustments } from '../../db/schema/ledger'
import type { Tx } from './ledger'
import { activationExpiry, isDormant } from './validity'
import { ConflictError } from '../../shared/errors'
import { now as clockNow } from '../../lib/clock'

/**
 * Flip `active` off on the member's own packages whose expiry has passed —
 * the nightly sweep, run early for one member, so the booking path never reads
 * a package that ended at midnight as one that can still pay.
 */
export async function sweepExpired(
  tx: Tx,
  tenantId: string,
  clientId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(clientPackages)
    .set({ active: false })
    .where(
      and(
        eq(clientPackages.tenantId, tenantId),
        eq(clientPackages.clientId, clientId),
        eq(clientPackages.active, true),
        isNotNull(clientPackages.expiresAt),
        lte(clientPackages.expiresAt, now),
      ),
    )
}

/**
 * Stamp the expiry on a Dormant package. `expiresAt` was computed by the
 * caller through `activationExpiry`, from the booking moment and the length
 * frozen on the row. A PT package names the session whose scheduling
 * Activated it (be/docs/adr/0011), the one session whose cancel can undo it.
 */
export async function activatePackage(
  tx: Tx,
  tenantId: string,
  clientPackageId: string,
  expiresAt: Date,
  activatedByPtSessionId: string | null = null,
): Promise<void> {
  await tx
    .update(clientPackages)
    .set({ expiresAt, activatedByPtSessionId })
    .where(and(eq(clientPackages.tenantId, tenantId), eq(clientPackages.id, clientPackageId)))
}

/**
 * A PT package Activates when its first session is put on the calendar, not
 * when the member asks for one (be/docs/adr/0011): a package the request left
 * Dormant starts its clock now, from the scheduling moment, and records this
 * session as the one that started it. A package already running keeps its
 * date. The row is locked, so two requests on one Dormant package scheduled
 * at once Activate it once. A manual session's seat Activates its package the
 * same way (services/pt-sessions/manual.ts).
 */
export async function activateOnSchedule(
  tx: Tx,
  tenantId: string,
  clientPackageId: string,
  ptSessionId: string,
): Promise<void> {
  const [pkg] = await tx
    .select({
      kind: clientPackages.kind,
      expiresAt: clientPackages.expiresAt,
      durationMonths: clientPackages.durationMonths,
      validityDays: clientPackages.validityDays,
    })
    .from(clientPackages)
    .where(and(eq(clientPackages.tenantId, tenantId), eq(clientPackages.id, clientPackageId)))
    .for('update')
    .limit(1)
  if (!pkg || !isDormant(pkg)) return
  const until = activationExpiry(pkg, clockNow())
  if (!until) throw new ConflictError('package_not_consumable')
  await activatePackage(tx, tenantId, clientPackageId, until, ptSessionId)
}

/**
 * The session that Activated a PT package has been cancelled: return the
 * package to Dormant unless the cancel was late (be/docs/adr/0011). Only that
 * session undoes it — a package Activated by another, or by staff's hand, is
 * left alone — and only once, since going back to Dormant clears the pointer.
 * Balance is the cancel's business, not this: whatever it returned stays. The
 * move is written to the ledger as a zero-delta row, like an expiry edit.
 */
export async function reverseActivationOnCancel(
  tx: Tx,
  input: {
    tenantId: string
    clientId: string
    clientPackageId: string
    ptSessionId: string
    /** Inside the PT cancellation window, by whoever cancelled. */
    late: boolean
    actedByStaffId?: string | null
  },
): Promise<void> {
  if (input.late) return
  const [pkg] = await tx
    .select({ id: clientPackages.id })
    .from(clientPackages)
    .where(
      and(
        eq(clientPackages.tenantId, input.tenantId),
        eq(clientPackages.id, input.clientPackageId),
        eq(clientPackages.clientId, input.clientId),
        eq(clientPackages.activatedByPtSessionId, input.ptSessionId),
      ),
    )
    .for('update')
    .limit(1)
  if (!pkg) return

  await tx
    .update(clientPackages)
    // `active` is left as the cancel's ledger movement set it. Deriving it
    // here would revive a package a Refund Voided, which is `active = false`
    // and nothing else, if its session were cancelled after it.
    .set({ expiresAt: null, activatedByPtSessionId: null })
    .where(and(eq(clientPackages.tenantId, input.tenantId), eq(clientPackages.id, input.clientPackageId)))

  await tx.insert(manualAdjustments).values({
    tenantId: input.tenantId,
    clientId: input.clientId,
    clientPackageId: input.clientPackageId,
    delta: 0,
    reason: 'pt_activation_reversed',
    actedByStaffId: input.actedByStaffId ?? null,
  })
}
