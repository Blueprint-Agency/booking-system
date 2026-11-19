import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
const DOMAIN = `${run}.finance-entity.test`
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Every fixture sits in a random stretch of the 1980s: finance.test.ts and
 * payroll.test.ts read the 1990s and 2000s, so no other file's rows fall inside
 * a window read here.
 */
const BASE = Date.UTC(1984, 0, 1) + Math.floor(Math.random() * 2000) * DAY
const at = (days: number, hours = 10) => new Date(BASE + days * DAY + hours * HOUR)
const span = (from: number, to: number) => ({ from: at(from, 0).toISOString(), to: at(to, 0).toISOString() })
const PERIOD = span(0, 30)
/** Held-ness of a session is read from the app's clock: inside PERIOD, after every session here. */
const NOW = at(25, 0)

type Line = {
  kind: string
  type: string
  id: string
  list_price_sgd: number | null
  paid_sgd: number | null
  complimentary: boolean
  instructor_id: string | null
  pay_sgd: number | null
  entity_id: string | null
  entity_name: string | null
}
type Totals = { gross_sgd: number; discounts_sgd: number; refunds_sgd: number; instructor_pay_sgd: number; net_sgd: number }
type Ledger = { rows: Line[]; totals: Totals; instructor_totals: unknown[]; unpriced_count: number }
type Overview = {
  totals: Totals
  unpriced_count: number
  sales_by_category: { category: string; gross_sgd: number; collected_sgd: number; count: number }[]
  by_instructor: unknown[]
  members: { active: number; joined: number }
  classes: { class_type_id: string; name: string; attended: number; previous: number | null }[]
}

const keyOf = (r: Line) => `${r.kind}:${r.id}:${r.instructor_id ?? ''}`
const sum = (values: (number | null)[]) => values.reduce<number>((s, v) => s + Math.round((v ?? 0) * 100), 0) / 100

/**
 * Finance by Entity over real HTTP: every Money Event is filed under an Entity
 * read live from the catalogue, and the list, the overview and the CSV narrow
 * to one together. A second studio's rows sit in the same window throughout.
 */
