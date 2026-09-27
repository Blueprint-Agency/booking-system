/**
 * Activation (spec §3): the moment a Dormant package starts its clock — the
 * first booking it pays for. Every kind waits Dormant from purchase; this file
 * is the one place the stamp is written, so the class path and the PT path
 * cannot disagree about it.
 *
 * Any number of packages in a Family may be Activated at once (be/docs/adr/0010):
 * the member picks which one pays, and picking a Dormant one while another runs
 * starts its clock there and then. Both writers already hold the row locked
 * FOR UPDATE inside a transaction.
 */
import { and, eq, isNotNull, lte } from 'drizzle-orm'
import { clientPackages } from '../../db/schema/packages'
import type { Tx } from './ledger'

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
 * frozen on the row.
 */
export async function activatePackage(
  tx: Tx,
  tenantId: string,
  clientPackageId: string,
  expiresAt: Date,
): Promise<void> {
  await tx
    .update(clientPackages)
    .set({ expiresAt })
    .where(and(eq(clientPackages.tenantId, tenantId), eq(clientPackages.id, clientPackageId)))
}
