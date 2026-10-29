import assert from 'node:assert/strict'
import { after, afterEach, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { connectPayments, usePaymentKey } from './attention-payments'

/**
 * Staff attention, email: `members_without_email` and
 * `email_bouncing`, read over HTTP. Outcomes reach the log the way they do in
 * production, through Resend's webhook handler. Every test makes a studio of
 * its own, so a count says only what it filed.
 */
describe('Staff attention: email', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  usePaymentKey()
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')
  let handleResendEvent!: typeof import('../services/notifications/delivery-outcomes').handleResendEvent

  const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
  // Sunday 1 Nov 2026, noon in Singapore.
  const START = new Date('2026-11-01T04:00:00Z')
  const DAY = 24 * 60 * 60 * 1000

  type Studio = { id: string; slug: string }
  type Staff = { headers: Record<string, string>; id: string; email: string }

  let studios = 0
  let messages = 0
  let restoreReporter: (() => void) | undefined

  const send = (path: string, headers: Record<string, string>) =>
    harness.app.request(`/api/v1${path}`, { headers })

  const json = async (res: Response, status: number) => {
    const text = await res.text()
    assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${text}`)
    return (text ? JSON.parse(text) : {}) as Record<string, any>
  }

  const freshStudio = async (): Promise<Studio> => {
    const slug = `attem-${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({ slug, name: 'Attention Email Studio', adminEmail: `owner@${slug}.test` })
    await connectPayments(tenant.id)
    await harness.db
      .update(schema.staffInvitations)
      .set({ status: 'accepted', acceptedAt: new Date() })
      .where(eq(schema.staffInvitations.tenantId, tenant.id))
    return { id: tenant.id, slug }
  }

  const staffAt = async (studio: Studio, name: string, role: 'admin' | 'instructor' = 'admin'): Promise<Staff> => {
    const email = `${name}@${studio.slug}.test`
    const headers = await harness.signInAs('staff', email, studio)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: studio.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning()
    if (role === 'instructor') await harness.db.insert(schema.instructors).values({ tenantId: studio.id, staffUserId: row!.id })
    return { headers, id: row!.id, email }
  }

  const memberAt = async (studio: Studio, name: string, email = `${name.toLowerCase()}@${studio.slug}.test`) => {
    const { ensureAuthUser } = await import('../services/auth/auth-users')
    const authUserId = await ensureAuthUser(harness.db as any, 'client', { tenantId: studio.id, email, name })
    const [row] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: studio.id, email, name, phone: '+6580000000', authUserId })
      .returning({ id: schema.clients.id })
    return { id: row!.id, email }
  }

  /**
   * Mail to `to`, then what Resend later said of it at `outcomeAt`: an
   * `email_log` row as the send path files it, moved by the webhook handler.
   */
  const mail = async (
    studio: Studio,
    to: { id: string | null; email: string; kind: 'client' | 'staff' },
    event: 'email.delivered' | 'email.bounced' | 'email.complained' | 'email.suppressed',
    outcomeAt: Date,
  ) => {
    const messageId = `msg-${run}-${++messages}`
    await harness.db.insert(schema.emailLog).values({
      tenantId: studio.id,
      templateSlug: 'booking_confirmation',
      recipientEmail: to.email,
      recipientUserId: to.id,
      recipientUserKind: to.kind,
      subjectRendered: 'Hello',
      bodyRendered: '<p>Hello</p>',
      status: 'sent',
      smtpMessageId: messageId,
      queuedAt: new Date(outcomeAt.getTime() - 60_000),
      sentAt: new Date(outcomeAt.getTime() - 30_000),
    })
    await handleResendEvent({
      type: event,
      created_at: outcomeAt.toISOString(),
      data: { email_id: messageId, tags: { tenant: studio.id, template: 'booking_confirmation' } },
    })
  }

  const panel = async (who: Staff) => json(await send('/portal/attention', who.headers), 200)
  const summary = async (who: Staff) => json(await send('/portal/attention/summary', who.headers), 200)
  const KINDS = ['members_without_email', 'email_bouncing']
  const items = async (who: Staff, kind?: string) =>
    ((await panel(who)).needs_action.groups as Array<{ items: Array<Record<string, any>> }>)
      .flatMap(g => g.items)
      .filter(i => (kind ? i.kind === kind : KINDS.includes(i.kind)))

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
    const outcomes = await import('../services/notifications/delivery-outcomes')
    handleResendEvent = outcomes.handleResendEvent
    // The bounces below are on purpose: keep them out of the error log.
    restoreReporter = outcomes.useOutcomeReporter({ alert: () => {} })
  })

  afterEach(() => harness.clock.reset())

  after(async () => {
    restoreReporter?.()
    await harness?.close()
  })

  test('ATN-120 members on a placeholder address are one members_without_email item, one row in the bubble; real-address and blocked members are not counted; it clears when none is left', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'anna')
    await memberAt(studio, 'Real')
    const a = await memberAt(studio, 'Aya', `aya-${run}@imported.INVALID`)
    const bo = await memberAt(studio, 'Bo',`bo-${run}@imported.invalid`)
    const blocked = await memberAt(studio, 'Cy', `cy-${run}@imported.invalid`)
    await harness.db.update(schema.clients).set({ deletedAt: new Date() }).where(eq(schema.clients.id, blocked.id))

    const found = await items(admin, 'members_without_email')
    assert.equal(found.length, 1)
    assert.equal(found[0]!.title, '2 members have no email address')
    assert.equal(found[0]!.detail, "They can't sign in or get receipts")
    assert.equal(found[0]!.href, '/admin/customers?filter=no_email')
    assert.equal(found[0]!.dismissable, false)
    assert.equal((await summary(admin)).needs_action, 1, 'two members are one row in the bubble')

    await harness.db.update(schema.clients).set({ email: `aya@${studio.slug}.test` }).where(eq(schema.clients.id, a.id))
    assert.equal((await items(admin, 'members_without_email'))[0]!.title, '1 member has no email address')
    await harness.db.update(schema.clients).set({ email: `bo@${studio.slug}.test` }).where(eq(schema.clients.id, bo.id))
    assert.deepEqual(await items(admin), [])
    assert.equal((await summary(admin)).needs_action, 0)
  })

  test('ATN-121 Customers filters to members on a placeholder address with ?filter=no_email, leaving out members with a real address and blocked ones', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'anna')
    await memberAt(studio, 'Real')
    const nomail = await memberAt(studio, 'Nomail', `nomail-${run}@imported.invalid`)

    const body = await json(await send('/portal/admin/clients?filter=no_email', admin.headers), 200)
    assert.deepEqual(body.clients.map((c: any) => c.id), [nomail.id])
    assert.equal(body.total, 1)
  })

  test('ATN-122 email_bouncing is decided by the recipient\'s latest outcome: a later delivery clears it, a later bounce after a delivery raises it', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'anna')
    const ada = await memberAt(studio, 'Ada')
    const bea = await memberAt(studio, 'Bea')
    harness.clock.set(new Date(START.getTime() + 10 * DAY))
    const to = (m: { id: string; email: string }) => ({ ...m, kind: 'client' as const })

    await mail(studio, to(ada), 'email.bounced', new Date(START.getTime() + 2 * DAY))
    await mail(studio, to(bea), 'email.delivered', new Date(START.getTime() + 2 * DAY))
    await mail(studio, to(bea), 'email.bounced', new Date(START.getTime() + 3 * DAY))
    assert.deepEqual((await items(admin, 'email_bouncing')).map(i => i.id).sort(), [
      `email_bouncing:${ada.id}`,
      `email_bouncing:${bea.id}`,
    ].sort())
    assert.equal((await summary(admin)).needs_action, 2, 'one row per person, however many emails')

    await mail(studio, to(ada), 'email.delivered', new Date(START.getTime() + 4 * DAY))
    assert.deepEqual((await items(admin, 'email_bouncing')).map(i => i.id), [`email_bouncing:${bea.id}`])

    // An earlier bounce arriving after a later delivery does not outrank it.
    await mail(studio, to(ada), 'email.bounced', new Date(START.getTime() + 1 * DAY))
    assert.deepEqual((await items(admin, 'email_bouncing')).map(i => i.id), [`email_bouncing:${bea.id}`])
  })

  test('ATN-123 email_bouncing goes when the person\'s address changes', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'anna')
    const teacher = await staffAt(studio, 'teacher', 'instructor')
    const ada = await memberAt(studio, 'Ada')
    harness.clock.set(new Date(START.getTime() + 2 * DAY))
    await mail(studio, { id: ada.id, email: ada.email, kind: 'client' }, 'email.bounced', START)
    await mail(studio, { id: teacher.id, email: teacher.email, kind: 'staff' }, 'email.suppressed', START)
    assert.equal((await items(admin, 'email_bouncing')).length, 2)

    await harness.db.update(schema.clients).set({ email: `ada-new@${studio.slug}.test` }).where(eq(schema.clients.id, ada.id))
    assert.deepEqual((await items(admin, 'email_bouncing')).map(i => i.id), [`email_bouncing:${teacher.id}`])
    await harness.db.update(schema.staffUsers).set({ email: `teacher-new@${studio.slug}.test` }).where(eq(schema.staffUsers.id, teacher.id))
    assert.deepEqual(await items(admin, 'email_bouncing'), [])
  })

  test('ATN-124 email_bouncing ignores outcomes older than 30 days', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'anna')
    const old = await memberAt(studio, 'Old')
    const recent = await memberAt(studio, 'Recent')
    harness.clock.set(new Date(START.getTime() + 40 * DAY))
    await mail(studio, { ...old, kind: 'client' }, 'email.bounced', new Date(START.getTime() + 9 * DAY))
    await mail(studio, { ...recent, kind: 'client' }, 'email.bounced', new Date(START.getTime() + 11 * DAY))
    assert.deepEqual((await items(admin, 'email_bouncing')).map(i => i.id), [`email_bouncing:${recent.id}`])
    harness.clock.set(new Date(START.getTime() + 42 * DAY))
    assert.deepEqual(await items(admin, 'email_bouncing'), [])
  })

  test('ATN-125 the email_bouncing wording says bounced, marked our email as spam, or is blocked', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'anna')
    const a = await memberAt(studio, 'Ada')
    const b = await memberAt(studio, 'Bea')
    const c = await memberAt(studio, 'Cat')
    harness.clock.set(new Date(START.getTime() + DAY))
    await mail(studio, { ...a, kind: 'client' }, 'email.bounced', START)
    await mail(studio, { ...b, kind: 'client' }, 'email.complained', START)
    await mail(studio, { ...c, kind: 'client' }, 'email.suppressed', START)
    const byId = new Map((await items(admin, 'email_bouncing')).map(i => [i.id, i]))
    assert.equal(byId.get(`email_bouncing:${a.id}`)!.title, "Emails to Ada aren't being delivered")
    assert.equal(byId.get(`email_bouncing:${a.id}`)!.detail, `${a.email} bounced on Sun 1 Nov. Check the address with them`)
    assert.equal(byId.get(`email_bouncing:${b.id}`)!.detail, `${b.email} marked our email as spam on Sun 1 Nov. Check the address with them`)
    assert.equal(byId.get(`email_bouncing:${c.id}`)!.detail, `${c.email} is blocked on Sun 1 Nov. Check the address with them`)
    assert.equal(byId.get(`email_bouncing:${a.id}`)!.dismissable, false)
  })

  test('ATN-126 a member item links to the customer page and a staff item to ?staff= on Staff', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'anna')
    const teacher = await staffAt(studio, 'teacher', 'instructor')
    const ada = await memberAt(studio, 'Ada')
    harness.clock.set(new Date(START.getTime() + DAY))
    await mail(studio, { ...ada, kind: 'client' }, 'email.bounced', START)
    await mail(studio, { id: teacher.id, email: teacher.email, kind: 'staff' }, 'email.bounced', START)
    const found = await items(admin, 'email_bouncing')
    assert.equal(found.find(i => i.id === `email_bouncing:${ada.id}`)!.href, `/admin/customers/${ada.id}`)
    assert.equal(found.find(i => i.id === `email_bouncing:${teacher.id}`)!.href, `/admin/staff?staff=${teacher.id}`)
  })

  test('ATN-127 mail logged without a recipient id produces no item', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'anna')
    harness.clock.set(new Date(START.getTime() + DAY))
    await mail(studio, { id: null, email: `prospect@${studio.slug}.test`, kind: 'client' }, 'email.bounced', START)
    assert.deepEqual(await items(admin), [])
    assert.equal((await summary(admin)).needs_action, 0)
  })

  test('ATN-128 both items are for admins only, and never cross studios', async () => {
    const studio = await freshStudio()
    const other = await freshStudio()
    const admin = await staffAt(studio, 'anna')
    const otherAdmin = await staffAt(other, 'olga')
    const teacher = await staffAt(studio, 'teacher', 'instructor')
    const ada = await memberAt(studio, 'Ada')
    await memberAt(studio, 'Nomail', `n-${run}@imported.invalid`)
    harness.clock.set(new Date(START.getTime() + DAY))
    await mail(studio, { ...ada, kind: 'client' }, 'email.bounced', START)

    assert.equal((await items(admin)).length, 2)
    assert.deepEqual(await items(teacher), [])
    assert.deepEqual(await items(otherAdmin), [])
    assert.equal((await summary(teacher)).needs_action, 0)
  })
})
