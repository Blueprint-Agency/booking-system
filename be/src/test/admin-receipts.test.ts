import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { receiptFixtures } from './receipt-fixtures'

const run = Date.now().toString(36)
const DOMAIN = `${run}.admin-receipts.test`

/**
 * A studio admin's Receipts (#389): every Receipt in the studio, at
 * `/portal/admin/receipts`, searched and filtered, opened, and downloaded as
 * the PDF the member gets. Asked over HTTP as the studio's Admin; the Receipts
 * are issued the one way any is (`receipt-fixtures.ts`).
 *
 * Instructors are refused every route here: the authorization matrix says so
 * for each of them (`authorization-matrix.test.ts`).
 *
 * Written from the INV rows of the Scenario Inventory
 * (`docs/md/test-scenarios.md`).
 */
describe('a studio admin reads every Receipt in the studio', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let made!: ReturnType<typeof receiptFixtures>

  type Studio = { id: string; slug: string }
  type Member = { clientId: string; email: string; name: string; headers: Record<string, string> }
  let one!: Studio
  let two!: Studio
  let adminOfOne!: Record<string, string>

  async function expectStatus(res: Response, status: number): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    return text ? JSON.parse(text) : {}
  }

  let people = 0
  /** A member of `at`, signed in to its booking app. */
  async function member(at: Studio, name: string): Promise<Member> {
    const email = `member-${people++}-${at.slug}@${DOMAIN}`
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(and(eq(schema.clientAuthUsers.email, email), eq(schema.clientAuthUsers.tenantId, at.id)))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, email, name, headers }
  }

  /** A staff member of `at` with `role`, signed in to its portal. */
  async function staff(at: Studio, role: 'admin' | 'instructor'): Promise<Record<string, string>> {
    const email = `${role}-${people++}-${at.slug}@${DOMAIN}`
    const headers = await harness.signInAs('staff', email, at)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.email, email), eq(schema.staffAuthUsers.tenantId, at.id)))
    await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: at.id, email, name: `Receipts ${role}`, role, status: 'active', authUserId: user!.id })
    return headers
  }

  const listed = async (query = '', headers = adminOfOne) =>
    expectStatus(await harness.app.request(`/api/v1/portal/admin/receipts${query}`, { headers }), 200)

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    made = receiptFixtures(harness)
    ;({ one, two } = harness.tenants)
    adminOfOne = await staff(one, 'admin')
  })

  after(async () => {
    if (!harness) return
    try {
      await made?.cleanup()
      const ours = `%@${DOMAIN}`
      const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
      await harness.db.execute(sql`DELETE FROM receipts WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM stripe_payments WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    } finally {
      await harness.close()
    }
  })

  test("INV-40 an Admin lists every member's Receipts in the studio, newest first, a page at a time, and none of another studio's", async () => {
    const mia = await member(one, `Mia ${run} lists`)
    const leo = await member(one, `Leo ${run} lists`)
    const elsewhere = await member(two, `Ivy ${run} lists`)
    const first = await made.issueFor(one.id, mia.clientId)
    const second = await made.issueFor(one.id, leo.clientId)
    const third = await made.issueFor(one.id, mia.clientId)
    const theirs = await made.issueFor(two.id, elsewhere.clientId)

    const all = await listed(`?q=${encodeURIComponent(`${run} lists`)}`)
    assert.equal(all.total, 3, "both members' Receipts, and not the other studio's")
    assert.deepEqual(
      all.receipts.map((r: any) => r.id),
      [third.id, second.id, first.id],
      'newest first',
    )
    const [row] = all.receipts
    assert.deepEqual(row, {
      id: third.id,
      number: third.displayNumber,
      item: 'Ten pack',
      kind: 'class_package',
      issued_at: third.issuedAt.toISOString(),
      total_sgd: '135.00',
      status: 'issued',
      client_id: mia.clientId,
      buyer_name: mia.name,
      buyer_email: mia.email,
    })

    assert.ok(!all.receipts.some((r: any) => r.id === theirs.id), "another studio's Receipt is never listed, though its buyer's name matches")

    const page1 = await listed(`?q=${encodeURIComponent(`${run} lists`)}&page_size=2`)
    const page2 = await listed(`?q=${encodeURIComponent(`${run} lists`)}&page_size=2&page=2`)
    assert.deepEqual(
      [...page1.receipts, ...page2.receipts].map((r: any) => r.id),
      [third.id, second.id, first.id],
      'the pages together are the list',
    )
    assert.deepEqual([page2.total, page2.page, page2.page_size], [3, 2, 2])
  })

  test("INV-41 an Admin finds a Receipt by its number, or by part of the member's name or email, in any case", async () => {
    const ada = await member(one, `Ada Finds ${run}`)
    const kai = await member(one, `Kai Finds ${run}`)
    const adas = await made.issueFor(one.id, ada.clientId)
    const kais = await made.issueFor(one.id, kai.clientId)
    const found = async (q: string) => (await listed(`?q=${encodeURIComponent(q)}`)).receipts.map((r: any) => r.id)

    assert.deepEqual(await found(kais.displayNumber), [kais.id], 'by number')
    assert.deepEqual(await found(`ada finds ${run}`.toUpperCase()), [adas.id], 'by name')
    assert.deepEqual(await found(kai.email.split('@')[0]!), [kais.id], 'by email')
    assert.deepEqual(await found(`finds ${run}`), [kais.id, adas.id], 'every match, newest first')
    assert.deepEqual(await found(`nobody-${run}`), [], 'and nothing for a search that matches nothing')
  })

  test('INV-42 the date, kind and status filters each narrow the list to the Receipts they name', async () => {
    const tag = `Filters ${run}`
    const noa = await member(one, tag)
    const pack = await made.issueFor(one.id, noa.clientId)
    const tee = await made.issueFor(one.id, noa.clientId, { kind: 'merch', item: 'Studio tee' })
    const refunded = await made.issueFor(one.id, noa.clientId, { kind: 'workshop', item: 'Arm balance workshop' })
    await made.stampRefunded(refunded)
    const ids = async (filter: string) =>
      (await listed(`?q=${encodeURIComponent(tag)}${filter}`)).receipts.map((r: any) => r.id).sort()
    const sorted = (...rs: Array<{ id: string }>) => rs.map(r => r.id).sort()

    assert.deepEqual(await ids(''), sorted(pack, tee, refunded))
    assert.deepEqual(await ids('&kind=merch'), sorted(tee))
    assert.deepEqual(await ids('&kind=class_package'), sorted(pack))
    assert.deepEqual(await ids('&status=refunded'), sorted(refunded))
    assert.deepEqual(await ids('&status=issued'), sorted(pack, tee))
    const [row] = (await listed(`?q=${encodeURIComponent(tag)}&status=refunded`)).receipts
    assert.equal(row.status, 'refunded')

    // Today in the studio's own time, and the days either side of it.
    const sgDay = (offsetDays: number) => new Date(Date.now() + 8 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10)
    assert.deepEqual(await ids(`&from=${sgDay(0)}&to=${sgDay(0)}`), sorted(pack, tee, refunded), 'today holds them')
    assert.deepEqual(await ids(`&from=${sgDay(1)}`), [], 'nothing from tomorrow')
    assert.deepEqual(await ids(`&to=${sgDay(-1)}`), [], 'nothing up to yesterday')

    for (const bad of ['?from=yesterday', '?kind=gift_card', '?status=void']) {
      await expectStatus(await harness.app.request(`/api/v1/portal/admin/receipts${bad}`, { headers: adminOfOne }), 400)
    }
  })

  test('INV-43 an Admin opens a Receipt and downloads its PDF, and both are exactly what the member sees', async () => {
    const zoe = await member(one, `Zoe Opens ${run}`)
    const receipt = await made.issueFor(one.id, zoe.clientId)
    const get = (path: string, headers: Record<string, string>) => harness.app.request(path, { headers })

    const theirs = await expectStatus(await get(`/api/v1/me/receipts/${receipt.id}`, zoe.headers), 200)
    const ours = await expectStatus(await get(`/api/v1/portal/admin/receipts/${receipt.id}`, adminOfOne), 200)
    assert.deepEqual(ours, theirs)
    assert.equal(ours.number, receipt.displayNumber)
    assert.deepEqual(ours.buyer, { name: zoe.name, email: zoe.email })
    assert.deepEqual(
      ours.lines.map((l: any) => [l.description, l.list_price_sgd, l.discount_sgd, l.amount_sgd]),
      [['Ten pack', '150.00', '15.00', '135.00']],
    )
    assert.equal(ours.total_sgd, '135.00')

    const memberPdf = await get(`/api/v1/me/receipts/${receipt.id}/pdf`, zoe.headers)
    const adminPdf = await get(`/api/v1/portal/admin/receipts/${receipt.id}/pdf`, adminOfOne)
    assert.equal(adminPdf.status, 200, adminPdf.status === 200 ? '' : await adminPdf.text())
    assert.equal(adminPdf.headers.get('Content-Type'), 'application/pdf')
    assert.equal(adminPdf.headers.get('Content-Disposition'), `attachment; filename="${receipt.displayNumber}.pdf"`)
    assert.deepEqual(
      new Uint8Array(await adminPdf.arrayBuffer()),
      new Uint8Array(await memberPdf.arrayBuffer()),
      'the same document, byte for byte',
    )
  })

  test("INV-44 another studio's Receipt is 404 receipt_not_found to an Admin, as for an id that names nothing", async () => {
    const ivy = await member(two, `Ivy Elsewhere ${run}`)
    const theirs = await made.issueFor(two.id, ivy.clientId)
    for (const id of [theirs.id, randomUUID()]) {
      for (const path of [`/api/v1/portal/admin/receipts/${id}`, `/api/v1/portal/admin/receipts/${id}/pdf`]) {
        const res = await expectStatus(await harness.app.request(path, { headers: adminOfOne }), 404)
        assert.equal(res.error, 'receipt_not_found', path)
      }
    }
    assert.equal((await listed(`?q=${encodeURIComponent(theirs.displayNumber)}`)).receipts.some((r: any) => r.id === theirs.id), false)
  })

  test("INV-45 each payment on a member's detail page names the Receipt its Purchase was given, and a part payment names none", async () => {
    const eve = await member(one, `Eve Payments ${run}`)
    const receipt = await made.issueFor(one.id, eve.clientId)
    // A Purchase part-paid and still open: its payment is banked, and no
    // Receipt exists until the Balance reaches zero.
    const [open] = await harness.db.execute<{ id: string }>(sql`
      INSERT INTO purchases (tenant_id, client_id, kind, total_sgd, amount_paid_sgd, status, metadata)
      VALUES (${one.id}, ${eve.clientId}, 'class_package', '300.00', '100.00', 'open', ${JSON.stringify({ item_name: 'Unlimited year' })}::jsonb)
      RETURNING id`)
    await harness.db.execute(sql`
      INSERT INTO stripe_payments (tenant_id, purchase_id, client_id, payment_intent_id, amount_sgd, kind, status, method, card_brand, card_last4)
      VALUES (${one.id}, ${open!.id}, ${eve.clientId}, ${`pi_admin_receipts_${randomUUID().slice(0, 12)}`}, '100.00',
              'class_package', 'succeeded', 'card', 'visa', '4242')`)

    const detail = await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/clients/${eve.clientId}`, { headers: adminOfOne }),
      200,
    )
    const byItem = Object.fromEntries(detail.payments.map((p: any) => [p.item_name, p]))
    assert.equal(byItem['Ten pack'].receipt_id, receipt.id, 'the paid sale links to its Receipt')
    assert.equal(byItem['Unlimited year'].receipt_id, null, 'an open Purchase has no Receipt yet')
    assert.ok('receipt_url' in byItem['Ten pack'], "the provider's receipt link stays in the payload for now")
  })
})
