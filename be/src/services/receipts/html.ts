/**
 * A Receipt as HTML: **the one renderer** for every screen it is read on. The
 * email's receipt block (`email.ts`) is `receiptHtml`, and the member's and
 * the admin's Receipt pages show `receiptHtmlPage`, which the API sends as
 * the Receipt's `html` and the apps display in a frame that runs no script.
 * The PDF (`pdf.ts`) draws the same `ReceiptDocument` in the same colours.
 *
 * Table-based and inline-styled, as the email layout is (`mail/layout.ts`):
 * the one markup email clients and browsers agree on. Every value is escaped
 * here. Labels are written in sentence case and capitalised by CSS, so the
 * email's plain-text reading says "Amount paid", and the totals' labels are
 * tagged so it reads "Total paid: S$150.00".
 */
import { EMAIL_FONT as FONT, escapeHtml } from '../mail/layout'
import type { ReceiptDocument, ReceiptFactLine } from './document'
import { RECEIPT_COLORS as C } from './theme'

const PAD = '28px'

const text = (value: string) => escapeHtml(value).replace(/\r?\n/g, '<br />')
const label = (value: string, extra = '') =>
  `<div style="font-family:${FONT};font-size:11px;line-height:1.4;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${C.muted};${extra}">${escapeHtml(value)}</div>`

/** The platform's mark at text size: its navy square and pale bookmark, in boxes every client draws. */
const mark = `<span aria-hidden="true" style="display:inline-block;width:16px;height:16px;line-height:16px;border-radius:4px;background:${C.navy};text-align:center;vertical-align:middle;margin-right:7px;"><span style="display:inline-block;width:7px;height:9px;border-radius:1px;background:${C.markLight};vertical-align:middle;"></span></span>`

function header(doc: ReceiptDocument): string {
  const logo = doc.studio.logoUrl && /^https?:\/\//i.test(doc.studio.logoUrl)
    ? `<td valign="top" style="padding:0 14px 0 0;width:1%;"><img src="${escapeHtml(doc.studio.logoUrl)}" alt="" height="44" style="display:block;height:44px;width:auto;max-width:110px;border:0;" /></td>`
    : ''
  const details = doc.studio.details.length
    ? `<div style="margin-top:4px;font-family:${FONT};font-size:12px;line-height:1.55;color:${C.muted};">${doc.studio.details.map(text).join('<br />')}</div>`
    : ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
  <td valign="top"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${logo}<td valign="top">
    <div style="font-family:${FONT};font-size:20px;line-height:1.25;font-weight:700;color:${C.ink};">${escapeHtml(doc.studio.name)}</div>${details}
  </td></tr></table></td>
  <td valign="top" align="right" style="padding-left:16px;white-space:nowrap;text-align:right;">
    <div style="font-family:${FONT};font-size:11px;line-height:1.4;font-weight:700;letter-spacing:0.16em;color:${C.accent};">RECEIPT</div>
    <div style="font-family:${FONT};font-size:22px;line-height:1.25;font-weight:700;color:${C.ink};">${escapeHtml(doc.number)}</div>
  </td>
</tr></table>`
}

function panel(doc: ReceiptDocument): string {
  const chip = doc.chip
    ? `<td valign="middle" align="right" style="padding:18px 22px 18px 0;"><span style="display:inline-block;padding:6px 12px;border-radius:999px;background:${doc.chip.tone === 'paid' ? C.paidGround : C.refundedGround};color:${doc.chip.tone === 'paid' ? C.paid : C.refunded};font-family:${FONT};font-size:11px;line-height:1;font-weight:700;letter-spacing:0.12em;white-space:nowrap;">${escapeHtml(doc.chip.text)}</span></td>`
    : ''
  const refunded = doc.refunded
    ? ` · <strong style="color:${C.refunded};font-weight:700;">${escapeHtml(doc.refunded)}</strong>`
    : ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.panel};border-radius:10px;border-collapse:separate;"><tr>
  <td valign="middle" style="padding:18px 22px;">
    ${label('Amount paid')}
    <div style="margin-top:4px;font-family:${FONT};font-size:32px;line-height:1.15;font-weight:700;color:${C.ink};">${escapeHtml(doc.amountPaid)}</div>
    <div style="margin-top:6px;font-family:${FONT};font-size:13px;line-height:1.5;color:${C.muted};">${escapeHtml(doc.status)}${refunded}</div>
  </td>${chip}
</tr></table>`
}

