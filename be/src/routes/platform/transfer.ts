import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { exportTenant } from '../../services/tenants/transfer'
import { ArchiveError, archiveFilename, packArchive } from '../../services/tenants/transfer-archive'
import {
  describeFailure,
  dismissImport,
  importNow,
  latestImport,
  openImports,
  receiveArchive,
  startImport,
  type ImportRequest,
} from '../../services/tenants/import-jobs'
import { loadTenantById } from '../../services/tenants/tenants'
import { ERROR_CODES } from '../../shared/error-codes'
import { AppError } from '../../shared/errors'
import { logger } from '../../shared/logger'

/**
 * Taking a studio out of the platform, and putting it back.
 *
 * Export, and import — the import both in one request and as a job the portal
 * can follow across reloads. All about one studio and all reachable only by a
 * platform administrator — the same gate as the rest of this branch. A studio's own
 * admins cannot export their studio from here; that is a different feature with
 * a different audience, and giving a studio a button that downloads every
 * member's details is a decision nobody has made.
 */
const app = new Hono()

/**
 * The whole studio, as a zip.
 *
 * Held in memory and sent in one piece rather than streamed. A studio is tens of
 * thousands of rows at the top end, which is megabytes — and a streamed export
 * that fails halfway produces a file that looks fine and is not, which is the
 * one outcome a backup must never have.
 *
 * `?include=passwords` adds each member's and staff member's password hash, so
 * a restore elsewhere lets them sign in with the password they have now. Only
 * when asked by name: a routine backup should not be a copy of everyone's
 * password, and the export is recorded in the studio's audit log when it is.
 */
const exportQuery = z.object({ include: z.enum(['passwords']).optional() })

app.get('/tenants/:id/export', zValidator('query', exportQuery), async c => {
  const tenantId = c.req.param('id')
  const tenant = await loadTenantById(tenantId)
  if (!tenant) return c.json({ error: ERROR_CODES.not_found }, 404)

  const by = c.get('platformAdminEmail')
  const withPasswords = c.req.valid('query').include === 'passwords'
  const archive = await exportTenant(tenantId, withPasswords ? { includePasswords: true, by } : {})
  const bytes = await packArchive(archive)

  logger.info(
    {
      tenant: tenant.slug,
      rows: Object.values(archive.manifest.counts).reduce((a, b) => a + b, 0),
      bytes: bytes.length,
      passwords: archive.manifest.passwords ?? null,
      by,
    },
    'tenant exported',
  )

  const filename = archiveFilename(tenant.slug, archive.manifest.exportedAt, { withPasswords })
  c.header('Content-Type', 'application/zip')
  c.header('Content-Disposition', `attachment; filename="${filename}"`)
  // The browser reads the filename off the header, and a cross-origin fetch
  // cannot see a header it was not offered.
  c.header('Access-Control-Expose-Headers', 'Content-Disposition')
  // Hono's body type wants an `ArrayBuffer`-backed view, and Node's `Buffer` is
  // backed by a shared pool, so this copies rather than casts. It is one extra
  // copy of an archive already held whole in memory.
  return c.newResponse(new Uint8Array(bytes))
})

/**
 * How an import meets the studio: `restore` (the default) into an empty one, or
 * `replace` (#339) over one that has rows, confirmed by its current Slug. The
 * same fields on the one-request form and the job's start.
 */
const importRequest = z
  .object({
    mode: z.enum(['restore', 'replace']).default('restore'),
    confirm_slug: z.string().max(255).optional(),
  })
  .transform((body): ImportRequest =>
    body.mode === 'replace' ? { mode: 'replace', confirmSlug: body.confirm_slug ?? '' } : { mode: 'restore' },
  )

/**
 * Put an archive back into an empty studio — or, with `mode=replace`, over the
 * studio's rows — in one request.
 *
 * The target is named in the URL and never read from the archive: restoring is
 * always *into* a studio the operator picked, so an archive can be renamed,
 * moved between environments, or used to clone a studio for testing without the
 * file deciding where its rows land.
 *
 * Kept for scripts and the Mindbody runbook, which want the summary as the
 * answer. The super portal uses the job routes below instead, so a reload does
 * not lose the import. It runs under a job row of its own, so it and a portal
 * import into the same studio refuse each other.
 */
