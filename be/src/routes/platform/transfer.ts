import { Hono } from 'hono'
import { exportTenant, importTenant } from '../../services/tenants/transfer'
import {
  ArchiveError,
  archiveFilename,
  packArchive,
  unpackArchive,
} from '../../services/tenants/transfer-archive'
import { loadTenantById } from '../../services/tenants/tenants'
import { logger } from '../../shared/logger'

/**
 * Taking a studio out of the platform, and putting it back.
 *
 * Two routes, both about one studio and both reachable only by a platform
 * administrator — the same gate as the rest of this branch. A studio's own
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
 */
app.get('/tenants/:id/export', async c => {
  const tenantId = c.req.param('id')
  const tenant = await loadTenantById(tenantId)
  if (!tenant) return c.json({ error: 'not_found' }, 404)

  const archive = await exportTenant(tenantId)
  const bytes = await packArchive(archive)

  logger.info(
    {
      tenant: tenant.slug,
      rows: Object.values(archive.manifest.counts).reduce((a, b) => a + b, 0),
      bytes: bytes.length,
      by: c.get('platformAdminEmail'),
    },
    'tenant exported',
  )

  const filename = archiveFilename(tenant.slug, archive.manifest.exportedAt)
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
 * Put an archive back into an empty studio.
 *
 * The target is named in the URL and never read from the archive: restoring is
 * always *into* a studio the operator picked, so an archive can be renamed,
 * moved between environments, or used to clone a studio for testing without the
 * file deciding where its rows land.
 */
app.post('/tenants/:id/import', async c => {
  const tenantId = c.req.param('id')
  const tenant = await loadTenantById(tenantId)
  if (!tenant) return c.json({ error: 'not_found' }, 404)

  const form = await c.req.parseBody()
  const file = form.archive
  if (!(file instanceof File)) {
    return c.json({ error: 'archive_required', message: 'Attach the studio zip as `archive`.' }, 400)
  }

  let summary
  try {
    const archive = await unpackArchive(Buffer.from(await file.arrayBuffer()))
    summary = await importTenant(tenantId, archive)
  } catch (err) {
    if (err instanceof ArchiveError) {
      return c.json({ error: 'unreadable_archive', message: err.message }, 400)
    }
    // A studio that already has rows, or a schema the archive predates. Both are
    // the operator's to fix and both are worth saying out loud rather than
    // returning a bare 500.
    const message = err instanceof Error ? err.message : 'The import could not be completed.'
    logger.warn({ tenant: tenant.slug, err }, 'tenant import refused')
    return c.json({ error: 'import_refused', message }, 409)
  }

  logger.info(
    {
      tenant: tenant.slug,
      from: summary.sourceTenant.slug,
      rows: summary.total,
      remapped: summary.remapped,
      by: c.get('platformAdminEmail'),
    },
    'tenant imported',
  )

  return c.json({
    imported: summary.total,
    tables: summary.written,
    from: { slug: summary.sourceTenant.slug, name: summary.sourceTenant.name },
    // Whether this was a copy beside a studio that is still here, or a restore
    // of one that is gone. The operator asked for the same thing either way, but
    // only one of them left the source studio's rows in place.
    remapped: summary.remapped,
  })
})

export default app
