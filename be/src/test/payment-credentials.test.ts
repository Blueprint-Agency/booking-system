import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { startTestApp, integrationTestsEnabled, SKIP_REASON, type TestApp } from './harness'

/**
 * A Tenant's own payment-provider credentials, against a real Postgres (#100).
 *
 * The unit tests next to `secret-box.ts` prove the sealing and the ones next to
 * `webhook-verification.ts` prove that one studio's secret cannot verify
 * another's. This file asks the questions only a database can answer: is what
 * lands in the column actually unreadable, does Row-Level Security keep one
 * studio's credentials away from another's context, and does a studio with no
 * row still resolve to the platform account.
 */

const SECRET_KEY = 'sk_live_a_studios_own_key_9f2c'
const WEBHOOK_SECRET = 'whsec_a_studios_own_signing_secret'
const ACCOUNT_ID = 'acct_a_studios_own_account'

// Before the app — and therefore `env` — is imported by the harness.
process.env.PAYMENT_CREDENTIALS_KEY ??= randomBytes(32).toString('base64')

type Subject = {
  loadProviderCredentials: typeof import('../services/billing/provider-credentials').loadProviderCredentials
  saveProviderCredentials: typeof import('../services/billing/provider-credentials').saveProviderCredentials
  clearProviderCredentials: typeof import('../services/billing/provider-credentials').clearProviderCredentials
  providerAccountStatuses: typeof import('../services/billing/provider-credentials').providerAccountStatuses
  providerAccountForTenant: typeof import('../lib/stripe').providerAccountForTenant
  withTenant: typeof import('../db').withTenant
  tenantPaymentCredentials: typeof import('../db/schema/tenancy').tenantPaymentCredentials
}

let harness: TestApp
let subject: Subject

describe('a Tenant supplies its own payment-provider credentials', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  before(async () => {
    harness = await startTestApp()
    const [credentials, stripe, db, schema] = await Promise.all([
      import('../services/billing/provider-credentials'),
      import('../lib/stripe'),
      import('../db'),
      import('../db/schema/tenancy'),
    ])
    subject = {
      loadProviderCredentials: credentials.loadProviderCredentials,
      saveProviderCredentials: credentials.saveProviderCredentials,
      clearProviderCredentials: credentials.clearProviderCredentials,
      providerAccountStatuses: credentials.providerAccountStatuses,
      providerAccountForTenant: stripe.providerAccountForTenant,
      withTenant: db.withTenant,
      tenantPaymentCredentials: schema.tenantPaymentCredentials,
    }
    await subject.clearProviderCredentials(harness.tenants.one.id)
    await subject.clearProviderCredentials(harness.tenants.two.id)
  })

  after(async () => {
    await subject.clearProviderCredentials(harness.tenants.one.id)
    await subject.clearProviderCredentials(harness.tenants.two.id)
    await harness.close()
  })

  test('what lands in the column is unreadable, and the account is not', async () => {
    await subject.saveProviderCredentials(harness.tenants.one.id, {
      accountId: ACCOUNT_ID,
      secretKey: SECRET_KEY,
      webhookSecret: WEBHOOK_SECRET,
    })

    // Read as the OWNER, which is the strongest reader there is — a database
    // backup, a console, a dump pulled into a dev environment.
    const [row] = await harness.db
      .select()
      .from(subject.tenantPaymentCredentials)
      .where(eq(subject.tenantPaymentCredentials.tenantId, harness.tenants.one.id))

    assert.ok(row)
    assert.ok(!row.secretKeySealed.includes(SECRET_KEY))
    assert.ok(!row.webhookSecretSealed.includes(WEBHOOK_SECRET))
    // The account id is deliberately not sealed: it names the account rather
    // than opening it, and naming it is what the super portal shows back.
    assert.equal(row.accountId, ACCOUNT_ID)
  })

  test('the studio resolves to its own account, and its neighbour does not', async () => {
    const own = await subject.providerAccountForTenant(harness.tenants.one.id)
    assert.equal(own?.accountId, ACCOUNT_ID)
    assert.equal(own?.secretKey, SECRET_KEY)
    assert.equal(own?.webhookSecret, WEBHOOK_SECRET)

    // The studio beside it has supplied nothing and still sells on the platform
    // account — which is what lets studios be onboarded one at a time.
    assert.equal(await subject.providerAccountForTenant(harness.tenants.two.id), null)
  })

  test("one studio's context cannot read another's credentials", async () => {
    const rows = await subject.withTenant(harness.tenants.two.id, () =>
      import('../db').then(({ db }) => db.select().from(subject.tenantPaymentCredentials)),
    )
    assert.deepEqual(rows, [])

    const own = await subject.withTenant(harness.tenants.one.id, () =>
      import('../db').then(({ db }) => db.select().from(subject.tenantPaymentCredentials)),
    )
    assert.equal(own.length, 1)
  })

  test('the super portal is told which studios are configured, and nothing more', async () => {
    const statuses = await subject.providerAccountStatuses()

    assert.deepEqual(statuses.get(harness.tenants.one.id), {
      configured: true,
      accountId: ACCOUNT_ID,
    })
    assert.equal(statuses.get(harness.tenants.two.id), undefined)
    // The whole of what that surface can know: whose account, and which one.
    assert.deepEqual(Object.keys(statuses.get(harness.tenants.one.id)!), [
      'configured',
      'accountId',
    ])
  })

  test('replacing credentials replaces them, rather than adding a second set', async () => {
    await subject.saveProviderCredentials(harness.tenants.one.id, {
      accountId: 'acct_the_right_one',
      secretKey: 'sk_live_the_right_key',
      webhookSecret: 'whsec_the_right_secret',
    })

    const counted = await harness.db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM tenant_payment_credentials
          WHERE tenant_id = ${harness.tenants.one.id}`,
    )
    assert.equal(Number(counted[0]?.count), 1)

    const account = await subject.providerAccountForTenant(harness.tenants.one.id)
    assert.equal(account?.accountId, 'acct_the_right_one')
    assert.equal(account?.secretKey, 'sk_live_the_right_key')
  })

  test('clearing puts the studio back on the platform account', async () => {
    await subject.clearProviderCredentials(harness.tenants.one.id)

    assert.equal(await subject.providerAccountForTenant(harness.tenants.one.id), null)
    assert.equal((await subject.providerAccountStatuses()).size, 0)
  })
})
