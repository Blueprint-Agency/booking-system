import assert from 'node:assert'
import { after, before, describe, test } from 'node:test'
import { and, eq } from 'drizzle-orm'
import { startTestApp, integrationTestsEnabled, SKIP_REASON, type TestApp } from './harness'

/**
 * Which studio is a Clerk webhook about, and what happens to somebody who
 * belongs to two of them.
 *
 * The decision under test is recorded in `docs/md/spec-tenant-resolution.md`:
 * the Clerk Organization on the event is the authority, `user.*` events are
 * identity only, and an event that names no studio is a logged no-op rather
 * than a guess. The interesting case is the last acceptance criterion — one
 * person, two studios, independent records — which the old platform-wide unique
 * on `clients.email` made structurally impossible.
 */
describe('clerk webhook tenant routing', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let clients!: typeof import('../db/schema/identity')['clients']
  let tenants!: typeof import('../db/schema/tenancy')['tenants']
  let handleClerkClientEvent!: typeof import('../services/auth/webhook-sync')['handleClerkClientEvent']

  const CLERK_USER = 'user_two_studios_probe'
  const EMAIL = 'two-studios-probe@example.test'
  const ORG_OF = (slug: string) => `org_client_${slug}_probe`

  const membershipEvent = (slug: string, name: string) => ({
    type: 'organizationMembership.created',
    data: {
      organization: { id: ORG_OF(slug), slug },
      public_user_data: {
        user_id: CLERK_USER,
        identifier: EMAIL,
        first_name: name,
        last_name: 'Probe',
      },
    },
  })

  const rows = async () =>
    harness.db
      .select({ id: clients.id, tenantId: clients.tenantId, name: clients.name })
      .from(clients)
      .where(eq(clients.clerkUserId, CLERK_USER))

  before(async () => {
    harness = await startTestApp()
    ;({ clients } = await import('../db/schema/identity'))
    ;({ tenants } = await import('../db/schema/tenancy'))
    ;({ handleClerkClientEvent } = await import('../services/auth/webhook-sync'))

    // Provision each studio's member-side Clerk Organization, which is what
    // #58 does in the dashboard and the super portal will do on creation.
    for (const tenant of [harness.tenants.one, harness.tenants.two]) {
      await harness.db
        .update(tenants)
        .set({ clerkClientOrgId: ORG_OF(tenant.slug) })
        .where(eq(tenants.id, tenant.id))
    }
    const { forgetCachedTenants } = await import('../services/tenants/tenants')
    forgetCachedTenants()

    await harness.db.delete(clients).where(eq(clients.clerkUserId, CLERK_USER))
  })

  after(async () => {
    if (!harness) return
    await harness.db.delete(clients).where(eq(clients.clerkUserId, CLERK_USER))
    await harness.db
      .update(tenants)
      .set({ clerkClientOrgId: null })
      .where(eq(tenants.id, harness.tenants.one.id))
    await harness.db
      .update(tenants)
      .set({ clerkClientOrgId: null })
      .where(eq(tenants.id, harness.tenants.two.id))
    await harness.close()
  })

  test('a membership event files the member under the studio it names', async () => {
    const outcome = await handleClerkClientEvent(membershipEvent(harness.tenants.one.slug, 'Ada'))
    assert.equal(outcome.kind, 'created')

    const found = await rows()
    assert.equal(found.length, 1)
    assert.equal(found[0]!.tenantId, harness.tenants.one.id)
  })

  test('the same person joining a second studio gets a second, independent record', async () => {
    const outcome = await handleClerkClientEvent(membershipEvent(harness.tenants.two.slug, 'Ada'))
    assert.equal(outcome.kind, 'created')

    const found = await rows()
    assert.equal(found.length, 2)
    // Two rows, one per studio, with distinct ids — the same email and the same
    // Clerk user, which the pre-tenancy unique made impossible.
    assert.deepEqual(
      found.map(r => r.tenantId).sort(),
      [harness.tenants.one.id, harness.tenants.two.id].sort(),
    )
    assert.notEqual(found[0]!.id, found[1]!.id)
  })

  test('a profile change reaches both records', async () => {
    const outcome = await handleClerkClientEvent({
      type: 'user.updated',
      data: {
        id: CLERK_USER,
        primary_email_address_id: 'e1',
        email_addresses: [
          { id: 'e1', email_address: EMAIL, verification: { status: 'verified' } },
        ],
        first_name: 'Ada',
        last_name: 'Lovelace',
      },
    })
    assert.equal(outcome.kind, 'updated')

    const found = await rows()
    assert.equal(found.length, 2)
    for (const row of found) assert.equal(row.name, 'Ada Lovelace')
  })

  test('an organization this platform has never heard of creates nothing', async () => {
    const before = (await rows()).length
    const outcome = await handleClerkClientEvent({
      type: 'organizationMembership.created',
      data: {
        organization: { id: 'org_not_ours' },
        public_user_data: { user_id: 'user_stranger_probe', identifier: 'stranger@example.test' },
      },
    })
    assert.equal(outcome.kind, 'unresolved_tenant')
    assert.equal((await rows()).length, before)

    const stranger = await harness.db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.clerkUserId, 'user_stranger_probe'))
    assert.equal(stranger.length, 0)
  })

  test('a sign-up that names no studio is deferred, not filed under a guess', async () => {
    const outcome = await handleClerkClientEvent({
      type: 'user.created',
      data: {
        id: 'user_nameless_probe',
        primary_email_address_id: 'e1',
        email_addresses: [{ id: 'e1', email_address: 'nameless@example.test' }],
      },
    })
    assert.equal(outcome.kind, 'unresolved_tenant')

    // Nothing was written anywhere — in particular, not to tenant #1, which is
    // what the pre-tenancy handler did.
    const written = await harness.db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.clerkUserId, 'user_nameless_probe'))
    assert.equal(written.length, 0)
  })

  test("a sign-up carrying its studio's slug is filed there", async () => {
    const outcome = await handleClerkClientEvent({
      type: 'user.created',
      data: {
        id: 'user_slugged_probe',
        primary_email_address_id: 'e1',
        email_addresses: [{ id: 'e1', email_address: 'slugged@example.test' }],
        public_metadata: { tenant_slug: harness.tenants.two.slug },
      },
    })
    assert.equal(outcome.kind, 'created')

    const written = await harness.db
      .select({ tenantId: clients.tenantId })
      .from(clients)
      .where(eq(clients.clerkUserId, 'user_slugged_probe'))
    assert.equal(written.length, 1)
    assert.equal(written[0]!.tenantId, harness.tenants.two.id)

    await harness.db
      .delete(clients)
      .where(
        and(eq(clients.clerkUserId, 'user_slugged_probe'), eq(clients.tenantId, harness.tenants.two.id)),
      )
  })
})