app.post('/tenants/:id/import', async c => {
  const tenantId = z.string().uuid().safeParse(c.req.param('id'))
  if (!tenantId.success) return c.json({ error: ERROR_CODES.not_found }, 404)
  const tenant = await loadTenantById(tenantId.data)
  if (!tenant) return c.json({ error: ERROR_CODES.not_found }, 404)

  const form = await c.req.parseBody()
  const file = form.archive
  if (!(file instanceof File)) {
    return c.json({ error: ERROR_CODES.archive_required, message: 'Attach the studio zip as `archive`.' }, 400)
  }
  const request = importRequest.parse({ mode: form.mode, confirm_slug: form.confirm_slug })

  let summary
  try {
    summary = await importNow({
      tenantId: tenant.id,
      fileName: file.name || 'archive.zip',
      bytes: Buffer.from(await file.arrayBuffer()),
      by: c.get('platformAdminEmail'),
      request,
    })
  } catch (err) {
    if (err instanceof ArchiveError) {
      return c.json({ error: ERROR_CODES.unreadable_archive, message: err.message }, 400)
    }
    // Already named by the service, reason and all (`import_refused`, `not_found`).
    if (err instanceof AppError) throw err
    // Anything else the database refused mid-import. Still the operator's to
    // look at, and worth saying out loud rather than returning a bare 500.
    logger.warn({ tenant: tenant.slug, err }, 'tenant import refused')
    return c.json({ error: ERROR_CODES.import_refused, message: describeFailure(err).message }, 409)
  }

  logger.info(
    {
      tenant: tenant.slug,
      mode: summary.mode,
      from: summary.from.slug,
      rows: summary.imported,
      opened: summary.opened,
      remapped: summary.remapped,
      by: c.get('platformAdminEmail'),
    },
    'tenant imported',
  )

  return c.json(summary)
})

/*
 * The import as a job (`services/tenants/import-jobs.ts`): start it, send the
 * file, then read its progress back — from this page load or any later one.
 */

const uuid = z.string().uuid()
const startBody = z.object({
  file_name: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  mode: z.enum(['restore', 'replace']).optional(),
  confirm_slug: z.string().max(255).optional(),
})

/** Every studio's import that is running, or finished and not yet dismissed. */
app.get('/imports', async c => {
  return c.json({ imports: await openImports() })
})

/** Start an import: the job exists, waiting for its file. */
app.post('/tenants/:id/imports', zValidator('json', startBody), async c => {
  const tenantId = uuid.safeParse(c.req.param('id'))
  if (!tenantId.success) return c.json({ error: ERROR_CODES.not_found }, 404)
  const body = c.req.valid('json')
  const job = await startImport({
    tenantId: tenantId.data,
    fileName: body.file_name,
    size: body.size,
    by: c.get('platformAdminEmail'),
    request: importRequest.parse({ mode: body.mode, confirm_slug: body.confirm_slug }),
  })
  return c.json({ job }, 201)
})

/**
 * The file itself, as the raw request body (`application/zip`), not a form —
 * so it can be read as it arrives and its progress written back. Answers once
 * the file is whole and the import is running, not once it is done.
 */
app.put('/tenants/:id/imports/:jobId/archive', async c => {
  const tenantId = uuid.safeParse(c.req.param('id'))
  const jobId = uuid.safeParse(c.req.param('jobId'))
  if (!tenantId.success || !jobId.success) return c.json({ error: ERROR_CODES.not_found }, 404)
  const job = await receiveArchive({
    tenantId: tenantId.data,
    jobId: jobId.data,
    body: c.req.raw.body,
    signal: c.req.raw.signal,
  })
  return c.json({ job }, 202)
})

/** The studio's most recent import, whatever state it is in; null if none. */
app.get('/tenants/:id/imports/latest', async c => {
  const tenantId = uuid.safeParse(c.req.param('id'))
  if (!tenantId.success) return c.json({ error: ERROR_CODES.not_found }, 404)
  return c.json({ job: await latestImport(tenantId.data) })
})

/** Close a finished import's notice on the studio list. */
app.post('/tenants/:id/imports/:jobId/dismiss', async c => {
  const tenantId = uuid.safeParse(c.req.param('id'))
  const jobId = uuid.safeParse(c.req.param('jobId'))
  if (!tenantId.success || !jobId.success) return c.json({ error: ERROR_CODES.not_found }, 404)
  return c.json({ job: await dismissImport(tenantId.data, jobId.data) })
})

export default app
