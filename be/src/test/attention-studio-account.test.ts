import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { withEnv } from './with-env'

/**
 * Staff attention, the studio's account: `studio_term_ending` and
 * `payments_not_configured`, read over HTTP. Only ReserveToday can act on them,
 * so neither has a link. Every test makes a studio of its own.
 */
describe('Staff attention: studio account', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  // A key of this file's own to seal credentials with.
  withEnv({ PAYMENT_CREDENTIALS_KEY: randomBytes(32).toString('base64') })

  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')
  let term!: typeof import('../services/tenants/term')
  let tenantsService!: typeof import('../services/tenants/tenants')
  let credentials!: typeof import('../services/billing/provider-credentials')
  let withTenant!: typeof import('../db').withTenant

  const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)

  type Studio = { id: string; slug: string }
  type Staff = { headers: Record<string, string>; id: string }

  let studios = 0

  const send = (path: string, headers: Record<string, string>) =>
    harness.app.request(`/api/v1${path}`, { headers })

  const json = async (res: Response, status: number) => {
    const text = await res.text()
    assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${text}`)
    return (text ? JSON.parse(text) : {}) as Record<string, any>
  }

  const freshStudio = async (timezone = 'Asia/Singapore'): Promise<Studio> => {
    const slug = `atsa-${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({
      slug,
      name: 'Attention Account Studio',
      adminEmail: `owner@${slug}.test`,
    })
    // The studio's own clock is the one named, whatever the column defaults to.
    await harness.db.update(schema.tenants).set({ timezone }).where(eq(schema.tenants.id, tenant.id))
    tenantsService.forgetCachedTenants()
    return { id: tenant.id, slug }
  }

  const staffAt = async (studio: Studio, name: string, role: 'admin' | 'instructor'): Promise<Staff> => {
    const email = `${name}@${studio.slug}.test`
    const headers = await harness.signInAs('staff', email, studio)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: studio.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning()
    if (role === 'instructor') await harness.db.insert(schema.instructors).values({ tenantId: studio.id, staffUserId: row!.id })
    return { headers, id: row!.id }
  }

  /** Write a Term end date directly: the API only offers 3, 6 or 12 months, and a test needs exact days. */
  const endTermOn = async (studio: Studio, end: string | null) => {
    await harness.db.update(schema.tenants).set({ termEndDate: end }).where(eq(schema.tenants.id, studio.id))
    tenantsService.forgetCachedTenants()
  }

  const summary = async (who: Staff) => json(await send('/portal/attention/summary', who.headers), 200)
  const panel = async (who: Staff) => json(await send('/portal/attention', who.headers), 200)
  const accountItems = async (who: Staff, kind: string) =>
    ((await panel(who)).needs_action.groups as Array<{ items: Array<Record<string, any>> }>)
      .flatMap(g => g.items)
      .filter(i => i.kind === kind)

  // The test database is shared by every file: the credentials this file saves
  // are cleared when it ends, so a file that counts the studios with an account
  // (`payment-credentials.test.ts`) does not meet them.
  const saved: string[] = []

  const savePayments = (studio: Studio) => {
    saved.push(studio.id)
    return withTenant(studio.id, () =>
      credentials.saveProviderCredentials(studio.id, {
        accountId: 'acct_attention_secret_id',
        secretKey: 'sk_test_attention_secret_key',
        webhookSecret: 'whsec_attention_secret',
      }),
    )
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
    term = await import('../services/tenants/term')
    tenantsService = await import('../services/tenants/tenants')
    credentials = await import('../services/billing/provider-credentials')
    withTenant = (await import('../db')).withTenant
  })

  after(async () => {
    for (const id of saved) await credentials?.clearProviderCredentials(id)
    await harness?.close()
  })

  test('ATN-130 a Term ending within 14 days on the studio\'s own clock shows to an Admin, naming the end date and saying only ReserveToday can renew it', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'anna', 'admin')
    // 17:00 UTC on 10 June is 01:00 on 11 June in Singapore: the studio's today is the 11th.
    harness.clock.set(new Date(Date.UTC(2031, 5, 10, 17, 0)))

    await endTermOn(studio, '2031-06-26')
    assert.deepEqual(await accountItems(admin, 'studio_term_ending'), [], '15 days away on the studio\'s clock is not yet')

    await endTermOn(studio, '2031-06-25')
    const item = (await accountItems(admin, 'studio_term_ending'))[0]!
    assert.equal(item.id, `studio_term_ending:${studio.id}`)
    assert.equal(item.title, "Your studio's term with ReserveToday ends on 25 Jun 2031")
    assert.equal(item.detail, "After that, members and staff can't use the apps. Contact ReserveToday to renew")
    assert.equal(item.location, null)
    assert.equal(item.dismissable, false)

    await endTermOn(studio, '2031-06-12')
    assert.equal((await accountItems(admin, 'studio_term_ending')).length, 1, 'tomorrow: still showing')
  })

  test('TEN-75 the Term warning began at midnight on the studio\'s own clock, fourteen days before the end date: Sydney\'s in daylight saving, Singapore\'s eight hours ahead of UTC', async () => {
    harness.clock.set(new Date('2026-11-10T00:00:00Z'))
    for (const [timezone, began] of [
      ['Australia/Sydney', '2026-11-04T13:00:00.000Z'],
      ['Asia/Singapore', '2026-11-04T16:00:00.000Z'],
    ] as const) {
      const studio = await freshStudio(timezone)
      const admin = await staffAt(studio, 'anna', 'admin')
      await endTermOn(studio, '2026-11-19')
      const item = (await accountItems(admin, 'studio_term_ending'))[0]!
      assert.equal(item.occurred_at, began, timezone)
    }
  })

  test('ATN-131 an open-ended Term never shows, and extending a Term through the service makes the item disappear', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'anna', 'admin')
    harness.clock.set(new Date(Date.UTC(2031, 5, 10, 4, 0)))

    await endTermOn(studio, null)
    assert.deepEqual(await accountItems(admin, 'studio_term_ending'), [])

    await endTermOn(studio, '2031-06-20')
    assert.equal((await accountItems(admin, 'studio_term_ending')).length, 1)
    assert.ok((await summary(admin)).needs_action >= 1)

    await withTenant(studio.id, () => term.setTenantTerm(studio.id, { startDate: '2031-06-10', months: 6 }))
    assert.deepEqual(await accountItems(admin, 'studio_term_ending'), [], 'a Term to December is nowhere near')
  })

  test('ATN-132 payments_not_configured shows while the studio has no payment credentials and goes once they are saved', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'anna', 'admin')

    const item = (await accountItems(admin, 'payments_not_configured'))[0]!
    assert.equal(item.id, `payments_not_configured:${studio.id}`)
    assert.equal(item.title, "Online payments aren't set up")
    assert.equal(item.detail, "Members can't buy or be refunded until ReserveToday connects your Stripe account")
    assert.equal(item.dismissable, false)

    await savePayments(studio)
    assert.deepEqual(await accountItems(admin, 'payments_not_configured'), [])
  })

  test('ATN-133 both items are for Admins only and carry no href, and the group is pinned above every other group', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'anna', 'admin')
    const instructor = await staffAt(studio, 'ines', 'instructor')
    harness.clock.set(new Date(Date.UTC(2031, 5, 10, 4, 0)))
    await endTermOn(studio, '2031-06-20')

    const body = await panel(admin)
    const [first, ...rest] = body.needs_action.groups as [Record<string, any>, ...Array<Record<string, any>>]
    assert.equal(first.key, 'studio_account')
    assert.equal(first.label, 'Studio account')
    assert.equal(first.count, 2)
    assert.equal(first.see_all_href, null)
    assert.deepEqual(first.items.map((i: any) => i.kind).sort(), ['payments_not_configured', 'studio_term_ending'])
    for (const i of first.items) assert.equal(i.href, null)
    assert.ok(rest.every(g => g.key !== 'studio_account'))

    assert.equal((await summary(admin)).needs_action, 2)
    assert.equal((await summary(instructor)).needs_action, 0)
    assert.deepEqual(await accountItems(instructor, 'studio_term_ending'), [])
    assert.deepEqual(await accountItems(instructor, 'payments_not_configured'), [])
  })

  test('ATN-134 the items expose only the studio\'s own facts: no account id, and nothing about the credentials', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'anna', 'admin')
    harness.clock.set(new Date(Date.UTC(2031, 5, 10, 4, 0)))
    await endTermOn(studio, '2031-06-20')

    const before = JSON.stringify(await panel(admin))
    await savePayments(studio)
    const after = JSON.stringify(await panel(admin))
    for (const text of [before, after]) {
      assert.ok(!/acct_attention|sk_test|whsec_/.test(text), 'no key, secret or account id in the response')
    }
    const item = (await accountItems(admin, 'studio_term_ending'))[0]!
    assert.deepEqual(Object.keys(item).sort(), [
      'dismissable', 'detail', 'href', 'id', 'kind', 'location', 'occurred_at', 'title',
    ].sort())
  })

  test('ATN-135 another studio\'s Term and payments never reach this studio\'s Admin', async () => {
    const mine = await freshStudio()
    const theirs = await freshStudio()
    const admin = await staffAt(mine, 'anna', 'admin')
    harness.clock.set(new Date(Date.UTC(2031, 5, 10, 4, 0)))
    await endTermOn(mine, null)
    await endTermOn(theirs, '2031-06-12')
    await savePayments(mine)

    assert.deepEqual(await accountItems(admin, 'studio_term_ending'), [])
    assert.deepEqual(await accountItems(admin, 'payments_not_configured'), [])
    assert.equal((await summary(admin)).needs_action, 0)
  })
})
