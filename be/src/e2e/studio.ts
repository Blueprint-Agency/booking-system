import { randomBytes } from 'node:crypto'
import { and, eq, inArray, like, lt, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { Hono } from 'hono'
import { withTenant } from '../db'
import * as schema from '../db/schema'
import { env } from '../env'
import { seedEmailTemplates } from '../db/seed/email-templates'
import { seedPolicy } from '../db/seed/policy'
import { tenantOrigin } from '../lib/allowed-origins'
import { discardedMail, transport } from '../lib/mailer'
import { ensureAuthUser, setFirstStaffPassword } from '../services/auth/auth-users'
import { configureProviderAccount } from '../services/billing/provider-onboarding'
import { createClassType } from '../services/catalog/class-types'
import { bookClass } from '../services/bookings/book'
import { createClassPackage } from '../services/packages/class-packages'
import { grantPackage } from '../services/packages/purchase'
import { E2E_SLUG_PREFIX } from '../services/tenants/slug'
import { forgetCachedTenants } from '../services/tenants/tenants'
import { tenantTableOrder } from '../services/tenants/transfer'

/**
 * The throwaway studio the browser journeys run in (#145), and its removal.
 *
 * Staging holds real studios and real members until cutover, so the journeys
 * never touch one: each run makes a studio of its own under the reserved
 * `e2e-` prefix (`services/tenants/slug.ts` — the super portal cannot create
 * one), with its own people, and removes it afterwards. Every row it writes
 * carries that studio's `tenant_id`, every address it invents is on Resend's
 * sink domain, and removal deletes by exactly those two things.
 *
 * What is written directly and what goes through the app is chosen the way the
 * test harness chooses it: which rows a studio *has* (premises, staff, a
 * policy) is fixture and written as the owner; anything with rules attached —
 * a member's registration and session, a class type, a plan, a grant — goes
 * through the same service or route a person's action would.
 *
 * Members are registered in-process with the emailed code read back from the
 * null mail transport, so this must run with `NODE_ENV=test` (the CLI sets it).
 * On a real transport no code can be read, and it says so rather than mailing.
 */

type Db = PostgresJsDatabase<typeof schema>

export type E2eStudio = {
  slug: string
  tenantId: string
  /**
   * `api` is this backend's own base, for what a journey must ask of the
   * running server rather than the database — a feature flag is cached per
   * process, so one written here would not reach it.
   */
  urls: { client: string; portal: string; api: string }
  staff: {
    /** One password for both staff accounts, made for this run only. */
    password: string
    admin: { email: string; name: string; role: 'admin' }
    instructor: { email: string; name: string; role: 'instructor' }
  }
  catalogue: {
    packageName: string
    packageCredits: number
    packagePriceSgd: string
    /** Journey 1's class — the buyer books it. */
    buyClassType: string
    /** Journey 3's class — the canceller books and cancels it. */
    cancelClassType: string
    /** Journey 2's class type, with nothing scheduled: the admin schedules it. */
    portalClassType: string
    /** Journey 4's class — starting minutes from now, inside the Check-in Window. */
    checkInClassType: string
    /** The waitlist journey's class — its one online seat taken, room for three in line. */
    waitlistClassType: string
    /**
     * The staff waitlist journey's class — its one online seat taken, one buffer
     * seat free, and two members already in line.
     */
    staffWaitlistClassType: string
  }
  classes: {
    buy: { id: string; startsAt: string }
    cancel: { id: string; startsAt: string }
    checkIn: { id: string; startsAt: string }
    waitlist: { id: string; startsAt: string }
    staffWaitlist: { id: string; startsAt: string }
  }
  /** The staff waitlist class's line, in order, by the names staff see. */
  staffWaitlistLine: string[]
  members: {
    /** Signed in, registered, holding no plan. */
    buyer: { email: string; token: string }
    /** Signed in, registered, holding the plan. */
    canceller: { email: string; token: string }
    /** Signed in, registered, holding the plan: books the check-in class and is checked in. */
    arriver: { email: string; token: string }
    /** Signed in, registered, holding the plan: joins the waitlist class's line and leaves it. */
    waiter: { email: string; token: string }
  }
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const PACKAGE_CREDITS = 5
/** Long enough for the journey to book it before it starts, short enough to be inside the window. */
const CHECK_IN_CLASS_STARTS_IN = 15 * 60 * 1000

/** Resend's sink: accepted and reported delivered, never sent to a person. */
const addressFor = (slug: string, who: string) => `delivered+${slug}-${who}@resend.dev`

export function isE2eSlug(slug: string): boolean {
  return slug.startsWith(E2E_SLUG_PREFIX) && /^[a-z0-9-]+$/.test(slug)
}

/** A client address from the benchmarking range, so sign-ins are not rate limited as one. */
function benchmarkAddress(): string {
  const n = randomBytes(2)
  return `198.18.${n[0]}.${n[1]}`
}

function hourFromNow(days: number): Date {
  const at = new Date(Date.now() + days * DAY)
  at.setUTCMinutes(0, 0, 0)
  return at
}

/**
 * The payment account the studio sells on. Every studio takes card payments on
 * its own account or not at all (#293), so without this the buy journey's
 * checkout is refused `payments_not_configured`. Set up the way the super
 * portal sets up a studio's (#294): the key's mode checked against the
 * environment, the account id asked of the provider, the studio's webhook
 * endpoint created on that account, and the key and signing secret sealed with
 * `PAYMENT_CREDENTIALS_KEY`.
 */
export type E2ePayments = { secretKey: string }

export async function createE2eStudio({
  app,
  db,
  payments,
}: {
  app: Hono
  db: Db
  payments?: E2ePayments
}): Promise<E2eStudio> {
  if (transport.name !== 'null') {
    throw new Error('createE2eStudio reads sign-in codes from the null mail transport: run it with NODE_ENV=test')
  }

  const slug = `${E2E_SLUG_PREFIX}${Date.now().toString(36)}${randomBytes(3).toString('hex')}`
  const client = tenantOrigin('client', slug)
  const portal = tenantOrigin('portal', slug)
  if (!client || !portal) throw new Error('FRONTEND_URLS names no client or portal wildcard')

  const name = `E2E ${slug.slice(E2E_SLUG_PREFIX.length)}`
  const [tenant] = await db.insert(schema.tenants).values({ slug, name }).returning()
  if (!tenant) throw new Error('tenant insert returned no row')
  const seeded = { id: tenant.id, slug, name, timezone: tenant.timezone }
  await db.insert(schema.tenantSettings).values({ tenantId: tenant.id, displayName: name })
  // Mail templates and a cancellation policy: a created studio has neither
  // until a person writes them, and booking mail and cancelling both need them.
  await seedEmailTemplates(db, seeded)
  await seedPolicy(db, seeded)
  if (payments) await configureProviderAccount(tenant.id, payments)

  const [location] = await db
    .insert(schema.locations)
    .values({ tenantId: tenant.id, name: 'E2E Studio' })
    .returning()
  const [room] = await db
    .insert(schema.rooms)
    .values({ tenantId: tenant.id, locationId: location!.id, name: 'E2E Room', capacity: 20 })
    .returning()

  const password = randomBytes(18).toString('base64url')
  const staffMember = async (who: 'admin' | 'instructor', displayName: string) => {
    const email = addressFor(slug, who)
    const authUserId = await ensureAuthUser(db, 'staff', { tenantId: tenant.id, email, name: displayName })
    await setFirstStaffPassword(db, authUserId, password)
    const [first, last] = displayName.split(' ')
    const [row] = await db
      .insert(schema.staffUsers)
      .values({
        tenantId: tenant.id,
        email,
        name: displayName,
        firstName: first,
        lastName: last,
        role: who,
        status: 'active',
        acceptedAt: new Date(),
        authUserId,
      })
      .returning()
    return { id: row!.id, email, name: displayName, role: who }
  }
  const admin = await staffMember('admin', 'E2E Owner')
  const instructor = await staffMember('instructor', 'E2E Teacher')
  await db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: instructor.id })

  const catalogue = {
    packageName: 'E2E five pack',
    packageCredits: PACKAGE_CREDITS,
    packagePriceSgd: '10.00',
    buyClassType: 'E2E buy class',
    cancelClassType: 'E2E cancel class',
    portalClassType: 'E2E portal class',
    checkInClassType: 'E2E check-in class',
    waitlistClassType: 'E2E waitlist class',
    staffWaitlistClassType: 'E2E staff waitlist class',
  }
  const { classPackage, classTypes } = await withTenant(tenant.id, async () => ({
    classPackage: await createClassPackage(tenant.id, {
      name: catalogue.packageName,
      kind: 'credit_bundle',
      credits: PACKAGE_CREDITS,
      validityDays: 30,
      priceSgd: catalogue.packagePriceSgd,
    }),
    classTypes: {
      buy: await createClassType(tenant.id, { name: catalogue.buyClassType }),
      cancel: await createClassType(tenant.id, { name: catalogue.cancelClassType }),
      portal: await createClassType(tenant.id, { name: catalogue.portalClassType }),
      checkIn: await createClassType(tenant.id, { name: catalogue.checkInClassType }),
      waitlist: await createClassType(tenant.id, { name: catalogue.waitlistClassType }),
      staffWaitlist: await createClassType(tenant.id, { name: catalogue.staffWaitlistClassType }),
    },
  }))

  const addClass = async (
    classTypeId: string,
    startsAt: Date,
    capacity: { online: number; buffer?: number; waitlist: number } = { online: 10, waitlist: 0 },
  ) => {
    const [row] = await db
      .insert(schema.classes)
      .values({
        tenantId: tenant.id,
        classTypeId,
        mainInstructorId: instructor.id,
        locationId: location!.id,
        roomId: room!.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: capacity.online,
        capacityBuffer: capacity.buffer ?? 0,
        capacityWaitlist: capacity.waitlist,
        creditCost: 1,
        instructorPaySgd: '50.00',
        createdByStaffId: admin.id,
      })
      .returning({ id: schema.classes.id })
    return { id: row!.id, startsAt: startsAt.toISOString() }
  }
  const classes = {
    // Days out, so both are well outside the policy's 24-hour cancellation window.
    buy: await addClass(classTypes.buy.id, hourFromNow(3)),
    cancel: await addClass(classTypes.cancel.id, hourFromNow(4)),
    // Minutes out: bookable (it has not started) and already inside the
    // seeded Check-in Window, so the desk can check its member in today.
    checkIn: await addClass(classTypes.checkIn.id, new Date(Date.now() + CHECK_IN_CLASS_STARTS_IN)),
    // Outside the window, so its line is open; one seat, which `seated` takes below.
    waitlist: await addClass(classTypes.waitlist.id, hourFromNow(2), { online: 1, waitlist: 3 }),
    // The same, with a buffer seat for staff to add the head of the line into.
    staffWaitlist: await addClass(classTypes.staffWaitlist.id, hourFromNow(2), { online: 1, buffer: 1, waitlist: 3 }),
  }

  const register = async (who: string, lastName: string) => {
    const email = addressFor(slug, who)
    const headers = {
      'Content-Type': 'application/json',
      Origin: client,
      'X-Tenant-Slug': slug,
      'X-Forwarded-For': benchmarkAddress(),
    }
    const sent = await app.request('/api/v1/auth/client/email-otp/send-verification-otp', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, type: 'sign-in' }),
    })
    if (sent.status !== 200) throw new Error(`code request for ${email} refused (${sent.status}): ${await sent.text()}`)
    const otp = [...discardedMail].reverse().find(m => m.to === email)?.html.match(/>(\d{6})</)?.[1]
    if (!otp) throw new Error(`no sign-in code was mailed to ${email}`)
    const registered = await app.request('/api/v1/public/members/register', {
      method: 'POST',
      headers,
      // Members choose a password at sign-up (#173); the code still proves the
      // address. One password for every member of a run, made for that run.
      body: JSON.stringify({
        email,
        otp,
        first_name: 'E2E',
        last_name: lastName,
        phone: '+6580000000',
        password,
      }),
    })
    if (registered.status !== 200) {
      throw new Error(`registering ${email} failed (${registered.status}): ${await registered.text()}`)
    }
    const { token } = (await registered.json()) as { token: string }
    return { email, token }
  }
  const buyer = await register('buyer', 'Buyer')
  const canceller = await register('canceller', 'Canceller')
  const arriver = await register('arriver', 'Arriver')
  const waiter = await register('waiter', 'Waiter')
  // Not handed to the journeys: they only need the seat taken, and the line filled.
  const seated = await register('seated', 'Seated')
  const queued = [await register('queued1', 'Queuer One'), await register('queued2', 'Queuer Two')]

  const clientIds: Record<string, string> = {}
  for (const member of [canceller, arriver, waiter, seated, ...queued]) {
    const [row] = await db
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(and(eq(schema.clients.tenantId, tenant.id), eq(schema.clients.email, member.email)))
    clientIds[member.email] = row!.id
    await withTenant(tenant.id, () =>
      grantPackage(tenant.id, {
        clientId: row!.id,
        purchaseId: null,
        amountSgd: catalogue.packagePriceSgd,
        packageKind: 'class',
        packageId: classPackage.id,
      }),
    )
  }
  // The waitlist class's one online seat, booked the way the member would book it.
  await withTenant(tenant.id, () =>
    bookClass(tenant.id, { clientId: clientIds[seated.email]!, classId: classes.waitlist.id }),
  )
  // The staff waitlist class: its online seat taken the same way, and two
  // members in its line. Written as rows, not joined through the service: the
  // studio's waitlist switch is off in this process (the journey turns it on
  // in the running backend), and a line from before the switch is exactly what
  // staff can still work. A second apart, so the order is certain.
  await withTenant(tenant.id, () =>
    bookClass(tenant.id, { clientId: clientIds[seated.email]!, classId: classes.staffWaitlist.id }),
  )
  const joinedAt = Date.now() - 60_000
  await db.insert(schema.waitlistEntries).values(
    queued.map((member, i) => ({
      tenantId: tenant.id,
      clientId: clientIds[member.email]!,
      classId: classes.staffWaitlist.id,
      status: 'waiting' as const,
      joinedAt: new Date(joinedAt + i * 1000),
    })),
  )
  const queuedNames = await db
    .select({ email: schema.clients.email, name: schema.clients.name })
    .from(schema.clients)
    .where(and(eq(schema.clients.tenantId, tenant.id), inArray(schema.clients.email, queued.map(q => q.email))))
  const staffWaitlistLine = queued.map(q => queuedNames.find(n => n.email === q.email)!.name)

  return {
    slug,
    tenantId: tenant.id,
    urls: { client, portal, api: `${env.BETTER_AUTH_URL.replace(/\/$/, '')}/api/v1` },
    staff: {
      password,
      admin: { email: admin.email, name: admin.name, role: 'admin' },
      instructor: { email: instructor.email, name: instructor.name, role: 'instructor' },
    },
    catalogue,
    classes,
    staffWaitlistLine,
    members: { buyer, canceller, arriver, waiter },
  }
}

