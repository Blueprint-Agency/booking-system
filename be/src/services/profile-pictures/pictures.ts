import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterCommit, db } from '../../db'
import { instructors } from '../../db/schema/catalog'
import { clients, staffUsers } from '../../db/schema/identity'
import { IMAGE_EXTENSIONS } from '../../lib/image-types'
import { deleteUnreferencedObject, publicObjectUrl, putObject, r2Bucket } from '../../lib/r2'
import { tenantKey } from '../../lib/object-key'
import { AppError, BadRequestError } from '../../shared/errors'

/**
 * A Profile picture: a member's on `clients`, a staff member's on
 * `staff_users`, each set by nobody but its owner.
 *
 * The browser crops and shrinks the picture; the server checks its type and
 * size only. Every upload is stored under a new random key, never over the old
 * one: the CDN caches a picture for a day, and staging and production share the
 * bucket, so a key is never reused. The replaced object is deleted once the new
 * key has committed.
 */

/** Whose picture, by the table that holds it. The id is the caller's own row. */
export type PictureOwner = { tenantId: string; kind: 'member' | 'staff'; id: string }

export const PROFILE_PICTURE_MAX_BYTES = 5 * 1024 * 1024

export const PICTURE_TOO_LARGE = `A profile picture can be at most ${PROFILE_PICTURE_MAX_BYTES / (1024 * 1024)}MB.`

/** Store `bytes` as the owner's picture, and return its public URL. */
export async function setProfilePicture(
  owner: PictureOwner,
  file: { contentType: string; bytes: Uint8Array },
): Promise<string> {
  const extension = IMAGE_EXTENSIONS[file.contentType]
  if (!extension) {
    throw new BadRequestError('image_type_not_allowed', { message: 'A profile picture must be a JPG, PNG or WebP.' })
  }
  if (file.bytes.byteLength === 0) {
    throw new BadRequestError('image_empty', { message: 'That file is empty.' })
  }
  if (file.bytes.byteLength > PROFILE_PICTURE_MAX_BYTES) {
    throw new BadRequestError('image_too_large', { message: PICTURE_TOO_LARGE })
  }
  const key = tenantKey(owner.tenantId, `avatars/${randomUUID()}.${extension}`)
  // Null when the bucket has no public host: a picture nobody could see.
  const url = publicObjectUrl(key)
  if (!r2Bucket() || !url) {
    throw new AppError(422, 'image_storage_unavailable', {
      message: 'Picture storage is not configured. Ask an admin to set it up.',
    })
  }

  await putObject(key, file.bytes, file.contentType)
  try {
    await replaceKey(owner, key)
  } catch (err) {
    await deleteUnreferencedObject(owner.tenantId, key, {
      message: 'profile picture: removing an upload whose save failed',
      context: { key },
    })
    throw err
  }
  return url
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
  afterCommit(() =>
    deleteUnreferencedObject(tenantId, key, {
      message: 'profile picture: removing a replaced picture failed',
      context: { key },
    }),
  )
}

/** Point the owner's row at `key`, under a lock on it, and forget what it held. */
async function replaceKey(owner: PictureOwner, key: string | null): Promise<void> {
  const table = owner.kind === 'member' ? clients : staffUsers
  const ownRow = and(eq(table.tenantId, owner.tenantId), eq(table.id, owner.id))
  const [row] = await db.select({ replaced: table.photoR2Key }).from(table).where(ownRow).for('update')
  // Invariant: the owner is the signed-in caller, whose row exists.
  if (!row) throw new Error(`no ${owner.kind} row ${owner.id} to hold a picture`)
  await db.update(table).set({ photoR2Key: key, updatedAt: new Date() }).where(ownRow)
  if (owner.kind === 'staff') {
    // The build before this one reads an instructor's picture here. Written in
    // the same save, it still shows after a rollback, and never names the
    // object deleted below.
    await db
      .update(instructors)
      .set({ photoR2Key: key })
      .where(and(eq(instructors.tenantId, owner.tenantId), eq(instructors.staffUserId, owner.id)))
  }
  forgetPicture(owner.tenantId, row.replaced)
}
