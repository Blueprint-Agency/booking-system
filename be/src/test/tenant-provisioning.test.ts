import assert from 'node:assert'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { startTestApp, integrationTestsEnabled, SKIP_REASON, type TestApp } from './harness'
import type { ClerkOrgPort } from '../services/tenants/provision'

/**
 * "Creation is atomic; a failure at any step leaves no partial Tenant."
 *
 * The unit tests next to `provision.ts` prove the compensation *ordering* with a
 * fake Clerk and no database. This file is the other half: a real Postgres, with
 * the real Row-Level Security policies live, asserting that what is left behind
 * after a failure is **nothing** — no `tenants` row, no `tenant_settings`, no
 * pending `staff_users` row, and no Clerk organization still holding the slug.
 *
 * Clerk itself stays faked, because there is no test Clerk account to create
 * eighty throwaway organizations in. What is real is everything the fake cannot
 * paper over: the transaction, the policies, and the unique constraints that
 * actually decide whether a second attempt on the same slug is a conflict.
 */

/** A Clerk that records what exists, so "no organization left behind" is a
 *  question the test can actually ask. */
/**
 * Shared across every fake, and unique per run, because `clerk_portal_org_id`
 * is unique platform-wide and the scratch database is not dropped between runs.
 * A per-fake counter would hand the second test the first test's id; a
 * per-process one would hand this run the last run's, and either way the test
 * fails on a constraint that has nothing to do with what it is testing.
 */
const ORG_RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
let orgSeq = 0

function fakeClerk(overrides: Partial<ClerkOrgPort> = {}) {
  const live = new Set<string>()
  const invited: string[] = []

  const port: ClerkOrgPort = {
    async createOrganization() {
      const id = `org_portal_${ORG_RUN}_${++orgSeq}`
      live.add(id)
      return id
    },
    async deleteOrganization(id) {
      live.delete(id)
    },
    async inviteOrgAdmin({ email }) {
      invited.push(email)
    },
    ...overrides,
  }
  return { port, live, invited }
}

