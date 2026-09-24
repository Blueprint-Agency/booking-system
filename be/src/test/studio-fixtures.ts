import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type * as Schema from '../db/schema'
import { frontendOrigin, harnessAddress, HARNESS_PASSWORD, type TestApp } from './harness'

/**
 * A studio of its own per test, and the people and rows in it, for the tests of
 * what an Admin does to a studio's staff and members (#268).
 *
 * Each studio is created the way the super portal creates one, so who is in it
 * is the test's to state and nothing another file left behind is counted. Its
 * policy row is seeded as the fixture Tenants' is, and it gets one Location,
 * Room and class type to hang classes on.
 *
 * Load after `startTestApp`: provisioning and the seeds reach the database.
 */

export type Studio = { id: string; slug: string; locationId: string; roomId: string; classTypeId: string }
export type StaffFixture = { headers: Record<string, string>; id: string; email: string }
export type MemberFixture = { headers: Record<string, string>; id: string; email: string; authUserId: string }
export type Reply = { status: number; body: any }

const HOUR = 60 * 60 * 1000

export async function studioFixtures(harness: TestApp, schema: typeof Schema, prefix: string) {
  const provision = await import('../services/tenants/provision')
  const { seedPolicy } = await import('../db/seed/policy')
  const run = `${prefix}-${Date.now().toString(36)}`
  let studios = 0

  const reply = async (res: Response): Promise<Reply> => {
    const text = await res.text()
    let body: unknown = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text
    }
    return { status: res.status, body }
  }

  /** A request to `/api/v1${path}`: a GET without a body, a POST with one, unless `method` says. */
  const send = async (path: string, init: { body?: unknown; headers: Record<string, string>; method?: string }) =>
    reply(
      await harness.app.request(`/api/v1${path}`, {
        method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
        headers: { ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
    )

  const expectStatus = (res: Reply, status: number, error?: string) => {
    assert.equal(res.status, status, JSON.stringify(res.body))
    if (error) assert.equal(res.body?.error ?? res.body?.message, error, JSON.stringify(res.body))
    return res.body
  }

  /** What the portal on the studio's hostname sends, with no session. */
  const portalHeaders = (studio: { slug: string }): Record<string, string> => ({
    'X-Tenant-Slug': studio.slug,
    Origin: frontendOrigin('staff', studio),
    'X-Forwarded-For': harnessAddress(),
  })

  /** What the booking app on the studio's hostname sends, with no session. */
  const memberHeaders = (studio: { slug: string }): Record<string, string> => ({
    'X-Tenant-Slug': studio.slug,
    Origin: frontendOrigin('client', studio),
    'X-Forwarded-For': harnessAddress(),
  })

  const freshStudio = async (): Promise<Studio> => {
    const slug = `${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({ slug, name: 'Fixture Studio', adminEmail: `owner@${slug}.test` })
    await seedPolicy(harness.db, tenant)
    const [location] = await harness.db.insert(schema.locations).values({ tenantId: tenant.id, name: 'Main hall' }).returning()
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: tenant.id, locationId: location!.id, name: 'Room 1', capacity: 20 })
      .returning()
    const [classType] = await harness.db.insert(schema.classTypes).values({ tenantId: tenant.id, name: 'Hatha' }).returning()
    return { id: tenant.id, slug, locationId: location!.id, roomId: room!.id, classTypeId: classType!.id }
  }

  /** An active staff member of `studio` with `role`, signed in on its portal. Instructors get their profile too. */
  const staffAt = async (studio: Studio, name: string, role: 'admin' | 'instructor'): Promise<StaffFixture> => {
    const email = `${name}@${studio.slug}.test`
    const headers = await harness.signInAs('staff', email, studio)
    const [user] = await harness.db
      .select()
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.tenantId, studio.id), eq(schema.staffAuthUsers.email, email)))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: studio.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning()
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: studio.id, staffUserId: row!.id })
    }
    return { headers, id: row!.id, email }
  }

  /** A member of `studio`, signed in on its booking app with the harness password. */
  const memberAt = async (studio: Studio, name: string, over: Partial<typeof schema.clients.$inferInsert> = {}): Promise<MemberFixture> => {
    const email = `${name}@${studio.slug}.test`
    const headers = await harness.signInAs('client', email, studio)
    const [user] = await harness.db
      .select()
      .from(schema.clientAuthUsers)
      .where(and(eq(schema.clientAuthUsers.tenantId, studio.id), eq(schema.clientAuthUsers.email, email)))
    const [row] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: studio.id, email, name, phone: '+6580000000', authUserId: user!.id, ...over })
      .returning()
    return { headers, id: row!.id, email, authUserId: user!.id }
  }

  /** Sign a member in again with their password, as the booking app would: the raw answer. */
  const memberSignIn = (studio: Studio, email: string) =>
    harness.app.request('/api/v1/auth/client/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...memberHeaders(studio) },
      body: JSON.stringify({ email, password: HARNESS_PASSWORD }),
    })

  /** A class at `studio` taught by `instructorId`, one credit a seat. */
  const classAt = async (studio: Studio, instructorId: string, startsAt: Date) => {
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: studio.id,
        classTypeId: studio.classTypeId,
        mainInstructorId: instructorId,
        locationId: studio.locationId,
        roomId: studio.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 10,
        creditCost: 1,
        createdByStaffId: instructorId,
      })
      .returning()
    return row!.id
  }

  /** A catalogue class package at `studio`. */
  const catalogPackage = async (studio: Studio, over: Partial<typeof schema.classPackages.$inferInsert> = {}) => {
    const [row] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: studio.id, name: 'Ten classes', kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '200.00', ...over })
      .returning()
    return row!
  }

  /**
   * A package a member holds, with no Purchase behind it — as an import writes
   * one. Running unless `over` says otherwise.
   */
  const heldPackage = async (studio: Studio, clientId: string, over: Partial<typeof schema.clientPackages.$inferInsert> = {}) => {
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: studio.id,
        clientId,
        kind: 'credit_bundle',
        validityDays: 90,
        creditsOrSessionsRemaining: 10,
        amountPaidSgd: '200.00',
        listPriceSgd: '200.00',
        purchaseId: null,
        expiresAt: new Date(Date.now() + 60 * 24 * HOUR),
        ...over,
      })
      .returning()
    return row!
  }

  /** A booking row written directly: history is the test's fixture, not the behaviour under test. */
  const bookingRow = async (studio: Studio, clientId: string, classId: string, clientPackageId: string | null, over: Partial<typeof schema.bookings.$inferInsert> = {}) => {
    const [row] = await harness.db
      .insert(schema.bookings)
      .values({
        tenantId: studio.id,
        clientId,
        kind: 'class',
        classId,
        clientPackageId,
        creditsOrSessionsUsed: 1,
        qrToken: randomUUID(),
        code: `C${randomUUID().slice(0, 8)}`,
        ...over,
      })
      .returning()
    return row!
  }

  /** Book a class as the member, through the booking app. */
  const book = (member: MemberFixture, classId: string) =>
    send('/me/bookings/class', { body: { class_id: classId }, headers: member.headers })

  const packageRow = async (id: string) =>
    (await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, id)))[0]!

  /** Every audit row the studio holds, oldest first. */
  const auditRowsAt = (studio: { id: string }) =>
    harness.db.select().from(schema.auditLog).where(eq(schema.auditLog.tenantId, studio.id)).orderBy(schema.auditLog.createdAt)

  /** The one audit row the middleware wrote for `method path` by `actor`, on `target`. */
  const expectAudit = async (
    studio: { id: string },
    actor: { id: string },
    action: string,
    target: { table: string; id: string },
  ) => {
    const rows = (await auditRowsAt(studio)).filter(r => r.action === action && r.actorStaffId === actor.id)
    assert.equal(rows.length, 1, `one audit row for ${action} by ${actor.id}: ${JSON.stringify(rows)}`)
    const row = rows[0]!
    assert.equal(row.tenantId, studio.id)
    assert.equal(row.actorType, 'staff')
    assert.equal(row.targetTable, target.table)
    assert.equal(row.targetId, target.id)
    return row
  }

  return {
    send,
    expectStatus,
    portalHeaders,
    memberHeaders,
    freshStudio,
    staffAt,
    memberAt,
    memberSignIn,
    classAt,
    catalogPackage,
    heldPackage,
    bookingRow,
    book,
    packageRow,
    auditRowsAt,
    expectAudit,
  }
}
