import { db } from '../db'
import { featureFlags } from '../db/schema/ops'
import { eq } from 'drizzle-orm'

let cache: Map<string, boolean> = new Map()
let loaded = false

export async function loadFeatureFlags(): Promise<void> {
  const rows = await db.select().from(featureFlags)
  cache = new Map(rows.map(r => [r.key, r.enabled]))
  loaded = true
}

export function isEnabled(key: string): boolean {
  if (!loaded) return false
  return cache.get(key) ?? false
}

export async function setFlag(key: string, enabled: boolean, staffId: string): Promise<void> {
  await db
    .insert(featureFlags)
    .values({ key, enabled, updatedByStaffId: staffId })
    .onConflictDoUpdate({
      target: featureFlags.key,
      set: { enabled, updatedAt: new Date(), updatedByStaffId: staffId },
    })
  cache.set(key, enabled)
}
