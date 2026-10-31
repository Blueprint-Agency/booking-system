import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { stripeWebhookPath, type StripeFake } from './stripe-fake'
import { withEnv } from './with-env'
import type { OutboundMessage } from '../lib/mailer'

const run = Date.now().toString(36)
const DOMAIN = `${run}.receipt-layout.test`
const OPERATOR = `operator@${DOMAIN}`
// Not ending in "Flow" / "Bundle" / "Retreat": isolation.test.ts purges by those suffixes.
const NAME = `Layout ${run}`

/** The words a PDF shows, as a reader copying them out of it would get them. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true })
  return text
}

/** A day as the studio's Receipts print it: `16 Sep 2026`, in Singapore. */
const studioDay = (at: Date | string): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(at))

/** A company the member bills, in Malaysia, so the country prints by its name. */
const COMPANY = {
  name: 'Harbour Analytics Sdn Bhd',
  line1: '12 Jalan Ampang',
  line2: 'Level 8',
  city: 'Kuala Lumpur',
  state: 'Wilayah Persekutuan',
  postcode: '50450',
  country: 'MY',
}
const COMPANY_LINES = ['Harbour Analytics Sdn Bhd', '12 Jalan Ampang', 'Level 8', 'Kuala Lumpur Wilayah Persekutuan 50450', 'Malaysia']

/**
 * The Receipt laid out as a business receipt: the title with
 * the studio's logo or Business name, the facts (Receipt number, Date paid,
 * Registration), the studio and Bill to side by side, a headline of what was
 * paid and when, the lines, totals ending in Amount paid, and a Payment
 * history. One layout, in the Receipt's `html`, its PDF and the email that
 * carries it.
 *
 * Every studio here is created by the super portal over HTTP, its Business
 * details saved by its admin, and its contact email set as the operator sets
 * the reply-to address. Members check out, the provider's delivery reaches the
 * studio's own webhook (the Stripe fake stands in for the provider), and the
 * Receipt is read back as the member reads it.
 *
 * Written from the INV rows of the Scenario Inventory (`docs/md/test-scenarios.md`).
 */
