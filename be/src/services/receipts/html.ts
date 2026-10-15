/**
 * A Receipt as HTML: **the one renderer** for every screen it is read on. The
 * email's receipt block (`email.ts`) is `receiptHtml`, and the member's and
 * the admin's Receipt pages show `receiptHtmlPage`, which the API sends as
 * the Receipt's `html` and the apps display in a frame that runs no script.
 * The PDF (`pdf.ts`) draws the same `ReceiptDocument` in the same colours.
 *
 * Table-based and inline-styled, as the email layout is (`mail/layout.ts`):
 * the one markup email clients and browsers agree on. Every value is escaped
 * here. Labels are written in sentence case and capitalised by CSS, and the
 * facts' and totals' labels are tagged, so the email's plain-text reading
 * says "Receipt number: R-000123" and "Amount paid: S$150.00".
 */
import { EMAIL_FONT as FONT, escapeHtml } from '../mail/layout'
import type { ReceiptBlockLine, ReceiptDocument } from './document'
import { RECEIPT_COLORS as C } from './theme'

const PAD = '28px'

const text = (value: string) => escapeHtml(value).replace(/\r?\n/g, '<br />')
/** A table's column heading, small and muted. */
const th = (value: string, right = false, extra = '') =>
  `<th align="${right ? 'right' : 'left'}" style="padding:0 0 8px ${right ? '12px' : '0'};border-bottom:1px solid ${C.ink};font-family:${FONT};font-size:12px;line-height:1.4;font-weight:400;color:${C.muted};text-align:${right ? 'right' : 'left'};white-space:nowrap;${extra}">${escapeHtml(value)}</th>`
const cell = (value: string, style: string) => `<td valign="top" style="font-family:${FONT};${style}">${value}</td>`

/** The platform's mark at text size: its navy square and pale bookmark, in boxes every client draws. */
const mark = `<span aria-hidden="true" style="display:inline-block;width:16px;height:16px;line-height:16px;border-radius:4px;background:${C.navy};text-align:center;vertical-align:middle;margin-right:7px;"><span style="display:inline-block;width:7px;height:9px;border-radius:1px;background:${C.markLight};vertical-align:middle;"></span></span>`

/** "Receipt", with the studio's logo, or its Business name in the logo's place, on the right. */
function header(doc: ReceiptDocument): string {
  const brand =
    doc.brand.logoUrl && /^https?:\/\//i.test(doc.brand.logoUrl)
      ? `<img src="${escapeHtml(doc.brand.logoUrl)}" alt="${escapeHtml(doc.brand.name)}" height="44" style="display:inline-block;height:44px;width:auto;max-width:160px;border:0;" />`
      : `<div style="font-family:${FONT};font-size:15px;line-height:1.35;font-weight:700;color:${C.ink};">${escapeHtml(doc.sellerName)}</div>`
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
  <td valign="top" style="font-family:${FONT};font-size:28px;line-height:1.2;font-weight:700;color:${C.ink};">${escapeHtml(doc.title)}</td>
  <td valign="top" align="right" style="padding-left:16px;text-align:right;">${brand}</td>
</tr></table>`
}

/** Receipt number, Date paid, Registration: a label and its value a row. */
function facts(doc: ReceiptDocument): string {
  const rows = doc.facts.map(
    f =>
      `<tr><td data-text="label" style="padding:2px 24px 2px 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${C.muted};white-space:nowrap;">${escapeHtml(f.label)}</td><td style="padding:2px 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${C.ink};">${escapeHtml(f.value)}</td></tr>`,
  )
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
${rows.join('\n')}
</table>`
}

const blockLine = (line: ReceiptBlockLine) =>
  `<div style="font-family:${FONT};font-size:13px;line-height:1.55;${line.strong ? `font-weight:700;color:${C.ink};` : `color:${C.muted};`}word-break:break-word;">${escapeHtml(line.text)}</div>`

/** The studio and Bill to, side by side where they fit, one under the other where they do not. */
function parties(doc: ReceiptDocument): string {
  const column = (html: string) =>
    `<div style="display:inline-block;vertical-align:top;width:47%;min-width:220px;max-width:100%;margin:0 0 14px;">${html}</div>`
  const billTo = `<div style="font-family:${FONT};font-size:13px;line-height:1.55;font-weight:700;color:${C.ink};">${escapeHtml(doc.billTo.label)}</div>${doc.billTo.lines
    .map(line => blockLine({ ...line, strong: false }))
    .join('')}`
  return `${column(doc.seller.map(blockLine).join(''))} ${column(billTo)}`
}

/** What was paid and when, with its marker, and the Refund where there was one. */
function headline(doc: ReceiptDocument): string {
  const chip = doc.chip
    ? ` <span style="display:inline-block;margin-left:8px;padding:4px 10px;border-radius:999px;background:${doc.chip.tone === 'paid' ? C.paidGround : C.refundedGround};color:${doc.chip.tone === 'paid' ? C.paid : C.refunded};font-family:${FONT};font-size:11px;line-height:1;font-weight:700;letter-spacing:0.1em;white-space:nowrap;vertical-align:middle;">${escapeHtml(doc.chip.text)}</span>`
    : ''
  const refunded = doc.refunded
    ? `<div style="margin-top:4px;font-family:${FONT};font-size:13px;line-height:1.5;font-weight:700;color:${C.refunded};">${escapeHtml(doc.refunded)}</div>`
    : ''
  return `<div style="font-family:${FONT};font-size:22px;line-height:1.3;font-weight:700;color:${C.ink};"><span>${escapeHtml(doc.headline)}</span>${chip}</div>${refunded}`
}

