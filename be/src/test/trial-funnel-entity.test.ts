import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { inTenantContext, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { memberFixtures, type Staff } from './member-fixtures'

/**
 * The Customers page's Trials filter and Trial Funnel read for one Entity,
 * through the admin clients API.
 *
 * One studio with two Entities (A = its first, B = a second one made here) and
 * seven members whose trials, bundles and attendance are placed so each
 * question has a different answer per Entity:
 *
 *   m1  trial in A, attended it                    -> not converted
 *   m2  trial in A and in B, attended the B one;   -> converted in B only
 *       paid for a B bundle
 *   m3  trial in B; paid for an A bundle, attended -> converted in A only, so
 *       a class on that bundle                        not in B
 *   m4  trial in A and a comped A bundle           -> never converted
 *   m5  a trial with no catalogue package (legacy) -> in no Entity
 *   m6  trial in B; paid for a B private package   -> converted in B
 *   m7  trial in A; paid for an A bundle           -> converted in A
 *   m8  no trial; paid for an A bundle             -> not in the funnel at all
 *
 * Without an Entity: 7 trials (m1-m7), attended 2 (m1, m2), converted 4 (m2,
 * m3, m6, m7). In A: m1, m2, m4, m7 -> 4 trials, 1 attended, 1 converted. In B:
 * m2, m3, m6 -> 3 trials, 1 attended, 2 converted.
 */
describe('trial funnel by entity', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let fixtures!: ReturnType<typeof memberFixtures>
  let one!: { id: string; slug: string }
  let two!: { id: string; slug: string }
  let adminOne!: Staff
  let adminTwo!: Staff

  const run = Date.now().toString(36)
  const PREFIX = `Fun${run}`
  const DOMAIN = `trial-funnel-${run}.test`
  const DAY = 24 * 60 * 60 * 1000

  const memberIds: string[] = []
  const m: Record<string, string> = {}
  let entityA!: string
  let entityB!: string
  let foreignEntity!: string
  let instructorId!: string
  let classTypeId!: string
  let roomId!: string
  let locationId!: string
  let trialA!: string
  let trialB!: string
  let bundleA!: string
  let bundleB!: string
  let ptB!: string
  const createdEntityIds: string[] = []

  const get = async <T>(path: string, headers: Record<string, string>) => {
    const res = await harness.app.request(`/api/v1/portal/admin/clients${path}`, { headers })
    return { status: res.status, body: (await res.json()) as T }
  }

  type ListBody = {
    clients: {
      id: string
      name: string
      trial_started_at: string | null
      attended: number
      converted: boolean
    }[]
    total: number
    funnel: { trials: number; attended: number; converted: number } | null
  }

  const trials = (entity?: string, pageSize = 200) =>
    get<ListBody>(
      `?q=${PREFIX}&filter=trials&page_size=${pageSize}${entity ? `&entity=${entity}` : ''}`,
      adminOne.headers,
    )
  const names = (body: ListBody) => body.clients.map(c => c.name.replace(`${PREFIX} `, '')).sort()

  const member = async (name: string) => {
    const n = memberIds.length + 1
    const [row] = await harness.db
      .insert(schema.clients)
      .values({
        tenantId: one.id,
        email: `${name}-${run}@${DOMAIN}`,
        name: `${PREFIX} ${name}`,
        phone: `+65 7${run.slice(-3)} ${String(n).padStart(4, '0')}`,
        authUserId: `auth_${run}_fun_${name}`,
      })
      .returning()
    memberIds.push(row!.id)
    m[name] = row!.id
    return row!.id
  }

  const hold = (clientId: string, over: Record<string, unknown>) =>
    harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: one.id,
        clientId,
        kind: 'credit_bundle',
        sourceClassPackageId: bundleA,
        validityDays: 30,
        creditsOrSessionsRemaining: 5,
        amountPaidSgd: '100.00',
        listPriceSgd: '200.00',
        purchaseId: null,
        ...over,
      })
      .returning()
      .then(r => r[0]!.id)

  const heldTrial = (clientId: string, catalogId: string | null, daysAgo: number) =>
    hold(clientId, {
      kind: 'trial',
      sourceClassPackageId: catalogId,
      amountPaidSgd: '0.00',
      listPriceSgd: '20.00',
      creditsOrSessionsRemaining: 0,
      active: false,
      purchasedAt: new Date(Date.now() - daysAgo * DAY),
      expiresAt: new Date(Date.now() - 1 * DAY),
    })

  const klass = (startsAt: Date) =>
    harness.db
      .insert(schema.classes)
      .values({
        tenantId: one.id,
        classTypeId,
        mainInstructorId: instructorId,
        locationId,
        roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
        capacityOnline: 10,
        creditCost: 1,
        createdByStaffId: instructorId,
      })
      .returning()
      .then(r => r[0]!.id)

  const attend = async (clientId: string, clientPackageId: string, state: 'attended' | 'no_show' = 'attended') =>
    harness.db.insert(schema.bookings).values({
      tenantId: one.id,
      clientId,
      kind: 'class',
      classId: await klass(new Date(Date.now() - 5 * DAY)),
      clientPackageId,
      creditsOrSessionsUsed: 1,
      qrToken: randomUUID(),
      code: `C${randomUUID().slice(0, 8)}`,
      checkInState: state,
    })

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    fixtures = memberFixtures(harness, schema, DOMAIN)
    ;({ one, two } = harness.tenants)
    adminOne = await fixtures.staffAt(one, fixtures.at('admin-one'), 'admin')
    adminTwo = await fixtures.staffAt(two, fixtures.at('admin-two'), 'admin')

    const classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    const classPackagesSvc = inTenantContext(await import('../services/packages/class-packages'))
    const ptPackagesSvc = inTenantContext(await import('../services/packages/pt-packages'))
    const entitiesSvc = inTenantContext(await import('../services/catalog/entities'))

    const first = await entitiesSvc.defaultEntityId(one.id)
    assert.ok(first, 'the studio starts with an Entity')
    entityA = first
    const b = await entitiesSvc.createEntity(one.id, { name: `${PREFIX} Pilates`, slug: `${PREFIX.toLowerCase()}-pilates` })
    entityB = b.id
    const f = await entitiesSvc.createEntity(two.id, { name: `${PREFIX} Elsewhere`, slug: `${PREFIX.toLowerCase()}-elsewhere` })
    foreignEntity = f.id
    createdEntityIds.push(entityB, foreignEntity)

    const [location] = await harness.db.select().from(schema.locations).where(eq(schema.locations.tenantId, one.id))
    locationId = location!.id
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: one.id, locationId, name: `${PREFIX} Room`, capacity: 20 })
      .returning()
    roomId = room!.id
    classTypeId = (await classTypesSvc.createClassType(one.id, { name: `${PREFIX} Flow`, description: null })).id
    const [instructor] = await harness.db
      .insert(schema.staffUsers)
      .values({
        tenantId: one.id,
        email: fixtures.at('instructor'),
        name: `${PREFIX} Teacher`,
        role: 'instructor',
        status: 'active',
        authUserId: `auth_${run}_fun_instructor`,
      })
      .returning()
    instructorId = instructor!.id
    await harness.db.insert(schema.instructors).values({ tenantId: one.id, staffUserId: instructorId })

    const classPackage = async (name: string, kind: 'trial' | 'credit_bundle', entityId: string) =>
      (
        await classPackagesSvc.createClassPackage(one.id, {
          name: `${PREFIX} ${name}`,
          kind,
          credits: kind === 'trial' ? 1 : 10,
          validityDays: kind === 'trial' ? 7 : 30,
          priceSgd: kind === 'trial' ? '20.00' : '200.00',
          entityId,
        })
      ).id
    trialA = await classPackage('Trial A', 'trial', entityA)
    trialB = await classPackage('Trial B', 'trial', entityB)
    bundleA = await classPackage('Bundle A', 'credit_bundle', entityA)
    bundleB = await classPackage('Bundle B', 'credit_bundle', entityB)
    ptB = (
      await ptPackagesSvc.createPtPackage(one.id, {
        name: `${PREFIX} Private B`,
        sessionType: '1on1',
        numSessions: 5,
        validityDays: 90,
        priceSgd: '500.00',
        entityId: entityB,
      })
    ).id

    for (const name of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']) await member(name)

    const t1 = await heldTrial(m.m1!, trialA, 20)
    await attend(m.m1!, t1)
    await heldTrial(m.m2!, trialA, 30)
    const t2b = await heldTrial(m.m2!, trialB, 10)
    await attend(m.m2!, t2b)
    await hold(m.m2!, { sourceClassPackageId: bundleB })
    await heldTrial(m.m3!, trialB, 15)
    const b3 = await hold(m.m3!, { sourceClassPackageId: bundleA })
    await attend(m.m3!, b3)
    await heldTrial(m.m4!, trialA, 12)
    await hold(m.m4!, { sourceClassPackageId: bundleA, complimentary: true, amountPaidSgd: '0.00' })
    await heldTrial(m.m5!, null, 8)
    await heldTrial(m.m6!, trialB, 6)
    await hold(m.m6!, { kind: 'pt', sourceClassPackageId: null, sourcePtPackageId: ptB, amountPaidSgd: '500.00', listPriceSgd: '500.00' })
    await heldTrial(m.m7!, trialA, 4)
    await hold(m.m7!, { sourceClassPackageId: bundleA })
    await hold(m.m8!, { sourceClassPackageId: bundleA })
  })

  after(async () => {
    if (!harness) return
    if (memberIds.length > 0) {
      const ids = sql.join(memberIds.map(id => sql`${id}::uuid`), sql`, `)
      await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${ids})`)
      await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${ids})`)
      await harness.db.execute(sql`DELETE FROM clients WHERE id IN (${ids})`)
    }
    if (classTypeId) await harness.db.execute(sql`DELETE FROM classes WHERE class_type_id = ${classTypeId}::uuid`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${`${PREFIX} %`}`)
    await harness.db.execute(sql`DELETE FROM pt_packages WHERE name LIKE ${`${PREFIX} %`}`)
    if (roomId) await harness.db.execute(sql`DELETE FROM rooms WHERE id = ${roomId}::uuid`)
    if (classTypeId) await harness.db.execute(sql`DELETE FROM class_types WHERE id = ${classTypeId}::uuid`)
    if (instructorId) await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id = ${instructorId}::uuid`)
    for (const id of createdEntityIds) await harness.db.execute(sql`DELETE FROM entities WHERE id = ${id}::uuid`)
    await fixtures?.cleanup()
    await harness.close()
  })

  test('CUS-31 the Trials filter and funnel under an Entity count only members with a trial in it; without one, every trial counts once per member', async () => {
    const all = await trials()
    assert.deepEqual(names(all.body), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'], 'a legacy trial with no package still counts with no Entity')
    assert.equal(all.body.total, 7)
    assert.deepEqual(all.body.funnel, { trials: 7, attended: 2, converted: 4 })

    const inA = await trials(entityA)
    assert.equal(inA.status, 200)
    assert.deepEqual(names(inA.body), ['m1', 'm2', 'm4', 'm7'])
    assert.equal(inA.body.total, 4, 'the pager total follows the Entity')
    assert.equal(inA.body.funnel?.trials, 4)

    const inB = await trials(entityB)
    assert.deepEqual(names(inB.body), ['m2', 'm3', 'm6'], 'm2 holds a trial in each Entity and shows under both')
    assert.equal(inB.body.total, 3)
    assert.equal(inB.body.funnel?.trials, 3)

    const small = await trials(entityA, 1)
    assert.equal(small.body.clients.length, 1)
    assert.equal(small.body.funnel?.trials, 4, 'the funnel counts every matching member, not the page')
  })

  test('CUS-32 the funnel tiles equal the rows under the same filter', async () => {
    for (const entity of [undefined, entityA, entityB]) {
      const { body } = await trials(entity)
      assert.ok(body.funnel)
      assert.equal(body.funnel.trials, body.clients.length)
      assert.equal(body.funnel.attended, body.clients.filter(c => c.attended > 0).length)
      assert.equal(body.funnel.converted, body.clients.filter(c => c.converted).length)
    }
  })

  test("CUS-33 Trial Attendance under an Entity counts only classes that Entity's trial paid for", async () => {
    const inA = await trials(entityA)
    const rowA = Object.fromEntries(inA.body.clients.map(c => [c.name.replace(`${PREFIX} `, ''), c.attended]))
    assert.deepEqual(rowA, { m1: 1, m2: 0, m4: 0, m7: 0 }, 'm2 attended on the B trial, which is not an A attendance')
    assert.equal(inA.body.funnel?.attended, 1)

    const inB = await trials(entityB)
    const rowB = Object.fromEntries(inB.body.clients.map(c => [c.name.replace(`${PREFIX} `, ''), c.attended]))
    assert.deepEqual(rowB, { m2: 1, m3: 0, m6: 0 }, 'm3 attended on a bundle, never on the trial')
    assert.equal(inB.body.funnel?.attended, 1)

    const all = await trials()
    const rowAll = Object.fromEntries(all.body.clients.map(c => [c.name.replace(`${PREFIX} `, ''), c.attended]))
    assert.equal(rowAll.m1, 1)
    assert.equal(rowAll.m2, 1, 'with no Entity every trial counts, as before')
  })

  test('CUS-34 Converted under an Entity means paid for a non-trial, non-comp package of that Entity', async () => {
    const converted = (body: ListBody) =>
      body.clients
        .filter(c => c.converted)
        .map(c => c.name.replace(`${PREFIX} `, ''))
        .sort()

    const all = await trials()
    assert.deepEqual(converted(all.body), ['m2', 'm3', 'm6', 'm7'], 'with no Entity, a paid package of any Entity converts; a comp and a legacy trial do not')

    const inA = await trials(entityA)
    assert.deepEqual(converted(inA.body), ['m7'], "m2 paid for Pilates only; m4's A bundle was a comp")
    assert.equal(inA.body.funnel?.converted, 1)

    const inB = await trials(entityB)
    assert.deepEqual(converted(inB.body), ['m2', 'm6'], 'a paid private package of the Entity converts; m3 paid for an A bundle only')
    assert.equal(inB.body.funnel?.converted, 2)
  })

  test('CUS-35 trial_started_at is the first trial in the chosen Entity', async () => {
    const started = (body: ListBody, name: string) => {
      const row = body.clients.find(c => c.name === `${PREFIX} ${name}`)
      assert.ok(row?.trial_started_at, `${name} has a trial`)
      return Math.round((Date.now() - new Date(row.trial_started_at).getTime()) / DAY)
    }
    assert.equal(started((await trials()).body, 'm2'), 30, 'the earliest of the two trials')
    assert.equal(started((await trials(entityA)).body, 'm2'), 30)
    assert.equal(started((await trials(entityB)).body, 'm2'), 10, 'only the B trial counts under B')
  })

  test('CUS-36 an Entity outside the Trials filter changes nothing; a malformed one is refused; a foreign or unknown Entity matches nobody', async () => {
    const plain = await get<ListBody>(`?q=${PREFIX}&filter=active&page_size=200`, adminOne.headers)
    const asked = await get<ListBody>(`?q=${PREFIX}&filter=active&page_size=200&entity=${entityB}`, adminOne.headers)
    assert.equal(asked.status, 200)
    assert.equal(asked.body.total, plain.body.total, 'ignored outside Trials')
    assert.equal(asked.body.funnel, null)
    const unfiltered = await get<ListBody>(`?q=${PREFIX}&page_size=200&entity=${entityB}`, adminOne.headers)
    assert.equal(unfiltered.body.total, 8)

    for (const entity of [foreignEntity, randomUUID()]) {
      const { status, body } = await trials(entity)
      assert.equal(status, 200)
      assert.equal(body.total, 0)
      assert.deepEqual(body.funnel, { trials: 0, attended: 0, converted: 0 })
    }

    const notAnId = await get<unknown>(`?filter=trials&entity=pilates`, adminOne.headers)
    assert.equal(notAnId.status, 400)

    // The other studio's admin, naming this studio's Entity, sees none of its members.
    const theirs = await get<ListBody>(`?q=${PREFIX}&filter=trials&page_size=200&entity=${entityA}`, adminTwo.headers)
    assert.equal(theirs.body.total, 0)
    assert.deepEqual(theirs.body.funnel, { trials: 0, attended: 0, converted: 0 })
  })
})
