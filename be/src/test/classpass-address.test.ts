import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray, like, or } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { classPassEmail, GMAIL_CONFIRMATION_LINK, gmailForwardingConfirmation } from './classpass-email'
import { withEnv } from './with-env'

/**
 * The ClassPass address: a studio's forwarded mail is received and kept,
 * each email with its outcome, and nothing is imported yet. Driven through the
 * one ClassPass entry point, `receiveClassPassEmail`, and read back through the
 * ClassPass page's own status.
 */
describe('the ClassPass address', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  withEnv({ CLASSPASS_INBOUND_DOMAIN: 'classpass-inbound.test' })
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let receive!: typeof import('../services/classpass/receive')
  let settings!: typeof import('../services/classpass/settings')

  const DOMAIN = `${randomUUID().slice(0, 8)}.classpass-address.test`

  async function staff(tenant: { id: string; slug: string }, name: string, role: 'admin' | 'instructor') {
    const email = `${name}-${tenant.slug}@${DOMAIN}`
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.tenantId, tenant.id), eq(schema.staffAuthUsers.email, email)))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row!.id })
    }
    return headers
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    receive = inTenantContext(await import('../services/classpass/receive'))
    settings = inTenantContext(await import('../services/classpass/settings'))
  })

  after(async () => {
    for (const tenant of [harness.tenants.one, harness.tenants.two]) {
      await harness.db.delete(schema.classpassInboundEmails).where(eq(schema.classpassInboundEmails.tenantId, tenant.id))
      await harness.db.delete(schema.classpassSettings).where(eq(schema.classpassSettings.tenantId, tenant.id))
    }
    const db = harness.db
    const staffIds = (
      await db.select({ id: schema.staffUsers.id }).from(schema.staffUsers).where(like(schema.staffUsers.email, `%@${DOMAIN}`))
    ).map(s => s.id)
    const authIds = (
      await db
        .select({ id: schema.staffAuthUsers.id })
        .from(schema.staffAuthUsers)
        .where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))
    ).map(u => u.id)
    if (authIds.length) {
      await db
        .delete(schema.authEvents)
        .where(or(inArray(schema.authEvents.actorUserId, authIds), inArray(schema.authEvents.subjectUserId, authIds)))
    }
    if (staffIds.length) {
      await db.delete(schema.auditLog).where(inArray(schema.auditLog.actorStaffId, staffIds))
      await db.delete(schema.instructors).where(inArray(schema.instructors.staffUserId, staffIds))
      await db.delete(schema.staffUsers).where(inArray(schema.staffUsers.id, staffIds))
    }
    await db.delete(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))
    await harness?.close()
  })

  test('CPS-10 a ClassPass booking email that passes DKIM, with the import off, is kept for review, and the status counts it', async () => {
    const { one } = harness.tenants
    const before = await settings.readClassPass(one.id)

    const email = classPassEmail({ kind: 'booking' })
    const result = await receive.receiveClassPassEmail(one.id, email)
    assert.deepEqual([result.outcome, result.reason], ['review', 'import_off'])

    const after = await settings.readClassPass(one.id)
    assert.equal(after.counts.review, before.counts.review + 1)
    assert.equal(after.counts.imported, 0)
    assert.equal(after.lastReceivedAt?.toISOString(), email.receivedAt.toISOString())
  })

  test('CPS-11 an email without a passing ClassPass DKIM signature is kept as refused', async () => {
    const { one } = harness.tenants
    const before = await settings.readClassPass(one.id)

    const failing = await receive.receiveClassPassEmail(one.id, classPassEmail({ dkim: 'fail' }))
    const unsigned = await receive.receiveClassPassEmail(one.id, classPassEmail({ dkim: null }))
    const unaligned = await receive.receiveClassPassEmail(one.id, classPassEmail({ dkim: 'gray' }))
    // Signed, but not by ClassPass: someone who learned the address, posing as it.
    const lookalike = await receive.receiveClassPassEmail(
      one.id,
      classPassEmail({ from: 'ClassPass <noreply@info-classpass.example>' }),
    )
    for (const result of [failing, unsigned, unaligned, lookalike]) assert.equal(result.outcome, 'refused')

    const after = await settings.readClassPass(one.id)
    assert.equal(after.counts.refused, before.counts.refused + 4)
    assert.equal(after.counts.ignored, before.counts.ignored)
  })

  test('CPS-12 the same Message-ID twice is kept once', async () => {
    const { one } = harness.tenants
    const before = await settings.readClassPass(one.id)

    const email = classPassEmail({ layout: '2025-text' })
    const first = await receive.receiveClassPassEmail(one.id, email)
    const second = await receive.receiveClassPassEmail(one.id, { ...email, receivedAt: new Date() })
    assert.equal(first.duplicate, false)
    assert.equal(second.duplicate, true)
    assert.equal(second.id, first.id)

    const after = await settings.readClassPass(one.id)
    assert.equal(after.counts.review, before.counts.review + 1)
  })

  test('CPS-13 the switch starts off: a booking email is kept for review while it is off, and a marketing email is kept as ignored whether it is on or off', async () => {
    const { two } = harness.tenants
    assert.equal((await settings.readClassPass(two.id)).enabled, false)

    const off = await receive.receiveClassPassEmail(two.id, classPassEmail({ kind: 'booking' }))
    assert.deepEqual([off.outcome, off.reason], ['review', 'import_off'])
    const offMarketing = await receive.receiveClassPassEmail(two.id, classPassEmail({ kind: 'marketing' }))
    assert.equal(offMarketing.outcome, 'ignored')

    assert.equal((await settings.setClassPassEnabled(two.id, true)).enabled, true)
    const on = await receive.receiveClassPassEmail(two.id, classPassEmail({ kind: 'marketing' }))
    assert.equal(on.outcome, 'ignored')

    assert.equal((await settings.setClassPassEnabled(two.id, false)).enabled, false)
  })

  test("CPS-14 Gmail's forwarding confirmation shows its code on the ClassPass page", async () => {
    const { one } = harness.tenants
    const forged = await receive.receiveClassPassEmail(one.id, gmailForwardingConfirmation({ code: '111222333', dkim: 'fail' }))
    assert.equal(forged.outcome, 'refused')
    assert.notEqual((await settings.readClassPass(one.id)).gmailConfirmationCode, '111222333')

    const real = gmailForwardingConfirmation({ code: '493017286' })
    await receive.receiveClassPassEmail(one.id, real)
    const status = await settings.readClassPass(one.id)
    assert.equal(status.gmailConfirmationCode, '493017286')
    assert.equal(status.gmailConfirmationAt?.toISOString(), real.receivedAt.toISOString())
  })

  test("CPS-112 Gmail's link-only forwarding confirmation shows its confirmation link on the ClassPass page; a link anywhere but Gmail's settings is not taken", async () => {
    const { two } = harness.tenants
    const forged = await receive.receiveClassPassEmail(two.id, gmailForwardingConfirmation({ format: 'link', dkim: 'fail' }))
    assert.equal(forged.outcome, 'refused')
    assert.equal((await settings.readClassPass(two.id)).gmailConfirmationLink, null)

    const elsewhere = gmailForwardingConfirmation({ format: 'link', link: 'https://mail-settings.google.com.example/mail/vf-%5Bx%5D-y' })
    await receive.receiveClassPassEmail(two.id, elsewhere)
    assert.equal((await settings.readClassPass(two.id)).gmailConfirmationLink, null)

    const real = gmailForwardingConfirmation({ format: 'link' })
    await receive.receiveClassPassEmail(two.id, real)
    const status = await settings.readClassPass(two.id)
    assert.equal(status.gmailConfirmationLink, GMAIL_CONFIRMATION_LINK)
    assert.equal(status.gmailConfirmationCode, null)
    assert.equal(status.gmailConfirmationAt?.toISOString(), real.receivedAt.toISOString())

    // Regenerating the address clears the link with the code: it confirmed the old address.
    assert.equal((await settings.regenerateClassPassAddress(two.id)).gmailConfirmationLink, null)
  })

  test('CPS-15 regenerating the address gives a new one and clears the old Gmail code', async () => {
    const { one } = harness.tenants
    await receive.receiveClassPassEmail(one.id, gmailForwardingConfirmation({ code: '700800900' }))
    const before = await settings.readClassPass(one.id)
    assert.ok(before.address, 'the test environment names an inbound domain')
    assert.match(before.address, /^[0-9a-f]{32}@classpass-inbound\.test$/)

    const after = await settings.regenerateClassPassAddress(one.id)
    assert.ok(after.address)
    assert.notEqual(after.address, before.address)
    assert.equal(after.gmailConfirmationCode, null)
    assert.equal((await settings.readClassPass(one.id)).address, after.address)
  })

  test('CPS-19 the ClassPass page is an Admin\'s: an Admin reads, switches and regenerates it, an Instructor is refused', async () => {
    const { two } = harness.tenants
    const admin = await staff(two, 'cps-admin', 'admin')
    const instructor = await staff(two, 'cps-instructor', 'instructor')
    const call = (headers: Record<string, string>, method: string, path: string, body?: unknown) =>
      harness.app.request(`/api/v1/portal/admin/classpass${path}`, {
        method,
        headers: { ...headers, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })

    const read = await call(admin, 'GET', '')
    assert.equal(read.status, 200)
    const page = (await read.json()) as Record<string, any>
    assert.match(page.address, /@classpass-inbound\.test$/)
    assert.equal(typeof page.enabled, 'boolean')
    assert.equal(typeof page.counts.ignored, 'number')
    assert.ok('last_received_at' in page && 'gmail_confirmation_code' in page)

    const on = await call(admin, 'PATCH', '', { enabled: true })
    assert.equal(on.status, 200)
    assert.equal(((await on.json()) as { enabled: boolean }).enabled, true)

    const regenerated = await call(admin, 'POST', '/address/regenerate')
    assert.equal(regenerated.status, 200)
    assert.notEqual(((await regenerated.json()) as { address: string }).address, page.address)

    for (const [method, path] of [['GET', ''], ['PATCH', ''], ['POST', '/address/regenerate']] as const) {
      const res = await call(instructor, method, path, method === 'PATCH' ? { enabled: false } : undefined)
      assert.equal(res.status, 403)
    }
    assert.equal((await settings.readClassPass(two.id)).enabled, true)
  })
})
