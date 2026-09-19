import { randomBytes } from 'node:crypto'
import { and, eq, like, lt, notExists, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { Hono } from 'hono'
import { withTenant } from '../db'
import * as schema from '../db/schema'
import { seedEmailTemplates } from '../db/seed/email-templates'
import { seedPolicy } from '../db/seed/policy'
import { tenantOrigin } from '../lib/allowed-origins'
import { discardedMail, transport } from '../lib/mailer'
import { ensureAuthUser, setFirstStaffPassword } from '../services/auth/auth-users'
import { createClassType } from '../services/catalog/class-types'
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
  urls: { client: string; portal: string }
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
  }
  classes: {
    buy: { id: string; startsAt: string }
    cancel: { id: string; startsAt: string }
  }
  members: {
    /** Signed in, registered, holding no plan. */
    buyer: { email: string; token: string }
    /** Signed in, registered, holding the plan. */
    canceller: { email: string; token: string }
  }
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const PACKAGE_CREDITS = 5

/** Resend's sink: accepted and reported delivered, never sent to a person. */
const addressFor = (slug: string, who: string) => `delivered+${slug}-${who}@resend.dev`
const addressPattern = (slug: string) => `delivered+${slug}-%@resend.dev`

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

export async function createE2eStudio({ app, db }: { app: Hono; db: Db }): Promise<E2eStudio> {
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
    const authUserId = await ensureAuthUser(db, 'staff', { email, name: displayName })
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
    },
  }))

  // Days out, so both are well outside the policy's 24-hour cancellation window.
  const addClass = async (classTypeId: string, startsAt: Date) => {
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
        capacityOnline: 10,
        creditCost: 1,
        instructorPaySgd: '50.00',
        createdByStaffId: admin.id,
      })
      .returning({ id: schema.classes.id })
    return { id: row!.id, startsAt: startsAt.toISOString() }
  }
  const classes = {
    buy: await addClass(classTypes.buy.id, hourFromNow(3)),
    cancel: await addClass(classTypes.cancel.id, hourFromNow(4)),
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
      body: JSON.stringify({ email, otp, first_name: 'E2E', last_name: lastName, phone: '+6580000000' }),
    })
    if (registered.status !== 200) {
      throw new Error(`registering ${email} failed (${registered.status}): ${await registered.text()}`)
    }
    const { token } = (await registered.json()) as { token: string }
    return { email, token }
  }
  const buyer = await register('buyer', 'Buyer')
  const canceller = await register('canceller', 'Canceller')

  const [cancellerRow] = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(and(eq(schema.clients.tenantId, tenant.id), eq(schema.clients.email, canceller.email)))
  await withTenant(tenant.id, () =>
    grantPackage(tenant.id, {
      clientId: cancellerRow!.id,
      purchaseId: null,
      amountSgd: catalogue.packagePriceSgd,
      packageKind: 'class',
      packageId: classPackage.id,
    }),
  )

  return {
    slug,
    tenantId: tenant.id,
    urls: { client, portal },
    staff: {
      password,
      admin: { email: admin.email, name: admin.name, role: 'admin' },
      instructor: { email: instructor.email, name: instructor.name, role: 'instructor' },
    },
    catalogue,
    classes,
    members: { buyer, canceller },
  }
}

/**
 * Delete an e2e studio: every row carrying its `tenant_id`, children before
 * parents, then the studio, then the auth users made for it. Returns false when
 * there was no such studio, so it is safe to run after a setup that failed.
 *
 * Refuses any slug outside the e2e prefix — the one thing between a typo here
 * and a real studio's data.
 */
export async function removeE2eStudio({ db, slug }: { db: Db; slug: string }): Promise<boolean> {
  if (!isE2eSlug(slug)) throw new Error(`${slug} is not an e2e studio`)
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.slug, slug))

  const { order } = await tenantTableOrder()
  await db.transaction(async tx => {
    if (tenant) {
      for (const table of [...order].reverse()) {
        await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE tenant_id = ${tenant.id}`)
      }
      await tx.delete(schema.tenantSettings).where(eq(schema.tenantSettings.tenantId, tenant.id))
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenant.id))
    }
    // By address, even when the studio is already gone, so a run that died
    // between the two leaves nothing. A member still on another studio's books
    // keeps their account — not that an address on this sink could be one.
    await tx
      .delete(schema.clientAuthUsers)
      .where(
        and(
          like(schema.clientAuthUsers.email, addressPattern(slug)),
          notExists(
            tx.select().from(schema.clients).where(eq(schema.clients.authUserId, schema.clientAuthUsers.id)),
          ),
        ),
      )
    await tx
      .delete(schema.staffAuthUsers)
      .where(
        and(
          like(schema.staffAuthUsers.email, addressPattern(slug)),
          notExists(
            tx.select().from(schema.staffUsers).where(eq(schema.staffUsers.authUserId, schema.staffAuthUsers.id)),
          ),
        ),
      )
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
