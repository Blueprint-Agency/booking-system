/**
 * The one design every email the platform sends is rendered through — member
 * mail, staff mail and super portal mail alike.
 *
 * Two halves:
 *
 *  - **Content helpers** (`emailHeading`, `emailParagraph`, `emailButton`,
 *    `emailDetails`, …) build a body *fragment*. They take HTML, not text: the
 *    fragments they are fed are either copy written in this repo or a stored
 *    template whose `{{var}}` values `renderTemplate` has already escaped. Any
 *    other runtime value must go through `escapeHtml` first.
 *  - **`renderEmail`** wraps a fragment in the shell — preheader, header band
 *    with the brand, the card, the footer — and returns the HTML together with
 *    its plain-text fallback. The brand, preheader, footer note and reason are
 *    plain text and are escaped here, so a studio's name can never be markup.
 *
 * Table-based and inline-styled on purpose: Gmail strips `<style>` in some
 * views, Outlook renders with Word, and a table is the one layout primitive all
 * of them agree on. Max width 600px, the width every client previews at.
 *
 * Pure — no env, no database — so every template can be rendered in a test and
 * in `scripts/render-email-samples.ts` without a running system.
 */

/** The portal's blue palette. */
export const EMAIL_COLORS = {
  primary: '#1a2a7a',
  deep: '#0d1a5e',
  ink: '#0d1a3e',
  muted: '#5a6174',
  border: '#d6dae4',
  page: '#f5f6fa',
  card: '#ffffff',
  /** A tint of the primary, for the code and detail panels. */
  panel: '#eef0f7',
} as const

/** Marks a message as rendered through this layout — asserted on in tests. */
export const EMAIL_LAYOUT_MARKER = 'data-email-layout="v1"'

const C = EMAIL_COLORS
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** For any runtime value — a name, a code, a URL — headed into HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => ESCAPES[ch] ?? ch)
}

/* ── Content helpers ─────────────────────────────────────────────────────── */

export function emailHeading(html: string): string {
  return `<h1 style="margin:0 0 16px;font-family:${FONT};font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:${C.ink};">${html}</h1>`
}

export function emailParagraph(html: string): string {
  return `<p style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.6;color:${C.ink};">${html}</p>`
}

/** Secondary copy — fine print, expiry notes, "if you didn't ask for this". */
export function emailNote(html: string): string {
  return `<p style="margin:0 0 14px;font-family:${FONT};font-size:13px;line-height:1.55;color:${C.muted};">${html}</p>`
}

/** An inline text link, for use inside a paragraph. */
export function emailLink(href: string, label: string): string {
  return `<a href="${href}" style="color:${C.primary};font-weight:600;text-decoration:underline;">${label}</a>`
}

/**
 * The one primary call to action. A table cell carries the colour so Outlook,
 * which ignores padding on an `<a>`, still paints a solid button.
 */
export function emailButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;border-collapse:separate;">
  <tr>
    <td align="center" bgcolor="${C.primary}" style="background:${C.primary};border-radius:8px;">
      <a href="${href}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:8px;border:1px solid ${C.deep};">${label}</a>
    </td>
  </tr>
</table>`
}

/**
 * Label / value rows — the facts a confirmation is for (class, date, place,
 * amount). The label cell is tagged so the plain-text fallback reads
 * "Class: Morning Flow" rather than two words run together.
 */
export function emailDetails(rows: ReadonlyArray<readonly [label: string, valueHtml: string]>): string {
  const body = rows
    .map(
      ([label, value], i) => `  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;${i ? `border-top:1px solid ${C.border};` : ''}font-family:${FONT};font-size:13px;line-height:1.5;color:${C.muted};width:30%;white-space:nowrap;">${label}</td>
    <td valign="top" style="padding:10px 16px;${i ? `border-top:1px solid ${C.border};` : ''}font-family:${FONT};font-size:15px;line-height:1.5;font-weight:600;color:${C.ink};">${value}</td>
  </tr>`,
    )
    .join('\n')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;border:1px solid ${C.border};border-radius:8px;background:${C.panel};border-collapse:separate;">
${body}
</table>`
}

