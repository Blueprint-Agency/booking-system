import type { ErasedMember } from './member-tables'

/**
 * What permanently deleting a member does to an audit row that named them
 * (#144, #375): the row stays, and nothing in it says who they were.
 *
 * Audit rows are never deleted (prd §3.9, docs/adr/0008). Erasure is the one
 * edit made to them, and it touches only the member's personal data — their
 * name, email, phone and ids, wherever they appear — replacing each with
 * `ERASED_MEMBER`. The row's id, who acted, what kind of thing was acted on and
 * when, all stay, so the trail still shows an admin did something to a member's
 * record at that moment.
 *
 *   - `action`: their ids, where a route's path carried them.
 *   - `target_id`: the nil id, when the row's target is their `clients` row —
 *     the column is a uuid, so it cannot hold the placeholder.
 *   - `payload`: on a row about their own record, every value in `from` and
 *     `to` (what their name, phone, gender or email was and became — earlier
 *     values included, which nothing else here knows); anywhere else in it,
 *     each occurrence of their name, email, phone or ids inside a string. Keys
 *     stay, so an edit still says which fields changed.
 *
 * Matching is case-insensitive, and errs toward scrubbing: a string in a row
 * about the member that happens to contain their name loses that part too.
 */

/** What stands where the member was named. */
export const ERASED_MEMBER = '[erased member]'

/** A uuid column cannot hold the placeholder; this is "no one" there, as `audit.ts` uses it. */
const NIL_ID = '00000000-0000-0000-0000-000000000000'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Replaces every occurrence of `values` in a string with the placeholder. */
function scrubber(values: readonly (string | null | undefined)[]): (text: string) => string {
  const present = [...new Set(values.filter((v): v is string => !!v && v.trim() !== ''))]
  if (present.length === 0) return text => text
  // Longest first, so an email is replaced whole before a shorter value inside it.
  present.sort((a, b) => b.length - a.length)
  const pattern = new RegExp(present.map(escapeRegExp).join('|'), 'gi')
  return text => text.replace(pattern, ERASED_MEMBER)
}

/** Every string inside `value` through `fn`; keys are left as they are. */
function mapStrings(value: Json, fn: (text: string) => string): Json {
  if (typeof value === 'string') return fn(value)
  if (Array.isArray(value)) return value.map(v => mapStrings(v, fn))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]))
  }
  return value
}

/** Every leaf value inside `value` becomes the placeholder; null stays null, keys stay. */
function erased(value: Json): Json {
  if (value === null) return null
  if (Array.isArray(value)) return value.map(erased)
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, erased(v)]))
  return ERASED_MEMBER
}

/** The columns `eraseAuditRow` rewrites, with their Postgres types. */
export const AUDIT_ROW_REWRITES = { action: 'text', target_id: 'uuid', payload: 'jsonb' } as const

/** The new `action`, `target_id` and `payload` of one `audit_log` row naming `member`. */
export function eraseAuditRow(
  row: Record<string, unknown>,
  member: ErasedMember,
): { action: string; target_id: string; payload: Json } {
  const ids = scrubber([member.clientId, member.authUserId])
  const everything = scrubber([member.clientId, member.authUserId, member.email, member.name, member.phone])

  const aboutTheirRecord = row.target_table === 'clients' && row.target_id === member.clientId

  let payload = (row.payload ?? null) as Json
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload) && aboutTheirRecord) {
    payload = { ...payload }
    for (const key of ['from', 'to']) {
      if (key in payload) payload[key] = erased(payload[key]!)
    }
  }
  payload = mapStrings(payload, everything)

  const action = ids(String(row.action))
  const targetId = aboutTheirRecord ? NIL_ID : String(row.target_id)

  return { action, target_id: targetId, payload }
}