describe('Finance by Entity over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')

  type Studio = { id: string; slug: string; locationId: string; roomId: string }
  type Staff = { staffId: string; name: string; headers: Record<string, string> }
  type Member = { clientId: string; name: string }

  let one!: Studio
  let two!: Studio
  let admin!: Staff
  let tara!: Staff
  let omar!: Staff
  let adminAtTwo!: Staff
  let mia!: Member // live packages in both Entities
  let noor!: Member
  let pia!: Member
  let sol!: Member // live package with no catalogue source

  const entity = {} as { yoga: string; pilates: string; retired: string; yogaName: string; pilatesName: string }
  const catalogue = {} as {
    yogaBundle: string
    pilatesBundle: string
    pilatesUnlimited: string
    retiredBundle: string
    orphanEntityBundle: string // a class package that names no Entity
    yogaPt: string
    pilatesPt: string
    yogaCorporate: string
    pilatesCorporate: string
    yogaType: string
    pilatesType: string
    looseType: string // a class type that names no Entity
  }
  /** Studio one's fixtures, by what each one is. */
  const ids = {} as Record<string, string>
  let twoEntityId!: string
  let twoEntityName!: string
  let twoSale!: string

  const emailFor = (handle: string) => `${handle.toLowerCase().replace(/\s+/g, '-')}@${DOMAIN}`

  // ── fixtures ──────────────────────────────────────────────────────────────

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const [location] = await harness.db.select().from(schema.locations).where(eq(schema.locations.tenantId, tenant.id)).limit(1)
    assert.ok(location)
    const [room] = await harness.db.select().from(schema.rooms).where(eq(schema.rooms.locationId, location.id)).limit(1)
    assert.ok(room)
    return { ...tenant, locationId: location.id, roomId: room.id }
  }

  async function staff(at_: Studio, handle: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = emailFor(`${handle}-${at_.slug}`)
    const name = `${handle} ${run}`
    const headers = await harness.signInAs('staff', email, at_)
    const [authUser] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: at_.id, email, name, role, status: 'active', authUserId: authUser!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') await harness.db.insert(schema.instructors).values({ tenantId: at_.id, staffUserId: row!.id })
    return { staffId: row!.id, name, headers }
  }

  async function member(at_: Studio, handle: string): Promise<Member> {
    const name = `${handle} ${run}`
    const [row] = await harness.db
      .insert(schema.clients)
      .values({
        tenantId: at_.id,
        authUserId: `fin-entity-${randomUUID()}`,
        email: emailFor(`${handle}-${at_.slug}`),
        name,
        phone: '+6580000000',
      })
      .returning({ id: schema.clients.id })
    return { clientId: row!.id, name }
  }

  async function makeEntity(tenantId: string, name: string, position: number, archived = false) {
    const [row] = await harness.db
      .insert(schema.entities)
      .values({ tenantId, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), position, archivedAt: archived ? at(-1) : null })
      .returning({ id: schema.entities.id })
    return row!.id
  }

  async function classPackage(tenantId: string, name: string, entityId: string | null, kind: 'credit_bundle' | 'unlimited' = 'credit_bundle') {
    const [row] = await harness.db
      .insert(schema.classPackages)
      .values({
        tenantId,
        name: `${name} ${run}`,
        kind,
        credits: kind === 'credit_bundle' ? 10 : null,
        validityDays: kind === 'credit_bundle' ? 60 : null,
        durationMonths: kind === 'unlimited' ? 1 : null,
        priceSgd: '100.00',
        entityId,
      })
      .returning({ id: schema.classPackages.id })
    return row!.id
  }

  async function ptPackage(tenantId: string, name: string, entityId: string | null) {
    const [row] = await harness.db
      .insert(schema.ptPackages)
      .values({ tenantId, name: `${name} ${run}`, sessionType: '1on1', numSessions: 5, validityDays: 90, priceSgd: '400.00', entityId })
      .returning({ id: schema.ptPackages.id })
    return row!.id
  }

  async function corporatePackage(tenantId: string, name: string, entityId: string | null, createdBy: string) {
    const [row] = await harness.db
      .insert(schema.corporatePackages)
      .values({ tenantId, name: `${name} ${run}`, priceSgd: '900.00', createdByStaffId: createdBy, entityId })
      .returning({ id: schema.corporatePackages.id })
    return row!.id
  }

  async function classType(tenantId: string, name: string, entityId: string | null) {
    const [row] = await harness.db
      .insert(schema.classTypes)
      .values({ tenantId, name: `${name} ${run}`, entityId })
      .returning({ id: schema.classTypes.id })
    return row!.id as string
  }

  /** A held plan, bought `purchasedAt`. Names the catalogue package it was sold from, or none. */
  async function plan(
    tenantId: string,
    who: Member,
    purchasedAt: Date,
    list: string,
    opts: {
      classPackageId?: string
      ptPackageId?: string
      unlimited?: boolean
      addOn?: string
      purchaseId?: string
      active?: boolean
      locationId?: string
    } = {},
  ): Promise<string> {
    const unlimited = opts.unlimited === true
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId,
        clientId: who.clientId,
        kind: opts.ptPackageId ? 'pt' : unlimited ? 'unlimited' : 'credit_bundle',
        sourceClassPackageId: opts.classPackageId ?? null,
        sourcePtPackageId: opts.ptPackageId ?? null,
        locationId: unlimited ? opts.locationId! : null,
        durationMonths: unlimited ? 1 : null,
        validityDays: unlimited ? null : 60,
        crossLocationPaidSgd: opts.addOn ?? null,
        creditsOrSessionsRemaining: unlimited ? null : 10,
        purchaseId: opts.purchaseId ?? null,
        active: opts.active ?? true,
        purchasedAt,
        listPriceSgd: list,
        amountPaidSgd: list,
      })
      .returning({ id: schema.clientPackages.id })
    return row!.id
  }

  async function purchase(
    tenantId: string,
    who: Member,
    kind: 'class_package' | 'pt_package' | 'corporate_package' | 'cross_location_add_on' | 'workshop' | 'merch',
    amount: string,
    opts: { status?: 'paid' | 'refunded'; refundedAt?: Date; metadata?: Record<string, unknown>; createdAt: Date },
  ): Promise<string> {
    const [row] = await harness.db
      .insert(schema.purchases)
      .values({
        tenantId,
        clientId: who.clientId,
        kind,
        totalSgd: amount,
        amountPaidSgd: amount,
        status: opts.status ?? 'paid',
        settledAt: opts.createdAt,
        createdAt: opts.createdAt,
        refundedAt: opts.refundedAt ?? null,
        metadata: opts.metadata ?? {},
      })
      .returning({ id: schema.purchases.id })
    return row!.id
  }

  async function payment(
    tenantId: string,
    who: Member,
    purchaseId: string,
    kind: 'class_package' | 'pt_package' | 'corporate_package' | 'workshop' | 'merch',
    amount: string,
    paidAt: Date,
    opts: { refundedAt?: Date; clientPackageId?: string } = {},
  ): Promise<string> {
    const [row] = await harness.db
      .insert(schema.stripePayments)
      .values({
        tenantId,
        paymentIntentId: `pi_fe_${randomUUID().slice(0, 12)}`,
        purchaseId,
        amountSgd: amount,
        kind,
        clientId: who.clientId,
        clientPackageId: opts.clientPackageId ?? null,
        status: opts.refundedAt ? 'refunded' : 'succeeded',
        refundedAt: opts.refundedAt ?? null,
        createdAt: paidAt,
      })
      .returning({ id: schema.stripePayments.id })
    return row!.id
  }

  async function corporateRequest(tenantId: string, who: Member, corporatePackageId: string, purchaseId: string | null) {
    await harness.db.insert(schema.corporateRequests).values({ tenantId, clientId: who.clientId, corporatePackageId, purchaseId, status: 'pending' })
  }

  async function addClass(at_: Studio, teacher: Staff, classTypeId: string, startsAt: Date, pay: string | null) {
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at_.id,
        classTypeId,
        mainInstructorId: teacher.staffId,
        locationId: at_.locationId,
        roomId: at_.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 10,
        creditCost: 1,
        instructorPaySgd: pay,
        createdByStaffId: teacher.staffId,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  async function attend(at_: Studio, classId: string, who: Member) {
    await harness.db.insert(schema.bookings).values({
      tenantId: at_.id,
      clientId: who.clientId,
      kind: 'class',
      classId,
      creditsOrSessionsUsed: 1,
      checkInState: 'attended',
      state: 'confirmed',
      qrToken: `fe-${randomUUID()}`,
      code: `FE-${randomUUID().slice(0, 6).toUpperCase()}`,
    })
  }

  /** A PT session paid `pay` to `teacher`, whose request names `classTypeId` and `debited` as given. */
  async function addPt(
    teacher: Staff,
    who: Member,
    startsAt: Date,
    pay: string,
    opts: { classTypeId?: string; debitedClientPackageId?: string; origin?: 'member' | 'portal' } = {},
  ): Promise<string> {
    const [request] = await harness.db
      .insert(schema.ptRequests)
      .values({
        tenantId: one.id,
        clientId: who.clientId,
        classTypeId: opts.classTypeId ?? null,
        locationId: one.locationId,
        sessionType: '1on1',
        status: 'scheduled',
        origin: opts.origin ?? 'member',
        debitedClientPackageId: opts.debitedClientPackageId ?? null,
        expiresAt: opts.origin === 'portal' ? null : startsAt,
      })
      .returning({ id: schema.ptRequests.id })
    const [session] = await harness.db
      .insert(schema.ptSessions)
      .values({
        tenantId: one.id,
        ptRequestId: request!.id,
        instructorId: teacher.staffId,
        locationId: one.locationId,
        roomId: one.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        sessionType: '1on1',
        instructorPaySgd: pay,
        capacityOnline: 1,
        scheduledAt: new Date(startsAt.getTime() - DAY),
        scheduledByStaffId: admin.staffId,
      })
      .returning({ id: schema.ptSessions.id })
    return session!.id
  }

  // ── HTTP ─────────────────────────────────────────────────────────────────

  const url = (path: string, query: Record<string, string> = {}) => {
    const qs = new URLSearchParams(query).toString()
    return `/api/v1/portal/admin/finance${path}${qs ? `?${qs}` : ''}`
  }
  async function get(who: Staff, path: string, query: Record<string, string>) {
    const res = await harness.app.request(url(path, query), { headers: who.headers })
    return { status: res.status, text: await res.text() }
  }
  async function ledger(who: Staff, query: Record<string, string>): Promise<Ledger> {
    const res = await get(who, '', query)
    assert.equal(res.status, 200, res.text)
    return JSON.parse(res.text) as Ledger
  }
  async function overview(who: Staff, query: Record<string, string>): Promise<Overview> {
    const res = await get(who, '/overview', query)
    assert.equal(res.status, 200, res.text)
    return JSON.parse(res.text) as Overview
  }
  async function csv(who: Staff, query: Record<string, string>): Promise<{ columns: string[]; lines: Record<string, string>[] }> {
    const res = await get(who, '/export', query)
    assert.equal(res.status, 200, res.text)
    const [header, ...lines] = res.text.split('\r\n')
    const columns = header!.split(',')
    // No fixture name carries a comma or a quote, so a plain split is the parse.
    return { columns, lines: lines.map(line => Object.fromEntries(line.split(',').map((cell, i) => [columns[i]!, cell]))) }
  }

  /** The one row of `kind` for `id` (and `instructor`, where a session pays several). */
  const row = (l: Ledger, kind: string, id: string, instructor?: string) => {
    const found = l.rows.filter(r => r.kind === kind && r.id === id && (!instructor || r.instructor_id === instructor))
    assert.equal(found.length, 1, `one ${kind} row ${id}: ${JSON.stringify(found)}`)
    return found[0]!
  }
  const filed = (r: Line) => r.entity_name

  // ── setup ────────────────────────────────────────────────────────────────

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')

    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
    admin = await staff(one, 'Ada Admin', 'admin')
    tara = await staff(one, 'Tara Teacher', 'instructor')
    omar = await staff(one, 'Omar Other', 'instructor')
    adminAtTwo = await staff(two, 'Aki Admin', 'admin')
    mia = await member(one, 'Mia Member')
    noor = await member(one, 'Noor Member')
    pia = await member(one, 'Pia Member')
    sol = await member(one, 'Sol Member')
    const kai = await member(two, 'Kai Member')
    harness.clock.set(NOW)

    // -- the catalogue: two live Entities and a retired one -------------------
    entity.yogaName = `Yoga ${run}`
    entity.pilatesName = `Pilates ${run}`
    entity.yoga = await makeEntity(one.id, entity.yogaName, 100)
    entity.pilates = await makeEntity(one.id, entity.pilatesName, 101)
    entity.retired = await makeEntity(one.id, `Retired ${run}`, 102, true)
    catalogue.yogaBundle = await classPackage(one.id, 'Yoga bundle', entity.yoga)
    catalogue.pilatesBundle = await classPackage(one.id, 'Pilates bundle', entity.pilates)
    catalogue.pilatesUnlimited = await classPackage(one.id, 'Pilates unlimited', entity.pilates, 'unlimited')
    catalogue.retiredBundle = await classPackage(one.id, 'Retired bundle', entity.retired)
    catalogue.orphanEntityBundle = await classPackage(one.id, 'Loose bundle', null)
    catalogue.yogaPt = await ptPackage(one.id, 'Yoga private', entity.yoga)
    catalogue.pilatesPt = await ptPackage(one.id, 'Pilates private', entity.pilates)
    catalogue.yogaCorporate = await corporatePackage(one.id, 'Yoga team', entity.yoga, admin.staffId)
    catalogue.pilatesCorporate = await corporatePackage(one.id, 'Pilates team', entity.pilates, admin.staffId)
    catalogue.yogaType = await classType(one.id, 'Yoga type', entity.yoga)
    catalogue.pilatesType = await classType(one.id, 'Pilates type', entity.pilates)
    catalogue.looseType = await classType(one.id, 'Loose type', null)

    // -- package sales ---------------------------------------------------------
    ids.yogaSale = await plan(one.id, mia, at(2), '100.00', { classPackageId: catalogue.yogaBundle })
    ids.pilatesSale = await plan(one.id, mia, at(3), '200.00', { classPackageId: catalogue.pilatesBundle })
    ids.unlimitedSale = await plan(one.id, noor, at(4), '300.00', {
      classPackageId: catalogue.pilatesUnlimited,
      unlimited: true,
      locationId: one.locationId,
      addOn: '40.00',
    })
    ids.pilatesPtSale = await plan(one.id, noor, at(5), '400.00', { ptPackageId: catalogue.pilatesPt })
    ids.yogaPtSale = await plan(one.id, pia, at(5), '350.00', { ptPackageId: catalogue.yogaPt })
    ids.sourceless = await plan(one.id, sol, at(6), '60.00')
    ids.orphanEntitySale = await plan(one.id, sol, at(6), '70.00', { classPackageId: catalogue.orphanEntityBundle })
    ids.retiredSale = await plan(one.id, pia, at(7), '80.00', { classPackageId: catalogue.retiredBundle, active: false })

    // -- refunds -----------------------------------------------------------------
    // A payment-based refund of a Pilates plan: the plan names its own Purchase.
    const refundedPurchase = await purchase(one.id, noor, 'class_package', '150.00', {
      status: 'refunded',
      refundedAt: at(8),
      createdAt: at(7),
    })
    ids.refundedPlan = await plan(one.id, noor, at(7), '150.00', {
      classPackageId: catalogue.pilatesBundle,
      purchaseId: refundedPurchase,
      active: false,
    })
    ids.refundPayment = await payment(one.id, noor, refundedPurchase, 'class_package', '150.00', at(7), { refundedAt: at(8) })
    // A refund of a sale made before the studio came here: a Purchase with no payment behind it.
    ids.migratedPurchase = await purchase(one.id, pia, 'class_package', '90.00', { status: 'refunded', refundedAt: at(9), createdAt: at(9) })
    ids.migratedPlan = await plan(one.id, pia, at(1), '90.00', {
      classPackageId: catalogue.yogaBundle,
      purchaseId: ids.migratedPurchase,
      active: false,
    })
    // A standalone Cross-Location Add-On, refunded: its payment names the plan it was added to.
    const addOnPurchase = await purchase(one.id, noor, 'cross_location_add_on', '25.00', {
      status: 'refunded',
      refundedAt: at(10),
      createdAt: at(9),
    })
    ids.addOnRefundPayment = await payment(one.id, noor, addOnPurchase, 'class_package', '25.00', at(9), {
      refundedAt: at(10),
      clientPackageId: ids.unlimitedSale,
    })
    // A refunded sale of a plan that has since been deleted from the catalogue's reach: no source at all.
    const sourcelessPurchase = await purchase(one.id, sol, 'class_package', '55.00', { status: 'refunded', refundedAt: at(11), createdAt: at(10) })
    ids.sourcelessRefundPayment = await payment(one.id, sol, sourcelessPurchase, 'class_package', '55.00', at(10), { refundedAt: at(11) })
    await plan(one.id, sol, at(10), '55.00', { purchaseId: sourcelessPurchase, active: false })

    // -- corporate sales -------------------------------------------------------
    const linked = await purchase(one.id, noor, 'corporate_package', '500.00', { createdAt: at(12) })
    ids.linkedCorporate = await payment(one.id, noor, linked, 'corporate_package', '500.00', at(12))
    await corporateRequest(one.id, noor, catalogue.pilatesCorporate, linked)
    // A request made before the link existed: only the Purchase's metadata names the package.
    const legacy = await purchase(one.id, pia, 'corporate_package', '700.00', {
      createdAt: at(13),
      metadata: { package_id: catalogue.yogaCorporate },
    })
    ids.legacyCorporate = await payment(one.id, pia, legacy, 'corporate_package', '700.00', at(13))
    await corporateRequest(one.id, pia, catalogue.yogaCorporate, null)
    const refundedCorporate = await purchase(one.id, mia, 'corporate_package', '600.00', {
      status: 'refunded',
      refundedAt: at(15),
      createdAt: at(14),
    })
    ids.refundedCorporate = await payment(one.id, mia, refundedCorporate, 'corporate_package', '600.00', at(14), { refundedAt: at(15) })
    await corporateRequest(one.id, mia, catalogue.yogaCorporate, refundedCorporate)

    // -- workshop ticket, merch order, manual entry and workshop pay: no Entity ---
    const [workshop] = await harness.db
      .insert(schema.workshops)
      .values({ tenantId: one.id, name: `Entity workshop ${run}`, locationId: one.locationId, createdByStaffId: admin.staffId })
      .returning({ id: schema.workshops.id })
    ids.workshop = workshop!.id
    const [tier] = await harness.db
      .insert(schema.workshopTiers)
      .values({ tenantId: one.id, workshopId: ids.workshop, name: 'Full', regularPriceSgd: '90.00', ord: 1 })
      .returning({ id: schema.workshopTiers.id })
    const [day] = await harness.db
      .insert(schema.workshopDays)
      .values({
        tenantId: one.id,
        workshopId: ids.workshop,
        ord: 1,
        roomId: one.roomId,
        startsAt: at(16),
        endsAt: new Date(at(16).getTime() + 2 * HOUR),
        basePriceSgd: '90.00',
        capacityOnline: 10,
      })
      .returning({ id: schema.workshopDays.id })
    await harness.db.insert(schema.workshopTierDays).values({ tenantId: one.id, workshopTierId: tier!.id, workshopDayId: day!.id })
    await harness.db.insert(schema.workshopInstructors).values({ tenantId: one.id, workshopId: ids.workshop, instructorId: tara.staffId, role: 'main', paySgd: '120.00' })
    const [ticket] = await harness.db
      .insert(schema.bookings)
      .values({
        tenantId: one.id,
        clientId: noor.clientId,
        kind: 'workshop',
        workshopId: ids.workshop,
        workshopTierId: tier!.id,
        creditsOrSessionsUsed: 0,
        listPriceSgd: '90.00',
        amountPaidSgd: '90.00',
        bookedAt: at(5, 9),
        qrToken: `fe-${randomUUID()}`,
        code: `FW-${randomUUID().slice(0, 6).toUpperCase()}`,
      })
      .returning({ id: schema.bookings.id })
    ids.ticket = ticket!.id
    const [merch] = await harness.db
      .insert(schema.merchOrders)
      .values({ tenantId: one.id, clientId: mia.clientId, title: `Mat ${run}`, amountSgd: '25.00', stripePaymentIntentId: `pi_fe_${randomUUID().slice(0, 12)}`, createdAt: at(17) })
      .returning({ id: schema.merchOrders.id })
    ids.merch = merch!.id
    const [manual] = await harness.db
      .insert(schema.manualPayrollEntries)
      .values({ tenantId: one.id, instructorId: tara.staffId, amountSgd: '15.75', label: `Bonus ${run}`, entryDate: at(18), createdByStaffId: admin.staffId })
      .returning({ id: schema.manualPayrollEntries.id })
    ids.manual = manual!.id

    // -- class pay: the Class Type's Entity -------------------------------------
    ids.yogaClass = await addClass(one, tara, catalogue.yogaType, at(19), '40.00')
    await harness.db.insert(schema.classSupportingInstructors).values({ tenantId: one.id, classId: ids.yogaClass, instructorId: omar.staffId, paySgd: '20.00' })
    ids.pilatesClass = await addClass(one, tara, catalogue.pilatesType, at(20), '50.00')
    ids.looseClass = await addClass(one, tara, catalogue.looseType, at(21), '5.00')

    // -- PT pay ----------------------------------------------------------------
    // The request names a Class Type: its Entity.
    ids.ptByType = await addPt(omar, mia, at(19, 12), '30.00', { classTypeId: catalogue.pilatesType })
    // "Any" class type, debited a Yoga PT plan: the paying package's Entity.
    ids.ptByPackage = await addPt(omar, pia, at(20, 12), '25.00', { debitedClientPackageId: ids.yogaPtSale })
    // A manual session: no debit on the request, the attendee's booking names the package that paid.
    ids.ptManual = await addPt(omar, noor, at(21, 12), '35.00', { origin: 'portal' })
    await harness.db.insert(schema.bookings).values({
      tenantId: one.id,
      clientId: noor.clientId,
      kind: 'pt',
      ptSessionId: ids.ptManual,
      clientPackageId: ids.pilatesPtSale,
      creditsOrSessionsUsed: 1,
      qrToken: `fe-${randomUUID()}`,
      code: `FP-${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    // Nothing names an Entity.
    ids.ptNone = await addPt(omar, sol, at(22, 12), '10.00')

    // -- attendance: class popularity --------------------------------------------
    const earlier = await addClass(one, tara, catalogue.yogaType, at(-10), null)
    const yogaClassAttended = [pia, noor, mia]
    for (const who of yogaClassAttended) await attend(one, ids.yogaClass, who)
    await attend(one, earlier, mia)
    await attend(one, ids.pilatesClass, mia)
    await attend(one, ids.looseClass, sol)

    // -- studio two: one Entity of its own and a sale in the same window ---------
    twoEntityName = `Only Entity ${run}`
    twoEntityId = await makeEntity(two.id, twoEntityName, 100)
    const theirs = await classPackage(two.id, 'Their bundle', twoEntityId)
    twoSale = await plan(two.id, kai, at(2), '999.00', { classPackageId: theirs })
  })

  /**
   * Every row this file wrote, gone again. The two fixture studios are shared by
   * every other file on this database, and isolation.test.ts states studio
   * two's gross to the cent, so a sale left standing here is somebody else's
   * failure on the next run. Everything is found by the run's email domain or
   * the run's suffix on a name.
   */
  after(async () => {
    if (!harness) return
    harness.clock.reset()
    const ours = `%@${DOMAIN}`
    const suffix = `% ${run}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    const workshopIds = sql`SELECT id FROM workshops WHERE name LIKE ${suffix}`
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM manual_payroll_entries WHERE instructor_id IN (${staffIds}) OR created_by_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM workshop_tier_days WHERE workshop_tier_id IN (SELECT id FROM workshop_tiers WHERE workshop_id IN (${workshopIds}))`)
    await harness.db.execute(sql`DELETE FROM workshop_tiers WHERE workshop_id IN (${workshopIds})`)
    await harness.db.execute(sql`DELETE FROM workshop_days WHERE workshop_id IN (${workshopIds})`)
    await harness.db.execute(sql`DELETE FROM workshop_instructors WHERE workshop_id IN (${workshopIds})`)
    await harness.db.execute(sql`DELETE FROM workshops WHERE name LIKE ${suffix}`)
    await harness.db.execute(sql`DELETE FROM pt_sessions WHERE scheduled_by_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM pt_requests WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM class_supporting_instructors WHERE instructor_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM corporate_requests WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM stripe_payments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM receipts WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM merch_orders WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM corporate_packages WHERE name LIKE ${suffix}`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${suffix}`)
    await harness.db.execute(sql`DELETE FROM pt_packages WHERE name LIKE ${suffix}`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name LIKE ${suffix}`)
    await harness.db.execute(sql`DELETE FROM entities WHERE name LIKE ${suffix}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  // ── attribution ──────────────────────────────────────────────────────────

  test('FIN-59 a package sale, and the Add-On sold with it, are filed under the package\'s Entity', async () => {
    const l = await ledger(admin, PERIOD)
    assert.equal(filed(row(l, 'purchase', ids.yogaSale!)), entity.yogaName)
    assert.equal(row(l, 'purchase', ids.yogaSale!).entity_id, entity.yoga)
    assert.equal(filed(row(l, 'purchase', ids.pilatesSale!)), entity.pilatesName)
    assert.equal(filed(row(l, 'purchase', ids.unlimitedSale!)), entity.pilatesName)
    assert.equal(filed(row(l, 'addon', ids.unlimitedSale!)), entity.pilatesName)
    // A PT package reads its own table.
    assert.equal(filed(row(l, 'purchase', ids.pilatesPtSale!)), entity.pilatesName)
    assert.equal(filed(row(l, 'purchase', ids.yogaPtSale!)), entity.yogaName)
    // A sale from a package that names no Entity, and one with no package behind it at all.
    for (const id of [ids.sourceless!, ids.orphanEntitySale!]) {
      const r = row(l, 'purchase', id)
      assert.equal(r.entity_id, null)
      assert.equal(r.entity_name, null)
    }
    // A retired Entity still names its past sales.
    assert.equal(filed(row(l, 'purchase', ids.retiredSale!)), `Retired ${run}`)
  })

  test('FIN-60 a Refund is filed under the Entity of the plan its Purchase bought, however it reached the books', async () => {
    const l = await ledger(admin, PERIOD)
    // Through a payment, the plan naming its own Purchase.
    assert.equal(filed(row(l, 'refund', ids.refundPayment!)), entity.pilatesName)
    assert.equal(filed(row(l, 'purchase', ids.refundedPlan!)), entity.pilatesName, 'the sale it reverses stays with it')
    // A migrated sale: a Purchase with no payment.
    assert.equal(filed(row(l, 'refund', ids.migratedPurchase!)), entity.yogaName)
    // A standalone Add-On: its own Purchase has no plan, so its payment's plan answers.
    assert.equal(filed(row(l, 'refund', ids.addOnRefundPayment!)), entity.pilatesName)
    // A plan with no catalogue source.
    assert.equal(row(l, 'refund', ids.sourcelessRefundPayment!).entity_name, null)
  })

  test('FIN-61 a corporate sale and its Refund are filed under the corporate package\'s Entity, including one made before the request carried its Purchase', async () => {
    const l = await ledger(admin, PERIOD)
    assert.equal(filed(row(l, 'corporate', ids.linkedCorporate!)), entity.pilatesName)
    assert.equal(filed(row(l, 'corporate', ids.legacyCorporate!)), entity.yogaName)
    assert.equal(filed(row(l, 'corporate', ids.refundedCorporate!)), entity.yogaName)
    assert.equal(filed(row(l, 'refund', ids.refundedCorporate!)), entity.yogaName)
  })

  test('FIN-62 Class pay is filed under the Entity of the class\'s Class Type, for the main and the supporting instructor', async () => {
    const l = await ledger(admin, PERIOD)
    assert.equal(filed(row(l, 'instructor_pay', ids.yogaClass!, tara.staffId)), entity.yogaName)
    assert.equal(filed(row(l, 'instructor_pay', ids.yogaClass!, omar.staffId)), entity.yogaName)
    assert.equal(filed(row(l, 'instructor_pay', ids.pilatesClass!, tara.staffId)), entity.pilatesName)
    assert.equal(row(l, 'instructor_pay', ids.looseClass!, tara.staffId).entity_name, null)
  })

  test('FIN-63 PT session pay is filed under its request\'s Class Type, else the paying package\'s Entity', async () => {
    const l = await ledger(admin, PERIOD)
    assert.equal(filed(row(l, 'instructor_pay', ids.ptByType!)), entity.pilatesName)
    assert.equal(filed(row(l, 'instructor_pay', ids.ptByPackage!)), entity.yogaName)
    assert.equal(filed(row(l, 'instructor_pay', ids.ptManual!)), entity.pilatesName, 'a manual session: the attendee\'s package')
    assert.equal(row(l, 'instructor_pay', ids.ptNone!).entity_name, null)
  })

  test('FIN-64 workshops, merch and manual entries are filed under no Entity, and `none` returns them with the other unfiled rows', async () => {
    const all = await ledger(admin, PERIOD)
    for (const [kind, id] of [
      ['workshop_ticket', ids.ticket],
      ['merch', ids.merch],
      ['manual', ids.manual],
      ['instructor_pay', ids.workshop],
    ] as const) {
      assert.equal(row(all, kind, id!).entity_id, null, kind)
    }
    const none = await ledger(admin, { ...PERIOD, entity: 'none' })
    const keys = new Set(none.rows.map(keyOf))
    for (const [kind, id] of [
      ['workshop_ticket', ids.ticket],
      ['merch', ids.merch],
      ['manual', ids.manual],
    ] as const) {
      assert.ok(keys.has(`${kind}:${id}:${kind === 'manual' ? tara.staffId : ''}`), `${kind} is under none`)
    }
    assert.ok(keys.has(`purchase:${ids.sourceless}:`))
    assert.ok(!keys.has(`purchase:${ids.yogaSale}:`))
    assert.ok(none.rows.every(r => r.entity_id == null))
  })

  // ── the filter ───────────────────────────────────────────────────────────

  test('FIN-65 every row is under exactly one Entity filter, and the overview agrees with the list under each', async () => {
    const everything = await ledger(admin, PERIOD)
    const seen = new Map<string, number>()
    for (const entityParam of [entity.yoga, entity.pilates, entity.retired, 'none']) {
      const l = await ledger(admin, { ...PERIOD, entity: entityParam })
      assert.ok(l.rows.length > 0, entityParam)
      for (const r of l.rows) seen.set(keyOf(r), (seen.get(keyOf(r)) ?? 0) + 1)

      const o = await overview(admin, { ...PERIOD, entity: entityParam })
      assert.deepEqual(o.totals, l.totals, `${entityParam}: tiles`)
      assert.equal(o.unpriced_count, l.unpriced_count)
      assert.deepEqual(o.by_instructor, l.instructor_totals)
      // The same rows, regrouped: the categories sum to the Gross tile.
      assert.equal(sum(o.sales_by_category.map(c => c.gross_sgd)), o.totals.gross_sgd, entityParam)
    }
    assert.equal(seen.size, everything.rows.length, 'every row is under some filter')
    assert.ok([...seen.values()].every(n => n === 1), 'and under only one')

    // A concrete figure: Pilates money in is 200 + 300 + 40 + 400 + 150 (the refunded sale) + 500; refunds 150 + 25.
    const pilates = await ledger(admin, { ...PERIOD, entity: entity.pilates })
    assert.equal(pilates.totals.gross_sgd, 1590)
    assert.equal(pilates.totals.refunds_sgd, 175)
    // Class pay 50 + PT pay 30 + 35.
    assert.equal(pilates.totals.instructor_pay_sgd, 115)
  })

  test('FIN-66 the CSV has an Entity column after Location, and holds exactly the filtered screen rows', async () => {
    const plain = await csv(admin, PERIOD)
    assert.equal(plain.columns.indexOf('entity'), plain.columns.indexOf('location') + 1)
    for (const filter of [{}, { entity: entity.yoga }, { entity: entity.pilates }, { entity: 'none' }] as Record<string, string>[]) {
      const query = { ...PERIOD, ...filter }
      const screen = await ledger(admin, query)
      const file = await csv(admin, query)
      assert.equal(file.lines.length, screen.rows.length, JSON.stringify(filter))
      screen.rows.forEach((r, i) => {
        assert.equal(file.lines[i]!.type, r.type)
        assert.equal(file.lines[i]!.entity, r.entity_name ?? 'No entity')
      })
    }
    const none = await csv(admin, { ...PERIOD, entity: 'none' })
    assert.ok(none.lines.every(line => line.entity === 'No entity'))
  })

  test('FIN-67 moving a package to another Entity re-files its past sales', async () => {
    const [moved] = await harness.db
      .insert(schema.classPackages)
      .values({
        tenantId: one.id,
        name: `Moving bundle ${run}`,
        kind: 'credit_bundle',
        credits: 5,
        validityDays: 30,
        priceSgd: '10.00',
        entityId: entity.yoga,
      })
      .returning({ id: schema.classPackages.id })
    const sale = await plan(one.id, pia, at(23), '10.00', { classPackageId: moved!.id })
    assert.equal(filed(row(await ledger(admin, PERIOD), 'purchase', sale)), entity.yogaName)

    await harness.db.update(schema.classPackages).set({ entityId: entity.pilates }).where(eq(schema.classPackages.id, moved!.id))
    assert.equal(filed(row(await ledger(admin, PERIOD), 'purchase', sale)), entity.pilatesName)
    const pilates = await ledger(admin, { ...PERIOD, entity: entity.pilates })
    assert.ok(pilates.rows.some(r => r.id === sale))
    const yoga = await ledger(admin, { ...PERIOD, entity: entity.yoga })
    assert.ok(!yoga.rows.some(r => r.id === sale))
  })

  // ── the overview's members and class popularity ───────────────────────────

  test('FIN-68 Active Members under an Entity counts members holding a live package of it: a member of two counts under each and once overall', async () => {
    const before_ = {
      all: (await overview(admin, PERIOD)).members.active,
      yoga: (await overview(admin, { ...PERIOD, entity: entity.yoga })).members.active,
      pilates: (await overview(admin, { ...PERIOD, entity: entity.pilates })).members.active,
      none: (await overview(admin, { ...PERIOD, entity: 'none' })).members.active,
    }
    // Mia (Yoga + Pilates) and Pia (Yoga PT) hold Yoga; Mia and Noor hold Pilates; Sol holds only sourceless plans.
    // Pia's retired-Entity plan is inactive. Pia's refunded sale is inactive; Mia's moved-from package is not Mia's.
    assert.ok(before_.yoga >= 2 && before_.pilates >= 2 && before_.none >= 1)

    const dual = await member(one, 'Dual Holder')
    await plan(one.id, dual, at(24), '10.00', { classPackageId: catalogue.yogaBundle })
    await plan(one.id, dual, at(24), '10.00', { classPackageId: catalogue.pilatesBundle })
    assert.equal((await overview(admin, PERIOD)).members.active, before_.all + 1, 'once for the studio, the same query as before')
    assert.equal((await overview(admin, { ...PERIOD, entity: entity.yoga })).members.active, before_.yoga + 1)
    assert.equal((await overview(admin, { ...PERIOD, entity: entity.pilates })).members.active, before_.pilates + 1)
    assert.equal((await overview(admin, { ...PERIOD, entity: 'none' })).members.active, before_.none)

    // A member holding a live package with no catalogue source is in the studio number and under no Entity.
    const loose = await member(one, 'Loose Holder')
    await plan(one.id, loose, at(24), '10.00')
    assert.equal((await overview(admin, PERIOD)).members.active, before_.all + 2)
    assert.equal((await overview(admin, { ...PERIOD, entity: 'none' })).members.active, before_.none + 1)
    assert.equal((await overview(admin, { ...PERIOD, entity: entity.yoga })).members.active, before_.yoga + 1)
  })

  test('FIN-69 Class Popularity under an Entity counts only that Entity\'s Class Types, against the window before', async () => {
    const all = await overview(admin, PERIOD)
    const mine = (o: Overview) => o.classes.filter(c => [catalogue.yogaType, catalogue.pilatesType, catalogue.looseType].includes(c.class_type_id))
    assert.deepEqual(
      mine(all).map(c => [c.class_type_id, c.attended, c.previous]).sort(),
      [
        [catalogue.yogaType, 3, 1],
        [catalogue.pilatesType, 1, 0],
        [catalogue.looseType, 1, 0],
      ].sort(),
    )
    const yoga = await overview(admin, { ...PERIOD, entity: entity.yoga })
    assert.deepEqual(yoga.classes.map(c => [c.class_type_id, c.attended, c.previous]), [[catalogue.yogaType, 3, 1]])
    const pilates = await overview(admin, { ...PERIOD, entity: entity.pilates })
    assert.deepEqual(pilates.classes.map(c => [c.class_type_id, c.attended, c.previous]), [[catalogue.pilatesType, 1, 0]])
    const none = await overview(admin, { ...PERIOD, entity: 'none' })
    assert.deepEqual(none.classes.map(c => c.class_type_id), [catalogue.looseType])
  })

  // ── access and isolation ────────────────────────────────────────────────

  test('FIN-70 an Instructor is refused the Entity filter on the list, the overview and the export, as they are without it', async () => {
    for (const path of ['', '/overview', '/export']) {
      const res = await get(tara, path, { ...PERIOD, entity: entity.yoga })
      assert.equal(res.status, 403, path)
    }
  })

  test('FIN-71 an Entity id that is archived still filters, and a malformed one is refused', async () => {
    const retired = await ledger(admin, { ...PERIOD, entity: entity.retired })
    assert.deepEqual(retired.rows.map(r => r.id), [ids.retiredSale])
    const res = await get(admin, '', { ...PERIOD, entity: 'not-an-entity' })
    assert.equal(res.status, 400)
  })

  test('FIN-72 another studio\'s Entity matches nothing here, and this studio\'s rows never reach theirs', async () => {
    const theirs = await ledger(admin, { ...PERIOD, entity: twoEntityId })
    assert.deepEqual(theirs.rows, [])
    assert.equal(theirs.totals.gross_sgd, 0)
    assert.equal((await overview(admin, { ...PERIOD, entity: twoEntityId })).members.active, 0)
    assert.deepEqual((await csv(admin, { ...PERIOD, entity: twoEntityId })).lines, [])

    // Their own Entity narrows to their own sale, named; ours finds nothing there.
    const own = await ledger(adminAtTwo, { ...PERIOD, entity: twoEntityId })
    assert.deepEqual(own.rows.map(r => [r.id, r.entity_name]), [[twoSale, twoEntityName]])
    assert.deepEqual((await ledger(adminAtTwo, { ...PERIOD, entity: entity.yoga })).rows, [])
    assert.ok(!(await ledger(adminAtTwo, PERIOD)).rows.some(r => r.entity_id === entity.yoga))
  })
})
