import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { harnessAddress, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from '../test/harness'
import { withEnv } from '../test/with-env'

/**
 * The throwaway studio the browser journeys run in (#145).
 *
 * What is proven here is what the journeys cannot see for themselves: that the
 * studio is complete enough to buy, book, schedule and cancel in; that the
 * people it hands back can actually sign in; and — above all — that removing it
 * removes exactly it, and nothing of any other studio.
 */
describe('e2e studio', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let studio!: typeof import('./studio')
  let schema!: typeof import('../db/schema')

  before(async () => {
    harness = await startTestApp()
    studio = await import('./studio')
    schema = await import('../db/schema')
  })

  after(async () => {
    await harness?.close()
  })

  const tenantRowCount = async (tenantId: string) => {
    const { tenantTableOrder } = await import('../services/tenants/transfer')
    const { order } = await tenantTableOrder()
    let total = 0
    for (const table of order) {
      const [row] = await harness.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE tenant_id = ${tenantId}`,
      )
      total += row!.n
    }
    return total
  }

  const memberGet = (made: import('./studio').E2eStudio, token: string, path: string) =>
    harness.app.request(`/api/v1/me${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: made.urls.client,
        'X-Tenant-Slug': made.slug,
        'X-Forwarded-For': harnessAddress(),
      },
    })

  test('a studio is made whole: members holding what the journeys need, staff who can sign in', async () => {
    const made = await studio.createE2eStudio({ app: harness.app, db: harness.db })
    try {
      assert.match(made.slug, /^e2e-[a-z0-9]+$/)
      const [tenant] = await harness.db.select().from(schema.tenants).where(eq(schema.tenants.id, made.tenantId))
      assert.equal(tenant?.status, 'active')

      // The buyer starts with nothing, so buying is what gives them a credit.
      const buyerPackages = await memberGet(made, made.members.buyer.token, '/packages')
      assert.equal(buyerPackages.status, 200, await buyerPackages.clone().text())
      assert.equal(JSON.stringify(await buyerPackages.json()).includes(made.catalogue.packageName), false)

      // The canceller already holds credits, so cancelling is what gives one back.
      const cancellerPackages = await memberGet(made, made.members.canceller.token, '/packages')
      assert.equal(cancellerPackages.status, 200)
      assert.ok(JSON.stringify(await cancellerPackages.json()).includes(made.catalogue.packageName))

      for (const person of [made.staff.admin, made.staff.instructor]) {
        const signedIn = await harness.app.request('/api/v1/auth/staff/sign-in/email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: made.urls.portal,
            'X-Tenant-Slug': made.slug,
            'X-Forwarded-For': harnessAddress(),
          },
          body: JSON.stringify({ email: person.email, password: made.staff.password }),
        })
        assert.equal(signedIn.status, 200, `${person.email}: ${await signedIn.text()}`)
        const me = await harness.app.request('/api/v1/portal/auth/me', {
          headers: {
            Authorization: `Bearer ${signedIn.headers.get('set-auth-token')}`,
            Origin: made.urls.portal,
            'X-Tenant-Slug': made.slug,
          },
        })
        assert.equal(me.status, 200, await me.clone().text())
        assert.equal(((await me.json()) as { role?: string }).role, person.role)
      }

      // Cancelling needs the studio's policy row; a created studio has none.
      const [policy] = await harness.db
        .select()
        .from(schema.globalPolicy)
        .where(eq(schema.globalPolicy.tenantId, made.tenantId))
      assert.ok(policy, 'a studio without a policy row cannot cancel a booking')
      assert.ok(new Date(made.classes.cancel.startsAt).getTime() - Date.now() > policy.classWindowHours * 3_600_000)
      // The check-in class has not started, and its Check-in Window is already open.
      const checkInStartsIn = new Date(made.classes.checkIn.startsAt).getTime() - Date.now()
      assert.ok(checkInStartsIn > 0)
      assert.ok(checkInStartsIn < policy.checkInOpensMinutesBefore * 60_000)
      const arriverPackages = await memberGet(made, made.members.arriver.token, '/packages')
      assert.ok(JSON.stringify(await arriverPackages.json()).includes(made.catalogue.packageName))
    } finally {
      await studio.removeE2eStudio({ db: harness.db, slug: made.slug })
    }
  })

  describe('given a payment account', () => {
    withEnv({ PAYMENT_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString('base64') })

    test('the studio takes online payments on it — the buy journey is not refused at checkout (#293)', async () => {
      const { installStripeFake } = await import('../test/stripe-fake')
      const fake = installStripeFake()
      fake.issueKey('sk_test_e2e_studio', 'acct_e2e_studio')
      let made: import('./studio').E2eStudio | undefined
      try {
        made = await studio.createE2eStudio({
          app: harness.app,
          db: harness.db,
          payments: { secretKey: 'sk_test_e2e_studio' },
        })
      } finally {
        // The real lookup from here on: what was stored, opened with the key.
        fake.restore()
      }
      try {
        assert.equal(fake.callsTo('accounts.retrieve').length, 1, 'the key was proved before it was stored')
        assert.deepEqual(
          fake.webhookEndpoints('acct_e2e_studio').map(endpoint => endpoint.url),
          [`http://localhost:4000/api/v1/webhooks/stripe/${made!.slug}`],
          "the studio's webhook endpoint was made on its own account",
        )
        const res = await harness.app.request('/api/v1/public/online-payments', {
          headers: { 'X-Tenant-Slug': made.slug },
        })
        assert.equal(res.status, 200, await res.clone().text())
        assert.deepEqual(await res.json(), { online_payments: true })
      } finally {
        await studio.removeE2eStudio({ db: harness.db, slug: made.slug })
      }
    })

    test('without one it takes none, as every studio starts', async () => {
      const made = await studio.createE2eStudio({ app: harness.app, db: harness.db })
      try {
        const res = await harness.app.request('/api/v1/public/online-payments', {
          headers: { 'X-Tenant-Slug': made.slug },
        })
        assert.deepEqual(await res.json(), { online_payments: false })
      } finally {
        await studio.removeE2eStudio({ db: harness.db, slug: made.slug })
      }
    })
  })

  test('removing a studio removes all of it and nothing of any other studio', async () => {
    const others = await Promise.all([harness.tenants.one.id, harness.tenants.two.id].map(tenantRowCount))
    const made = await studio.createE2eStudio({ app: harness.app, db: harness.db })
    assert.ok((await tenantRowCount(made.tenantId)) > 0)

    const removed = await studio.removeE2eStudio({ db: harness.db, slug: made.slug })

    assert.equal(removed, true)
    assert.equal(await tenantRowCount(made.tenantId), 0)
    assert.equal((await harness.db.select().from(schema.tenants).where(eq(schema.tenants.id, made.tenantId))).length, 0)
    const emails = [made.members.buyer.email, made.members.canceller.email]
    for (const email of emails) {
      const users = await harness.db.select().from(schema.clientAuthUsers).where(eq(schema.clientAuthUsers.email, email))
      assert.equal(users.length, 0, `${email} left behind`)
    }
    for (const person of [made.staff.admin, made.staff.instructor]) {
      const users = await harness.db
        .select()
        .from(schema.staffAuthUsers)
        .where(eq(schema.staffAuthUsers.email, person.email))
      assert.equal(users.length, 0, `${person.email} left behind`)
    }
    assert.deepEqual(
      await Promise.all([harness.tenants.one.id, harness.tenants.two.id].map(tenantRowCount)),
      others,
    )
    // Twice is a no-op, so a teardown that runs after a failed setup is safe.
    assert.equal(await studio.removeE2eStudio({ db: harness.db, slug: made.slug }), false)
  })

  test('a studio that is not an e2e studio cannot be removed', async () => {
    await assert.rejects(
      studio.removeE2eStudio({ db: harness.db, slug: harness.tenants.one.slug }),
      /not an e2e studio/,
    )
    const [tenant] = await harness.db.select().from(schema.tenants).where(eq(schema.tenants.id, harness.tenants.one.id))
    assert.ok(tenant)
  })

  test('a sweep removes e2e studios left behind by a run that died, and leaves recent ones', async () => {
    const stale = await studio.createE2eStudio({ app: harness.app, db: harness.db })
    const fresh = await studio.createE2eStudio({ app: harness.app, db: harness.db })
    try {
      await harness.db
        .update(schema.tenants)
        .set({ createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) })
        .where(eq(schema.tenants.id, stale.tenantId))

      const swept = await studio.removeStaleE2eStudios({ db: harness.db, olderThanMs: 60 * 60 * 1000 })

      assert.ok(swept.includes(stale.slug))
      assert.ok(!swept.includes(fresh.slug))
      assert.ok(!swept.includes(harness.tenants.one.slug))
    } finally {
      await studio.removeE2eStudio({ db: harness.db, slug: stale.slug })
      await studio.removeE2eStudio({ db: harness.db, slug: fresh.slug })
    }
  })
})

test('the e2e studio is refused on production', async () => {
  const { assertMayRunE2eStudio } = await import('./guard')
  assert.throws(() => assertMayRunE2eStudio('production'), /production/)
  assert.doesNotThrow(() => assertMayRunE2eStudio('staging'))
  assert.doesNotThrow(() => assertMayRunE2eStudio('development'))
})
