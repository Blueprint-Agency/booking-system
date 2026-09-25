import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { eq, inArray, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { memberFixtures } from './member-fixtures'
import { withEnv } from './with-env'

const run = Date.now().toString(36)
const DOMAIN = `delete-${run}.test`
const OPERATOR = `operator@${DOMAIN}`

/**
 * Deleting a studio from the super portal: refused while it is active, and once
 * suspended it takes every row the studio owns — in every table that carries a
 * `tenant_id`, read from the catalogue rather than listed here — and nothing of
 * any other studio's.
 *
 * Through the platform route, so the delete runs as the application role with
 * Row-Level Security live, exactly as in production. The counting here runs as
 * the owner, which sees every studio's rows at once.
 */
describe('deleting a studio', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  withEnv({
    PLATFORM_ADMIN_EMAIL: OPERATOR,
    // No object storage under test: the delete must not reach a real bucket, and
    // with no bucket configured it skips that step and says so (`objects: null`).
    R2_BUCKET_NAME: '',
  })

  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')
  let authUsers!: typeof import('../services/auth/auth-users')
  let fixtures!: ReturnType<typeof memberFixtures>
  let operator!: Record<string, string>

  /** Every table with a `tenant_id` column, from the catalogue — `tenant_settings` included. */
  async function tenantTables(): Promise<string[]> {
    const rows = await harness.db.execute<{ table_name: string }>(sql`
      SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name
    `)
    return rows.map(r => r.table_name)
  }

  /** Rows per table belonging to `tenantId`, across every Tenant-scoped table. */
  async function countsFor(tenantId: string): Promise<Record<string, number>> {
    const counts: Record<string, number> = {}
    for (const table of await tenantTables()) {
      const [row] = await harness.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE tenant_id = ${tenantId}`,
      )
      counts[table] = row!.n
    }
    return counts
  }

  const remove = (id: string, confirm: string) =>
    harness.app.request(`/api/v1/platform/tenants/${id}?confirm=${encodeURIComponent(confirm)}`, {
      method: 'DELETE',
      headers: { Authorization: operator.Authorization! },
    })

  const setStatus = (id: string, status: string) =>
    harness.app.request(`/api/v1/platform/tenants/${id}/status`, {
      method: 'PATCH',
      headers: { Authorization: operator.Authorization!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })

  const expectStatus = async (res: Response, status: number, error?: string) => {
    const body = await res.text()
    assert.equal(res.status, status, body)
    if (error) assert.equal((JSON.parse(body) as { error: string }).error, error)
    return JSON.parse(body) as any
  }

  /** What a table's check constraints need that `insertRow`'s fillers do not provide. */
  const later = () => new Date(Date.now() + 3_600_000).toISOString()
  const firstId = async (table: string, tenantId: string) => {
    const [row] = await harness.db.execute<{ id: string }>(
      sql`SELECT id FROM ${sql.identifier(table)} WHERE tenant_id = ${tenantId} LIMIT 1`,
    )
    return row!.id
  }
  const shapes: Record<string, (tenantId: string) => Promise<Record<string, unknown>>> = {
    promotions: async () => ({ starts_at: new Date().toISOString(), ends_at: later(), percent_off: 10 }),
    class_series: async () => ({ start_time: '09:00', end_time: '10:00' }),
    workshop_days: async () => ({ starts_at: new Date().toISOString(), ends_at: later() }),
    class_series_supporting_instructors: async t => ({ series_id: await firstId('class_series', t) }),
    workshop_tier_days: async t => ({ workshop_day_id: await firstId('workshop_days', t) }),
    leave_conflicts: async t => {
      const pair = [
        (await fixtures.insertRow('instructors', t)).staff_user_id as string,
        (await fixtures.insertRow('instructors', t)).staff_user_id as string,
      ].sort()
      return { instructor_a_id: pair[0], instructor_b_id: pair[1] }
    },
  }

  /** A studio with a row in every Tenant-scoped table there is. */
  async function fillEveryTable(tenantId: string) {
    const transfer = await import('../services/tenants/transfer')
    const { order } = await transfer.tenantTableOrder()
    const refused: string[] = []
    for (const table of order) {
      const [has] = await harness.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE tenant_id = ${tenantId}`,
      )
      if (has!.n > 0) continue
      try {
        await fixtures.insertRow(table, tenantId, (await shapes[table]?.(tenantId)) ?? {})
      } catch (err) {
        const cause = (err as { cause?: { message?: string } }).cause?.message ?? String(err)
        refused.push(`${table}: ${cause}`)
      }
    }
    assert.deepEqual(refused, [], 'teach this file how to make a row in each of these')
    // Not studio data, so `tenantTableOrder` leaves it out — but it carries a
    // `tenant_id`, and it must go with the studio (by cascade, migration 0073).
    await harness.db.insert(schema.tenantImports).values({
      tenantId,
      status: 'succeeded',
      fileName: 'restored.zip',
      uploadBytes: 1,
      startedBy: OPERATOR,
    })
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
    authUsers = await import('../services/auth/auth-users')
    fixtures = memberFixtures(harness, schema, DOMAIN)
    operator = await harness.signInAs('platform', OPERATOR, null)
  })

  after(async () => {
    if (!harness) return
    // The rows this file put into the fixture studio; the deleted studio's are
    // already gone, which is the point.
    await fixtures.cleanup()
    await harness.db.delete(schema.platformAuthUsers).where(eq(schema.platformAuthUsers.email, OPERATOR))
    await harness.close()
  })

  test('an active studio cannot be deleted', async () => {
    const { tenant } = await provision.provisionTenant({
      slug: `del-active-${run}`,
      name: 'Still Open',
      adminEmail: `owner-active@${DOMAIN}`,
    })
    assert.equal(tenant.status, 'active')
    const before = await countsFor(tenant.id)

    await expectStatus(await remove(tenant.id, tenant.slug), 409, 'tenant_not_suspended')

    const [still] = await harness.db.select().from(schema.tenants).where(eq(schema.tenants.id, tenant.id))
    assert.ok(still, 'the studio is still there')
    assert.deepEqual(await countsFor(tenant.id), before, 'and so is every row it owns')
  })

  test('the slug must be typed out, exactly', async () => {
    const { tenant } = await provision.provisionTenant({ slug: `del-typo-${run}`, name: 'Typo' })
    assert.equal(tenant.status, 'suspended', 'a studio with no admin opens suspended')

    await expectStatus(await remove(tenant.id, `${tenant.slug}x`), 400, 'confirmation_mismatch')
    await expectStatus(
      await harness.app.request(`/api/v1/platform/tenants/${tenant.id}`, {
        method: 'DELETE',
        headers: { Authorization: operator.Authorization! },
      }),
      400,
    )
    const [still] = await harness.db.select().from(schema.tenants).where(eq(schema.tenants.id, tenant.id))
    assert.ok(still)
  })

  test('only a platform administrator can delete', async () => {
    const { tenant } = await provision.provisionTenant({
      slug: `del-gated-${run}`,
      name: 'Gated',
      adminEmail: `owner-gated@${DOMAIN}`,
    })
    const staff = await harness.signInAs('staff', `owner-gated@${DOMAIN}`, tenant)
    await harness.db.update(schema.tenants).set({ status: 'suspended' }).where(eq(schema.tenants.id, tenant.id))
    await expectStatus(
      await harness.app.request(`/api/v1/platform/tenants/${tenant.id}?confirm=${tenant.slug}`, {
        method: 'DELETE',
        headers: { Authorization: staff.Authorization! },
      }),
      404,
    )
    const [still] = await harness.db.select().from(schema.tenants).where(eq(schema.tenants.id, tenant.id))
    assert.ok(still)
  })

  test('a suspended studio is deleted whole, and no other studio loses a row', async () => {
    const { one, two } = harness.tenants
    const { tenant } = await provision.provisionTenant({
      slug: `del-whole-${run}`,
      name: 'Going Away',
      adminEmail: `owner-whole@${DOMAIN}`,
    })
    const doomed = tenant.id

    // People: one who is only here, and one who is also at the other studio —
    // in each pool. Logins are per studio (#231), so the second has one at each.
    const login = (pool: 'client' | 'staff', tenantId: string, email: string) =>
      authUsers.ensureAuthUser(harness.db, pool, { tenantId, email, name: email.split('@')[0]! })
    const onlyHereMember = await login('client', doomed, `only-member@${DOMAIN}`)
    const bothMemberHere = await login('client', doomed, `shared-member@${DOMAIN}`)
    const bothMemberThere = await login('client', two.id, `shared-member@${DOMAIN}`)
    const onlyHereStaff = await login('staff', doomed, `only-staff@${DOMAIN}`)
    const bothStaffHere = await login('staff', doomed, `shared-staff@${DOMAIN}`)
    const bothStaffThere = await login('staff', two.id, `shared-staff@${DOMAIN}`)
    await fixtures.insertRow('clients', doomed, { auth_user_id: onlyHereMember, email: `only-member@${DOMAIN}` })
    await fixtures.insertRow('clients', doomed, { auth_user_id: bothMemberHere, email: `shared-member@${DOMAIN}` })
    await fixtures.insertRow('clients', two.id, { auth_user_id: bothMemberThere, email: `shared-member@${DOMAIN}` })
    await fixtures.insertRow('staff_users', doomed, { auth_user_id: onlyHereStaff, email: `only-staff@${DOMAIN}` })
    await fixtures.insertRow('staff_users', doomed, { auth_user_id: bothStaffHere, email: `shared-staff@${DOMAIN}` })
    await fixtures.insertRow('staff_users', two.id, { auth_user_id: bothStaffThere, email: `shared-staff@${DOMAIN}` })

    // What hangs off a login, at each studio: a credential, a session, a
    // verification, and a staff second factor — so every login table has a row
    // here that must go, and one there that must stay.
    const expiresAt = new Date(Date.now() + 86_400_000)
    const hangingOff = async (tenantId: string, member: string, staff: string) => {
      const session = { id: randomUUID(), token: randomUUID(), expiresAt, claimedTenantId: tenantId, tenantId }
      const credential = { id: randomUUID(), providerId: 'credential', password: 'not-a-real-hash', tenantId }
      const verification = { id: randomUUID(), identifier: `probe-${randomUUID()}`, value: 'x', expiresAt, tenantId }
      await harness.db.insert(schema.clientAuthSessions).values({ ...session, userId: member })
      await harness.db.insert(schema.clientAuthAccounts).values({ ...credential, accountId: member, userId: member })
      await harness.db.insert(schema.clientAuthVerifications).values(verification)
      await harness.db
        .insert(schema.staffAuthSessions)
        .values({ ...session, id: randomUUID(), token: randomUUID(), userId: staff })
      await harness.db
        .insert(schema.staffAuthAccounts)
        .values({ ...credential, id: randomUUID(), accountId: staff, userId: staff })
      await harness.db.insert(schema.staffAuthVerifications).values({ ...verification, id: randomUUID() })
      await harness.db
        .insert(schema.staffAuthTwoFactors)
        .values({ id: randomUUID(), secret: 'probe', backupCodes: 'probe', userId: staff, tenantId })
      return session.id
    }
    await hangingOff(doomed, bothMemberHere, bothStaffHere)
    const thereSession = await hangingOff(two.id, bothMemberThere, bothStaffThere)

    // A platform row in the sign-in log, which was never the studio's.
    const [platformEvent] = await harness.db
      .insert(schema.authEvents)
      .values({ tenantId: null, pool: 'platform', kind: 'sign_in' })
      .returning()

    // A row in every Tenant-scoped table, here and at the other studio, so
    // "nothing left" and "nothing lost" are both claims about every table.
    await fillEveryTable(doomed)
    await fillEveryTable(two.id)

    // A former address, so its redirect goes too.
    await expectStatus(
      await harness.app.request(`/api/v1/platform/tenants/${doomed}/slug`, {
        method: 'POST',
        headers: { Authorization: operator.Authorization!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: `del-whole-moved-${run}` }),
      }),
      200,
    )
    const slug = `del-whole-moved-${run}`

    const doomedBefore = await countsFor(doomed)
    const empty = Object.entries(doomedBefore).filter(([, n]) => n === 0).map(([t]) => t)
    assert.deepEqual(empty, [], 'the studio has a row in every Tenant-scoped table before it goes')
    const oneBefore = await countsFor(one.id)
    const twoBefore = await countsFor(two.id)
    assert.ok(
      Object.values(twoBefore).every(n => n > 0),
      'the other studio has a row in every table too, so its survival means something',
    )

    // Not while it is open…
    await expectStatus(await remove(doomed, slug), 409, 'tenant_not_suspended')
    await expectStatus(await setStatus(doomed, 'suspended'), 200)

    // …and then, whole.
    const body = await expectStatus(await remove(doomed, slug), 200)
    assert.equal(body.deleted.id, doomed)
    assert.equal(body.deleted.slug, slug)
    assert.equal(
      body.deleted.rows,
      Object.values(doomedBefore).reduce((a, b) => a + b, 0),
      'every row counted before is reported deleted',
    )
    // Every login here: the two members' and the three staff members' — the
    // first admin it was provisioned with, and the two added above.
    assert.deepEqual(body.deleted.accounts, { client: 2, staff: 3 })
    assert.equal(body.deleted.objects, null, 'no bucket under test')

    // Nothing of it is left in any Tenant-scoped table…
    const left = Object.entries(await countsFor(doomed)).filter(([, n]) => n > 0)
    assert.deepEqual(left, [], 'no row with its tenant_id remains anywhere')

    // …nor in the platform tables that named it.
    const [row] = await harness.db.select().from(schema.tenants).where(eq(schema.tenants.id, doomed))
    assert.equal(row, undefined, 'the tenants row is gone')
    const formers = await harness.db
      .select()
      .from(schema.formerSlugs)
      .where(eq(schema.formerSlugs.renamedTenantId, doomed))
    assert.equal(formers.length, 0, 'its former addresses stop redirecting')
    const sessions = await harness.db
      .select({ id: schema.clientAuthSessions.id })
      .from(schema.clientAuthSessions)
      .where(inArray(schema.clientAuthSessions.userId, [bothMemberHere, bothMemberThere]))
    assert.deepEqual(sessions.map(s => s.id), [thereSession], 'its sessions end; the other studio’s do not')

    // Logins: every one of this studio's is gone; the other studio's are kept.
    const clientAccount = (id: string) =>
      harness.db.select().from(schema.clientAuthUsers).where(eq(schema.clientAuthUsers.id, id))
    const staffAccount = (id: string) =>
      harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.id, id))
    assert.equal((await clientAccount(onlyHereMember)).length, 0)
    assert.equal((await clientAccount(bothMemberHere)).length, 0)
    assert.equal((await clientAccount(bothMemberThere)).length, 1)
    assert.equal((await staffAccount(onlyHereStaff)).length, 0)
    assert.equal((await staffAccount(bothStaffHere)).length, 0)
    assert.equal((await staffAccount(bothStaffThere)).length, 1)

    // Every other studio is exactly as it was, table by table.
    assert.deepEqual(await countsFor(one.id), oneBefore)
    assert.deepEqual(await countsFor(two.id), twoBefore)
    const [platform] = await harness.db
      .select()
      .from(schema.authEvents)
      .where(eq(schema.authEvents.id, platformEvent!.id))
    assert.ok(platform, 'the platform’s own sign-in rows are untouched')
    await harness.db.delete(schema.authEvents).where(eq(schema.authEvents.id, platformEvent!.id))

    // Its address answers nothing, and is free for a new studio.
    await expectStatus(await harness.app.request(`/api/v1/public/tenants/by-slug/${slug}`), 404, 'not_found')
    const reused = await provision.provisionTenant({ slug, name: 'Next In Line' })
    assert.equal(reused.tenant.slug, slug)

    // A second delete of the same id finds nothing.
    await expectStatus(await remove(doomed, slug), 404)
  })

  /**
   * A studio the size of one restored from years of another booking system —
   * thousands of members, tens of thousands of classes, bookings and
   * check-ins — goes inside the portal's request deadline.
   *
   * The delete is one statement per table, but Postgres checks every foreign
   * key per deleted row: deleting a studio's clients looks each one up in every
   * table that points at `clients`. A referencing column with no index of its
   * own makes each of those lookups a scan of the whole table, and a studio this
   * size then took ~40s — the portal gave up at 15s while the backend carried on
   * and committed (#194). So the sizes here are the ones that failed, and the
   * bound is the portal's.
   */
  test('a studio of a real one’s size is deleted inside the portal’s deadline', { timeout: 180_000 }, async () => {
    const { tenant } = await provision.provisionTenant({ slug: `del-big-${run}`, name: 'Years Of History' })
    const big = tenant.id
    // One class made the ordinary way brings the parents every class needs.
    const seedClass = await fixtures.insertRow('classes', big)
    const SIZE = { clients: 3_400, classes: 11_300, packages: 5_000, bookings: 86_000, checkIns: 80_000, cancellations: 3_000 }

    await harness.db.execute(sql`
      INSERT INTO client_auth_users (id, name, email, tenant_id)
      SELECT 'del-big-${sql.raw(run)}-' || g, 'Member ' || g, 'member-' || g || '@${sql.raw(DOMAIN)}', ${big}
      FROM generate_series(1, ${SIZE.clients}) g`)
    await harness.db.execute(sql`
      INSERT INTO clients (tenant_id, auth_user_id, email, name, phone)
      SELECT ${big}, 'del-big-${sql.raw(run)}-' || g, 'member-' || g || '@${sql.raw(DOMAIN)}', 'Member ' || g, '+6590000000'
      FROM generate_series(1, ${SIZE.clients}) g`)
    await harness.db.execute(sql`
      INSERT INTO classes (tenant_id, class_type_id, main_instructor_id, location_id, created_by_staff_id,
                           starts_at, ends_at, capacity_online, credit_cost)
      SELECT tenant_id, class_type_id, main_instructor_id, location_id, created_by_staff_id,
             now() - g * interval '1 hour', now() - g * interval '1 hour' + interval '1 hour', 20, 1
      FROM classes, generate_series(1, ${SIZE.classes - 1}) g
      WHERE id = ${seedClass.id as string}`)
    await harness.db.execute(sql`
      INSERT INTO client_packages (tenant_id, client_id, kind, validity_days, amount_paid_sgd, list_price_sgd)
      SELECT ${big}, c.id, 'credit_bundle', 30, 100, 100
      FROM (SELECT id, row_number() OVER () AS n FROM clients WHERE tenant_id = ${big}) c,
           generate_series(1, ${Math.ceil(SIZE.packages / SIZE.clients)}) g
      LIMIT ${SIZE.packages}`)
    await harness.db.execute(sql`
      WITH c AS (SELECT id, row_number() OVER (ORDER BY id) - 1 AS n FROM clients WHERE tenant_id = ${big}),
           k AS (SELECT id, row_number() OVER (ORDER BY id) - 1 AS n FROM classes WHERE tenant_id = ${big}),
           p AS (SELECT DISTINCT ON (client_id) id, client_id FROM client_packages WHERE tenant_id = ${big})
      INSERT INTO bookings (tenant_id, kind, class_id, client_id, client_package_id, qr_token, code)
      SELECT ${big}, 'class', k.id, c.id, p.id, 'qr-' || g, 'B' || g
      FROM generate_series(0, ${SIZE.bookings - 1}) g
      JOIN c ON c.n = g % ${SIZE.clients}
      JOIN k ON k.n = g % ${SIZE.classes}
      LEFT JOIN p ON p.client_id = c.id`)
    await harness.db.execute(sql`
      INSERT INTO check_ins (tenant_id, booking_id, method, checked_in_by_staff_id)
      SELECT b.tenant_id, b.id, 'manual', ${seedClass.main_instructor_id as string}
      FROM bookings b WHERE b.tenant_id = ${big} LIMIT ${SIZE.checkIns}`)
    await harness.db.execute(sql`
      INSERT INTO cancellations (tenant_id, booking_id, client_id, kind, source,
                                 was_within_window, was_within_cap, refund_fired, cancelled_at)
      SELECT b.tenant_id, b.id, b.client_id, 'class', 'client', false, true, false, now()
      FROM bookings b WHERE b.tenant_id = ${big}
      ORDER BY b.id DESC LIMIT ${SIZE.cancellations}`)
    await harness.db.execute(sql`ANALYZE`)

    const PORTAL_DEADLINE_MS = 15_000
    const started = performance.now()
    const body = await expectStatus(await remove(big, tenant.slug), 200)
    const took = performance.now() - started

    const made = Object.values(SIZE).reduce((a, b) => a + b, 0)
    assert.ok(body.deleted.rows >= made, `the whole studio went (${body.deleted.rows} of at least ${made} rows)`)
    assert.equal(body.deleted.accounts.client, SIZE.clients, "and every member's login here")
    // Well inside, not just inside: the portal's deadline covers the network too.
    assert.ok(took < PORTAL_DEADLINE_MS / 2, `deleted in ${Math.round(took)}ms; the portal gives up at ${PORTAL_DEADLINE_MS}ms`)
  })
})
