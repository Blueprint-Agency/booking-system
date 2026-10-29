import assert from 'node:assert/strict'
import { test } from 'node:test'
import { htmlToText } from '../mail/layout'
import { receiptDocument } from './document'
import { receiptHtml, receiptHtmlPage } from './html'
import type { ReceiptRow } from './issue'

/**
 * The Receipt as every screen shows it (`receiptDocument` laid out by
 * `receiptHtml`), read without a database. Written from the INV rows of the
 * Scenario Inventory (`docs/md/test-scenarios.md`).
 */

const STUDIO = { name: 'Northwind Yoga', logoUrl: null }

const paid: ReceiptRow = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  id: '00000000-0000-4000-8000-000000000002',
  purchaseId: '00000000-0000-4000-8000-000000000003',
  clientId: null,
  number: 42,
  displayNumber: 'R-000042',
  issuedAt: new Date('2026-10-02T03:00:00Z'),
  sellerName: 'Northwind Yoga',
  sellerBusinessName: 'Northwind Wellness Pte. Ltd.',
  sellerRegistrationNumber: null,
  sellerAddress: '12 Example Road\nSingapore 000000',
  sellerFooter: null,
  sellerEmail: null,
  buyerName: 'Mia Tan',
  buyerEmail: 'mia@example.test',
  billTo: null,
  kind: 'class_package',
  lines: [
    {
      description: 'Grip socks',
      quantity: 2,
      listPriceSgd: '12.00',
      discountSgd: '5.00',
      discounts: [{ source: 'promo_code', id: '00000000-0000-4000-8000-000000000004', label: 'WELCOME5', amountSgd: '5.00' }],
      amountSgd: '19.00',
    },
  ],
  subtotalSgd: '24.00',
  discountSgd: '5.00',
  totalSgd: '19.00',
  payments: [{ method: 'card', cardBrand: 'visa', cardLast4: '4242', wallet: 'apple_pay', amountSgd: '19.00', paidAt: '2026-10-02T03:00:00Z' }],
  refundedAt: null,
}

