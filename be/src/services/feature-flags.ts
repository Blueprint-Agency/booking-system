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
let cache: Map<string, boolean> = new Map()
let loaded = false

const cacheKey = (tenantId: string, key: string) => `${tenantId}:${key}`

/** Every tenant's flags in one pass — the process serves all of them. */
export async function loadFeatureFlags(): Promise<void> {
  const rows = await db.select().from(featureFlags)
  cache = new Map(rows.map(r => [cacheKey(r.tenantId, r.key), r.enabled]))
  loaded = true
}

export function isEnabled(tenantId: string, key: string): boolean {
  if (!loaded) return false
  return cache.get(cacheKey(tenantId, key)) ?? false
}

export async function setFlag(
  tenantId: string,
  key: string,
  enabled: boolean,
  staffId: string,
): Promise<void> {
  await db
    .insert(featureFlags)
    .values({ tenantId, key, enabled, updatedByStaffId: staffId })
    .onConflictDoUpdate({
      target: [featureFlags.tenantId, featureFlags.key],
      set: { enabled, updatedAt: new Date(), updatedByStaffId: staffId },
    })
  cache.set(cacheKey(tenantId, key), enabled)
}