/** A one-time code, set apart so it can be read off a phone at a glance. */
export function emailCode(html: string): string {
  return `<p style="margin:8px 0 18px;"><span style="display:inline-block;padding:12px 20px;background:${C.panel};border:1px solid ${C.border};border-radius:8px;font-family:${FONT};font-size:28px;font-weight:700;letter-spacing:0.18em;color:${C.deep};">${html}</span></p>`
}

/**
 * A line the layout lifts out of the body and prints in the footer — a
 * studio's premises, stored with its copy. Plain text only.
 */
export function emailFooterNote(text: string): string {
  return `<p data-email-footer-note style="display:none;">${escapeHtml(text)}</p>`
}

/* ── Stored bodies ───────────────────────────────────────────────────────── */

/**
 * The palette of the shell stored template bodies used to carry whole. Rows
 * written before the shell moved into this module still hold it; their content
 * is lifted out and recoloured so they wear the same design as everything else.
 */
const LEGACY_COLORS: Record<string, string> = {
  '#c97a4a': C.primary,
  '#4a4742': C.ink,
  '#1f1d1b': C.ink,
  '#7a7670': C.muted,
  '#9b9590': C.muted,
  '#e9e4dd': C.border,
  '#f7f5f2': C.page,
}

const decodeBasic = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

/**
 * A stored template body as a fragment the layout can wrap, plus any footer
 * note it carries.
 *
 * Three shapes are accepted: a fragment (what is seeded now, and what the
 * portal's template editor holds); a fragment with an `emailFooterNote`; and a
 * whole document from the old shell, whose header and footer are dropped (the
 * layout draws its own) and whose premises line becomes the footer note.
 */
export function templateBodyFragment(stored: string): { bodyHtml: string; footerNote: string | null } {
  let body = stored
  let footerNote: string | null = null

  if (/<html[\s>]|<body[\s>]/i.test(body)) {
    const h1 = body.search(/<h1[\s>]/i)
    const hr = body.lastIndexOf('<hr')
    if (h1 >= 0 && hr > h1) {
      // The old shell: `<h1>` opens the content and `<hr>` closes it; the one
      // paragraph after the rule is "Name — premises".
      const footer = body.slice(hr).match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? ''
      const dash = footer.indexOf(' — ')
      if (dash >= 0) footerNote = decodeBasic(footer.slice(dash + 3).replace(/<[^>]+>/g, '').trim()) || null
      body = body.slice(h1, hr)
    } else {
      body = body.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? body
    }
    body = body.replace(/#[0-9a-f]{6}\b/gi, hex => LEGACY_COLORS[hex.toLowerCase()] ?? hex)
  }

  body = body.replace(/<p data-email-footer-note[^>]*>([\s\S]*?)<\/p>/gi, (_m, inner: string) => {
    footerNote = decodeBasic(inner.replace(/<[^>]+>/g, '').trim()) || footerNote
    return ''
  })

  return { bodyHtml: body.trim(), footerNote }
}

/* ── Plain text ──────────────────────────────────────────────────────────── */

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&zwnj;/g, '')
    .replace(/&rarr;/g, '→')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '')

/**
 * The plain-text reading of a body fragment: paragraphs as paragraphs, links
 * as "label: url", detail rows as "Label: value". `withUrls: false` drops the
 * addresses — for the preheader, where a URL is noise.
 */
export function htmlToText(html: string, { withUrls = true }: { withUrls?: boolean } = {}): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(style|head|title|script)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<p data-email-footer-note[^>]*>[\s\S]*?<\/p>/gi, '')
    // As a browser reads it: a newline in the source is a space. Line breaks
    // come only from the tags below.
    .replace(/\s+/g, ' ')

  s = s.replace(/<a\b[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
    const label = decodeEntities(stripTags(inner)).replace(/\s*→\s*$/, '').trim()
    const url = decodeEntities(href).trim()
    if (!withUrls || !url) return label
    if (!label || label === url) return url
    return `${label}: ${url}`
  })

  s = s
    .replace(/<td[^>]*data-text="label"[^>]*>([\s\S]*?)<\/td>/gi, (_m, inner: string) => `${stripTags(inner).trim()}: `)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6]|div|table|ul|ol)>/gi, '\n\n')
    .replace(/<\/(tr|li)>/gi, '\n')
    .replace(/<hr[^>]*>/gi, '\n\n')

  return decodeEntities(stripTags(s))
    .split('\n')
    .map(line => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* ── The shell ───────────────────────────────────────────────────────────── */

/** An initial per word, capped at three — the header mark is a square. */
export function brandInitials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .map(word => [...word][0]!.toUpperCase())
    .join('')
  return letters.slice(0, 3) || '·'
}

