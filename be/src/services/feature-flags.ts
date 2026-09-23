import { asc, eq } from 'drizzle-orm'
import { db } from '../db'
import { featureFlags } from '../db/schema/ops'

/**
 * The switchboard, cached in process.
 *
 * Keyed by tenant *and* key, not by key: a flag is one studio's switch (the
 * primary key is the pair — see db/schema/ops.ts), so a cache keyed on the name
 * alone would let whichever tenant was loaded last decide the feature for
 * everybody.
 */
const cache: Map<string, boolean> = new Map()

const cacheKey = (tenantId: string, key: string) => `${tenantId}:${key}`

/**
 * Load the flags visible in the current Tenant context, MERGING them into the
 * cache rather than replacing it.
 *
 * Merging, because Row-Level Security means this read only ever sees one
 * tenant's rows, and boot calls it once per tenant (src/jobs/index.ts). Replacing
 * would leave the process serving whichever tenant happened to be loaded last
 * and treating every other studio's features as off.
 */
export async function loadFeatureFlags(): Promise<void> {
  const rows = await db.select().from(featureFlags)
  for (const row of rows) cache.set(cacheKey(row.tenantId, row.key), row.enabled)
}

/**
 * A flag nobody has set is off. No "loaded yet?" guard: a flag switched in this
 * process is already in the cache, and one that is not reads as off either way.
 */
export function isEnabled(tenantId: string, key: string): boolean {
  return cache.get(cacheKey(tenantId, key)) ?? false
}

export type FeatureFlagRow = typeof featureFlags.$inferSelect

/** This studio's switchboard, by key. */
export async function listFlags(tenantId: string): Promise<FeatureFlagRow[]> {
  return db
    .select()
    .from(featureFlags)
    .where(eq(featureFlags.tenantId, tenantId))
    .orderBy(asc(featureFlags.key))
}

export async function setFlag(
  tenantId: string,
  key: string,
  enabled: boolean,
  staffId: string,
): Promise<FeatureFlagRow> {
  const [row] = await db
    .insert(featureFlags)
    .values({ tenantId, key, enabled, updatedByStaffId: staffId })
    .onConflictDoUpdate({
      target: [featureFlags.tenantId, featureFlags.key],
      set: { enabled, updatedAt: new Date(), updatedByStaffId: staffId },
    })
    .returning()
  cache.set(cacheKey(tenantId, key), enabled)
  return row!
}
