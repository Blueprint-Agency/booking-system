import assert from 'node:assert/strict'
import { after, afterEach, before, describe, test } from 'node:test'
import { and, eq } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { connectPayments, usePaymentKey } from './attention-payments'

/**
 * Staff attention, staff logins (#476, #487): `staff_invitation_expired`,
 * `staff_email_change_expired` and `staff_without_email`, read over HTTP.
 * Every test makes a studio of its own, so a count says only what it filed.
 */
describe('Staff attention: staff logins', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  usePaymentKey()
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')

  const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
  // Sunday 1 Nov 2026, noon in Singapore: the days below are worked out from it.
  const START = new Date('2026-11-01T04:00:00Z')
  const DAY = 24 * 60 * 60 * 1000

  type Studio = { id: string; slug: string }
  type Staff = { headers: Record<string, string>; id: string; email: string }

  let studios = 0

  const send = (path: string, headers: Record<string, string>, method = 'GET', body?: unknown) =>
    harness.app.request(`/api/v1${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  const json = async (res: Response, status: number) => {
    const text = await res.text()
    assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${text}`)
    return (text ? JSON.parse(text) : {}) as Record<string, any>
  }

  const freshStudio = async (): Promise<Studio> => {
    const slug = `attsl-${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({ slug, name: 'Attention Logins Studio', adminEmail: `owner@${slug}.test` })
    await connectPayments(tenant.id)
    // The studio's first admin was invited and never arrived; settle that invitation so a test counts only its own.
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

  /** A staff row as an import leaves it: its own login, and whatever address it was given. */
  const importedStaff = async (studio: Studio, name: string, email: string, status: 'active' | 'pending' | 'archived') => {
    const { ensureAuthUser } = await import('../services/auth/auth-users')
    const authUserId = await ensureAuthUser(harness.db as any, 'staff', { tenantId: studio.id, email, name })
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: studio.id, email, name, role: 'instructor', status, authUserId })
      .returning()
    return row!.id
  }

  const panel = async (who: Staff) => json(await send('/portal/attention', who.headers), 200)
  const summary = async (who: Staff) => json(await send('/portal/attention/summary', who.headers), 200)
  const KINDS = ['staff_invitation_expired', 'staff_email_change_expired', 'staff_without_email']
  const loginItems = async (who: Staff, kind?: string) =>
    ((await panel(who)).needs_action.groups as Array<{ items: Array<Record<string, any>> }>)
      .flatMap(g => g.items)
      .filter(i => (kind ? i.kind === kind : KINDS.includes(i.kind)))

  /** Invite over HTTP at the stood-still clock; the invitee is named `name`. */
  const invite = async (admin: Staff, studio: Studio, name: string, role: 'admin' | 'instructor' = 'instructor') => {
    const email = `${name}@${studio.slug}.test`
    const created = await json(await send('/portal/admin/staff/invite', admin.headers, 'POST', { email, role }), 201)
    const [inv] = await harness.db.select().from(schema.staffInvitations).where(eq(schema.staffInvitations.id, created.id))
    await harness.db.update(schema.staffUsers).set({ name }).where(eq(schema.staffUsers.id, inv!.staffUserId!))
    return { id: created.id as string, staffId: inv!.staffUserId!, email }
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
  })

  afterEach(() => harness.clock.reset())

  after(async () => {
    await harness?.close()
  })

  test('ATN-110 an invitation still pending past its expiry is an item titled with the invitee and role, linked to Staff with the invitation open; a pending one that has not expired is not', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'anna')
    harness.clock.set(START)
    const dana = await invite(admin, studio, 'Dana', 'instructor')
    const eli = await invite(admin, studio, 'Eli', 'admin')

    assert.deepEqual(await loginItems(admin), [], 'a fresh invitation is not an item')

    // Dana's runs out at 7 days; Eli's is sent later, so it is still live.
    await harness.db
      .update(schema.staffInvitations)
      .set({ expiresAt: new Date(START.getTime() + 7 * DAY) })
      .where(eq(schema.staffInvitations.id, dana.id))
    harness.clock.set(new Date(START.getTime() + 7 * DAY + 1000))
    await harness.db
      .update(schema.staffInvitations)
      .set({ expiresAt: new Date(START.getTime() + 8 * DAY) })
      .where(eq(schema.staffInvitations.id, eli.id))

    const items = await loginItems(admin, 'staff_invitation_expired')
    assert.equal(items.length, 1)
    const [item] = items
    assert.equal(item!.id, `staff_invitation_expired:${dana.id}`)
    assert.equal(item!.title, "Dana's invitation to join as instructor expired")
    assert.equal(item!.detail, 'Expired Sun 8 Nov. Resend or revoke it')
    assert.equal(item!.href, `/admin/staff?invitation=${dana.id}`)
    assert.equal(item!.location, null)
    assert.equal(item!.dismissable, false)

    const body = await panel(admin)
    const group = body.needs_action.groups.find((g: any) => g.key === 'people_email')
    assert.equal(group.count, 1)
    assert.equal((await summary(admin)).needs_action, 1)
  })

  test('ATN-111 an expired invitation leaves the bell when it is resent, revoked or accepted', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'anna')
    harness.clock.set(START)
    const resent = await invite(admin, studio, 'Resent')
    const revoked = await invite(admin, studio, 'Revoked')
    const accepted = await invite(admin, studio, 'Accepted')
    harness.clock.set(new Date(START.getTime() + 7 * DAY + 1000))
    assert.equal((await loginItems(admin)).length, 3)

    await json(await send(`/portal/admin/staff/invitations/${resent.id}/resend`, admin.headers, 'POST'), 200)
    assert.deepEqual((await loginItems(admin)).map(i => i.id).sort(), [
      `staff_invitation_expired:${accepted.id}`,
      `staff_invitation_expired:${revoked.id}`,
    ].sort())

    await json(await send(`/portal/admin/staff/invitations/${revoked.id}/revoke`, admin.headers, 'POST'), 200)
    assert.deepEqual((await loginItems(admin)).map(i => i.id), [`staff_invitation_expired:${accepted.id}`])

    await harness.db
      .update(schema.staffInvitations)
      .set({ status: 'accepted', acceptedAt: new Date() })
      .where(eq(schema.staffInvitations.id, accepted.id))
    assert.deepEqual(await loginItems(admin), [])
    assert.equal((await summary(admin)).needs_action, 0)
  })

  test('ATN-112 an email change whose link expired unconfirmed is an item linked to that staff member; one still in time is not', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'anna')
    const teacher = await staffAt(studio, 'teacher', 'instructor')
    await harness.db.update(schema.staffUsers).set({ name: 'Tess' }).where(eq(schema.staffUsers.id, teacher.id))
    const newEmail = `tess-new@${studio.slug}.test`

    harness.clock.set(START)
    await json(await send(`/portal/admin/staff/${teacher.id}/email`, admin.headers, 'POST', { email: newEmail }), 200)
    harness.clock.advance(23 * 60 * 60_000)
    assert.deepEqual(await loginItems(admin), [], 'inside its 24 hours')

    harness.clock.advance(2 * 60 * 60_000)
    const [item] = await loginItems(admin, 'staff_email_change_expired')
    assert.equal(item!.id, `staff_email_change_expired:${teacher.id}`)
    assert.equal(item!.title, `Tess's email change to ${newEmail} was never confirmed`)
    assert.equal(item!.detail, 'The link expired Mon 2 Nov. Resend or cancel it')
    assert.equal(item!.href, `/admin/staff?staff=${teacher.id}`)
    assert.equal(item!.dismissable, false)
    assert.equal((await summary(admin)).needs_action, 1)
  })

  test('ATN-113 an expired email change leaves the bell when it is resent or cancelled, and when the staff member is archived', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'anna')
    const a = await staffAt(studio, 'resent', 'instructor')
    const b = await staffAt(studio, 'cancelled', 'instructor')
    const c = await staffAt(studio, 'archived', 'instructor')
    harness.clock.set(START)
    for (const t of [a, b, c]) {
      await json(await send(`/portal/admin/staff/${t.id}/email`, admin.headers, 'POST', { email: `new-${t.email}` }), 200)
    }
    harness.clock.advance(25 * 60 * 60_000)
    assert.equal((await loginItems(admin)).length, 3)

    await json(await send(`/portal/admin/staff/${a.id}/email`, admin.headers, 'POST', { email: `new-${a.email}` }), 200)
    assert.equal((await loginItems(admin)).length, 2)

    assert.equal((await send(`/portal/admin/staff/${b.id}/email`, admin.headers, 'DELETE')).status, 204)
    assert.deepEqual((await loginItems(admin)).map(i => i.id), [`staff_email_change_expired:${c.id}`])

    await json(await send(`/portal/admin/staff/${c.id}/archive`, admin.headers, 'POST'), 200)
    assert.deepEqual(await loginItems(admin), [])
  })

  test('ATN-114 an active staff member with a placeholder address is an item; real addresses, pending and archived staff are not; it clears when a real address is set or they are archived', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'anna')
    const mk = (name: string, email: string, status: 'active' | 'pending' | 'archived') =>
      importedStaff(studio, name, email, status)
    const noMail = await mk('Nico', `nico-${run}@imported.INVALID`, 'active')
    const noMail2 = await mk('Nora', `nora-${run}@imported.invalid`, 'active')
    await mk('Pia', `pia-${run}@imported.invalid`, 'pending')
    await mk('Arch', `arch-${run}@imported.invalid`, 'archived')
    await mk('Real', `real-${run}@${studio.slug}.test`, 'active')

    const items = await loginItems(admin, 'staff_without_email')
    assert.deepEqual(items.map(i => i.id).sort(), [`staff_without_email:${noMail}`, `staff_without_email:${noMail2}`].sort())
    const nico = items.find(i => i.id === `staff_without_email:${noMail}`)!
    assert.equal(nico.title, "Nico has no email address, so they can't sign in")
    assert.equal(nico.detail, 'Add one from Staff')
    assert.equal(nico.href, `/admin/staff?staff=${noMail}`)
    assert.equal(nico.dismissable, false)

    await harness.db
      .update(schema.staffUsers)
      .set({ email: `nico-real-${run}@${studio.slug}.test` })
      .where(eq(schema.staffUsers.id, noMail))
    assert.deepEqual((await loginItems(admin)).map(i => i.id), [`staff_without_email:${noMail2}`])

    await harness.db
      .update(schema.staffUsers)
      .set({ status: 'archived' })
      .where(and(eq(schema.staffUsers.id, noMail2)))
    assert.deepEqual(await loginItems(admin), [])
  })

  test('ATN-115 the three items are for admins only, and never cross studios', async () => {
    const studio = await freshStudio()
    const other = await freshStudio()
    const admin = await staffAt(studio, 'anna')
    const otherAdmin = await staffAt(other, 'olga')
    const teacher = await staffAt(studio, 'teacher', 'instructor')
    await importedStaff(studio, 'Xan', `x-${run}@imported.invalid`, 'active')
    harness.clock.set(START)
    await invite(admin, studio, 'Dana')
    harness.clock.advance(8 * DAY)

    assert.equal((await loginItems(admin)).length, 2)
    assert.deepEqual(await loginItems(teacher), [])
    assert.deepEqual(await loginItems(otherAdmin), [])
    assert.equal((await summary(teacher)).needs_action, 0)
  })
})
