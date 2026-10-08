import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { frontendOrigin, harnessAddress, integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { ownAccountId, type StripeFake } from './stripe-fake'
import { withEnv } from './with-env'

const run = Date.now().toString(36)
const DOMAIN = `${run}.gates.test`
const OPERATOR = `operator@${DOMAIN}`
// Not ending in " Bundle" / " Flow": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `Gates class type ${run}`
const BUNDLE_NAME = `Gates pass ${run}`
const HOUR = 60 * 60 * 1000

/**
 * The super portal and the studios, kept out of each other over real HTTP
 * (#364): a platform session cannot act inside a studio, a studio session
 * cannot see the platform, and neither has a way to rewrite a studio's audit
 * trail.
 *
 * "Nothing written" is read off the whole database, not off the rows a test
 * expects to be touched: every table's row count and newest row version
 * (`xmin`), before and after the refused calls. A refused request that wrote
 * anywhere at all — an insert, an update, a delete — moves one of them.
 */
describe('super portal gates', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  withEnv({ PLATFORM_ADMIN_EMAIL: OPERATOR })

  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let fake!: StripeFake
  let operator!: Record<string, string>

  type Reply = { status: number; body: any }
  type Studio = { id: string; slug: string }

  async function send(method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<Reply> {
    const res = await harness.app.request(path, {
      method,
      headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await res.text()
    let parsed: unknown = text
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      // Not JSON (an export's zip): the status is what is read.
    }
    return { status: res.status, body: parsed }
  }

  const expectRefusal = (reply: Reply, status: number, error: string, what: string) => {
    assert.equal(reply.status, status, `${what}: ${JSON.stringify(reply.body)}`)
    assert.equal(reply.body?.error, error, `${what}: ${JSON.stringify(reply.body)}`)
  }

  /** Every table's row count and newest row version: what any write would move. */
  async function snapshot(): Promise<Record<string, string>> {
    const tables = await harness.db.execute<{ t: string }>(sql`
      SELECT table_name AS t FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1
    `)
    const out: Record<string, string> = {}
    for (const { t } of tables) {
      const [row] = await harness.db.execute<{ n: number; x: string | null }>(
        sql`SELECT count(*)::int AS n, max(xmin::text::bigint)::text AS x FROM ${sql.identifier(t)}`,
      )
      out[t] = `${row!.n} rows, newest version ${row!.x}`
    }
    return out
  }

  /** The tables whose rows moved between two snapshots. */
  const moved = (from: Record<string, string>, to: Record<string, string>) =>
    Object.keys({ ...from, ...to })
      .filter(t => from[t] !== to[t])
      .map(t => `${t}: ${from[t]} -> ${to[t]}`)

  /** The app's own route table, one entry per method and path, middleware left out. */
  const routeTable = () => {
    const seen = new Set<string>()
    for (const r of harness.app.routes) if (r.method !== 'ALL') seen.add(`${r.method} ${r.path}`)
    return [...seen].sort().map(entry => {
      const [method, path] = entry.split(' ') as [string, string]
      return { method, path }
    })
  }

  /** `signedIn`'s session presented from `tenant`'s own frontend. */
  const sentTo = (signedIn: Record<string, string>, pool: 'client' | 'staff', tenant: Studio) => ({
    Authorization: signedIn.Authorization!,
    'X-Tenant-Slug': tenant.slug,
    Origin: frontendOrigin(pool, tenant),
    'X-Forwarded-For': harnessAddress(),
  })

  async function staffAt(at: Studio, name: string, role: 'admin' | 'instructor', email = `${name}-${at.slug}@${DOMAIN}`) {
    const headers = await harness.signInAs('staff', email, at)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(sql`${schema.staffAuthUsers.email} = ${email} AND ${schema.staffAuthUsers.tenantId} = ${at.id}`)
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: at.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') await harness.db.insert(schema.instructors).values({ tenantId: at.id, staffUserId: row!.id })
    return { staffId: row!.id, headers }
  }

  async function memberAt(at: Studio, name: string, email = `${name}-${at.slug}@${DOMAIN}`) {
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(sql`${schema.clientAuthUsers.email} = ${email} AND ${schema.clientAuthUsers.tenantId} = ${at.id}`)
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, headers }
  }

  /** Studios made for this file, deleted with everything they hold at the end. */
  const throwaways: Studio[] = []

  /** A studio of this file's own, open for business, so nothing here touches the two fixture Tenants' setup. */
  async function throwawayStudio(label: string): Promise<Studio> {
    const provision = await import('../services/tenants/provision')
    const tenants = await import('../services/tenants/tenants')
    const slug = `${label}-${run}`
    const { tenant } = await provision.provisionTenant({ slug, name: `Gates ${label}` })
    // A studio provisioned with nobody in it opens suspended.
    await tenants.setTenantStatus(tenant.id, 'active')
    const studio = { id: tenant.id, slug }
    throwaways.push(studio)
    return studio
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    const { installStripeFake } = await import('./stripe-fake')
    fake = installStripeFake()
    fake.ownAccount(harness.tenants.one)
    fake.ownAccount(harness.tenants.two)
    fake.reply('refunds.create', () => ({ id: `re_${randomUUID().slice(0, 8)}`, status: 'succeeded' }))
    operator = await harness.signInAs('platform', OPERATOR, null)
  })

  after(async () => {
    if (!harness) return
    try {
      fake?.restore()
      const { setTenantStatus } = await import('../services/tenants/tenants')
      const { deleteTenant } = await import('../services/tenants/delete')
      for (const studio of throwaways) {
        await harness.db.execute(sql`DELETE FROM tenant_imports WHERE tenant_id = ${studio.id}`)
        const [row] = await harness.db.select({ slug: schema.tenants.slug }).from(schema.tenants).where(eq(schema.tenants.id, studio.id))
        if (!row) continue
        await setTenantStatus(studio.id, 'suspended')
        await deleteTenant({ tenantId: studio.id, confirmSlug: row.slug })
      }
      const ours = `%@${DOMAIN}`
      const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
      const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
      await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM (${clients}) c)`)
      await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM credit_movements WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM stripe_payments WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM receipts WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM class_packages WHERE name = ${BUNDLE_NAME}`)
      await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM class_types WHERE name = ${CLASS_TYPE_NAME}`)
      await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM platform_auth_users WHERE email LIKE ${ours}`)
    } finally {
      await harness.close()
    }
  })

  test("SUP-03 a platform session is refused on a studio's credit adjustment, schedule edit and refund, and writes nothing; so are another studio's admin and the studio's instructor", async () => {
    const one = harness.tenants.one
    const two = harness.tenants.two
    const purchaseSvc = inTenantContext(await import('../services/packages/purchase'))

    const admin = await staffAt(one, 'owner', 'admin')
    const teacher = await staffAt(one, 'teacher', 'instructor')
    const adminAtTwo = await staffAt(two, 'owner', 'admin')
    const member = await memberAt(one, 'mia')

    // A class on the schedule, and a paid Credit Bundle the member holds.
    const [location] = await harness.db.select().from(schema.locations).where(eq(schema.locations.tenantId, one.id)).limit(1)
    const [room] = await harness.db.select().from(schema.rooms).where(eq(schema.rooms.locationId, location!.id)).limit(1)
    const [classType] = await harness.db
      .insert(schema.classTypes)
      .values({ tenantId: one.id, name: CLASS_TYPE_NAME })
      .returning({ id: schema.classTypes.id })
    const startsAt = new Date(Date.now() + 7 * 24 * HOUR)
    const [cls] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: one.id,
        classTypeId: classType!.id,
        mainInstructorId: teacher.staffId,
        locationId: location!.id,
        roomId: room!.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 10,
        creditCost: 1,
        createdByStaffId: admin.staffId,
      })
      .returning({ id: schema.classes.id })
    const [bundle] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: one.id, name: BUNDLE_NAME, kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '200.00', status: 'active' })
      .returning({ id: schema.classPackages.id })
    const [purchase] = await harness.db
      .insert(schema.purchases)
      .values({ tenantId: one.id, clientId: member.clientId, kind: 'class_package', totalSgd: '200.00', amountPaidSgd: '200.00', status: 'paid' })
      .returning({ id: schema.purchases.id })
    const { clientPackageId } = await purchaseSvc.grantPackage(one.id, {
      clientId: member.clientId,
      purchaseId: purchase!.id,
      amountSgd: '200.00',
      packageKind: 'class',
      packageId: bundle!.id,
    })
    await harness.db.insert(schema.stripePayments).values({
      tenantId: one.id,
      paymentIntentId: `pi_gates_${randomUUID().slice(0, 12)}`,
      purchaseId: purchase!.id,
      amountSgd: '200.00',
      kind: 'class_package',
      clientId: member.clientId,
      clientPackageId,
      status: 'succeeded',
      providerAccountId: ownAccountId(one),
    })

    const pkg = `/api/v1/portal/admin/clients/${member.clientId}/packages/${clientPackageId}`
    const acts = [
      { name: 'credit adjustment', method: 'POST', path: `${pkg}/adjust`, body: { delta: 2, reason: 'Goodwill' } },
      { name: 'schedule edit', method: 'PATCH', path: `/api/v1/portal/admin/schedule/classes/${cls!.id}`, body: { capacity_online: 4 } },
      { name: 'refund', method: 'POST', path: `${pkg}/refund`, body: { reason: 'Moved away' } },
    ]
    const refused = [
      // The platform session from the studio's own portal: no session of this studio's.
      { who: 'a platform session at the studio portal', headers: () => sentTo(operator, 'staff', one), status: 401, error: 'invalid_token' },
      // As the super portal itself would send it: its hostname names no studio.
      { who: 'a platform session from the super portal', headers: () => ({ ...operator, 'X-Forwarded-For': harnessAddress() }), status: 404, error: 'not_found' },
      { who: "another studio's admin", headers: () => sentTo(adminAtTwo.headers, 'staff', one), status: 401, error: 'invalid_token' },
      { who: "the studio's instructor", headers: () => ({ ...teacher.headers, 'X-Forwarded-For': harnessAddress() }), status: 403, error: 'forbidden_role' },
    ]

    const refundsBefore = fake.callsTo('refunds.create').length
    const untouched = await snapshot()
    for (const act of acts) {
      for (const caller of refused) {
        expectRefusal(await send(act.method, act.path, caller.headers(), act.body), caller.status, caller.error, `${caller.who}, ${act.name}`)
      }
    }
    assert.deepEqual(moved(untouched, await snapshot()), [], 'a refused call wrote nothing, anywhere')
    assert.equal(fake.callsTo('refunds.create').length, refundsBefore, 'and no money was asked back')

    // The same three requests from the studio's own admin go through: what
    // stopped them above was who was asking, not what was asked.
    const [held] = await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, clientPackageId))
    for (const act of acts) {
      const reply = await send(act.method, act.path, { ...admin.headers, 'X-Forwarded-For': harnessAddress() }, act.body)
      assert.equal(reply.status, 200, `the studio's admin, ${act.name}: ${JSON.stringify(reply.body)}`)
    }
    const [adjusted] = await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, clientPackageId))
    assert.equal(adjusted!.creditsOrSessionsRemaining, held!.creditsOrSessionsRemaining! + 2)
    const [edited] = await harness.db.select().from(schema.classes).where(eq(schema.classes.id, cls!.id))
    assert.equal(edited!.capacityOnline, 4)
    assert.equal(fake.callsTo('refunds.create').length, refundsBefore + 1)
    // And the snapshot sees writes like these: it is not blind to the tables the refusals were about.
    const wrote = moved(untouched, await snapshot()).map(line => line.split(':')[0])
    for (const table of ['client_packages', 'classes', 'audit_log']) assert.ok(wrote.includes(table), `${table} moved: ${wrote.join(', ')}`)
  })

  test('SUP-07 a staff or member session of either studio gets 404 not_found on every /platform route, and nothing is written', async () => {
    const { one, two } = harness.tenants
    // The super portal's own address, signed in at each studio as staff and as a
    // member: an allowlisted email is the strongest case, and still a studio session.
    const callers = {
      'an admin of studio one': (await staffAt(one, 'operator-staff', 'admin', OPERATOR)).headers,
      'a member of studio one': (await memberAt(one, 'operator-member', OPERATOR)).headers,
      'an admin of studio two': (await staffAt(two, 'operator-staff', 'admin', OPERATOR)).headers,
      'a member of studio two': (await memberAt(two, 'operator-member', OPERATOR)).headers,
    }
    // Each is a live session at its own studio.
    for (const [who, headers] of Object.entries(callers)) {
      const home = headers.Origin!.includes('.portal.') ? '/api/v1/portal/auth/me' : '/api/v1/me'
      assert.equal((await send('GET', home, headers)).status, 200, `${who} is signed in at its studio`)
    }

    // Real ids, so a request that got past the gate would find what it named.
    const target = await throwawayStudio('gates')
    const job = await send('POST', `/api/v1/platform/tenants/${target.id}/imports`, operator, { file_name: 'studio.zip', size: 10 })
    assert.equal(job.status, 201, JSON.stringify(job.body))
    const fill = (path: string) =>
      path
        .replace(':jobId', job.body.job.id)
        .replace(':id', target.id)
        .replace(':slug', `gates-free-${run}`)

    // A request that would do something if it were let through.
    const valid: Record<string, { body?: unknown; query?: string }> = {
      'POST /api/v1/platform/tenants': { body: { slug: `gates-new-${run}`, name: 'Gates New' } },
      'PATCH /api/v1/platform/tenants/:id/status': { body: { status: 'suspended' } },
      'PUT /api/v1/platform/tenants/:id/term': { body: { start_date: '2026-01-01', months: 3 } },
      'POST /api/v1/platform/tenants/:id/slug': { body: { slug: `gates-moved-${run}` } },
      'POST /api/v1/platform/tenants/:id/admin': { body: { admin_email: `first-admin@${DOMAIN}` } },
      'PUT /api/v1/platform/tenants/:id/payment-credentials': { body: { secret_key: 'sk_test_gates' } },
      'POST /api/v1/platform/tenants/:id/imports': { body: { file_name: 'studio.zip', size: 10 } },
      'PUT /api/v1/platform/maintenance': { body: { enabled: false } },
      'DELETE /api/v1/platform/tenants/:id': { query: `?confirm=${target.slug}` },
    }

    // Every route the platform answers, read from the app itself, except the
    // sign-in step, which runs before anyone has a session.
    const routes = routeTable().filter(
      r => r.path.startsWith('/api/v1/platform/') && r.path !== '/api/v1/platform/sign-in/step',
    )
    assert.ok(routes.length >= 15, `the platform's routes: ${routes.map(r => `${r.method} ${r.path}`).join(', ')}`)
    for (const key of Object.keys(valid)) {
      assert.ok(routes.some(r => `${r.method} ${r.path}` === key), `${key} is still a platform route`)
    }

    const untouched = await snapshot()
    const answers: string[] = []
    for (const route of routes) {
      const request = valid[`${route.method} ${route.path}`] ?? {}
      for (const [who, headers] of Object.entries(callers)) {
        const reply = await send(route.method, fill(route.path) + (request.query ?? ''), { ...headers, 'X-Forwarded-For': harnessAddress() }, request.body)
        if (reply.status !== 404 || JSON.stringify(reply.body) !== JSON.stringify({ error: 'not_found' })) {
          answers.push(`${who}, ${route.method} ${route.path}: ${reply.status} ${JSON.stringify(reply.body)}`)
        }
      }
    }
    assert.deepEqual(answers, [], 'every studio session is answered 404 not_found, and only that')
    assert.deepEqual(moved(untouched, await snapshot()), [], 'nothing was written')

    // The Platform administrator, asking the same routes, is let past the gate on
    // every one: the 404 above was the gate's, not a route not finding its row.
    const gated: string[] = []
    for (const route of routes) {
      const reply = await send(route.method, fill(route.path), { ...operator, 'X-Forwarded-For': harnessAddress() })
      if (reply.status === 404 && reply.body?.error === 'not_found') gated.push(`${route.method} ${route.path}`)
    }
    assert.deepEqual(gated, [], 'the operator gets past the gate on every route')
  })

  test('AUD-06 no staff or platform route edits or deletes an audit row: every one is tried, and the rows are unchanged', async () => {
    // A studio of its own, so trying every route in the portal on it touches
    // nobody else's setup.
    const studio = await throwawayStudio('audit')
    const admin = await staffAt(studio, 'owner', 'admin')
    const teacher = await staffAt(studio, 'teacher', 'instructor')
    const as = (headers: Record<string, string>) => ({ ...headers, 'X-Forwarded-For': harnessAddress() })

    // Audit rows the ordinary way: an admin's changes.
    const made = await send('POST', '/api/v1/portal/admin/class-types', as(admin.headers), { name: 'Hatha' })
    assert.equal(made.status, 201, JSON.stringify(made.body))
    const renamed = await send('PATCH', `/api/v1/portal/admin/class-types/${made.body.id}`, as(admin.headers), { name: 'Yin' })
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body))

    const allRows = async () =>
      new Map((await harness.db.select().from(schema.auditLog)).map(row => [row.id, JSON.stringify(row)]))
    const trail = await harness.db.select().from(schema.auditLog).where(eq(schema.auditLog.tenantId, studio.id))
    assert.ok(trail.length >= 2, `the studio has an audit trail: ${JSON.stringify(trail)}`)
    const [row] = trail
    const before = await allRows()

    // What an edit would send: the row's own fields, changed.
    const tampered = {
      id: row!.id,
      action: 'tampered',
      target_table: 'tampered',
      target_id: randomUUID(),
      actor_staff_id: null,
      payload: { tampered: true },
      created_at: '2000-01-01T00:00:00.000Z',
    }
    const fill = (path: string) => path.replace(/:[A-Za-z_]+/g, row!.id)

    // Every mutating route the portal and the platform answer, read from the
    // app itself, aimed at the audit row: its id in every path parameter, its
    // fields in the body. The portal's as the admin and as the instructor, the
    // platform's as the Platform administrator.
    //
    // No act deletes an audit row (#375, docs/adr/0008). Two touch them, each as
    // a consequence of deleting something else, never an audit row on its own
    // (and an audit row's id names neither): permanently deleting a member keeps
    // the trail about them with their personal data replaced (AUD-07,
    // member-delete.test.ts), and deleting a studio moves its trail into the
    // platform's audit_log_archive (AUD-08 to AUD-10, tenant-delete.test.ts).
    const mutating = routeTable().filter(r => r.method !== 'GET')
    const portal = mutating.filter(r => r.path.startsWith('/api/v1/portal/'))
    const platform = mutating.filter(r => r.path.startsWith('/api/v1/platform/'))
    assert.ok(portal.length >= 100 && platform.length >= 10, `${portal.length} portal and ${platform.length} platform routes`)

    // A request the gate stopped never reached its route, so it proves nothing
    // here: the admin is let into every admin route, and nobody's session drops.
    const GATE = new Set(['missing_bearer_token', 'invalid_token', 'staff_not_provisioned', 'staff_inactive', 'tenant_suspended'])
    const stopped: string[] = []
    for (const route of portal) {
      for (const [who, headers] of [['admin', admin.headers], ['instructor', teacher.headers]] as const) {
        const reply = await send(route.method, fill(route.path), as(headers), tampered)
        const gated =
          GATE.has(reply.body?.error) ||
          (who === 'admin' && route.path.startsWith('/api/v1/portal/admin/') && reply.body?.error === 'forbidden_role')
        if (gated) stopped.push(`${who}, ${route.method} ${route.path}: ${reply.status} ${reply.body?.error}`)
      }
    }
    for (const route of platform) {
      await send(route.method, fill(route.path), as(operator), tampered)
    }
    assert.deepEqual(stopped, [], 'every portal route was reached')
    // The routes an audit trail's edit or delete would most likely be given, were
    // there one: there is not.
    for (const path of [
      `/api/v1/portal/admin/audit-log/${row!.id}`,
      `/api/v1/portal/admin/audit/${row!.id}`,
      `/api/v1/platform/audit-log/${row!.id}`,
      `/api/v1/platform/tenants/${studio.id}/audit-log/${row!.id}`,
    ]) {
      for (const method of ['PATCH', 'PUT', 'DELETE']) {
        const headers = path.startsWith('/api/v1/platform/') ? operator : admin.headers
        expectRefusal(await send(method, path, as(headers), tampered), 404, 'not_found', `${method} ${path}`)
      }
    }

    // Nor was the sweep cut short by a session lost on the way, the operator's included.
    assert.equal((await send('GET', '/api/v1/portal/auth/me', as(admin.headers))).status, 200)
    assert.equal((await send('GET', '/api/v1/portal/auth/me', as(teacher.headers))).status, 200)
    assert.equal((await send('GET', '/api/v1/platform/tenants', as(operator))).status, 200)
    assert.ok(
      !harness.logs.lines().some(l => l.msg === 'platform-admin: refused'),
      'the operator was let past the platform gate throughout',
    )

    // Every audit row there was is still there, every field as it was.
    const after = await allRows()
    const changed = [...before].filter(([id, was]) => after.get(id) !== was).map(([id]) => id)
    assert.deepEqual(changed, [], 'no audit row was edited or deleted')
  })
})
