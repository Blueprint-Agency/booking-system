import { entityRefsFor, type EntityRef } from '../services/catalog/entities'

/**
 * How a row that belongs to an Entity says so: its id, and the Entity's name
 * and slug so a screen can draw it without a second read. Both null on a row
 * with no Entity (one made before Entities and not yet backfilled).
 */
export type EntityFields = { entity_id: string | null; entity: EntityRef | null }

/** The Entity fields for each of `rows`, read in one query, in the order given. */
export async function entityFieldsFor(
  tenantId: string,
  rows: ReadonlyArray<{ entityId: string | null }>,
): Promise<EntityFields[]> {
  const refs = await entityRefsFor(tenantId, rows.map(r => r.entityId))
  return rows.map(r => ({ entity_id: r.entityId, entity: r.entityId ? (refs.get(r.entityId) ?? null) : null }))
}
