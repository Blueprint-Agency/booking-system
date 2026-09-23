import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.scheduled-jobs.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const PACKAGE_NAME = `Scheduled job pass ${run}`
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The daily jobs, fired directly (`scheduledJobs`) at an instant the test holds
 * on the app's clock (#201).
 *
 * A daily job's hour is each Tenant's own: the cron grid ticks for everyone and
 * a Tenant's `timezone` decides whether the tick is its moment. The two fixture
 * Tenants sit in different zones, so the tick that is one studio's 01:00 is
 * not the other's — and a job fired then must leave the other studio's rows
 * exactly as they were, however due they are.
 */
describe('scheduled jobs', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let jobs!: typeof import('../jobs')
  let isDailySlot!: typeof import('../jobs/local-time').isDailySlot
  let classPackagesSvc!: typeof import('../services/packages/class-packages')
  let purchaseSvc!: typeof import('../services/packages/purchase')
  let ensureAuthUser!: typeof import('../services/auth/auth-users').ensureAuthUser

  type Studio = { id: string; slug: string; timezone: string; classPackageId: string }
  type Member = { clientId: string; email: string; packageId: string }

  let one!: Studio
  let two!: Studio
  let made = 0

  /**
   * The first tick of the grid, after `from`, that is `localHour` in `at`'s
   * zone — five minutes into the slot, as a tick running a little late would be.
   */
  function slotFor(at: Studio, localHour: number, from: Date): Date {
    const QUARTER = 15 * MINUTE
    for (let t = Math.ceil(from.getTime() / QUARTER) * QUARTER; t < from.getTime() + 2 * DAY; t += QUARTER) {
      if (isDailySlot(at.timezone, localHour, new Date(t))) return new Date(t + 5 * MINUTE)
    }
    throw new Error(`no ${localHour}:00 slot for ${at.timezone} within two days of ${from.toISOString()}`)
  }

  /** A week from the real today, so no leftover row's real expiry sits near it. */
  const aWeekOut = () => new Date(Date.now() + 7 * DAY)

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const [row] = await harness.db.select({ timezone: schema.tenants.timezone }).from(schema.tenants).where(eq(schema.tenants.id, tenant.id))
    assert.ok(row)
    const classPackage = await classPackagesSvc.createClassPackage(tenant.id, {
      name: PACKAGE_NAME,
      kind: 'credit_bundle',
      credits: 10,
      validityDays: 90,
      priceSgd: '200.00',
    })
    return { ...tenant, timezone: row.timezone, classPackageId: classPackage.id }
  }

  /** A member of `at` holding a 10-credit bundle that ends at `expiresAt`. */
  async function memberWithBundle(at: Studio, expiresAt: Date): Promise<Member> {
    const email = `member-${made++}-${at.slug}@${DOMAIN}`
    const authUserId = await ensureAuthUser(harness.db, 'client', { email, name: `Member ${made}` })
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name: `Member ${made}`, phone: '+6580000000', authUserId })
      .returning({ id: schema.clients.id })
    await purchaseSvc.grantPackage(at.id, {
      clientId: client!.id,
      purchaseId: null,
      amountSgd: '200.00',
      packageKind: 'class',
      packageId: at.classPackageId,
    })
    // Activated, and ending when the test says: the fixture's to state.
    const [pkg] = await harness.db
      .update(schema.clientPackages)
      .set({ expiresAt })
      .where(eq(schema.clientPackages.clientId, client!.id))
      .returning({ id: schema.clientPackages.id })
    return { clientId: client!.id, email, packageId: pkg!.id }
  }

  const packagesOf = (who: Member) =>
    harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.clientId, who.clientId))

  async function isActive(who: Member): Promise<boolean> {
    const [row] = await harness.db
      .select({ active: schema.clientPackages.active })
      .from(schema.clientPackages)
      .where(eq(schema.clientPackages.id, who.packageId))
    return row!.active
  }

  const remindersTo = (who: Member) =>
    harness.db
      .select()
      .from(schema.emailLog)
      .where(and(eq(schema.emailLog.recipientEmail, who.email), eq(schema.emailLog.templateSlug, 'credit_expiry_reminder')))

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    jobs = await import('../jobs')
    isDailySlot = (await import('../jobs/local-time')).isDailySlot
    classPackagesSvc = inTenantContext(await import('../services/packages/class-packages'))
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))
    ensureAuthUser = (await import('../services/auth/auth-users')).ensureAuthUser

    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
    // Everything below depends on it: the same tick is never both studios' hour.
    assert.notEqual(one.timezone, two.timezone)
  })

  after(async () => {
    if (!harness) return
    harness.clock.reset()
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name = ${PACKAGE_NAME}`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  test("PKG-20, TEN-17 the expiry job ends a studio's lapsed packages at that studio's own 01:00, and no other studio's", async () => {
    const oneAt0100 = slotFor(one, 1, aWeekOut())
    const twoAt0100 = slotFor(two, 1, oneAt0100)
    // Ended before either studio's tick.
    const lapsedAtOne = await memberWithBundle(one, new Date(oneAt0100.getTime() - HOUR))
    const lapsedAtTwo = await memberWithBundle(two, new Date(oneAt0100.getTime() - HOUR))
    const runningAtOne = await memberWithBundle(one, new Date(twoAt0100.getTime() + DAY))

    harness.clock.set(oneAt0100)
    await jobs.scheduledJobs.expirePackages()

    assert.equal(await isActive(lapsedAtOne), false)
    assert.equal(await isActive(runningAtOne), true)
    assert.equal(await isActive(lapsedAtTwo), true, "one studio's 01:00 touched the other studio's package")

    harness.clock.set(twoAt0100)
    await jobs.scheduledJobs.expirePackages()

    assert.equal(await isActive(lapsedAtTwo), false)
    assert.equal(await isActive(runningAtOne), true)
    // Expiry ends a package and nothing more: no renewal, no charge.
    for (const who of [lapsedAtOne, lapsedAtTwo, runningAtOne]) {
      assert.equal((await packagesOf(who)).length, 1)
      const [charges] = await harness.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.stripePayments)
        .where(eq(schema.stripePayments.clientId, who.clientId))
      assert.equal(charges!.n, 0)
    }
  })

  test("NTF-17, TEN-17 the expiry reminder emails each member once, at their own studio's 08:00, and no other studio's members", async () => {
    const oneAt0800 = slotFor(one, 8, aWeekOut())
    const twoAt0800 = slotFor(two, 8, oneAt0800)
    // The reminder looks 6.5–7.5 days ahead. Studio two's bundle ends where
    // BOTH ticks see it inside that window, so only the studio's hour can keep
    // studio one's tick off it.
    const windowOpens = Math.max(oneAt0800.getTime(), twoAt0800.getTime()) + 6.5 * DAY
    const windowCloses = Math.min(oneAt0800.getTime(), twoAt0800.getTime()) + 7.5 * DAY
    assert.ok(windowOpens < windowCloses, 'the two ticks are more than a day apart')
    const lapsingAtOne = await memberWithBundle(one, new Date(oneAt0800.getTime() + 7 * DAY))
    const lapsingAtTwo = await memberWithBundle(two, new Date((windowOpens + windowCloses) / 2))
    const laterAtOne = await memberWithBundle(one, new Date(oneAt0800.getTime() + 20 * DAY))

    harness.clock.set(oneAt0800)
    await jobs.scheduledJobs.sendLapsingAlerts()

    const [reminder, ...extra] = await remindersTo(lapsingAtOne)
    assert.ok(reminder, 'the lapsing member at studio one was not reminded')
    assert.equal(extra.length, 0)
    assert.equal(reminder.tenantId, one.id)
    assert.equal(reminder.recipientUserId, lapsingAtOne.clientId)
    assert.match(reminder.subjectRendered, new RegExp(PACKAGE_NAME))
    assert.match(reminder.bodyRendered, /10 class credits/)
    assert.equal((await remindersTo(lapsingAtTwo)).length, 0, "one studio's 08:00 reminded the other studio's member")
    assert.equal((await remindersTo(laterAtOne)).length, 0)

    harness.clock.set(twoAt0800)
    await jobs.scheduledJobs.sendLapsingAlerts()

    const atTwo = await remindersTo(lapsingAtTwo)
    assert.equal(atTwo.length, 1)
    assert.equal(atTwo[0]!.tenantId, two.id)

    // The next day's tick at studio one: the same bundle is not reminded twice.
    harness.clock.set(slotFor(one, 8, new Date(oneAt0800.getTime() + HOUR)))
    await jobs.scheduledJobs.sendLapsingAlerts()
    assert.equal((await remindersTo(lapsingAtOne)).length, 1)
    assert.equal((await remindersTo(laterAtOne)).length, 0)
  })
})
