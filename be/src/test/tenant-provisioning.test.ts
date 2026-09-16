import assert from 'node:assert'
import { randomBytes } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { startTestApp, integrationTestsEnabled, SKIP_REASON, type TestApp } from './harness'

/**
 * "Creation is atomic; a failure at any step leaves no partial Tenant."
 *
 * A real Postgres, with the real Row-Level Security policies live. Creating a
 * studio calls nothing outside the platform: the rows are ours, the first
 * admin's account is a row in our own `staff` pool, and their invitation is our
 * own token, mailed through the null transport the harness runs under — which
 * keeps what it "sent", so the invitation is a thing the test can read.
 */
describe('tenant provisioning', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let provision!: typeof import('../services/tenants/provision')
  let tenantsService!: typeof import('../services/tenants/tenants')
  let invitations!: typeof import('../services/auth/invitations')
  let withTenant!: typeof import('../db')['withTenant']
  let discardedMail!: typeof import('../lib/mailer')['discardedMail']
  let schema!: typeof import('../db/schema')
  let declaredTemplateSlugs!: string[]

  before(async () => {
    harness = await startTestApp()
    // After the harness, for the reason its own header gives: these modules
    // build a pool from the stubbed environment at import time.
    provision = await import('../services/tenants/provision')
    tenantsService = await import('../services/tenants/tenants')
    invitations = await import('../services/auth/invitations')
    ;({ withTenant } = await import('../db'))
    ;({ discardedMail } = await import('../lib/mailer'))
    schema = await import('../db/schema')
    const { TEMPLATE_VARIABLES } = await import('../services/notifications/variables')
    declaredTemplateSlugs = Object.keys(TEMPLATE_VARIABLES)
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
    if (!tenant) return { tenant: null, settings: 0, staff: 0, invitations: 0 }

    const settings = await harness.db
      .select()
      .from(schema.tenantSettings)
      .where(eq(schema.tenantSettings.tenantId, tenant.id))
    const staff = await harness.db
      .select()
      .from(schema.staffUsers)
      .where(eq(schema.staffUsers.tenantId, tenant.id))
    const invited = await harness.db
      .select()
      .from(schema.staffInvitations)
      .where(eq(schema.staffInvitations.tenantId, tenant.id))
    return { tenant, settings: settings.length, staff: staff.length, invitations: invited.length }
  }

  /** Invitations mailed to an address since the test began. */
  const mailedTo = (email: string, since: number) =>
    discardedMail.slice(since).filter(m => m.to === email)

  test('a studio is created whole: row, settings, and an invited admin with an account', async () => {
    const slug = `prov-ok-${Date.now()}`
    const sent = discardedMail.length

    const result = await provision.provisionTenant({
      slug,
      name: 'Provision OK',
      adminEmail: 'Owner@Example.Test',
    })

    const found = await traces(slug)
    assert.ok(found.tenant, 'the tenant row exists')
    assert.equal(found.settings, 1, 'settings row created alongside it')
    assert.equal(found.staff, 1, 'the first admin exists')
    assert.equal(found.tenant.status, 'active')

    // The address is normalised on the way in, so the invitation and the row
    // agree about who was invited.
    assert.equal(result.admin?.email, 'owner@example.test')

    const [admin] = await harness.db
      .select()
      .from(schema.staffUsers)
      .where(eq(schema.staffUsers.tenantId, found.tenant.id))
    // A studio `admin`: running a studio is not administering the platform.
    // Pending until they accept.
    assert.equal(admin!.role, 'admin')
    assert.equal(admin!.status, 'pending')
    assert.ok(admin!.invitedAt)

    // Linked to an account in the staff pool from the start, as every staff row
    // is: there is nothing left to match them to later.
    const [account] = await harness.db
      .select()
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.id, admin!.authUserId))
    assert.equal(account?.email, 'owner@example.test')

    // An invitation nobody on the studio's staff made — there is nobody yet.
    const [invitation] = await harness.db
      .select()
      .from(schema.staffInvitations)
      .where(eq(schema.staffInvitations.tenantId, found.tenant.id))
    assert.equal(invitation?.staffUserId, admin!.id)
    assert.equal(invitation?.invitedByStaffId, null)
    assert.equal(invitation?.status, 'pending')

    // And it was mailed, pointing at this studio's own portal.
    const mail = mailedTo('owner@example.test', sent)
    assert.equal(mail.length, 1, 'one invitation mailed')
    assert.ok(
      mail[0]!.html.includes(`http://${slug}.portal.localhost:3001/signup?`),
      'the set-password link is on the new studio’s portal',
    )
  })

  test('the first admin accepts the invitation and reaches their portal', async () => {
    const slug = `prov-accept-${Date.now()}`
    const email = `owner-${Date.now()}@accept.test`
    const { tenant } = await provision.provisionTenant({ slug, name: 'Accepting Studio', adminEmail: email })

    const [invitation] = await harness.db
      .select()
      .from(schema.staffInvitations)
      .where(eq(schema.staffInvitations.tenantId, tenant.id))
    await withTenant(tenant.id, () =>
      invitations.acceptInvitation({ tenantId: tenant.id, token: invitation!.token, password: 'a-first-password' }),
    )

    const headers = await harness.signInAs('staff', email, { slug })
    const me = await harness.app.request('/api/v1/portal/auth/me', { headers })
    assert.equal(me.status, 200, await me.clone().text())
  })

  test('a new studio can send email at all: it is created with its own copy', async () => {
    // The bug this covers: nothing seeded a provisioned studio's templates, and
    // `sendTemplatedEmail` throws on a missing (tenant, slug) row rather than
    // reach for another studio's wording — so every staff invitation, booking
    // confirmation and refund notice the studio ever sent failed.
    const slug = `prov-copy-${Date.now()}`

    const created = await provision.provisionTenant({
      slug,
      name: 'Copy Studio',
      adminEmail: 'owner@copy.test',
    })

    const rows = await templatesOf(created.tenant.id)
    assert.deepEqual(
      rows.map(r => r.slug).sort(),
      [...declaredTemplateSlugs].sort(),
      'every slug a sender knows has a row in the new studio',
    )
  })

  /** Every template row a studio holds, by slug. */
  async function templatesOf(tenantId: string) {
    return await harness.db
      .select()
      .from(schema.emailTemplates)
      .where(eq(schema.emailTemplates.tenantId, tenantId))
  }

  test('a new studio’s emails link to its own hostnames, never the platform’s', async () => {
    // The coupled defect: the copy used to bake in `CLIENT_URL` and
    // `PORTAL_ORIGIN`, two single global values naming one studio's apps. The
    // second studio's instructor got an "Open the schedule" button pointing at
    // the first studio's portal.
    const slug = `prov-links-${Date.now()}`

    const created = await provision.provisionTenant({
      slug,
      name: 'Links Studio',
      adminEmail: 'owner@links.test',
    })

    const html = (await templatesOf(created.tenant.id)).map(r => r.bodyHtml).join('\n')
    // The harness configures the same wildcards the local frontends use, so the
    // origins here are the ones `tenantOrigin` derives from this studio's slug.
    assert.ok(html.includes(`http://${slug}.localhost:3000`), 'its own member app')
    assert.ok(html.includes(`http://${slug}.portal.localhost:3001`), 'its own portal')
    assert.ok(!html.includes('http://localhost:3000'), 'not the platform CLIENT_ORIGIN')
    assert.ok(!html.includes('http://localhost:3001'), 'not the platform PORTAL_ORIGIN')
  })

  test('a studio can be created with no first admin, ready to import into', async () => {
    // The state `importTenant` requires: the studio exists and `staff_users` is
    // empty, because the archive brings its own and the import refuses to merge
    // into rows already there.
    const slug = `prov-noadmin-${Date.now()}`
    const sent = discardedMail.length

    const result = await provision.provisionTenant({ slug, name: 'Empty Studio' })

    const found = await traces(slug)
    assert.ok(found.tenant, 'the tenant row exists')
    assert.equal(found.settings, 1, 'settings row created alongside it')
    assert.equal(found.staff, 0, 'no staff row — that is the point')
    assert.equal(found.invitations, 0)
    assert.equal(discardedMail.length, sent, 'nobody was emailed')
    assert.equal(result.admin, null)

    // And it is closed. A studio nobody can sign in to must not answer on its
    // hostnames as though it were open for business.
    assert.equal(found.tenant.status, 'suspended')

    // No email copy either, and for the same reason as the empty
    // `staff_users`: the archive brings the studio's own templates, and
    // `importTenant` refuses a target that already holds rows in any table.
    // Seeding here would leave the studio un-importable and holding two
    // sources of truth for its wording.
    assert.equal((await templatesOf(found.tenant.id)).length, 0)
  })

  test('inviting the first admin is what opens the studio', async () => {
    const slug = `prov-firstadmin-${Date.now()}`
    const created = await provision.provisionTenant({ slug, name: 'Waiting Studio' })
    assert.equal(created.tenant.status, 'suspended')
    const sent = discardedMail.length

    const admin = await provision.inviteFirstAdmin(created.tenant.id, { email: 'Owner@Waiting.Test' })

    assert.equal(admin.email, 'owner@waiting.test', 'normalised on the way in')
    const found = await traces(slug)
    assert.equal(found.staff, 1)
    assert.equal(found.invitations, 1)
    assert.equal(mailedTo('owner@waiting.test', sent).length, 1, 'the invitation was mailed')

    // Giving it an admin is the moment "an archive is coming" stops being true,
    // so this is where the copy provisioning held back gets written — otherwise
    // the studio opens with a way in and no way to send a single email.
    assert.deepEqual(
      (await templatesOf(created.tenant.id)).map(r => r.slug).sort(),
      [...declaredTemplateSlugs].sort(),
    )

    // The reason the studio was closed is gone, so the studio is open.
    const [row] = await harness.db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, slug))
    assert.equal(row!.status, 'active')
  })

  test('a first admin does not overwrite copy the studio already has', async () => {
    // The archive case, from the side that can still surprise: a restored
    // studio whose staff were all archived looks staff-less to the bootstrap,
    // but its templates are its own edited wording. Shipping copy over it would
    // replace what a studio wrote with what the platform ships.
    const slug = `prov-keepcopy-${Date.now()}`
    const created = await provision.provisionTenant({ slug, name: 'Restored Studio' })

    await harness.db.insert(schema.emailTemplates).values({
      tenantId: created.tenant.id,
      slug: 'welcome',
      subject: 'the studio’s own words',
      bodyHtml: '<p>theirs</p>',
    })

    await provision.inviteFirstAdmin(created.tenant.id, { email: 'owner@restored.test' })

    const rows = await templatesOf(created.tenant.id)
    assert.equal(rows.length, 1, 'nothing was seeded alongside what was already there')
    assert.equal(rows[0]!.subject, 'the studio’s own words')
  })

  test('a studio that already has staff refuses a first admin', async () => {
    // The bootstrap must not keep working after the boot: adding staff to a
    // working studio is that studio's own job, with its roles and grants.
    const slug = `prov-secondadmin-${Date.now()}`
    const created = await provision.provisionTenant({
      slug,
      name: 'Staffed Studio',
      adminEmail: 'first@staffed.test',
    })
    const sent = discardedMail.length

    await assert.rejects(
      () => provision.inviteFirstAdmin(created.tenant.id, { email: 'second@staffed.test' }),
      (err: { code?: string; message?: string }) =>
        err?.code === 'tenant_already_has_staff' ||
        /tenant_already_has_staff/.test(String(err?.message)),
    )

    assert.equal(mailedTo('second@staffed.test', sent).length, 0, 'the second was never emailed')
    const found = await traces(slug)
    assert.equal(found.staff, 1)
    assert.equal(found.invitations, 1)
  })

  test('a studio suspended for its own reasons is not reopened by an invitation', async () => {
    // `activateAfterFirstStaff` only ever lifts a suspension a studio was opened
    // under. Here the studio was suspended deliberately, with staff already in
    // it, so the invitation is refused and nothing moves.
    const slug = `prov-stayshut-${Date.now()}`
    const created = await provision.provisionTenant({
      slug,
      name: 'Deliberately Shut',
      adminEmail: 'owner@shut.test',
    })
    await tenantsService.setTenantStatus(created.tenant.id, 'suspended')

    await assert.rejects(() => provision.inviteFirstAdmin(created.tenant.id, { email: 'other@shut.test' }))

    const [row] = await harness.db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, slug))
    assert.equal(row!.status, 'suspended')
  })

  test('the list says which studios nobody can get into', async () => {
    const empty = await provision.provisionTenant({ slug: `prov-count-empty-${Date.now()}`, name: 'Empty' })
    const staffed = await provision.provisionTenant({
      slug: `prov-count-staffed-${Date.now()}`,
      name: 'Staffed',
      adminEmail: 'a@counted.test',
    })

    const rows = await tenantsService.listTenants()
    const byId = new Map(rows.map(r => [r.id, r]))
    assert.equal(byId.get(empty.tenant.id)?.staffCount, 0)
    assert.equal(byId.get(staffed.tenant.id)?.staffCount, 1)
  })

  test('a blank admin email is read as "none", not refused', async () => {
    const slug = `prov-blank-${Date.now()}`

    const result = await provision.provisionTenant({ slug, name: 'Blank Admin', adminEmail: '  ' })

    assert.equal(result.admin, null)
    const found = await traces(slug)
    assert.equal(found.staff, 0)
    assert.equal(found.invitations, 0)
  })

  test('a reserved slug is refused before anything is written', async () => {
    await assert.rejects(
      provision.provisionTenant({ slug: 'admin', name: 'Impostor', adminEmail: 'impostor@example.test' }),
      (err: any) => err?.code === 'slug_reserved' || /slug_reserved/.test(String(err?.message)),
    )

    assert.equal((await traces('admin')).tenant, null)
    const [account] = await harness.db
      .select()
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, 'impostor@example.test'))
    assert.equal(account, undefined, 'no account made for a studio that was never created')
  })

  test('a taken slug leaves nothing behind', async () => {
    const slug = `prov-dup-${Date.now()}`
    const second = `second-${Date.now()}@example.test`
    await provision.provisionTenant({ slug, name: 'First', adminEmail: 'first@example.test' })
    const sent = discardedMail.length

    await assert.rejects(
      provision.provisionTenant({ slug, name: 'Second', adminEmail: second }),
      (err: any) => err?.code === 'slug_taken' || /slug_taken/.test(String(err?.message)),
    )

    assert.equal(mailedTo(second, sent).length, 0, 'nobody was emailed about a studio that does not exist')
    const [account] = await harness.db
      .select()
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, second))
    assert.equal(account, undefined, 'the second admin’s account went with the rollback')

    // And the winner is untouched: one tenant, one settings row, one admin.
    const found = await traces(slug)
    assert.equal(found.tenant!.name, 'First')
    assert.equal(found.settings, 1)
    assert.equal(found.staff, 1)
    assert.equal(found.invitations, 1)
  })

  test('a failure inside the transaction unwinds the whole thing', async () => {
    // An address the shallow format check lets through and Postgres cannot
    // index: the admin's account insert refuses it, after the tenant, its
    // settings and its copy have all been written in the same transaction.
    const slug = `prov-unwind-${Date.now()}`
    const sent = discardedMail.length
    const email = `${randomBytes(10_000).toString('hex')}@unwind.test`

    await assert.rejects(provision.provisionTenant({ slug, name: 'Unwinds', adminEmail: email }))

    assert.equal((await traces(slug)).tenant, null, 'no tenant row survives')
    assert.equal(discardedMail.length, sent, 'nobody was emailed')
  })

  test('a malformed admin email is refused before anything is created', async () => {
    const slug = `prov-bademail-${Date.now()}`

    await assert.rejects(
      provision.provisionTenant({ slug, name: 'Bad Email', adminEmail: 'not-an-email' }),
      (err: any) =>
        err?.code === 'admin_email_invalid' || /admin_email_invalid/.test(String(err?.message)),
    )
    assert.equal((await traces(slug)).tenant, null)
  })

  test('suspending retains every row, and reactivating is the same call back', async () => {
    const slug = `prov-suspend-${Date.now()}`
    const { tenant } = await provision.provisionTenant({
      slug,
      name: 'Suspendable',
      adminEmail: 'owner@suspendable.test',
    })

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
    const slug = `prov-nested-${Date.now()}`

    // Inside `withTenant`, `db` *is* that transaction, so the inner
    // `db.transaction` would be a SAVEPOINT — and `set_config(…, true)` is
    // transaction-local, not savepoint-local. The new studio's id would outlive
    // this call and silently become the caller's tenant. Loud is the only
    // acceptable failure.
    await assert.rejects(
      withTenant(harness.tenants.one.id, () =>
        provision.provisionTenant({ slug, name: 'Nested', adminEmail: 'nested@example.test' }),
      ),
      /must not run inside a Tenant context/,
    )

    assert.equal((await traces(slug)).tenant, null)
  })

  test('a suspended studio is refused over HTTP, and stops being refused when it comes back', async () => {
    const slug = `prov-refuse-${Date.now()}`
    const { tenant } = await provision.provisionTenant({
      slug,
      name: 'Refusable',
      adminEmail: 'owner@refusable.test',
    })

    // Unauthenticated on purpose: the suspension gate runs ahead of the staff
    // auth middleware, so an active studio gets as far as that middleware and is
    // refused for the ordinary reason.
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
    const { tenant } = await provision.provisionTenant({
      slug,
      name: 'Listable',
      adminEmail: 'owner@listable.test',
    })
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
