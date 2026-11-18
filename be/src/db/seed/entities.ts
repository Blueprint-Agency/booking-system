import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema'
import { provisioningFor } from './provisioning'

/**
 * The Entity every studio starts with. A generic default, never a studio's own
 * words: the studio renames it from settings when it adds a second line.
 */
export const DEFAULT_ENTITY_NAME = 'All classes'

/** The URL-safe form of an Entity's name: lowercase letters and digits, joined by single hyphens. */
export function slugForEntityName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

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
