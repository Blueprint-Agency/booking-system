/**
 * Restoring a studio *beside* the one it came from.
 *
 * An archive holds every row exactly as it was, primary keys included, and a
 * primary key is unique across the whole platform rather than within a Tenant.
 * So a straight replay works when the source studio is gone and fails on the
 * first insert when it is still there — which is the ordinary case: export a
 * studio, create a second one, import the archive into it.
 *
 * The fix is to give every restored row a fresh id and rewrite every reference
 * to it. Two things make that safe to do generically:
 *
 *  - **Every reference between a studio's rows is a uuid.** So one map from old
 *    id to new id, applied to every uuid-shaped value in the archive, rewrites
 *    the foreign keys, the self-references, the uuid arrays
 *    (`staff_users.granted_location_ids`) and the polymorphic ones
 *    (`promo_code_products.product_id`, `audit_log.target_id`) in a single pass
 *    — with no foreign-key metadata to keep in step with the schema.
 *  - **A uuid that is not a row id is left alone.** Values are replaced only if
 *    they are *in* the map, so a `tenant_id`, a Clerk id or a piece of free text
 *    passes through untouched. The map is built from `id` columns alone.
 *
 * What deliberately does **not** change is anything a member holds: booking
 * references, QR tokens, invitation tokens. Those used to be unique
 * platform-wide, which is what made this impossible; migration 0040 scoped them
 * to the Tenant, where they belong. A copy of a studio is a copy right down to
 * what is printed on its members' confirmations.
 *
 * Remapping is not free — the ids in an archive are the ids a Stripe intent's
 * metadata and an old bookmark point at — so `transfer.ts` only reaches for it
 * when the source studio is still present, and a genuine restore of a studio
 * that is gone still replays byte for byte.
 */
import { randomUUID } from 'node:crypto'

/** Canonical uuid text, which is the only form Postgres hands back. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type IdentityMap = ReadonlyMap<string, string>

/**
 * Old row id → new row id, for every row in the archive.
 *
 * Built from `id` columns only. A table keyed by its foreign keys instead —
 * `workshop_instructors`, `leave_pools` — needs no entry of its own: the columns
 * that make up its key are ids of other tables, and rewriting those is what
 * moves it.
 */
export function buildIdentityMap(
  tables: readonly string[],
  rows: Readonly<Record<string, ReadonlyArray<Record<string, unknown>>>>,
  freshId: () => string = randomUUID,
): IdentityMap {
  const map = new Map<string, string>()
  for (const table of tables) {
    for (const row of rows[table] ?? []) {
      const id = row.id
      if (typeof id === 'string' && UUID.test(id) && !map.has(id)) map.set(id, freshId())
    }
  }
  return map
}

/**
 * One value, with every id in it rewritten.
 *
 * Walks arrays and objects so uuid arrays and `jsonb` payloads move with the
 * rest — an audit entry whose payload names the row it changed should still
 * name it after a restore. Anything that is not a string, an array or a plain
 * object is returned as it came.
 */
export function remapValue(value: unknown, map: IdentityMap): unknown {
  if (typeof value === 'string') return map.get(value) ?? value
  if (Array.isArray(value)) return value.map(item => remapValue(item, map))
  if (value !== null && typeof value === 'object') {
    // Dates, Buffers and the like are values, not containers — rebuilding one
    // as a plain object would change its type on the way back into Postgres.
    if (Object.getPrototypeOf(value) !== Object.prototype) return value
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value)) out[key] = remapValue(inner, map)
    return out
  }
  return value
}

/** One row, with every id in it rewritten. An empty map returns it unchanged. */
export function remapRow(
  row: Readonly<Record<string, unknown>>,
  map: IdentityMap,
): Record<string, unknown> {
  if (map.size === 0) return { ...row }
  const out: Record<string, unknown> = {}
  for (const [column, value] of Object.entries(row)) out[column] = remapValue(value, map)
  return out
}
