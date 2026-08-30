import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { and, eq, sql } from 'drizzle-orm'
import * as schema from '../schema'
import { TENANT_ONE_SLUG } from '../schema/tenancy'
import { locationsFor } from './locations'
import type { SeededTenant } from './tenants'

type SeedRoom = { name: string; capacity: number }

const YOGA_SADHANA_ROOMS: Record<string, SeedRoom[]> = {
  'Breadtalk IHQ (Tai Seng)': [
    { name: 'Studio A', capacity: 24 },
    { name: 'Studio B', capacity: 12 },
  ],
  'Outram Park': [
    { name: 'Main Hall', capacity: 30 },
    { name: 'Private Room', capacity: 4 },
  ],
}

const DEFAULT_ROOMS: SeedRoom[] = [{ name: 'Main Hall', capacity: 20 }]

/**
 * Rooms hang off the tenant's own locations. Idempotent on
 * (tenant_id, location_id, lower(name)); runs after `seedLocations` so the
 * location rows exist.
 */
export async function seedRooms(db: PostgresJsDatabase<typeof schema>, tenant: SeededTenant) {
  for (const location of locationsFor(tenant)) {
    const rooms =
      tenant.slug === TENANT_ONE_SLUG ? (YOGA_SADHANA_ROOMS[location.name] ?? []) : DEFAULT_ROOMS

    const [locationRow] = await db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(
        and(eq(schema.locations.tenantId, tenant.id), eq(schema.locations.name, location.name)),
      )
      .limit(1)
    if (!locationRow) continue

    for (const room of rooms) {
      const existing = await db
        .select({ id: schema.rooms.id })
        .from(schema.rooms)
        .where(
          and(
            eq(schema.rooms.tenantId, tenant.id),
            eq(schema.rooms.locationId, locationRow.id),
            sql`lower(${schema.rooms.name}) = lower(${room.name})`,
          ),
        )
        .limit(1)
      if (existing.length) continue

      await db.insert(schema.rooms).values({
        tenantId: tenant.id,
        locationId: locationRow.id,
        name: room.name,
        capacity: room.capacity,
      })
    }
  }
}