function lines(doc: ReceiptDocument): string {
  const rows = doc.lines.flatMap(line => {
    const rule = `border-bottom:1px solid ${C.rule};`
    const last = line.discounts.length === 0 ? rule : ''
    const num = `padding:12px 0 ${line.discounts.length ? '4px' : '12px'} 12px;${last}font-size:14px;line-height:1.45;color:${C.ink};text-align:right;white-space:nowrap;`
    // Cells are spaced apart in the source, so the email's plain text reads "Ten pack 1 S$150.00 S$150.00".
    const main = `<tr>${[
      cell(escapeHtml(line.description), `padding:12px 0 ${line.discounts.length ? '4px' : '12px'};${last}font-size:14px;line-height:1.45;color:${C.ink};`),
      cell(escapeHtml(line.quantity), num),
      cell(escapeHtml(line.unitPrice), num),
      cell(escapeHtml(line.amount), num),
    ].join(' ')}</tr>`
    const discounts = line.discounts.map((d, i) => {
      const end = i === line.discounts.length - 1
      const style = `padding:0 0 ${end ? '12px' : '4px'};${end ? rule : ''}font-size:13px;line-height:1.45;color:${C.muted};`
      return `<tr>${[
        cell(escapeHtml(d.label), `${style}padding-left:12px;`),
        cell('', style),
        cell('', style),
        cell(escapeHtml(d.amount), `${style}text-align:right;white-space:nowrap;`),
      ].join(' ')}</tr>`
    })
    return [main, ...discounts]
  })
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
<tr>${[th(doc.columns.description), th(doc.columns.quantity, true), th(doc.columns.unitPrice, true), th(doc.columns.amount, true)].join(' ')}</tr>
${rows.join('\n')}
</table>`
}

function totals(doc: ReceiptDocument): string {
  const rows = doc.totals.map((t, i) => {
    const rule = i > 0 ? `border-top:1px solid ${C.rule};` : ''
    const style = t.strong
      ? `padding:8px 0;${rule}font-size:15px;font-weight:700;color:${C.ink};`
      : `padding:8px 0;${rule}font-size:14px;color:${C.ink};`
    return `<tr><td data-text="label" style="font-family:${FONT};line-height:1.45;${style}">${escapeHtml(t.label)}</td><td align="right" style="font-family:${FONT};line-height:1.45;text-align:right;white-space:nowrap;${style}">${escapeHtml(t.amount)}</td></tr>`
  })
  return `<table role="presentation" align="right" cellpadding="0" cellspacing="0" border="0" style="width:300px;max-width:100%;border-collapse:collapse;">
${rows.join('\n')}
</table>`
}

/** Each payment that paid it: how, when and how much. */
function payments(history: NonNullable<ReceiptDocument['payments']>): string {
  const style = `padding:10px 0;border-bottom:1px solid ${C.rule};font-size:14px;line-height:1.45;color:${C.ink};`
  const rows = history.rows.map(
    p =>
      `<tr>${[
        cell(escapeHtml(p.method), style),
        cell(escapeHtml(p.date), `${style}padding-left:12px;white-space:nowrap;`),
        cell(escapeHtml(p.amount), `${style}padding-left:12px;text-align:right;white-space:nowrap;`),
      ].join(' ')}</tr>`,
  )
  return `<div style="margin:0 0 10px;font-family:${FONT};font-size:16px;line-height:1.35;font-weight:700;color:${C.ink};">${escapeHtml(history.title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
<tr>${[th(history.columns.method), th(history.columns.date, false, 'padding-left:12px;'), th(history.columns.amount, true)].join(' ')}</tr>
${rows.join('\n')}
</table>`
}

function footer(doc: ReceiptDocument): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.rule};"><tr>
  <td style="padding-top:14px;font-family:${FONT};font-size:12px;line-height:1.5;color:${C.muted};">${mark}Powered by <strong style="color:${C.ink};font-weight:700;">${escapeHtml(doc.credit.name)}</strong> · ${escapeHtml(doc.credit.site)}</td>
  <td align="right" style="padding-top:14px;padding-left:12px;font-family:${FONT};font-size:12px;line-height:1.5;color:${C.muted};text-align:right;white-space:nowrap;">${escapeHtml(doc.number)}</td>
</tr></table>`
}

/** The Receipt as an HTML fragment: the email's receipt block, and the body of `receiptHtmlPage`. */
export function receiptHtml(doc: ReceiptDocument): string {
  const row = (html: string, top: string) => `<tr><td style="padding:${top} ${PAD} 0;">${html}</td></tr>`
  const note = doc.note
    ? row(`<div style="font-family:${FONT};font-size:12px;line-height:1.6;color:${C.muted};">${text(doc.note)}</div>`, '28px')
    : ''
  return `<div data-receipt-block style="max-width:640px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.paper};border:1px solid ${C.rule};border-radius:12px;border-collapse:separate;">
${row(header(doc), '28px')}
${row(facts(doc), '18px')}
${row(parties(doc), '22px')}
${row(headline(doc), '8px')}
${row(lines(doc), '22px')}
${row(totals(doc), '4px')}
${doc.payments ? row(payments(doc.payments), '28px') : ''}
${note}
<tr><td style="padding:28px ${PAD} 22px;">${footer(doc)}</td></tr>
</table>
</div>`
}

/** The Receipt as a page of its own: what the API sends as a Receipt's `html`, for the apps to frame. */
export function receiptHtmlPage(doc: ReceiptDocument): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Receipt ${escapeHtml(doc.number)}</title>
</head>
<body style="margin:0;padding:0;background:transparent;">
${receiptHtml(doc)}
</body>
</html>`
}
