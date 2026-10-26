import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { ownAccountId, stripeWebhookPath, type StripeFake } from './stripe-fake'

/**
 * Staff attention, dismissals (#476, #482): an admin can dismiss a Needs-action
 * item of a dismissable kind for the whole studio; the first such kind is
 * `part_payment_silent`, a part-paid Purchase the member has stopped paying
 * towards for 14 days. The item goes when the Purchase is refunded, paid in
 * full or dismissed.
 *
 * Every test makes a studio of its own, so the items a test sees are its own.
 */
describe('Staff attention: dismissals', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')
  let fake!: StripeFake

  const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
  const DAY = 24 * 60 * 60 * 1000
  const KIND = 'part_payment_silent'

  type Studio = { id: string; slug: string }
  type Staff = { headers: Record<string, string>; id: string; name: string }

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
    const slug = `dsm-${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({ slug, name: 'Dismissal Studio', adminEmail: `owner@${slug}.test` })
    fake.ownAccount({ id: tenant.id, slug })
    return { id: tenant.id, slug }
  }

  const staffAt = async (studio: Studio, name: string, role: 'admin' | 'instructor'): Promise<Staff> => {
    const email = `${name}@${studio.slug}.test`
    const headers = await harness.signInAs('staff', email, studio)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: studio.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning()
    if (role === 'instructor') await harness.db.insert(schema.instructors).values({ tenantId: studio.id, staffUserId: row!.id })
    return { headers, id: row!.id, name }
  }

  const memberAt = async (studio: Studio, name: string) => {
    const email = `${name.toLowerCase().replace(/\s+/g, '-')}@${studio.slug}.test`
    await harness.signInAs('client', email, studio)
    const [user] = await harness.db.select().from(schema.clientAuthUsers).where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: studio.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, name }
  }

  /** A 200.00 Purchase of "Ten pass", part-paid by one succeeded payment per entry, each landed `daysAgo` days ago. */
  const partPaid = async (
    studio: Studio,
    who: { clientId: string },
    opts: { payments: string[]; daysAgo: number },
  ) => {
    const landed = new Date(Date.now() - opts.daysAgo * DAY)
    const paid = opts.payments.reduce((sum, p) => sum + Number(p), 0).toFixed(2)
    const [purchase] = await harness.db
      .insert(schema.purchases)
      .values({
        tenantId: studio.id,
        clientId: who.clientId,
        kind: 'class_package',
        totalSgd: '200.00',
        amountPaidSgd: paid,
        status: 'open',
        metadata: { item_name: 'Ten pass' },
        partPaidAt: landed,
        createdAt: landed,
      })
      .returning({ id: schema.purchases.id })
    const intents: string[] = []
    for (const amount of opts.payments) {
      const intent = `pi_dsm_${randomUUID().slice(0, 12)}`
      intents.push(intent)
      await harness.db.insert(schema.stripePayments).values({
        tenantId: studio.id,
        paymentIntentId: intent,
        purchaseId: purchase!.id,
        amountSgd: amount,
        kind: 'class_package',
        clientId: who.clientId,
        status: 'succeeded',
        providerAccountId: ownAccountId(studio),
        createdAt: landed,
      })
    }
    return { purchaseId: purchase!.id, intents }
  }

  const panel = async (who: Staff) => json(await send('/portal/attention', who.headers), 200)
  const summary = async (who: Staff) => json(await send('/portal/attention/summary', who.headers), 200)
  const itemsOf = async (who: Staff, kind = KIND) =>
    ((await panel(who)).needs_action.groups as Array<{ items: Array<Record<string, any>> }>)
      .flatMap(g => g.items)
      .filter(i => i.kind === kind)
  const dismiss = (who: Staff, kind: string, subjectId: string) =>
    send('/portal/attention/dismissals', who.headers, 'POST', { kind, subject_id: subjectId })

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
    const { installStripeFake } = await import('./stripe-fake')
    fake = installStripeFake()
    fake.reply('refunds.create', { id: 're_fake', status: 'succeeded' })
    fake.reply('webhooks.constructEvent', (body: unknown) => JSON.parse(String(body)))
  })

  after(async () => {
    fake?.restore()
    harness?.clock.reset()
    await harness?.close()
  })

  test('ATN-50 a part-paid purchase silent for 14 days is a dismissable Payments item saying how much was paid of the total and when, linking to that purchase', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'boss', 'admin')
    const nia = await memberAt(studio, 'Nia Silent')
    const silent = await partPaid(studio, nia, { payments: ['40.00', '30.00'], daysAgo: 20 })
    const recent = await partPaid(studio, nia, { payments: ['50.00'], daysAgo: 3 })

    const items = await itemsOf(admin)
    assert.deepEqual(
      items.map(i => i.id),
      [`${KIND}:${silent.purchaseId}`],
      'only the purchase quiet for 14 days; one paid towards this week is mid-purchase',
    )
    assert.notEqual(recent.purchaseId, silent.purchaseId)
    const [item] = items
    assert.equal(item!.title, 'Nia Silent has paid S$70.00 of S$200.00 for Ten pass and stopped paying')
    assert.match(item!.detail, /^Last payment \w{3} \d{1,2} \w{3}, \d{1,2}:\d{2} [ap]m\. Refund it, or dismiss to keep waiting$/)
    assert.equal(item!.href, `/admin/purchases?purchase=${silent.purchaseId}`)
    assert.equal(item!.dismissable, true)
    assert.equal(item!.location, null)

    const group = (await panel(admin)).needs_action.groups.find((g: any) => g.items.some((i: any) => i.kind === KIND))
    assert.equal(group.key, 'payments_refunds')
  })

  test('ATN-51 dismissing it hides it for every admin, drops the bubble, and files an attention.dismissed audit row under the dismissing admin', async () => {
    const studio = await freshStudio()
    const ann = await staffAt(studio, 'ann', 'admin')
    const bob = await staffAt(studio, 'bob', 'admin')
    const who = await memberAt(studio, 'Pia Quiet')
    const { purchaseId } = await partPaid(studio, who, { payments: ['60.00'], daysAgo: 30 })

    const before = (await summary(bob)).needs_action
    assert.equal((await itemsOf(bob)).length, 1)

    assert.equal((await dismiss(ann, KIND, purchaseId)).status, 204)

    assert.deepEqual(await itemsOf(ann), [])
    assert.deepEqual(await itemsOf(bob), [], 'a dismissal is the studio’s, not the dismisser’s')
    assert.equal((await summary(bob)).needs_action, before - 1)

    const rows = await harness.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.tenantId, studio.id), eq(schema.auditLog.action, 'attention.dismissed')))
    assert.equal(rows.length, 1, 'recorded once, not also by the audit middleware')
    assert.equal(rows[0]!.actorStaffId, ann.id)
    assert.equal(rows[0]!.targetId, purchaseId)
    assert.deepEqual(rows[0]!.payload, { kind: KIND, subject_id: purchaseId })

    // The purchase itself is untouched: dismissing is "keep waiting".
    const [purchase] = await harness.db.select().from(schema.purchases).where(eq(schema.purchases.id, purchaseId))
    assert.equal(purchase!.status, 'open')
  })

  test('ATN-52 dismissing a kind that is not dismissable is 422 not_dismissable', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'boss', 'admin')
    for (const kind of ['instructor_pay_missing', 'pt_request_pending', 'no_such_kind']) {
      const body = await json(await dismiss(admin, kind, randomUUID()), 422)
      assert.equal(body.error, 'not_dismissable', kind)
    }
  })

  test('ATN-53 dismissing an item that is not open is 404: an unknown purchase, one dismissed already, or one that is not silent yet', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'boss', 'admin')
    const who = await memberAt(studio, 'Ray Recent')
    const recent = await partPaid(studio, who, { payments: ['50.00'], daysAgo: 2 })
    const quiet = await partPaid(studio, who, { payments: ['50.00'], daysAgo: 25 })

    assert.equal((await dismiss(admin, KIND, randomUUID())).status, 404)
    assert.equal((await dismiss(admin, KIND, recent.purchaseId)).status, 404)
    assert.equal((await dismiss(admin, KIND, quiet.purchaseId)).status, 204)
    assert.equal((await dismiss(admin, KIND, quiet.purchaseId)).status, 404)
  })

  test('ATN-54 an instructor cannot dismiss: 403, and nothing is recorded', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'boss', 'admin')
    const teacher = await staffAt(studio, 'teach', 'instructor')
    const who = await memberAt(studio, 'Sam Quiet')
    const { purchaseId } = await partPaid(studio, who, { payments: ['50.00'], daysAgo: 25 })

    assert.equal((await dismiss(teacher, KIND, purchaseId)).status, 403)
    assert.equal((await itemsOf(admin)).length, 1, 'still open')
    const rows = await harness.db
      .select()
      .from(schema.attentionDismissals)
      .where(eq(schema.attentionDismissals.tenantId, studio.id))
    assert.equal(rows.length, 0)
  })

  test('ATN-55 the item goes when the purchase is refunded or paid in full, and an instructor never sees it', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'boss', 'admin')
    const teacher = await staffAt(studio, 'teach', 'instructor')
    const who = await memberAt(studio, 'Tia Settled')
    const refunded = await partPaid(studio, who, { payments: ['60.00'], daysAgo: 21 })
    const finished = await partPaid(studio, who, { payments: ['50.00'], daysAgo: 21 })
    assert.equal((await itemsOf(admin)).length, 2)
    assert.deepEqual(await itemsOf(teacher), [])

    // Refunded: the admin's Refund button, then the provider's delivery.
    await json(
      await send(`/portal/admin/purchases/${refunded.purchaseId}/refund`, admin.headers, 'POST', { reason: 'Never came back' }),
      200,
    )
    const delivered = await harness.app.request(stripeWebhookPath(studio.slug), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=fake' },
      body: JSON.stringify({
        id: `evt_${randomUUID()}`,
        type: 'charge.refunded',
        data: {
          object: {
            id: `ch_${randomUUID().slice(0, 12)}`,
            payment_intent: refunded.intents[0],
            amount: 6000,
            amount_captured: 6000,
            amount_refunded: 6000,
            metadata: {},
          },
        },
      }),
    })
    assert.equal(delivered.status, 200)
    assert.deepEqual(
      (await itemsOf(admin)).map(i => i.id),
      [`${KIND}:${finished.purchaseId}`],
    )

    // Paid in full: the purchase settles and is granted.
    await harness.db
      .update(schema.purchases)
      .set({ status: 'paid', amountPaidSgd: '200.00' })
      .where(eq(schema.purchases.id, finished.purchaseId))
    assert.deepEqual(await itemsOf(admin), [])
  })

  test('ATN-56 a dismissal belongs to its studio: another studio cannot dismiss it, and it hides nothing there', async () => {
    const a = await freshStudio()
    const b = await freshStudio()
    const adminA = await staffAt(a, 'boss', 'admin')
    const adminB = await staffAt(b, 'boss', 'admin')
    const memberA = await memberAt(a, 'Una Quiet')
    const memberB = await memberAt(b, 'Val Quiet')
    const inA = await partPaid(a, memberA, { payments: ['50.00'], daysAgo: 25 })
    const inB = await partPaid(b, memberB, { payments: ['50.00'], daysAgo: 25 })

    assert.equal((await dismiss(adminB, KIND, inA.purchaseId)).status, 404, 'not B’s purchase')
    assert.equal((await dismiss(adminA, KIND, inA.purchaseId)).status, 204)
    assert.equal((await itemsOf(adminA)).length, 0)
    assert.deepEqual(
      (await itemsOf(adminB)).map(i => i.id),
      [`${KIND}:${inB.purchaseId}`],
    )
  })
})