/**
 * Delete an e2e studio: every row carrying its `tenant_id`, children before
 * parents, its logins, then the studio. Returns false when there was no such
 * studio, so it is safe to run after a setup that failed.
 *
 * Refuses any slug outside the e2e prefix — the one thing between a typo here
 * and a real studio's data.
 */
export async function removeE2eStudio({ db, slug }: { db: Db; slug: string }): Promise<boolean> {
  if (!isE2eSlug(slug)) throw new Error(`${slug} is not an e2e studio`)
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.slug, slug))

  if (!tenant) return false
  const { order } = await tenantTableOrder()
  await db.transaction(async tx => {
    for (const table of [...order].reverse()) {
      await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE tenant_id = ${tenant.id}`)
    }
    // Its logins are its own (#231) and outside `order`: what hangs off a user
    // first, then the users, before the `tenants` row they restrict.
    for (const table of [
      schema.clientAuthSessions,
      schema.clientAuthAccounts,
      schema.clientAuthVerifications,
      schema.clientAuthUsers,
      schema.staffAuthSessions,
      schema.staffAuthAccounts,
      schema.staffAuthTwoFactors,
      schema.staffAuthVerifications,
      schema.staffAuthUsers,
    ]) {
      await tx.delete(table).where(eq(table.tenantId, tenant.id))
    }
    await tx.delete(schema.tenantSettings).where(eq(schema.tenantSettings.tenantId, tenant.id))
    await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenant.id))
  })
  forgetCachedTenants()
  return Boolean(tenant)
}

/** Remove e2e studios older than `olderThanMs` — the ones a killed run never tore down. */
export async function removeStaleE2eStudios({ db, olderThanMs }: { db: Db; olderThanMs: number }): Promise<string[]> {
  const stale = await db
    .select({ slug: schema.tenants.slug })
    .from(schema.tenants)
    .where(
      and(
        like(schema.tenants.slug, `${E2E_SLUG_PREFIX}%`),
        lt(schema.tenants.createdAt, new Date(Date.now() - olderThanMs)),
      ),
    )
  const removed: string[] = []
  for (const { slug } of stale) {
    if (!isE2eSlug(slug)) continue
    await removeE2eStudio({ db, slug })
    removed.push(slug)
  }
  return removed
}
