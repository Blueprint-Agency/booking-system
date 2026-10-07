import { sql } from 'drizzle-orm'
import { db } from '../../db'
import { platformSettings } from '../../db/schema'
import { logger } from '../../shared/logger'

/**
 * Maintenance mode: one platform-wide switch, set in the super portal, that
 * closes every tenant-facing surface with `503 maintenance` while it is on
 * (be/CONTEXT.md § Maintenance mode; the gate is in app.ts). Not per studio —
 * it exists for the deploys that touch every studio at once.
 */

export const DEFAULT_MAINTENANCE_MESSAGE = "Maintenance in progress. We'll be back shortly."

/** How long one read of the switch is trusted. Switching it takes effect within this. */
export const MAINTENANCE_CACHE_MS = 5_000

export type Maintenance = {
  enabled: boolean
  message: string
  /** The super portal operator who last changed it, by email. Null if nobody ever has. */
  updatedBy: string | null
  updatedAt: Date | null
}

/** The switch as stored. No row — a database nobody has switched — reads as off. */
export async function readMaintenance(): Promise<Maintenance> {
  const [row] = await db.select().from(platformSettings)
  return {
    enabled: row?.maintenanceEnabled ?? false,
    message: row?.maintenanceMessage ?? DEFAULT_MAINTENANCE_MESSAGE,
    updatedBy: row?.maintenanceUpdatedBy ?? null,
    updatedAt: row?.maintenanceUpdatedAt ?? null,
  }
}

let cached: { value: Promise<Maintenance>; until: number } | null = null

/**
 * The switch as the gate sees it: read at most once per `MAINTENANCE_CACHE_MS`
 * per process, so a request costs no database read. Concurrent requests share
 * the one read. A failed read keeps the last answer (off, if there is none) —
 * the database being unreachable is not a reason to close every studio.
 */
export function currentMaintenance(): Promise<Maintenance> {
  const now = Date.now()
  if (!cached || now >= cached.until) {
    const previous = cached?.value
    const value = readMaintenance().catch(err => {
      logger.error({ err }, 'maintenance: could not read the switch; keeping the last answer')
      return previous ?? off()
    })
    cached = { value, until: now + MAINTENANCE_CACHE_MS }
  }
  return cached.value
}

function off(): Maintenance {
  return { enabled: false, message: DEFAULT_MAINTENANCE_MESSAGE, updatedBy: null, updatedAt: null }
}

/**
 * Switch maintenance on or off, and optionally reword it. A message left out
 * keeps the one stored. Runs outside every Tenant context — the row's policy
 * refuses a write from inside one (migration 0104).
 */
export async function setMaintenance(input: { enabled: boolean; message?: string; by: string }): Promise<Maintenance> {
  const changes = {
    maintenanceEnabled: input.enabled,
    ...(input.message === undefined ? {} : { maintenanceMessage: input.message }),
    maintenanceUpdatedBy: input.by,
    maintenanceUpdatedAt: sql`now()`,
  }
  await db
    .insert(platformSettings)
    .values({ id: true, ...changes })
    .onConflictDoUpdate({ target: platformSettings.id, set: changes })
  // This process takes effect at once; any other within MAINTENANCE_CACHE_MS.
  cached = null
  logger.info({ enabled: input.enabled, by: input.by }, 'maintenance: switched')
  return readMaintenance()
}
