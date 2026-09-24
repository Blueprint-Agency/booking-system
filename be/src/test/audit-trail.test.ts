import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { studioFixtures, type Studio } from './studio-fixtures'

const run = Date.now().toString(36)
const OPERATOR = `operator-${run}@audit-trail.test`
// Read when the platform-admin middleware loads, so set before the app is imported.
process.env.PLATFORM_ADMIN_EMAIL = OPERATOR

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE
// The instant every rule that reads the clock sees: booking, cancelling, adjusting.
const NOW = new Date(Math.floor(Date.now() / MINUTE) * MINUTE)

/**
 * The audit trail and the edges of a studio (#268): every successful change an
 * Admin or Instructor makes leaves an audit row naming them, no route edits or
 * deletes one, a platform administrator's own session acts inside no studio,
 * and one studio's Admin lists none of another's rows.
 *
 * Every test runs in studios of its own (`studio-fixtures.ts`).
 */
describe('the audit trail and the edges of a studio', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let f!: Awaited<ReturnType<typeof studioFixtures>>
  let operator!: Record<string, string>

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    f = await studioFixtures(harness, schema, 'audit-trail')
    operator = await harness.signInAs('platform', OPERATOR, null)
    harness.clock.set(NOW)
  })

  after(async () => {
    if (!harness) return
    await harness.db.delete(schema.platformAuthUsers).where(eq(schema.platformAuthUsers.email, OPERATOR))
    await harness.close()
  })

  /** An admin, an instructor, a member holding ten credits booked on the instructor's class two days out. */
  const busyStudio = async () => {
    const studio = await f.freshStudio()
    const admin = await f.staffAt(studio, 'admin', 'admin')
    const teacher = await f.staffAt(studio, 'teacher', 'instructor')
    const member = await f.memberAt(studio, 'member')
    const pkg = await f.heldPackage(studio, member.id)
    const classId = await f.classAt(studio, teacher.id, new Date(NOW.getTime() + 2 * DAY))
    const bookingId = f.expectStatus(await f.book(member, classId), 201).booking_id as string
    return { studio, admin, teacher, member, pkg, classId, bookingId }
  }

  const packageRow = (id: string) => f.packageRow(id)
  const cancellationsOf = (bookingId: string) =>
    harness.db.select().from(schema.cancellations).where(eq(schema.cancellations.bookingId, bookingId))
  const classRow = async (id: string) => (await harness.db.select().from(schema.classes).where(eq(schema.classes.id, id)))[0]!

  describe('AUD-01 a successful state-changing admin request writes an audit row naming the actor', () => {
    test('AUD-01 a credit adjustment, a class cancel and a package grant each leave one row, stamped when it happened', async () => {
      const { studio, admin, member, pkg, classId } = await busyStudio()
      const catalogue = await f.catalogPackage(studio, { name: 'Five classes', credits: 5 })

      const requests: Array<{ path: string; body: unknown; target: (res: any) => { table: string; id: string }; status: number }> = [
        {
          path: `/portal/admin/clients/${member.id}/packages/${pkg.id}/adjust`,
          body: { delta: 2, reason: 'Goodwill' },
          target: () => ({ table: 'client_packages', id: pkg.id }),
          status: 200,
        },
        {
          path: `/portal/admin/schedule/classes/${classId}/cancel`,
          body: {},
          target: () => ({ table: 'classes', id: classId }),
          status: 200,
        },
        {
          path: `/portal/admin/clients/${member.id}/packages/issue`,
          body: { package_kind: 'class', package_id: catalogue.id, reason: 'Class cancelled on them' },
          target: res => ({ table: 'client_packages', id: res.client_package_id }),
          status: 201,
        },
      ]
      for (const { path, body, target, status } of requests) {
        // Wall clock, not the harness's: `created_at` is Postgres's own `now()`.
        const sentAt = Date.now()
        const res = f.expectStatus(await f.send(path, { body, headers: admin.headers }), status)
        const row = await f.expectAudit(studio, admin, `POST /api/v1${path}`, target(res))
        assert.deepEqual(row.payload, { method: 'POST', path: `/api/v1${path}` })
        const at = row.createdAt.getTime()
        assert.ok(at >= sentAt - 1_000 && at <= Date.now() + 1_000, `stamped when the request ran: ${row.createdAt.toISOString()}`)
      }

      // And each change really happened.
      assert.equal((await packageRow(pkg.id)).creditsOrSessionsRemaining, 9 + 2 + 1, 'ten, one spent, two given, one returned by the cancel')
      assert.equal((await classRow(classId)).lifecycle, 'cancelled')
      const held = await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.clientId, member.id))
      assert.equal(held.filter(p => p.sourceClassPackageId === catalogue.id && p.complimentary).length, 1)
    })

    test('AUD-01 a refused request writes no row: a wrong role, another studio, a rule broken', async () => {
      const { studio, admin, teacher, member, pkg, classId } = await busyStudio()
      const catalogue = await f.catalogPackage(studio, { name: 'Five classes', credits: 5 })
      const elsewhere = await f.freshStudio()
      const outsider = await f.staffAt(elsewhere, 'admin', 'admin')
      const before = await f.auditRowsAt(studio)
      const heldBefore = await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.clientId, member.id))

      const requests: Array<[string, unknown]> = [
        [`/portal/admin/clients/${member.id}/packages/${pkg.id}/adjust`, { delta: 2, reason: 'x' }],
        [`/portal/admin/schedule/classes/${classId}/cancel`, {}],
        [`/portal/admin/clients/${member.id}/packages/issue`, { package_kind: 'class', package_id: catalogue.id, reason: 'x' }],
      ]
      for (const [path, body] of requests) {
        f.expectStatus(await f.send(path, { body, headers: teacher.headers }), 403)
        f.expectStatus(await f.send(path, { body, headers: outsider.headers }), 404)
      }
      f.expectStatus(
        await f.send(requests[0]![0], { body: { delta: -50, reason: 'x' }, headers: admin.headers }),
        400,
        'balance_cannot_go_negative',
      )

      assert.deepEqual(await f.auditRowsAt(studio), before)
      assert.deepEqual(await f.auditRowsAt(elsewhere), [])
      assert.equal((await packageRow(pkg.id)).creditsOrSessionsRemaining, 9)
      assert.equal((await classRow(classId)).lifecycle, 'active')
      assert.deepEqual(
        await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.clientId, member.id)),
        heldBefore,
        'no package was given',
      )
    })
  })

  describe('AUD-05 a class cancelled by its main instructor is recorded as the instructor\'s', () => {
    const cancelOwn = (headers: Record<string, string>, classId: string) =>
      f.send(`/portal/instructor/schedule/classes/${classId}/cancel`, { body: { reason: 'Lost my voice' }, headers })

    test('AUD-05 the cancellation source is instructor, and the audit row names the instructor', async () => {
      const { studio, teacher, member, pkg, classId, bookingId } = await busyStudio()

      assert.deepEqual(f.expectStatus(await cancelOwn(teacher.headers, classId), 200), { total_bookings: 1, refunded_count: 1 })

      const [cancellation] = await cancellationsOf(bookingId)
      assert.equal(cancellation?.source, 'instructor')
      assert.equal(cancellation?.clientId, member.id)
      const cls = await classRow(classId)
      assert.equal(cls.lifecycle, 'cancelled')
      assert.equal(cls.cancelledByStaffId, teacher.id)
      assert.equal((await packageRow(pkg.id)).creditsOrSessionsRemaining, 10, 'the credit came back')
      await f.expectAudit(studio, teacher, `POST /api/v1/portal/instructor/schedule/classes/${classId}/cancel`, { table: 'classes', id: classId })
    })

    test('AUD-05 an admin cancelling the same kind of class is recorded as admin', async () => {
      const { studio, admin, classId, bookingId } = await busyStudio()
      f.expectStatus(await f.send(`/portal/admin/schedule/classes/${classId}/cancel`, { body: {}, headers: admin.headers }), 200)
      const [cancellation] = await cancellationsOf(bookingId)
      assert.equal(cancellation?.source, 'admin')
      await f.expectAudit(studio, admin, `POST /api/v1/portal/admin/schedule/classes/${classId}/cancel`, { table: 'classes', id: classId })
    })

    test('AUD-05 an instructor who is not the main instructor, here or at another studio, is refused, and nothing is recorded', async () => {
      const { studio, classId, bookingId } = await busyStudio()
      const colleague = await f.staffAt(studio, 'colleague', 'instructor')
      const elsewhere = await f.freshStudio()
      const outsider = await f.staffAt(elsewhere, 'teacher', 'instructor')
      const before = await f.auditRowsAt(studio)

      f.expectStatus(await cancelOwn(colleague.headers, classId), 403, 'not_main_instructor')
      f.expectStatus(await cancelOwn(outsider.headers, classId), 404, 'class_not_found')

      assert.equal((await classRow(classId)).lifecycle, 'active')
      assert.deepEqual(await cancellationsOf(bookingId), [])
      assert.deepEqual(await f.auditRowsAt(studio), before)
      assert.deepEqual(await f.auditRowsAt(elsewhere), [])
    })
  })

  // Not AUD-06: that row promises no route deletes an audit row, and the
  // permanent member deletion (#144) does, by design (`member-data-retention.md`).
  // Left uncovered until the two docs are reconciled; this is the part that holds.
  test('no route is addressed to the audit trail, and guessing at one edits or deletes nothing', async () => {
    const { studio, admin, teacher, member, pkg } = await busyStudio()
    f.expectStatus(
      await f.send(`/portal/admin/clients/${member.id}/packages/${pkg.id}/adjust`, { body: { delta: 1, reason: 'Goodwill' }, headers: admin.headers }),
      200,
    )
    const rows = await f.auditRowsAt(studio)
    assert.ok(rows.length > 0)
    const row = rows.at(-1)!

    // Nothing the app serves is addressed to the audit trail at all.
    assert.ok(harness.app.routes.some(r => r.path === '/api/v1/portal/admin/clients/:id'), 'the route table is the mounted one')
    const auditRoutes = harness.app.routes.filter(r => /audit/i.test(r.path))
    assert.deepEqual(auditRoutes.map(r => `${r.method} ${r.path}`), [])

    // And a caller who guesses at one is refused: not found, or an instructor
    // turned away at the admin door before the path is looked at.
    const platformAt = { Authorization: operator.Authorization! }
    const callers: Array<[string, Record<string, string>]> = [
      ['admin', admin.headers],
      ['instructor', teacher.headers],
      ['platform', operator],
    ]
    const guesses = (who: string) =>
      who === 'platform'
        ? [`/platform/audit-log/${row.id}`, `/platform/tenants/${studio.id}/audit-log/${row.id}`, `/platform/audit/${row.id}`]
        : [`/portal/admin/audit-log/${row.id}`, `/portal/admin/audit/${row.id}`, `/portal/instructor/audit-log/${row.id}`]
    for (const [who, headers] of callers) {
      for (const path of guesses(who)) {
        for (const method of ['PATCH', 'PUT', 'DELETE']) {
          const res = await f.send(path, { method, body: method === 'DELETE' ? undefined : { action: 'rewritten' }, headers: who === 'platform' ? { ...headers, ...platformAt } : headers })
          const refusedWith = who === 'instructor' && path.startsWith('/portal/admin/') ? 403 : 404
          assert.equal(res.status, refusedWith, `${who} ${method} ${path}: ${JSON.stringify(res.body)}`)
        }
      }
    }

    // The mutating requests above were refused, so they added nothing either.
    assert.deepEqual(await f.auditRowsAt(studio), rows)
  })

  test('SUP-03 a platform administrator session is refused on the portal admin routes, and no business row is written', async () => {
    const { studio, member, pkg, classId, teacher } = await busyStudio()
    // The session is a real, allowlisted platform administrator's.
    f.expectStatus(await f.send('/platform/tenants', { headers: operator }), 200)
    const atStudio = { ...f.portalHeaders(studio), Authorization: operator.Authorization! }
    const snapshot = async () => ({
      pkg: await packageRow(pkg.id),
      cls: await classRow(classId),
      adjustments: await harness.db.select().from(schema.manualAdjustments).where(eq(schema.manualAdjustments.clientId, member.id)),
      audit: await f.auditRowsAt(studio),
    })
    const before = await snapshot()

    const attempts: Array<[string, string, unknown]> = [
      ['POST', `/portal/admin/clients/${member.id}/packages/${pkg.id}/adjust`, { delta: 5, reason: 'platform' }],
      ['PATCH', `/portal/admin/schedule/classes/${classId}`, { capacity_online: 1 }],
      ['POST', `/portal/admin/schedule/classes/${classId}/cancel`, {}],
      ['POST', `/portal/admin/clients/${member.id}/packages/${pkg.id}/refund`, { reason: 'platform' }],
      ['GET', `/portal/admin/clients/${member.id}`, undefined],
    ]
    for (const [method, path, body] of attempts) {
      const res = await f.send(path, { method, body, headers: atStudio })
      assert.equal(res.status, 401, `${method} ${path}: ${JSON.stringify(res.body)}`)
    }

    assert.deepEqual(await snapshot(), before)
    assert.equal((await classRow(classId)).mainInstructorId, teacher.id)
  })

  test('TEN-05 an admin listing Locations, Customers or Staff gets none of another studio\'s rows', async () => {
    const people = async (studio: Studio) => ({
      admin: await f.staffAt(studio, 'admin', 'admin'),
      teacher: await f.staffAt(studio, 'teacher', 'instructor'),
      member: await f.memberAt(studio, 'member'),
      blocked: await f.memberAt(studio, 'blocked', { deletedAt: new Date() }),
    })
    const a = await f.freshStudio()
    const b = await f.freshStudio()
    const inA = await people(a)
    const inB = await people(b)
    const [archivedB] = await harness.db
      .insert(schema.locations)
      .values({ tenantId: b.id, name: 'Old annex', archivedAt: new Date() })
      .returning()

    const listed = async (studio: Studio, headers: Record<string, string>) => ({
      locations: (f.expectStatus(await f.send('/portal/admin/locations?include_archived=true', { headers }), 200).locations as Array<{ id: string }>).map(l => l.id).sort(),
      clients: (f.expectStatus(await f.send('/portal/admin/clients?include_deleted=true&page_size=200', { headers }), 200).clients as Array<{ id: string }>).map(c => c.id).sort(),
      staff: (f.expectStatus(await f.send('/portal/admin/staff', { headers }), 200).staff as Array<{ id: string }>).map(s => s.id).sort(),
    })

    // An instructor lists none of them.
    for (const path of ['/portal/admin/locations', '/portal/admin/clients', '/portal/admin/staff']) {
      f.expectStatus(await f.send(path, { headers: inA.teacher.headers }), 403)
    }

    for (const [studio, own, other] of [
      [a, inA, inB],
      [b, inB, inA],
    ] as const) {
      const seen = await listed(studio, own.admin.headers)
      const ownLocations = studio === b ? [studio.locationId, archivedB!.id] : [studio.locationId]
      assert.deepEqual(seen.locations, ownLocations.sort())
      assert.deepEqual(seen.clients, [own.member.id, own.blocked.id].sort())
      for (const id of [own.admin.id, own.teacher.id]) assert.ok(seen.staff.includes(id), `${studio.slug} did not list its own ${id}`)
      // Whatever else a list holds (the studio's first admin, still invited), it is this studio's.
      const staffRows = await harness.db.select().from(schema.staffUsers)
      for (const id of seen.staff) assert.equal(staffRows.find(r => r.id === id)?.tenantId, studio.id, `${studio.slug} listed staff ${id}`)
      const otherIds = [other.admin.id, other.teacher.id, other.member.id, other.blocked.id, (studio === a ? b : a).locationId]
      for (const id of otherIds) assert.ok(!JSON.stringify(seen).includes(id), `${studio.slug} listed ${id}`)
    }
  })
})
