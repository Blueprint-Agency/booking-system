import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { and, eq, lte, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from '../../../src/test/harness'
import { withEnv } from '../../../src/test/with-env'

const OPERATOR = 'mindbody-waitlist-operator@platform.test'

/**
 * The live waitlists brought across (#311), end to end: the fixture reports
 * plus a scraped Class Waitlists file go through the transform, the zip
 * through the super portal's import, and then the platform is asked as a
 * member and an admin would ask it. Beside `import.test.ts`, which is the rest
 * of the migration's journeys; the fixture studio and its people are invented.
 */
describe('a Mindbody studio\'s waitlists, transformed and imported', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  withEnv({ PLATFORM_ADMIN_EMAIL: OPERATOR })

  let harness!: TestApp
  let schema!: typeof import('../../../src/db/schema')
  let provision!: typeof import('../../../src/services/tenants/provision')
  let transform!: typeof import('./transform')
  let operator!: Record<string, string>

  const FIXTURES = path.join(__dirname, 'fixtures')
  const run = Date.now().toString(36)
  let studios = 0
  const copies: string[] = []

  before(async () => {
    harness = await startTestApp()
    schema = await import('../../../src/db/schema')
    provision = await import('../../../src/services/tenants/provision')
    transform = await import('./transform')
    operator = await harness.signInAs('platform', OPERATOR, null)
    await deleteStudios('mbw-%', 60 * 60 * 1000)
  })

  after(async () => {
    if (!harness) return
    await deleteStudios(`mbw-${run}-%`)
    for (const dir of copies) rmSync(dir, { recursive: true, force: true })
    await harness.close()
  })

  async function deleteStudios(pattern: string, olderThanMs = 0) {
    const { deleteTenant } = await import('../../../src/services/tenants/delete')
    const cutoff = new Date(Date.now() - olderThanMs)
    const doomed = await harness.db
      .select({ id: schema.tenants.id, slug: schema.tenants.slug })
      .from(schema.tenants)
      .where(and(sql`${schema.tenants.slug} LIKE ${pattern}`, lte(schema.tenants.createdAt, cutoff)))
    for (const studio of doomed) {
      await harness.db.update(schema.tenants).set({ status: 'suspended' }).where(eq(schema.tenants.id, studio.id))
      await deleteTenant({ tenantId: studio.id, confirmSlug: studio.slug })
    }
  }

  /** The fixture's reports, with a Class Waitlists workbook of `[client id, position]` on its Hatha of 9 January 2090. */
  async function reportsWithWaitlist(waiting: [string, number][]) {
    const { writeXlsx } = await import('../download/xlsx-write')
    const { waitlistSheet } = await import('../download/waitlists')
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mb-waitlists-'))
    copies.push(dir)
    cpSync(path.join(FIXTURES, 'reports'), dir, { recursive: true })
    const cls = { date: { year: 2090, month: 1, day: 9 }, start: { hour: 19, minute: 0 }, description: 'Hatha', staff: 'IVY INSTRUCTOR' }
    const rows = waitlistSheet([{ cls, waiting: waiting.map(([clientId, position]) => ({ clientId, client: '', position, paymentStatus: 'Unpaid' })) }])
    mkdirSync(path.join(dir, 'Clients', '45 Class Waitlists'), { recursive: true })
    writeFileSync(path.join(dir, 'Clients', '45 Class Waitlists', '45 Class Waitlists.xlsx'), await writeXlsx(rows, 'Class Waitlists'))
    return dir
  }

  /**
   * A studio imported with Jane waiting first and Rick second on the 9 January
   * Hatha, which one seat makes full: Pat already holds it. Decision 21 as `enabled` says.
   */
  async function importedStudio(enabled: boolean) {
    const slug = `mbw-${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({ slug, name: 'Mindbody Waitlist Fixture' })
    const config = JSON.parse(readFileSync(path.join(FIXTURES, 'config.json'), 'utf8')) as Record<string, any>
    config.studio.slug = slug
    config.originPatterns = process.env.TENANT_ORIGIN_PATTERNS
    config.waitlist = { enabled, capacity: 5, classTypes: {} }
    config.classTypes.find((t: { name: string }) => t.name === 'Hatha').capacity = 1
    const out = await transform.transformMindbody({
      reportsDir: await reportsWithWaitlist([['100000002', 2], ['100000001', 1]]),
      config,
      tenantId: tenant.id,
      local: true,
    })
    const form = new FormData()
    form.append('archive', new File([new Uint8Array(out.zip)], 'studio.zip', { type: 'application/zip' }))
    const res = await harness.app.request(`/api/v1/platform/tenants/${tenant.id}/import`, { method: 'POST', headers: operator, body: form })
    assert.equal(res.status, 200, await res.clone().text())
    const classId = String(out.archive.rows.classes!.find(c => c.starts_at === '2090-01-09T11:00:00.000Z')!.id)
    return { tenant, slug, classId, expected: out.expected, ids: out.ids }
  }

  const get = (url: string, headers: Record<string, string>) => harness.app.request(url, { headers })
  const json = async (res: Response) => {
    assert.equal(res.status, 200, await res.clone().text())
    return (await res.json()) as Record<string, any>
  }
  const publicDetail = async (slug: string, classId: string) =>
    json(await harness.app.request(`/api/v1/public/classes/${classId}`, { headers: { 'X-Tenant-Slug': slug } }))

  test('an imported queue promotes on the first cancel: the head of the line gets the freed seat', async () => {
    const studio = await importedStudio(true)

    // Imported as Mindbody had it: the class full, two waiting, the switch on.
    const detail = await publicDetail(studio.slug, studio.classId)
    assert.deepEqual(
      [detail.waitlist.enabled, detail.waitlist.capacity, detail.waitlist.waiting],
      [true, 5, 2],
      JSON.stringify(detail.waitlist),
    )
    const jane = await harness.signInAs('client', 'jane.doe@example.test', studio)
    const rick = await harness.signInAs('client', 'rick.roe@example.test', studio)
    const lines = async (who: Record<string, string>) => (await json(await get('/api/v1/me/waitlist', who))).entries as { class_id: string; position: number }[]
    assert.deepEqual((await lines(jane)).map(e => [e.class_id, e.position]), [[studio.classId, 1]])
    assert.deepEqual((await lines(rick)).map(e => [e.class_id, e.position]), [[studio.classId, 2]])

    // Verify, straight after the import, finds every place in every line.
    const exported = await get(`/api/v1/platform/tenants/${studio.tenant.id}/export`, operator)
    assert.equal(exported.status, 200)
    assert.deepEqual(await transform.verifyImport(studio.expected, Buffer.from(await exported.arrayBuffer())), [])

    // The seat Pat holds is cancelled by the studio.
    const [pat] = await harness.db
      .select({ id: schema.bookings.id })
      .from(schema.bookings)
      .where(and(eq(schema.bookings.classId, studio.classId), eq(schema.bookings.state, 'confirmed')))
    const owner = await harness.signInAs('staff', 'owner@example.test', studio)
    const cancelled = await harness.app.request(`/api/v1/portal/admin/bookings/${pat!.id}/cancel`, { method: 'POST', headers: owner })
    assert.equal(cancelled.status, 200, await cancelled.clone().text())

    // Jane, first in line, now holds the seat, paid from her imported Class Pack; Rick moves up.
    const seated = await harness.db
      .select({ clientId: schema.bookings.clientId, seat: schema.bookings.seat, packageId: schema.bookings.clientPackageId })
      .from(schema.bookings)
      .where(and(eq(schema.bookings.classId, studio.classId), eq(schema.bookings.state, 'confirmed')))
    assert.deepEqual(seated.map(s => [s.clientId, s.seat]), [[studio.ids.clients!['100000001'], 'online']])
    assert.ok(seated[0]!.packageId, 'paid by her package, as a booking of her own would be')
    assert.deepEqual(await lines(jane), [])
    assert.deepEqual((await lines(rick)).map(e => [e.class_id, e.position]), [[studio.classId, 1]])
    const [entry] = await harness.db
      .select({ status: schema.waitlistEntries.status })
      .from(schema.waitlistEntries)
      .where(and(eq(schema.waitlistEntries.classId, studio.classId), eq(schema.waitlistEntries.clientId, studio.ids.clients!['100000001']!)))
    assert.equal(entry!.status, 'promoted')
  })

  test('a studio that said no to waitlists imports with the switch off: a full class offers no line', async () => {
    const studio = await importedStudio(false)
    const detail = await publicDetail(studio.slug, studio.classId)
    assert.equal(detail.waitlist.enabled, false, JSON.stringify(detail.waitlist))
    assert.equal(detail.waitlist.open, false, 'the member app reads "Full", not "Join waitlist"')
    // Its imported line is still the studio's: nobody is evicted by a setting (spec-waitlist.md §8).
    assert.equal(detail.waitlist.waiting, 2)
  })
})
