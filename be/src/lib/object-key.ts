/**
 * Where a tenant's objects live: `t/<tenant id>/…`.
 *
 * The bucket is one bucket and the keys are guessable by design, so without a
 * tenant in the path one studio's uploads sit in the same namespace as another's
 * — a merch photo at `merch/<id>.jpg` is addressable by anyone who can guess an
 * id, and a listing is a list of everybody's files. Foldering per tenant makes
 * the boundary visible in the object store the way `tenant_id` makes it visible
 * in the database, and gives an operator something to grant, audit, lifecycle or
 * delete per studio.
 *
 * Keys already written stay valid: they are STORED on the row that owns them and
 * read back from there, never recomputed. Only new uploads take this prefix.
 *
 * Its own module — no database, no env, no SDK — because the leave rules build a
 * key and are deliberately decidable without any of those (see
 * services/leave/rules.ts).
 */
import { BadRequestError } from '../shared/errors'

export function tenantKey(tenantId: string, path: string): string {
  return `t/${tenantId}/${path.replace(/^\/+/, '')}`
}

/**
 * May this tenant name this object key?
 *
 * Some keys arrive from the caller rather than from an upload here — workshop
 * covers are chosen by an admin and sent as strings — so a studio could
 * otherwise mount another studio's object in its own gallery just by typing its
 * path. A key under somebody else's prefix is refused.
 *
 * Keys with no prefix at all are accepted: they predate the prefix and are still
 * stored on live rows, and refusing them would make an existing workshop
 * un-editable. Nothing writes one any more.
 */
export function keyBelongsToTenant(tenantId: string, key: string): boolean {
  if (!key.startsWith('t/')) return true
  return key.startsWith(`t/${tenantId}/`)
}

/**
 * The same check, as the refusal every write path owes it. Every column holding
 * a caller-named key goes through this — a workshop's cover and gallery, an
 * instructor's photo — because a single unchecked one is the whole hole.
 */
export function assertOwnObjectKeys(
  tenantId: string,
  keys: readonly (string | null | undefined)[],
): void {
  for (const key of keys) {
    if (key && !keyBelongsToTenant(tenantId, key)) {
      throw new BadRequestError('object_key_not_owned', {
        message: 'That file does not belong to this studio.',
      })
    }
  }
}