const factLine = (line: ReceiptFactLine) =>
  line.strong
    ? `<div style="margin-top:3px;font-family:${FONT};font-size:14px;line-height:1.45;font-weight:700;color:${C.ink};word-break:break-word;">${escapeHtml(line.text)}</div>`
    : `<div style="font-family:${FONT};font-size:13px;line-height:1.45;color:${C.muted};word-break:break-word;">${escapeHtml(line.text)}</div>`

function facts(doc: ReceiptDocument): string {
  // Side by side where they fit, one under another where they do not.
  return doc.facts
    .map(
      fact =>
        `<div style="display:inline-block;vertical-align:top;max-width:100%;margin:0 32px 14px 0;">${label(fact.label)}${fact.lines.map(factLine).join('')}</div>`,
    )
    .join('')
}

function lines(doc: ReceiptDocument): string {
  const th = (value: string, right = false) =>
    `<th align="${right ? 'right' : 'left'}" style="padding:0 0 8px ${right ? '12px' : '0'};border-bottom:2px solid ${C.accent};font-family:${FONT};font-size:11px;line-height:1.4;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${C.muted};text-align:${right ? 'right' : 'left'};white-space:nowrap;">${escapeHtml(value)}</th>`
  const cell = (value: string, style: string) => `<td valign="top" style="font-family:${FONT};${style}">${value}</td>`
  const rows = doc.lines.flatMap(line => {
    const rule = `border-bottom:1px solid ${C.rule};`
    const last = line.discounts.length === 0 ? rule : ''
    const num = `padding:12px 0 ${line.discounts.length ? '4px' : '12px'} 12px;${last}font-size:14px;line-height:1.45;color:${C.ink};text-align:right;white-space:nowrap;`
    // Cells are spaced apart in the source, so the email's plain text reads "Ten pack 1 S$150.00 S$150.00".
    const main = `<tr>${[
      cell(escapeHtml(line.description), `padding:12px 0 ${line.discounts.length ? '4px' : '12px'};${last}font-size:14px;line-height:1.45;font-weight:700;color:${C.ink};`),
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
  const rows = doc.totals.map(t => {
    const style = t.grand
      ? `padding:10px 0 0;border-top:2px solid ${C.ink};font-size:17px;font-weight:700;color:${C.ink};`
      : `padding:3px 0;font-size:14px;color:${C.muted};`
    return `<tr><td data-text="label" style="font-family:${FONT};line-height:1.45;${style}">${escapeHtml(t.label)}</td><td align="right" style="font-family:${FONT};line-height:1.45;text-align:right;white-space:nowrap;${style}">${escapeHtml(t.amount)}</td></tr>`
  })
  return `<table role="presentation" align="right" cellpadding="0" cellspacing="0" border="0" style="width:280px;max-width:100%;border-collapse:collapse;">
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
    ? row(`<div style="padding-top:14px;border-top:1px solid ${C.rule};font-family:${FONT};font-size:12px;line-height:1.6;color:${C.muted};">${text(doc.note)}</div>`, '24px')
    : ''
  return `<div data-receipt-block style="max-width:640px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.paper};border:1px solid ${C.rule};border-radius:12px;border-collapse:separate;">
<tr><td style="height:6px;line-height:6px;font-size:6px;background:${C.navy};border-radius:11px 11px 0 0;">&nbsp;</td></tr>
${row(header(doc), '24px')}
${row(panel(doc), '22px')}
${row(facts(doc), '22px')}
${row(lines(doc), '8px')}
${row(totals(doc), '16px')}
${note}
<tr><td style="padding:24px ${PAD} 22px;">${footer(doc)}</td></tr>
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
