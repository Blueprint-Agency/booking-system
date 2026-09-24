import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, inArray, like, or } from 'drizzle-orm'
import { inTenantContext, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.admin-catalogue.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const NAME = `Catalogue ${run}`
/** Every Promo Code this file makes starts with this, so cleanup can find them. */
const CODE_PREFIX = `C${run}`.toUpperCase()
/** Every feature flag this file switches. */
const FLAG = `catalogue_${run}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * The admin catalogue over HTTP (#205): promo codes, merch, marketing, rooms,
 * feature flags, class packages and PT packages.
 *
 * The in-process app against real Postgres with both fixture Tenants, and a real
 * sign-in for every caller — an admin at each studio, an instructor, a member.
 * For each route group: the admin's happy path, the refusal of everyone else,
 * the refusal of the other studio's admin, and the business rules its spec
 * states. Written from the Scenario Inventory (`docs/md/test-scenarios.md`)
 * and the specs it cites (admin-restructure §3b, §5, §6, §6b;
 * spec-pre-launch-batch §9–§11; be-portal §marketing, §feature-flags).
 *
 * What a member does with the same catalogue — typing a code, buying merch — is
 * `promo-codes-and-merch.test.ts`.
 */
describe('admin catalogue over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let purchaseSvc!: typeof import('../services/packages/purchase')
  let flags!: typeof import('../services/feature-flags')

  type Headers = Record<string, string>
  type Reply = { status: number; body: any }
  type Studio = { id: string; slug: string; admin: Headers; adminId: string; locationId: string }

  let one!: Studio
  let two!: Studio
  let instructor!: Headers
  let instructorId!: string
  let memberHeaders!: Headers
  let memberId!: string
  /** Each studio's marketing copy as it was, put back after. */
  const marketingWas = new Map<string, Record<string, unknown>>()

  async function reply(res: Response): Promise<Reply> {
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  const send = async (method: string, path: string, headers: Headers, body?: unknown) =>
    reply(
      await harness.app.request(`/api/v1/portal/admin${path}`, {
        method,
        headers: { ...headers, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )

  async function staff(tenant: { id: string; slug: string }, name: string, role: 'admin' | 'instructor') {
    const email = `${name}-${tenant.slug}@${DOMAIN}`
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row!.id })
    }
    return { headers, id: row!.id }
  }

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const admin = await staff(tenant, 'owner', 'admin')
    const [location] = await harness.db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(eq(schema.locations.tenantId, tenant.id))
      .limit(1)
    assert.ok(location, `expected a seeded location for ${tenant.slug}`)
    return { ...tenant, admin: admin.headers, adminId: admin.id, locationId: location.id }
  }

  const created = (res: Reply) => {
    assert.equal(res.status, 201, JSON.stringify(res.body))
    return res.body
  }

  const newCode = (at: Studio, suffix: string, over: Record<string, unknown> = {}) =>
    send('POST', '/promo-codes', at.admin, {
      code: `${CODE_PREFIX}-${suffix}`,
      label: '20% off',
      kind: 'percent',
      percent_off: 20,
      applies_to_all: true,
      ...over,
    })

  const bundleBody = (name: string, over: Record<string, unknown> = {}) => ({
    name: `${NAME} ${name}`,
    kind: 'credit_bundle',
    credits: 5,
    validity_days: 60,
    price_sgd: '100.00',
    ...over,
  })

  const ptBody = (name: string, over: Record<string, unknown> = {}) => ({
    name: `${NAME} ${name}`,
    session_type: '1on1',
    num_sessions: 5,
    validity_days: 90,
    price_sgd: '400.00',
    ...over,
  })

  const promotion = (over: Record<string, unknown> = {}) => ({
    label: 'Opening week',
    kind: 'percent',
    percent_off: 25,
    starts_at: new Date(Date.now() - DAY).toISOString(),
    ends_at: new Date(Date.now() + 7 * DAY).toISOString(),
    ...over,
  })

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))
    flags = await import('../services/feature-flags')

    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
    const teacher = await staff(harness.tenants.one, 'teacher', 'instructor')
    instructor = teacher.headers
    instructorId = teacher.id

    const email = `member-${harness.tenants.one.slug}@${DOMAIN}`
    memberHeaders = await harness.signInAs('client', email, harness.tenants.one)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: one.id, email, name: 'Catalogue Member', phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    memberId = client!.id

    for (const tenantId of [one.id, two.id]) {
      const [row] = await harness.db
        .select()
        .from(schema.marketingContent)
        .where(eq(schema.marketingContent.tenantId, tenantId))
      if (row) marketingWas.set(tenantId, row)
    }
  })

  after(async () => {
    if (!harness) return
    try {
      await cleanup()
    } finally {
      await harness.close()
    }
  })

  async function cleanup() {
    const db = harness.db

    for (const [tenantId, row] of marketingWas) {
      const { id: _id, tenantId: _t, ...copy } = row as typeof schema.marketingContent.$inferSelect
      await db
        .update(schema.marketingContent)
        .set({ ...copy, updatedByStaffId: null })
        .where(eq(schema.marketingContent.tenantId, tenantId))
    }
    await db.delete(schema.featureFlags).where(like(schema.featureFlags.key, `${FLAG}%`))

    await db.delete(schema.promoCodeRedemptions).where(eq(schema.promoCodeRedemptions.clientId, memberId))
    await db.delete(schema.clientPackages).where(eq(schema.clientPackages.clientId, memberId))
    await db.delete(schema.purchases).where(eq(schema.purchases.clientId, memberId))
    const codes = await db
      .select({ id: schema.promoCodes.id })
      .from(schema.promoCodes)
      .where(like(schema.promoCodes.code, `${CODE_PREFIX}%`))
    if (codes.length) {
      const ids = codes.map(c => c.id)
      await db.delete(schema.promoCodeRedemptions).where(inArray(schema.promoCodeRedemptions.promoCodeId, ids))
      await db.delete(schema.promoCodeProducts).where(inArray(schema.promoCodeProducts.promoCodeId, ids))
      await db.delete(schema.promoCodes).where(inArray(schema.promoCodes.id, ids))
    }
    await db.delete(schema.merch).where(like(schema.merch.title, `${NAME} %`))
    const classPackages = await db
      .select({ id: schema.classPackages.id })
      .from(schema.classPackages)
      .where(like(schema.classPackages.name, `${NAME} %`))
    const ptPackages = await db
      .select({ id: schema.ptPackages.id })
      .from(schema.ptPackages)
      .where(like(schema.ptPackages.name, `${NAME} %`))
    const packageIds = [...classPackages, ...ptPackages].map(p => p.id)
    if (packageIds.length) await db.delete(schema.promotions).where(inArray(schema.promotions.parentId, packageIds))
    if (classPackages.length) {
      await db.delete(schema.classPackages).where(inArray(schema.classPackages.id, classPackages.map(p => p.id)))
    }
    if (ptPackages.length) {
      await db.delete(schema.ptPackages).where(inArray(schema.ptPackages.id, ptPackages.map(p => p.id)))
    }
    const classTypes = await db
      .select({ id: schema.classTypes.id })
      .from(schema.classTypes)
      .where(like(schema.classTypes.name, `${NAME} %`))
    if (classTypes.length) {
      await db.delete(schema.classes).where(inArray(schema.classes.classTypeId, classTypes.map(t => t.id)))
      await db.delete(schema.classTypes).where(inArray(schema.classTypes.id, classTypes.map(t => t.id)))
    }
    await db.delete(schema.rooms).where(like(schema.rooms.name, `${NAME} %`))

    const staff = await db
      .select({ id: schema.staffUsers.id })
      .from(schema.staffUsers)
      .where(like(schema.staffUsers.email, `%@${DOMAIN}`))
    const staffIds = staff.map(s => s.id)
    const authIds = [
      ...(await db.select({ id: schema.staffAuthUsers.id }).from(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))),
      ...(await db.select({ id: schema.clientAuthUsers.id }).from(schema.clientAuthUsers).where(like(schema.clientAuthUsers.email, `%@${DOMAIN}`))),
    ].map(u => u.id)
    if (authIds.length) {
      await db
        .delete(schema.authEvents)
        .where(or(inArray(schema.authEvents.actorUserId, authIds), inArray(schema.authEvents.subjectUserId, authIds)))
    }
    if (staffIds.length) {
      await db.delete(schema.auditLog).where(inArray(schema.auditLog.actorStaffId, staffIds))
      await db.delete(schema.instructors).where(inArray(schema.instructors.staffUserId, staffIds))
    }
    await db.delete(schema.emailLog).where(like(schema.emailLog.recipientEmail, `%@${DOMAIN}`))
    await db.delete(schema.clients).where(eq(schema.clients.id, memberId))
    if (staffIds.length) await db.delete(schema.staffUsers).where(inArray(schema.staffUsers.id, staffIds))
    await db.delete(schema.clientAuthUsers).where(like(schema.clientAuthUsers.email, `%@${DOMAIN}`))
    await db.delete(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))
  }

  /* ── Who may use it ─────────────────────────────────────────────────── */

  test('STF-22 an instructor and a member are refused every catalogue route, and nothing is written', async () => {
    const writes: [string, string, unknown][] = [
      ['POST', '/promo-codes', { code: `${CODE_PREFIX}-DENIED`, label: 'x', kind: 'percent', percent_off: 10, applies_to_all: true }],
      ['POST', '/merch', { title: `${NAME} Denied mat`, price_sgd: '10.00' }],
      ['POST', '/rooms', { location_id: one.locationId, name: `${NAME} Denied room`, capacity: 5 }],
      ['POST', '/class-packages', bundleBody('Denied pass')],
      ['POST', '/pt-packages', ptBody('Denied PT')],
      ['PATCH', '/marketing', { hero_heading: 'Denied', hero_subheading: 'Denied' }],
      ['PATCH', `/feature-flags/${FLAG}_denied`, { enabled: true }],
    ]
    const reads = ['/promo-codes', '/merch', '/rooms', '/class-packages', '/pt-packages', '/marketing', '/feature-flags']

    for (const [caller, headers, status] of [
      ['instructor', instructor, 403],
      ['member', memberHeaders, 401],
    ] as const) {
      for (const path of reads) {
        const res = await send('GET', path, headers)
        assert.equal(res.status, status, `${caller} GET ${path}: ${JSON.stringify(res.body)}`)
      }
      for (const [method, path, body] of writes) {
        const res = await send(method, path, headers, body)
        assert.equal(res.status, status, `${caller} ${method} ${path}: ${JSON.stringify(res.body)}`)
      }
    }

    const [code] = await harness.db.select().from(schema.promoCodes).where(eq(schema.promoCodes.code, `${CODE_PREFIX}-DENIED`))
    const [item] = await harness.db.select().from(schema.merch).where(eq(schema.merch.title, `${NAME} Denied mat`))
    const [room] = await harness.db.select().from(schema.rooms).where(eq(schema.rooms.name, `${NAME} Denied room`))
    const [pass] = await harness.db.select().from(schema.classPackages).where(eq(schema.classPackages.name, `${NAME} Denied pass`))
    const [pt] = await harness.db.select().from(schema.ptPackages).where(eq(schema.ptPackages.name, `${NAME} Denied PT`))
    const [flag] = await harness.db.select().from(schema.featureFlags).where(eq(schema.featureFlags.key, `${FLAG}_denied`))
    const [copy] = await harness.db.select().from(schema.marketingContent).where(eq(schema.marketingContent.tenantId, one.id))
    assert.deepEqual([code, item, room, pass, pt, flag], [undefined, undefined, undefined, undefined, undefined, undefined])
    assert.notEqual(copy?.heroHeading, 'Denied')
  })

  /* ── Promo Codes ────────────────────────────────────────────────────── */

  test('PRM-10 a code is generated from the unambiguous alphabet, or typed and stored normalised, and its text is never shared', async () => {
    const generated = created(await send('POST', '/promo-codes', one.admin, {
      label: 'Generated',
      kind: 'amount',
      amount_off_sgd: '15.00',
      applies_to_all: true,
    }))
    assert.match(generated.code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/, 'no 0, O, 1, I or L')
    // Generated codes carry no run prefix, so this one is removed by id.
    const [generatedRow] = await harness.db.select().from(schema.promoCodes).where(eq(schema.promoCodes.id, generated.id))
    await harness.db
      .update(schema.promoCodes)
      .set({ code: `${CODE_PREFIX}-G${generatedRow!.code}`.slice(0, 24) })
      .where(eq(schema.promoCodes.id, generated.id))

    const typed = created(await newCode(one, 'spring', { code: `  ${CODE_PREFIX.toLowerCase()}-spring ` }))
    assert.equal(typed.code, `${CODE_PREFIX}-SPRING`, 'trimmed and upper-cased')
    assert.equal(typed.status, 'active')
    assert.equal(typed.redemption_count, 0)
    assert.equal(typed.terms_frozen, false)

    const again = await newCode(one, 'SPRING')
    assert.equal(again.status, 409, JSON.stringify(again.body))
    assert.equal(again.body.error, 'promo_code_text_taken')

    const badText = await newCode(one, 'no spaces!')
    assert.equal(badText.status, 400, JSON.stringify(badText.body))

    const listed = await send('GET', '/promo-codes', one.admin)
    assert.equal(listed.status, 200)
    assert.ok(listed.body.promo_codes.some((c: { id: string }) => c.id === typed.id))
    const read = await send('GET', `/promo-codes/${typed.id}`, one.admin)
    assert.equal(read.status, 200)
    assert.equal(read.body.label, '20% off')
  })

  test('PRM-13 a percent outside whole numbers 1–99, an amount of zero or less, or a missing figure is refused', async () => {
    for (const [i, over] of [
      { percent_off: 0 },
      { percent_off: 100 },
      { percent_off: 12.5 },
      { percent_off: null },
      { kind: 'amount', percent_off: undefined, amount_off_sgd: '0' },
      { kind: 'amount', percent_off: undefined, amount_off_sgd: '-5.00' },
      { kind: 'amount', percent_off: undefined },
    ].entries()) {
      const res = await newCode(one, `BAD${i}`, over)
      assert.equal(res.status, 400, `${JSON.stringify(over)}: ${JSON.stringify(res.body)}`)
    }
    const [row] = await harness.db.select().from(schema.promoCodes).where(like(schema.promoCodes.code, `${CODE_PREFIX}-BAD%`))
    assert.equal(row, undefined, 'none was saved')
  })

  test('PRM-11 a code applies to everything or names its products, and never another studio’s', async () => {
    const mine = created(await send('POST', '/class-packages', one.admin, bundleBody('Scoped pass')))
    const theirs = created(await send('POST', '/class-packages', two.admin, bundleBody('Their pass')))
    const product = (id: string) => ({ product_type: 'class_package', product_id: id })

    const both = await newCode(one, 'BOTH', { applies_to_all: true, products: [product(mine.id)] })
    assert.equal(both.status, 400)
    assert.equal(both.body.error, 'promo_code_scope_conflict')
    const neither = await newCode(one, 'NEITHER', { applies_to_all: false, products: [] })
    assert.equal(neither.status, 400)
    assert.equal(neither.body.error, 'promo_code_scope_empty')
    const across = await newCode(one, 'ACROSS', { applies_to_all: false, products: [product(theirs.id)] })
    assert.equal(across.status, 400)
    assert.equal(across.body.error, 'promo_code_product_not_found', 'another studio’s product is simply not there')

    const scoped = created(await newCode(one, 'SCOPED', { applies_to_all: false, products: [product(mine.id)] }))
    assert.deepEqual(scoped.products, [product(mine.id)])
    const products = await send('GET', '/promo-codes/products', one.admin)
    assert.ok(products.body.products.some((p: { product_id: string }) => p.product_id === mine.id))
    assert.ok(
      !products.body.products.some((p: { product_id: string }) => p.product_id === theirs.id),
      'the scope picker lists this studio’s products only',
    )
  })

  test('PRM-12 once a member has used a code its text and money off are frozen, and the rest stays editable', async () => {
    const pass = created(await send('POST', '/class-packages', one.admin, bundleBody('Frozen pass')))
    const code = created(await newCode(one, 'FROZEN', { kind: 'percent', percent_off: 10 }))

    // Editable until someone uses it. Taking the whole price also lets the
    // member's use below complete with no payment step.
    const unused = await send('PATCH', `/promo-codes/${code.id}`, one.admin, { kind: 'amount', amount_off_sgd: '100.00' })
    assert.equal(unused.status, 200, JSON.stringify(unused.body))
    assert.equal(unused.body.amount_off_sgd, '100.00')

    const used = await reply(
      await harness.app.request('/api/v1/me/checkout/package', {
        method: 'POST',
        headers: { ...memberHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ package_kind: 'class', package_id: pass.id, promo_code: code.code }),
      }),
    )
    assert.equal(used.status, 201, JSON.stringify(used.body))
    assert.equal(used.body.outcome, 'granted')

    const read = await send('GET', `/promo-codes/${code.id}`, one.admin)
    assert.equal(read.body.redemption_count, 1)
    assert.equal(read.body.terms_frozen, true)

    for (const patch of [
      { code: `${CODE_PREFIX}-RENAMED` },
      { kind: 'amount', amount_off_sgd: '50.00' },
      { kind: 'percent', percent_off: 50 },
    ]) {
      const res = await send('PATCH', `/promo-codes/${code.id}`, one.admin, patch)
      assert.equal(res.status, 409, `${JSON.stringify(patch)}: ${JSON.stringify(res.body)}`)
      assert.equal(res.body.error, 'promo_code_terms_frozen')
    }

    const expires = new Date(Date.now() + 30 * DAY).toISOString()
    const edited = await send('PATCH', `/promo-codes/${code.id}`, one.admin, {
      label: 'Loyalty thanks',
      max_redemptions: 50,
      expires_at: expires,
      applies_to_all: false,
      products: [{ product_type: 'class_package', product_id: pass.id }],
    })
    assert.equal(edited.status, 200, JSON.stringify(edited.body))
    assert.equal(edited.body.label, 'Loyalty thanks')
    assert.equal(edited.body.max_redemptions, 50)
    assert.equal(new Date(edited.body.expires_at).toISOString(), expires)
    assert.equal(edited.body.code, code.code, 'the text stands')
    assert.equal(edited.body.amount_off_sgd, '100.00', 'and so does the money off')

    const archived = await send('POST', `/promo-codes/${code.id}/archive`, one.admin)
    assert.equal(archived.status, 200)
    assert.equal(archived.body.status, 'archived')
    const listed = await send('GET', '/promo-codes?status=archived', one.admin)
    assert.ok(listed.body.promo_codes.some((c: { id: string }) => c.id === code.id), 'the record of what it did is kept')
  })

  test('PRM-14 another studio’s admin can neither see nor change a code, and may use the same text for its own', async () => {
    const code = created(await newCode(one, 'SHARED'))

    const list = await send('GET', '/promo-codes', two.admin)
    assert.ok(!list.body.promo_codes.some((c: { id: string }) => c.id === code.id))
    for (const [method, path, body] of [
      ['GET', `/promo-codes/${code.id}`, undefined],
      ['PATCH', `/promo-codes/${code.id}`, { label: 'Taken over' }],
      ['POST', `/promo-codes/${code.id}/archive`, undefined],
    ] as const) {
      const res = await send(method, path, two.admin, body)
      assert.equal(res.status, 404, `${method} ${path}: ${JSON.stringify(res.body)}`)
    }
    const [row] = await harness.db.select().from(schema.promoCodes).where(eq(schema.promoCodes.id, code.id))
    assert.equal(row!.label, '20% off')
    assert.equal(row!.status, 'active')

    const theirs = created(await newCode(two, 'SHARED'))
    assert.equal(theirs.code, code.code, 'a code’s text is unique within a studio, not across the platform')
    assert.notEqual(theirs.id, code.id)
  })

  /* ── Merch ──────────────────────────────────────────────────────────── */

  test('MRC-08 an admin adds, edits, archives and restores merch, and a negative price or blank title is refused', async () => {
    const item = created(await send('POST', '/merch', one.admin, {
      title: `${NAME} Mat`,
      description: 'Natural rubber',
      price_sgd: '45',
    }))
    assert.equal(item.price_sgd, '45.00')
    assert.equal(item.archived_at, null)

    const edited = await send('PATCH', `/merch/${item.id}`, one.admin, { title: `${NAME} Travel mat`, price_sgd: 39.5 })
    assert.equal(edited.status, 200, JSON.stringify(edited.body))
    assert.equal(edited.body.title, `${NAME} Travel mat`)
    assert.equal(edited.body.price_sgd, '39.50')

    const archived = await send('PATCH', `/merch/${item.id}`, one.admin, { archived: true })
    assert.ok(archived.body.archived_at)
    const live = await send('GET', '/merch', one.admin)
    assert.ok(!live.body.merch.some((m: { id: string }) => m.id === item.id), 'archived merch leaves the default list')
    const all = await send('GET', '/merch?include_archived=true', one.admin)
    assert.ok(all.body.merch.some((m: { id: string }) => m.id === item.id), 'and is still there to restore')
    const restored = await send('PATCH', `/merch/${item.id}`, one.admin, { archived: false })
    assert.equal(restored.body.archived_at, null)

    const negative = await send('POST', '/merch', one.admin, { title: `${NAME} Refund me`, price_sgd: '-1' })
    assert.equal(negative.status, 400, JSON.stringify(negative.body))
    const blank = await send('POST', '/merch', one.admin, { title: '   ', price_sgd: '5' })
    assert.equal(blank.status, 400, JSON.stringify(blank.body))
  })

  test('MRC-09 another studio’s admin can neither see, edit nor delete a merch item', async () => {
    const item = created(await send('POST', '/merch', one.admin, { title: `${NAME} Strap`, price_sgd: '12.00' }))

    const list = await send('GET', '/merch?include_archived=true', two.admin)
    assert.ok(!list.body.merch.some((m: { id: string }) => m.id === item.id))
    const edit = await send('PATCH', `/merch/${item.id}`, two.admin, { price_sgd: '0' })
    assert.equal(edit.status, 404, JSON.stringify(edit.body))
    const remove = await send('DELETE', `/merch/${item.id}`, two.admin)
    assert.equal(remove.status, 404, JSON.stringify(remove.body))

    const [row] = await harness.db.select().from(schema.merch).where(eq(schema.merch.id, item.id))
    assert.equal(row?.priceSgd, '12.00', 'still there, at its price')
  })

  /* ── Rooms ──────────────────────────────────────────────────────────── */

  test('SCH-21 a room is made at one of the studio’s Locations, keeps it, and must be archived before it is deleted', async () => {
    const room = created(await send('POST', '/rooms', one.admin, {
      location_id: one.locationId,
      name: `${NAME} Studio A`,
      capacity: 20,
    }))
    assert.equal(room.location_id, one.locationId)

    const zero = await send('POST', '/rooms', one.admin, { location_id: one.locationId, name: `${NAME} Cupboard`, capacity: 0 })
    assert.equal(zero.status, 400, 'capacity is a whole number of at least 1')
    const elsewhere = await send('POST', '/rooms', one.admin, { location_id: two.locationId, name: `${NAME} Borrowed`, capacity: 5 })
    assert.equal(elsewhere.status, 404, JSON.stringify(elsewhere.body))
    assert.equal(elsewhere.body.error, 'location_not_found', 'another studio’s Location is not one of ours')

    const moved = await send('PATCH', `/rooms/${room.id}`, one.admin, {
      name: `${NAME} Studio A (upstairs)`,
      capacity: 18,
      location_id: two.locationId,
    })
    assert.equal(moved.status, 200, JSON.stringify(moved.body))
    assert.equal(moved.body.capacity, 18)
    assert.equal(moved.body.location_id, one.locationId, 'a room cannot be moved to another Location')

    const early = await send('DELETE', `/rooms/${room.id}`, one.admin)
    assert.equal(early.status, 400)
    assert.equal(early.body.error, 'room_not_archived')
    assert.equal((await send('POST', `/rooms/${room.id}/archive`, one.admin)).status, 200)
    const listed = await send('GET', `/rooms?location_id=${one.locationId}`, one.admin)
    assert.ok(!listed.body.rooms.some((r: { id: string }) => r.id === room.id), 'archived rooms leave the default list')
    assert.equal((await send('DELETE', `/rooms/${room.id}`, one.admin)).status, 204)
    assert.equal((await send('GET', `/rooms/${room.id}`, one.admin)).status, 404)
  })

  test('SCH-20 a room an upcoming class uses cannot be archived until no upcoming session uses it', async () => {
    const room = created(await send('POST', '/rooms', one.admin, { location_id: one.locationId, name: `${NAME} Studio B`, capacity: 12 }))
    const classType = created(await send('POST', '/class-types', one.admin, { name: `${NAME} Hatha` }))
    const startsAt = new Date(Date.now() + 2 * DAY)
    const [cls] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: one.id,
        classTypeId: classType.id,
        mainInstructorId: instructorId,
        locationId: one.locationId,
        roomId: room.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 10,
        creditCost: 1,
        createdByStaffId: one.adminId,
      })
      .returning({ id: schema.classes.id })

    const refused = await send('POST', `/rooms/${room.id}/archive`, one.admin)
    assert.equal(refused.status, 409, JSON.stringify(refused.body))
    assert.equal(refused.body.error, 'room_in_use')
    const [still] = await harness.db.select().from(schema.rooms).where(eq(schema.rooms.id, room.id))
    assert.equal(still!.archivedAt, null)

    // The class has been and gone.
    await harness.db
      .update(schema.classes)
      .set({ startsAt: new Date(Date.now() - 2 * HOUR), endsAt: new Date(Date.now() - HOUR) })
      .where(eq(schema.classes.id, cls!.id))
    const archived = await send('POST', `/rooms/${room.id}/archive`, one.admin)
    assert.equal(archived.status, 200, JSON.stringify(archived.body))
    assert.ok(archived.body.archived_at)
  })

  test('SCH-22 another studio’s admin can neither see nor change a room', async () => {
    const room = created(await send('POST', '/rooms', one.admin, { location_id: one.locationId, name: `${NAME} Studio C`, capacity: 8 }))

    const list = await send('GET', '/rooms?include_archived=true', two.admin)
    assert.ok(!list.body.rooms.some((r: { id: string }) => r.id === room.id))
    for (const [method, path, body] of [
      ['GET', `/rooms/${room.id}`, undefined],
      ['PATCH', `/rooms/${room.id}`, { name: 'Taken over' }],
      ['POST', `/rooms/${room.id}/archive`, undefined],
      ['DELETE', `/rooms/${room.id}`, undefined],
    ] as const) {
      const res = await send(method, path, two.admin, body)
      assert.equal(res.status, 404, `${method} ${path}: ${JSON.stringify(res.body)}`)
    }
    const [row] = await harness.db.select().from(schema.rooms).where(eq(schema.rooms.id, room.id))
    assert.equal(row!.name, `${NAME} Studio C`)
    assert.equal(row!.archivedAt, null)
  })

  /* ── Class and PT packages ──────────────────────────────────────────── */

  test('PKG-01 a package saved with a live Promotion is listed with its List Price, effective price and Promotion label', async () => {
    const pass = created(await send('POST', '/class-packages', one.admin, bundleBody('Promo pass', { promotions: [promotion()] })))
    assert.equal(pass.price_sgd, '100.00')
    assert.equal(pass.effective_price_sgd, '75.00')

    const res = await harness.app.request('/api/v1/public/packages', { headers: memberHeaders })
    const catalogue = await reply(res)
    assert.equal(catalogue.status, 200, JSON.stringify(catalogue.body))
    const listed = catalogue.body.class_packages.find((p: { id: string }) => p.id === pass.id)
    assert.ok(listed, 'the member catalogue lists it')
    assert.equal(listed.price_sgd, '100.00')
    assert.equal(listed.effective_price_sgd, '75.00')
    assert.equal(listed.applied_promotion_id, listed.promotions[0].id)
    assert.equal(listed.promotions[0].label, 'Opening week')

    const edited = await send('PATCH', `/class-packages/${pass.id}`, one.admin, { price_sgd: '120.00' })
    assert.equal(edited.status, 200, JSON.stringify(edited.body))
    assert.equal(edited.body.effective_price_sgd, '90.00', 'the Promotion follows the new price')
  })

  test('PKG-09 an archived package leaves the catalogue and a member cannot check out for it', async () => {
    const pass = created(await send('POST', '/class-packages', one.admin, bundleBody('Retired pass')))
    const plan = created(await send('POST', '/pt-packages', one.admin, ptBody('Retired PT')))
    assert.equal((await send('POST', `/class-packages/${pass.id}/archive`, one.admin)).status, 200)
    assert.equal((await send('POST', `/pt-packages/${plan.id}/archive`, one.admin)).status, 200)

    const catalogue = await reply(await harness.app.request('/api/v1/public/packages', { headers: memberHeaders }))
    assert.ok(!catalogue.body.class_packages.some((p: { id: string }) => p.id === pass.id))
    assert.ok(!catalogue.body.pt_packages.some((p: { id: string }) => p.id === plan.id))

    for (const [kind, id, error] of [
      ['class', pass.id, 'class_package_not_active'],
      ['pt', plan.id, 'pt_package_not_active'],
    ]) {
      const res = await reply(
        await harness.app.request('/api/v1/me/checkout/package', {
          method: 'POST',
          headers: { ...memberHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ package_kind: kind, package_id: id }),
        }),
      )
      assert.equal(res.status, 400, JSON.stringify(res.body))
      assert.equal(res.body.error, error)
    }

    const restored = await send('POST', `/class-packages/${pass.id}/unarchive`, one.admin)
    assert.equal(restored.status, 200)
    assert.equal(restored.body.status, 'active')
  })

  test('PKG-21 a percent Promotion of 0, 100 or a fraction is refused on a class or PT package', async () => {
    for (const percent of [0, 100, 12.5]) {
      const cls = await send('POST', '/class-packages', one.admin, bundleBody(`Bad promo ${percent}`, { promotions: [promotion({ percent_off: percent })] }))
      assert.equal(cls.status, 400, `class ${percent}: ${JSON.stringify(cls.body)}`)
      const pt = await send('POST', '/pt-packages', one.admin, ptBody(`Bad promo PT ${percent}`, { promotions: [promotion({ percent_off: percent })] }))
      assert.equal(pt.status, 400, `pt ${percent}: ${JSON.stringify(pt.body)}`)
    }
    const pass = created(await send('POST', '/class-packages', one.admin, bundleBody('Good promo')))
    const later = await send('PATCH', `/class-packages/${pass.id}`, one.admin, { promotions: [promotion({ percent_off: 100 })] })
    assert.equal(later.status, 400, 'nor added to one that exists')
    const [saved] = await harness.db.select().from(schema.classPackages).where(like(schema.classPackages.name, `${NAME} Bad promo%`))
    assert.equal(saved, undefined)
  })

  test('PKG-22 a trial Class Package saved without validity_days is refused', async () => {
    const res = await send('POST', '/class-packages', one.admin, {
      name: `${NAME} Trial`,
      kind: 'trial',
      credits: 1,
      price_sgd: '20.00',
    })
    assert.equal(res.status, 400, JSON.stringify(res.body))
    const trial = created(await send('POST', '/class-packages', one.admin, {
      name: `${NAME} Trial`,
      kind: 'trial',
      credits: 1,
      validity_days: 14,
      price_sgd: '20.00',
    }))
    const cleared = await send('PATCH', `/class-packages/${trial.id}`, one.admin, { validity_days: null })
    assert.equal(cleared.status, 400, `nor cleared later: ${JSON.stringify(cleared.body)}`)
  })

  test('PKG-23 a PT package with validity days missing, 0 or above 3650 is refused', async () => {
    const { validity_days: _omit, ...missing } = ptBody('No validity')
    for (const body of [missing, ptBody('Zero validity', { validity_days: 0 }), ptBody('Eternal', { validity_days: 3651 })]) {
      const res = await send('POST', '/pt-packages', one.admin, body)
      assert.equal(res.status, 400, `${JSON.stringify(body)}: ${JSON.stringify(res.body)}`)
    }
    const decade = created(await send('POST', '/pt-packages', one.admin, ptBody('Decade', { validity_days: 3650 })))
    assert.equal(decade.validity_days, 3650)
  })

  test('PKG-24 changing a PT package’s validity days leaves a sold package’s expiry and only moves future sales', async () => {
    const pt = created(await send('POST', '/pt-packages', one.admin, ptBody('Validity', { validity_days: 30 })))
    const sale = () =>
      purchaseSvc.grantPackage(one.id, {
        clientId: memberId,
        purchaseId: null,
        amountSgd: '400.00',
        packageKind: 'pt',
        packageId: pt.id,
      })
    const row = async (id: string) =>
      (await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, id)))[0]!

    const sold = await sale()
    const before = await row(sold.clientPackageId)
    assert.equal(before.validityDays, 30)

    const edited = await send('PATCH', `/pt-packages/${pt.id}`, one.admin, { validity_days: 120 })
    assert.equal(edited.status, 200, JSON.stringify(edited.body))
    assert.equal(edited.body.validity_days, 120)

    const after = await row(sold.clientPackageId)
    assert.equal(after.validityDays, 30, 'the sold package keeps the figure it was sold with')
    assert.deepEqual(after.expiresAt, before.expiresAt, 'and its expiry')
    const next = await row((await sale()).clientPackageId)
    assert.equal(next.validityDays, 120, 'the next sale uses the new figure')
  })

  test('PKG-33 another studio’s admin can neither see nor change a class or PT package', async () => {
    const pass = created(await send('POST', '/class-packages', one.admin, bundleBody('Ours')))
    const pt = created(await send('POST', '/pt-packages', one.admin, ptBody('Ours PT')))

    const classList = await send('GET', '/class-packages', two.admin)
    assert.ok(!classList.body.class_packages.some((p: { id: string }) => p.id === pass.id))
    const ptList = await send('GET', '/pt-packages', two.admin)
    assert.ok(!ptList.body.pt_packages.some((p: { id: string }) => p.id === pt.id))

    for (const [kind, id] of [['class-packages', pass.id], ['pt-packages', pt.id]]) {
      for (const [method, path, body] of [
        ['GET', `/${kind}/${id}`, undefined],
        ['PATCH', `/${kind}/${id}`, { price_sgd: '1.00' }],
        ['POST', `/${kind}/${id}/archive`, undefined],
        ['DELETE', `/${kind}/${id}`, undefined],
      ] as const) {
        const res = await send(method, path, two.admin, body)
        assert.equal(res.status, 404, `${method} ${path}: ${JSON.stringify(res.body)}`)
      }
    }
    const [classRow] = await harness.db.select().from(schema.classPackages).where(eq(schema.classPackages.id, pass.id))
    const [ptRow] = await harness.db.select().from(schema.ptPackages).where(eq(schema.ptPackages.id, pt.id))
    assert.equal(classRow!.priceSgd, '100.00')
    assert.equal(classRow!.status, 'active')
    assert.equal(ptRow!.priceSgd, '400.00')
    assert.equal(ptRow!.status, 'active')
  })

  /* ── Marketing ──────────────────────────────────────────────────────── */

  test('CAT-08 an admin reads the studio’s marketing copy, edits it, and reads the edit back', async () => {
    const current = await send('GET', '/marketing', one.admin)
    assert.equal(current.status, 200, JSON.stringify(current.body))
    assert.equal(typeof current.body.hero_heading, 'string')

    const copy = {
      hero_heading: `Breathe ${run}`,
      hero_subheading: 'Morning flows before work.',
      pricing_blurb: 'First class on us.',
      testimonials: [{ quote: 'Life-changing.', author: 'A regular' }],
      footer_text: 'See you on the mat.',
    }
    const saved = await send('PATCH', '/marketing', one.admin, copy)
    assert.equal(saved.status, 200, JSON.stringify(saved.body))
    const read = await send('GET', '/marketing', one.admin)
    assert.deepEqual(
      {
        hero_heading: read.body.hero_heading,
        hero_subheading: read.body.hero_subheading,
        pricing_blurb: read.body.pricing_blurb,
        testimonials: read.body.testimonials,
        footer_text: read.body.footer_text,
      },
      copy,
    )

    const blank = await send('PATCH', '/marketing', one.admin, { hero_heading: '', hero_subheading: 'x' })
    assert.equal(blank.status, 400, 'the hero heading is required')
    const missing = await send('PATCH', '/marketing', one.admin, { pricing_blurb: 'no hero' })
    assert.equal(missing.status, 400, 'and so is the subheading')
  })

  test('CAT-09 one studio’s marketing edit leaves another studio’s copy as it was', async () => {
    const theirsBefore = await send('GET', '/marketing', two.admin)
    assert.equal(theirsBefore.status, 200)

    const res = await send('PATCH', '/marketing', one.admin, { hero_heading: `Ours only ${run}`, hero_subheading: 'Ours.' })
    assert.equal(res.status, 200, JSON.stringify(res.body))

    const theirsAfter = await send('GET', '/marketing', two.admin)
    assert.deepEqual(theirsAfter.body, theirsBefore.body)
    assert.notEqual(theirsAfter.body.hero_heading, `Ours only ${run}`)
  })

  /* ── Feature flags ──────────────────────────────────────────────────── */

  test('TEN-25 a feature flag an admin turns on is on for that studio only', async () => {
    const key = `${FLAG}_reports`
    const on = await send('PATCH', `/feature-flags/${key}`, one.admin, { enabled: true })
    assert.equal(on.status, 200, JSON.stringify(on.body))
    assert.deepEqual({ key: on.body.key, enabled: on.body.enabled }, { key, enabled: true })

    const ours = await send('GET', '/feature-flags', one.admin)
    assert.equal(ours.status, 200, JSON.stringify(ours.body))
    assert.equal(ours.body.feature_flags.find((f: { key: string }) => f.key === key)?.enabled, true)
    const theirs = await send('GET', '/feature-flags', two.admin)
    assert.equal(theirs.status, 200, JSON.stringify(theirs.body))
    assert.ok(!theirs.body.feature_flags.some((f: { key: string; enabled: boolean }) => f.key === key && f.enabled))
    assert.equal(flags.isEnabled(one.id, key), true, 'the app reads it as on here')
    assert.equal(flags.isEnabled(two.id, key), false, 'and off at the other studio')

    const theirOwn = await send('PATCH', `/feature-flags/${key}`, two.admin, { enabled: false })
    assert.equal(theirOwn.status, 200, 'the other studio switches its own copy of the key')
    assert.equal(flags.isEnabled(one.id, key), true, 'which leaves this one alone')

    const off = await send('PATCH', `/feature-flags/${key}`, one.admin, { enabled: false })
    assert.equal(off.body.enabled, false)
    assert.equal(flags.isEnabled(one.id, key), false)

    const notBool = await send('PATCH', `/feature-flags/${key}`, one.admin, { enabled: 'yes' })
    assert.equal(notBool.status, 400)
    const badKey = await send('PATCH', '/feature-flags/Not%20a%20key!', one.admin, { enabled: true })
    assert.equal(badKey.status, 400)
  })
})
