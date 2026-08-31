import { and, asc, eq, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { merch } from '../../db/schema/catalog'
import { publicObjectUrl, putObject, R2_BUCKET } from '../../lib/r2'
import { tenantKey } from '../../lib/object-key'
import { AppError, BadRequestError, NotFoundError } from '../../shared/errors'

export type MerchRow = typeof merch.$inferSelect

/** 5MB, and only real image types — the client app renders these inline. */
const IMAGE_MAX_BYTES = 5 * 1024 * 1024
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export function serializeMerch(row: MerchRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    price_sgd: row.priceSgd,
    image_url: publicObjectUrl(row.imageR2Key),
    archived_at: row.archivedAt,
  }
}

export async function listMerch(
  tenantId: string,
  opts: { includeArchived: boolean },
): Promise<MerchRow[]> {
  return db
    .select()
    .from(merch)
    .where(
      and(eq(merch.tenantId, tenantId), opts.includeArchived ? undefined : isNull(merch.archivedAt)),
    )
    .orderBy(asc(merch.title))
}

export async function getMerch(tenantId: string, id: string): Promise<MerchRow> {
  const [row] = await db
    .select()
    .from(merch)
    .where(and(eq(merch.tenantId, tenantId), eq(merch.id, id)))
    .limit(1)
  if (!row) throw new NotFoundError('merch_not_found')
  return row
}

export async function createMerch(
  tenantId: string,
  input: {
    title: string
    description: string | null
    priceSgd: string
  },
): Promise<MerchRow> {
  const [row] = await db
    .insert(merch)
    .values({ ...input, tenantId })
    .returning()
  return row!
}

export async function updateMerch(
  tenantId: string,
  id: string,
  patch: Partial<Pick<MerchRow, 'title' | 'description' | 'priceSgd' | 'archivedAt'>>,
): Promise<MerchRow> {
  await getMerch(tenantId, id) // 404 if missing
  const [row] = await db
    .update(merch)
    .set(patch)
    .where(and(eq(merch.tenantId, tenantId), eq(merch.id, id)))
    .returning()
  return row!
}

export async function deleteMerch(tenantId: string, id: string): Promise<void> {
  await getMerch(tenantId, id)
  await db.delete(merch).where(and(eq(merch.tenantId, tenantId), eq(merch.id, id)))
}

/**
 * Replace the item's photo. The upload comes THROUGH the API so type and size
 * are checked on the server, and the key is written only after the object is in
 * the bucket — a failed upload leaves the row pointing at the old photo rather
 * than at nothing. The key is deterministic, so re-uploading replaces.
 */
export async function setMerchImage(input: {
  tenantId: string
  id: string
  contentType: string
  bytes: Uint8Array
}): Promise<MerchRow> {
  const row = await getMerch(input.tenantId, input.id)
  const extension = IMAGE_TYPES[input.contentType]
  if (!extension) {
    throw new BadRequestError('image_type_not_allowed', {
      message: 'A merch photo must be a JPG, PNG or WebP.',
    })
  }
  if (input.bytes.byteLength === 0) {
    throw new BadRequestError('image_empty', { message: 'That file is empty.' })
  }
  if (input.bytes.byteLength > IMAGE_MAX_BYTES) {
    throw new BadRequestError('image_too_large', {
      message: `A merch photo can be at most ${IMAGE_MAX_BYTES / (1024 * 1024)}MB.`,
    })
  }
  if (!R2_BUCKET) {
    throw new AppError(422, 'image_storage_unavailable', {
      message: 'Image storage is not configured. Ask an admin to set it up.',
    })
  }

  // Under the studio's own prefix, so one studio's photos are not addressable
  // from another's namespace. Keys already stored on existing rows keep working
  // — they are read back off the row, never recomputed.
  const key = tenantKey(input.tenantId, `merch/${row.id}.${extension}`)
  await putObject(key, input.bytes, input.contentType)
  const [updated] = await db
    .update(merch)
    .set({ imageR2Key: key })
    .where(and(eq(merch.tenantId, input.tenantId), eq(merch.id, row.id)))
    .returning()
  return updated!
}

export const MERCH_IMAGE_MAX_BYTES = IMAGE_MAX_BYTES