describe('a Receipt laid out as a business receipt', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  withEnv({ PLATFORM_ADMIN_EMAIL: OPERATOR })

  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let mailer!: typeof import('../lib/mailer')
  let fake!: StripeFake
  let operator!: Record<string, string>

  type Studio = { id: string; slug: string; admin: Record<string, string>; packageId: string; businessName: string; replyTo: string }
  type Member = { clientId: string; email: string; headers: Record<string, string> }

  const json = { 'Content-Type': 'application/json' }

  async function expectStatus(res: Response, status: number): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    return text ? (JSON.parse(text) as Record<string, any>) : {}
  }

  const post = (headers: Record<string, string>, path: string, body: unknown, method = 'POST') =>
    harness.app.request(path, { method, headers: { ...headers, ...json }, body: JSON.stringify(body) })

  let studios = 0
  /**
   * A studio the super portal creates, its first admin signed in, its Business
   * details saved (a registration number only where `registration` is given),
   * its contact email set, a ten pack on sale, and its own provider account.
   */
  async function newStudio(registration: string | null): Promise<Studio> {
    const slug = `rl-${run}-${studios++}`
    const adminEmail = `admin-${slug}@${DOMAIN}`
    const created = await expectStatus(
      await post(operator, '/api/v1/platform/tenants', { slug, name: `Domain ${slug}`, admin_email: adminEmail }),
      201,
    )
    const id: string = created.tenant.id
    const [invitation] = await harness.db
      .select({ token: schema.staffInvitations.token })
      .from(schema.staffInvitations)
      .where(eq(schema.staffInvitations.tenantId, id))
    const { withTenant } = await import('../db')
    const { acceptInvitation } = await import('../services/auth/invitations')
    await withTenant(id, () => acceptInvitation({ tenantId: id, token: invitation!.token, password: 'a-first-password' }))
    const admin = await harness.signInAs('staff', adminEmail, { slug })

    const businessName = `Northwind ${slug} Wellness Pte. Ltd.`
    await expectStatus(
      await post(
        admin,
        '/api/v1/portal/admin/settings/business-details',
        { business_name: businessName, prefix: 'R', registration_number: registration, address: '12 Example Road\nSingapore 000012', footer: null },
        'PUT',
      ),
      200,
    )
    // The contact email is the studio's reply-to address, which the operator sets.
    const replyTo = `hello@${slug}.${DOMAIN}`
    await harness.db.update(schema.tenantSettings).set({ mailReplyTo: replyTo }).where(eq(schema.tenantSettings.tenantId, id))
    await harness.db.update(schema.globalPolicy).set({ partPaymentEnabled: true }).where(eq(schema.globalPolicy.tenantId, id))

    const [pack] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: id, name: `${NAME} ten pack`, kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '150.00' })
      .returning({ id: schema.classPackages.id })
    fake.ownAccount({ id, slug })
    return { id, slug, admin, packageId: pack!.id, businessName, replyTo }
  }

  let members = 0
  async function member(at: Studio): Promise<Member> {
    const email = `member-${members++}@${DOMAIN}`
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name: 'Mia Tan', phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, email, headers }
  }

  async function saves(who: Member, set: Record<string, string>): Promise<string> {
    const added = await expectStatus(await post(who.headers, '/api/v1/me/billing-details', set), 201)
    return added.billing_details.id as string
  }

  /** The provider's checkout-completed delivery for the last session: the whole of what it charged, on a fresh intent. */
  async function deliver(at: Studio): Promise<void> {
    const call = fake.callsTo('checkout.sessions.create').at(-1)
    assert.ok(call, 'no checkout session was created')
    const params = call.args[0] as { metadata: Record<string, string>; line_items: any[] }
    const amount = params.line_items.reduce((n: number, l: any) => n + l.price_data.unit_amount * (l.quantity ?? 1), 0)
    const event = {
      id: `evt_${randomUUID()}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_${randomUUID()}`,
          payment_intent: `pi_${randomUUID()}`,
          payment_status: 'paid',
          amount_total: amount,
          metadata: params.metadata,
        },
      },
    }
    await expectStatus(
      await harness.app.request(stripeWebhookPath(at.slug), {
        method: 'POST',
        headers: { ...json, 'stripe-signature': 't=1,v1=fake' },
        body: JSON.stringify(event),
      }),
      200,
    )
  }

  /** Buy the studio's ten pack, billed to `billingDetailsId`, and have the provider say it was paid. */
  async function buys(who: Member, at: Studio, billingDetailsId: string): Promise<void> {
    await expectStatus(
      await post(who.headers, '/api/v1/me/checkout/package', {
        package_kind: 'class',
        package_id: at.packageId,
        billing_details_id: billingDetailsId,
      }),
      200,
    )
    await deliver(at)
  }

  /** The member's one Receipt as their account shows it, its PDF's words, and the plain text of the email that carried it. */
  async function surfaces(who: Member): Promise<{ receipt: Record<string, any>; read: [string, string][] }> {
    const listed = await expectStatus(await harness.app.request('/api/v1/me/receipts', { headers: who.headers }), 200)
    assert.equal(listed.receipts.length, 1, 'exactly one Receipt')
    const receipt = await expectStatus(await harness.app.request(`/api/v1/me/receipts/${listed.receipts[0].id}`, { headers: who.headers }), 200)
    const res = await harness.app.request(`/api/v1/me/receipts/${receipt.id}/pdf`, { headers: who.headers })
    assert.equal(res.status, 200)
    const pdf = await pdfText(new Uint8Array(await res.arrayBuffer()))
    const sent = mailer.discardedMail.filter((m: OutboundMessage) => m.to === who.email && (m.text ?? '').includes(receipt.number))
    assert.equal(sent.length, 1, 'exactly one email carries the Receipt')
    const { htmlToText } = await import('../services/mail/layout')
    return {
      receipt,
      read: [
        ['the html', htmlToText(receipt.html as string)],
        ['the PDF', pdf],
        ["the email's plain text", sent[0]!.text ?? ''],
      ],
    }
  }

  /** `text` has each of `phrases`, in order, from `from` on. */
  function inOrder(text: string, phrases: string[], where: string, from: RegExp | null = null): void {
    let at = 0
    if (from) {
      at = text.search(from)
      assert.ok(at >= 0, `${where} has ${from}: ${text}`)
    }
    for (const phrase of phrases) {
      const next = text.indexOf(phrase, at)
      assert.ok(next >= at, `${where} has "${phrase}", in order: ${text}`)
      at = next + phrase.length
    }
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    mailer = await import('../lib/mailer')
    operator = await harness.signInAs('platform', OPERATOR, null)

    fake = (await import('./stripe-fake')).installStripeFake()
    fake.reply('customers.create', () => ({ id: `cus_${randomUUID().slice(0, 8)}` }))
    fake.reply('checkout.sessions.create', () => {
      const id = `cs_${randomUUID()}`
      return { id, url: `https://pay.example.test/${id}` }
    })
    fake.reply('webhooks.constructEvent', (body: unknown) => JSON.parse(String(body)))
    fake.reply('paymentIntents.retrieve', (id: unknown) => ({
      id,
      latest_charge: {
        id: `ch_${String(id)}`,
        receipt_url: `https://pay.example.test/receipts/${String(id)}`,
        payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242', wallet: null } },
      },
    }))
  })

  after(async () => {
    if (!harness) return
    fake?.restore()
    try {
      const ours = `%@${DOMAIN}`
      const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
      await harness.db.execute(sql`DELETE FROM stripe_payments WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM receipts WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM payment_customers WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM client_billing_details WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    } finally {
      await harness.close()
    }
  })

  test('INV-97 a paid Receipt reads as a business receipt: the facts, the studio beside Bill to, what was paid and when, totals ending in Amount paid, and the Payment history, in its html, PDF and email', async () => {
    const studio = await newStudio(`UEN ${run}`)
    const mia = await member(studio)
    await buys(mia, studio, await saves(mia, COMPANY))

    const { receipt, read } = await surfaces(mia)
    assert.equal(receipt.seller.email, studio.replyTo, "the studio's contact email, copied onto the Receipt at issue")
    const day = studioDay(receipt.payments[0].paid_at)
    for (const [where, text] of read) {
      inOrder(text, ['Receipt', 'Receipt number', receipt.number, 'Date paid', day, 'Registration', `UEN ${run}`], where)
      inOrder(text, [studio.businessName, '12 Example Road', 'Singapore 000012', studio.replyTo], where)
      inOrder(text, [...COMPANY_LINES, mia.email], where, /b\s*i\s*l\s*l\s*t\s*o/i)
      assert.ok(text.includes(`S$150.00 paid on ${day}`), `${where} leads with what was paid and when: ${text}`)
      inOrder(text, ['Subtotal', 'S$150.00', 'Total', 'S$150.00', 'Amount paid', 'S$150.00'], where)
      inOrder(text, ['Payment history', 'Payment method', 'Date', 'Amount paid', 'Visa •••• 4242', day, 'S$150.00'], where)
      assert.ok(!/invoice|\btax\b|GST/i.test(text), `${where} is a Receipt, not an invoice, and has no tax: ${text}`)
    }
    const [, html] = read[0]!
    const [, mail] = read[2]!
    for (const [where, text] of [['the html', html], ["the email's plain text", mail]] as const) {
      assert.ok(text.includes('Amount paid: S$150.00') && text.includes('Total: S$150.00'), `${where} reads each total by its label: ${text}`)
    }
  })

  test('INV-98 a studio with no registration number prints no Registration row; one with a number prints it among the facts', async () => {
    const without = await newStudio(null)
    const ivy = await member(without)
    await buys(ivy, without, await saves(ivy, COMPANY))
    for (const [where, text] of (await surfaces(ivy)).read) {
      assert.ok(!/registration/i.test(text), `${where} has no Registration row: ${text}`)
      inOrder(text, ['Receipt number', 'Date paid'], where)
    }

    const registered = await newStudio(`REG ${run}`)
    const kai = await member(registered)
    await buys(kai, registered, await saves(kai, COMPANY))
    for (const [where, text] of (await surfaces(kai)).read) inOrder(text, ['Date paid', 'Registration', `REG ${run}`], where)
  })

  test('INV-99 a Purchase paid in two payments lists both in its Payment history, each with its method, date and amount, under a headline of the whole paid on the day it was settled', async () => {
    const studio = await newStudio(null)
    const pia = await member(studio)
    const company = await saves(pia, COMPANY)
    await expectStatus(
      await post(pia.headers, '/api/v1/me/checkout/package', {
        package_kind: 'class',
        package_id: studio.packageId,
        part_payment_sgd: 50,
        billing_details_id: company,
      }),
      200,
    )
    await deliver(studio)
    const open = (await expectStatus(await harness.app.request('/api/v1/me/purchases/open', { headers: pia.headers }), 200)).purchases as any[]
    assert.equal(open.length, 1, 'the Purchase is left open')
    await expectStatus(await post(pia.headers, `/api/v1/me/purchases/${open[0].id}/resume`, {}), 200)
    await deliver(studio)

    const { receipt, read } = await surfaces(pia)
    assert.deepEqual(
      receipt.payments.map((p: any) => p.amount_sgd),
      ['50.00', '100.00'],
      'both payments, in the order they were made',
    )
    const [first, second] = receipt.payments.map((p: any) => studioDay(p.paid_at))
    for (const [where, text] of read) {
      assert.ok(text.includes(`S$150.00 paid on ${second}`), `${where} leads with the whole, paid on the day it was settled: ${text}`)
      inOrder(text, ['Amount paid', 'S$150.00', 'Payment history', 'Visa •••• 4242', first, 'S$50.00', 'Visa •••• 4242', second, 'S$100.00'], where)
    }
  })

  /** A Receipt as stored, for the renderer: `overrides` on a paid one at `at`. */
  function stored(at: Studio, overrides: Partial<import('../services/receipts/issue').ReceiptRow>): import('../services/receipts/issue').ReceiptRow {
    return {
      tenantId: at.id,
      id: randomUUID(),
      purchaseId: randomUUID(),
      clientId: null,
      number: 7,
      displayNumber: 'R-000007',
      issuedAt: new Date('2026-09-16T03:00:00Z'),
      sellerName: 'Northwind Yoga',
      sellerBusinessName: at.businessName,
      sellerRegistrationNumber: null,
      sellerAddress: null,
      sellerFooter: null,
      sellerEmail: at.replyTo,
      buyerName: 'Mia Tan',
      buyerEmail: `stored@${DOMAIN}`,
      billTo: null,
      kind: 'class_package',
      lines: [{ description: 'Teacher training', quantity: 1, listPriceSgd: '600.00', discountSgd: '0.00', discounts: [], amountSgd: '600.00' }],
      subtotalSgd: '600.00',
      discountSgd: '0.00',
      totalSgd: '600.00',
      payments: [],
      refundedAt: null,
      ...overrides,
    }
  }

  test('INV-101 a Receipt paid in more payments than a page holds runs its Payment history onto further pages, every payment listed and every page numbered of the whole', async () => {
    const studio = await newStudio(null)
    const { receiptPdf } = await import('../services/receipts/pdf')
    const payments = Array.from({ length: 60 }, (_, i) => ({
      method: 'card',
      cardBrand: 'mastercard',
      cardLast4: String(1000 + i),
      wallet: null,
      amountSgd: '10.00',
      paidAt: '2026-09-16T03:00:00Z',
    }))
    const bytes = await receiptPdf(stored(studio, { payments }), { name: 'Northwind Yoga', logoUrl: null, timezone: 'Asia/Singapore' })
    const { extractText, getDocumentProxy } = await import('unpdf')
    const { text: pages } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: false })
    assert.ok(pages.length >= 2, `sixty payments run onto a second page, not ${pages.length}`)
    pages.forEach((page, i) => {
      assert.ok(page.includes(`R-000007 · Page ${i + 1} of ${pages.length}`), `page ${i + 1} names its Receipt and page: ${page}`)
      assert.ok(page.includes('Payment method'), `page ${i + 1} carries the Payment history's headings: ${page}`)
    })
    const all = pages.join('\n')
    for (let i = 0; i < 60; i++) assert.ok(all.includes(`Mastercard •••• ${1000 + i}`), `payment ${i + 1} is listed`)
  })

  test('INV-102 a S$0.00 Receipt has no payment wording, and a refunded one keeps its marker and the day of the Refund', async () => {
    const studio = await newStudio(null)
    const { receiptPdf } = await import('../services/receipts/pdf')
    const { receiptDocument } = await import('../services/receipts/document')
    const { receiptHtml } = await import('../services/receipts/html')
    const { htmlToText } = await import('../services/mail/layout')
    const brand = { name: 'Northwind Yoga', logoUrl: null, timezone: 'Asia/Singapore' }
    const both = async (row: import('../services/receipts/issue').ReceiptRow): Promise<[string, string][]> => [
      ['the html', htmlToText(receiptHtml(receiptDocument(row, brand)))],
      ['the PDF', await pdfText(await receiptPdf(row, brand))],
    ]

    const free = stored(studio, {
      lines: [{ description: 'Trial class', quantity: 1, listPriceSgd: '0.00', discountSgd: '0.00', discounts: [], amountSgd: '0.00' }],
      subtotalSgd: '0.00',
      totalSgd: '0.00',
    })
    for (const [where, text] of await both(free)) {
      assert.ok(text.includes('No payment: nothing was due.'), `${where} says nothing was due: ${text}`)
      inOrder(text, ['Issued on', studioDay('2026-09-16T03:00:00Z')], where)
      assert.ok(!/Date paid|paid on|Payment history|Payment method|PAID|Refunded/.test(text), `${where} has no payment wording: ${text}`)
    }

    const refunded = stored(studio, {
      payments: [{ method: 'paynow', cardBrand: null, cardLast4: null, wallet: null, amountSgd: '600.00', paidAt: '2026-09-16T03:00:00Z' }],
      refundedAt: new Date('2026-09-20T03:00:00Z'),
    })
    for (const [where, text] of await both(refunded)) {
      assert.ok(text.includes('REFUNDED') && text.includes(`Refunded on ${studioDay('2026-09-20T03:00:00Z')}`), `${where} says it was refunded, and when: ${text}`)
      assert.ok(text.includes(`S$600.00 paid on ${studioDay('2026-09-16T03:00:00Z')}`), `${where} still says what was paid: ${text}`)
      assert.ok(!/\bPAID\b/.test(text), `${where} is not marked PAID: ${text}`)
    }
  })
})
