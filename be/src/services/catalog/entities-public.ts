import { and, asc, eq, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { entities } from '../../db/schema/catalog'

/** What a visitor is told of an Entity: enough to name it, link to it and filter by it. */
export interface PublicEntity {
  id: string
  name: string
  slug: string
}

/**
 * The studio's live Entities in the order it set, for the member app: the
 * schedule's buttons and, later, the Packages menu. Archived Entities are left
 * out, as they are from every member surface. One query and no usage counts:
 * this is read by anyone naming the studio.
 */
export async function listPublicEntities(tenantId: string): Promise<PublicEntity[]> {
  const rows = await db
    .select({ id: entities.id, name: entities.name, slug: entities.slug })
    .from(entities)
    .where(and(eq(entities.tenantId, tenantId), isNull(entities.archivedAt)))
    .orderBy(asc(entities.position), asc(entities.createdAt), asc(entities.id))
  return rows
}
