import { z } from 'zod'
import { explainInvalid } from './explain-invalid'
import { entityRefsFor, liveEntityIdBySlug, type EntityRef } from '../services/catalog/entities'

/** `?entity=<slug>` on a package read. Left out or blank, every Entity's packages are returned. */
export const entityQuery = z.object({
  entity: z.string().trim().max(60, 'An Entity slug is at most 60 characters.').optional(),
})
export const explainEntityQuery = explainInvalid('That Entity is not valid.')

/**
 * The filter a package read applies for its `?entity=` slug: `{}` when none is
 * given, `{ entityId }` for a live Entity of the studio, and null when the slug
 * names no such Entity (unknown, archived, or another studio's), which the read
 * answers with an empty list. The "land on the first Entity" fallback is the
 * member app's rule, not the API's.
 */
export async function entityFilter(
  tenantId: string,
  slug: string | undefined,
): Promise<{ entityId?: string } | null> {
  if (!slug) return {}
  const entityId = await liveEntityIdBySlug(tenantId, slug)
  return entityId ? { entityId } : null
}

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