describe('tenant provisioning', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let provision!: typeof import('../services/tenants/provision')
  let tenantsService!: typeof import('../services/tenants/tenants')
  let schema!: {
    tenants: typeof import('../db/schema/tenancy')['tenants']
    tenantSettings: typeof import('../db/schema/tenancy')['tenantSettings']
    staffUsers: typeof import('../db/schema/identity')['staffUsers']
  }

  before(async () => {
    harness = await startTestApp()
    // After the harness, for the reason its own header gives: these modules
    // build a pool from the stubbed environment at import time.
    provision = await import('../services/tenants/provision')
    tenantsService = await import('../services/tenants/tenants')
    const tenancy = await import('../db/schema/tenancy')
    const identity = await import('../db/schema/identity')
    schema = {
      tenants: tenancy.tenants,
      tenantSettings: tenancy.tenantSettings,
      staffUsers: identity.staffUsers,
    }
  })

  after(async () => {
    await harness?.close()
  })

  /** Everything a Tenant is, counted. Zero across the board is what "no partial
   *  Tenant" has to mean. */
  async function traces(slug: string) {
    const rows = await harness.db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, slug))
    const tenant = rows[0]
    if (!tenant) return { tenant: null, settings: 0, staff: 0 }

    const settings = await harness.db
      .select()
      .from(schema.tenantSettings)
      .where(eq(schema.tenantSettings.tenantId, tenant.id))
    const staff = await harness.db
      .select()
      .from(schema.staffUsers)
      .where(eq(schema.staffUsers.tenantId, tenant.id))
    return { tenant, settings: settings.length, staff: staff.length }
  }

  test('a studio is created whole: row, settings, the portal org, and an invited admin', async () => {
    const clerk = fakeClerk();
    const slug = `prov-ok-${Date.now()}`

    const result = await provision.provisionTenant(
      { slug, name: 'Provision OK', adminEmail: 'Owner@Example.Test' },
      clerk.port,
    )

    const found = await traces(slug)
    assert.ok(found.tenant, 'the tenant row exists')
    assert.equal(found.settings, 1, 'settings row created alongside it')
    assert.equal(found.staff, 1, 'the first admin exists')

    // The portal application is wired. A null here is the half-created Tenant
    // that `orgClaimVerdict` would read as "enforcement not switched on yet".
    assert.ok(found.tenant.clerkPortalOrgId, 'portal organization recorded')
    // The client application is deliberately *not* wired, and must stay that
    // way: a non-null id here would demand an organization claim from every
    // member and lock the whole studio's members out. See the ADR.
    assert.equal(found.tenant.clerkClientOrgId, null, 'no client organization')
    assert.equal(clerk.live.size, 1)

    // The address is normalised on the way in, so the invitation and the row
    // agree about who was invited.
    assert.deepEqual(clerk.invited, ['owner@example.test'])
    assert.equal(result.admin?.email, 'owner@example.test')

    const [admin] = await harness.db
      .select()
      .from(schema.staffUsers)
      .where(eq(schema.staffUsers.tenantId, found.tenant.id))
    // `admin`, not `superadmin`: running a studio is not administering the
    // platform. Pending until they accept.
    assert.equal(admin!.role, 'admin')
    assert.equal(admin!.status, 'pending')
    assert.ok(admin!.invitedAt)
  })

  test('a studio can be created with no first admin, ready to import into', async () => {
    // The state `importTenant` requires: the studio exists and is wired to its
    // organization, and `staff_users` is empty, because the archive brings its
    // own and the import refuses to merge into rows already there.
    const clerk = fakeClerk()
    const slug = `prov-noadmin-${Date.now()}`

    const result = await provision.provisionTenant({ slug, name: 'Empty Studio' }, clerk.port)

    const found = await traces(slug)
    assert.ok(found.tenant, 'the tenant row exists')
    assert.equal(found.settings, 1, 'settings row created alongside it')
    assert.equal(found.staff, 0, 'no staff row — that is the point')
    assert.ok(found.tenant.clerkPortalOrgId, 'still wired to its portal organization')
    assert.equal(clerk.live.size, 1)
    assert.deepEqual(clerk.invited, [], 'nobody was emailed')
    assert.equal(result.admin, null)
  })

  test('a blank admin email is read as "none", not refused', async () => {
    const clerk = fakeClerk()
    const slug = `prov-blank-${Date.now()}`

    const result = await provision.provisionTenant(
      { slug, name: 'Blank Admin', adminEmail: '  ' },
      clerk.port,
    )

    assert.equal(result.admin, null)
    assert.equal((await traces(slug)).staff, 0)
    assert.deepEqual(clerk.invited, [])
  })

  test('a reserved slug is refused before Clerk is touched at all', async () => {
    const clerk = fakeClerk()

    await assert.rejects(
      provision.provisionTenant(
        { slug: 'admin', name: 'Impostor', adminEmail: 'a@example.test' },
        clerk.port,
      ),
      (err: any) => err?.code === 'slug_reserved' || /slug_reserved/.test(String(err?.message)),
    )

    // Not merely "no tenant row" — no organization was created and then tidied
    // up, because the gate runs before anything external.
    assert.equal(clerk.live.size, 0)
    assert.equal((await traces('admin')).tenant, null)
  })

  test('a taken slug leaves nothing behind, in the database or in Clerk', async () => {
    const slug = `prov-dup-${Date.now()}`
    const first = fakeClerk()
    await provision.provisionTenant(
      { slug, name: 'First', adminEmail: 'first@example.test' },
      first.port,
    )

    const second = fakeClerk()
    await assert.rejects(
      provision.provisionTenant(
        { slug, name: 'Second', adminEmail: 'second@example.test' },
        second.port,
      ),
      (err: any) => err?.code === 'slug_taken' || /slug_taken/.test(String(err?.message)),
    )

    // The second attempt's organization was rolled back; the first's remains.
    assert.equal(second.live.size, 0, 'no orphan organization holding the slug')
    assert.equal(second.invited.length, 0, 'nobody was emailed about a studio that does not exist')
    assert.equal(first.live.size, 1)

    // And the winner is untouched: one tenant, one settings row, one admin.
    const found = await traces(slug)
    assert.equal(found.tenant!.name, 'First')
    assert.equal(found.settings, 1)
    assert.equal(found.staff, 1)
  })

  test('a failure at the invitation — the last step — unwinds the whole thing', async () => {
    const slug = `prov-invite-${Date.now()}`
    const clerk = fakeClerk({
      async inviteOrgAdmin() {
        throw new Error('clerk refused the invitation')
      },
    })

    await assert.rejects(
      provision.provisionTenant(
        { slug, name: 'Invite Fails', adminEmail: 'nope@example.test' },
        clerk.port,
      ),
      /clerk refused the invitation/,
    )

    // The transaction had already inserted three rows by this point. All of them
    // are gone, and so is the organization.
    const found = await traces(slug)
    assert.equal(found.tenant, null, 'no tenant row survives')
    assert.equal(clerk.live.size, 0, 'no organization survives')
  })

  test('a malformed admin email is refused before anything is created', async () => {
    const clerk = fakeClerk()
    const slug = `prov-bademail-${Date.now()}`

    await assert.rejects(
      provision.provisionTenant({ slug, name: 'Bad Email', adminEmail: 'not-an-email' }, clerk.port),
      (err: any) =>
        err?.code === 'admin_email_invalid' || /admin_email_invalid/.test(String(err?.message)),
    )
    assert.equal(clerk.live.size, 0)
    assert.equal((await traces(slug)).tenant, null)
  })

  test('suspending retains every row, and reactivating is the same call back', async () => {
    const slug = `prov-suspend-${Date.now()}`
    const clerk = fakeClerk()
    const { tenant } = await provision.provisionTenant(
      { slug, name: 'Suspendable', adminEmail: 'owner@suspendable.test' },
      clerk.port,
    )

    const suspended = await tenantsService.setTenantStatus(tenant.id, 'suspended')
    assert.equal(suspended?.status, 'suspended')

    // The studio's data is untouched — suspension refuses requests, it does not
    // delete anything.
    const still = await traces(slug)
    assert.equal(still.settings, 1)
    assert.equal(still.staff, 1)

    // A suspended studio still resolves, so its hostname renders a paused page
    // rather than becoming indistinguishable from a slug that never existed.
    assert.ok(await tenantsService.resolveTenantBySlug(slug))

    const back = await tenantsService.setTenantStatus(tenant.id, 'active')
    assert.equal(back?.status, 'active')
  })

  test('it refuses to run inside another Tenant’s context', async () => {
    const { withTenant } = await import('../db')
    const clerk = fakeClerk()
    const slug = `prov-nested-${Date.now()}`

    // Inside `withTenant`, `db` *is* that transaction, so the inner
    // `db.transaction` would be a SAVEPOINT — and `set_config(…, true)` is
    // transaction-local, not savepoint-local. The new studio's id would outlive
    // this call and silently become the caller's tenant. Loud is the only
    // acceptable failure.
    await assert.rejects(
      withTenant(harness.tenants.one.id, () =>
        provision.provisionTenant(
          { slug, name: 'Nested', adminEmail: 'nested@example.test' },
          clerk.port,
        ),
      ),
      /must not run inside a Tenant context/,
    )

    assert.equal(clerk.live.size, 0)
    assert.equal((await traces(slug)).tenant, null)
  })

  test('a suspended studio is refused over HTTP, and stops being refused when it comes back', async () => {
    const slug = `prov-refuse-${Date.now()}`
    const clerk = fakeClerk()
    const { tenant } = await provision.provisionTenant(
      { slug, name: 'Refusable', adminEmail: 'owner@refusable.test' },
      clerk.port,
    )

    // Unauthenticated on purpose: the suspension gate runs ahead of the Clerk
    // middleware, which is what lets this be asserted at all — the harness
    // cannot mint a staff JWT. An active studio gets as far as that middleware
    // and is refused for the ordinary reason.
    const call = () =>
      harness.app.request(`/api/v1/portal/auth/me`, {
        headers: { 'X-Tenant-Slug': slug },
      })

    const before = await call()
    assert.equal(before.status, 401, 'an active studio is refused for want of a token')

    await tenantsService.setTenantStatus(tenant.id, 'suspended')
    const during = await call()
    assert.equal(during.status, 403)
    assert.deepEqual(await during.json(), { error: 'tenant_suspended', status: 'suspended' })

    // Reactivation is the same call back, and the studio is immediately live —
    // `setTenantStatus` drops the memo, so no one waits out a cache TTL.
    await tenantsService.setTenantStatus(tenant.id, 'active')
    const after = await call()
    assert.equal(after.status, 401)
  })

  test('the list shows every studio, Tenant #1 first, archived ones included', async () => {
    const slug = `prov-list-${Date.now()}`
    const clerk = fakeClerk()
    const { tenant } = await provision.provisionTenant(
      { slug, name: 'Listable', adminEmail: 'owner@listable.test' },
      clerk.port,
    )
    await tenantsService.setTenantStatus(tenant.id, 'archived')

    const rows = await tenantsService.listTenants()
    assert.equal(rows[0]!.id, harness.tenants.one.id, 'Tenant #1 heads the list')

    // Archived is visible *here* and nowhere else: this is the surface that
    // archived it, so it has to be the surface that can still see it.
    const archived = rows.find(row => row.slug === slug)
    assert.equal(archived?.status, 'archived')
    assert.equal(await tenantsService.resolveTenantBySlug(slug), null)
  })
})
