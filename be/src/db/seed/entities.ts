import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema'
import { DEFAULT_ENTITY_NAME, slugForEntityName } from '../../services/catalog/entity-rules'
import { provisioningFor } from './provisioning'

/** A database or an open transaction — provisioning writes these inside its own. */
type EntityWriter = Pick<PostgresJsDatabase<typeof schema>, 'insert'>

/**
 * The Entities a studio starts with: the fixture's own where `./provisioning.ts`
 * names some (the isolation fixtures), otherwise the one default every studio
 * has. A studio created from the super portal and an e2e studio both land here
 * with nothing named, so what the tests run against is what a new studio gets.
 *
 * Idempotent on the live name: an Entity the studio already has is left alone.
 */
export async function seedEntities(db: EntityWriter, tenant: { id: string; slug?: string }) {
  const names = provisioningFor(tenant)?.entities ?? [DEFAULT_ENTITY_NAME]
  await db
    .insert(schema.entities)
    .values(
      names.map((name, position) => ({
        tenantId: tenant.id,
        name,
        slug: slugForEntityName(name),
        position,
      })),
    )
    .onConflictDoNothing()
}
