import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ReceiptRow } from './issue'
import { htmlToText } from '../mail/layout'
import { receiptDocument } from './document'
import { receiptHtmlPage } from './html'
import { receiptPdf } from './pdf'

/**
 * The Receipt's PDF (`receiptPdf`), drawn without a database: the studio is
 * passed in and it has no logo. Read back with `unpdf`, as a reader copying
 * text out of it, and by where each run of text sits on the page. Written from
 * the INV rows of the Scenario Inventory (`docs/md/test-scenarios.md`).
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
  lines: [{ description: 'Ten pack', quantity: 1, listPriceSgd: '150.00', discountSgd: '0.00', discounts: [], amountSgd: '150.00' }],
  subtotalSgd: '150.00',
  discountSgd: '0.00',
  totalSgd: '150.00',
  payments: [{ method: 'card', cardBrand: 'visa', cardLast4: '4242', wallet: null, amountSgd: '150.00', paidAt: '2026-10-02T03:00:00Z' }],
  refundedAt: null,
}

type Run = { str: string; x: number; y: number; width: number; height: number }

/** The PDF's first page: its text as a reader copies it, and each run of text with its box. */
async function readPdf(bytes: Buffer): Promise<{ text: string; runs: Run[] }> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const text = (await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true })).text
  const page = await (await getDocumentProxy(new Uint8Array(bytes))).getPage(1)
  const content = await page.getTextContent()
  const runs = (content.items as { str?: string; transform?: number[]; width?: number; height?: number }[])
    .filter(item => item.str && item.str.trim() && item.transform)
    .map(item => ({ str: item.str!, x: item.transform![4]!, y: item.transform![5]!, width: item.width ?? 0, height: item.height ?? 0 }))
  return { text, runs }
}

/** Two runs whose boxes cross: one drawn over the other. */
function overprinted(runs: Run[]): [Run, Run] | null {
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const a = runs[i]!
      const b = runs[j]!
      const across = a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5
      const down = Math.abs(a.y - b.y) < Math.min(a.height, b.height) * 0.8
      if (across && down) return [a, b]
    }
  }
  return null
}

/** Two hundred characters of words, as long as a Bill to name or address line may be. */
const words = (lead: string): string => {
  let out = lead
  for (let i = 1; out.length < 190; i++) out += ` word${i}`
  return out.slice(0, 200)
}

test('INV-109 a Bill to name and address line of 200 characters, and a Business name as long, wrap in the PDF: every word reads and no line is drawn over the next', async () => {
  const name = words('Harbour Analytics International Holdings')
  const line1 = words('Unit 12 Jalan Ampang')
  const business = words('Northwind Wellness Collective')
  const bytes = await receiptPdf(
    {
      ...paid,
      sellerBusinessName: business,
      billTo: { name, line1, line2: 'Level 8', city: 'Kuala Lumpur', state: null, postcode: '50450', country: 'MY' },
    },
    STUDIO,
  )
  const { text, runs } = await readPdf(bytes)
  const flat = text.replace(/\s+/g, ' ')
  for (const word of [...name.split(' '), ...line1.split(' '), ...business.split(' ')]) {
    assert.ok(flat.includes(word), `"${word}" reads in the PDF: ${flat}`)
  }
  // The lines under the long ones are whole, each its own run.
  for (const whole of ['Level 8', 'Kuala Lumpur 50450', 'Malaysia', 'mia@example.test', '12 Example Road', 'Singapore 000000']) {
    assert.ok(runs.some(r => r.str.trim() === whole), `"${whole}" is drawn whole: ${JSON.stringify(runs.map(r => r.str))}`)
  }
  const crossed = overprinted(runs)
  assert.equal(crossed, null, `no text is drawn over other text: ${JSON.stringify(crossed)}`)
})

test('INV-110 a Receipt left naming nobody, its member permanently deleted, has no Bill to block in its html or its PDF; the studio\'s block stands', async () => {
  const nobody: ReceiptRow = { ...paid, buyerName: null, buyerEmail: null, billTo: null }
  const html = htmlToText(receiptHtmlPage(receiptDocument(nobody, STUDIO)))
  assert.doesNotMatch(html, /Bill to/i, html)
  assert.ok(html.includes('Northwind Wellness Pte. Ltd.') && html.includes('12 Example Road'), html)

  const { text } = await readPdf(await receiptPdf(nobody, STUDIO))
  assert.doesNotMatch(text, /b\s*i\s*l\s*l\s*t\s*o/i, text)
  assert.ok(text.includes('12 Example Road'), text)
})
