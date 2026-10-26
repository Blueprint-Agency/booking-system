import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.email-switches.test`
const EMAILS_PATH = '/api/v1/portal/admin/emails'

/**
 * A studio switches individual emails off and on (#467): the admin API that
 * lists and changes them, and the one send path that honours them. A
 * switched-off email is not sent and leaves a `skipped` row in `email_log`; a
 * locked one is sent whatever is stored.
 */
describe('email switches', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let mailer!: typeof import('../lib/mailer')
  let send!: typeof import('../services/notifications/send')
  let withTenant!: typeof import('../db').withTenant

  type Tenant = { id: string; slug: string }
  type Staff = { id: string; email: string; headers: Record<string, string> }
  type Email = { slug: string; audience: 'member' | 'staff'; locked: boolean; enabled: boolean }

  const json = { 'Content-Type': 'application/json' }
  async function expectStatus(res: Response, status: number, error?: string): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    const body = text ? JSON.parse(text) : {}
    if (error !== undefined) assert.equal(body.error, error, text)
    return body
  }

  let people = 0
  async function staffAt(tenant: Tenant, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = `${role}-${people++}-${tenant.slug}@${DOMAIN}`
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.email, email), eq(schema.staffAuthUsers.tenantId, tenant.id)))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name: `Staff ${people}`, role, status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row!.id })
    return { id: row!.id, email, headers }
  }

  const list = (as: Staff) => harness.app.request(EMAILS_PATH, { headers: as.headers })
  const change = (as: Staff, slug: string, enabled: boolean) =>
    harness.app.request(`${EMAILS_PATH}/${slug}`, { method: 'PATCH', headers: { ...as.headers, ...json }, body: JSON.stringify({ enabled }) })

  let addresses = 0
  const address = (label: string) => `${label}-${addresses++}@${DOMAIN}`

  /** Send one templated email at `tenant` to a fresh address, and say what reached the transport and what the log holds. */
  async function sendTo(tenant: Tenant, slug: import('../services/notifications/send').SentTemplateSlug, userKind: 'client' | 'staff' = 'client') {
    const email = address(slug)
    await withTenant(tenant.id, () => send.sendTemplatedEmail({ tenantId: tenant.id, slug, recipient: { email, userKind }, variables: {} }))
    return outcome(tenant, email)
  }

  async function outcome(tenant: Tenant, email: string) {
    const mailed = mailer.discardedMail.filter(m => m.to === email).length
    const logged = await harness.db
      .select({ status: schema.emailLog.status, slug: schema.emailLog.templateSlug })
      .from(schema.emailLog)
      .where(and(eq(schema.emailLog.tenantId, tenant.id), eq(schema.emailLog.recipientEmail, email)))
    return { mailed, statuses: logged.map(r => r.status), slugs: logged.map(r => r.slug) }
  }

  async function clearSwitches() {
    const { one, two } = harness.tenants
    await harness.db.execute(sql`DELETE FROM email_switches WHERE tenant_id IN (${one.id}, ${two.id})`)
  }

  let admin!: Staff
  let otherAdmin!: Staff
  let instructor!: Staff
  let theirAdmin!: Staff

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    mailer = await import('../lib/mailer')
    send = await import('../services/notifications/send')
    ;({ withTenant } = await import('../db'))
    await clearSwitches()
    admin = await staffAt(harness.tenants.one, 'admin')
    otherAdmin = await staffAt(harness.tenants.one, 'admin')
    instructor = await staffAt(harness.tenants.one, 'instructor')
    theirAdmin = await staffAt(harness.tenants.two, 'admin')
  })

  after(async () => {
    if (!harness) return
    try {
      const ours = `%@${DOMAIN}`
      const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
      await clearSwitches()
      await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
      await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
      await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    } finally {
      await harness.close()
    }
  })

  test('NTF-38 an admin lists every email the studio sends, grouped by who receives it, each locked or not and every one on', async () => {
    const { STUDIO_EMAILS } = await import('../services/notifications/switches')
    const body = await expectStatus(await list(admin), 200)
    for (const audience of ['member', 'staff'] as const) {
      const group: Email[] = body[audience]
      const expected = Object.entries(STUDIO_EMAILS).filter(([, e]) => e.audience === audience)
      assert.deepEqual(
        group.map(e => e.slug).sort(),
        expected.map(([slug]) => slug).sort(),
      )
      for (const email of group) {
        assert.equal(email.audience, audience)
        assert.equal(email.enabled, true, `${email.slug} starts on`)
      }
    }
    const byslug = new Map<string, Email>([...body.member, ...body.staff].map((e: Email) => [e.slug, e]))
    assert.equal(byslug.get('class_booking_confirmed')?.locked, false)
    assert.equal(byslug.get('sign_in_code')?.locked, true)
    assert.equal(byslug.get('checkin_nag')?.locked, false)
    assert.equal(byslug.get('welcome'), undefined, 'an email no sender sends is not listed')
  })

  test('NTF-39 a switched-off email is not sent and its log row is skipped; switched back on, it sends', async () => {
    const { one } = harness.tenants
    const off = await expectStatus(await change(admin, 'class_booking_confirmed', false), 200)
    assert.deepEqual(off, { slug: 'class_booking_confirmed', audience: 'member', locked: false, enabled: false })
    const listed = await expectStatus(await list(admin), 200)
    assert.equal(listed.member.find((e: Email) => e.slug === 'class_booking_confirmed').enabled, false)

    assert.deepEqual(await sendTo(one, 'class_booking_confirmed'), { mailed: 0, statuses: ['skipped'], slugs: ['class_booking_confirmed'] })

    await expectStatus(await change(admin, 'class_booking_confirmed', true), 200)
    assert.deepEqual(await sendTo(one, 'class_booking_confirmed'), { mailed: 1, statuses: ['sent'], slugs: ['class_booking_confirmed'] })
  })

  test('NTF-40 a switched-off staff email sent to every admin reaches none of them, each logged skipped', async () => {
    const { one } = harness.tenants
    await expectStatus(await change(admin, 'leave_request_submitted', false), 200)
    await withTenant(one.id, () => send.emailEveryAdmin(one.id, 'leave_request_submitted', async () => ({})))
    for (const who of [admin, otherAdmin]) {
      assert.deepEqual(await outcome(one, who.email), { mailed: 0, statuses: ['skipped'], slugs: ['leave_request_submitted'] })
    }
    await expectStatus(await change(admin, 'leave_request_submitted', true), 200)
  })

  test('NTF-41 a locked email is sent whatever its stored switch says, and an admin cannot switch it', async () => {
    const { one } = harness.tenants
    const refused = await expectStatus(await change(admin, 'sign_in_code', false), 409, 'email_locked')
    assert.match(String(refused.message), /\.$/, 'refused with a sentence')

    await harness.db.insert(schema.emailSwitches).values([
      { tenantId: one.id, slug: 'admin_cancel_class', enabled: false },
      { tenantId: one.id, slug: 'staff_email_changed_notice', enabled: false },
    ])
    assert.deepEqual(await sendTo(one, 'admin_cancel_class'), { mailed: 1, statuses: ['sent'], slugs: ['admin_cancel_class'] })

    const email = address('notice')
    const went = await withTenant(one.id, () =>
      send.sendStudioSystemEmail({
        tenantId: one.id,
        slug: 'staff_email_changed_notice',
        recipient: { email, userKind: 'staff' },
        render: () => ({ subject: 'Your sign-in email changed', html: '<p>Changed.</p>', text: 'Changed.' }),
      }),
    )
    assert.equal(went, true)
    assert.deepEqual(await outcome(one, email), { mailed: 1, statuses: ['sent'], slugs: ['staff_email_changed_notice'] })
    await harness.db
      .delete(schema.emailSwitches)
      .where(and(eq(schema.emailSwitches.tenantId, one.id), inArray(schema.emailSwitches.slug, ['admin_cancel_class', 'staff_email_changed_notice'])))
  })

  test("NTF-42 one studio's switch does not reach another studio", async () => {
    const { one, two } = harness.tenants
    await expectStatus(await change(admin, 'credit_expiry_reminder', false), 200)

    const theirs = await expectStatus(await list(theirAdmin), 200)
    assert.equal(theirs.member.find((e: Email) => e.slug === 'credit_expiry_reminder').enabled, true)
    assert.deepEqual(await sendTo(two, 'credit_expiry_reminder'), { mailed: 1, statuses: ['sent'], slugs: ['credit_expiry_reminder'] })
    assert.deepEqual(await sendTo(one, 'credit_expiry_reminder'), { mailed: 0, statuses: ['skipped'], slugs: ['credit_expiry_reminder'] })

    await expectStatus(await change(theirAdmin, 'credit_expiry_reminder', true), 200)
    assert.deepEqual(await sendTo(one, 'credit_expiry_reminder'), { mailed: 0, statuses: ['skipped'], slugs: ['credit_expiry_reminder'] })
    await expectStatus(await change(admin, 'credit_expiry_reminder', true), 200)
  })

  test('NTF-43 an instructor can neither list nor change the switches, and an email the studio does not send is not found', async () => {
    await expectStatus(await list(instructor), 403)
    await expectStatus(await change(instructor, 'checkin_nag', false), 403)
    await expectStatus(await change(admin, 'welcome', false), 404, 'email_not_found')
    const listed = await expectStatus(await list(admin), 200)
    assert.equal(listed.staff.find((e: Email) => e.slug === 'checkin_nag').enabled, true)
  })

  test('NTF-44 each change writes an audit row naming who, the email, and what it went from and to', async () => {
    const { one } = harness.tenants
    await expectStatus(await change(otherAdmin, 'checkin_nag', false), 200)
    await expectStatus(await change(otherAdmin, 'checkin_nag', false), 200)
    await expectStatus(await change(otherAdmin, 'checkin_nag', true), 200)
    const rows = await harness.db
      .select({ actor: schema.auditLog.actorStaffId, action: schema.auditLog.action, payload: schema.auditLog.payload })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.tenantId, one.id),
          eq(schema.auditLog.actorStaffId, otherAdmin.id),
          eq(schema.auditLog.targetTable, 'email_switches'),
        ),
      )
      .orderBy(schema.auditLog.createdAt)
    assert.deepEqual(rows, [
      { actor: otherAdmin.id, action: 'email_switch_changed', payload: { slug: 'checkin_nag', from: true, to: false } },
      { actor: otherAdmin.id, action: 'email_switch_changed', payload: { slug: 'checkin_nag', from: false, to: true } },
    ])
  })

  test("NTF-45 a studio's archive carries its switches, and restoring it switches the same emails off", async () => {
    const transfer = await import('../services/tenants/transfer')
    const { listStudioEmails } = await import('../services/notifications/switch-state')
    async function emptyStudio(label: string): Promise<string> {
      const slug = `switches-${label}-${run}`
      const [row] = await harness.db.execute<{ id: string }>(sql`
        INSERT INTO tenants (slug, name, timezone, status) VALUES (${slug}, ${slug}, 'Asia/Singapore', 'active') RETURNING id
      `)
      await harness.db.execute(sql`INSERT INTO tenant_settings (tenant_id, display_name) VALUES (${row!.id}, ${slug})`)
      return row!.id
    }
    const source = await emptyStudio('source')
    await harness.db.insert(schema.emailSwitches).values([
      { tenantId: source, slug: 'checkin_nag', enabled: false },
      { tenantId: source, slug: 'class_booking_confirmed', enabled: true },
    ])

    const archive = await transfer.exportTenant(source)
    const target = await emptyStudio('target')
    await transfer.importTenant(target, archive)

    const restored = await withTenant(target, () => listStudioEmails(target))
    const off = [...restored.member, ...restored.staff].filter(e => !e.enabled).map(e => e.slug)
    assert.deepEqual(off, ['checkin_nag'])
  })
})
