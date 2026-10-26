import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterCommit, db } from '../../db'
import { deleteObject, publicObjectUrl, putObject, r2Bucket } from '../../lib/r2'
import { tenantKey } from '../../lib/object-key'
import { OFF_REQUEST_RETRY } from '../../lib/outbound'
import { reportError } from '../../shared/logger'
import { AppError, BadRequestError } from '../../shared/errors'

/**
 * A Profile picture: a member's on `clients`, a staff member's on
 * `staff_users`, each set by nobody but its owner.
 *
 * The browser crops and shrinks the picture; the server checks its type and
 * size only. Every upload is stored under a new random key, never over the old
 * one: the CDN caches an object for a year, and staging and production share the
 * bucket, so a key is never reused. The replaced object is deleted once the new
 * key has committed.
 */

/** Whose picture, by the table that holds it. The id is the caller's own row. */
export type PictureOwner = { tenantId: string; kind: 'member' | 'staff'; id: string }

const TABLES: Readonly<Record<PictureOwner['kind'], string>> = { member: 'clients', staff: 'staff_users' }

export const PROFILE_PICTURE_MAX_BYTES = 5 * 1024 * 1024

const TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export const PICTURE_TOO_LARGE = `A profile picture can be at most ${PROFILE_PICTURE_MAX_BYTES / (1024 * 1024)}MB.`

/** Store `bytes` as the owner's picture, and return its public URL. */
export async function setProfilePicture(
  owner: PictureOwner,
  file: { contentType: string; bytes: Uint8Array },
): Promise<string | null> {
  const extension = TYPES[file.contentType]
  if (!extension) {
    throw new BadRequestError('image_type_not_allowed', { message: 'A profile picture must be a JPG, PNG or WebP.' })
  }
  if (file.bytes.byteLength === 0) {
    throw new BadRequestError('image_empty', { message: 'That file is empty.' })
  }
  if (file.bytes.byteLength > PROFILE_PICTURE_MAX_BYTES) {
    throw new BadRequestError('image_too_large', { message: PICTURE_TOO_LARGE })
  }
  if (!r2Bucket()) {
    throw new AppError(422, 'image_storage_unavailable', {
      message: 'Picture storage is not configured. Ask an admin to set it up.',
    })
  }

  const key = tenantKey(owner.tenantId, `avatars/${randomUUID()}.${extension}`)
  await putObject(key, file.bytes, file.contentType)
  await replaceKey(owner, key)
  return publicObjectUrl(key)
}

/** Clear the owner's picture: their initials show instead. */
export async function removeProfilePicture(owner: PictureOwner): Promise<void> {
  await replaceKey(owner, null)
}

/**
 * Delete a picture object once the transaction that let go of it commits. For
 * a row that goes with its picture, such as a member deleted for good.
 */
export function forgetPicture(tenantId: string, key: string | null): void {
  // A key outside this studio's folder is not this studio's to delete: one
  // from before the prefix, or one that names another studio's object.
  if (!key?.startsWith(tenantKey(tenantId, ''))) return
  afterCommit(() => deleteUnreferenced(tenantId, key))
}

/** Point the owner's row at `key`, under a lock on it, and forget what it held. */
async function replaceKey(owner: PictureOwner, key: string | null): Promise<void> {
  const table = sql.identifier(TABLES[owner.kind])
  const [row] = await db.execute<{ replaced: string | null }>(sql`
    UPDATE ${table} AS t
    SET photo_r2_key = ${key}, updated_at = now()
    FROM (
      SELECT id, photo_r2_key FROM ${table}
      WHERE tenant_id = ${owner.tenantId} AND id = ${owner.id}
      FOR UPDATE
    ) AS was
    WHERE t.id = was.id
    RETURNING was.photo_r2_key AS replaced`)
  // Invariant: the owner is the signed-in caller, whose row exists.
  if (!row) throw new Error(`no ${TABLES[owner.kind]} row ${owner.id} to hold a picture`)
  forgetPicture(owner.tenantId, row.replaced)
}

/**
 * A failed delete is retried off the request, so the reply does not wait on
 * the bucket and the object is not left behind without a word.
 */
async function deleteUnreferenced(tenantId: string, key: string): Promise<void> {
  await deleteObject(tenantId, key).catch(() => {
    void deleteObject(tenantId, key, { retry: OFF_REQUEST_RETRY }).catch(err =>
      reportError(err, 'profile picture: removing a replaced picture failed', { key }),
    )
  })
}
