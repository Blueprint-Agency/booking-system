import assert from 'node:assert'
import { after, before, describe, test } from 'node:test'
import { and, eq } from 'drizzle-orm'
import {
  startTestApp,
  integrationTestsEnabled,
  inTenantContext,
  SKIP_REASON,
  type TestApp,
} from './harness'

/**
 * Every link the backend hands a human names the studio the request is for.
 *
 * The platform used to have one `PORTAL_ORIGIN` and one `CLIENT_ORIGIN`, so it
 * had one studio's two hostnames and mailed them to everybody: staff invited to
 * the second studio were sent into the first studio's portal, where their Clerk
 * organization does not match and the token is refused; members of the second
 * studio were sent to the first studio's account page, which they cannot sign
 * into. Both are silent — nothing fails until somebody clicks.
 *
 * So the assertions are all of the same shape, and the negative half is the
 * load-bearing one: the *other* studio's hostname must appear nowhere, and
 * neither must the bare platform origin the old code produced.
 */
describe('per-studio URLs', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let one!: { id: string; slug: string }
  let two!: { id: string; slug: string }
  let urls!: typeof import('../services/tenants/urls')
  let invites!: typeof import('../services/auth/invitations')
  let purchaseMail!: typeof import('../services/notifications/send-purchase-email')
  let schema!: typeof import('../db/schema')

  /** What the local `TENANT_ORIGIN_PATTERNS` serves each studio at. */
  const clientHost = (slug: string) => `http://${slug}.localhost:3000`
  const portalHost = (slug: string) => `http://${slug}.portal.localhost:3001`

  /**
   * Unique per run, and per the same reasoning as `tenant-provisioning.test.ts`:
   * `staff_users.email` is unique per tenant and the scratch database is not
   * dropped between runs, so a fixed address makes a second run fail on a
   * constraint that has nothing to do with what is being tested.
   */
  const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const INVITER_EMAIL = `urls-inviter-${RUN}@example.test`
  const INVITEE_EMAIL = `urls-invitee-${RUN}@example.test`
  const MEMBER_EMAIL = `urls-member-${RUN}@example.test`

  let inviterStaffId!: string
  let memberId!: string
  let clientPackageId!: string

  before(async () => {
    harness = await startTestApp()
    one = harness.tenants.one
    two = harness.tenants.two
    urls = await import('../services/tenants/urls')
    invites = inTenantContext(await import('../services/auth/invitations'))
    purchaseMail = inTenantContext(await import('../services/notifications/send-purchase-email'))
    schema = await import('../db/schema')

    // Fixtures in the SECOND studio, deliberately — tenant #1 is the one whose
    // hostnames the deleted env vars used to name, so a leak there would look
    // like a pass.
    const [inviter] = await harness.db
      .insert(schema.staffUsers)
      .values({
        tenantId: two.id,
        email: INVITER_EMAIL,
        name: 'Urls Inviter',
        role: 'superadmin',
        status: 'active',
      })
      .returning()
    inviterStaffId = inviter!.id

    const [member] = await harness.db
      .insert(schema.clients)
      .values({
        tenantId: two.id,
        clerkUserId: `user_urls_${Date.now()}`,
        email: MEMBER_EMAIL,
        name: 'Urls Member',
        phone: '+6580000000',
      })
      .returning()
    memberId = member!.id

    // No receipt URL on the row, which is the case that falls back to the
    // account page — the value that used to be a module constant built from the
    // platform's `CLIENT_URL`.
    const [pkg] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: two.id,
        clientId: memberId,
        kind: 'credit_bundle',
        creditsOrSessionsRemaining: 10,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        listPriceSgd: '150.00',
        amountPaidSgd: '150.00',
      })
      .returning()
    clientPackageId = pkg!.id
  })

  after(async () => {
    if (!harness) return
    // Only this run's rows: the scratch database is shared with every other
    // harness file and is not dropped between runs.
    for (const email of [INVITER_EMAIL, INVITEE_EMAIL, MEMBER_EMAIL]) {
      await harness.db.delete(schema.emailLog).where(eq(schema.emailLog.recipientEmail, email))
      await harness.db
        .delete(schema.staffInvitations)
        .where(eq(schema.staffInvitations.email, email))
    }
    if (clientPackageId) {
      await harness.db
        .delete(schema.clientPackages)
        .where(eq(schema.clientPackages.id, clientPackageId))
    }
    if (memberId) await harness.db.delete(schema.clients).where(eq(schema.clients.id, memberId))
    for (const email of [INVITER_EMAIL, INVITEE_EMAIL]) {
      await harness.db.delete(schema.staffUsers).where(eq(schema.staffUsers.email, email))
    }
    await harness.close()
  })

  /** The rendered body of the email this run sent to `recipient`. */
  async function bodyOf(slug: string, recipient: string): Promise<string> {
    const [row] = await harness.db
      .select({ body: schema.emailLog.bodyRendered })
      .from(schema.emailLog)
      .where(
        and(
          eq(schema.emailLog.templateSlug, slug),
          eq(schema.emailLog.recipientEmail, recipient),
        ),
      )
      .limit(1)
    assert.ok(row, `expected an ${slug} email_log row for ${recipient}`)
    return row.body
  }

  test('each studio resolves to its own two hostnames', async () => {
    assert.equal(await urls.tenantUrl('client', one.id), clientHost(one.slug))
    assert.equal(await urls.tenantUrl('portal', one.id), portalHost(one.slug))
    assert.equal(await urls.tenantUrl('client', two.id), clientHost(two.slug))
    assert.equal(await urls.tenantUrl('portal', two.id), portalHost(two.slug))
  })

  test('a studio with no row gets no URL, and no platform-wide one either', async () => {
    const nobody = '00000000-0000-4000-8000-000000000000'
    assert.equal(await urls.tenantUrl('client', nobody), null)
    // The refusal is the point: there is nothing honest to fall back to, and
    // what a fallback would produce is exactly the cross-tenant link being
    // removed.
    await assert.rejects(
      () => urls.requireTenantUrl('portal', nobody),
      /TENANT_ORIGIN_PATTERNS/,
      'the refusal should name the variable an operator has to set',
    )
  })

  test('the sign-up link is built on the portal it is handed, not on a global one', () => {
    const link = invites.buildSignUpUrl(portalHost(two.slug), 'a+b@example.test', 'tok en')
    assert.ok(link.startsWith(`${portalHost(two.slug)}/signup?`))
    assert.ok(link.includes('invite_email=a%2Bb%40example.test'), 'the email stays encoded')
    assert.ok(link.includes('invite_token=tok%20en'), 'the token stays encoded')
    assert.notEqual(link, invites.buildSignUpUrl(portalHost(one.slug), 'a+b@example.test', 'tok en'))
    // A trailing slash on the origin must not double up into `//signup`.
    assert.equal(
      invites.buildSignUpUrl(`${portalHost(two.slug)}/`, 'x@example.test'),
      `${portalHost(two.slug)}/signup?invite_email=x%40example.test`,
    )
  })

  test('a staff invitation mails a link into the inviting studio, not into studio #1', async () => {
    await invites.inviteAdmin({
      tenantId: two.id,
      email: INVITEE_EMAIL,
      role: 'admin',
      invitedByStaffId: inviterStaffId,
    })

    const body = await bodyOf('admin_invite', INVITEE_EMAIL)
    assert.ok(
      body.includes(`${portalHost(two.slug)}/signup?invite_email=`),
      "the sign-up link is on the inviting studio's own portal",
    )
    assert.ok(!body.includes(portalHost(one.slug)), "no link into another studio's portal")
    // What the deleted `PORTAL_ORIGIN` produced locally, and what production's
    // value produced everywhere: one studio's portal, mailed to all of them.
    assert.ok(!body.includes('http://localhost:3001'), 'no platform-wide portal origin')
  })

  test("a purchase confirmation points at the buyer's own studio's account page", async () => {
    await purchaseMail.sendPackagePurchaseEmail(two.id, clientPackageId)

    const body = await bodyOf('package_purchase_confirmed', MEMBER_EMAIL)
    assert.ok(
      body.includes(`${clientHost(two.slug)}/account`),
      "the account link is on the buying studio's own app",
    )
    assert.ok(!body.includes(clientHost(one.slug)), "no link into another studio's app")
    // `CLIENT_URL` defaulted to exactly this when `CLIENT_ORIGIN` was unset, and
    // named tenant #1's app when it was set. Neither is a page this member can
    // sign into.
    assert.ok(!body.includes('http://localhost:3000/'), 'no platform-wide client origin')
  })
})
