import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
const DOMAIN = `${run}.finance.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `Finance class type ${run}`
const WORKSHOP_NAME = `Finance workshop ${run}`
const SECOND_LOCATION_NAME = `Finance annex ${run}`
const PROMO_CODE = `FIN${run}`.toUpperCase()
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Every fixture sits in a random stretch of the 1990s, so no other file's rows
 * (which sit around "now", or in payroll.test.ts's 2000s) fall inside a window
 * read here, and two runs of this file are unlikely to share one.
 */
const BASE = Date.UTC(1994, 0, 1) + Math.floor(Math.random() * 2000) * DAY
const at = (days: number, hours = 10) => new Date(BASE + days * DAY + hours * HOUR)
const span = (from: number, to: number) => ({ from: at(from, 0).toISOString(), to: at(to, 0).toISOString() })

/** The month every read-only test reads. Nothing in it is ever written after `before`. */
const PERIOD = span(0, 30)
/** The month after it, where the Refund of a purchase made in PERIOD lands. */
const NEXT = span(30, 60)
/** Each writing test gets a window of its own, so no test moves another's figures. */
const PRICING = span(-60, -30)
const DELETING = span(-90, -60)
const PAGING = span(-120, -90)
const EDITING = span(-150, -120)
/** What the app thinks "now" is: inside PERIOD, so a session later in it has not been held yet. */
const NOW = at(20, 0)

type Line = {
  kind: string
  type: string
  id: string
  occurred_at: string
  variant: string | null
  user_name: string | null
  location_id: string | null
  location_name: string | null
  unattributed: boolean
  list_price_sgd: number | null
  paid_sgd: number | null
  discount_sgd: number | null
  promo_code: string | null
  refunded: boolean
  complimentary: boolean
  instructor_id: string | null
  pay_sgd: number | null
  unpriced: boolean
  editable: boolean
}
type Totals = {
  gross_sgd: number
  discounts_sgd: number
  refunds_sgd: number
  instructor_pay_sgd: number
  net_sgd: number
}
type Ledger = {
  rows: Line[]
  totals: Totals
  instructor_totals: { instructor_id: string; instructor_name: string; total_sgd: number; session_count: number }[]
  unpriced_count: number
}
type Overview = {
  totals: Totals
  unpriced_count: number
  sales_by_category: { category: string; gross_sgd: number; collected_sgd: number; count: number }[]
  by_instructor: Ledger['instructor_totals']
  members: { active: number; joined: number }
  classes: { class_type_id: string; name: string; attended: number; previous: number | null }[]
}

/** Sum of money figures, in cents, the way a bookkeeper's spreadsheet should. */
const sum = (values: (number | null)[]) => values.reduce<number>((s, v) => s + Math.round((v ?? 0) * 100), 0) / 100

/**
 * The admin's Finance page over real HTTP (#266): the ledger, the overview and
 * the CSV export, the pay writes it offers, and the refusals around them —
 * with a second studio's Money Events in the same month throughout, so a read
 * that forgot its Tenant has something to be visibly wrong about.
 */
describe('Finance over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let classTypesSvc!: typeof import('../services/catalog/class-types')

  type Studio = { id: string; slug: string; locationId: string; locationName: string; roomId: string; classTypeId: string }
  type Staff = { staffId: string; name: string; headers: Record<string, string> }
  type Member = { clientId: string; name: string }

  let one!: Studio
  let two!: Studio
  let annex!: { id: string; name: string; roomId: string } // studio one's second Location
  let adminAtOne!: Staff
  let tara!: Staff // instructor at one
  let omar!: Staff // instructor at one
  let adminAtTwo!: Staff
  let teacherAtTwo!: Staff
  let mia!: Member
  let noor!: Member
  let kai!: Member // studio two's member

  /** Studio one's fixtures. */
  const ids = {} as {
    creditSale: string // Mia, credit bundle, 180.00 list / 150.00 paid, Promo Code
    unlimited: string // Mia, Unlimited at Location A, 250.00, with a 40.00 Add-On
    ticket: string // Noor, workshop ticket at the annex, 90.00 / 81.00
    corporate: string // Noor, corporate sale 500.00, refunded inside PERIOD
    freeMerch: string // Mia, a free item: 0.00, no payment
    paidMerch: string // Noor, 25.00
    refundedSale: string // Noor, credit bundle 120.00, refunded in NEXT
    refundedPayment: string
    comp: string // Mia, a Complimentary Package, 60.00 list
    outsideSale: string // Noor, before PERIOD
    shared: string // Tara main 45.50, Omar supporting 20.25, at Location A
    unpriced: string // Tara, no pay yet
    cancelled: string // Tara 77.00, cancelled
    notYetHeld: string // Tara 55.00, after NOW
    pt: string // Omar PT 30.00 at Location A
    ptNotYetHeld: string
    ptCancelled: string
    workshop: string // two days at the annex; Tara main 120.00, Omar supporting 60.00
    manual: string // Tara, 15.75, added over HTTP
    outsideClass: string // Tara 99.00, before PERIOD
    previousClass: string // the window before PERIOD, one attendance
    pricing: string // PRICING's class, Tara main + Omar supporting, both Unpriced
    editClass: string // EDITING's class, Tara 10.00
    editManual: string // EDITING's Manual Entry, Omar 5.00
  }
  /** Studio two's fixtures, in the same PERIOD. */
  const theirs = {} as { sale: string; refundedSale: string; refundedPayment: string; merch: string; class: string; manual: string }

  const emailFor = (handle: string) => `${handle.toLowerCase().replace(/\s+/g, '-')}@${DOMAIN}`

  // ── fixtures ──────────────────────────────────────────────────────────────

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const [location] = await harness.db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.tenantId, tenant.id))
      .limit(1)
    assert.ok(location, `expected a seeded location for ${tenant.slug}`)
    const [room] = await harness.db.select().from(schema.rooms).where(eq(schema.rooms.locationId, location.id)).limit(1)
    assert.ok(room, `expected a seeded room for ${tenant.slug}`)
    const classType = await classTypesSvc.createClassType(tenant.id, { name: CLASS_TYPE_NAME })
    return { ...tenant, locationId: location.id, locationName: location.name, roomId: room.id, classTypeId: classType.id }
  }

  async function staff(at: Studio, handle: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = emailFor(`${handle}-${at.slug}`)
    const name = `${handle} ${run}`
    const headers = await harness.signInAs('staff', email, at)
    const [authUser] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: at.id, email, name, role, status: 'active', authUserId: authUser!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: at.id, staffUserId: row!.id })
    }
    return { staffId: row!.id, name, headers }
  }

  async function member(at: Studio, handle: string, joinedAt?: Date): Promise<Member> {
    const name = `${handle} ${run}`
    const [row] = await harness.db
      .insert(schema.clients)
      .values({
        tenantId: at.id,
        authUserId: `finance-${randomUUID()}`,
        email: emailFor(`${handle}-${at.slug}`),
        name,
        phone: '+6580000000',
        ...(joinedAt ? { joinedAt } : {}),
      })
      .returning({ id: schema.clients.id })
    return { clientId: row!.id, name }
  }

  /** A package sale, dated `purchasedAt`. A credit bundle unless told otherwise. */
  async function sale(
    at: Studio,
    who: Member,
    purchasedAt: Date,
    list: string,
    paid: string,
    opts: {
      kind?: 'credit_bundle' | 'unlimited'
      locationId?: string
      addOn?: string
      promoCodeId?: string
      complimentary?: boolean
      purchaseId?: string
      active?: boolean
      expiresAt?: Date
    } = {},
  ): Promise<string> {
    const unlimited = opts.kind === 'unlimited'
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        kind: opts.kind ?? 'credit_bundle',
        locationId: unlimited ? (opts.locationId ?? at.locationId) : null,
        durationMonths: unlimited ? 1 : null,
        validityDays: unlimited ? null : 30,
        crossLocationPaidSgd: opts.addOn ?? null,
        creditsOrSessionsRemaining: unlimited ? null : 10,
        appliedPromoCodeId: opts.promoCodeId ?? null,
        complimentary: opts.complimentary ?? false,
        purchaseId: opts.purchaseId ?? null,
        active: opts.active ?? true,
        expiresAt: opts.expiresAt ?? null,
        purchasedAt,
        listPriceSgd: list,
        amountPaidSgd: paid,
      })
      .returning({ id: schema.clientPackages.id })
    return row!.id
  }

  /** A settled sale that was then refunded through its payment on `refundedAt`. */
  async function refundedPayment(
    at: Studio,
    who: Member,
    opts: { kind: 'class_package' | 'corporate_package'; amount: string; paidAt: Date; refundedAt: Date },
  ): Promise<{ purchaseId: string; paymentId: string }> {
    const [purchase] = await harness.db
      .insert(schema.purchases)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        kind: opts.kind,
        totalSgd: opts.amount,
        amountPaidSgd: opts.amount,
        status: 'refunded',
        settledAt: opts.paidAt,
        createdAt: opts.paidAt,
      })
      .returning({ id: schema.purchases.id })
    const [payment] = await harness.db
      .insert(schema.stripePayments)
      .values({
        tenantId: at.id,
        paymentIntentId: `pi_fin_${randomUUID().slice(0, 12)}`,
        purchaseId: purchase!.id,
        amountSgd: opts.amount,
        kind: opts.kind,
        clientId: who.clientId,
        status: 'refunded',
        refundedAt: opts.refundedAt,
        createdAt: opts.paidAt,
      })
      .returning({ id: schema.stripePayments.id })
    return { purchaseId: purchase!.id, paymentId: payment!.id }
  }

  async function merchOrder(at: Studio, who: Member, title: string, amount: string, createdAt: Date, paid: boolean) {
    const [row] = await harness.db
      .insert(schema.merchOrders)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        title: `${title} ${run}`,
        amountSgd: amount,
        stripePaymentIntentId: paid ? `pi_fin_${randomUUID().slice(0, 12)}` : null,
        createdAt,
      })
      .returning({ id: schema.merchOrders.id })
    return row!.id
  }

  /** A class inserted directly — held once it ends before NOW. */
  async function addClass(
    at: Studio,
    teacher: Staff,
    startsAt: Date,
    opts: { pay?: string | null; lifecycle?: 'active' | 'cancelled'; locationId?: string; roomId?: string } = {},
  ): Promise<string> {
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId: at.classTypeId,
        mainInstructorId: teacher.staffId,
        locationId: opts.locationId ?? at.locationId,
        roomId: opts.roomId ?? at.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 10,
        creditCost: 1,
        instructorPaySgd: opts.pay ?? null,
        lifecycle: opts.lifecycle ?? 'active',
        createdByStaffId: teacher.staffId,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  async function supporting(at: Studio, classId: string, teacher: Staff, pay: string | null) {
    await harness.db
      .insert(schema.classSupportingInstructors)
      .values({ tenantId: at.id, classId, instructorId: teacher.staffId, paySgd: pay })
  }

  async function classBooking(at: Studio, classId: string, who: Member, checkInState: 'attended' | 'no_show') {
    await harness.db.insert(schema.bookings).values({
      tenantId: at.id,
      clientId: who.clientId,
      kind: 'class',
      classId,
      creditsOrSessionsUsed: 1,
      checkInState,
      state: checkInState === 'no_show' ? 'no_show' : 'confirmed',
      qrToken: `fin-${randomUUID()}`,
      code: `FN-${randomUUID().slice(0, 6).toUpperCase()}`,
    })
  }

  async function addPt(
    at: Studio,
    teacher: Staff,
    who: Member,
    startsAt: Date,
    pay: string,
    lifecycle: 'active' | 'cancelled' = 'active',
  ): Promise<string> {
    const [request] = await harness.db
      .insert(schema.ptRequests)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        classTypeId: at.classTypeId,
        locationId: at.locationId,
        sessionType: '1on1',
        status: 'scheduled',
        expiresAt: startsAt,
      })
      .returning({ id: schema.ptRequests.id })
    const [pt] = await harness.db
      .insert(schema.ptSessions)
      .values({
        tenantId: at.id,
        ptRequestId: request!.id,
        instructorId: teacher.staffId,
        locationId: at.locationId,
        roomId: at.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        sessionType: '1on1',
        instructorPaySgd: pay,
        lifecycle,
        capacityOnline: 1,
        scheduledAt: new Date(startsAt.getTime() - DAY),
        scheduledByStaffId: adminAtOne.staffId,
      })
      .returning({ id: schema.ptSessions.id })
    return pt!.id
  }

  // ── HTTP ─────────────────────────────────────────────────────────────────

  const url = (path: string, query: Record<string, string> = {}) => {
    const qs = new URLSearchParams(query).toString()
    return `/api/v1/portal/admin/finance${path}${qs ? `?${qs}` : ''}`
  }

  async function get(who: Staff, path: string, query: Record<string, string>) {
    const res = await harness.app.request(url(path, query), { headers: who.headers })
    return { status: res.status, text: await res.text(), type: res.headers.get('content-type') }
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

  async function csv(who: Staff, query: Record<string, string>): Promise<Record<string, string>[]> {
    const res = await get(who, '/export', query)
    assert.equal(res.status, 200, res.text)
    assert.match(res.type ?? '', /^text\/csv/)
    const [header, ...lines] = res.text.split('\r\n')
    const columns = header!.split(',')
    // No fixture name, title or label carries a comma or a quote, so a plain split is the parse.
    return lines.map(line => Object.fromEntries(line.split(',').map((cell, i) => [columns[i]!, cell])))
  }

  async function send(who: Staff, method: string, path: string, body?: unknown) {
    const res = await harness.app.request(url(path), {
      method,
      headers: { ...who.headers, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: (text ? JSON.parse(text) : null) as any }
  }

  const postManual = (who: Staff, body: Record<string, unknown>) => send(who, 'POST', '/manual', body)

  const idsOf = (rows: Line[]) => rows.map(r => r.id).sort()
  const rowsOf = (l: Ledger, id: string) => l.rows.filter(r => r.id === id)
  const one_ = (l: Ledger, id: string, kind?: string) => {
    const found = l.rows.filter(r => r.id === id && (!kind || r.kind === kind))
    assert.equal(found.length, 1, `one ${kind ?? ''} row ${id}: ${JSON.stringify(found)}`)
    return found[0]!
  }

  const manualRow = async (id: string) =>
    (await harness.db.select().from(schema.manualPayrollEntries).where(eq(schema.manualPayrollEntries.id, id)))[0]
  const classPay = async (id: string) =>
    (await harness.db.select({ pay: schema.classes.instructorPaySgd }).from(schema.classes).where(eq(schema.classes.id, id)))[0]?.pay

  // ── setup ────────────────────────────────────────────────────────────────

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))

    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
    const [annexRow] = await harness.db
      .insert(schema.locations)
      .values({ tenantId: one.id, name: SECOND_LOCATION_NAME })
      .returning({ id: schema.locations.id })
    const [annexRoom] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: one.id, locationId: annexRow!.id, name: `Annex room ${run}`, capacity: 20 })
      .returning({ id: schema.rooms.id })
    annex = { id: annexRow!.id, name: SECOND_LOCATION_NAME, roomId: annexRoom!.id }

    adminAtOne = await staff(one, 'Ada Admin', 'admin')
    tara = await staff(one, 'Tara Teacher', 'instructor')
    omar = await staff(one, 'Omar Other', 'instructor')
    adminAtTwo = await staff(two, 'Aki Admin', 'admin')
    teacherAtTwo = await staff(two, 'Tomo Teacher', 'instructor')
    mia = await member(one, 'Mia Member')
    noor = await member(one, 'Noor Member')
    kai = await member(two, 'Kai Member', at(3))

    harness.clock.set(NOW)

    // -- studio one, money in, PERIOD ---------------------------------------
    const [code] = await harness.db
      .insert(schema.promoCodes)
      .values({
        tenantId: one.id,
        code: PROMO_CODE,
        label: `Finance code ${run}`,
        kind: 'amount',
        amountOffSgd: '30.00',
        appliesToAll: true,
        createdByStaffId: adminAtOne.staffId,
      })
      .returning({ id: schema.promoCodes.id })
    ids.creditSale = await sale(one, mia, at(2, 9), '180.00', '150.00', { promoCodeId: code!.id })
    ids.unlimited = await sale(one, mia, at(4, 9), '250.00', '250.00', { kind: 'unlimited', addOn: '40.00' })

    const [workshop] = await harness.db
      .insert(schema.workshops)
      .values({ tenantId: one.id, name: WORKSHOP_NAME, locationId: annex.id, createdByStaffId: adminAtOne.staffId })
      .returning({ id: schema.workshops.id })
    ids.workshop = workshop!.id
    const [tier] = await harness.db
      .insert(schema.workshopTiers)
      .values({ tenantId: one.id, workshopId: ids.workshop, name: 'Full', regularPriceSgd: '90.00', ord: 1 })
      .returning({ id: schema.workshopTiers.id })
    for (const [ord, day] of [[1, 12], [2, 13]] as const) {
      const [row] = await harness.db
        .insert(schema.workshopDays)
        .values({
          tenantId: one.id,
          workshopId: ids.workshop,
          ord,
          roomId: annex.roomId,
          startsAt: at(day),
          endsAt: new Date(at(day).getTime() + 2 * HOUR),
          basePriceSgd: '45.00',
          capacityOnline: 10,
        })
        .returning({ id: schema.workshopDays.id })
      await harness.db.insert(schema.workshopTierDays).values({ tenantId: one.id, workshopTierId: tier!.id, workshopDayId: row!.id })
    }
    await harness.db.insert(schema.workshopInstructors).values([
      { tenantId: one.id, workshopId: ids.workshop, instructorId: tara.staffId, role: 'main', paySgd: '120.00' },
      { tenantId: one.id, workshopId: ids.workshop, instructorId: omar.staffId, role: 'supporting', paySgd: '60.00' },
    ])
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
        amountPaidSgd: '81.00',
        bookedAt: at(5, 9),
        qrToken: `fin-${randomUUID()}`,
        code: `FW-${randomUUID().slice(0, 6).toUpperCase()}`,
      })
      .returning({ id: schema.bookings.id })
    ids.ticket = ticket!.id

    ids.corporate = (
      await refundedPayment(one, noor, { kind: 'corporate_package', amount: '500.00', paidAt: at(6, 9), refundedAt: at(8, 9) })
    ).paymentId
    ids.freeMerch = await merchOrder(one, mia, 'Free tote', '0.00', at(7, 9), false)
    ids.paidMerch = await merchOrder(one, noor, 'Water bottle', '25.00', at(7, 11), true)
    const refunded = await refundedPayment(one, noor, {
      kind: 'class_package',
      amount: '120.00',
      paidAt: at(9, 9),
      refundedAt: at(40, 9),
    })
    ids.refundedPayment = refunded.paymentId
    ids.refundedSale = await sale(one, noor, at(9, 9), '120.00', '120.00', { purchaseId: refunded.purchaseId })
    ids.comp = await sale(one, mia, at(10, 9), '60.00', '0.00', { complimentary: true })
    ids.outsideSale = await sale(one, noor, at(-5, 9), '999.00', '999.00')

    // -- studio one, money out, PERIOD --------------------------------------
    ids.shared = await addClass(one, tara, at(11), { pay: '45.50' })
    await supporting(one, ids.shared, omar, '20.25')
    ids.unpriced = await addClass(one, tara, at(14), { pay: null })
    ids.cancelled = await addClass(one, tara, at(15), { pay: '77.00', lifecycle: 'cancelled' })
    ids.notYetHeld = await addClass(one, tara, at(25), { pay: '55.00' })
    ids.pt = await addPt(one, omar, noor, at(16), '30.00')
    ids.ptNotYetHeld = await addPt(one, omar, noor, at(27), '33.00')
    ids.ptCancelled = await addPt(one, omar, noor, at(17), '34.00', 'cancelled')
    ids.outsideClass = await addClass(one, tara, at(-3), { pay: '99.00' })
    const manual = await postManual(adminAtOne, {
      instructor_id: tara.staffId,
      amount_sgd: 15.75,
      label: `Retreat bonus ${run}`,
      entry_date: at(18).toISOString(),
    })
    assert.equal(manual.status, 201, JSON.stringify(manual.body))
    ids.manual = manual.body.id

    // -- attendance: three check-ins in PERIOD, one in the window before -----
    const early = await member(one, 'Early Joiner', at(3))
    await member(one, 'Late Joiner', at(45))
    await member(one, 'Prior Joiner', at(-2))
    await classBooking(one, ids.shared, mia, 'attended')
    await classBooking(one, ids.shared, noor, 'attended')
    await classBooking(one, ids.shared, early, 'attended')
    await classBooking(one, ids.unpriced, noor, 'no_show')
    ids.previousClass = await addClass(one, tara, at(-10), { pay: '10.00' })
    await classBooking(one, ids.previousClass, mia, 'attended')

    // -- studio one, the writing tests' own windows --------------------------
    ids.pricing = await addClass(one, tara, at(-45), { pay: null })
    await supporting(one, ids.pricing, omar, null)
    ids.editClass = await addClass(one, tara, at(-140), { pay: '10.00' })
    const editManual = await postManual(adminAtOne, {
      instructor_id: omar.staffId,
      amount_sgd: 5,
      label: `Cover bonus ${run}`,
      entry_date: at(-135).toISOString(),
    })
    assert.equal(editManual.status, 201, JSON.stringify(editManual.body))
    ids.editManual = editManual.body.id
    for (let i = 0; i < 30; i++) {
      await sale(one, noor, new Date(at(-119).getTime() + i * 12 * HOUR), '10.10', '9.95')
    }

    // -- studio two, in the same PERIOD --------------------------------------
    theirs.sale = await sale(two, kai, at(2, 9), '777.00', '700.00')
    const theirRefund = await refundedPayment(two, kai, {
      kind: 'class_package',
      amount: '333.00',
      paidAt: at(3, 9),
      refundedAt: at(6, 9),
    })
    theirs.refundedPayment = theirRefund.paymentId
    theirs.refundedSale = await sale(two, kai, at(3, 9), '333.00', '333.00', { purchaseId: theirRefund.purchaseId })
    theirs.merch = await merchOrder(two, kai, 'Their mat', '12.00', at(7, 9), true)
    theirs.class = await addClass(two, teacherAtTwo, at(11), { pay: '300.00' })
    await classBooking(two, theirs.class, kai, 'attended')
    const theirManual = await postManual(adminAtTwo, {
      instructor_id: teacherAtTwo.staffId,
      amount_sgd: 44.44,
      label: `Their bonus ${run}`,
      entry_date: at(18).toISOString(),
    })
    assert.equal(theirManual.status, 201, JSON.stringify(theirManual.body))
    theirs.manual = theirManual.body.id
  })

  after(async () => {
    if (!harness) return
    harness.clock.reset()
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    const workshopIds = sql`SELECT id FROM workshops WHERE name = ${WORKSHOP_NAME}`
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM manual_payroll_entries WHERE instructor_id IN (${staffIds}) OR created_by_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM workshop_tier_days WHERE workshop_tier_id IN (SELECT id FROM workshop_tiers WHERE workshop_id IN (${workshopIds}))`)
    await harness.db.execute(sql`DELETE FROM workshop_tiers WHERE workshop_id IN (${workshopIds})`)
    await harness.db.execute(sql`DELETE FROM workshop_days WHERE workshop_id IN (${workshopIds})`)
    await harness.db.execute(sql`DELETE FROM workshop_instructors WHERE workshop_id IN (${workshopIds})`)
    await harness.db.execute(sql`DELETE FROM workshops WHERE name = ${WORKSHOP_NAME}`)
    await harness.db.execute(sql`DELETE FROM pt_sessions WHERE scheduled_by_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM pt_requests WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM class_supporting_instructors WHERE instructor_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM stripe_payments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM merch_orders WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM promo_codes WHERE code = ${PROMO_CODE}`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name = ${CLASS_TYPE_NAME}`)
    await harness.db.execute(sql`DELETE FROM rooms WHERE location_id IN (SELECT id FROM locations WHERE name = ${SECOND_LOCATION_NAME})`)
    await harness.db.execute(sql`DELETE FROM locations WHERE name = ${SECOND_LOCATION_NAME}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  /** Studio one's PERIOD, every row, as the figures are stated in the tests below. */
  const PERIOD_ROWS = () => [
    ids.creditSale, // purchase
    ids.unlimited, // purchase, and its Add-On (same id)
    ids.unlimited,
    ids.ticket,
    ids.corporate, // the sale, and its Refund (same id)
    ids.corporate,
    ids.freeMerch,
    ids.paidMerch,
    ids.refundedSale,
    ids.comp,
    ids.shared, // Tara main, Omar supporting (same id)
    ids.shared,
    ids.unpriced,
    ids.workshop, // Tara, Omar (same id)
    ids.workshop,
    ids.pt,
    ids.manual,
  ].sort()

  // Gross: 180 + 250 + 40 + 90 + 500 + 0 + 25 + 120 (the comp counts in nothing)
  // Discounts: 30 (credit sale) + 9 (ticket)
  // Refunds: 500 (the corporate sale, refunded on day 8)
  // Pay: 45.50 + 20.25 + 120 + 60 + 30 + 15.75
  const PERIOD_TOTALS: Totals = {
    gross_sgd: 1205,
    discounts_sgd: 39,
    refunds_sgd: 500,
    instructor_pay_sgd: 291.5,
    net_sgd: 374.5,
  }

  // ── the ledger ───────────────────────────────────────────────────────────

  test('FIN-01 every Money Event dated in the period is listed, and none from outside it', async () => {
    const l = await ledger(adminAtOne, PERIOD)
    assert.deepEqual(idsOf(l.rows), PERIOD_ROWS())
    for (const outside of [ids.outsideSale, ids.outsideClass, ids.previousClass, ids.refundedPayment]) {
      assert.equal(rowsOf(l, outside).length, 0, `${outside} is dated outside the period`)
    }
    const from = new Date(PERIOD.from).getTime()
    const to = new Date(PERIOD.to).getTime()
    assert.ok(l.rows.every(r => Date.parse(r.occurred_at) >= from && Date.parse(r.occurred_at) <= to))
    assert.deepEqual(l.totals, PERIOD_TOTALS)
  })

  test('FIN-05 a purchase refunded a month later stays in its payment month, and the Refund sits on the refund date', async () => {
    const paidMonth = await ledger(adminAtOne, PERIOD)
    const sale = one_(paidMonth, ids.refundedSale, 'purchase')
    assert.equal(sale.occurred_at, at(9, 9).toISOString())
    assert.equal(sale.paid_sgd, 120)
    assert.equal(rowsOf(paidMonth, ids.refundedPayment).length, 0, 'no Refund in the month it was paid')

    const refundMonth = await ledger(adminAtOne, NEXT)
    assert.deepEqual(idsOf(refundMonth.rows), [ids.refundedPayment])
    const refund = one_(refundMonth, ids.refundedPayment, 'refund')
    assert.equal(refund.occurred_at, at(40, 9).toISOString())
    assert.equal(refund.paid_sgd, -120)
    assert.deepEqual(refundMonth.totals, {
      gross_sgd: 0,
      discounts_sgd: 0,
      refunds_sgd: 120,
      instructor_pay_sgd: 0,
      net_sgd: -120,
    })
  })

  test('FIN-06 a refunded purchase is still listed, marked as refunded', async () => {
    const l = await ledger(adminAtOne, PERIOD)
    const refunded = one_(l, ids.refundedSale, 'purchase')
    assert.equal(refunded.refunded, true)
    assert.equal(refunded.list_price_sgd, 120)
    assert.equal(one_(l, ids.creditSale, 'purchase').refunded, false)
  })

  test('FIN-11 a purchase that redeemed a Promo Code carries that code on its row', async () => {
    const l = await ledger(adminAtOne, PERIOD)
    const row = one_(l, ids.creditSale, 'purchase')
    assert.equal(row.promo_code, PROMO_CODE)
    assert.equal(row.list_price_sgd, 180)
    assert.equal(row.paid_sgd, 150)
    assert.equal(row.discount_sgd, 30)
    assert.equal(one_(l, ids.unlimited, 'purchase').promo_code, null)
  })

  test('FIN-12 a Cross-Location Add-On is its own row, apart from the plan purchase', async () => {
    const l = await ledger(adminAtOne, PERIOD)
    const plan = one_(l, ids.unlimited, 'purchase')
    const addOn = one_(l, ids.unlimited, 'addon')
    assert.equal(plan.type, 'unlimited')
    assert.equal(plan.list_price_sgd, 250)
    assert.equal(plan.paid_sgd, 250)
    assert.equal(plan.discount_sgd, 0, 'the Add-On is never a discount on the plan')
    assert.equal(addOn.type, 'addon')
    assert.equal(addOn.list_price_sgd, 40)
    assert.equal(addOn.paid_sgd, 40)
    assert.equal(addOn.discount_sgd, 0)
    assert.equal(addOn.user_name, mia.name)
  })

  test('FIN-13 a paid workshop ticket is a Workshop row with its money', async () => {
    const l = await ledger(adminAtOne, PERIOD)
    const row = one_(l, ids.ticket, 'workshop_ticket')
    assert.equal(row.type, 'workshop')
    assert.equal(row.variant, WORKSHOP_NAME)
    assert.equal(row.user_name, noor.name)
    assert.equal(row.list_price_sgd, 90)
    assert.equal(row.paid_sgd, 81)
    assert.equal(row.discount_sgd, 9)
  })

  test('FIN-14 a corporate sale later refunded still counts in Gross, and its Refund row is listed too', async () => {
    const l = await ledger(adminAtOne, PERIOD)
    const sale = one_(l, ids.corporate, 'corporate')
    assert.equal(sale.list_price_sgd, 500)
    assert.equal(sale.paid_sgd, 500)
    assert.equal(sale.discount_sgd, 0)
    assert.equal(sale.refunded, true)
    const refund = one_(l, ids.corporate, 'refund')
    assert.equal(refund.paid_sgd, -500)
    assert.equal(refund.occurred_at, at(8, 9).toISOString())

    const corporateOnly = await ledger(adminAtOne, { ...PERIOD, type: 'corporate' })
    assert.equal(corporateOnly.totals.gross_sgd, 500)
    const refundsOnly = await ledger(adminAtOne, { ...PERIOD, type: 'refund' })
    assert.equal(refundsOnly.totals.refunds_sgd, 500)
  })

  test('FIN-16 a free Merch Order with no payment row is still a Merch row, at zero discount', async () => {
    const l = await ledger(adminAtOne, PERIOD)
    const row = one_(l, ids.freeMerch, 'merch')
    assert.equal(row.type, 'merch')
    assert.equal(row.variant, `Free tote ${run}`)
    assert.equal(row.user_name, mia.name)
    assert.equal(row.list_price_sgd, 0)
    assert.equal(row.paid_sgd, 0)
    assert.equal(row.discount_sgd, 0)
  })

  // ── Instructor Pay on the ledger ─────────────────────────────────────────

  test('FIN-17 a held class pays its main and its supporting instructor, each a money-out row on the class date', async () => {
    const l = await ledger(adminAtOne, PERIOD)
    const rows = rowsOf(l, ids.shared)
    assert.equal(rows.length, 2)
    const main = rows.find(r => r.instructor_id === tara.staffId)
    const support = rows.find(r => r.instructor_id === omar.staffId)
    assert.equal(main?.pay_sgd, 45.5)
    assert.equal(support?.pay_sgd, 20.25)
    for (const r of rows) {
      assert.equal(r.kind, 'instructor_pay')
      assert.equal(r.type, 'class')
      assert.equal(r.occurred_at, at(11).toISOString())
      assert.equal(r.paid_sgd, null, 'money out, not money in')
    }
  })

  test('FIN-18 a multi-day workshop’s pay sits on its first day’s start', async () => {
    const l = await ledger(adminAtOne, PERIOD)
    const rows = rowsOf(l, ids.workshop)
    assert.equal(rows.length, 2)
    assert.deepEqual(
      rows.map(r => [r.instructor_id, r.pay_sgd, r.occurred_at]).sort(),
      [
        [omar.staffId, 60, at(12).toISOString()],
        [tara.staffId, 120, at(12).toISOString()],
      ].sort(),
    )
  })

  test('FIN-19 a cancelled class or PT session, or one not yet ended, contributes no Instructor Pay row', async () => {
    const l = await ledger(adminAtOne, PERIOD)
    for (const id of [ids.cancelled, ids.notYetHeld, ids.ptCancelled, ids.ptNotYetHeld]) {
      assert.equal(rowsOf(l, id).length, 0, `${id} owes no pay`)
    }
    assert.equal(one_(l, ids.pt, 'instructor_pay').pay_sgd, 30, 'the held PT session does')
    // 77 + 55 + 34 + 33 are nowhere in the pay total.
    assert.equal(l.totals.instructor_pay_sgd, 291.5)
  })

  test('FIN-22 any Unpriced session in the period flags Net as incomplete, on the ledger and the overview', async () => {
    const l = await ledger(adminAtOne, PERIOD)
    assert.equal(l.unpriced_count, 1)
    assert.equal(one_(l, ids.unpriced).unpriced, true)
    const o = await overview(adminAtOne, PERIOD)
    assert.equal(o.unpriced_count, 1)
    assert.equal(o.totals.net_sgd, 374.5)

    const complete = await overview(adminAtOne, NEXT)
    assert.equal(complete.unpriced_count, 0)
  })

  test('FIN-24 a Manual Entry is a money-out row on its own date and counts in Instructor Pay', async () => {
    const stored = await manualRow(ids.manual)
    assert.equal(stored?.tenantId, one.id)
    assert.equal(stored?.amountSgd, '15.75')

    const l = await ledger(adminAtOne, PERIOD)
    const row = one_(l, ids.manual, 'manual')
    assert.equal(row.type, 'manual')
    assert.equal(row.occurred_at, at(18).toISOString())
    assert.equal(row.variant, `Retreat bonus ${run}`)
    assert.equal(row.pay_sgd, 15.75)
    assert.equal(row.instructor_id, tara.staffId)
    assert.equal(row.unpriced, false)
    // 45.50 (main) + 120 (workshop) + 15.75 (this entry)
    assert.equal(l.instructor_totals.find(t => t.instructor_id === tara.staffId)?.total_sgd, 181.25)
  })

  test('FIN-25 a Manual Entry deleted by the admin no longer appears or counts', async () => {
    const created = await postManual(adminAtOne, {
      instructor_id: omar.staffId,
      amount_sgd: 12.34,
      label: `Added by mistake ${run}`,
      entry_date: at(-75).toISOString(),
    })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    const before_ = await ledger(adminAtOne, DELETING)
    assert.deepEqual(idsOf(before_.rows), [created.body.id])
    assert.equal(before_.totals.instructor_pay_sgd, 12.34)

    const deleted = await send(adminAtOne, 'DELETE', `/manual/${created.body.id}`)
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body))
    assert.equal(await manualRow(created.body.id), undefined)

    const after_ = await ledger(adminAtOne, DELETING)
    assert.deepEqual(after_.rows, [])
    assert.equal(after_.totals.instructor_pay_sgd, 0)
    assert.equal(after_.totals.net_sgd, 0)
    assert.deepEqual(after_.instructor_totals, [])
  })

  test('FIN-26 pay set inline on Finance is saved through the roster, and the row and totals follow', async () => {
    const unpriced = await ledger(adminAtOne, PRICING)
    assert.equal(unpriced.unpriced_count, 2)
    assert.equal(unpriced.totals.instructor_pay_sgd, 0)

    const main = await send(adminAtOne, 'PATCH', `/pay/class/${ids.pricing}`, { instructor_pay_sgd: 38.4 })
    assert.equal(main.status, 200, JSON.stringify(main.body))
    const support = await send(adminAtOne, 'PATCH', `/pay/class/${ids.pricing}`, {
      instructor_pay_sgd: 11.11,
      instructor_id: omar.staffId,
    })
    assert.equal(support.status, 200, JSON.stringify(support.body))

    assert.equal(await classPay(ids.pricing), '38.40')
    const [joinRow] = await harness.db
      .select({ pay: schema.classSupportingInstructors.paySgd })
      .from(schema.classSupportingInstructors)
      .where(eq(schema.classSupportingInstructors.classId, ids.pricing))
    assert.equal(joinRow?.pay, '11.11')

    const priced = await ledger(adminAtOne, PRICING)
    assert.equal(priced.unpriced_count, 0)
    assert.deepEqual(
      priced.rows.map(r => [r.instructor_id, r.pay_sgd, r.unpriced]).sort(),
      [
        [omar.staffId, 11.11, false],
        [tara.staffId, 38.4, false],
      ].sort(),
    )
    assert.equal(priced.totals.instructor_pay_sgd, 49.51)
    assert.equal(priced.totals.net_sgd, -49.51)
  })

  // ── totals, ordering and paging ──────────────────────────────────────────

  test('FIN-29 with more rows than a page holds, the tiles are the totals of the whole range', async () => {
    const l = await ledger(adminAtOne, PAGING)
    assert.equal(l.rows.length, 30, 'every row comes back — the portal pages 25 at a time over them')
    // 30 × 10.10 list, 30 × 9.95 paid.
    assert.deepEqual(l.totals, {
      gross_sgd: 303,
      discounts_sgd: 4.5,
      refunds_sgd: 0,
      instructor_pay_sgd: 0,
      net_sgd: 298.5,
    })
    assert.equal(sum(l.rows.map(r => r.list_price_sgd)), l.totals.gross_sgd)
    assert.equal(sum(l.rows.slice(0, 25).map(r => r.list_price_sgd)), 252.5, 'one page alone would say less')
  })

  test('FIN-28 the ledger comes back newest first', async () => {
    const l = await ledger(adminAtOne, PERIOD)
    const times = l.rows.map(r => Date.parse(r.occurred_at))
    assert.deepEqual(times, [...times].sort((a, b) => b - a))
    assert.equal(l.rows[0]?.id, ids.manual, 'day 18 is the latest')
    assert.equal(l.rows.at(-1)?.id, ids.creditSale, 'day 2 the earliest')
  })

  // ── filters ──────────────────────────────────────────────────────────────

  test('FIN-30 filtering by one Type lists only rows of that Type', async () => {
    const merch = await ledger(adminAtOne, { ...PERIOD, type: 'merch' })
    assert.deepEqual(idsOf(merch.rows), [ids.freeMerch, ids.paidMerch].sort())
    assert.ok(merch.rows.every(r => r.type === 'merch'))
    assert.equal(merch.totals.gross_sgd, 25)

    const classes = await ledger(adminAtOne, { ...PERIOD, type: 'class' })
    assert.deepEqual(idsOf(classes.rows), [ids.shared, ids.shared, ids.unpriced].sort())
    assert.equal(classes.totals.instructor_pay_sgd, 65.75)
  })

  test('FIN-31 the User search finds one person’s rows, whether they paid or were paid', async () => {
    const paid = await ledger(adminAtOne, { ...PERIOD, q: mia.name })
    assert.deepEqual(
      idsOf(paid.rows),
      [ids.creditSale, ids.unlimited, ids.unlimited, ids.freeMerch, ids.comp].sort(),
    )
    assert.ok(paid.rows.every(r => r.user_name === mia.name))

    const wasPaid = await ledger(adminAtOne, { ...PERIOD, q: tara.name.toUpperCase() })
    assert.deepEqual(idsOf(wasPaid.rows), [ids.shared, ids.unpriced, ids.workshop, ids.manual].sort())
    assert.ok(wasPaid.rows.every(r => r.instructor_id === tara.staffId))
    assert.equal(wasPaid.totals.instructor_pay_sgd, 181.25)
  })

  test('FIN-32 Needs pay only lists the Unpriced sessions and nothing else', async () => {
    const l = await ledger(adminAtOne, { ...PERIOD, needs_pay: 'true' })
    assert.deepEqual(idsOf(l.rows), [ids.unpriced])
    assert.equal(l.unpriced_count, 1)
    assert.equal(l.totals.gross_sgd, 0)
    assert.equal(l.totals.instructor_pay_sgd, 0)
  })

  const UNATTRIBUTED_ROWS = () =>
    [
      ids.creditSale,
      ids.corporate,
      ids.corporate,
      ids.freeMerch,
      ids.paidMerch,
      ids.refundedSale,
      ids.comp,
      ids.manual,
    ].sort()

  test('FIN-33 a Money Event with no recorded Location is marked Unattributed, never dropped or placed', async () => {
    const l = await ledger(adminAtOne, PERIOD)
    const unattributed = l.rows.filter(r => r.unattributed)
    assert.deepEqual(idsOf(unattributed), UNATTRIBUTED_ROWS())
    assert.ok(unattributed.every(r => r.location_id === null && r.location_name === null))
    assert.ok(l.rows.filter(r => !r.unattributed).every(r => r.location_id !== null))
  })

  test('FIN-34 Instructor Pay carries its session’s Location', async () => {
    const l = await ledger(adminAtOne, PERIOD)
    for (const r of [...rowsOf(l, ids.shared), ...rowsOf(l, ids.unpriced), ...rowsOf(l, ids.pt)]) {
      assert.equal(r.location_id, one.locationId)
      assert.equal(r.location_name, one.locationName)
    }
    for (const r of rowsOf(l, ids.workshop)) {
      assert.equal(r.location_id, annex.id)
      assert.equal(r.location_name, annex.name)
    }
  })

  test('FIN-35 filtering to a Location leaves out every Unattributed row', async () => {
    const l = await ledger(adminAtOne, { ...PERIOD, location: one.locationId })
    assert.deepEqual(
      idsOf(l.rows),
      [ids.unlimited, ids.unlimited, ids.shared, ids.shared, ids.unpriced, ids.pt].sort(),
    )
    assert.ok(l.rows.every(r => !r.unattributed && r.location_id === one.locationId))
  })

  test('FIN-36 filtering to Unattributed shows only the rows with no Location', async () => {
    const l = await ledger(adminAtOne, { ...PERIOD, location: 'unattributed' })
    assert.deepEqual(idsOf(l.rows), UNATTRIBUTED_ROWS())
    // 180 + 500 + 0 + 25 + 120 gross; 30 off; the corporate Refund; the Manual Entry.
    assert.deepEqual(l.totals, {
      gross_sgd: 825,
      discounts_sgd: 30,
      refunds_sgd: 500,
      instructor_pay_sgd: 15.75,
      net_sgd: 279.25,
    })
  })

  test('FIN-50 a plan and its Add-On sit under their Home Location, a workshop ticket under the workshop’s', async () => {
    const home = await ledger(adminAtOne, { ...PERIOD, location: one.locationId })
    for (const kind of ['purchase', 'addon']) {
      const row = one_(home, ids.unlimited, kind)
      assert.equal(row.location_id, one.locationId)
      assert.equal(row.unattributed, false)
    }
    assert.equal(rowsOf(home, ids.ticket).length, 0)

    const elsewhere = await ledger(adminAtOne, { ...PERIOD, location: annex.id })
    assert.deepEqual(idsOf(elsewhere.rows), [ids.ticket, ids.workshop, ids.workshop].sort())
    const ticket = one_(elsewhere, ids.ticket, 'workshop_ticket')
    assert.equal(ticket.location_name, annex.name)
    assert.equal(ticket.unattributed, false)
    assert.equal(rowsOf(elsewhere, ids.unlimited).length, 0)
  })

  // ── the overview ─────────────────────────────────────────────────────────

  test('FIN-37 the overview reflects the period alone, whatever filter the table has on', async () => {
    const plain = await overview(adminAtOne, PERIOD)
    assert.deepEqual(plain.totals, PERIOD_TOTALS)
    for (const filter of [
      { type: 'merch' },
      { q: mia.name },
      { location: annex.id },
      { location: 'unattributed' },
      { needs_pay: 'true' },
      { instructor_id: tara.staffId },
    ] as Record<string, string>[]) {
      const filtered = await overview(adminAtOne, { ...PERIOD, ...filter })
      assert.deepEqual(filtered, plain, JSON.stringify(filter))
      const table = await ledger(adminAtOne, { ...PERIOD, ...filter })
      assert.notDeepEqual(table.totals, plain.totals, `the table does narrow to ${JSON.stringify(filter)}`)
    }
  })

  test('FIN-38 sales by Sale Category sum to the Gross tile for the same period', async () => {
    const o = await overview(adminAtOne, PERIOD)
    assert.deepEqual(o.sales_by_category, [
      // credit 180/150 + unlimited 250 + Add-On 40 + refunded sale 120
      { category: 'classes', gross_sgd: 590, collected_sgd: 560, count: 4 },
      { category: 'pt', gross_sgd: 0, collected_sgd: 0, count: 0 },
      { category: 'workshops', gross_sgd: 90, collected_sgd: 81, count: 1 },
      { category: 'corporate', gross_sgd: 500, collected_sgd: 500, count: 1 },
      { category: 'merch', gross_sgd: 25, collected_sgd: 25, count: 2 },
    ])
    assert.equal(sum(o.sales_by_category.map(c => c.gross_sgd)), o.totals.gross_sgd)
    const l = await ledger(adminAtOne, PERIOD)
    assert.equal(o.totals.gross_sgd, l.totals.gross_sgd)
    assert.deepEqual(o.by_instructor, l.instructor_totals)
  })

  test('FIN-39 Active Members is counted as of today, not over the period', async () => {
    const today = at(200, 0)
    harness.clock.set(today)
    try {
      const before_ = (await overview(adminAtOne, PERIOD)).members.active
      // Live today, though bought long after the period.
      const current = await member(one, 'Current Holder')
      await sale(one, current, at(150, 9), '10.00', '10.00', { expiresAt: at(300) })
      // Live all through the period, but expired before today — its flag not yet swept.
      const lapsed = await member(one, 'Lapsed Holder')
      await sale(one, lapsed, at(-200, 9), '10.00', '10.00', { expiresAt: at(50) })

      const after_ = await overview(adminAtOne, PERIOD)
      assert.equal(after_.members.active, before_ + 1)
      const otherPeriod = await overview(adminAtOne, PAGING)
      assert.equal(otherPeriod.members.active, after_.members.active, 'the period does not move it')
    } finally {
      harness.clock.set(NOW)
    }
  })

  test('FIN-40 members joined counts only those who joined inside the period', async () => {
    const o = await overview(adminAtOne, PERIOD)
    // Early Joiner (day 3) — not Late (day 45), not Prior (day -2), not studio two's Kai (day 3).
    assert.equal(o.members.joined, 1)
    const previous = await overview(adminAtOne, span(-30, 0))
    assert.equal(previous.members.joined, 1, 'Prior Joiner, in the window before')
  })

  test('FIN-41 class popularity ranks class types by attendance against the window before', async () => {
    const o = await overview(adminAtOne, PERIOD)
    const mine = o.classes.filter(c => c.class_type_id === one.classTypeId)
    // Three check-ins at the shared class; the no-show does not count. One the window before.
    assert.deepEqual(mine, [{ class_type_id: one.classTypeId, name: CLASS_TYPE_NAME, attended: 3, previous: 1 }])
    assert.ok(!o.classes.some(c => c.class_type_id === two.classTypeId))
  })

  // ── CSV ──────────────────────────────────────────────────────────────────

  test('FIN-42, FIN-43 the CSV holds exactly the rows the screen showed for the same filters', async () => {
    for (const filter of [{}, { location: 'unattributed' }, { type: 'class' }, { q: noor.name }] as Record<string, string>[]) {
      const query = { ...PERIOD, ...filter }
      const screen = await ledger(adminAtOne, query)
      const file = await csv(adminAtOne, query)
      assert.equal(file.length, screen.rows.length, JSON.stringify(filter))
      screen.rows.forEach((r, i) => {
        const line = file[i]!
        assert.equal(line.type, r.type)
        assert.equal(line.user, r.user_name ?? '')
        assert.equal(line.price_sgd, r.list_price_sgd == null ? '' : String(r.list_price_sgd))
        assert.equal(line.discount_sgd, r.discount_sgd == null ? '' : String(r.discount_sgd))
        assert.equal(line.money_in_sgd, r.paid_sgd == null ? '' : String(r.paid_sgd))
        assert.equal(line.money_out_sgd, r.pay_sgd == null ? '' : String(r.pay_sgd))
        assert.equal(line.location, r.unattributed ? 'Unattributed' : r.location_name)
      })
    }
    const unattributed = await csv(adminAtOne, { ...PERIOD, location: 'unattributed' })
    assert.equal(unattributed.length, 8)
    assert.ok(unattributed.every(line => line.location === 'Unattributed'))
    const moneyIn = unattributed.reduce((s, line) => s + Math.round(Number(line.money_in_sgd || 0) * 100), 0) / 100
    // 150 + 500 − 500 + 0 + 25 + 120 + 0
    assert.equal(moneyIn, 295)
  })

  // ── refusals ─────────────────────────────────────────────────────────────

  test('FIN-45 purchase and Refund rows cannot be edited or deleted; Instructor Pay and Manual Entries can', async () => {
    const l = await ledger(adminAtOne, PERIOD)
    assert.equal(one_(l, ids.creditSale, 'purchase').editable, false)
    assert.equal(one_(l, ids.corporate, 'refund').editable, false)
    assert.equal(one_(l, ids.manual, 'manual').editable, true)
    assert.ok(rowsOf(l, ids.shared).every(r => r.editable))

    const attempts = [
      await send(adminAtOne, 'PATCH', `/pay/purchase/${ids.creditSale}`, { instructor_pay_sgd: 0 }),
      await send(adminAtOne, 'PATCH', `/pay/refund/${ids.corporate}`, { instructor_pay_sgd: 0 }),
      await send(adminAtOne, 'PATCH', `/pay/manual/${ids.creditSale}`, { instructor_pay_sgd: 0 }),
      await send(adminAtOne, 'PATCH', `/pay/manual/${ids.corporate}`, { instructor_pay_sgd: 0 }),
      await send(adminAtOne, 'DELETE', `/manual/${ids.creditSale}`),
      await send(adminAtOne, 'DELETE', `/manual/${ids.corporate}`),
    ]
    assert.deepEqual(
      attempts.map(a => a.status),
      [400, 400, 404, 404, 404, 404],
      JSON.stringify(attempts.map(a => a.body)),
    )
    const [sale_] = await harness.db
      .select()
      .from(schema.clientPackages)
      .where(eq(schema.clientPackages.id, ids.creditSale))
    assert.equal(sale_?.listPriceSgd, '180.00')
    assert.equal(sale_?.amountPaidSgd, '150.00')
    const [payment] = await harness.db
      .select()
      .from(schema.stripePayments)
      .where(eq(schema.stripePayments.id, ids.corporate))
    assert.equal(payment?.amountSgd, '500.00')
    assert.equal(payment?.status, 'refunded')
    assert.deepEqual((await ledger(adminAtOne, PERIOD)).totals, PERIOD_TOTALS)

    // The two editable kinds, on EDITING's own rows.
    const pay = await send(adminAtOne, 'PATCH', `/pay/class/${ids.editClass}`, { instructor_pay_sgd: 12.5 })
    assert.equal(pay.status, 200, JSON.stringify(pay.body))
    const entry = await send(adminAtOne, 'PATCH', `/pay/manual/${ids.editManual}`, { instructor_pay_sgd: 6.25 })
    assert.equal(entry.status, 200, JSON.stringify(entry.body))
    assert.equal(await classPay(ids.editClass), '12.50')
    assert.equal((await manualRow(ids.editManual))?.amountSgd, '6.25')
    assert.equal((await ledger(adminAtOne, EDITING)).totals.instructor_pay_sgd, 18.75)
  })

  test('FIN-48 an Instructor is refused the Finance ledger, its overview and its CSV export', async () => {
    for (const path of ['', '/overview', '/export']) {
      const res = await get(tara, path, PERIOD)
      assert.equal(res.status, 403, `${path}: ${res.text}`)
      assert.equal(JSON.parse(res.text).error, 'forbidden_role')
    }
  })

  // ── across studios ───────────────────────────────────────────────────────

  test('TEN-10 no row or figure from another studio reaches the ledger, the overview or the CSV', async () => {
    const theirIds = new Set(Object.values(theirs))
    const ourIds = new Set(Object.values(ids))

    // Studio one: exactly its own rows and figures.
    const l = await ledger(adminAtOne, PERIOD)
    assert.ok(!l.rows.some(r => theirIds.has(r.id)))
    assert.deepEqual(idsOf(l.rows), PERIOD_ROWS())
    assert.deepEqual(l.totals, PERIOD_TOTALS)
    assert.ok(!l.instructor_totals.some(t => t.instructor_id === teacherAtTwo.staffId))

    const o = await overview(adminAtOne, PERIOD)
    assert.deepEqual(o.totals, PERIOD_TOTALS)
    assert.equal(sum(o.sales_by_category.map(c => c.gross_sgd)), 1205)
    assert.equal(o.members.joined, 1)
    assert.ok(!o.classes.some(c => c.class_type_id === two.classTypeId))
    assert.ok(!o.by_instructor.some(t => t.instructor_id === teacherAtTwo.staffId))

    const file = await csv(adminAtOne, PERIOD)
    assert.equal(file.length, 17)
    assert.ok(!file.some(line => line.user === kai.name || line.user === teacherAtTwo.name))
    assert.ok(!file.some(line => line.variant === `Their mat ${run}` || line.variant === `Their bonus ${run}`))

    // Studio two: exactly its own, and none of studio one's.
    const theirLedger = await ledger(adminAtTwo, PERIOD)
    assert.ok(!theirLedger.rows.some(r => ourIds.has(r.id)))
    assert.deepEqual(
      idsOf(theirLedger.rows),
      [theirs.sale, theirs.refundedSale, theirs.refundedPayment, theirs.merch, theirs.class, theirs.manual].sort(),
    )
    // 777 + 333 + 12 gross; 77 off; 333 back; 300 + 44.44 pay.
    const theirTotals = { gross_sgd: 1122, discounts_sgd: 77, refunds_sgd: 333, instructor_pay_sgd: 344.44, net_sgd: 367.56 }
    assert.deepEqual(theirLedger.totals, theirTotals)
    const theirOverview = await overview(adminAtTwo, PERIOD)
    assert.deepEqual(theirOverview.totals, theirTotals)
    assert.equal(theirOverview.members.joined, 1)
    assert.deepEqual(
      theirOverview.classes.filter(c => c.name === CLASS_TYPE_NAME),
      [{ class_type_id: two.classTypeId, name: CLASS_TYPE_NAME, attended: 1, previous: 0 }],
    )
    const theirFile = await csv(adminAtTwo, PERIOD)
    assert.equal(theirFile.length, 6)
    assert.ok(!theirFile.some(line => [mia.name, noor.name, tara.name, omar.name].includes(line.user!)))
  })

  test('TEN-11 another studio’s Manual Entry and Instructor Pay cannot be edited or deleted', async () => {
    const attempts = [
      await send(adminAtTwo, 'PATCH', `/pay/class/${ids.shared}`, { instructor_pay_sgd: 1 }),
      await send(adminAtTwo, 'PATCH', `/pay/class/${ids.shared}`, { instructor_pay_sgd: 1, instructor_id: omar.staffId }),
      await send(adminAtTwo, 'PATCH', `/pay/workshop/${ids.workshop}`, { instructor_pay_sgd: 1, instructor_id: tara.staffId }),
      await send(adminAtTwo, 'PATCH', `/pay/pt/${ids.pt}`, { instructor_pay_sgd: 1 }),
      await send(adminAtTwo, 'PATCH', `/pay/manual/${ids.manual}`, { instructor_pay_sgd: 1 }),
      await send(adminAtTwo, 'DELETE', `/manual/${ids.manual}`),
      await send(adminAtOne, 'PATCH', `/pay/class/${theirs.class}`, { instructor_pay_sgd: 1 }),
      await send(adminAtOne, 'PATCH', `/pay/manual/${theirs.manual}`, { instructor_pay_sgd: 1 }),
      await send(adminAtOne, 'DELETE', `/manual/${theirs.manual}`),
    ]
    for (const a of attempts) {
      assert.equal(a.status, 404, JSON.stringify(a.body))
      assert.equal(a.body.error, 'record_not_found')
    }

    assert.equal(await classPay(ids.shared), '45.50')
    assert.equal((await manualRow(ids.manual))?.amountSgd, '15.75')
    assert.equal(await classPay(theirs.class), '300.00')
    assert.equal((await manualRow(theirs.manual))?.amountSgd, '44.44')
    assert.deepEqual((await ledger(adminAtOne, PERIOD)).totals, PERIOD_TOTALS)
    const theirLedger = await ledger(adminAtTwo, PERIOD)
    assert.equal(theirLedger.totals.instructor_pay_sgd, 344.44)
  })

  test('TEN-27 a Manual Entry cannot be made out to another studio’s instructor, or to no instructor at all', async () => {
    const label = `Cross-studio entry ${run}`
    for (const instructorId of [teacherAtTwo.staffId, randomUUID(), adminAtOne.staffId]) {
      const res = await postManual(adminAtOne, { instructor_id: instructorId, amount_sgd: 1, label })
      assert.equal(res.status, 400, JSON.stringify(res.body))
      assert.equal(res.body.error, 'invalid_instructor_id')
    }
    const written = await harness.db
      .select()
      .from(schema.manualPayrollEntries)
      .where(eq(schema.manualPayrollEntries.label, label))
    assert.deepEqual(written, [], 'no row at either studio')
  })

  test('PAYR-16 a blank label, a nonsense date, an amount past the money column or a garbled id is refused, and nothing changes', async () => {
    const base = { instructor_id: tara.staffId, amount_sgd: 5 }
    const refusals = [
      await postManual(adminAtOne, { ...base, label: '   ' }),
      await postManual(adminAtOne, { ...base, label: `Garbage date ${run}`, entry_date: '1' }),
      await postManual(adminAtOne, { ...base, label: `Huge ${run}`, amount_sgd: 1e15 }),
      await send(adminAtOne, 'PATCH', `/pay/manual/${ids.manual}`, { instructor_pay_sgd: 1e15 }),
      await send(adminAtOne, 'PATCH', `/pay/class/${ids.shared}`, { instructor_pay_sgd: 1e15 }),
      await send(adminAtOne, 'DELETE', '/manual/not-a-uuid'),
    ]
    for (const r of refusals) assert.equal(r.status, 400, JSON.stringify(r.body))

    const written = await harness.db.execute(
      sql`SELECT id FROM manual_payroll_entries WHERE instructor_id = ${tara.staffId} AND (label IN (${`Garbage date ${run}`}, ${`Huge ${run}`}) OR btrim(label) = '')`,
    )
    assert.equal(written.length, 0)
    assert.equal((await manualRow(ids.manual))?.amountSgd, '15.75')
    assert.equal(await classPay(ids.shared), '45.50')
    assert.deepEqual((await ledger(adminAtOne, PERIOD)).totals, PERIOD_TOTALS)
  })
})