test('INV-88 INV-09 INV-53 the Receipt as HTML: paid, refunded and free each read as the PDF does, every value escaped, credited to the platform', () => {
  const text = htmlToText(receiptHtml(receiptDocument(paid, STUDIO)))
  for (const said of [
    'Receipt number: R-000042',
    'Northwind Wellness Pte. Ltd.',
    'R-000042',
    'Amount paid',
    'S$19.00',
    'PAID',
    'S$19.00 paid on 2 Oct 2026',
    'Apple Pay · Visa •••• 4242 2 Oct 2026 S$19.00',
    'Bill to',
    'Mia Tan',
    'mia@example.test',
    'Grip socks 2 S$12.00 S$24.00',
    'Promo code WELCOME5',
    '-S$5.00',
    'Subtotal: S$24.00',
    'Discount: -S$5.00',
    'Total: S$19.00',
    'Amount paid: S$19.00',
    'Powered by ReserveToday · reservetoday.app',
  ]) {
    assert.ok(text.includes(said), `"${said}" in:\n${text}`)
  }
  assert.doesNotMatch(text, /Refunded/)

  const refunded = htmlToText(receiptHtml(receiptDocument({ ...paid, refundedAt: new Date('2026-10-14T03:00:00Z') }, STUDIO)))
  assert.ok(refunded.includes('REFUNDED') && refunded.includes('Refunded on 14 Oct 2026'), refunded)
  assert.doesNotMatch(refunded, /\bPAID\b/)

  const free = htmlToText(
    receiptHtml(receiptDocument({ ...paid, lines: [], subtotalSgd: '0.00', discountSgd: '0.00', totalSgd: '0.00', payments: [] }, STUDIO)),
  )
  assert.ok(free.includes('No payment: nothing was due.'), free)
  assert.doesNotMatch(free, /\bPAID\b|Payment history|paid on|Discount/)

  const hostile = receiptHtmlPage(
    receiptDocument(
      { ...paid, buyerName: '<script>alert(1)</script>', sellerFooter: 'Thanks & see you <b>soon</b>' },
      { name: 'A "studio" <img>', logoUrl: 'javascript:alert(1)' },
    ),
  )
  assert.doesNotMatch(hostile, /<script>|<b>|<img>|javascript:/, 'nothing a studio or a member typed becomes markup')
  assert.ok(hostile.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  assert.ok(hostile.startsWith('<!doctype html>') && hostile.includes('<title>Receipt R-000042</title>'))
})

test('INV-09 INV-53 a payment with no recorded method reads Online payment, one with no card brand reads Card, and an unknown brand reads as a name, not blank', () => {
  const none = { method: null, cardBrand: null, cardLast4: null, wallet: null }
  const read = (payment: Pick<(typeof paid.payments)[number], 'method' | 'cardBrand' | 'cardLast4' | 'wallet'>): string =>
    htmlToText(receiptHtml(receiptDocument({ ...paid, payments: [{ ...payment, amountSgd: '19.00', paidAt: '2026-10-02T03:00:00Z' }] }, STUDIO)))

  const unrecorded = read(none)
  assert.ok(unrecorded.includes('Online payment 2 Oct 2026 S$19.00'), unrecorded)

  const noBrand = read({ ...none, method: 'card', cardLast4: '4242' })
  assert.ok(noBrand.includes('Card •••• 4242 2 Oct 2026 S$19.00'), noBrand)

  const unknownBrand = read({ ...none, method: 'card', cardBrand: 'cartes_bancaires', cardLast4: '4242' })
  assert.ok(unknownBrand.includes('Cartes bancaires •••• 4242 2 Oct 2026 S$19.00'), unknownBrand)
})

test('INV-103 nothing typed into a Bill to, the studio\'s Business details or its contact email becomes markup in the Receipt\'s HTML', () => {
  const page = receiptHtmlPage(
    receiptDocument(
      {
        ...paid,
        sellerBusinessName: 'Northwind <b>Wellness</b>',
        sellerAddress: '<i>12 Example Road</i>',
        sellerRegistrationNumber: '<u>2026</u>',
        sellerEmail: '"><script>alert(1)</script>@example.test',
        billTo: {
          name: '<img src=x onerror=alert(1)>',
          line1: '<a href="javascript:alert(1)">1 Example Street</a>',
          line2: '<svg onload=alert(1)>',
          city: '<em>Singapore</em>',
          state: null,
          postcode: '<s>000001</s>',
          country: 'SG',
        },
      },
      { name: 'Northwind <script>', logoUrl: 'https://cdn.example.test/logo.png" onerror="alert(1)' },
    ),
  )
  assert.doesNotMatch(page, /<(b|i|u|em|s|svg|script|a)\b|<img src=x|onerror="|href="javascript/, page)
  for (const escaped of [
    'Northwind &lt;b&gt;Wellness&lt;/b&gt;',
    '&lt;i&gt;12 Example Road&lt;/i&gt;',
    '&lt;u&gt;2026&lt;/u&gt;',
    '&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;@example.test',
    '&lt;img src=x onerror=alert(1)&gt;',
    '&lt;svg onload=alert(1)&gt;',
    '&lt;em&gt;Singapore&lt;/em&gt;',
  ]) {
    assert.ok(page.includes(escaped), `"${escaped}" is shown as text`)
  }
})

test('INV-111 the Bill to name is set strong, as the studio\'s Business name is, and its address and the member\'s email are not', () => {
  const page = receiptHtmlPage(
    receiptDocument(
      {
        ...paid,
        billTo: { name: 'Harbour Analytics Sdn Bhd', line1: '12 Jalan Ampang', line2: null, city: 'Kuala Lumpur', state: null, postcode: '50450', country: 'MY' },
      },
      STUDIO,
    ),
  )
  /** Whether the element holding exactly `text` is set bold. */
  const strong = (text: string): boolean => {
    const match = new RegExp(`<div style="([^"]*)">${text}</div>`).exec(page)
    assert.ok(match, `"${text}" is a line of its own: ${page}`)
    return /font-weight:700/.test(match[1]!)
  }
  assert.equal(strong('Northwind Wellness Pte. Ltd.'), true, 'the studio\'s Business name')
  assert.equal(strong('Harbour Analytics Sdn Bhd'), true, 'the Bill to name')
  assert.equal(strong('12 Jalan Ampang'), false)
  assert.equal(strong('mia@example.test'), false)
})