export interface EmailLayoutInput {
  /** Whose mail this is — the studio's name, or the platform's. Plain text. */
  brandName: string
  /** The body fragment, built from the helpers above. Trusted HTML. */
  bodyHtml: string
  /** The subject — used as the document title. Plain text. */
  subject?: string
  /** The inbox preview line. Plain text; derived from the body when omitted. */
  preheader?: string
  /** A second footer line under the brand — a studio's premises. Plain text. */
  footerNote?: string | null
  /** Why the recipient got this. Plain text. */
  reason: string
}

export interface RenderedEmail {
  html: string
  text: string
}

const PREHEADER_MAX = 120

/** The first sentence or two a reader sees in the inbox list, skipping the greeting. */
function derivePreheader(bodyHtml: string): string {
  const withoutHeading = bodyHtml.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, '')
  const text = htmlToText(withoutHeading, { withUrls: false })
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !/^(hi|hello|dear)\b[^.!?]*,$/i.test(l))
    .join(' ')
  return text.length > PREHEADER_MAX ? `${text.slice(0, PREHEADER_MAX - 1).trimEnd()}…` : text
}

/**
 * Wrap a body fragment in the shared design. Returns the HTML to send and the
 * plain-text alternative that goes with it.
 */
export function renderEmail(input: EmailLayoutInput): RenderedEmail {
  const brand = input.brandName.trim() || '·'
  const name = escapeHtml(brand)
  const mark = escapeHtml(brandInitials(brand))
  const footerNote = input.footerNote?.trim() || ''
  const preheader = (input.preheader ?? derivePreheader(input.bodyHtml)).trim()
  const title = escapeHtml(input.subject ?? brand)
  // Pads the preview so the client does not fill it with the body's first words.
  const spacer = '&#847;&zwnj;&nbsp;'.repeat(40)

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${title}</title>
  <style>
    @media only screen and (max-width: 620px) {
      .email-pad { padding-left: 20px !important; padding-right: 20px !important; }
    }
  </style>
</head>
<body ${EMAIL_LAYOUT_MARKER} style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.page};">${escapeHtml(preheader)}${spacer}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background:${C.page};">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;border-collapse:separate;">
          <tr>
            <td class="email-pad" bgcolor="${C.primary}" style="background:${C.primary};border-bottom:4px solid ${C.deep};border-radius:12px 12px 0 0;padding:20px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="36" height="36" align="center" valign="middle" bgcolor="#ffffff" style="width:36px;height:36px;background:#ffffff;border-radius:8px;font-family:${FONT};font-size:14px;font-weight:700;line-height:36px;color:${C.primary};text-align:center;">${mark}</td>
                  <td style="padding-left:12px;font-family:${FONT};font-size:16px;font-weight:600;letter-spacing:-0.01em;color:#ffffff;">${name}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="email-pad" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.border};border-top:0;border-radius:0 0 12px 12px;padding:32px;font-family:${FONT};color:${C.ink};">
${input.bodyHtml}
            </td>
          </tr>
          <tr>
            <td class="email-pad" align="center" style="padding:20px 32px 8px;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.muted};text-align:center;">
              <strong style="color:${C.ink};font-weight:600;">${name}</strong>${footerNote ? `<br />${escapeHtml(footerNote)}` : ''}<br />
              ${escapeHtml(input.reason)}
            </td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`

  const text = [
    brand,
    '',
    htmlToText(input.bodyHtml),
    '',
    '--',
    footerNote ? `${brand} — ${footerNote}` : brand,
    input.reason,
  ].join('\n')

  return { html, text }
}
