import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, inArray, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const OPERATOR = `operator-${run}@rename.test`

// Read once when the platform gate is first imported, so it is set before the app is.
process.env.PLATFORM_ADMIN_EMAIL = OPERATOR

/**
 * Slug Rename (#174): a studio changes its web address from the super portal,
 * and its old address redirects for 90 days without ever resolving as a Tenant.
 * The studio itself may be renamed straight back; no other studio may take the
 * old address inside the window.
 *
 * Through the platform and public routes, against a real Postgres with the
 * Row-Level Security policies live — the email-template rewrite happens inside
 * the renamed studio's context, and the policies are what would refuse it
 * anywhere else.
 */
describe('slug rename', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')
  let formerSlugs!: typeof import('../services/tenants/former-slugs')
  let send!: typeof import('../services/notifications/send')
  let withTenant!: typeof import('../db')['withTenant']
  let discardedMail!: typeof import('../lib/mailer')['discardedMail']
  let operator!: Record<string, string>

  const created: string[] = []

  /** A fresh studio with its email copy seeded, as a provisioned one has. */
  async function studio(label: string) {
    const slug = `ren-${label}-${run}`
    const { tenant } = await provision.provisionTenant({
      slug,
      name: `Rename ${label}`,
      adminEmail: `owner-${label}-${run}@rename.test`,
    })
    created.push(tenant.id)
    return tenant
  }

  const rename = (id: string, slug: string) =>
    harness.app.request(`/api/v1/platform/tenants/${id}/slug`, {
      method: 'POST',
      headers: { Authorization: operator.Authorization!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    })

  const lookup = (slug: string) => harness.app.request(`/api/v1/public/tenants/by-slug/${slug}`)

  const expectStatus = async (res: Response, status: number, error?: string) => {
    const body = await res.text()
    assert.equal(res.status, status, body)
    if (error) assert.equal((JSON.parse(body) as { error: string }).error, error)
    return JSON.parse(body) as any
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
    formerSlugs = await import('../services/tenants/former-slugs')
    send = await import('../services/notifications/send')
    ;({ withTenant } = await import('../db'))
    ;({ discardedMail } = await import('../lib/mailer'))
    operator = await harness.signInAs('platform', OPERATOR, null)
  })

  after(async () => {
    if (!harness) return
    // The studios themselves stay: `tenant_id` is ON DELETE RESTRICT across 53
    // tables, and every slug here is unique to this run.
    if (created.length) {
      await harness.db
        .delete(schema.formerSlugs)
        .where(inArray(schema.formerSlugs.renamedTenantId, created))
    }
    await harness.db.delete(schema.platformAuthUsers).where(eq(schema.platformAuthUsers.email, OPERATOR))
    await harness.close()
  })

  test('a rename moves the studio to its new slug and records who did it', async () => {
    const tenant = await studio('moves')
    const next = `ren-moved-${run}`

    const body = await expectStatus(await rename(tenant.id, next), 200)
    assert.equal(body.tenant.slug, next)
    assert.equal(body.tenant.urls.client, `http://${next}.localhost:3000`)
    assert.equal(body.tenant.urls.portal, `http://${next}.portal.localhost:3001`)

    // The new slug resolves as the studio.
    const resolved = await expectStatus(await lookup(next), 200)
    assert.equal(resolved.tenant.id, tenant.id)

    // Recorded: old and new slug, who, when, and how long the old one redirects.
    const [record] = await harness.db
      .select()
      .from(schema.formerSlugs)
      .where(eq(schema.formerSlugs.slug, tenant.slug))
    assert.ok(record, 'the former slug is recorded')
    assert.equal(record.renamedTenantId, tenant.id)
    assert.equal(record.newSlug, next)
    assert.equal(record.renamedBy, OPERATOR)
    const window = record.redirectUntil.getTime() - record.renamedAt.getTime()
    assert.equal(Math.round(window / 86_400_000), 90)

    // …and a lasting audit entry, which outlives the redirect row.
    const [audit] = await withTenant(tenant.id, () =>
      harness.db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.targetId, tenant.id)),
    )
    assert.equal(audit?.action, 'tenant.slug_renamed')
    assert.deepEqual(
      { ...(audit?.payload as Record<string, unknown>), redirectUntil: undefined },
      { from: tenant.slug, to: next, renamedBy: OPERATOR, redirectUntil: undefined },
    )
  })

  test('an archived studio cannot be renamed', async () => {
    const tenant = await studio('archived')
    await harness.db.update(schema.tenants).set({ status: 'archived' }).where(eq(schema.tenants.id, tenant.id))
    await expectStatus(await rename(tenant.id, `ren-archived-next-${run}`), 409, 'tenant_archived')
  })

  test('the old slug answers the public lookup with where the studio went, and the API refuses it', async () => {
    const tenant = await studio('old')
    const next = `ren-new-${run}`
    await expectStatus(await rename(tenant.id, next), 200)

    const moved = await expectStatus(await lookup(tenant.slug), 200)
    assert.deepEqual(moved, { moved_to: { slug: next } })

    // A former slug never opens a Tenant context — not from the header, and not
    // from a browser Origin on the old host.
    await expectStatus(
      await harness.app.request('/api/v1/public/locations', { headers: { 'X-Tenant-Slug': tenant.slug } }),
      404,
      'not_found',
    )
    await expectStatus(
      await harness.app.request('/api/v1/public/locations', {
        headers: { Origin: `http://${tenant.slug}.localhost:3000` },
      }),
      404,
      'not_found',
    )
    await expectStatus(
      await harness.app.request('/api/v1/public/locations', { headers: { 'X-Tenant-Slug': next } }),
      200,
    )
  })

  test('renaming to a malformed, reserved, taken or former slug is refused', async () => {
    const tenant = await studio('refused')
    const other = await studio('other')

    await expectStatus(await rename(tenant.id, 'Not A Slug!'), 400, 'slug_malformed')
    await expectStatus(await rename(tenant.id, 'admin'), 400, 'slug_reserved')
    await expectStatus(await rename(tenant.id, other.slug), 409, 'slug_taken')
    await expectStatus(await rename(tenant.id, tenant.slug), 400, 'slug_unchanged')

    // `other` moves on; its old slug is held while it redirects.
    await expectStatus(await rename(other.id, `ren-other-next-${run}`), 200)
    await expectStatus(await rename(tenant.id, other.slug), 409, 'slug_held')

    // …and so is creating a studio on it, and the create form's check says why.
    await assert.rejects(
      () => provision.provisionTenant({ slug: other.slug, name: 'Squatter' }),
      (err: { code?: string }) => err.code === 'slug_held',
    )
    const check = await expectStatus(
      await harness.app.request(`/api/v1/platform/tenants/slug-check/${other.slug}`, {
        headers: { Authorization: operator.Authorization! },
      }),
      200,
    )
    assert.equal(check.available, false)
    assert.equal(check.reason, 'slug_held')

    // Nothing moved for the studio that was refused.
    const [row] = await harness.db.select().from(schema.tenants).where(eq(schema.tenants.id, tenant.id))
    assert.equal(row?.slug, tenant.slug)
  })

  test('a studio can be renamed straight back to its old slug, and nobody else can take it', async () => {
    const tenant = await studio('back')
    const original = tenant.slug
    const detour = `ren-back-detour-${run}`
    const other = await studio('back-other')

    await expectStatus(await rename(tenant.id, detour), 200)

    // Held from everyone else — the form's check says so, and so does the rename…
    const check = (slug: string, forTenant?: string) =>
      harness.app.request(
        `/api/v1/platform/tenants/slug-check/${slug}${forTenant ? `?tenant=${forTenant}` : ''}`,
        { headers: { Authorization: operator.Authorization! } },
      )
    assert.equal((await expectStatus(await check(original), 200)).reason, 'slug_held')
    assert.equal((await expectStatus(await check(original, other.id), 200)).reason, 'slug_held')
    await expectStatus(await rename(other.id, original), 409, 'slug_held')

    // …but free to the studio it belongs to, with no wait.
    assert.equal((await expectStatus(await check(original, tenant.id), 200)).available, true)
    const body = await expectStatus(await rename(tenant.id, original), 200)
    assert.equal(body.tenant.slug, original)
    assert.equal(body.former.slug, detour)

    // The address it came back to is current again, not a former one; the
    // detour is now the one that redirects, and is held from others in turn.
    const formers = await harness.db
      .select()
      .from(schema.formerSlugs)
      .where(eq(schema.formerSlugs.renamedTenantId, tenant.id))
    assert.deepEqual(formers.map(f => f.slug), [detour])
    const resolved = await expectStatus(await lookup(original), 200)
    assert.equal(resolved.tenant.id, tenant.id)
    assert.deepEqual(await expectStatus(await lookup(detour), 200), { moved_to: { slug: original } })
    await expectStatus(await rename(other.id, detour), 409, 'slug_held')

    // And back and forth again, as often as the operator likes.
    await expectStatus(await rename(tenant.id, detour), 200)
    await expectStatus(await rename(tenant.id, original), 200)
  })

  test('the slug check hands the confirm step the new addresses', async () => {
    const slug = `ren-check-${run}`
    const check = await expectStatus(
      await harness.app.request(`/api/v1/platform/tenants/slug-check/${slug}`, {
        headers: { Authorization: operator.Authorization! },
      }),
      200,
    )
    assert.equal(check.available, true)
    assert.deepEqual(check.urls, {
      client: `http://${slug}.localhost:3000`,
      portal: `http://${slug}.portal.localhost:3001`,
    })
  })

  test('only a platform administrator can rename', async () => {
    const tenant = await studio('gated')
    const staff = await harness.signInAs('staff', `owner-gated-${run}@rename.test`, tenant)
    await expectStatus(
      await harness.app.request(`/api/v1/platform/tenants/${tenant.id}/slug`, {
        method: 'POST',
        headers: { Authorization: staff.Authorization!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: `ren-gated-next-${run}` }),
      }),
      404,
    )
  })

  test('stored email copy is rewritten, and mail sent afterwards links to the new address', async () => {
    const tenant = await studio('mail')
    const next = `ren-mail-next-${run}`
    const oldClient = `http://${tenant.slug}.localhost:3000`
    const oldPortal = `http://${tenant.slug}.portal.localhost:3001`

    const bodies = () =>
      withTenant(tenant.id, () =>
        harness.db
          .select({ body: schema.emailTemplates.bodyHtml })
          .from(schema.emailTemplates)
          .where(eq(schema.emailTemplates.tenantId, tenant.id)),
      )
    const before = await bodies()
    assert.ok(before.some(r => r.body.includes(oldClient)), 'seeded copy links to the member app')
    assert.ok(before.some(r => r.body.includes(oldPortal)), 'seeded copy links to the portal')

    await expectStatus(await rename(tenant.id, next), 200)

    const afterRename = await bodies()
    assert.ok(afterRename.every(r => !r.body.includes(oldClient) && !r.body.includes(oldPortal)))
    assert.ok(afterRename.some(r => r.body.includes(`http://${next}.localhost:3000`)))
    assert.ok(afterRename.some(r => r.body.includes(`http://${next}.portal.localhost:3001`)))

    const since = discardedMail.length
    const to = `member-mail-${run}@rename.test`
    await withTenant(tenant.id, () =>
      send.sendTemplatedEmail({
        tenantId: tenant.id,
        slug: 'welcome',
        recipient: { email: to, userKind: 'client' },
        variables: {},
      }),
    )
    const [mail] = discardedMail.slice(since).filter(m => m.to === to)
    assert.ok(mail, 'the mail was sent')
    assert.ok(mail.html.includes(`http://${next}.localhost:3000`), 'links to the new address')
    assert.ok(!mail.html.includes(oldClient), 'and never the old one')
  })

  test('after the window the old slug resolves nowhere and can be taken again', async () => {
    const tenant = await studio('window')
    await expectStatus(await rename(tenant.id, `ren-window-next-${run}`), 200)

    // Ninety days pass.
    await harness.db
      .update(schema.formerSlugs)
      .set({ redirectUntil: sql`now() - interval '1 second'` })
      .where(eq(schema.formerSlugs.slug, tenant.slug))

    await expectStatus(await lookup(tenant.slug), 404, 'not_found')

    // The nightly release deletes it…
    await formerSlugs.releaseExpiredFormerSlugs()
    const left = await harness.db
      .select()
      .from(schema.formerSlugs)
      .where(eq(schema.formerSlugs.slug, tenant.slug))
    assert.equal(left.length, 0)

    // …and another studio may have it.
    const { tenant: successor } = await provision.provisionTenant({ slug: tenant.slug, name: 'Successor' })
    created.push(successor.id)
    const resolved = await expectStatus(await lookup(tenant.slug), 200)
    assert.equal(resolved.tenant.id, successor.id)
  })

  test('an expired former slug does not block its reuse even before the nightly release', async () => {
    const tenant = await studio('early')
    const other = await studio('early-other')
    await expectStatus(await rename(tenant.id, `ren-early-next-${run}`), 200)
    await harness.db
      .update(schema.formerSlugs)
      .set({ redirectUntil: sql`now() - interval '1 second'` })
      .where(eq(schema.formerSlugs.slug, tenant.slug))

    await expectStatus(await rename(other.id, tenant.slug), 200)
    // …and renaming away from it again records it afresh rather than colliding.
    await expectStatus(await rename(other.id, `ren-early-final-${run}`), 200)
    const [record] = await harness.db
      .select()
      .from(schema.formerSlugs)
      .where(eq(schema.formerSlugs.slug, tenant.slug))
    assert.equal(record?.renamedTenantId, other.id)
  })
})
