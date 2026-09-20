import JSZip from 'jszip'
import {
  ARCHIVE_VERSION,
  ArchiveError,
  type MemberArchive,
  type TenantArchive,
  type TenantManifest,
} from './transfer-shape'

export { ArchiveError }

/**
 * The archive on disk: a zip a person can open.
 *
 * `manifest.json` at the root and one `tables/<name>.json` per table, rather
 * than a single blob, because the thing a studio owner most often wants from an
 * export is to *read* it — how many members, what the packages were — and that
 * should not require this codebase. It also means a table that fails to parse
 * names itself.
 *
 * Dates are ISO strings and everything else is whatever `JSON.stringify` makes
 * of the Postgres value. That is lossless for the column types in this schema
 * (uuid, text, numeric-as-string, timestamptz, jsonb, arrays) because the driver
 * hands them over already parsed, and Postgres accepts each back in the same
 * form on the way in.
 */

const MANIFEST = 'manifest.json'
const TABLE_DIR = 'tables'

/**
 * Pack an archive — a whole studio, or one member of it — into zip bytes.
 *
 * `date` stamps every entry. Left out, the zip library stamps the current time,
 * so two packs of one archive differ; a caller that must produce the same bytes
 * from the same inputs (the Mindbody transform) passes its own fixed moment.
 */
export async function packArchive(
  archive: TenantArchive | MemberArchive,
  options: { date?: Date } = {},
): Promise<Buffer> {
  const zip = new JSZip()
  // `createFolders: false` because the folder entry the library would add for
  // `tables/` carries its own timestamp; it is written once, stamped the same.
  const entry = { createFolders: false, ...(options.date ? { date: options.date } : {}) }
  zip.file(MANIFEST, JSON.stringify(archive.manifest, null, 2), entry)
  zip.file(`${TABLE_DIR}/`, null, { ...entry, dir: true })

  for (const table of archive.manifest.tables) {
    zip.file(`${TABLE_DIR}/${table}.json`, JSON.stringify(archive.rows[table] ?? [], null, 2), entry)
  }

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    // A studio's data is overwhelmingly repeated text — the same class name on
    // every booking — so this is worth the seconds it costs.
    compressionOptions: { level: 6 },
  })
}

/**
 * Read zip bytes back into an archive.
 *
 * Every failure here is somebody handing us a file, so each one says what was
 * wrong with *the file* rather than throwing whatever the zip library threw.
 */
export async function unpackArchive(bytes: Buffer | Uint8Array): Promise<TenantArchive> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new ArchiveError('That file is not a zip archive.')
  }

  const manifestFile = zip.file(MANIFEST)
  if (!manifestFile) {
    throw new ArchiveError(`This zip has no ${MANIFEST}, so it is not a studio export.`)
  }

  let manifest: TenantManifest
  try {
    manifest = JSON.parse(await manifestFile.async('string')) as TenantManifest
  } catch {
    throw new ArchiveError(`${MANIFEST} is not readable JSON.`)
  }

  if (manifest.version !== ARCHIVE_VERSION) {
    throw new ArchiveError(
      `This archive was written by a different version of the platform (${manifest.version}, expected ${ARCHIVE_VERSION}).`,
    )
  }
  // A member's export is the same zip, and restoring one as a studio would
  // replay a handful of rows in no particular order.
  if ((manifest as { kind?: string }).kind === 'member') {
    throw new ArchiveError('This is one member’s data export, not a studio export.')
  }
  if (!Array.isArray(manifest.tables)) {
    throw new ArchiveError(`${MANIFEST} does not list any tables.`)
  }

  const rows: Record<string, Record<string, unknown>[]> = {}
  for (const table of manifest.tables) {
    const file = zip.file(`${TABLE_DIR}/${table}.json`)
    if (!file) throw new ArchiveError(`The archive is missing ${TABLE_DIR}/${table}.json.`)

    let parsed: unknown
    try {
      parsed = JSON.parse(await file.async('string'))
    } catch {
      throw new ArchiveError(`${TABLE_DIR}/${table}.json is not readable JSON.`)
    }
    if (!Array.isArray(parsed)) {
      throw new ArchiveError(`${TABLE_DIR}/${table}.json should be a list of rows.`)
    }

    // The manifest's own count is the check that the file is whole. A zip that
    // was truncated mid-write still opens; a table short of its rows does not
    // announce itself any other way, and a half-restored studio is worse than a
    // refused one.
    const expected = manifest.counts?.[table]
    if (typeof expected === 'number' && expected !== parsed.length) {
      throw new ArchiveError(
        `${TABLE_DIR}/${table}.json holds ${parsed.length} rows but the manifest says ${expected} — the archive is incomplete.`,
      )
    }
    rows[table] = parsed as Record<string, unknown>[]
  }

  return { manifest, rows }
}

/** `{slug}-2026-09-05.zip` — sortable, and says whose it is. */
export function archiveFilename(slug: string, exportedAt: string): string {
  const day = exportedAt.slice(0, 10)
  return `${slug}-${day}.zip`
}

/** `{slug}-member-1a2b3c4d-2026-09-05.zip` — a member's id, not their name, in a filename. */
export function memberArchiveFilename(slug: string, clientId: string, exportedAt: string): string {
  return `${slug}-member-${clientId.slice(0, 8)}-${exportedAt.slice(0, 10)}.zip`
}
