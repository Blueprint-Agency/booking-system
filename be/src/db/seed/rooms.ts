import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import * as schema from '../schema'

/**
 * Two rooms per location. Idempotent via WHERE NOT EXISTS on (location_id, name).
 * Runs after seedLocations so the location rows exist.
 */
export async function seedRooms(db: PostgresJsDatabase<typeof schema>) {
  const roomsByLocation: Record<string, { name: string; capacity: number }[]> = {
    'Breadtalk IHQ (Tai Seng)': [
      { name: 'Studio A', capacity: 24 },
      { name: 'Studio B', capacity: 12 },
    ],
    'Outram Park': [
      { name: 'Main Hall', capacity: 30 },
      { name: 'Private Room', capacity: 4 },
    ],
  }

  for (const [locationName, rooms] of Object.entries(roomsByLocation)) {
    for (const room of rooms) {
      await db.execute(sql`
        INSERT INTO rooms (location_id, name, capacity)
        SELECT l.id, ${room.name}, ${room.capacity}
        FROM locations l
        WHERE l.name = ${locationName}
          AND NOT EXISTS (
            SELECT 1 FROM rooms r
            WHERE r.location_id = l.id AND lower(r.name) = lower(${room.name})
          )
      `)
    }
  }
}
