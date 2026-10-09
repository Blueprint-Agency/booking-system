import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { stripeWebhookPath, type StripeFake } from './stripe-fake'

const run = Date.now().toString(36)
const DOMAIN = `${run}.receipt-pdf.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const NAME = `Receipt PDF ${run}`

/** The words a PDF shows, as a reader copying them out of it would get them. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true })
  return text
}

/**
 * A member downloads a Receipt as a PDF (#386): `GET /me/receipts/:id/pdf`,
 * rendered on request from what the Receipt says. Asked over HTTP, after a
 * checkout and the provider's delivery to the studio's own webhook (the Stripe
 * fake stands in for the provider), and read back as the text in the PDF.
 *
 * Written from the INV rows of the Scenario Inventory
 * (`docs/md/test-scenarios.md`).
 */
describe('a member downloads a Receipt as a PDF', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let fake!: StripeFake

  type Studio = { id: string; slug: string; packageId: string; packageName: string; displayName: string }
  type Member = { clientId: string; email: string; headers: Record<string, string> }
  let one!: Studio
  let two!: Studio
  /** What each studio's settings said before this file, put back after it. */
  const branding = new Map<string, { displayName: string | null; logoUrl: string | null }>()

  const json = { 'Content-Type': 'application/json' }

  async function expectStatus(res: Response, status: number): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    return text ? JSON.parse(text) : {}
  }

  /** The studio's settings as its operator would set them in the super portal. */
  const brand = (at: { id: string }, set: { displayName?: string; logoUrl?: string | null }) =>
    harness.db.update(schema.tenantSettings).set(set).where(eq(schema.tenantSettings.tenantId, at.id))

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const [was] = await harness.db
      .select({ displayName: schema.tenantSettings.displayName, logoUrl: schema.tenantSettings.logoUrl })
      .from(schema.tenantSettings)
      .where(eq(schema.tenantSettings.tenantId, tenant.id))
    branding.set(tenant.id, was!)
    const displayName = `${NAME} studio ${tenant.slug}`
    // No logo until a test gives it one: nothing here reaches out to the internet.
    await brand(tenant, { displayName, logoUrl: null })

    const packageName = `${NAME} ten pack ${tenant.slug}`
    const [paid] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: tenant.id, name: packageName, kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '150.00' })
      .returning({ id: schema.classPackages.id })
    return { ...tenant, packageId: paid!.id, packageName, displayName }
  }

  let members = 0
  async function member(at: Studio, name = 'Mia Tan'): Promise<Member> {
    const email = `member-${members++}-${at.slug}@${DOMAIN}`
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db.select({ id: schema.clientAuthUsers.id }).from(schema.clientAuthUsers).where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, email, headers }
  }

  /** Buy `at`'s ten pack and have the provider say it was paid; hand back the member's Receipt. */
  async function buy(who: Member, at: Studio): Promise<{ id: string; number: string }> {
    await expectStatus(
      await harness.app.request('/api/v1/me/checkout/package', {
        method: 'POST',
        headers: { ...who.headers, ...json },
        body: JSON.stringify({ package_kind: 'class', package_id: at.packageId }),
      }),
      200,
    )
    const params = fake.callsTo('checkout.sessions.create').at(-1)!.args[0] as { metadata: Record<string, string>; line_items: any[] }
    const event = {
      id: `evt_${randomUUID()}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_receipt_pdf_${randomUUID().slice(0, 12)}`,
          payment_intent: `pi_receipt_pdf_${randomUUID().slice(0, 12)}`,
          payment_status: 'paid',
          amount_total: params.line_items.reduce((n, l) => n + l.price_data.unit_amount * (l.quantity ?? 1), 0),
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
    const listed = await expectStatus(await harness.app.request('/api/v1/me/receipts', { headers: who.headers }), 200)
    const [receipt] = listed.receipts
    assert.ok(receipt, 'the sale has its Receipt')
    return receipt
  }

  const download = (who: Member, receiptId: string) =>
    harness.app.request(`/api/v1/me/receipts/${receiptId}/pdf`, { headers: who.headers })

  /** The PDF a download answers with, read back as text. */
  async function downloadText(who: Member, receiptId: string): Promise<string> {
    const res = await download(who, receiptId)
    assert.equal(res.status, 200, res.status === 200 ? '' : await res.text())
    return pdfText(new Uint8Array(await res.arrayBuffer()))
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')

    fake = (await import('./stripe-fake')).installStripeFake()
    fake.reply('customers.create', () => ({ id: `cus_receipt_pdf_${randomUUID().slice(0, 8)}` }))
    let sessions = 0
    fake.reply('checkout.sessions.create', () => {
      sessions++
      return { id: `cs_receipt_pdf_session_${run}_${sessions}`, url: `https://pay.example.test/cs_receipt_pdf_${sessions}` }
    })
    fake.reply('webhooks.constructEvent', (body: unknown) => JSON.parse(String(body)))
    // Every charge is a Visa ending 4242.
    fake.reply('paymentIntents.retrieve', (id: unknown) => ({
      id,
      latest_charge: {
        id: `ch_${String(id)}`,
        receipt_url: `https://pay.example.test/receipts/${String(id)}`,
        payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242', wallet: null } },
      },
    }))

    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
    fake.ownAccount(one)
    fake.ownAccount(two)
  })

  after(async () => {
    if (!harness) return
    fake?.restore()
    for (const [tenantId, was] of branding) await brand({ id: tenantId }, was as { displayName: string; logoUrl: string | null })
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM receipts WHERE purchase_id IN (SELECT id FROM purchases WHERE client_id IN (${clients}))`)
    await harness.db.execute(sql`DELETE FROM stripe_payments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM payment_customers WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${`${NAME}%`}`)
    await harness.close()
  })

  test('INV-15 a member downloads their Receipt as a PDF that names the studio, the number, the line, the total and the payment', async () => {
    const mia = await member(one)
    const receipt = await buy(mia, one)

    const res = await download(mia, receipt.id)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'application/pdf')
    assert.match(res.headers.get('content-disposition') ?? '', new RegExp(`^attachment; filename="[^"]*${receipt.number}[^"]*\\.pdf"$`))
    const bytes = new Uint8Array(await res.arrayBuffer())
    assert.equal(Buffer.from(bytes.subarray(0, 5)).toString('latin1'), '%PDF-')

    const text = await pdfText(bytes)
    assert.ok(text.includes(receipt.number), `the receipt number in: ${text}`)
    assert.ok(text.includes(one.displayName), 'the studio')
    assert.ok(text.includes('Mia Tan') && text.includes(mia.email), 'the member')
    assert.ok(text.includes(one.packageName), 'the line')
    assert.ok(text.includes('S$150.00'), 'the total')
    assert.ok(text.includes('Visa •••• 4242'), 'how it was paid, as the Receipt page words it')
  })

  test("INV-16 another member's Receipt and another studio's are 404 receipt_not_found as a PDF too", async () => {
    const owner = await member(one)
    const theirs = await buy(owner, one)
    const neighbour = await member(one)
    const elsewhere = await member(two)

    for (const who of [neighbour, elsewhere]) {
      const res = await expectStatus(await download(who, theirs.id), 404)
      assert.equal(res.error, 'receipt_not_found')
    }
    const unknown = await expectStatus(await download(owner, randomUUID()), 404)
    assert.equal(unknown.error, 'receipt_not_found', 'the same answer as one that does not exist')
  })

  test('INV-17 the PDF shows the studio’s logo, and a logo that cannot be had leaves the name standing alone', async () => {
    // A PNG of one pixel: the smallest logo there is.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )
    // The same PNG with its pixel data damaged: a PNG by its header, and one
    // that cannot be decoded.
    const broken = Buffer.from(png)
    broken.fill(0xff, 41, 47)
    const { createServer } = await import('node:http')
    const server = createServer((req, res) => {
      if (req.url === '/logo.png') return void res.writeHead(200, { 'Content-Type': 'image/png' }).end(png)
      if (req.url === '/broken.png') return void res.writeHead(200, { 'Content-Type': 'image/png' }).end(broken)
      if (req.url === '/not-a-logo') return void res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html>a page</html>')
      if (req.url === '/missing.png') return void res.writeHead(404).end()
      // '/silent.png': never answers.
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }
    // A port nothing listens on: the server's own, once it is closed, is not
    // guaranteed free, so ask the OS for one and let it go.
    const closed = await new Promise<number>(resolve => {
      const probe = createServer().listen(0, '127.0.0.1', () => {
        const { port: free } = probe.address() as { port: number }
        probe.close(() => resolve(free))
      })
    })

    try {
      const ada = await member(one)
      const receipt = await buy(ada, one)
      const drawsAnImage = async () => {
        const res = await download(ada, receipt.id)
        assert.equal(res.status, 200, 'the PDF is always there')
        const bytes = Buffer.from(await res.arrayBuffer())
        const text = await pdfText(new Uint8Array(bytes))
        assert.ok(text.includes(one.displayName), 'the studio is named either way')
        assert.ok(text.includes(receipt.number))
        return bytes.includes('/Subtype /Image')
      }

      await brand(one, { logoUrl: `http://127.0.0.1:${port}/logo.png` })
      assert.equal(await drawsAnImage(), true, 'the logo is drawn')

      for (const url of [
        `http://127.0.0.1:${closed}/logo.png`,
        `http://127.0.0.1:${port}/missing.png`,
        `http://127.0.0.1:${port}/not-a-logo`,
        `http://127.0.0.1:${port}/broken.png`,
        `http://127.0.0.1:${port}/silent.png`,
        'not a url',
      ]) {
        await brand(one, { logoUrl: url })
        assert.equal(await drawsAnImage(), false, `no logo from ${url}`)
      }
    } finally {
      await brand(one, { logoUrl: null })
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
  })

  test('INV-18 the renderer: a S$0.00 Receipt says no payment was due, a refunded one is stamped, and one Receipt always gives the same document', async () => {
    // The renderer the member's download, the admin's (#389) and the email's
    // attachment (#387) share, handed Receipts as they are stored. Free paths
    // and Refunds issue and stamp Receipts in their own tickets (#385); what
    // the PDF makes of one is asked here.
    const { receiptPdf } = await import('../services/receipts/pdf')
    const free: import('../services/receipts/issue').ReceiptRow = {
      tenantId: one.id,
      id: randomUUID(),
      purchaseId: randomUUID(),
      clientId: null,
      number: 42,
      displayNumber: 'R-000042',
      issuedAt: new Date('2026-10-01T02:00:00Z'),
      sellerName: one.displayName,
      sellerLegalName: null,
      sellerRegistrationNumber: null,
      sellerAddress: null,
      sellerFooter: null,
      buyerName: 'Mia Tan',
      buyerEmail: `free@${DOMAIN}`,
      kind: 'class_package',
      lines: [{ description: 'Trial class', quantity: 1, listPriceSgd: '0.00', discountSgd: '0.00', discounts: [], amountSgd: '0.00' }],
      subtotalSgd: '0.00',
      discountSgd: '0.00',
      totalSgd: '0.00',
      payments: [],
      refundedAt: null,
    }

    const freeText = await pdfText(await receiptPdf(free))
    assert.ok(freeText.includes('R-000042'), freeText)
    assert.ok(freeText.includes('Trial class'))
    assert.ok(freeText.includes('S$0.00'), 'the total')
    assert.match(freeText, /no payment/i, 'a line saying nothing was paid')
    assert.doesNotMatch(freeText, /Online payment|Visa/, 'and no payment listed')
    assert.doesNotMatch(freeText, /Refunded/)

    assert.deepEqual(await receiptPdf(free), await receiptPdf(free), 'the same bytes each time it is asked for')

    const refunded = await pdfText(await receiptPdf({ ...free, refundedAt: new Date('2026-10-05T03:00:00Z') }))
    assert.ok(refunded.includes('Refunded on 5 Oct 2026'), refunded)
  })

  test('INV-86 every page of a Receipt credits ReserveToday and names its Receipt and page, and a promo code reads as one', async () => {
    const { receiptPdf } = await import('../services/receipts/pdf')
    const line = { description: 'Workshop seat', quantity: 1, listPriceSgd: '45.00', discountSgd: '0.00', discounts: [], amountSgd: '45.00' }
    const long: import('../services/receipts/issue').ReceiptRow = {
      tenantId: one.id,
      id: randomUUID(),
      purchaseId: randomUUID(),
      clientId: null,
      number: 77,
      displayNumber: 'R-000077',
      issuedAt: new Date('2026-10-01T02:00:00Z'),
      sellerName: one.displayName,
      sellerLegalName: null,
      sellerRegistrationNumber: null,
      sellerAddress: null,
      sellerFooter: null,
      buyerName: 'Mia Tan',
      buyerEmail: `long@${DOMAIN}`,
      kind: 'workshop',
      lines: [
        {
          description: 'Grip socks',
          quantity: 2,
          listPriceSgd: '12.00',
          discountSgd: '5.00',
          discounts: [{ source: 'promo_code', id: randomUUID(), label: 'WELCOME5', amountSgd: '5.00' }],
          amountSgd: '19.00',
        },
        ...Array.from({ length: 30 }, () => line),
      ],
      subtotalSgd: '1374.00',
      discountSgd: '5.00',
      totalSgd: '1369.00',
      payments: [{ method: 'paynow', cardBrand: null, cardLast4: null, wallet: null, amountSgd: '1369.00', paidAt: '2026-10-01T02:00:00Z' }],
      refundedAt: null,
    }

    const bytes = await receiptPdf(long)
    const { extractText, getDocumentProxy } = await import('unpdf')
    const { text: pages } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: false })
    assert.ok(pages.length >= 2, `thirty-one lines run onto a second page, not ${pages.length}`)
    pages.forEach((page, i) => {
      assert.ok(page.includes('Powered by ReserveToday · reservetoday.app'), `page ${i + 1} credits the platform: ${page}`)
      assert.ok(page.includes(`R-000077 · Page ${i + 1} of ${pages.length}`), `page ${i + 1} names its Receipt and page: ${page}`)
    })
    const all = pages.join('\n')
    assert.ok(all.includes('Promo code WELCOME5'), 'a code is named as a promo code')
    assert.ok(all.includes('S$24.00'), "the line at its List Price times its quantity, before the code's discount")
    assert.ok(all.includes('S$1369.00'), 'the total paid')
    assert.equal(Buffer.from(bytes).includes('/Subtype /Image'), false, 'the mark is drawn, so a studio without a logo embeds no image')
  })
})
