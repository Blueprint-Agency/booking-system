import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { frontendOrigin, harnessAddress, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { withEnv } from './with-env'

const run = Date.now().toString(36)
const DOMAIN = `${run}.lifecycle.test`
const OPERATOR = `operator@${DOMAIN}`

/**
 * A studio's life as the super portal runs it, over real HTTP (#365): creating
 * one and the addresses it may not take, suspending and reactivating it, giving
 * it its first Admin, following its imports and setting its Term.
 *
 * Every platform route here is also asked by a studio session, an Admin of
 * another studio and a member, and refused `404 not_found` with nothing
 * written. "Nothing written" is read off the whole database: every table's row
 * count and newest row version (`xmin`), before and after.
 */
describe('super portal studio lifecycle', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  withEnv({ PLATFORM_ADMIN_EMAIL: OPERATOR })

  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let discardedMail!: typeof import('../lib/mailer')['discardedMail']
  let operator!: Record<string, string>
  /** Callers the platform must not answer: another studio's Admin, and a member. */
  let outsiders!: Record<string, Record<string, string>>

  type Reply = { status: number; body: any }
  type Studio = { id: string; slug: string }

  async function send(method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<Reply> {
    const res = await harness.app.request(path, {
      method,
      headers: {
        ...headers,
        'X-Forwarded-For': harnessAddress(),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  const platform = (method: string, path: string, body?: unknown) =>
    send(method, `/api/v1/platform${path}`, operator, body)

  const expectReply = (reply: Reply, status: number, error: string | undefined, what: string) => {
    assert.equal(reply.status, status, `${what}: ${JSON.stringify(reply.body)}`)
    if (error !== undefined) assert.equal(reply.body?.error, error, `${what}: ${JSON.stringify(reply.body)}`)
    return reply.body
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

  const moved = (from: Record<string, string>, to: Record<string, string>) =>
    Object.keys({ ...from, ...to })
      .filter(t => from[t] !== to[t])
      .map(t => `${t}: ${from[t]} -> ${to[t]}`)

  /** Runs `act`, and asserts it wrote nothing anywhere. */
  async function writesNothing(what: string, act: () => Promise<void>) {
    const untouched = await snapshot()
    await act()
    assert.deepEqual(moved(untouched, await snapshot()), [], `${what} wrote nothing`)
  }

  /** The platform route asked by every outsider: each is answered `404 not_found`, and only that. */
  async function refusedToOutsiders(method: string, path: string, body?: unknown) {
    await writesNothing(`${method} ${path} asked by a studio session`, async () => {
      for (const [who, headers] of Object.entries(outsiders)) {
        const reply = await send(method, `/api/v1/platform${path}`, headers, body)
        assert.deepEqual([reply.status, reply.body], [404, { error: 'not_found' }], `${who}, ${method} ${path}`)
      }
    })
  }

  async function staffAt(at: Studio, name: string, role: 'admin' | 'instructor' = 'admin') {
    const email = `${name}-${at.slug}@${DOMAIN}`
    const headers = await harness.signInAs('staff', email, at)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.email, email), eq(schema.staffAuthUsers.tenantId, at.id)))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: at.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    return { staffId: row!.id, email, headers }
  }

  async function memberAt(at: Studio, name: string) {
    const email = `${name}-${at.slug}@${DOMAIN}`
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(and(eq(schema.clientAuthUsers.email, email), eq(schema.clientAuthUsers.tenantId, at.id)))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, email, headers }
  }

  /** Studios this file made, deleted with everything they hold at the end. */
  const throwaways: Studio[] = []

  /** A studio of this file's own, made the way the super portal makes one. */
  async function throwawayStudio(label: string, input: { admin?: boolean; open?: boolean } = {}): Promise<Studio> {
    const provision = await import('../services/tenants/provision')
    const tenants = await import('../services/tenants/tenants')
    const slug = `${label}-${run}`
    const { tenant } = await provision.provisionTenant({
      slug,
      name: `Lifecycle ${label}`,
      ...(input.admin ? { adminEmail: `owner@${slug}.${DOMAIN}` } : {}),
    })
    if (input.open) await tenants.setTenantStatus(tenant.id, 'active')
    const studio = { id: tenant.id, slug }
    throwaways.push(studio)
    return studio
  }

  const tenantBySlug = async (slug: string) =>
    (await harness.db.select().from(schema.tenants).where(sql`lower(${schema.tenants.slug}) = lower(${slug})`))[0] ?? null

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    ;({ discardedMail } = await import('../lib/mailer'))
    operator = await harness.signInAs('platform', OPERATOR, null)
    const { one, two } = harness.tenants
    outsiders = {
      'an admin of studio two': (await staffAt(two, 'outsider-admin')).headers,
      'a member of studio one': (await memberAt(one, 'outsider-member')).headers,
    }
  })

  after(async () => {
    if (!harness) return
    try {
      harness.clock.reset()
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
      await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM platform_auth_users WHERE email LIKE ${ours}`)
    } finally {
      await harness.close()
    }
  })

  test('SUP-06 the New studio form refuses an address that is taken in any casing, reserved, an e2e- one, too short, too long, blank or malformed, with its reason, and writes no Tenant', async () => {
    const taken = await throwawayStudio('life-taken')
    const firstAdmin = `first-admin@${DOMAIN}`
    const create = (slug: string) =>
      platform('POST', '/tenants', { slug, name: 'Lifecycle refused', admin_email: firstAdmin, term_months: 3 })

    // The reserved list as be/CONTEXT.md § Slug names it, and the browser journeys' prefix.
    const reserved = ['admin', 'api', 'portal', 'www', 'dev', 'staging', 'app', 'mail', 'clerk', 'assets']
    const refusals: Array<[slug: string, status: number, reason: string]> = [
      [taken.slug, 409, 'slug_taken'],
      [taken.slug.toUpperCase(), 409, 'slug_taken'],
      [`Life-Taken-${run}`, 409, 'slug_taken'],
      [harness.tenants.one.slug.toUpperCase(), 409, 'slug_taken'],
      ...reserved.map(slug => [slug, 400, 'slug_reserved'] as [string, number, string]),
      ['ADMIN', 400, 'slug_reserved'],
      [`e2e-${run}`, 400, 'slug_reserved'],
      [`E2E-${run}`, 400, 'slug_reserved'],
      ['e2e-', 400, 'slug_malformed'],
      ['ab', 400, 'slug_too_short'],
      ['a', 400, 'slug_too_short'],
      ['x'.repeat(64), 400, 'slug_too_long'],
      ['', 400, 'slug_too_short'],
      ['   ', 400, 'slug_too_short'],
      [`-life-${run}`, 400, 'slug_malformed'],
      [`life-${run}-`, 400, 'slug_malformed'],
      [`life_${run}`, 400, 'slug_malformed'],
      [`life ${run}`, 400, 'slug_malformed'],
      [`life.${run}`, 400, 'slug_malformed'],
      [`café-${run}`, 400, 'slug_malformed'],
      [`xn--life-${run}`, 400, 'slug_malformed'],
    ]

    const mailBefore = discardedMail.length
    await writesNothing('every refused create', async () => {
      for (const [slug, status, reason] of refusals) {
        expectReply(await create(slug), status, reason, `the address ${JSON.stringify(slug)}`)
      }
    })
    assert.equal(discardedMail.slice(mailBefore).filter(m => m.to === firstAdmin).length, 0, 'nobody was invited')
    for (const [slug] of refusals.filter(([s]) => s.trim() && !s.toLowerCase().startsWith(taken.slug) && s.toLowerCase() !== harness.tenants.one.slug)) {
      assert.equal(await tenantBySlug(slug.trim()), null, `no Tenant answers on ${JSON.stringify(slug)}`)
    }

    // The bounds themselves are addresses: 3 and 63 characters, inner hyphens.
    const shortest = `l${run.slice(-2)}`
    const longest = `life-${run}-${'x'.repeat(63 - `life-${run}-`.length)}`
    for (const slug of [shortest, longest]) {
      const created = expectReply(await platform('POST', '/tenants', { slug, name: 'Lifecycle bound' }), 201, undefined, slug)
      throwaways.push({ id: created.tenant.id, slug })
      assert.equal(created.tenant.slug, slug)
      assert.ok(await tenantBySlug(slug), `${slug} is a studio`)
    }

    // Only the Platform administrator creates a studio.
    await refusedToOutsiders('POST', '/tenants', { slug: `life-outsider-${run}`, name: 'Lifecycle outsider' })
    assert.equal(await tenantBySlug(`life-outsider-${run}`), null)
  })

  /** This studio's row count in every table that carries a `tenant_id`. */
  async function rowsHeldBy(tenantId: string): Promise<Record<string, number>> {
    const tables = await harness.db.execute<{ t: string }>(sql`
      SELECT c.table_name AS t FROM information_schema.columns c
      JOIN information_schema.tables t USING (table_schema, table_name)
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
      ORDER BY 1
    `)
    const out: Record<string, number> = {}
    for (const { t } of tables) {
      const [row] = await harness.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM ${sql.identifier(t)} WHERE tenant_id = ${tenantId}`,
      )
      if (row!.n > 0) out[t] = row!.n
    }
    return out
  }

  test("SUP-08 suspending a studio refuses its signed-in members' and staff's /me and /portal requests 403 tenant_suspended; reactivating lets the same sessions back in with every row kept", async () => {
    const studio = await throwawayStudio('life-pause', { admin: true })
    const admin = await staffAt(studio, 'owner')
    const teacher = await staffAt(studio, 'teacher', 'instructor')
    await harness.db.insert(schema.instructors).values({ tenantId: studio.id, staffUserId: teacher.staffId })
    const member = await memberAt(studio, 'mia')
    const elsewhere = await memberAt(harness.tenants.two, 'elsewhere')

    // Something the member holds, that suspension must not take away.
    const [bundle] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: studio.id, name: `Lifecycle pass ${run}`, kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '150.00', status: 'active' })
      .returning({ id: schema.classPackages.id })
    const [held] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: studio.id,
        clientId: member.clientId,
        kind: 'credit_bundle',
        sourceClassPackageId: bundle!.id,
        validityDays: 90,
        creditsOrSessionsRemaining: 7,
        active: true,
        amountPaidSgd: '150.00',
        listPriceSgd: '150.00',
      })
      .returning({ id: schema.clientPackages.id })

    const requests = [
      { who: 'the member, their account', headers: member.headers, path: '/api/v1/me' },
      { who: 'the member, their packages', headers: member.headers, path: '/api/v1/me/packages' },
      { who: 'the admin, their portal session', headers: admin.headers, path: '/api/v1/portal/auth/me' },
      { who: 'the admin, the member list', headers: admin.headers, path: '/api/v1/portal/admin/clients' },
      { who: 'the instructor, their portal session', headers: teacher.headers, path: '/api/v1/portal/auth/me' },
    ]
    const answers = async () => {
      const out: Record<string, Reply> = {}
      for (const r of requests) out[r.who] = await send('GET', r.path, r.headers)
      return out
    }

    const open = await answers()
    for (const [who, reply] of Object.entries(open)) assert.equal(reply.status, 200, `${who}: ${JSON.stringify(reply.body)}`)
    assert.deepEqual(
      open['the member, their packages']!.body.client_packages.map((p: any) => [p.id, p.credits_or_sessions_remaining]),
      [[held!.id, 7]],
    )
    const kept = await rowsHeldBy(studio.id)

    // Only the Platform administrator suspends a studio: not its own admin, not another studio's.
    await writesNothing("the studio's own admin asking to suspend it", async () => {
      const reply = await send('PATCH', `/api/v1/platform/tenants/${studio.id}/status`, admin.headers, { status: 'suspended' })
      assert.deepEqual([reply.status, reply.body], [404, { error: 'not_found' }])
    })
    await refusedToOutsiders('PATCH', `/tenants/${studio.id}/status`, { status: 'suspended' })
    assert.equal((await tenantBySlug(studio.slug))!.status, 'active')

    const suspended = expectReply(await platform('PATCH', `/tenants/${studio.id}/status`, { status: 'suspended' }), 200, undefined, 'suspend')
    assert.equal(suspended.tenant.status, 'suspended')
    assert.equal((await tenantBySlug(studio.slug))!.status, 'suspended')

    await writesNothing('every request to the suspended studio', async () => {
      for (const [who, reply] of Object.entries(await answers())) {
        assert.deepEqual([reply.status, reply.body], [403, { error: 'tenant_suspended', status: 'suspended' }], who)
      }
    })
    // Another studio is not paused with it.
    assert.equal((await send('GET', '/api/v1/me', elsewhere.headers)).status, 200, 'a member of another studio')

    const reactivated = expectReply(await platform('PATCH', `/tenants/${studio.id}/status`, { status: 'active' }), 200, undefined, 'reactivate')
    assert.equal(reactivated.tenant.status, 'active')

    // The same sessions, signed in before the suspension, are let back in, and see what they saw.
    const back = await answers()
    for (const [who, reply] of Object.entries(back)) {
      assert.equal(reply.status, 200, `${who}: ${JSON.stringify(reply.body)}`)
      assert.deepEqual(reply.body, open[who]!.body, `${who} sees what they saw before`)
    }
    assert.deepEqual(await rowsHeldBy(studio.id), kept, 'every row the studio held is still there')
    const [still] = await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, held!.id))
    assert.equal(still!.creditsOrSessionsRemaining, 7)
  })

  /** What a first-Admin invitation would leave at a studio. */
  async function invitationTraces(studio: Studio, email: string) {
    const staff = await harness.db.select().from(schema.staffUsers).where(eq(schema.staffUsers.tenantId, studio.id))
    const invitations = await harness.db.select().from(schema.staffInvitations).where(eq(schema.staffInvitations.tenantId, studio.id))
    const accounts = await harness.db
      .select()
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.tenantId, studio.id), eq(schema.staffAuthUsers.email, email)))
    const logged = await harness.db
      .select()
      .from(schema.emailLog)
      .where(and(eq(schema.emailLog.tenantId, studio.id), eq(schema.emailLog.recipientEmail, email)))
    return { staff, invitations, accounts, logged }
  }

  const template = (m: { tags: Array<{ name: string; value: string }> }) => m.tags.find(t => t.name === 'template')?.value

  test('SUP-09 inviting a first Admin to a studio that has a live staff member is refused 409 tenant_already_has_staff, and no invitation is written', async () => {
    // One studio whose admin is at work, one whose admin is invited and has not yet accepted.
    const working = await throwawayStudio('life-working', { open: true })
    await staffAt(working, 'owner')
    const invited = await throwawayStudio('life-invited', { admin: true })
    const [pending] = await harness.db.select().from(schema.staffUsers).where(eq(schema.staffUsers.tenantId, invited.id))
    assert.equal(pending!.status, 'pending')

    for (const studio of [working, invited]) {
      const email = `newcomer-${studio.slug}@${DOMAIN}`
      const before = await invitationTraces(studio, email)
      const mailBefore = discardedMail.length

      await writesNothing(`a first Admin for ${studio.slug}`, async () => {
        expectReply(
          await platform('POST', `/tenants/${studio.id}/admin`, { admin_email: email, admin_name: 'Newcomer' }),
          409,
          'tenant_already_has_staff',
          studio.slug,
        )
      })

      const afterwards = await invitationTraces(studio, email)
      assert.deepEqual(afterwards, before, 'no staff row, invitation, login or email log')
      assert.equal(afterwards.accounts.length, 0)
      assert.deepEqual(discardedMail.slice(mailBefore).filter(m => m.to === email), [], 'and no email')
    }
  })

  test('SUP-01 inviting the first Admin of a studio with no staff writes one invitation and sends one email to that address, and opens the studio', async () => {
    const empty = await throwawayStudio('life-empty')
    assert.equal((await tenantBySlug(empty.slug))!.status, 'suspended', 'a studio opened with nobody in it waits, suspended')
    const email = `first-owner-${empty.slug}@${DOMAIN}`
    const asTyped = `First-Owner-${empty.slug}@${DOMAIN.toUpperCase()}`

    // Only the Platform administrator hands a studio over: not a studio's admin, not a member.
    await refusedToOutsiders('POST', `/tenants/${empty.id}/admin`, { admin_email: email })
    assert.deepEqual((await invitationTraces(empty, email)).invitations, [])

    const mailBefore = discardedMail.length
    const reply = expectReply(
      await platform('POST', `/tenants/${empty.id}/admin`, { admin_email: asTyped, admin_name: 'Fran' }),
      201,
      undefined,
      'first admin',
    )
    assert.equal(reply.admin.email, email)
    assert.equal(reply.admin.name, 'Fran')
    assert.equal(reply.tenant.status, 'active')
    assert.equal(reply.tenant.staff_count, 1)

    const { staff, invitations, accounts, logged } = await invitationTraces(empty, email)
    assert.deepEqual(
      staff.map(s => [s.id, s.email, s.name, s.role, s.status]),
      [[reply.admin.id, email, 'Fran', 'admin', 'pending']],
    )
    assert.equal(accounts.length, 1, 'their login at this studio')
    assert.equal(staff[0]!.authUserId, accounts[0]!.id)
    assert.deepEqual(
      invitations.map(i => [i.staffUserId, i.invitedByStaffId, i.status]),
      [[reply.admin.id, null, 'pending']],
      'one invitation, made by nobody on the staff',
    )

    const mail = discardedMail.slice(mailBefore).filter(m => m.to === email)
    assert.equal(mail.length, 1, 'one email')
    assert.equal(template(mail[0]!), 'admin_invite')
    assert.ok(mail[0]!.html.includes(`http://${empty.slug}.portal.localhost:3001/`), 'linking to the studio’s own portal')
    assert.deepEqual(
      discardedMail.slice(mailBefore).filter(m => m.to !== email),
      [],
      'and nobody else was mailed',
    )
    assert.deepEqual(logged.map(l => [l.templateSlug, l.tenantId]), [['admin_invite', empty.id]])
    assert.equal((await tenantBySlug(empty.slug))!.status, 'active')
  })

  test("the Platform administrator lists import jobs across studios: each studio's running or unread one, not a dismissed one", async () => {
    const first = await throwawayStudio('life-import-a')
    const second = await throwawayStudio('life-import-b')
    const finished = await throwawayStudio('life-import-c')
    const dismissed = await throwawayStudio('life-import-d')

    // Two started from the super portal, waiting for their files.
    const started = []
    for (const [studio, fileName] of [[first, 'first.zip'], [second, 'second.zip']] as const) {
      const reply = expectReply(
        await platform('POST', `/tenants/${studio.id}/imports`, { file_name: fileName, size: 2048 }),
        201,
        undefined,
        `start ${fileName}`,
      )
      started.push(reply.job)
    }
    // One that failed and is still on the list until the operator closes it,
    // and one the operator has closed.
    const [failed] = await harness.db
      .insert(schema.tenantImports)
      .values({
        tenantId: finished.id,
        status: 'failed',
        phase: 'uploading',
        fileName: 'broken.zip',
        uploadBytes: 4096,
        errorCode: 'unreadable_archive',
        error: 'Not a studio archive.',
        startedBy: OPERATOR,
        finishedAt: new Date(),
      })
      .returning()
    const [closed] = await harness.db
      .insert(schema.tenantImports)
      .values({
        tenantId: dismissed.id,
        status: 'failed',
        phase: 'uploading',
        fileName: 'closed.zip',
        uploadBytes: 4096,
        errorCode: 'unreadable_archive',
        error: 'Not a studio archive.',
        startedBy: OPERATOR,
        finishedAt: new Date(),
        dismissedAt: new Date(),
      })
      .returning()

    // Only the Platform administrator sees the platform's imports.
    await refusedToOutsiders('GET', '/imports')

    const listed = expectReply(await platform('GET', '/imports'), 200, undefined, 'the import list').imports as any[]
    const ours = new Set([first.id, second.id, finished.id, dismissed.id])
    const mine = listed
      .filter(job => ours.has(job.tenant_id))
      .map(job => [job.tenant_id, job.id, job.status, job.file_name, job.upload_bytes, job.started_by, job.error_code])
      .sort((a, b) => String(a[3]).localeCompare(String(b[3])))
    assert.deepEqual(mine, [
      [finished.id, failed!.id, 'failed', 'broken.zip', 4096, OPERATOR, 'unreadable_archive'],
      [first.id, started[0].id, 'uploading', 'first.zip', 2048, OPERATOR, null],
      [second.id, started[1].id, 'uploading', 'second.zip', 2048, OPERATOR, null],
    ])
    assert.ok(!listed.some(job => job.id === closed!.id), 'a dismissed job is off the list')
  })

  test("setting a studio's Term over HTTP returns, and reads back, its start, the end its duration computes, and whether it has ended on the app clock", async () => {
    const studio = await throwawayStudio('life-term', { open: true })
    const listed = async () =>
      (expectReply(await platform('GET', '/tenants'), 200, undefined, 'the studio list').tenants as any[]).find(t => t.id === studio.id)

    // 10 May 2031, mid-morning in Singapore (the studio's zone).
    harness.clock.set(new Date('2031-05-10T02:00:00.000Z'))

    // Each duration, from a start chosen to need the month-end rule: worked by hand.
    const cases: Array<[start: string, months: 3 | 6 | 12, end: string, ended: boolean]> = [
      ['2031-01-31', 3, '2031-04-30', true],
      ['2031-08-31', 6, '2032-02-29', false],
      ['2031-05-10', 12, '2032-05-10', false],
      ['2030-11-10', 6, '2031-05-10', true],
    ]
    for (const [start, months, end, ended] of cases) {
      const set = expectReply(
        await platform('PUT', `/tenants/${studio.id}/term`, { start_date: start, months }),
        200,
        undefined,
        `${start} for ${months} months`,
      )
      const expected = { start_date: start, end_date: end, ended }
      assert.deepEqual(set.tenant.term, expected, `${start} for ${months} months`)
      assert.deepEqual((await listed()).term, expected, 'read back from the list')
      const row = await tenantBySlug(studio.slug)
      assert.deepEqual([row!.termStartDate, row!.termEndDate], [start, end], 'stored')
    }

    // The Term that ends on 10 May 2032 ends at midnight that day, Singapore time, by the app clock.
    await platform('PUT', `/tenants/${studio.id}/term`, { start_date: '2031-05-10', months: 12 })
    harness.clock.set(new Date('2032-05-09T15:59:59.000Z'))
    assert.equal((await listed()).term.ended, false, 'the last second of the Term')
    harness.clock.set(new Date('2032-05-09T16:00:00.000Z'))
    assert.equal((await listed()).term.ended, true, 'midnight on the end date')
    harness.clock.reset()

    // A duration other than 3, 6 or 12 months, a date that does not exist, and
    // a studio that does not exist are refused and change nothing.
    const kept = { start_date: '2031-05-10', end_date: '2032-05-10' }
    await writesNothing('a refused Term', async () => {
      expectReply(await platform('PUT', `/tenants/${studio.id}/term`, { start_date: '2031-05-10', months: 4 }), 400, undefined, '4 months')
      expectReply(await platform('PUT', `/tenants/${studio.id}/term`, { start_date: '2031-02-29', months: 3 }), 400, undefined, '29 Feb 2031')
      expectReply(
        await platform('PUT', '/tenants/00000000-0000-4000-8000-000000000000/term', { start_date: '2031-05-10', months: 3 }),
        404,
        'not_found',
        'no such studio',
      )
    })

    // Only the Platform administrator sets a Term.
    await refusedToOutsiders('PUT', `/tenants/${studio.id}/term`, { start_date: '2020-01-01', months: 3 })
    const row = await tenantBySlug(studio.slug)
    assert.deepEqual({ start_date: row!.termStartDate, end_date: row!.termEndDate }, kept)
    assert.equal(row!.status, 'active')
  })
})
