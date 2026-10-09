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
  sellerLegalName: 'Northwind Wellness Pte. Ltd.',
  sellerRegistrationNumber: null,
  sellerAddress: '12 Example Road\nSingapore 000000',
  sellerFooter: null,
  buyerName: 'Mia Tan',
  buyerEmail: 'mia@example.test',
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

test('INV-88 the Receipt as HTML: paid, refunded and free each read as the PDF does, every value escaped, credited to the platform', () => {
  const text = htmlToText(receiptHtml(receiptDocument(paid, STUDIO)))
  for (const said of [
    'Northwind Yoga',
    'Northwind Wellness Pte. Ltd.',
    'R-000042',
    'Amount paid',
    'S$19.00',
    'PAID',
    'Paid by Apple Pay · Visa •••• 4242 on 2 Oct 2026',
    'Issued to',
    'Mia Tan',
    'mia@example.test',
    'Grip socks 2 S$12.00 S$24.00',
    'Promo code WELCOME5',
    '-S$5.00',
    'Subtotal: S$24.00',
    'Discount: -S$5.00',
    'Total paid: S$19.00',
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
  assert.doesNotMatch(free, /\bPAID\b|Paid with|Discount/)

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
