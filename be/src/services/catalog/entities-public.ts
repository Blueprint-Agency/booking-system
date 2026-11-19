import { and, asc, eq, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { classPackages, corporatePackages, ptPackages } from '../../db/schema/packages'
import { entities } from '../../db/schema/catalog'

/**
 * What a visitor is told of an Entity: enough to name it, link to it and filter
 * by it, and whether anything in it is on sale (the Packages menu leaves out an
 * Entity with nothing to buy; the schedule's buttons do not look at it).
 */
export interface PublicEntity {
  id: string
  name: string
  slug: string
  has_live_packages: boolean
}

/**
 * The studio's live Entities in the order it set, for the member app: the
 * schedule's buttons and the Packages menu. Archived Entities are left out, as
 * they are from every member surface. "Has live packages" is a class, PT or
 * corporate package that is active and not removed, read for all three tables
 * in one query rather than once per Entity. Read by anyone naming the studio.
 */
export async function listPublicEntities(tenantId: string): Promise<PublicEntity[]> {
  const [rows, onSale] = await Promise.all([
    db
      .select({ id: entities.id, name: entities.name, slug: entities.slug })
      .from(entities)
      .where(and(eq(entities.tenantId, tenantId), isNull(entities.archivedAt)))
      .orderBy(asc(entities.position), asc(entities.createdAt), asc(entities.id)),
    db
      .select({ entityId: classPackages.entityId })
      .from(classPackages)
      .where(
        and(eq(classPackages.tenantId, tenantId), eq(classPackages.status, 'active'), isNull(classPackages.deletedAt)),
      )
      .union(
        db
          .select({ entityId: ptPackages.entityId })
          .from(ptPackages)
          .where(and(eq(ptPackages.tenantId, tenantId), eq(ptPackages.status, 'active'), isNull(ptPackages.deletedAt))),
      )
      .union(
        db
          .select({ entityId: corporatePackages.entityId })
          .from(corporatePackages)
          .where(
            and(
              eq(corporatePackages.tenantId, tenantId),
              eq(corporatePackages.status, 'active'),
              isNull(corporatePackages.deletedAt),
            ),
          ),
      ),
  ])
  const withPackages = new Set(onSale.map(r => r.entityId))
  return rows.map(row => ({ ...row, has_live_packages: withPackages.has(row.id) }))
}
