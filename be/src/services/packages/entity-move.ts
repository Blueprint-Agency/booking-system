import { and, countDistinct, eq } from 'drizzle-orm'
import { db } from '../../db'
import { clientPackages } from '../../db/schema/packages'
import { assertEntityUsable } from '../catalog/entities'
import { getClassPackage } from './class-packages'
import { getCorporatePackage } from './corporate-packages'
import { getPtPackage } from './pt-packages'
import { NotFoundError } from '../../shared/errors'

export type MovableKind = 'class' | 'pt' | 'corporate'

/**
 * What an admin is told before moving a package to another Entity: how many
 * members hold it. The move itself is a plain edit of the package's `entity_id`;
 * the packages members hold read their Entity through the catalogue package, so
 * they go with it, and nothing is cancelled. This is a read and writes nothing.
 *
 * A member counts once however many of the package they hold, and only while a
 * holding is live (`active`): one that has ended is not moved under anybody. A
 * corporate package is never held by a member (a company buys it, and no
 * `client_packages` row exists), so its count is always zero.
 *
 * The target is checked the way the move is, so the preview refuses what saving
 * would, before the admin is shown a count for a move that cannot be made.
 */
export async function previewMove(
  tenantId: string,
  kind: MovableKind,
  packageId: string,
  toEntityId: string,
): Promise<{ members_holding: number }> {
  if (kind === 'class') await getClassPackage(tenantId, packageId)
  else if (kind === 'pt') await getPtPackage(tenantId, packageId)
  else if (!(await getCorporatePackage(tenantId, packageId))) throw new NotFoundError('corporate_package_not_found')
  await assertEntityUsable(tenantId, toEntityId)

  if (kind === 'corporate') return { members_holding: 0 }
  const source = kind === 'class' ? clientPackages.sourceClassPackageId : clientPackages.sourcePtPackageId
  const [row] = await db
    .select({ members: countDistinct(clientPackages.clientId) })
    .from(clientPackages)
    .where(and(eq(clientPackages.tenantId, tenantId), eq(source, packageId), eq(clientPackages.active, true)))
  return { members_holding: row?.members ?? 0 }
}
